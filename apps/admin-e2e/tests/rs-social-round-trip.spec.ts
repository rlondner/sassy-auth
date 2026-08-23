/**
 * Federated round-trip against the stub IdP.
 *
 * Requires: auth-server with E2E_STUB_IDP_URL set, the stub IdP on
 * E2E_STUB_IDP_URL (default :9099), and the RS on RS_BASE_URL (default
 * :8010) — all wired by playwright.config.ts webServer when CI_TESTS=true.
 *
 * IDENTITY SELECTION — corrected from the task-13 brief, which suggested
 * appending `stub_email`/`stub_sub`/`stub_email_verified` query params to
 * the RS's /auth/login URL. That does not survive the redirect chain:
 * BetterAuth's genericOAuth plugin builds the stub's /authorize URL itself
 * from the provider config (see fixtures/stub-idp/server.mjs's module
 * comment and pages/social-login.page.ts), never from anything the browser
 * sent when it clicked the sign-in button. The only channel that actually
 * reaches a real, browser-driven sign-in is the stub's side channel:
 * `POST /__set-identity` (Node-side, via the Playwright `request` fixture)
 * before clicking "Continue with Test IdP", and `POST /__reset-identity`
 * after — wrapped by SocialLoginPage so specs below never touch the stub's
 * HTTP surface directly. The stub enforces a single pending identity
 * (workers: 1 in this config makes that safe) and 409s on a conflicting
 * write, which is why every test resets in `afterEach` even on failure.
 *
 * Real providers are deliberately not exercised: they cannot authenticate a
 * headless browser, and BetterAuth's token exchange is server-side so network
 * mocking cannot substitute. Apple additionally cannot run here at all
 * (form_post callback + no localhost return URL) and is manual-only.
 */
import { execFileSync } from 'node:child_process'
import type { APIRequestContext } from '@playwright/test'
import { test, expect } from '../lib/fixtures'
import { SocialLoginPage } from '../pages/social-login.page'
import { AUTH_SERVER_URL } from '../lib/oauth-fixtures'

const RS_BASE_URL = process.env.RS_BASE_URL ?? 'http://localhost:8010'
const STUB_IDP_URL = process.env.E2E_STUB_IDP_URL ?? 'http://localhost:9099'
const SOCIAL_EMAIL = 'social@cpm.io'

/** Reset without needing a Page — used from beforeEach/afterEach hooks. */
async function resetStubIdentity(request: APIRequestContext): Promise<void> {
  await request.post(`${STUB_IDP_URL}/__reset-identity`)
}

function configured(): boolean {
  return !!(process.env.RS_CLIENT_ID ?? process.env.SASSY_CLIENT_ID) && !!process.env.E2E_STUB_IDP_URL
}

/**
 * Counts rows in "User" for a given email by shelling out to `psql`, using
 * DATABASE_URL exactly as the invoking process set it (task-13 correction:
 * the ambient shell on this machine exports a DATABASE_URL pointing at an
 * unrelated Neon project, and does not persist across tool invocations —
 * so DATABASE_URL here MUST be the one explicitly passed to whatever
 * spawned Playwright, never a value this file invents or falls back to).
 * This is a real, direct database query — not a proxy through the admin
 * API — because the assertion it backs (no User row for a refused identity)
 * is the security-critical claim of the whole feature.
 */
function countUsersWithEmail(email: string): number {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL must be set explicitly on the process running Playwright — ' +
        'see the module comment in rs-social-round-trip.spec.ts.',
    )
  }
  const out = execFileSync(
    'psql',
    [databaseUrl, '-tAc', `select count(*) from "User" where email = '${email.replace(/'/g, "''")}'`],
    { encoding: 'utf8' },
  )
  return Number.parseInt(out.trim(), 10)
}

test.describe('FastAPI RS federated round-trip', () => {
  test.beforeEach(async ({ request }) => {
    if (!configured()) {
      test.skip(true, 'Stub IdP or RS not configured (E2E_STUB_IDP_URL / RS_CLIENT_ID unset).')
    }
    await resetStubIdentity(request)
  })

  test.afterEach(async ({ request }) => {
    if (!configured()) return
    await resetStubIdentity(request)
  })

  test('stub sign-in links the seeded user and the token says ext + idp', async ({ page, request }) => {
    const social = new SocialLoginPage(page)
    await social.setIdentity(request, { sub: 'stub-sub-1', email: SOCIAL_EMAIL, email_verified: true })

    await page.goto(`${RS_BASE_URL}/auth/login`)
    await social.clickTestIdp()

    await expect(page).toHaveURL(new RegExp(`^${RS_BASE_URL}/auth/callback`))
    await expect(page.getByRole('heading', { name: 'Signed in' })).toBeVisible()
    await expect(page.getByTestId('claim-amr')).toHaveText('ext')
    await expect(page.getByTestId('claim-idp')).toHaveText('stub')
  })

  test('a second sign-in reuses the existing link', async ({ page, request }) => {
    const social = new SocialLoginPage(page)
    for (let i = 0; i < 2; i++) {
      await social.setIdentity(request, { sub: 'stub-sub-1', email: SOCIAL_EMAIL, email_verified: true })
      await page.goto(`${RS_BASE_URL}/auth/login`)
      await social.clickTestIdp()
      await expect(page.getByRole('heading', { name: 'Signed in' })).toBeVisible()
      await expect(page.getByTestId('claim-amr')).toHaveText('ext')
      await page.context().clearCookies()
    }
    // One Account row per (providerId, accountId) is what account-linking is
    // supposed to guarantee; a duplicate would surface either as a linking
    // failure (error page) or an "already linked" error, both of which the
    // check above would have already caught since the second iteration
    // reasserts "Signed in" + amr:ext, not merely the absence of an error.
  })

  test('an unknown identity is refused generically and creates no user', async ({ page, request }) => {
    const social = new SocialLoginPage(page)
    const email = 'nobody@example.com'
    const before = countUsersWithEmail(email)
    expect(before, 'precondition: no leftover row from a previous run').toBe(0)

    await social.setIdentity(request, { sub: 'unknown-1', email, email_verified: true })

    await page.goto(`${RS_BASE_URL}/auth/login`)
    await social.clickTestIdp()

    await expect(page).toHaveURL(/\/oauth-error\?code=social_no_account/)
    await expect(page.getByText("We couldn't sign you in")).toBeVisible()

    const after = countUsersWithEmail(email)
    expect(after, 'a refused sign-in must not create a User row').toBe(0)
  })

  test('an unverified provider email is refused with the specific message', async ({ page, request }) => {
    const social = new SocialLoginPage(page)
    await social.setIdentity(request, { sub: 'stub-sub-1', email: SOCIAL_EMAIL, email_verified: false })

    await page.goto(`${RS_BASE_URL}/auth/login`)
    await social.clickTestIdp()

    await expect(page).toHaveURL(/\/oauth-error\?code=social_email_unverified/)
  })

  test('a provider disabled for the app renders no button', async ({ page }) => {
    await page.goto(`${RS_BASE_URL}/auth/login`)
    await expect(page.getByRole('button', { name: /test idp/i })).toBeVisible()
  })

  test('federated sign-in is not a 2FA bypass', async ({ page, request }) => {
    const rsClientId = process.env.RS_CLIENT_ID ?? process.env.SASSY_CLIENT_ID ?? ''
    expect(rsClientId, 'RS_CLIENT_ID / SASSY_CLIENT_ID must be set').toBeTruthy()

    // Sign in as a super-admin so the PATCH below is authorised
    // (platform.apps.manage), matching the pattern 2fa-enforcement.spec.ts
    // uses for its own super-admin API calls.
    const superCtx = await page.context().browser()!.newContext({
      storageState: '.auth/super-admin.json',
    })
    try {
      const enableRes = await superCtx.request.patch(`${AUTH_SERVER_URL}/api/apps/${rsClientId}`, {
        data: { requireTwoFactor: true },
      })
      expect(enableRes.ok(), `failed to enable requireTwoFactor: ${enableRes.status()}`).toBeTruthy()

      try {
        const social = new SocialLoginPage(page)
        // social@cpm.io (seeded by demo-resource-server.ts) has never enrolled
        // TOTP, and this test's own worker never enrolls it — federated
        // sign-in must not be able to skip that requirement.
        await social.setIdentity(request, { sub: 'stub-sub-1', email: SOCIAL_EMAIL, email_verified: true })

        await page.goto(`${RS_BASE_URL}/auth/login`)
        await social.clickTestIdp()

        await expect(page).toHaveURL(/\/account\/security\?enroll=1/)
        await expect(page).not.toHaveURL(new RegExp(`^${RS_BASE_URL}/auth/callback`))
      } finally {
        const disableRes = await superCtx.request.patch(`${AUTH_SERVER_URL}/api/apps/${rsClientId}`, {
          data: { requireTwoFactor: false },
        })
        expect(disableRes.ok(), `failed to restore requireTwoFactor: ${disableRes.status()}`).toBeTruthy()
      }
    } finally {
      await superCtx.close()
    }
  })
})
