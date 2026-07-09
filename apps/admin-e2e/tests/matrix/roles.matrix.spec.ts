import { test, expect } from '../../lib/fixtures'
import { adminFromProject, permittedForArea } from '../../lib/admins'
import { RolesPage } from '../../pages/roles.page'
import { AppsPage } from '../../pages/apps.page'
import crypto from 'node:crypto'

function uniqueName(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`
}

async function makeTempApp(page: import('@playwright/test').Page): Promise<string> {
  const apps = new AppsPage(page)
  await apps.goto()
  const name = uniqueName('e2e-app-for-role')
  await apps.createApp({ name, url: `https://example.com/${name}` })
  return name
}

test.describe('/roles UI matrix', () => {
  test('list renders for permitted admins, blocks for the rest', async ({ page }, info) => {
    const admin = adminFromProject(info.project.name)
    const roles = new RolesPage(page)
    await roles.goto()
    if (permittedForArea(admin, 'roles')) {
      await expect(roles.heading).toBeVisible()
    } else {
      const denied = roles.accessDenied
        .waitFor({ state: 'visible', timeout: 5_000 })
        .then(() => 'denied' as const)
        .catch(() => null)
      const redirected = page
        .waitForURL(/\/(login|users|apps|orgs|permissions| 403|forbidden)$/, { timeout: 5_000 })
        .then(() => 'redirect' as const)
        .catch(() => null)
      const outcome = await Promise.race([denied, redirected])
      expect(outcome).not.toBeNull()
    }
  })

  test('Create row appears in table', async ({ page }, info) => {
    const admin = adminFromProject(info.project.name)
    test.skip(!permittedForArea(admin, 'roles'), 'admin lacks platform.permissions.manage')
    test.skip(admin.key !== 'super', 'CRUD needs a prerequisite app (apps.manage); only super qualifies')
    const appName = await makeTempApp(page)
    const roles = new RolesPage(page)
    await roles.goto()
    const name = uniqueName('e2e-role-ui')
    await roles.createRole({ name, appName })
    await expect(roles.rowByName(name)).toBeVisible()
    await roles.deleteRole(name)
    const apps = new AppsPage(page)
    await apps.goto()
    await apps.deleteApp(appName)
  })

  test('Edit row updates the name', async ({ page }, info) => {
    const admin = adminFromProject(info.project.name)
    test.skip(!permittedForArea(admin, 'roles'), 'admin lacks platform.permissions.manage')
    test.skip(admin.key !== 'super', 'CRUD needs a prerequisite app (apps.manage); only super qualifies')
    const appName = await makeTempApp(page)
    const roles = new RolesPage(page)
    await roles.goto()
    const name = uniqueName('e2e-role-ui')
    await roles.createRole({ name, appName })
    const renamed = uniqueName('e2e-role-ren')
    await roles.editRole(name, { name: renamed })
    await expect(roles.rowByName(renamed)).toBeVisible()
    await roles.deleteRole(renamed)
    const apps = new AppsPage(page)
    await apps.goto()
    await apps.deleteApp(appName)
  })

  test('Delete row removes it from the table', async ({ page }, info) => {
    const admin = adminFromProject(info.project.name)
    test.skip(!permittedForArea(admin, 'roles'), 'admin lacks platform.permissions.manage')
    test.skip(admin.key !== 'super', 'CRUD needs a prerequisite app (apps.manage); only super qualifies')
    const appName = await makeTempApp(page)
    const roles = new RolesPage(page)
    await roles.goto()
    const name = uniqueName('e2e-role-ui')
    await roles.createRole({ name, appName })
    await roles.deleteRole(name)
    await expect(roles.rowByName(name)).toBeHidden()
    const apps = new AppsPage(page)
    await apps.goto()
    await apps.deleteApp(appName)
  })
})
