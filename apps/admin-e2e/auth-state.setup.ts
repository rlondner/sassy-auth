import { test as setup, expect } from '@playwright/test'
import path from 'path'
import { LoginPage } from './pages/login.page'
import { SEED_ADMINS, ADMIN_PASSWORD } from './lib/admins'

for (const admin of SEED_ADMINS) {
  setup(`authenticate as ${admin.email}`, async ({ page, context }) => {
    const login = new LoginPage(page)
    await login.goto()
    await login.signIn(admin.email, ADMIN_PASSWORD)
    // All 5 seeded admins land on /users post-login (their initial landing
    // page is whatever their nav allows first; /users redirect happens
    // because the admin landing layout picks /users as a default).
    // If a future change makes per-admin landing differ, replace the regex.
    await expect(page).toHaveURL(/\/(users|apps|orgs|permissions|roles)$/)
    const out = path.join(__dirname, admin.storageStatePath)
    await context.storageState({ path: out })
  })
}
