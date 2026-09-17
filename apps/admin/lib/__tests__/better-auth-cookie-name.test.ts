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
})
