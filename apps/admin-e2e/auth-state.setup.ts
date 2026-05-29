import { test as setup, expect } from '@playwright/test'
import { LoginPage } from './pages/login.page'

const AUTH_FILE = '.auth/super-admin.json'

setup('authenticate as super admin', async ({ page }) => {
  const login = new LoginPage(page)
  await login.goto()
  await login.signIn('s@sa.io', 'Pass@word1234')
  await expect(page).toHaveURL(/\/users$/)
  await page.context().storageState({ path: AUTH_FILE })
})
