import { expect, type Page, type Locator } from '@playwright/test'
import { t } from '../lib/i18n'

// Auth-server base URL for the test-only OTP retrieval endpoint.
const AUTH_SERVER = process.env.AUTH_SERVER_URL ?? 'http://localhost:3000'

export class LoginPage {
  readonly page: Page
  readonly emailInput: Locator
  readonly passwordInput: Locator
  readonly submitButton: Locator
  readonly anyErrorMessage: Locator

  constructor(page: Page) {
    this.page = page
    this.emailInput = page.getByLabel(t('login.email'))
    this.passwordInput = page.getByLabel(t('login.password'))
    this.submitButton = page.locator('form').getByRole('button', { name: t('login.submit') })
    // Single error <p> in app/login/page.tsx renders one of three dynamic
    // error keys; selecting by testid avoids coupling to a specific key.
    this.anyErrorMessage = page.getByTestId('login-error')
  }

  async goto() {
    await this.page.goto('/login')
  }

  async signIn(email: string, password: string) {
    await this.emailInput.fill(email)
    await this.passwordInput.fill(password)
    await this.submitButton.click()
  }

  async gotoOtp(next = '') {
    await this.page.goto(next ? `/login/code?next=${encodeURIComponent(next)}` : '/login/code')
  }

  async requestCode(email: string) {
    await this.page.getByLabel(t('login.email')).fill(email)
    await this.page.getByRole('button', { name: t('login.otp.sendCode') }).click()
    // Step 2 renders once the neutral response returns.
    await expect(this.page.getByTestId('otp-sent')).toBeVisible()
  }

  async fetchOtp(email: string): Promise<string> {
    const res = await this.page.request.get(
      // The auth server mounts everything except the RFC 8414 metadata doc under
      // the `/api` global prefix (configure-nest-app.ts), so the controller is
      // reachable at /api/test/last-otp — as `Mapped {/api/test/last-otp, GET}`
      // in its startup log confirms. Without the prefix this is a plain 404.
      `${AUTH_SERVER}/api/test/last-otp?email=${encodeURIComponent(email)}`,
    )
    expect(res.ok(), 'test-only OTP endpoint should return the stored code').toBeTruthy()
    return ((await res.json()) as { otp: string }).otp
  }

  async submitCode(otp: string) {
    await this.page.getByLabel(t('login.otp.codeLabel')).fill(otp)
    await this.page.getByRole('button', { name: t('login.otp.verify') }).click()
  }
}
