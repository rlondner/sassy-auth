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
