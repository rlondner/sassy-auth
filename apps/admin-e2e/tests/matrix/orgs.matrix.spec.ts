import { test, expect } from '../../lib/fixtures'
import { adminFromProject, permittedForArea } from '../../lib/admins'
import { OrgsPage } from '../../pages/orgs.page'
import { AppsPage } from '../../pages/apps.page'
import crypto from 'node:crypto'

function uniqueName(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`
}

/** Returns a temp app's name. Requires super admin to have created it via UI. */
async function makeTempApp(page: import('@playwright/test').Page): Promise<string> {
  const apps = new AppsPage(page)
  await apps.goto()
  const name = uniqueName('e2e-app-for-org')
  await apps.createApp({ name, url: `https://example.com/${name}` })
  return name
}

test.describe('/orgs UI matrix', () => {
  test('list renders for permitted admins, blocks for the rest', async ({ page }, info) => {
    const admin = adminFromProject(info.project.name)
    const orgs = new OrgsPage(page)
    await orgs.goto()
    if (permittedForArea(admin, 'orgs')) {
      await expect(orgs.heading).toBeVisible()
    } else {
      const denied = orgs.accessDenied
        .waitFor({ state: 'visible', timeout: 5_000 })
        .then(() => 'denied' as const)
        .catch(() => null)
      const redirected = page
        .waitForURL(/\/(login|users|apps|permissions|roles|403|forbidden)$/, { timeout: 5_000 })
        .then(() => 'redirect' as const)
        .catch(() => null)
      const outcome = await Promise.race([denied, redirected])
      expect(outcome).not.toBeNull()
    }
  })

  test('Create row appears in table', async ({ page }, info) => {
    const admin = adminFromProject(info.project.name)
    test.skip(!permittedForArea(admin, 'orgs'), 'admin lacks platform.orgs.manage')
    // Orgs need a non-platform app; super-admin only path creates one upstream.
    test.skip(admin.key !== 'super', 'CRUD needs a prerequisite app (apps.manage); only super qualifies')
    const appName = await makeTempApp(page)
    const orgs = new OrgsPage(page)
    await orgs.goto()
    const name = uniqueName('e2e-org-ui')
    await orgs.createOrg({ name, appName })
    await expect(orgs.rowByName(name)).toBeVisible()
    await orgs.deleteOrg(name)
    // Clean up the app via the apps page
    const apps = new AppsPage(page)
    await apps.goto()
    await apps.deleteApp(appName)
  })

  test('Edit row updates the name', async ({ page }, info) => {
    const admin = adminFromProject(info.project.name)
    test.skip(!permittedForArea(admin, 'orgs'), 'admin lacks platform.orgs.manage')
    test.skip(admin.key !== 'super', 'CRUD needs a prerequisite app (apps.manage); only super qualifies')
    const appName = await makeTempApp(page)
    const orgs = new OrgsPage(page)
    await orgs.goto()
    const name = uniqueName('e2e-org-ui')
    await orgs.createOrg({ name, appName })
    const renamed = uniqueName('e2e-org-ren')
    await orgs.editOrg(name, { name: renamed })
    await expect(orgs.rowByName(renamed)).toBeVisible()
    await orgs.deleteOrg(renamed)
    const apps = new AppsPage(page)
    await apps.goto()
    await apps.deleteApp(appName)
  })

  test('Delete row removes it from the table', async ({ page }, info) => {
    const admin = adminFromProject(info.project.name)
    test.skip(!permittedForArea(admin, 'orgs'), 'admin lacks platform.orgs.manage')
    test.skip(admin.key !== 'super', 'CRUD needs a prerequisite app (apps.manage); only super qualifies')
    const appName = await makeTempApp(page)
    const orgs = new OrgsPage(page)
    await orgs.goto()
    const name = uniqueName('e2e-org-ui')
    await orgs.createOrg({ name, appName })
    await orgs.deleteOrg(name)
    await expect(orgs.rowByName(name)).toBeHidden()
    const apps = new AppsPage(page)
    await apps.goto()
    await apps.deleteApp(appName)
  })
})
