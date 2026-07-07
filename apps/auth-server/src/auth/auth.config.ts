import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { magicLink, emailOTP, openAPI } from 'better-auth/plugins';
import { prisma } from '@sassy-auth/db';

// Front-ends allowed to proxy BetterAuth calls (sign-in, sign-out, etc.).
// Undici's default `Sec-Fetch-Mode: cors` makes server-to-server calls look
// browser-originated, which trips BetterAuth's formCsrfMiddleware and then
// requires a trusted Origin. Comma-separated list in TRUSTED_ORIGINS; defaults
// to the admin app's dev URL so local + e2e work out of the box.
export const TRUSTED_ORIGINS = process.env.TRUSTED_ORIGINS
  ?.split(',')
  .map((s) => s.trim())
  .filter(Boolean) ?? ['http://localhost:3001'];

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
  },
  socialProviders: {
    ...(process.env.GOOGLE_CLIENT_ID && {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      },
    }),
    ...(process.env.MICROSOFT_CLIENT_ID && {
      microsoft: {
        clientId: process.env.MICROSOFT_CLIENT_ID,
        clientSecret: process.env.MICROSOFT_CLIENT_SECRET!,
      },
    }),
    ...(process.env.APPLE_CLIENT_ID && {
      apple: {
        clientId: process.env.APPLE_CLIENT_ID,
        clientSecret: process.env.APPLE_CLIENT_SECRET!,
      },
    }),
    ...(process.env.GITHUB_CLIENT_ID && {
      github: {
        clientId: process.env.GITHUB_CLIENT_ID,
        clientSecret: process.env.GITHUB_CLIENT_SECRET!,
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
      sendVerificationOTP: async ({ email, otp }: { email: string; otp: string }) => {
        // bug-0163: same story as the magic-link handler — the OTP is
        // a bearer credential, no logs in prod.
        if (process.env.NODE_ENV !== 'production') {
          console.log(`[email-otp] ${email} → ${otp}`);
        }
      },
    }),
    openAPI({ disableDefaultReference: true }),
  ],
});
