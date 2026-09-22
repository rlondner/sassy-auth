import { expect, type Page, type Locator } from '@playwright/test'
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
  readonly checkEmailTitle: Locator
  readonly resendButton: Locator
  readonly backToLoginLink: Locator
  readonly invalidLinkMessage: Locator
  readonly privacyPolicyCheckbox: Locator
  readonly termsCheckbox: Locator

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
    // Signup success navigates to /signup/check-email rather than rendering
    // inline — see signup-form.tsx.
    this.checkEmailTitle = page.getByText(t('signup.checkEmail.title'))
    this.resendButton = page.getByRole('button', { name: t('signup.checkEmail.resendButton') })
    this.backToLoginLink = page.getByRole('link', { name: t('signup.checkEmail.backToLogin') })
    this.invalidLinkMessage = page.getByText(t('signup.invalidLink'))
    this.privacyPolicyCheckbox = page.getByRole('checkbox', { name: /Privacy Policy/i })
    this.termsCheckbox = page.getByRole('checkbox', { name: /Terms and Conditions/i })
  }

  async goto(clientId: string, next = '') {
    const params = new URLSearchParams({ client_id: clientId, ...(next && { next }) })
    await this.page.goto(`/signup?${params.toString()}`)
  }

  async gotoWithoutClientId() {
    await this.page.goto('/signup')
  }

  async fillAndSubmit(details: SignupDetails, options: { acceptConsent?: boolean } = {}) {
    await this.firstNameInput.fill(details.firstName)
    await this.lastNameInput.fill(details.lastName)
    await this.companyNameInput.fill(details.companyName)
    await this.emailInput.fill(details.email)
    await this.passwordInput.fill(details.password)
    await this.confirmPasswordInput.fill(details.password)
    if (options.acceptConsent) {
      await this.privacyPolicyCheckbox.check()
      await this.termsCheckbox.check()
    }
    // The Turnstile widget (signup-form.tsx) loads Cloudflare's script and
    // solves the (always-pass, in CI) challenge asynchronously — the submit
    // button isn't gated on it, so clicking immediately after filling the
    // form races the widget: handleSubmit sees captchaToken still null and
    // bails out client-side before any network request. Cloudflare injects
    // a hidden `cf-turnstile-response` input into the widget's container
    // once solved; wait for it to carry a real token first.
    await expect
      .poll(() => this.page.locator('input[name="cf-turnstile-response"]').first().inputValue())
      .not.toBe('')
    await this.submitButton.click()
  }
}
