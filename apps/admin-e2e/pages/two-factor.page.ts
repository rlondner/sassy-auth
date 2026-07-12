import { expect, type Page, type Locator } from '@playwright/test'
import { t } from '../lib/i18n'

export class TwoFactorPage {
  readonly page: Page
  // TOTP mode elements.
  // TwoFactorForm.tsx renders: <label htmlFor="totp-code">{t('codeLabel')}</label>
  // and <input id="totp-code" name="code" inputMode="numeric" .../>
  readonly codeInput: Locator
  // Both TOTP and backup forms use t('submit') = "Verify" as the button text.
  readonly submitButton: Locator
  // Error paragraphs have data-testid set in TwoFactorForm.tsx.
  readonly totpError: Locator
  readonly backupError: Locator
  // Mode-switch buttons are plain <button type="button"> elements.
  readonly useBackupCodeLink: Locator
  readonly useTotpLink: Locator
  // Backup mode input: <label htmlFor="backup-code">{t('backupCodeLabel')}</label>
  //                    <input id="backup-code" name="code" .../>
  readonly backupCodeInput: Locator

  constructor(page: Page) {
    this.page = page
    // getByLabel works here because TwoFactorForm uses explicit htmlFor/id pairs.
    this.codeInput = page.getByLabel(t('twoFactor.codeLabel'))
    this.submitButton = page.getByRole('button', { name: t('twoFactor.submit') })
    this.totpError = page.getByTestId('totp-error')
    this.backupError = page.getByTestId('backup-error')
    this.useBackupCodeLink = page.getByRole('button', { name: t('twoFactor.useBackupCode') })
    this.useTotpLink = page.getByRole('button', { name: t('twoFactor.useTotpCode') })
    this.backupCodeInput = page.getByLabel(t('twoFactor.backupCodeLabel'))
  }

  async goto(next = '') {
    await this.page.goto(next ? `/login/two-factor?next=${encodeURIComponent(next)}` : '/login/two-factor')
  }

  async submitTotp(code: string) {
    await this.codeInput.fill(code)
    await this.submitButton.click()
  }

  async switchToBackup() {
    await this.useBackupCodeLink.click()
    await expect(this.backupCodeInput).toBeVisible({ timeout: 5_000 })
  }

  async submitBackupCode(code: string) {
    await this.backupCodeInput.fill(code)
    await this.submitButton.click()
  }
}
