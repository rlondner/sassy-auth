import { test, expect } from '../../lib/fixtures'
import { LoginPage } from '../../pages/login.page'
import {
  ADMIN_URL,
  buildValidAuthorizeFlow,
  fetchPlatformApp,
} from '../../lib/oauth-fixtures'

/**
 * Regression: when a browser already has a valid BetterAuth session and
 * lands on /login?next=<authorize URL>, the page must skip the form and
 * redirect straight to `next`. Before the fix, the page rendered the form
 * unconditionally and the user had to re-enter credentials every time the
 * RS initiated a sign-in.
 *
 * These tests rely on the super-admin storageState (chromium-super project),
 * which carries an active BetterAuth session set up by auth-state.setup.ts.
 */
test.describe('/login session reuse (super-admin authed)', () => {
  test('with a valid next= URL, the form is skipped and the browser ends on the RS redirect_uri with a code', async ({
    page,
    request,
  }) => {
    const platformApp = await fetchPlatformApp(request)
    const { authorizeUrl, redirectUri } = buildValidAuthorizeFlow(
      platformApp,
      'pw-state-login-reuse',
    )

    const loginUrl = `${ADMIN_URL}/login?next=${encodeURIComponent(authorizeUrl)}`
    await page.goto(loginUrl)

    const finalUrl = new URL(page.url())
    // The /login page should have detected the session and server-redirected
    // through to the authorize endpoint, which in turn redirected to the
    // platform app's redirect_uri with an authorization code.
    expect(finalUrl.origin).toBe(new URL(redirectUri).origin)
    expect(finalUrl.pathname).toBe('/cb')
    expect(finalUrl.searchParams.get('code'), 'authorization code must be present').toBeTruthy()
    expect(finalUrl.searchParams.get('state')).toBe('pw-state-login-reuse')

    // The login form must NOT have been rendered along the way.
    expect(finalUrl.pathname).not.toBe('/login')
  })

  test('with an off-origin next= URL, the form renders (open-redirect fail-safe)', async ({ page }) => {
    // validateNextUrl rejects any origin not in the auth-server allowlist.
    // An attacker-supplied `next` must NOT cause the session to be silently
    // forwarded off-site.
    const loginUrl = `${ADMIN_URL}/login?next=${encodeURIComponent('https://evil.example.com/steal')}`
    await page.goto(loginUrl)

    await expect(page).toHaveURL(/\/login(\?|$)/)

    const login = new LoginPage(page)
    await expect(login.emailInput).toBeVisible()
    await expect(login.submitButton).toBeVisible()
  })

  test('with no next= param, the form renders for an already-signed-in browser (preserves prior behavior)', async ({ page }) => {
    // The fix targets the RS-initiated re-prompt loop, which always sends
    // a next= param. Visiting /login directly while signed in still renders
    // the form (the alternative — auto-redirecting to /users — is an
    // independent behavior change and out of scope for this regression).
    await page.goto(`${ADMIN_URL}/login`)
    await expect(page).toHaveURL(/\/login(\?|$)/)

    const login = new LoginPage(page)
    await expect(login.emailInput).toBeVisible()
    await expect(login.submitButton).toBeVisible()
  })
})
