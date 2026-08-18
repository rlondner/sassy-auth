/**
 * 2FA flow matrix.
 *
 * Placement: tests/ root (not tests/authed/ or tests/matrix/) so that
 * the chromium project (no storageState) includes them. They start unauthenticated.
 * testIgnore: /(authed|matrix)\/.*\.spec\.ts/ in playwright.config.ts
 * means root-level specs are always collected under the chromium project.
 *
 * workers: 1 in playwright.config.ts (both local and CI) — tests within a
 * single run execute serially in file order. This is why /tmp files written
 * by the enroll test are reliably visible to every subsequent test in the run.
 * test.describe.configure({ mode: 'serial' }) below enforces this at the
 * describe level as well, ensuring Playwright never reorders or parallelises
 * the tests within this file even if workers is ever bumped.
 *
 * Account separation (prevents cross-test contamination):
 *   tfa@sa.io — "2FA account": enroll → challenge → wrong-code → backup → no-bypass → trust-device → admin-reset
 *               Dedicated account with platform.users.manage grant. No other spec touches it.
 *               s@sa.io is NEVER enrolled here, so auth-state.setup (which captures s@sa.io's
 *               session) always runs cleanly and super-admin.json is never stale.
 *   s@sa.io   — "super admin": only used in admin-reset (storageState session; never enrolled)
 *   o@sa.io   — "interstitial account": never enrolls 2FA; used only for the two interstitial tests
 *
 * Idempotency / retries: tfa@sa.io is a dedicated account, so enrolling it never affects other
 * tests. At the start of the enroll flow we best-effort reset tfa@sa.io's 2FA via the super-admin
 * storageState session so that a local rerun or CI retry starts clean without requiring a fresh DB.
 *
 * /tmp path namespacing: paths include process.pid so concurrent CI runs on
 * the same host do not share state. workers:1 means the PID is stable for the
 * entire run. CI retries share the same PID (same process), so the retry
 * for any test after enroll still sees the secret written by the original run.
 */
import type { Page } from '@playwright/test'
import { test, expect } from '../lib/fixtures'
import { LoginPage } from '../pages/login.page'
import { SecurityPage } from '../pages/security.page'
import { TwoFactorPage } from '../pages/two-factor.page'
import { computeTotp } from '../lib/totp'
import { buildValidAuthorizeFlow, fetchPlatformApp } from '../lib/oauth-fixtures'
import { readFileSync, writeFileSync, rmSync } from 'fs'

// All tests in this file must run serially in declaration order.
// workers:1 in playwright.config.ts already enforces this at the runner level,
// but configuring it here too prevents silent breakage if workers is ever changed.
test.describe.configure({ mode: 'serial' })

// ── Account constants ──────────────────────────────────────────────────────────
const SUPER_EMAIL    = process.env.E2E_ADMIN_EMAIL    ?? 's@sa.io'
const SUPER_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'Pass@word1234'

// tfa@sa.io is the dedicated 2FA test account (platform.users.manage grant).
// ALL enroll-based tests target this account so s@sa.io is never enrolled and
// auth-state.setup always captures a clean session for super-admin.json.
const TFA_EMAIL    = process.env.E2E_TFA_EMAIL ?? 'tfa@sa.io'
const TFA_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'Pass@word1234'

// o@sa.io is the "orgs" admin — never enrolled in 2FA on a fresh CI DB.
// We use it exclusively for interstitial tests so it stays clean.
const ORGS_EMAIL    = 'o@sa.io'
const ORGS_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'Pass@word1234'

const AUTH_SERVER_URL = process.env.AUTH_SERVER_URL ?? 'http://localhost:3000'

// Namespaced /tmp paths prevent collisions across concurrent runs on the same host.
// process.pid is stable for the full run (workers:1, single process).
const TMP_SECRET = `/tmp/sassy-e2e-2fa-secret-${process.pid}.txt`
const TMP_BACKUP = `/tmp/sassy-e2e-2fa-backup-${process.pid}.txt`

// ─────────────────────────────────────────────────────────────────────────────
// Helper: sign in with password. Navigates to /login (with optional next).
async function doPasswordSignIn(
  // Playwright 1.62 added the `test(title, details, body)` overload, so
  // `Parameters<typeof test>[1]` now resolves to TestDetails rather than the
  // test body — the old derived type silently became `never`. Import Page
  // directly; it does not depend on the overload set.
  page: Page,
  email: string,
  password: string,
  next = '',
) {
  const login = new LoginPage(page)
  if (next) {
    await page.goto(`/login?next=${encodeURIComponent(next)}`)
  } else {
    await login.goto()
  }
  await login.signIn(email, password)
}

// ─────────────────────────────────────────────────────────────────────────────
// Read a secret/code persisted to the run-namespaced /tmp path by the enroll
// test earlier in this same run. workers:1 + serial mode guarantee ordering.
function readTempFile(path: string): string | null {
  try {
    return readFileSync(path, 'utf8').trim()
  } catch {
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
test.describe('2FA — enroll', () => {
  test('user can enable TOTP via /account/security and confirm with a live code', async ({ page, request }) => {
    // ── Idempotency: best-effort reset tfa@sa.io's 2FA before enrolling ───────
    // The super-admin storageState (.auth/super-admin.json) is pre-captured by
    // auth-state.setup.ts (s@sa.io session, before any 2FA enrollment). We use
    // it here via the `request` fixture (which inherits storageState from the
    // test project) to reset tfa@sa.io so a local rerun or CI retry starts clean
    // without needing a fresh database. Failure is non-fatal — if tfa@sa.io has
    // no 2FA, the reset endpoint is a no-op anyway.
    //
    // Note: the chromium project does NOT carry a storageState, so `request` here
    // is unauthenticated. We perform the reset via an explicit authed fetch using
    // the super-admin storage-state session cookie from the filesystem instead.
    // Because reading the cookie jar from disk requires server-side knowledge, we
    // perform the reset later (after sign-in as tfa@sa.io) if the security page
    // shows 2FA already enabled. See the guard below.

    // Sign in as tfa@sa.io. On a fresh CI DB: no 2FA enrolled, so we go straight
    // to /users (possibly via the interstitial prompt). No test.skip needed.
    await doPasswordSignIn(page, TFA_EMAIL, TFA_PASSWORD)
    await page.waitForURL(/(\/users|\/login\/two-factor-prompt|\/login\/two-factor)/, { timeout: 15_000 })

    // Guard: if tfa@sa.io already has 2FA enabled (non-clean run), handle the
    // challenge by resetting via the super-admin API before re-enrolling.
    if (/\/login\/two-factor(\?|$)/.test(page.url())) {
      // We need to reset 2FA for tfa@sa.io. Use the super-admin session stored in
      // .auth/super-admin.json to make an authed API call without a browser login.
      const superCtx = await page.context().browser()!.newContext({
        storageState: '.auth/super-admin.json',
      })
      const superPage = await superCtx.newPage()
      try {
        const adminUrl = process.env.AUTH_SERVER_URL ?? 'http://localhost:3000'
        const usersRes = await superPage.request.get(`${adminUrl}/api/users`)
        if (usersRes.ok()) {
          const body = await usersRes.json() as
            | { items?: Array<{ id: string; email: string }> }
            | Array<{ id: string; email: string }>
          const items = Array.isArray(body) ? body : (body.items ?? [])
          const tfaUser = items.find((u) => u.email === TFA_EMAIL)
          if (tfaUser) {
            await superPage.request.post(`${adminUrl}/api/users/${tfaUser.id}/reset-2fa`)
          }
        }
      } finally {
        await superCtx.close()
      }
      // Navigate back to login after reset.
      await doPasswordSignIn(page, TFA_EMAIL, TFA_PASSWORD)
      await page.waitForURL(/(\/users|\/login\/two-factor-prompt)/, { timeout: 15_000 })
    }

    if (page.url().includes('/login/two-factor-prompt')) {
      // Dismiss the interstitial so we can reach /account/security.
      await page.getByRole('button', { name: /skip for now/i }).click()
      await page.waitForURL(/\/users/, { timeout: 10_000 })
    }

    const security = new SecurityPage(page)
    await security.goto()

    // SecurityClient.tsx renders the enable form (password field) immediately
    // when !enabled && step === 'idle' — no button click needed before fill.
    const { secret, backupCodes } = await security.enable(TFA_PASSWORD)

    // Validate format without logging the values.
    expect(secret).toMatch(/^[A-Z2-7]{16,}$/)
    expect(backupCodes.length).toBeGreaterThanOrEqual(8)

    const code = computeTotp(secret)
    await security.confirmEnable(code)

    // Persist secret + one backup code to run-namespaced /tmp paths (mode 0o600)
    // so subsequent serial tests in the same CI run can read them without
    // passing secrets through env vars. workers:1 + serial mode guarantee ordering.
    writeFileSync(TMP_SECRET, secret, { mode: 0o600 })
    if (backupCodes[0]) {
      writeFileSync(TMP_BACKUP, backupCodes[0], { mode: 0o600 })
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
test.describe('2FA — challenge through authorize', () => {
  test('password login → TOTP → authorize code issued', async ({ page, request }) => {
    // serial mode + workers:1 guarantees enroll ran first and wrote the file.
    const secret =
      readTempFile(TMP_SECRET) ?? process.env['TWO_FACTOR_TEST_SECRET']
    // Hard-assert: enroll must have succeeded in this same run.
    expect(secret, '2FA secret must be available — enroll test must run first').toBeTruthy()

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
    await doPasswordSignIn(page, TFA_EMAIL, TFA_PASSWORD, authorizeUrl)
    await page.waitForURL(
      /(\/login\/two-factor|\/users|\/login\/two-factor-prompt)/,
      { timeout: 15_000 },
    )

    // 2FA was enrolled in the enroll test — challenge MUST appear.
    // Use exact regex to distinguish /login/two-factor from /login/two-factor-prompt.
    expect(
      /\/login\/two-factor(\?|$)/.test(page.url()),
      '2FA challenge must be shown after enroll (not the interstitial prompt)',
    ).toBe(true)

    const tfPage = new TwoFactorPage(page)
    await tfPage.submitTotp(computeTotp(secret!))
    // After TOTP passes, the authorize flow completes → redirect_uri?code=&state=
    await page.waitForURL((url) => url.searchParams.has('code'), { timeout: 20_000 })
    const finalUrl = new URL(page.url())
    expect(finalUrl.searchParams.get('code')).toBeTruthy()
    expect(finalUrl.searchParams.get('state')).toBe('tf-challenge-state')
  })

  test('wrong TOTP code shows error and stays on /login/two-factor', async ({ page }) => {
    // Navigate directly to the two-factor page. Submitting a wrong code
    // should render the totp-error element regardless of session state.
    await page.goto('/login/two-factor')
    const tfPage = new TwoFactorPage(page)
    await tfPage.submitTotp('000000')
    await expect(tfPage.totpError).toBeVisible({ timeout: 10_000 })
    // Must stay on the two-factor page.
    await expect(page).not.toHaveURL(/\/users/, { timeout: 2_000 })
  })

  test('backup code path — valid backup code completes sign-in', async ({ page }) => {
    const backupCode =
      readTempFile(TMP_BACKUP) ??
      process.env['TWO_FACTOR_TEST_BACKUP_CODE']
    // Hard-assert: enroll must have written this.
    expect(backupCode, 'backup code must be available — enroll test must run first').toBeTruthy()

    await doPasswordSignIn(page, TFA_EMAIL, TFA_PASSWORD)
    await page.waitForURL(
      /(\/login\/two-factor|\/users|\/login\/two-factor-prompt)/,
      { timeout: 15_000 },
    )
    // 2FA enrolled → challenge MUST appear (exact match, not the prompt interstitial).
    expect(
      /\/login\/two-factor(\?|$)/.test(page.url()),
      '2FA challenge must be shown (not the interstitial prompt)',
    ).toBe(true)

    const tfPage = new TwoFactorPage(page)
    await tfPage.switchToBackup()
    await tfPage.submitBackupCode(backupCode!)
    await expect(page).toHaveURL(/\/users/, { timeout: 10_000 })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
test.describe('2FA — no-bypass (email-OTP)', () => {
  test('no code is issued to a 2FA-enrolled user requesting email-OTP', async ({ page }) => {
    const secret =
      readTempFile(TMP_SECRET) ?? process.env['TWO_FACTOR_TEST_SECRET']
    // Hard-assert: enroll must have run.
    expect(secret, '2FA secret must be available — enroll test must run first').toBeTruthy()

    // Navigate to the email-OTP request page and submit the enrolled user's email.
    // The backend (otp-sender.ts) returns early with outcome:'skipped_2fa' and
    // never stores a code, so the test-only endpoint must return 404.
    const login = new LoginPage(page)
    await login.gotoOtp()
    await login.requestCode(TFA_EMAIL)

    // Assert: no OTP was issued — the auth-server test endpoint must return 404.
    // Do NOT use login.fetchOtp() here — that helper asserts res.ok().
    const res = await page.request.get(
      `${AUTH_SERVER_URL}/test/last-otp?email=${encodeURIComponent(TFA_EMAIL)}`,
    )
    expect(res.status()).toBe(404)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
test.describe('2FA — trust device', () => {
  test('second sign-in in same browser context skips TOTP', async ({ page }) => {
    const secret =
      readTempFile(TMP_SECRET) ?? process.env['TWO_FACTOR_TEST_SECRET']
    expect(secret, '2FA secret must be available — enroll test must run first').toBeTruthy()

    // ── First login: complete TOTP to set the trust cookie ──────────────────
    await doPasswordSignIn(page, TFA_EMAIL, TFA_PASSWORD)
    await page.waitForURL(
      /(\/login\/two-factor|\/users|\/login\/two-factor-prompt)/,
      { timeout: 15_000 },
    )
    // Exact match: /login/two-factor is the challenge; /login/two-factor-prompt is the interstitial.
    expect(
      /\/login\/two-factor(\?|$)/.test(page.url()),
      '2FA challenge must appear on first login (not the interstitial prompt)',
    ).toBe(true)

    const tfPage = new TwoFactorPage(page)
    await tfPage.submitTotp(computeTotp(secret!))
    await page.waitForURL(/(\/users|\/login\/two-factor-prompt)/, { timeout: 15_000 })

    if (page.url().includes('/login/two-factor-prompt')) {
      await page.getByRole('button', { name: /skip for now/i }).click()
      await page.waitForURL(/\/users/, { timeout: 10_000 })
    }

    // ── Clear the session cookie but retain the trust cookie ─────────────────
    // This isolates the trust-device bypass from an active session reuse: if
    // the session cookie were still present, the second sign-in might bypass
    // TOTP because the session is still valid, not because the trust cookie
    // worked. By removing only the session cookie, the server treats the second
    // sign-in as a fresh authentication and must rely on the trust cookie to
    // skip the TOTP step.
    await page.context().clearCookies({ name: 'better-auth.session_token' })
    await page.goto('/login')

    // ── Second login: trust cookie present, session gone → TOTP skipped ─────
    await page.getByLabel('Email').fill(TFA_EMAIL)
    await page.getByLabel('Password').fill(TFA_PASSWORD)
    await page.getByRole('button', { name: /sign in/i }).click()
    await page.waitForURL(
      /(\/users|\/login\/two-factor-prompt|\/login\/two-factor)/,
      { timeout: 15_000 },
    )

    // Must NOT present TOTP again (trust cookie bypasses it).
    // Use exact regex to avoid matching /login/two-factor-prompt.
    expect(/\/login\/two-factor(\?|$)/.test(page.url())).toBe(false)
  })

  test('fresh browser context always presents TOTP challenge', async ({ browser }) => {
    const secret =
      readTempFile(TMP_SECRET) ?? process.env['TWO_FACTOR_TEST_SECRET']
    expect(secret, '2FA secret must be available — enroll test must run first').toBeTruthy()

    // Create a completely fresh context with no cookies / storage.
    const ADMIN_URL = process.env.ADMIN_URL ?? 'http://localhost:3001'
    const ctx = await browser.newContext()
    const freshPage = await ctx.newPage()
    try {
      await freshPage.goto(`${ADMIN_URL}/login`)
      await freshPage.getByLabel('Email').fill(TFA_EMAIL)
      await freshPage.getByLabel('Password').fill(TFA_PASSWORD)
      await freshPage.getByRole('button', { name: /sign in/i }).click()
      await freshPage.waitForURL(
        /(\/login\/two-factor|\/users|\/login\/two-factor-prompt)/,
        { timeout: 15_000 },
      )
      // No trust cookie in fresh context → must show the TOTP challenge (exact match).
      expect(/\/login\/two-factor(\?|$)/.test(freshPage.url())).toBe(true)
    } finally {
      await ctx.close()
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Interstitial tests use o@sa.io — a clean account that NEVER enrolls 2FA.
// On a fresh CI DB: twoFactorEnabled=false, twoFactorPromptedAt=null.
// These are unconditional assertions, no test.skip guards needed.
test.describe('2FA — interstitial', () => {
  test('user without 2FA sees the prompt after password login and Skip continues to /users', async ({ page }) => {
    // o@sa.io never has 2FA enrolled — interstitial fires unconditionally on fresh CI DB.
    await doPasswordSignIn(page, ORGS_EMAIL, ORGS_PASSWORD)
    await page.waitForURL(
      /(\/users|\/orgs|\/login\/two-factor-prompt)/,
      { timeout: 15_000 },
    )

    // Must land on the interstitial (twoFactorEnabled=false, promptedAt=null).
    await expect(page).toHaveURL(/\/login\/two-factor-prompt/, { timeout: 5_000 })

    // TwoFactorPromptClient renders t('twoFactorPrompt.title') = "Secure your account"
    await expect(page.getByText(/secure your account/i)).toBeVisible()
    // t('twoFactorPrompt.skip') = "Skip for now"
    await page.getByRole('button', { name: /skip for now/i }).click()
    await expect(page).toHaveURL(/\/(users|orgs)/, { timeout: 10_000 })
  })

  test('interstitial does not reappear within the interval after being dismissed', async ({ page }) => {
    // ── First login as o@sa.io: dismiss interstitial (records promptedAt) ───
    await doPasswordSignIn(page, ORGS_EMAIL, ORGS_PASSWORD)
    await page.waitForURL(
      /(\/users|\/orgs|\/login\/two-factor-prompt)/,
      { timeout: 15_000 },
    )

    // This test runs after the previous interstitial test. The previous test
    // set promptedAt server-side for o@sa.io, so the interstitial may or may
    // not appear on this first login (depends on the interval). Either way:
    if (page.url().includes('/login/two-factor-prompt')) {
      await page.getByRole('button', { name: /skip for now/i }).click()
      await page.waitForURL(/\/(users|orgs)/, { timeout: 10_000 })
    }
    // At this point promptedAt is set for o@sa.io regardless of which branch ran.

    // ── Second login in same context (promptedAt set → no repeat) ───────────
    await page.goto('/login')
    const login = new LoginPage(page)
    await login.signIn(ORGS_EMAIL, ORGS_PASSWORD)
    await page.waitForURL(
      /(\/users|\/orgs|\/login\/two-factor-prompt)/,
      { timeout: 15_000 },
    )

    // Must NOT show the prompt again within the interval (promptedAt is set).
    expect(page.url()).not.toContain('/two-factor-prompt')
    expect(page.url()).toMatch(/\/(users|orgs)/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Admin-reset: uses the pre-captured s@sa.io storageState (super-admin.json) to
// make authed API calls. MUST run last. Resets tfa@sa.io's 2FA (not s@sa.io —
// s@sa.io was never enrolled here, so auth-state.setup always stays valid).
test.describe('2FA — admin reset', () => {
  // The setup project captured s@sa.io's session BEFORE 2FA was enrolled on any
  // account (auth-state.setup.ts runs at suite start via password login). That
  // session cookie remains valid for API calls. s@sa.io itself is never enrolled
  // in 2FA in this suite, so no 2FA gate blocks these authed requests.
  test.use({ storageState: '.auth/super-admin.json' })

  test('after admin resets 2FA, password sign-in does not present TOTP', async ({ page, request }) => {
    // Step 1: resolve tfa@sa.io's publicId via the authed request context.
    // The storageState provides the s@sa.io session cookie — no extra sign-in needed.
    const usersRes = await request.get(`${AUTH_SERVER_URL}/api/users`)
    expect(usersRes.ok(), `GET /api/users failed: ${usersRes.status()}`).toBe(true)
    const usersBody = (await usersRes.json()) as
      | { items?: Array<{ id: string; email: string }> }
      | Array<{ id: string; email: string }>
    const items = Array.isArray(usersBody) ? usersBody : (usersBody.items ?? [])
    const tfaUser = items.find((u) => u.email === TFA_EMAIL)
    expect(tfaUser, `Could not find ${TFA_EMAIL} in /api/users response`).toBeDefined()
    const tfaPublicId = tfaUser!.id

    // Step 2: call the reset-2fa endpoint for tfa@sa.io with the authed context.
    const resetRes = await request.post(`${AUTH_SERVER_URL}/api/users/${tfaPublicId}/reset-2fa`)
    expect(resetRes.ok(), `POST reset-2fa failed: ${resetRes.status()}`).toBe(true)

    // Clean up run-namespaced temp files so the secret is not inadvertently reused.
    rmSync(TMP_SECRET, { force: true })
    rmSync(TMP_BACKUP, { force: true })

    // Step 3: verify the reset by password-signing-in as tfa@sa.io with a fresh
    // browser context (no trust cookie). After reset, there should be no TOTP challenge.
    const ADMIN_URL = process.env.ADMIN_URL ?? 'http://localhost:3001'
    const freshCtx = await page.context().browser()!.newContext()
    const freshPage = await freshCtx.newPage()
    try {
      await freshPage.goto(`${ADMIN_URL}/login`)
      await freshPage.getByLabel('Email').fill(TFA_EMAIL)
      await freshPage.getByLabel('Password').fill(TFA_PASSWORD)
      await freshPage.getByRole('button', { name: /sign in/i }).click()
      await freshPage.waitForURL(
        /(\/users|\/login\/two-factor-prompt|\/login\/two-factor)/,
        { timeout: 15_000 },
      )
      // After reset: no TOTP challenge (exact match to avoid matching the interstitial).
      expect(/\/login\/two-factor(\?|$)/.test(freshPage.url())).toBe(false)
    } finally {
      await freshCtx.close()
    }
  })
})
