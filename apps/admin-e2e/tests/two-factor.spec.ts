/**
 * 2FA flow matrix.
 *
 * Placement: tests/ root (not tests/authed/ or tests/matrix/) so that
 * the chromium project (no storageState) includes them. They start unauthenticated.
 * testIgnore: /(authed|matrix)\/.*\.spec\.ts/ in playwright.config.ts
 * means root-level specs are always collected under the chromium project.
 */
import { test, expect } from '../lib/fixtures'
import { LoginPage } from '../pages/login.page'
import { SecurityPage } from '../pages/security.page'
import { TwoFactorPage } from '../pages/two-factor.page'
import { computeTotp } from '../lib/totp'
import { buildAuthorizeUrl, buildValidAuthorizeFlow, fetchPlatformApp, newPkce } from '../lib/oauth-fixtures'

const SUPER_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 's@sa.io'
const SUPER_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'Pass@word1234'

// ─────────────────────────────────────────────────────────────────────────────
// Helper: sign in with password. Navigates to /login (with optional next).
async function doPasswordSignIn(
  page: Parameters<Parameters<typeof test>[1]>[0]['page'],
  next = '',
) {
  const login = new LoginPage(page)
  if (next) {
    await page.goto(`/login?next=${encodeURIComponent(next)}`)
  } else {
    await login.goto()
  }
  await login.signIn(SUPER_EMAIL, SUPER_PASSWORD)
}

// ─────────────────────────────────────────────────────────────────────────────
// Read a secret/code persisted to /tmp by the enroll spec earlier in the same run.
function readTempFile(path: string): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('fs').readFileSync(path, 'utf8').trim()
  } catch {
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
test.describe('2FA — enroll', () => {
  test('user can enable TOTP via /account/security and confirm with a live code', async ({ page }) => {
    // Sign in first. If 2FA is already enrolled we will land on /login/two-factor.
    await doPasswordSignIn(page)
    await page.waitForURL(/(\/users|\/login\/two-factor|\/login\/two-factor-prompt)/, { timeout: 15_000 })
    if (page.url().includes('/login/two-factor')) {
      test.skip(true, '2FA already enrolled. Run admin-reset spec first, then re-run enroll.')
      return
    }
    if (page.url().includes('/login/two-factor-prompt')) {
      // Dismiss the optional interstitial so we can reach /account/security.
      await page.getByRole('button', { name: /skip for now/i }).click()
      await page.waitForURL(/\/users/, { timeout: 10_000 })
    }

    const security = new SecurityPage(page)
    await security.goto()
    const { secret, backupCodes } = await security.enable(SUPER_PASSWORD)

    // Validate format without logging the values.
    expect(secret).toMatch(/^[A-Z2-7]{16,}$/)
    expect(backupCodes.length).toBeGreaterThanOrEqual(8)

    const code = computeTotp(secret)
    await security.confirmEnable(code)

    // Persist secret + one backup code to /tmp (mode 0o600) so subsequent specs
    // in the same CI run can read them without passing secrets through env vars.
    const { writeFileSync } = await import('fs')
    writeFileSync('/tmp/sassy-e2e-2fa-secret.txt', secret, { mode: 0o600 })
    if (backupCodes[0]) {
      writeFileSync('/tmp/sassy-e2e-2fa-backup.txt', backupCodes[0], { mode: 0o600 })
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
test.describe('2FA — challenge through authorize', () => {
  test('password login → TOTP → authorize code issued', async ({ page, request }) => {
    const secret =
      readTempFile('/tmp/sassy-e2e-2fa-secret.txt') ?? process.env['TWO_FACTOR_TEST_SECRET']
    if (!secret) {
      test.skip(true, 'No 2FA secret available. Run enroll spec first.')
      return
    }

    const platformApp = await fetchPlatformApp(request)
    const { authorizeUrl, redirectUri } = buildValidAuthorizeFlow(platformApp, 'tf-challenge-state')

    // Stub the redirect_uri so the browser doesn't 404 when the auth-server
    // redirects back after the TOTP challenge.
    await page.route(
      (url) => url.origin === new URL(redirectUri).origin && url.pathname === '/cb',
      (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<p>ok</p>' }),
    )

    // Navigate to /login with the authorize URL as the next parameter so that
    // after TOTP the authorize flow completes and we land on redirect_uri?code=.
    await doPasswordSignIn(page, authorizeUrl)
    await page.waitForURL(
      /(\/login\/two-factor|\/login\/two-factor-prompt|\/users)/,
      { timeout: 15_000 },
    )

    if (!page.url().includes('/login/two-factor')) {
      test.skip(true, '2FA challenge not shown — 2FA may not be enrolled.')
      return
    }

    const tfPage = new TwoFactorPage(page)
    await tfPage.submitTotp(computeTotp(secret))
    // After TOTP passes, the authorize flow completes → redirect_uri?code=&state=
    await page.waitForURL((url) => url.searchParams.has('code'), { timeout: 20_000 })
    const finalUrl = new URL(page.url())
    expect(finalUrl.searchParams.get('code')).toBeTruthy()
    expect(finalUrl.searchParams.get('state')).toBe('tf-challenge-state')
  })

  test('wrong TOTP code shows error and stays on /login/two-factor', async ({ page }) => {
    // Navigate directly to the two-factor page. The page is accessible without
    // a session (it just won't have a pending sign-in state to complete), so
    // submitting a wrong code should render the totp-error element.
    await page.goto('/login/two-factor')
    const tfPage = new TwoFactorPage(page)
    await tfPage.submitTotp('000000')
    await expect(tfPage.totpError).toBeVisible({ timeout: 10_000 })
    // Must stay on the two-factor page.
    await expect(page).not.toHaveURL(/\/users/, { timeout: 2_000 })
  })

  test('backup code path — valid backup code completes sign-in', async ({ page }) => {
    const backupCode =
      readTempFile('/tmp/sassy-e2e-2fa-backup.txt') ??
      process.env['TWO_FACTOR_TEST_BACKUP_CODE']
    if (!backupCode) {
      test.skip(true, 'No backup code available. Run enroll spec first.')
      return
    }

    await doPasswordSignIn(page)
    await page.waitForURL(
      /(\/login\/two-factor|\/users|\/login\/two-factor-prompt)/,
      { timeout: 15_000 },
    )
    if (!page.url().includes('/login/two-factor')) {
      test.skip(true, '2FA challenge not shown — 2FA may not be enrolled.')
      return
    }

    const tfPage = new TwoFactorPage(page)
    await tfPage.switchToBackup()
    await tfPage.submitBackupCode(backupCode)
    await expect(page).toHaveURL(/\/users/, { timeout: 10_000 })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
test.describe('2FA — no-bypass (email-OTP)', () => {
  test('email-OTP sign-in for a 2FA-enrolled user routes to /login/two-factor', async ({ page }) => {
    const secret =
      readTempFile('/tmp/sassy-e2e-2fa-secret.txt') ?? process.env['TWO_FACTOR_TEST_SECRET']
    if (!secret) {
      test.skip(true, '2FA not enrolled — skip no-bypass test.')
      return
    }

    const login = new LoginPage(page)
    await login.gotoOtp()
    await login.requestCode(SUPER_EMAIL)
    const otp = await login.fetchOtp(SUPER_EMAIL)
    await login.submitCode(otp)

    // A 2FA-enrolled user MUST land on /login/two-factor, not /users.
    // The no-bypass guarantee means the email-OTP flow cannot skip the TOTP step.
    await expect(page).toHaveURL(/\/login\/two-factor/, { timeout: 15_000 })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
test.describe('2FA — trust device', () => {
  test('second sign-in in same browser context skips TOTP', async ({ page }) => {
    const secret =
      readTempFile('/tmp/sassy-e2e-2fa-secret.txt') ?? process.env['TWO_FACTOR_TEST_SECRET']
    if (!secret) {
      test.skip(true, '2FA secret not available.')
      return
    }

    // ── First login: complete TOTP to set the trust cookie ──────────────────
    await doPasswordSignIn(page)
    await page.waitForURL(
      /(\/login\/two-factor|\/users|\/login\/two-factor-prompt)/,
      { timeout: 15_000 },
    )
    if (page.url().includes('/login/two-factor')) {
      const tfPage = new TwoFactorPage(page)
      await tfPage.submitTotp(computeTotp(secret))
      await page.waitForURL(/(\/users|\/login\/two-factor-prompt)/, { timeout: 15_000 })
    }
    if (page.url().includes('/login/two-factor-prompt')) {
      await page.getByRole('button', { name: /skip for now/i }).click()
      await page.waitForURL(/\/users/, { timeout: 10_000 })
    }

    // ── Sign out by going to /login (cookies retained in same context) ──────
    await page.goto('/login')

    // ── Second login: trust cookie present → TOTP should be skipped ─────────
    await page.getByLabel('Email').fill(SUPER_EMAIL)
    await page.getByLabel('Password').fill(SUPER_PASSWORD)
    await page.getByRole('button', { name: /sign in/i }).click()
    await page.waitForURL(
      /(\/users|\/login\/two-factor-prompt|\/login\/two-factor)/,
      { timeout: 15_000 },
    )

    // Must NOT present TOTP again (trust cookie should bypass it).
    expect(page.url()).not.toContain('/login/two-factor')
  })

  test('fresh browser context always presents TOTP challenge', async ({ browser }) => {
    const secret =
      readTempFile('/tmp/sassy-e2e-2fa-secret.txt') ?? process.env['TWO_FACTOR_TEST_SECRET']
    if (!secret) {
      test.skip(true, '2FA secret not available.')
      return
    }

    // Create a completely fresh context with no cookies / storage.
    const ADMIN_URL = process.env.ADMIN_URL ?? 'http://localhost:3001'
    const ctx = await browser.newContext()
    const freshPage = await ctx.newPage()
    try {
      await freshPage.goto(`${ADMIN_URL}/login`)
      await freshPage.getByLabel('Email').fill(SUPER_EMAIL)
      await freshPage.getByLabel('Password').fill(SUPER_PASSWORD)
      await freshPage.getByRole('button', { name: /sign in/i }).click()
      await freshPage.waitForURL(
        /(\/login\/two-factor|\/users|\/login\/two-factor-prompt)/,
        { timeout: 15_000 },
      )
      // No trust cookie in fresh context → must show the TOTP challenge.
      expect(freshPage.url()).toContain('/login/two-factor')
    } finally {
      await ctx.close()
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
test.describe('2FA — interstitial', () => {
  test('user without 2FA sees the prompt after password login and Skip continues to /users', async ({ page }) => {
    await doPasswordSignIn(page)
    await page.waitForURL(
      /(\/users|\/login\/two-factor|\/login\/two-factor-prompt)/,
      { timeout: 15_000 },
    )

    if (page.url().includes('/login/two-factor')) {
      test.skip(true, '2FA enrolled — interstitial does not show for enrolled users.')
      return
    }
    if (!page.url().includes('/login/two-factor-prompt')) {
      test.skip(true, 'Interstitial not shown (promptedAt within interval or no interstitial configured).')
      return
    }

    // TwoFactorPromptClient renders t('twoFactorPrompt.title') = "Secure your account"
    await expect(page.getByText(/secure your account/i)).toBeVisible()
    // t('twoFactorPrompt.skip') = "Skip for now"
    await page.getByRole('button', { name: /skip for now/i }).click()
    await expect(page).toHaveURL(/\/users/, { timeout: 10_000 })
  })

  test('interstitial does not reappear within the interval after being dismissed', async ({ page }) => {
    // ── First login: dismiss interstitial (records promptedAt) ──────────────
    await doPasswordSignIn(page)
    await page.waitForURL(
      /(\/users|\/login\/two-factor|\/login\/two-factor-prompt)/,
      { timeout: 15_000 },
    )
    if (page.url().includes('/login/two-factor-prompt')) {
      await page.getByRole('button', { name: /skip for now/i }).click()
      await page.waitForURL(/\/users/, { timeout: 10_000 })
    } else if (page.url().includes('/login/two-factor')) {
      test.skip(true, '2FA enrolled — cannot test interstitial.')
      return
    }

    // ── Second login in same context (promptedAt set → no repeat) ───────────
    await page.goto('/login')
    const login = new LoginPage(page)
    await login.signIn(SUPER_EMAIL, SUPER_PASSWORD)
    await page.waitForURL(
      /(\/users|\/login\/two-factor|\/login\/two-factor-prompt)/,
      { timeout: 15_000 },
    )

    // Must NOT show the prompt again within the interval.
    expect(page.url()).not.toContain('/two-factor-prompt')
    if (!page.url().includes('/login/two-factor')) {
      expect(page.url()).toContain('/users')
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
test.describe('2FA — admin reset', () => {
  test('after admin resets 2FA, password sign-in does not present TOTP', async ({ page, request }) => {
    const secret =
      readTempFile('/tmp/sassy-e2e-2fa-secret.txt') ?? process.env['TWO_FACTOR_TEST_SECRET']
    if (!secret) {
      test.skip(true, '2FA not enrolled — nothing to reset.')
      return
    }

    const AUTH_SERVER_URL = process.env.AUTH_SERVER_URL ?? 'http://localhost:3000'

    // Sign in via the request API to get a session cookie for subsequent API calls.
    // If 2FA is enrolled, the sign-in response returns a twoFactorRedirect and
    // we won't get a full session — skip gracefully in that case.
    const signInRes = await request.post(`${AUTH_SERVER_URL}/api/auth/sign-in/email`, {
      data: { email: SUPER_EMAIL, password: SUPER_PASSWORD },
    })
    if (!signInRes.ok()) {
      test.skip(true, 'Could not sign in via request API (2FA may be blocking the API path).')
      return
    }

    // Verify we received a proper session (not a 2FA redirect body).
    const signInBody = (await signInRes.json().catch(() => null)) as Record<string, unknown> | null
    if (signInBody && 'twoFactorRedirect' in signInBody) {
      test.skip(true, 'Auth server returned twoFactorRedirect — cannot obtain session for reset via request API.')
      return
    }

    const meRes = await request.get(`${AUTH_SERVER_URL}/api/me`)
    if (!meRes.ok()) {
      test.skip(true, 'Could not fetch /api/me — likely 401.')
      return
    }
    const me = (await meRes.json()) as { userId?: string; id?: string }
    const userId = me.userId ?? me.id
    if (!userId) {
      test.skip(true, '/api/me did not return a userId or id field.')
      return
    }

    const resetRes = await request.post(`${AUTH_SERVER_URL}/api/users/${userId}/reset-2fa`)
    expect(resetRes.ok()).toBe(true)

    // Remove local temp files so subsequent specs behave as if 2FA is not enrolled.
    const { rmSync } = await import('fs')
    rmSync('/tmp/sassy-e2e-2fa-secret.txt', { force: true })
    rmSync('/tmp/sassy-e2e-2fa-backup.txt', { force: true })

    // Sign in via browser — should NOT present TOTP after the reset.
    await doPasswordSignIn(page)
    await page.waitForURL(/(\/users|\/login\/two-factor-prompt)/, { timeout: 15_000 })
    expect(page.url()).not.toContain('/login/two-factor')
  })
})
