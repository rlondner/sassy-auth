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
    // Allow extra time for the cold-start /login compile+hydrate on the first
    // admin; do NOT re-submit (rapid re-submits trip the auth rate limiter).
    //
    // On a fresh CI database, none of the seeded admins have 2FA enabled or a
    // recorded twoFactorPromptedAt, so shouldPromptTwoFactor (see
    // apps/auth-server/src/auth/should-prompt-two-factor.ts) unconditionally
    // routes them through the /login/two-factor-prompt interstitial first —
    // the same behavior every other e2e spec already accounts for (see
    // two-factor.spec.ts, 2fa-enforcement.spec.ts, rs-round-trip.spec.ts).
    // Dismiss it with "Skip for now" so storage state is captured post-login,
    // matching what a real user declining enrollment would do.
    await page.waitForURL(
      /\/(users|apps|orgs|permissions|roles|login\/two-factor-prompt)$/,
      { timeout: 20_000 },
    )
    if (page.url().includes('/login/two-factor-prompt')) {
      await page.getByRole('button', { name: /skip for now/i }).click()
    }
    await expect(page).toHaveURL(/\/(users|apps|orgs|permissions|roles)$/, { timeout: 20_000 })
    const out = path.join(__dirname, admin.storageStatePath)
    await context.storageState({ path: out })
  })
}
