import { test, expect } from '../lib/fixtures'
import { t } from '../lib/i18n'

test.describe('User-initiated password reset', () => {
  test('/forgot-password shows a neutral confirmation', async ({ page }) => {
    await page.goto('/forgot-password')
    await page.getByLabel(t('forgotPassword.email')).fill('s@sa.io')
    await page.getByRole('button', { name: t('forgotPassword.submit') }).click()
    await expect(page.getByTestId('forgot-sent')).toBeVisible()
  })

  test('/reset-password with no token shows the invalid-link message', async ({ page }) => {
    await page.goto('/reset-password')
    await expect(page.getByText(t('resetPassword.invalidToken'))).toBeVisible()
  })
})
