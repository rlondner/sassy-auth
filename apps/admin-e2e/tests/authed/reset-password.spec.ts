import { test, expect } from '../../lib/fixtures'
import { t } from '../../lib/i18n'
import { UsersPage } from '../../pages/users.page'

test.describe('Admin password reset', () => {
  test('reset action surfaces a copy-link dialog for an active user', async ({ page }) => {
    const users = new UsersPage(page)
    await users.goto()
    // s@sa.io (super admin) is active and has a credential account.
    await users.search('s@sa.io')
    await users.rowByEmail('s@sa.io').locator('[aria-haspopup="menu"]').click()
    await page.getByRole('menuitem', { name: t('users.actions.resetPassword') }).click()
    // The share-link dialog exposes the reset URL in a readonly field.
    const link = page.getByRole('textbox', { name: t('users.drawer.resetLinkTitle') })
    await expect(link).toBeVisible()
    await expect(link).toHaveValue(/\/reset-password\?token=/)
  })
})
