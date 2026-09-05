/**
 * Signup ("/register") flow.
 *
 * The app has no literal /register page — POST /api/register on auth-server
 * is fronted by the admin's /signup UI (apps/admin/app/signup), which is what
 * a user actually visits from a registration link. Exercising that page here
 * covers the same path.
 *
 * Requires a real app to register against, so it borrows the FastAPI RS
 * client registered by playwright.config.ts's webServer (same gate
 * rs-round-trip.spec.ts uses) rather than inventing its own fixture app.
 *
 * Placement: tests/ root → chromium project (unauthenticated start).
 */
import { test, expect } from '../lib/fixtures'
import { SignupPage } from '../pages/signup.page'
import { createAppWithPasswordPolicyOverride } from '../lib/app-fixtures'

const RS_CLIENT_ID = process.env.RS_CLIENT_ID ?? process.env.SASSY_CLIENT_ID ?? ''

function rsIsConfigured(): boolean {
  return !!RS_CLIENT_ID
}

test.describe('Signup', () => {
  test.beforeEach(() => {
    test.skip(!rsIsConfigured(), 'Skipped: RS_CLIENT_ID not set (see rs-round-trip.spec.ts).')
  })

  test('a new user registers from /signup and can continue to sign in', async ({ page }) => {
    const signup = new SignupPage(page)
    const uniqueEmail = `e2e-signup-${Date.now()}@example.com`

    await signup.goto(RS_CLIENT_ID)

    await signup.fillAndSubmit({
      firstName: 'Ada',
      lastName: 'Lovelace',
      companyName: 'Analytical Engines Inc',
      email: uniqueEmail,
      password: 'Corr3ctHorseBattery!',
    })

    await expect(signup.successMessage).toBeVisible()

    await signup.continueToLoginLink.click()
    await expect(page).toHaveURL(/\/login$/)
  })
})

test.describe('Signup — per-app password policy override', () => {
  // Unlike the describe block above, this doesn't need RS_CLIENT_ID: it
  // provisions its own SaApp via the admin API (createAppWithPasswordPolicyOverride)
  // rather than borrowing the FastAPI RS client, so it isn't gated on
  // rsIsConfigured().

  test('a per-app password policy override changes what password signup accepts', async ({ page }) => {
    // task-14: prove the override actually changes what signup accepts, not
    // just what AppsService persists/returns. minLength is floored at 8 by
    // AppsService.assertValidPasswordPolicyOverride (apps.service.ts), so 8
    // is the most relaxed minLength an override can express — still well
    // under the global default's minLength: 12 (password-policy.ts), so an
    // 8-char, no-complexity password is a clean "fails global, passes
    // override" probe.
    const app = await createAppWithPasswordPolicyOverride({
      minLength: 8,
      requireUppercase: false,
      requireLowercase: false,
      requireNumber: false,
      requireSpecial: false,
      minNumbers: 0,
      minSpecial: 0,
    })

    const signup = new SignupPage(page)
    const uniqueEmail = `e2e-policy-${Date.now()}@example.com`

    await signup.goto(app.publicId)

    // 8-char, all-lowercase-and-digits password: fails the global default
    // (minLength 12, requireUppercase, requireNumber) but satisfies this
    // app's relaxed override.
    await signup.fillAndSubmit({
      firstName: 'Test',
      lastName: 'User',
      companyName: 'Acme',
      email: uniqueEmail,
      password: 'abcd1234',
    })

    await expect(signup.successMessage).toBeVisible()
  })
})
