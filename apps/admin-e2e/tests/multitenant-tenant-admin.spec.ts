import { test, expect } from '../lib/fixtures'
import { LoginPage } from '../pages/login.page'
import { DEMO_TENANT_USERS } from '../lib/admins'

const RACE_TIMEOUT_MS = 10_000

/**
 * Multi-tenant promotion path — browser-level proof that an org-scoped admin
 * (here: acme-admin@app01.io, holding only `org.users.manage`) lands in the
 * admin shell with their nav pruned to what their permissions allow, and that
 * the Users list is scoped to their own tenant.
 *
 * Grant-ceiling assertions are intentionally NOT exercised here — they're
 * already covered end-to-end through the API by
 * apps/auth-server/test/scenarios/multitenant-grant-ceiling.spec.ts (T22).
 *
 * Requires SEED_DEMO_MULTITENANT=1 to have been applied to the auth-server's
 * database so app01 + Acme/Globex + the six demo users exist.
 */
test.describe('Tenant admin (acme-admin) sees only their own scope', () => {
  test('signs in, lands on /users, sidebar limited to Users, list limited to Acme rows', async ({ page }) => {
    const login = new LoginPage(page)
    await login.goto()
    await login.signIn(DEMO_TENANT_USERS.acmeAdmin.email, DEMO_TENANT_USERS.acmeAdmin.password)

    // acme-admin holds `org.users.manage`, so /users is the only nav target
    // they can reach. The default post-login redirect happens to also be
    // /users — assert we landed there.
    await page.waitForURL(/\/users$/, { timeout: RACE_TIMEOUT_MS })
    await expect(page).toHaveURL(/\/users$/)

    // Sidebar scope — the AdminShell renders nav items based on the caller's
    // permissions (see apps/admin/components/admin-shell.tsx). With only
    // `org.users.manage`, only the Users nav item should appear; Apps, Orgs,
    // Roles, and Permissions must all be absent. Scope the role-based lookup
    // to the sidebar container so page content (e.g. the "Users" page header)
    // can't accidentally satisfy the assertion.
    const sidebar = page.locator('[data-sidebar="content"]')
    await expect(sidebar.getByRole('link', { name: /users/i })).toBeVisible()
    await expect(sidebar.getByRole('link', { name: /^apps$/i })).toHaveCount(0)
    await expect(sidebar.getByRole('link', { name: /^orgs$/i })).toHaveCount(0)
    await expect(sidebar.getByRole('link', { name: /^roles$/i })).toHaveCount(0)
    await expect(sidebar.getByRole('link', { name: /^permissions$/i })).toHaveCount(0)

    // Users list scope — all three Acme rows must be present, and zero
    // Globex rows. The users-table renders the email in a <p> inside each
    // row, so getByText matches the rendered cell content.
    await expect(page.getByText(DEMO_TENANT_USERS.acmeAdmin.email)).toBeVisible()
    await expect(page.getByText(DEMO_TENANT_USERS.acmeAlice.email)).toBeVisible()
    await expect(page.getByText(DEMO_TENANT_USERS.acmeBob.email)).toBeVisible()
    await expect(page.getByText(/globex-/)).toHaveCount(0)
  })
})
