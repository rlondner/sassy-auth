import type { NextConfig } from 'next'
import { withSentryConfig } from '@sentry/nextjs'
import createNextIntlPlugin from 'next-intl/plugin'
import { buildSecurityHeaders } from './lib/security-headers'

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
