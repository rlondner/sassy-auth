import { test, expect } from '../../lib/fixtures'
import { adminFromProject, permittedForArea } from '../../lib/admins'
import { PermissionsPage } from '../../pages/permissions.page'
import { AppsPage } from '../../pages/apps.page'
import crypto from 'node:crypto'

function uniqueName(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`
}

// Permission names must be lowercase, dotted, with each segment starting with
// a letter. crypto.randomUUID() slices can begin with a digit, so lead the
// random segment with a letter to keep the generated name valid.
function permName(kind: string): string {
  return `e2e.perm.${kind}.x${crypto.randomUUID().slice(0, 8)}`
}

async function makeTempApp(page: import('@playwright/test').Page): Promise<string> {
  const apps = new AppsPage(page)
  await apps.goto()
  const name = uniqueName('e2e-app-for-perm')
  await apps.createApp({ name, url: `https://example.com/${name}` })
  return name
}

test.describe('/permissions UI matrix', () => {
  test('list renders for permitted admins, blocks for the rest', async ({ page }, info) => {
    const admin = adminFromProject(info.project.name)
    const perms = new PermissionsPage(page)
    await perms.goto()
    if (permittedForArea(admin, 'permissions')) {
      await expect(perms.heading).toBeVisible()
    } else {
      const denied = perms.accessDenied
        .waitFor({ state: 'visible', timeout: 5_000 })
        .then(() => 'denied' as const)
        .catch(() => null)
      const redirected = page
        .waitForURL(/\/(login|users|apps|orgs|roles|403|forbidden)$/, { timeout: 5_000 })
        .then(() => 'redirect' as const)
        .catch(() => null)
      const outcome = await Promise.race([denied, redirected])
      expect(outcome).not.toBeNull()
    }
  })

  test('Create row appears in table', async ({ page }, info) => {
    const admin = adminFromProject(info.project.name)
    test.skip(!permittedForArea(admin, 'permissions'), 'admin lacks platform.permissions.manage')
    test.skip(admin.key !== 'super' && admin.key !== 'perms', 'requires super or perms admin')
    const appName = await makeTempApp(page)
    const perms = new PermissionsPage(page)
    await perms.goto()
    const name = permName('ui')
    await perms.createPermission({ name, appName })
    await expect(perms.rowByName(name)).toBeVisible()
    await perms.deletePermission(name)
    const apps = new AppsPage(page)
    await apps.goto()
    await apps.deleteApp(appName)
  })

  test('Edit row updates the name', async ({ page }, info) => {
    const admin = adminFromProject(info.project.name)
    test.skip(!permittedForArea(admin, 'permissions'), 'admin lacks platform.permissions.manage')
    test.skip(admin.key !== 'super' && admin.key !== 'perms', 'requires super or perms admin')
    const appName = await makeTempApp(page)
    const perms = new PermissionsPage(page)
    await perms.goto()
    const name = permName('ui')
    await perms.createPermission({ name, appName })
    const renamed = permName('ren')
    await perms.editPermission(name, { name: renamed })
    await expect(perms.rowByName(renamed)).toBeVisible()
    await perms.deletePermission(renamed)
    const apps = new AppsPage(page)
    await apps.goto()
    await apps.deleteApp(appName)
  })

  test('Delete row removes it from the table', async ({ page }, info) => {
    const admin = adminFromProject(info.project.name)
    test.skip(!permittedForArea(admin, 'permissions'), 'admin lacks platform.permissions.manage')
    test.skip(admin.key !== 'super' && admin.key !== 'perms', 'requires super or perms admin')
    const appName = await makeTempApp(page)
    const perms = new PermissionsPage(page)
    await perms.goto()
    const name = permName('ui')
    await perms.createPermission({ name, appName })
    await perms.deletePermission(name)
    await expect(perms.rowByName(name)).toBeHidden()
    const apps = new AppsPage(page)
    await apps.goto()
    await apps.deleteApp(appName)
  })

  test('Seeded platform.* permission row exposes no destructive controls', async ({ page }, info) => {
    const admin = adminFromProject(info.project.name)
    test.skip(!permittedForArea(admin, 'permissions'), 'admin lacks platform.permissions.manage')
    const perms = new PermissionsPage(page)
    await perms.goto()
    // Row containing 'platform.apps.manage' should not expose a working delete.
    const row = page.getByRole('row', { name: /platform\.apps\.manage/ })
    await expect(row).toBeVisible()
    const deleteBtn = row.getByRole('button', { name: /delete/i })
    await expect(deleteBtn).toBeHidden({ timeout: 1_000 }).catch(async () => {
      await expect(deleteBtn).toBeDisabled()
    })
  })
})
