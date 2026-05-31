import { test, expect } from '../../lib/fixtures'
import { t } from '../../lib/i18n'

// Regression: after signing in as s@sa.io the user lands on /users, but
// navigating directly to /apps or /orgs — or hard-refreshing /users —
// has started redirecting back to /login. This test reproduces all three
// failure modes against a pre-authenticated storageState session.
test.describe('Admin nav (authed)', () => {
  test('s@sa.io stays signed in across /users, refresh, /apps, /orgs', async ({ page }) => {
    // /users — initial nav from cold storageState
    await page.goto('/users')
    await expect(page).toHaveURL(/\/users$/)
    await expect(page.getByRole('heading', { name: t('users.title'), exact: true })).toBeVisible()

    // /users — hard refresh exercises the server layout's session check
    await page.reload()
    await expect(page).toHaveURL(/\/users$/)
    await expect(page.getByRole('heading', { name: t('users.title'), exact: true })).toBeVisible()

    // /apps — direct navigation
    await page.goto('/apps')
    await expect(page).toHaveURL(/\/apps$/)
    await expect(
      page.getByRole('heading', { name: new RegExp(`^${escapeRe(t('apps.title'))}\\b`) }),
    ).toBeVisible()

    // /orgs — direct navigation
    await page.goto('/orgs')
    await expect(page).toHaveURL(/\/orgs$/)
    await expect(
      page.getByRole('heading', { name: new RegExp(`^${escapeRe(t('orgs.title'))}\\b`) }),
    ).toBeVisible()
  })
})

// Apps/Orgs h1 includes a trailing "{count} Total" badge in its accessible
// name, so we anchor on the localized title prefix instead of exact match.
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
