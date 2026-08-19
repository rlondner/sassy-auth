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
    // Since d00fc82 the first sign-in on a freshly seeded database lands on the
    // optional 2FA interstitial instead of the landing page: shouldPromptTwoFactor
    // returns true whenever twoFactorPromptedAt is null, and the seed never sets
    // it. CI seeds a new database every run, so every admin hits this. Dismiss it
    // the way the 2FA specs already do — "Skip for now" records the prompt, so it
    // does not reappear within TWO_FACTOR_TRUST_DAYS.
    //
    // Allow extra time for the cold-start /login compile+hydrate on the first
    // admin; do NOT re-submit (rapid re-submits trip the auth rate limiter).
    await page.waitForURL(
      /(\/(users|apps|orgs|permissions|roles)$|\/login\/two-factor-prompt)/,
      { timeout: 20_000 },
    )
    if (page.url().includes('/login/two-factor-prompt')) {
      await page.getByRole('button', { name: /skip/i }).click()
    }
    await expect(page).toHaveURL(/\/(users|apps|orgs|permissions|roles)$/, { timeout: 20_000 })
    const out = path.join(__dirname, admin.storageStatePath)
    await context.storageState({ path: out })
  })
}
