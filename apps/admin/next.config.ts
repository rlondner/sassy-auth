import path from 'node:path'
import { config as loadEnv } from 'dotenv'
import type { NextConfig } from 'next'
import { loadEnvConfig } from '@next/env'
import { withSentryConfig } from '@sentry/nextjs'
import createNextIntlPlugin from 'next-intl/plugin'
import { buildSecurityHeaders } from './lib/security-headers'

// Next.js only auto-loads .env.local from this app's own directory, but the
// repo keeps a single .env.local at the monorepo root (see README). Load it
// explicitly so vars like NEXT_PUBLIC_TURNSTILE_SITE_KEY reach the build even
// when the shell that started `next dev` never exported them itself.
//
// forceReload is required, not cosmetic: Next's own CLI bootstrap already
// calls loadEnvConfig(apps/admin, ...) before next.config.ts is even
// required, finding nothing (no .env.local in this directory) and caching
// that empty result in @next/env's module-level state. Without forceReload,
// this call just returns that stale empty cache instead of reading the
// repo-root file.
loadEnvConfig(path.join(__dirname, '../..'), process.env.NODE_ENV !== 'production', console, true)

// bug: `pnpm start` (the production-style run used by `make start-no-watch` /
// `start-admin`, both documented as running "behind Caddy") needs
// .env.production's COOKIE_PREFIX/COOKIE_SECURE to win over .env.local's, to
// stay in agreement with apps/auth-server/src/main.ts's identical override
// (same npm_lifecycle_event === 'start' gate). But Next's env-file
// precedence is fixed and NODE_ENV-driven — `.env.$(NODE_ENV).local` >
// `.env.local` > `.env.$(NODE_ENV)` > `.env` — so `.env.local` always
// outranks `.env.production`, regardless of the `dev` flag passed to
// loadEnvConfig above. That let .env.local's COOKIE_PREFIX ("dev") win here
// even under `next start`, while auth-server's explicit override picked up
// .env.production's COOKIE_PREFIX ("prd") — admin went looking for
// "dev.session_token" among auth-server's actual "__Secure-prd.session_token"
// Set-Cookie and sign-in failed with no indication why. Force dotenv's own
// override semantics on top of Next's, scoped to the same 'start' lifecycle
// event, to keep the two services' cookie config in sync.
if (process.env.npm_lifecycle_event === 'start') {
  loadEnv({ path: path.join(__dirname, '../..', '.env.production'), override: true })
}

const withNextIntl = createNextIntlPlugin('./i18n/request.ts')


const nextConfig: NextConfig = {
  transpilePackages: ['@sassy-auth/ui'],
  devIndicators: {
    position: "bottom-right", // top-right, bottom-right, top-left, bottom-left
  },
  async headers() {
    // bug-0223: computed per build rather than a module constant so HSTS is
    // emitted in production only — see lib/security-headers.ts.
    return [{ source: '/:path*', headers: buildSecurityHeaders() }]
  },
}

export default withSentryConfig(withNextIntl(nextConfig), {
  silent: true,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
})
