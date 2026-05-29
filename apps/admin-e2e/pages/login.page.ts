import type { Page, Locator } from '@playwright/test'
import { t } from '../lib/i18n'

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
}
