/**
 * FastAPI RS round-trip specs.
 *
 * Require the RS to be running at http://localhost:8010 with a matching
 * SASSY_CLIENT_ID. In CI: wired via playwright.config.ts webServer.
 * Locally: start the RS manually:
 *   cd apps/resource-server-fastapi
 *   SASSY_CLIENT_ID=<publicId> \
 *   REDIRECT_URI=http://localhost:8010/auth/callback \
 *   RS_BASE_URL=http://localhost:8010 \
 *   AUTH_SERVER_URL=http://localhost:3000 \
 *   ADMIN_URL=http://localhost:3001 \
 *   uvicorn app.main:app --port 8010
 *
 * Placement: tests/ root → chromium project (unauthenticated start).
 */
import { test, expect } from '../lib/fixtures'
import { LoginPage } from '../pages/login.page'
import { TwoFactorPage } from '../pages/two-factor.page'
import { computeTotp } from '../lib/totp'

const RS_BASE_URL = process.env.RS_BASE_URL ?? 'http://localhost:8010'
const SUPER_EMAIL = 's@sa.io'
const SUPER_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'Pass@word1234'

function rsIsConfigured(): boolean {
  // RS_CLIENT_ID is set by playwright.config.ts from the CI seed step.
  return !!(process.env.RS_CLIENT_ID ?? process.env.SASSY_CLIENT_ID)
}

function readTempFile(path: string): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('fs').readFileSync(path, 'utf8').trim()
  } catch {
    return null
  }
}

test.describe('FastAPI RS round-trip', () => {
  test.beforeEach(() => {
    if (!rsIsConfigured()) {
      test.skip(true, 'RS not configured (RS_CLIENT_ID or SASSY_CLIENT_ID not set). ' +
        'Seed the RS app and set the env var, or run in CI.')
    }
  })

  test('RS /auth/login → admin login → password → /auth/callback → "Signed in"', async ({ page }) => {
    // Navigate to RS /auth/login. It redirects to:
    //   /api/token/oauth/authorize?... → /login?next=authorize-url
    await page.goto(`${RS_BASE_URL}/auth/login`)
    // Land on admin /login with `next` param set to the authorize URL.
    await page.waitForURL(/\/login/, { timeout: 20_000 })

    const login = new LoginPage(page)
    await login.signIn(SUPER_EMAIL, SUPER_PASSWORD)

    await page.waitForURL(
      /(\/login\/two-factor|\/login\/two-factor-prompt|\/auth\/callback)/,
      { timeout: 25_000 },
    )

    if (page.url().includes('/login/two-factor')) {
      const secret = readTempFile('/tmp/sassy-e2e-2fa-secret.txt') ?? process.env['TWO_FACTOR_TEST_SECRET']
      if (!secret) {
        test.skip(true, '2FA enrolled but TWO_FACTOR_TEST_SECRET not set.')
        return
      }
      const tfPage = new TwoFactorPage(page)
      await tfPage.submitTotp(computeTotp(secret))
      await page.waitForURL(/(\/login\/two-factor-prompt|\/auth\/callback)/, { timeout: 20_000 })
    }

    if (page.url().includes('/login/two-factor-prompt')) {
      await page.getByRole('button', { name: /skip/i }).click()
      await page.waitForURL(/\/auth\/callback/, { timeout: 20_000 })
    }

    // authorized.html — assert the "Signed in" heading.
    await expect(page.getByRole('heading', { name: 'Signed in' })).toBeVisible({ timeout: 10_000 })
    // Confirm we are on the RS callback URL.
    expect(page.url()).toContain(`${RS_BASE_URL}/auth/callback`)
  })

  test('RS round-trip with 2FA enrolled — TOTP challenge → "Signed in"', async ({ page }) => {
    const secret = readTempFile('/tmp/sassy-e2e-2fa-secret.txt') ?? process.env['TWO_FACTOR_TEST_SECRET']
    if (!secret) {
      test.skip(true, '2FA not enrolled. Run the enroll spec first.')
      return
    }

    await page.goto(`${RS_BASE_URL}/auth/login`)
    await page.waitForURL(/\/login/, { timeout: 20_000 })

    const login = new LoginPage(page)
    await login.signIn(SUPER_EMAIL, SUPER_PASSWORD)
    await page.waitForURL(
      /(\/login\/two-factor|\/login\/two-factor-prompt|\/auth\/callback)/,
      { timeout: 25_000 },
    )

    if (!page.url().includes('/login/two-factor')) {
      test.skip(true, '2FA challenge was not presented. May not be enrolled.')
      return
    }

    const tfPage = new TwoFactorPage(page)
    await tfPage.submitTotp(computeTotp(secret))
    await page.waitForURL(/(\/login\/two-factor-prompt|\/auth\/callback)/, { timeout: 20_000 })

    if (page.url().includes('/login/two-factor-prompt')) {
      await page.getByRole('button', { name: /skip/i }).click()
      await page.waitForURL(/\/auth\/callback/, { timeout: 20_000 })
    }

    await expect(page.getByRole('heading', { name: 'Signed in' })).toBeVisible({ timeout: 10_000 })
    expect(page.url()).toContain(`${RS_BASE_URL}/auth/callback`)
  })
})
