import { test, expect } from '../../lib/fixtures'
import { adminFromProject, permittedForArea } from '../../lib/admins'
import { AppsPage } from '../../pages/apps.page'
import crypto from 'node:crypto'

function uniqueName(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`
}

test.describe('/apps UI matrix', () => {
  test('list renders for permitted admins, blocks for the rest', async ({ page }, info) => {
    const admin = adminFromProject(info.project.name)
    const apps = new AppsPage(page)
    await apps.goto()
    if (permittedForArea(admin, 'apps')) {
      await expect(apps.heading).toBeVisible()
    } else {
      const denied = apps.accessDenied
        .waitFor({ state: 'visible', timeout: 5_000 })
        .then(() => 'denied' as const)
        .catch(() => null)
      const redirected = page
        .waitForURL(/\/(login|users|orgs|permissions|roles|403|forbidden)$/, { timeout: 5_000 })
        .then(() => 'redirect' as const)
        .catch(() => null)
      const outcome = await Promise.race([denied, redirected])
      expect(outcome).not.toBeNull()
    }
  })

  test('Create row appears in table', async ({ page }, info) => {
    const admin = adminFromProject(info.project.name)
    test.skip(!permittedForArea(admin, 'apps'), 'admin lacks platform.apps.manage')
    const apps = new AppsPage(page)
    await apps.goto()
    const name = uniqueName('e2e-app-ui')
    await apps.createApp({ name, url: `https://example.com/${name}` })
    await expect(apps.rowByName(name)).toBeVisible()
    await apps.deleteApp(name)
  })

  test('Edit row updates the name', async ({ page }, info) => {
    const admin = adminFromProject(info.project.name)
    test.skip(!permittedForArea(admin, 'apps'), 'admin lacks platform.apps.manage')
    const apps = new AppsPage(page)
    await apps.goto()
    const name = uniqueName('e2e-app-ui')
    await apps.createApp({ name, url: `https://example.com/${name}` })
    const renamed = uniqueName('e2e-app-ren')
    await apps.editApp(name, { name: renamed })
    await expect(apps.rowByName(renamed)).toBeVisible()
    await apps.deleteApp(renamed)
  })

  test('Delete row removes it from the table', async ({ page }, info) => {
    const admin = adminFromProject(info.project.name)
    test.skip(!permittedForArea(admin, 'apps'), 'admin lacks platform.apps.manage')
    const apps = new AppsPage(page)
    await apps.goto()
    const name = uniqueName('e2e-app-ui')
    await apps.createApp({ name, url: `https://example.com/${name}` })
    await apps.deleteApp(name)
    await expect(apps.rowByName(name)).toBeHidden()
  })

  test('Platform app row exposes no destructive controls', async ({ page }, info) => {
    const admin = adminFromProject(info.project.name)
    test.skip(!permittedForArea(admin, 'apps'), 'admin lacks platform.apps.manage')
    const apps = new AppsPage(page)
    await apps.goto()
    const row = page.getByRole('row', { name: /SassyAuth/ })
    await expect(row).toBeVisible()
    // The UI should hide or disable destructive actions on the platform row.
    // If it shows them and they're clickable, this test fails — file as bug.
    const deleteBtn = row.getByRole('button', { name: /delete/i })
    await expect(deleteBtn).toBeHidden({ timeout: 1_000 }).catch(async () => {
      await expect(deleteBtn).toBeDisabled()
    })
  })
})
