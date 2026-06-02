import type { Page } from '@playwright/test'
import { test, expect } from '../../lib/fixtures'

const NAV_KEYS = ['apps', 'orgs', 'users', 'roles', 'permissions'] as const
type NavKey = (typeof NAV_KEYS)[number]

// SidebarMenuButton renders with `asChild`, so `data-active` is merged onto
// the underlying <a>. We target sidebar links via data-sidebar="menu-button" to
// avoid breadcrumbs which also have role="link". React serializes data-*
// booleans to "true" / "false" strings, so we can assert exact equality.
async function expectActiveNav(page: Page, active: NavKey): Promise<void> {
  for (const key of NAV_KEYS) {
    const link = page.locator(`a[data-sidebar="menu-button"][href="/${key}"]`)
    await expect(link, `nav link for ${key}`).toHaveAttribute(
      'data-active',
      key === active ? 'true' : 'false',
    )
  }
}

// Regression: after signing in as s@sa.io the user lands on /users, but
// navigating directly to /apps or /orgs — or hard-refreshing /users —
// has started redirecting back to /login. This test reproduces all three
// failure modes against a pre-authenticated storageState session. It also
// asserts that the sidebar highlights the nav item for the current route.
test.describe('Admin nav (authed)', () => {
  test('s@sa.io stays signed in and sidebar highlights the active route across all admin pages', async ({ page }) => {
    // /users — initial nav from cold storageState
    await page.goto('/users')
    await expect(page).toHaveURL(/\/users$/)
    await expectActiveNav(page, 'users')

    // /users — hard refresh exercises the server layout's session check
    await page.reload()
    await expect(page).toHaveURL(/\/users$/)
    await expectActiveNav(page, 'users')

    // /apps — direct navigation
    await page.goto('/apps')
    await expect(page).toHaveURL(/\/apps$/)
    await expectActiveNav(page, 'apps')

    // /orgs — direct navigation
    await page.goto('/orgs')
    await expect(page).toHaveURL(/\/orgs$/)
    await expectActiveNav(page, 'orgs')

    // /roles — direct navigation, asserts active state only
    await page.goto('/roles')
    await expect(page).toHaveURL(/\/roles$/)
    await expectActiveNav(page, 'roles')

    // /permissions — direct navigation, same rationale as /roles
    await page.goto('/permissions')
    await expect(page).toHaveURL(/\/permissions$/)
    await expectActiveNav(page, 'permissions')
  })
})
