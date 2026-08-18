/**
 * Baseline security headers applied to every admin response.
 *
 * bug-0191 established the first four:
 * - X-Frame-Options: DENY prevents clickjacking (the admin console must
 *   never be embeddable in an iframe).
 * - X-Content-Type-Options: nosniff blocks MIME-type sniffing that could
 *   turn a text response into an executable one.
 * - Referrer-Policy: strict-origin-when-cross-origin keeps the URL path
 *   out of the Referer header on cross-origin navigations.
 * - Permissions-Policy denies browser features the admin console never
 *   uses (camera, microphone, geolocation). Follow-up if we ever add a
 *   flow that needs one of these — narrow the deny-list rather than
 *   remove the header.
 *
 * Lives in lib/ rather than inline in next.config.ts so the production
 * gate below is unit-testable.
 */
export function buildSecurityHeaders(
  nodeEnv: string | undefined = process.env.NODE_ENV,
): Array<{ key: string; value: string }> {
  const headers = [
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  ]

  // bug-0223: without HSTS, a user who types http://admin.example.com is not
  // upgraded to HTTPS, so the first request — which can carry the session
  // cookie — crosses the network in the clear. That is the window an
  // SSL-stripping attacker needs.
  //
  // Production only, and deliberately so: browsers honour HSTS on localhost as
  // well, so emitting this in dev would pin http://localhost:3001 to HTTPS in
  // the developer's browser — along with every other localhost project — and
  // the only way back is chrome://net-internals/#hsts.
  //
  // Two years of max-age is the usual recommendation. `includeSubDomains`
  // assumes nothing HTTP-only is served from a sibling subdomain of the admin
  // host; drop it if that stops being true. `preload` is deliberately absent —
  // getting off the browser preload list requires a vendor delisting process,
  // so it should be an explicit decision rather than something inherited.
  if (nodeEnv === 'production') {
    headers.push({
      key: 'Strict-Transport-Security',
      value: 'max-age=63072000; includeSubDomains',
    })
  }

  return headers
}
