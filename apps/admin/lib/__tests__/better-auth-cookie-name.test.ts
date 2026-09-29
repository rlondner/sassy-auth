import { getBetterAuthCookieName } from '@sassy-auth/types'

// Regression test for the production sign-in outage this traces to: BetterAuth
// prefixes every cookie it issues with `__Secure-` whenever NODE_ENV is
// 'production' (auth.config.ts's useSecureCookies), but apps/admin used to
// hardcode the unprefixed name at every call site. Verified against the real
// auth-server running with NODE_ENV=production — it issues exactly
// `__Secure-better-auth.session_token`, and a get-session call with the old
// hardcoded `better-auth.session_token` returns no session at all.
describe('getBetterAuthCookieName', () => {
  it('adds the __Secure- prefix in production, for every BetterAuth cookie', () => {
    expect(getBetterAuthCookieName('session_token', true)).toBe('__Secure-better-auth.session_token')
    expect(getBetterAuthCookieName('two_factor', true)).toBe('__Secure-better-auth.two_factor')
    expect(getBetterAuthCookieName('trust_device', true)).toBe('__Secure-better-auth.trust_device')
  })

  it('keeps the unprefixed name outside production', () => {
    expect(getBetterAuthCookieName('session_token', false)).toBe('better-auth.session_token')
    expect(getBetterAuthCookieName('two_factor', false)).toBe('better-auth.two_factor')
    expect(getBetterAuthCookieName('trust_device', false)).toBe('better-auth.trust_device')
  })

  // bug-0293: staging and production share the same COOKIE_DOMAIN, so an
  // explicit prefix (COOKIE_PREFIX, wired through auth.config.ts's
  // `advanced.cookiePrefix`) is the only way to keep their session cookies
  // from colliding in the same browser's cookie jar.
  it('honors a custom prefix, still applying the production __Secure- rule', () => {
    expect(getBetterAuthCookieName('session_token', true, 'sassy-staging')).toBe(
      '__Secure-sassy-staging.session_token',
    )
    expect(getBetterAuthCookieName('session_token', false, 'sassy-staging')).toBe(
      'sassy-staging.session_token',
    )
  })
})
