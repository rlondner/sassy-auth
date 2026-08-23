import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { magicLink, emailOTP, openAPI, twoFactor, genericOAuth } from 'better-auth/plugins';
import { prisma } from '@sassy-auth/db';
import { passwordResetEmail } from '../email/templates/password-reset.template';
import { getEmailer } from '../email/email.singleton';
import { captureResetUrl } from './reset-url-context';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { evaluateSessionGate } from './session-gate';
import { createAppLogger } from '../common/logger/winston.config';
import { sendSignInOtp } from './otp-sender';
import { otpTestStore } from './otp-test-store';
import { buildSocialProviders } from '../social/build-social-providers';
import { stubProviderConfig } from '../social/stub-provider';
import { signInMethodFromPath } from '../social/sign-in-method';
import { resolveHookRoutePath } from '../social/resolve-hook-route-path';
import { classifyCallbackOutcome } from '../social/classify-callback-outcome';
import { recordFederationEvent } from '../social/record-federation-event';
import { readIsPrivateEmail } from '../social/apple-private-relay-context';
// task-15: the only Sentry import outside instrument.ts / this adapter's own
// module. record-federation-event.ts's OTel-Logs default emit is a no-op on
// this stack (see telemetry-sentry-adapter.ts's header comment for the
// file:line trail), so production wiring injects this adapter explicitly
// rather than relying on the default.
import { emitFederationEventToSentry } from '../social/telemetry-sentry-adapter';

// Front-ends allowed to proxy BetterAuth calls (sign-in, sign-out, etc.).
// Undici's default `Sec-Fetch-Mode: cors` makes server-to-server calls look
// browser-originated, which trips BetterAuth's formCsrfMiddleware and then
// requires a trusted Origin. Comma-separated list in TRUSTED_ORIGINS; defaults
// to the admin app's dev URL so local + e2e work out of the box.
export const TRUSTED_ORIGINS = (process.env.TRUSTED_ORIGINS
  ?.split(',')
  .map((s) => s.trim())
  .filter(Boolean) ?? ['http://localhost:3001'])
  .map((origin) => {
    try {
      new URL(origin)
      return origin
    } catch {
      throw new Error(`Invalid origin in TRUSTED_ORIGINS: "${origin}"`)
    }
  });

// bug-0158: previously the BetterAuth session lifetime, refresh
// window, and cookie attributes were entirely implicit — whatever
// BetterAuth's defaults happened to be for the installed version.
// That made deploys fragile (a BetterAuth upgrade could silently
// change session policy) and left the cookie's Secure attribute
// dependent on `BETTER_AUTH_URL` starting with https:// (the
// library's inference), rather than an explicit prod check.
//
// Pinning these here makes the session policy visible in review and
// stable across upgrades.
const SESSION_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 7;      // 7 days
const SESSION_UPDATE_AGE_SECONDS = 60 * 60 * 24;          // extend if used within 24h

// The session-create gate runs outside a Nest request context, so it uses a
// standalone Winston logger rather than the injected LoggerService (same
// rationale as the bug-0186 after-hook).
const authLogger = createAppLogger();

// task-4: BetterAuth's databaseHooks context does NOT carry the literal
// request path. `ctx.path` here is `endpoint.path` — the *route template*
// registered with better-call (e.g. "/callback/:id" or
// "/oauth2/callback/:providerId") — not the resolved URL. The provider name
// only exists in `ctx.params`. See `resolveHookRoutePath` in
// ../social/resolve-hook-route-path.ts (moved there in the fix-round-1
// review pass so it can be unit-tested directly) for the full source
// evidence and the reconstruction logic.

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  secret: process.env.BETTER_AUTH_SECRET!,
  baseURL: process.env.BETTER_AUTH_URL!,
  trustedOrigins: TRUSTED_ORIGINS,
  session: {
    expiresIn: SESSION_EXPIRES_IN_SECONDS,
    updateAge: SESSION_UPDATE_AGE_SECONDS,
    // bug-0158: keep the cookie cache off by default — the
    // per-request session lookup is what the admin middleware
    // relies on for authoritative logout, and the caching layer
    // adds a "user logs out on replica A, still sees a valid
    // cached session on replica B" hazard that isn't worth the
    // few ms saved.
    cookieCache: { enabled: false },
    // task-4: persisted by the databaseHooks.session.create.before hook
    // below. `input: false` — this is derived server-side from the request
    // route, never client-supplied.
    additionalFields: {
      signInMethod: { type: 'string', required: false, input: false },
    },
  },
  advanced: {
    // bug-0158: explicit cookie attributes. `sameSite: 'lax'`
    // matches the admin console's first-party flow (top-level
    // navigations and same-site POSTs). `secure` is forced in
    // production so the cookie never travels over plain HTTP,
    // regardless of what `BETTER_AUTH_URL` looks like. `httpOnly`
    // is on by BetterAuth default but reasserting it here makes
    // the intent obvious to future readers.
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    },
  },
  rateLimit: {
    // Explicit rate-limit for the 2FA verify endpoints. In better-auth 1.6.11
    // customRules *override* the twoFactor plugin's built-in per-path limit
    // (window: 10, max: 3 in dist/plugins/two-factor/index.mjs:269) for exact
    // path matches — they do NOT stack on top of it. These rules are therefore
    // set at the same value as the plugin default so the intent (at most 3
    // attempts per 10 s) is preserved explicitly in config and visible to
    // reviewers. If stricter limits are needed, lower max here rather than
    // relying on the plugin's implicit default.
    // Note: storage defaults to in-memory; limits are per-process, not global
    // across replicas. Wire secondaryStorage (Redis) for a cross-replica cap.
    customRules: {
      '/two-factor/verify-totp': { window: 10, max: 3 },
      '/two-factor/verify-backup-code': { window: 10, max: 3 },
    },
  },
  // bug-0186: BetterAuth creates a Session row on every successful
  // sign-in (email/password, magic-link, OTP, social). Hook the
  // `after` phase of session-create to bump SaUser.lastLoginAt so
  // the admin console's "Last login" column reflects the truth for
  // console-backed users. `updateMany` because a session can be
  // orphaned from an SaUser (bug-0151) — one BetterAuth user with
  // no SaUser is a no-op that must not fail the sign-in.
  databaseHooks: {
    session: {
      create: {
        before: async (
          session: { userId: string },
          ctx?: { path?: string; params?: Record<string, string> } | null,
        ) => {
          const gate = await evaluateSessionGate(prisma, session.userId);
          if (!gate.allowed) {
            // bug-0163-adjacent: no credential here, safe to log. This is the
            // security event — a non-active user attempted to create a session
            // (any method: password, OTP, social).
            authLogger.warn('Session creation blocked', {
              context: 'session-gate',
              betterAuthUserId: session.userId,
              status: gate.status,
            });
            throw new APIError('FORBIDDEN', {
              message: 'This account is not active.',
            });
          }
          // task-4: gate runs first — a blocked user never reaches here. Only
          // once the session is allowed do we record how it was created.
          const signInMethod = signInMethodFromPath(resolveHookRoutePath(ctx));
          if (!signInMethod) return;
          return { data: { ...session, signInMethod } };
        },
        after: async (session: { userId: string }) => {
          try {
            await prisma.saUser.updateMany({
              where: { betterAuthUserId: session.userId },
              data: { lastLoginAt: new Date() },
            });
          } catch (err) {
            // Log-only — a failure to update lastLoginAt must not
            // prevent the session from being usable. Matches the
            // fire-and-forget stance in token.controller.ts
            // directLogin. Console.error is deliberate: this runs
            // outside a Nest request context so we don't have the
            // injected LoggerService here.
            console.error(
              `[bug-0186] Failed to update lastLoginAt for BetterAuth user ${session.userId}:`,
              err,
            );
          }
        },
      },
    },
  },
  // task-8: exactly ONE top-level `hooks.after` may exist on this config —
  // BetterAuth's `getHooks()` (to-auth-endpoints.mjs) reads
  // `authContext.options.hooks?.after` as a single value; a second
  // `hooks: { after: ... }` object literal elsewhere in this file would
  // silently overwrite this one rather than stacking. A later task that
  // needs its own after-matcher MUST add another `if (...)` branch inside
  // this same handler, not a second `hooks` block.
  hooks: {
    after: createAuthMiddleware(async (ctx) => {
      // task-8: only the OAuth callback route is in scope here. Matched by
      // route TEMPLATE + params, same reconstruction task-4 already
      // established for databaseHooks (see resolveHookRoutePath) — `ctx.path`
      // is `/callback/:id` (callback.mjs:20), never the literal request path.
      if (ctx.path !== '/callback/:id') return;
      const providerId = (ctx.params as Record<string, string> | undefined)?.id;

      // task-8: classifyCallbackOutcome reads BetterAuth's OWN redirect/error
      // from ctx.context.returned — see classify-callback-outcome.ts for the
      // full file:line trail on why the provider profile itself
      // (emailVerified in particular) is NOT available here: it is
      // discarded inside handleOAuthUserInfo before this hook ever runs.
      //
      // fix round 1 (review finding 1): `is_private_email` IS available,
      // via a separate channel — build-social-providers.ts's Apple
      // `mapProfileToUser` captured it into request-scoped AsyncLocalStorage
      // (apple-private-relay-context.ts) earlier in this same request,
      // before the refusal was even decided. readIsPrivateEmail() is safe
      // to call unconditionally here: it returns false for every
      // non-Apple provider and for any Apple callback that never captured.
      const outcome = classifyCallbackOutcome(ctx.context.returned, readIsPrivateEmail());
      if (!outcome) return;

      // Audit trail first (never throws) — the real reason is recorded
      // regardless of whether the browser can actually be redirected to our
      // own error page (see the canRedirect note below).
      await recordFederationEvent(
        { db: prisma, logger: authLogger, emit: emitFederationEventToSentry },
        {
          type: 'social.signin.rejected',
          provider: providerId ?? 'unknown',
          reason: outcome.reason,
        },
      );

      if (!outcome.canRedirect) {
        // task-8 finding: this is the session-gate's FORBIDDEN throw (a
        // matched-but-inactive SaUser). Rewriting response headers from an
        // `after` hook cannot change the response's HTTP status code
        // (to-auth-endpoints.mjs:172-174 always uses the status captured at
        // the endpoint's original throw), so a 403 cannot be turned into a
        // working redirect from here. The browser will see BetterAuth's raw
        // 403 rather than our /oauth-error page; the audit event above is
        // still the source of truth for operators. See task-8-report.md.
        return;
      }

      const adminUrl = process.env.ADMIN_URL ?? 'http://localhost:3001';
      const target = `${adminUrl}/oauth-error?code=${outcome.code}`;
      // Mutate in place: ctx.context.responseHeaders is the SAME Headers
      // object to-auth-endpoints.mjs's final toResponse() call reads as
      // `result.headers` (to-auth-endpoints.mjs:148, 172-174). A reassignment
      // here (`ctx.context.responseHeaders = new Headers(...)`) would NOT be
      // seen by that call; only an in-place `.set` is visible outside this
      // hook.
      ctx.context.responseHeaders?.set('location', target);
    }),
  },
  emailAndPassword: {
    enabled: true,
    // The session-create gate below (`databaseHooks.session.create.before` →
    // evaluateSessionGate) refuses a session unless a matching SaUser exists
    // and is 'active'. BetterAuth's signUpEmail auto-creates a session, but
    // every caller in this codebase — the seed, the demo seeds, and
    // /api/register — necessarily creates the SaUser *after* sign-up, because
    // it needs the BetterAuth user id for the link. So the auto sign-in can
    // never pass the gate; it can only throw FORBIDDEN and abort the caller
    // mid-way, leaving an orphaned BetterAuth user behind. Nothing here reads
    // the session sign-up would return, so disabling it is the fix rather than
    // a workaround.
    //
    // Side effect to be aware of: with autoSignIn disabled, BetterAuth stops
    // throwing on a duplicate email and instead returns a *synthetic*
    // (never-persisted) user so sign-up cannot be used to enumerate accounts.
    // RegistrationService checks for that explicitly — see its 409 path.
    autoSignIn: false,
    resetPasswordTokenExpiresIn: 3600, // 1 hour
    sendResetPassword: async ({ user, token }: { user: { email: string; name?: string }; token: string }) => {
      const adminUrl = process.env.ADMIN_URL ?? 'http://localhost:3001';
      const resetUrl = `${adminUrl}/reset-password?token=${token}`;
      captureResetUrl(resetUrl); // hand the URL back to the admin endpoint if it's listening
      const firstName = (user.name ?? '').trim().split(' ')[0] || 'there';
      await getEmailer().send({ to: user.email, ...passwordResetEmail({ firstName, resetUrl }) });
    },
  },
  // Social providers are built from env by build-social-providers.ts, which
  // keeps the bug-0175 both-halves guard, sets disableSignUp (invite-only),
  // and deliberately does NOT trust any provider. GitHub is intentionally
  // dropped here: it was never surfaced in any UI and is out of scope.
  socialProviders: buildSocialProviders(process.env),
  plugins: [
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        // bug-0163: the magic-link URL is a bearer credential —
        // whoever holds the URL can authenticate as `email`. Console
        // logging it is fine in dev (visible to the developer running
        // the server) but in production the log lands in a shared
        // stream (docker logs, Sentry, Datadog, etc.) that operators
        // and any log-forwarding pipeline can read — turning every
        // magic-link send into a credential leak.
        // Wire the real send in production; dev keeps the log so the
        // developer flow (click link in terminal) still works.
        if (process.env.NODE_ENV !== 'production') {
          console.log(`[magic-link] ${email} → ${url}`);
        }
      },
    }),
    emailOTP({
      otpLength: 6,
      expiresIn: 300,
      allowedAttempts: 3,
      disableSignUp: true,
      rateLimit: { window: 60, max: 5 },
      sendVerificationOTP: async ({ email, otp, type }: { email: string; otp: string; type: string }) => {
        await sendSignInOtp(
          {
            db: prisma,
            emailer: getEmailer(),
            store: otpTestStore,
            logger: authLogger,
            isTest: process.env.NODE_ENV === 'test',
          },
          { email, otp, type },
        );
      },
    }),
    twoFactor({
      issuer: 'Sassy Auth',
      // 10 backup codes (matches the spec; default is also 10, explicit for
      // reviewability).
      backupCodeOptions: { amount: 10 },
      // skipVerificationOnEnable stays false (default): 2FA is not active
      // until the user confirms with a live TOTP code. This prevents lockout
      // from a mis-scanned QR.
    }),
    openAPI({ disableDefaultReference: true }),
    // task-11: registers no routes at all unless E2E_STUB_IDP_URL is set AND
    // NODE_ENV is exactly 'test' or 'development' — see stub-provider.ts.
    // Empty in production, and empty on every ambiguous NODE_ENV a
    // blocklist would fail open on (unset, 'Production', '').
    ...(stubProviderConfig(process.env).length
      ? [genericOAuth({ config: stubProviderConfig(process.env) as never })]
      : []),
  ],
});
