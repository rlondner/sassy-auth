import { test, expect } from '../../lib/fixtures'
import { adminFromProject, permittedForArea } from '../../lib/admins'
import { UsersPage } from '../../pages/users.page'
import crypto from 'node:crypto'

function uniqueName(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`
}

test.describe('/users UI matrix', () => {
  test('list renders for permitted admins, blocks for the rest', async ({ page }, info) => {
    const admin = adminFromProject(info.project.name)
    const users = new UsersPage(page)
    await users.goto()
    if (permittedForArea(admin, 'users')) {
      await expect(users.heading).toBeVisible()
    } else {
      const denied = users.accessDenied
        .waitFor({ state: 'visible', timeout: 5_000 })
        .then(() => 'denied' as const)
        .catch(() => null)
      const redirected = page
        .waitForURL(/\/(login|apps|orgs|permissions|roles|403|forbidden)$/, { timeout: 5_000 })
        .then(() => 'redirect' as const)
        .catch(() => null)
      const outcome = await Promise.race([denied, redirected])
      expect(outcome).not.toBeNull()
    }
  })

  test('Create user row appears in table (platform org)', async ({ page }, info) => {
    const admin = adminFromProject(info.project.name)
    test.skip(!permittedForArea(admin, 'users'), 'admin lacks platform.users.manage')
    const users = new UsersPage(page)
    await users.goto()
    const email = `e2e-${uniqueName('u-ui').slice(0, 12)}@example.com`
    await users.createUser({
      firstName: 'E2E',
      lastName: 'UIUser',
      email,
      orgName: 'Platform',
    })
    await expect(users.rowByEmail(email)).toBeVisible()
    await users.deleteUser(email)
  })

  test('Edit user updates the first name', async ({ page }, info) => {
    const admin = adminFromProject(info.project.name)
    test.skip(!permittedForArea(admin, 'users'), 'admin lacks platform.users.manage')
    const users = new UsersPage(page)
    await users.goto()
    const email = `e2e-${uniqueName('u-ui').slice(0, 12)}@example.com`
    await users.createUser({
      firstName: 'Original',
      lastName: 'UIUser',
      email,
      orgName: 'Platform',
    })
    await users.editUser(email, { firstName: 'Renamed' })
    await expect(users.rowByEmail(email)).toContainText('Renamed')
    await users.deleteUser(email)
  })

  test('Delete user removes the row from the table', async ({ page }, info) => {
    const admin = adminFromProject(info.project.name)
    test.skip(!permittedForArea(admin, 'users'), 'admin lacks platform.users.manage')
    const users = new UsersPage(page)
    await users.goto()
    const email = `e2e-${uniqueName('u-ui').slice(0, 12)}@example.com`
    await users.createUser({
      firstName: 'ToDelete',
      lastName: 'UIUser',
      email,
      orgName: 'Platform',
    })
    await users.deleteUser(email)
    await expect(users.rowByEmail(email)).toBeHidden()
  })

  test('Resend invitation succeeds for a pending user', async ({ page }, info) => {
    const admin = adminFromProject(info.project.name)
    test.skip(!permittedForArea(admin, 'users'), 'admin lacks platform.users.manage')
    const users = new UsersPage(page)
    await users.goto()
    const email = `e2e-${uniqueName('u-res').slice(0, 12)}@example.com`
    await users.createUser({
      firstName: 'Resend',
      lastName: 'UIUser',
      email,
      orgName: 'Platform',
    })
    await users.resendInvitation(email)
    await users.deleteUser(email)
  })

  test('Self-row exposes no destructive delete control', async ({ page }, info) => {
    const admin = adminFromProject(info.project.name)
    test.skip(!permittedForArea(admin, 'users'), 'admin lacks platform.users.manage')
    const users = new UsersPage(page)
    await users.goto()
    const row = users.rowByEmail(admin.email)
    await expect(row).toBeVisible()
    const deleteBtn = row.getByRole('button', { name: /delete/i })
    await expect(deleteBtn).toBeHidden({ timeout: 1_000 }).catch(async () => {
      await expect(deleteBtn).toBeDisabled()
    })
  })
})
