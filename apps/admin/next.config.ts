import type { NextConfig } from 'next'
import { withSentryConfig } from '@sentry/nextjs'
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./i18n/request.ts')

// bug-0191: baseline security headers applied to every admin response.
// - X-Frame-Options: DENY prevents clickjacking (the admin console must
//   never be embeddable in an iframe).
// - X-Content-Type-Options: nosniff blocks MIME-type sniffing that could
//   turn a text response into an executable one.
// - Referrer-Policy: strict-origin-when-cross-origin keeps the URL path
//   out of the Referer header on cross-origin navigations.
// - Permissions-Policy denies browser features the admin console never
//   uses (camera, microphone, geolocation). Follow-up if we ever add a
//   flow that needs one of these — narrow the deny-list rather than
//   remove the header.
const SECURITY_HEADERS = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
]

const nextConfig: NextConfig = {
  transpilePackages: ['@sassy-auth/ui'],
  devIndicators: {
    position: "bottom-right", // top-right, bottom-right, top-left, bottom-left
  },
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }]
  },
}

export default withSentryConfig(withNextIntl(nextConfig), {
  silent: true,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
})
