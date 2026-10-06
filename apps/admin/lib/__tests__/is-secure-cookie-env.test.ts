import { isSecureCookieEnv } from '@sassy-auth/types'

// Regression test for the e2e outage this traces to: `next build` inlines
// every `process.env.NODE_ENV` reference as the literal 'production' for
// any non-dev build, regardless of the actual NODE_ENV the build ran
// under. apps/admin used to derive its BetterAuth cookie-naming check
// straight from `process.env.NODE_ENV === 'production'`, so a CI/e2e admin
// build (NODE_ENV=test) still compiled that check to `true` while
// auth-server (plain runtime read, no build-time inlining) correctly
// computed `false` — admin expected `__Secure-better-auth.session_token`,
// auth-server set the unprefixed name, and every e2e sign-in failed.
// isSecureCookieEnv's COOKIE_SECURE override exists precisely so a
// non-production environment can force the unprefixed name without
// depending on NODE_ENV's value surviving the admin build.
describe('isSecureCookieEnv', () => {
  const ORIGINAL_ENV = { ...process.env }

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it('falls back to NODE_ENV=production when COOKIE_SECURE is unset', () => {
    delete process.env.COOKIE_SECURE
    Object.assign(process.env, { NODE_ENV: 'production' })
    expect(isSecureCookieEnv()).toBe(true)
  })

  it('falls back to false outside production when COOKIE_SECURE is unset', () => {
    delete process.env.COOKIE_SECURE
    Object.assign(process.env, { NODE_ENV: 'test' })
    expect(isSecureCookieEnv()).toBe(false)
  })

  it('COOKIE_SECURE=false wins even when NODE_ENV=production', () => {
    process.env.COOKIE_SECURE = 'false'
    Object.assign(process.env, { NODE_ENV: 'production' })
    expect(isSecureCookieEnv()).toBe(false)
  })

  it('COOKIE_SECURE=true wins even when NODE_ENV is not production', () => {
    process.env.COOKIE_SECURE = 'true'
    Object.assign(process.env, { NODE_ENV: 'test' })
    expect(isSecureCookieEnv()).toBe(true)
  })
})
