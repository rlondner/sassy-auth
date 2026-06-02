import { test, expect } from '../../lib/fixtures'
import { t } from '../../lib/i18n'

// Companion to the API e2e test in apps/auth-server/test/app.e2e-spec.ts
// (describe: "Lifecycle: provision app+perm+org+role+user..."). This drives
// the same flow through the admin UI: provision app → permission → org →
// role with that permission → user assigned to that role+org, then complete
// the invite flow and prove the new user can sign in with Pass@word1234.
// Runs under the chromium-super storage state. Entities are timestamp-named
// so re-runs do not collide; cleanup is skipped on purpose to keep the
// spec independent of any UI delete-while-signed-in-as-new-user gymnastics.

// Key UI conventions exercised here:
//   - admin pages render a breadcrumb-only PageHeader (no <h1>), so the
//     page-level Create button serves as the readiness signal.
//   - every create-drawer's submit button reuses {area}.drawer.createTitle
//     for its label — the same string as the page-level Create button — so
//     submit clicks MUST be scoped to the role="dialog" Sheet container.
//   - none of the create drawers show a toast on success; the drawer closes
//     silently (apps/orgs/permissions/roles) or transitions into a success
//     panel that surfaces the invite URL (users).

test.describe('Lifecycle (authed) — provision + accept invite + sign-in', () => {
  test('super admin can provision the full chain and the new user can sign in', async ({ page }) => {
    test.setTimeout(120_000)
    const ts = Date.now()
    const SUFFIX = `e2e-${ts}`
    const APP_NAME = `Lifecycle App ${SUFFIX}`
    const APP_URL = 'https://example.com/lifecycle'
    // Permission DTO regex: dotted lowercase segments where every segment
    // after the first starts with a letter, hence the `t<digits>` prefix.
    const PERM_NAME = `e2e.t${ts}.read`
    const ORG_NAME = `Lifecycle Org ${SUFFIX}`
    const ROLE_NAME = `Lifecycle Role ${SUFFIX}`
    const USER_EMAIL = `lifecycle-${ts}@example.com`
    const USER_FIRST = 'Lifecycle'
    const USER_LAST = 'E2E'
    const USER_PASSWORD = 'Pass@word1234'

    // 1. Create the app ────────────────────────────────────────────────
    await page.goto('/apps')
    await expect(page.getByRole('button', { name: t('apps.create') })).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: t('apps.create') }).click()
    {
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      await dialog.getByLabel(t('apps.fields.name')).fill(APP_NAME)
      await dialog.getByLabel(t('apps.fields.url')).fill(APP_URL)
      await dialog.getByRole('button', { name: t('apps.drawer.createTitle') }).click()
      await expectDialogClosedOrSurfaceError(dialog)
    }

    // 2. Create a permission scoped to the new app ─────────────────────
    await page.goto('/permissions')
    await expect(page.getByRole('button', { name: t('permissions.create') })).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: t('permissions.create') }).click()
    {
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      await dialog.getByLabel(t('permissions.fields.name')).fill(PERM_NAME)
      // App selector is a native <select> in this drawer.
      await dialog.getByLabel(t('permissions.fields.app')).selectOption({ label: APP_NAME })
      await dialog.getByRole('button', { name: t('permissions.drawer.createTitle') }).click()
      await expectDialogClosedOrSurfaceError(dialog)
    }

    // 3. Create an org scoped to the new app ───────────────────────────
    await page.goto('/orgs')
    await expect(page.getByRole('button', { name: t('orgs.create') })).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: t('orgs.create') }).click()
    {
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      await dialog.getByLabel(t('orgs.fields.name')).fill(ORG_NAME)
      // App selector is a native <select> in this drawer.
      await dialog.getByLabel(t('orgs.fields.app')).selectOption({ label: APP_NAME })
      await dialog.getByRole('button', { name: t('orgs.drawer.createTitle') }).click()
      await expectDialogClosedOrSurfaceError(dialog)
    }

    // 4. Create a role bundling the new permission ─────────────────────
    // The role-create drawer renders app + permission rows as native
    // <select>s, so selectOption({ label }) is the right Playwright API.
    await page.goto('/roles')
    await expect(page.getByRole('button', { name: t('roles.create') })).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: t('roles.create') }).click()
    {
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      await dialog.getByLabel(t('roles.fields.app')).selectOption({ label: APP_NAME })
      await dialog.getByLabel(t('roles.fields.name')).fill(ROLE_NAME)
      await dialog.getByRole('button', { name: t('roles.fields.addPermission') }).click()
      // The drawer renders one <select aria-label="Permission"> per row; scope
      // to the first row's select so the assertion is robust even if a future
      // change adds a duplicate-labeled element to the section.
      await dialog.getByLabel(t('roles.fields.permissionRow')).first().selectOption({ label: PERM_NAME })
      await dialog.getByRole('button', { name: t('roles.drawer.createTitle') }).click()
      await expectDialogClosedOrSurfaceError(dialog)
    }

    // 5. Create the user in the new org with the new role ──────────────
    // User create drawer differs: on success it transitions into a success
    // panel that surfaces the invite URL — the dialog stays open. Assert
    // the success-panel headline before reading the invite input.
    await page.goto('/users')
    await expect(page.getByRole('button', { name: t('users.create') })).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: t('users.create') }).click()
    let inviteUrl: string
    {
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      await dialog.getByLabel(t('users.fields.firstName')).fill(USER_FIRST)
      await dialog.getByLabel(t('users.fields.lastName')).fill(USER_LAST)
      await dialog.getByLabel(t('users.fields.email')).fill(USER_EMAIL)
      // Org + Role are Radix <Select>s whose <label> is NOT bound via
      // htmlFor / aria-labelledby, so getByLabel can't reach the combobox.
      // Disambiguate by anchored placeholder text — note "Select org" is a
      // substring of the role trigger's "Select org first" disabled state,
      // so we anchor both with /^…$/.
      const orgTrigger = dialog.locator('button[role="combobox"]', { hasText: /^Select org$/ })
      await orgTrigger.click()
      await page.getByRole('option', { name: ORG_NAME }).click()
      const roleTrigger = dialog.locator('button[role="combobox"]', { hasText: /^Select role$/ })
      await expect(roleTrigger).toBeEnabled({ timeout: 10_000 })
      await roleTrigger.click()
      await page.getByRole('option', { name: ROLE_NAME }).click()
      await dialog.getByRole('button', { name: t('users.drawer.create') }).click()

      // 6. Capture the invite URL surfaced in the success state ────────
      await expect(dialog.getByText(t('users.drawer.inviteCreated'))).toBeVisible({ timeout: 10_000 })
      const inviteInput = dialog.locator('input[readonly]').first()
      inviteUrl = await inviteInput.inputValue()
      expect(inviteUrl).toMatch(/\/accept-invite\?token=/)
    }

    // 7. Accept the invitation as the brand-new user ───────────────────
    await page.goto(inviteUrl)
    // "Password" is a substring of "Confirm Password" so use exact match.
    await page.getByLabel(t('acceptInvite.password'), { exact: true }).fill(USER_PASSWORD)
    await page.getByLabel(t('acceptInvite.confirmPassword'), { exact: true }).fill(USER_PASSWORD)
    await page.getByRole('button', { name: t('acceptInvite.submit') }).click()
    await expect(page.getByText(t('acceptInvite.success'))).toBeVisible({ timeout: 10_000 })
    // accept-invite-form.tsx auto-redirects to /login after 2s.
    await page.waitForURL(/\/login(\?|$)/, { timeout: 10_000 })

    // 8. Sign in as the new user — the regression we're guarding ───────
    // Pre-fix this 500ed because acceptInvitation wrote a bcrypt hash that
    // BetterAuth's scrypt verifier couldn't decode. Now the same Set Password
    // path stores a scrypt hash and email sign-in succeeds.
    await page.getByLabel(t('login.email')).fill(USER_EMAIL)
    await page.getByLabel(t('login.password')).fill(USER_PASSWORD)
    await page.locator('form').getByRole('button', { name: t('login.submit') }).click()

    // The new user has only e2e.t<ts>.read — they should NOT remain on
    // /login (sign-in succeeded) and the login form should not surface
    // an error.
    const errorPromise = page
      .getByTestId('login-error')
      .waitFor({ state: 'visible', timeout: 10_000 })
      .then(() => 'error' as const)
      .catch(() => null)
    const successPromise = page
      .waitForURL((url) => !/\/login(\?|$)/.test(url.pathname), { timeout: 10_000 })
      .then(() => 'success' as const)
      .catch(() => null)
    const outcome = await Promise.race([errorPromise, successPromise])
    if (outcome === 'error') {
      const msg = (await page.getByTestId('login-error').textContent())?.trim() ?? '<unknown>'
      throw new Error(`Sign-in failed for invited user — login form rendered "${msg}"`)
    }
    expect(outcome).toBe('success')

    // Cookie-level sanity check: better-auth.session_token must be set on
    // this context now, with a non-empty value bound to the admin origin.
    const cookies = await page.context().cookies()
    const sessionCookie = cookies.find((c) => c.name === 'better-auth.session_token')
    expect(sessionCookie?.value).toBeTruthy()
  })
})

// The four "simple" create drawers (apps, permissions, orgs, roles) close
// themselves on success. On validation failure they surface an inline
// <p role="alert"> inside the dialog. Race the two so a server-side error
// becomes the test's failure reason instead of a generic timeout.
async function expectDialogClosedOrSurfaceError(dialog: import('@playwright/test').Locator) {
  const closedPromise = dialog
    .waitFor({ state: 'hidden', timeout: 15_000 })
    .then(() => 'closed' as const)
    .catch(() => null)
  const errorPromise = dialog
    .getByRole('alert')
    .waitFor({ state: 'visible', timeout: 15_000 })
    .then(() => 'error' as const)
    .catch(() => null)
  const outcome = await Promise.race([closedPromise, errorPromise])
  if (outcome === 'error') {
    const text = (await dialog.getByRole('alert').textContent())?.trim() ?? '<unknown>'
    throw new Error(`Drawer surfaced an error instead of closing: "${text}"`)
  }
  if (outcome !== 'closed') {
    throw new Error('Drawer neither closed nor surfaced an error within timeout')
  }
}
