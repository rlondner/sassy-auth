import { test as setup, expect } from '@playwright/test'
import path from 'path'
import { LoginPage } from './pages/login.page'
import { SEED_ADMINS, ADMIN_PASSWORD } from './lib/admins'

for (const admin of SEED_ADMINS) {
  setup(`authenticate as ${admin.email}`, async ({ page, context }) => {
    const login = new LoginPage(page)

    // All 5 seeded admins land on /users post-login (their initial landing
    // page is whatever their nav allows first; /users redirect happens
    // because the admin landing layout picks /users as a default).
    // If a future change makes per-admin landing differ, replace the regex.
    // Since d00fc82 the first sign-in on a freshly seeded database lands on the
    // optional 2FA interstitial instead of the landing page: shouldPromptTwoFactor
    // returns true whenever twoFactorPromptedAt is null, and the seed never sets
    // it. CI seeds a new database every run, so every admin hits this.
    //
    // Navigate past it rather than clicking "Skip for now". Skip calls
    // recordPrompt(), which persists twoFactorPromptedAt — shared state that
    // two-factor.spec.ts:388 asserts on when it checks that an un-prompted admin
    // (o@sa.io) still sees the interstitial. Setup only needs the session cookie,
    // and that is already set before this redirect happens (forwardSessionCookie
    // runs ahead of the prompt branch in login/actions.ts), so leaving the prompt
    // unanswered costs nothing here.
    //
    // Allow extra time for the cold-start /login compile+hydrate on the first
    // admin; do NOT re-submit (rapid re-submits trip the auth rate limiter).
    //
    // That limiter is BetterAuth's own built-in per-IP budget on
    // /sign-in/email (not the AUTH_RATE_LIMIT/AUTH_RATE_WINDOW_MS env vars,
    // which only tune a NestJS-level guard elsewhere) and is tight enough
    // that six back-to-back logins from this loop can trip it on a warm
    // local server — CI naturally spaces requests out via per-admin cold
    // route compiles and rarely hits it. Retry once after the window clears
    // instead of failing setup outright on a transient 429.
    setup.setTimeout(60_000)
    for (let attempt = 1; attempt <= 2; attempt++) {
      await login.goto()
      await login.signIn(admin.email, ADMIN_PASSWORD)
      // Race navigation against the rate-limit message — both render
      // in-page with no way to know up front which will win, so wait on
      // whichever resolves first rather than polling one before the other.
      const navigated = page
        .waitForURL(/(\/(users|apps|orgs|permissions|roles)$|\/login\/two-factor-prompt)/, {
          timeout: 20_000,
        })
        .then(() => true)
        .catch(() => false)
      const rateLimited = login.anyErrorMessage
        .getByText(/too many sign-in attempts/i)
        .waitFor({ state: 'visible', timeout: 20_000 })
        .then(() => true)
        .catch(() => false)
      const winner = await Promise.race([
        navigated.then((ok) => (ok ? 'navigated' : undefined)),
        rateLimited.then((hit) => (hit ? 'rate-limited' : undefined)),
      ])
      if (winner === 'navigated') break
      if (winner === 'rate-limited') {
        if (attempt === 2) throw new Error('Rate-limited on both sign-in attempts')
        await page.waitForTimeout(12_000)
        continue
      }
      // Neither resolved within 20s — surface the real navigation failure.
      await page.waitForURL(
        /(\/(users|apps|orgs|permissions|roles)$|\/login\/two-factor-prompt)/,
        { timeout: 1_000 },
      )
      break
    }
    if (page.url().includes('/login/two-factor-prompt')) {
      await page.goto('/users')
    }
    await expect(page).toHaveURL(/\/(users|apps|orgs|permissions|roles)$/, { timeout: 20_000 })
    const out = path.join(__dirname, admin.storageStatePath)
    await context.storageState({ path: out })
  })
}
