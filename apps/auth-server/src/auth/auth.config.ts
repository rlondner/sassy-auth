import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { magicLink, emailOTP, openAPI } from 'better-auth/plugins';
import { prisma } from '@sassy-auth/db';
import { passwordResetEmail } from '../email/templates/password-reset.template';
import { getEmailer } from '../email/email.singleton';
import { captureResetUrl } from './reset-url-context';
import { APIError } from 'better-auth/api';
import { evaluateSessionGate } from './session-gate';
import { createAppLogger } from '../common/logger/winston.config';
import { sendSignInOtp } from './otp-sender';
import { otpTestStore } from './otp-test-store';

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
        before: async (session: { userId: string }) => {
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
  emailAndPassword: {
    enabled: true,
    resetPasswordTokenExpiresIn: 3600, // 1 hour
    sendResetPassword: async ({ user, token }: { user: { email: string; name?: string }; token: string }) => {
      const adminUrl = process.env.ADMIN_URL ?? 'http://localhost:3001';
      const resetUrl = `${adminUrl}/reset-password?token=${token}`;
      captureResetUrl(resetUrl); // hand the URL back to the admin endpoint if it's listening
      const firstName = (user.name ?? '').trim().split(' ')[0] || 'there';
      await getEmailer().send({ to: user.email, ...passwordResetEmail({ firstName, resetUrl }) });
    },
  },
  // bug-0175: gate each social provider on BOTH the id AND the secret.
  // Previously the truthy check on the id was paired with a non-null
  // assertion (`!`) on the secret — an operator who set the id but
  // forgot the secret got an `undefined` cast to string, which crashed
  // deep inside BetterAuth's OAuth flow or silently misbehaved. The
  // symmetric guard falls back to "provider disabled" instead.
  socialProviders: {
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      },
    }),
    ...(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET && {
      microsoft: {
        clientId: process.env.MICROSOFT_CLIENT_ID,
        clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
      },
    }),
    ...(process.env.APPLE_CLIENT_ID && process.env.APPLE_CLIENT_SECRET && {
      apple: {
        clientId: process.env.APPLE_CLIENT_ID,
        clientSecret: process.env.APPLE_CLIENT_SECRET,
      },
    }),
    ...(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET && {
      github: {
        clientId: process.env.GITHUB_CLIENT_ID,
        clientSecret: process.env.GITHUB_CLIENT_SECRET,
      },
    }),
  },
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
    openAPI({ disableDefaultReference: true }),
  ],
});
