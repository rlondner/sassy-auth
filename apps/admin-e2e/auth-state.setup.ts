import { test as setup, expect } from '@playwright/test'
import { LoginPage } from './pages/login.page'
import path from 'path'

const SUPER_ADMIN_EMAIL = 's@sa.io'
const SUPER_ADMIN_PASSWORD = 'Pass@word1234'
const AUTH_FILE = path.join(__dirname, '.auth/super-admin.json')

setup('authenticate as super admin', async ({ page }) => {
  const login = new LoginPage(page)
  await login.goto()
  await login.signIn(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD)
  await expect(page).toHaveURL(/\/users$/)
  await page.context().storageState({ path: AUTH_FILE })
})
