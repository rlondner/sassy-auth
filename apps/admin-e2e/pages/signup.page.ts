import { type Page, type Locator } from '@playwright/test'
import { t } from '../lib/i18n'

export interface SignupDetails {
  firstName: string
  lastName: string
  companyName: string
  email: string
  password: string
}

export class SignupPage {
  readonly page: Page
  readonly firstNameInput: Locator
  readonly lastNameInput: Locator
  readonly companyNameInput: Locator
  readonly emailInput: Locator
  readonly passwordInput: Locator
  readonly confirmPasswordInput: Locator
  readonly submitButton: Locator
  readonly errorMessage: Locator
  readonly successMessage: Locator
  readonly continueToLoginLink: Locator
  readonly invalidLinkMessage: Locator

  constructor(page: Page) {
    this.page = page
    this.firstNameInput = page.getByLabel(t('signup.firstName'))
    this.lastNameInput = page.getByLabel(t('signup.lastName'))
    this.companyNameInput = page.getByLabel(t('signup.companyName'))
    this.emailInput = page.getByLabel(t('signup.email'))
    this.passwordInput = page.getByLabel(t('signup.password'), { exact: true })
    this.confirmPasswordInput = page.getByLabel(t('signup.confirmPassword'))
    this.submitButton = page.getByRole('button', { name: t('signup.submit') })
    // Single error <p> renders one of several dynamic error keys; selecting
    // by testid avoids coupling to a specific key (mirrors LoginPage).
    this.errorMessage = page.getByTestId('signup-error')
    this.successMessage = page.getByText(t('signup.success'))
    this.continueToLoginLink = page.getByRole('link', { name: t('signup.continueToLogin') })
    this.invalidLinkMessage = page.getByText(t('signup.invalidLink'))
  }

  async goto(clientId: string, next = '') {
    const params = new URLSearchParams({ client_id: clientId, ...(next && { next }) })
    await this.page.goto(`/signup?${params.toString()}`)
  }

  async gotoWithoutClientId() {
    await this.page.goto('/signup')
  }

  async fillAndSubmit(details: SignupDetails) {
    await this.firstNameInput.fill(details.firstName)
    await this.lastNameInput.fill(details.lastName)
    await this.companyNameInput.fill(details.companyName)
    await this.emailInput.fill(details.email)
    await this.passwordInput.fill(details.password)
    await this.confirmPasswordInput.fill(details.password)
    await this.submitButton.click()
  }
}
