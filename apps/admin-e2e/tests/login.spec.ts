import { test, expect } from '../lib/fixtures'
import { LoginPage } from '../pages/login.page'

const SUPER_ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 's@sa.io'
const SUPER_ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'Pass@word1234'
const RACE_TIMEOUT_MS = 10_000

test.describe('Login', () => {
  test('s@sa.io signs in from /login and is redirected to /users', async ({ page }) => {
    const login = new LoginPage(page)
    await login.goto()
    await expect(page).toHaveURL(/\/login$/)

    await login.signIn(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD)

    // Race success-URL vs. visible-error so a UI error becomes the failure reason.
    const errorPromise = login.anyErrorMessage
      .waitFor({ state: 'visible', timeout: RACE_TIMEOUT_MS })
      .then(() => 'error' as const)
      .catch(() => null)
    // A successful sign-in on a freshly seeded database lands on the optional
    // 2FA interstitial before the destination, so accept either here — racing
    // only on /users would treat the prompt as "no outcome" and fall through to
    // a bare toHaveURL failure that says nothing about why.
    const successPromise = page
      .waitForURL(/(\/users$|\/login\/two-factor-prompt)/, { timeout: RACE_TIMEOUT_MS })
      .then(() => 'success' as const)
      .catch(() => null)

    const outcome = await Promise.race([errorPromise, successPromise])

    if (outcome === 'error') {
      const renderedErrorText =
        (await login.anyErrorMessage.textContent())?.trim() ?? '<unknown>'
      throw new Error(
        `Login flow rendered an error to the user instead of redirecting: "${renderedErrorText}". ` +
          `See attached console.log, page-errors.log, network.log, page-snapshot.html, and visible-page-text.txt for full context.`,
      )
    }

    // "Skip for now" is the path a real operator takes; it records the prompt so
    // it does not recur. Safe to consume here — the only spec that depends on an
    // un-prompted account (two-factor.spec.ts:388) uses o@sa.io, not s@sa.io.
    if (page.url().includes('/login/two-factor-prompt')) {
      await page.getByRole('button', { name: /skip for now/i }).click()
    }

    await expect(page).toHaveURL(/\/users$/)
  })
})
