import { expect, type Page } from '@playwright/test'
import { t } from '../lib/i18n'

export class SecurityPage {
  constructor(readonly page: Page) {}

  async goto() {
    await this.page.goto('/account/security')
    await expect(this.page).toHaveURL(/account\/security/, { timeout: 10_000 })
  }

  /**
   * Click "Generate QR code", fill the password input (which is wrapped in a
   * <label> with no htmlFor — SecurityClient.tsx uses a label-wrapping pattern),
   * then click the submit button and wait for the QR/secret step to appear.
   *
   * Returns the base32 secret (from the <code> element) and the backup codes
   * (rendered as <span> elements inside the grid).
   *
   * NEVER log secret or backupCodes — treat as bearer credentials (bug-0163).
   */
  async enable(password: string): Promise<{ secret: string; backupCodes: string[] }> {
    // SecurityClient renders the enable form with a <label> wrapping the <input>
    // and a submit button with text t('security.enable.submitButton') = "Generate QR code".
    // The password input is type="password" name="password".
    await this.page.locator('input[type="password"][name="password"]').fill(password)
    await this.page.getByRole('button', { name: t('security.enable.submitButton') }).click()

    // Wait for the manual-entry <code> element (shows the base32 secret).
    await expect(this.page.locator('code')).toBeVisible({ timeout: 15_000 })

    const secret = (await this.page.locator('code').textContent())?.trim() ?? ''
    if (!secret) throw new Error('TOTP secret not found on page')

    // Backup codes are rendered as <span> elements inside a grid.
    // BackupCodesDisplay in SecurityClient.tsx:
    //   <div className="mb-4 grid grid-cols-2 gap-1 font-mono text-sm">
    //     {codes.map((code) => <span key={code} className="rounded bg-muted px-2 py-1">{code}</span>)}
    //   </div>
    const backupCodeSpans = this.page.locator('.grid.grid-cols-2 span')
    const count = await backupCodeSpans.count()
    const backupCodes: string[] = []
    for (let i = 0; i < count; i++) {
      const code = await backupCodeSpans.nth(i).textContent()
      if (code) backupCodes.push(code.trim())
    }

    return { secret, backupCodes }
  }

  /**
   * Confirm 2FA enrollment with a live TOTP code (after enable() returns).
   * The confirm input is wrapped in a <label> with text t('security.enable.codeLabel').
   * Waits for the enabled status badge to appear.
   */
  async confirmEnable(totpCode: string) {
    // The confirm form has a <label> wrapping the <input type="text" name="code">.
    // Label text is t('security.enable.codeLabel') = "Enter the 6-digit code from your app".
    // The input has name="code" and inputMode="numeric".
    await this.page.locator('input[name="code"][inputmode="numeric"]').fill(totpCode)
    await this.page.getByRole('button', { name: t('security.enable.confirmButton') }).click()
    // Wait for the enabled status. t('security.status.enabled') = "2FA is enabled"
    await expect(
      this.page.getByText(t('security.status.enabled')),
    ).toBeVisible({ timeout: 10_000 })
  }
}
