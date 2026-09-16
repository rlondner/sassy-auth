import path from 'node:path'
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
