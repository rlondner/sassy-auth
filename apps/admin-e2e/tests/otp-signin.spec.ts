import { test, expect } from '../lib/fixtures'
import { LoginPage } from '../pages/login.page'

const ACTIVE_ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 's@sa.io'

const AUTH_SERVER_URL = process.env.AUTH_SERVER_URL ?? 'http://localhost:3000'

test.describe('email-OTP sign-in', () => {
  test('active user signs in with an emailed code', async ({ page }) => {
    const login = new LoginPage(page)
    await login.gotoOtp()
    await login.requestCode(ACTIVE_ADMIN_EMAIL)
    const otp = await login.fetchOtp(ACTIVE_ADMIN_EMAIL)
    await login.submitCode(otp)
    // On success verifyOtp redirects to /users.
    await expect(page).toHaveURL(/\/users/)
  })

  test('a wrong code is rejected', async ({ page }) => {
    const login = new LoginPage(page)
    await login.gotoOtp()
    await login.requestCode(ACTIVE_ADMIN_EMAIL)
    await login.submitCode('000000')
    await expect(page.getByTestId('otp-error')).toBeVisible()
    await expect(page).not.toHaveURL(/\/users/)
  })

  test('no code is issued to a non-active or unknown email', async ({ page }) => {
    const nonExistentEmail = `never-a-user-${Date.now()}@example.com`
    const login = new LoginPage(page)
    await login.gotoOtp()
    await login.requestCode(nonExistentEmail)
    // The neutral UI always advances to the code step, but the sender skips
    // delivery for non-active/unknown emails — assert no code was stored.
    const res = await page.request.get(
      `${AUTH_SERVER_URL}/test/last-otp?email=${encodeURIComponent(nonExistentEmail)}`,
    )
    expect(res.status(), 'no code should be issued to a non-active or unknown email').toBe(404)
  })
})
