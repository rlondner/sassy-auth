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

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  secret: process.env.BETTER_AUTH_SECRET!,
  baseURL: process.env.BETTER_AUTH_URL!,
  trustedOrigins: TRUSTED_ORIGINS,
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
        // Wire to your email service in production.
        // In development, log the link to the console.
        console.log(`[magic-link] ${email} → ${url}`);
      },
    }),
    emailOTP({
      sendVerificationOTP: async ({ email, otp }: { email: string; otp: string }) => {
        console.log(`[email-otp] ${email} → ${otp}`);
      },
    }),
    openAPI({ disableDefaultReference: true }),
  ],
});
