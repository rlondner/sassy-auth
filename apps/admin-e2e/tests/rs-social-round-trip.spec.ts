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

/**
 * Counts `Account` rows for the given user's email + providerId, direct
 * against the database (same rationale/mechanism as countUsersWithEmail
 * above). Added as fix-round-1 finding 2: the "second sign-in reuses the
 * existing link" test previously only asserted the UI said "Signed in"
 * twice, on the unbacked assumption that a duplicate Account row would
 * surface as a visible failure. It would not — `Account` has no unique
 * constraint on (providerId, accountId) in schema.prisma, only an index on
 * userId — so a regression toward unconditional `create` (instead of
 * find-or-create) would write a second row silently and this test would
 * stay green. This counts the real row count before/after the second
 * sign-in so that regression is actually caught.
 */
function countAccountsForEmail(email: string, providerId: string): number {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL must be set explicitly on the process running Playwright — ' +
        'see the module comment in rs-social-round-trip.spec.ts.',
    )
  }
  const escapedEmail = email.replace(/'/g, "''")
  const escapedProvider = providerId.replace(/'/g, "''")
  const out = execFileSync(
    'psql',
    [
      databaseUrl,
      '-tAc',
      `select count(*) from "Account" a join "User" u on u.id = a."userId" ` +
        `where u.email = '${escapedEmail}' and a."providerId" = '${escapedProvider}'`,
    ],
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

    // Fix round 1, finding 2: assert the real row count, not just that the
    // UI looked fine — see countAccountsForEmail's comment for why the UI
    // assertions below cannot, by themselves, catch a duplicate Account row.
    const before = countAccountsForEmail(SOCIAL_EMAIL, 'stub')

    for (let i = 0; i < 2; i++) {
      await social.setIdentity(request, { sub: 'stub-sub-1', email: SOCIAL_EMAIL, email_verified: true })
      await page.goto(`${RS_BASE_URL}/auth/login`)
      await social.clickTestIdp()
      await expect(page.getByRole('heading', { name: 'Signed in' })).toBeVisible()
      await expect(page.getByTestId('claim-amr')).toHaveText('ext')
      await page.context().clearCookies()
    }

    const after = countAccountsForEmail(SOCIAL_EMAIL, 'stub')
    expect(after, 'a second sign-in must reuse the existing Account row, not create a duplicate').toBe(before)
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
    // Fix round 1, finding 4: this test's name promises "refused with the
    // specific message", but only the URL's error code was ever checked —
    // unlike the adjacent unknown-identity test, which asserts on the
    // rendered heading text too. Match that pattern here (heading text from
    // apps/admin/messages/en.json's oauthError.codes.social_email_unverified.heading).
    await expect(page.getByText('Email address not verified')).toBeVisible()
  })

  test('a provider disabled for the app renders no button', async ({ page, request }) => {
    // Fix round 1, finding 1: this test used to never disable anything and
    // asserted the button WAS visible — the opposite of its own name, and a
    // silent coverage gap for a security-relevant path (an admin-disabled
    // provider must not remain a live sign-in vector). It now drives the
    // real authenticated admin API exactly as an operator would.
    const rsClientId = process.env.RS_CLIENT_ID ?? process.env.SASSY_CLIENT_ID ?? ''
    expect(rsClientId, 'RS_CLIENT_ID / SASSY_CLIENT_ID must be set').toBeTruthy()

    // Capture the real current enabled set via the same public GET the
    // login page itself calls (social-providers.ts), so restoration below
    // writes back exactly what was there — never an assumed/hardcoded list.
    const beforeRes = await request.get(
      `${AUTH_SERVER_URL}/api/social-providers?client_id=${encodeURIComponent(rsClientId)}`,
    )
    expect(beforeRes.ok(), `GET /api/social-providers failed: ${beforeRes.status()}`).toBeTruthy()
    const { providers: originalEnabled } = (await beforeRes.json()) as { providers: string[] }
    expect(
      originalEnabled,
      'stub must already be enabled for the RS app for this test to prove anything by disabling it',
    ).toContain('stub')

    // Authenticate as a super-admin the same way the "not a 2FA bypass" test
    // below does: a fresh browser context loaded with
    // '.auth/super-admin.json' (produced by the `setup` project's
    // auth-state.setup.ts). PUT /api/social-providers/:clientId requires
    // platform.apps.manage (social.controller.ts), and this spec's own
    // `page`/`request` fixtures run in the unauthenticated `chromium`
    // project, so a second, explicitly-authenticated context is required —
    // there is no way to drive this endpoint from this spec's own project
    // without one.
    const superCtx = await page.context().browser()!.newContext({
      storageState: '.auth/super-admin.json',
    })
    try {
      const disabledSet = originalEnabled.filter((p) => p !== 'stub')

      // try/finally (not afterEach): the captured `originalEnabled` list is
      // local to this test and would not be available to a separate
      // afterEach hook without hoisting it to module state shared with every
      // other test in the file — try/finally keeps the restore colocated
      // with exactly the value it must restore, and (like the "not a 2FA
      // bypass" test's own finally below) runs even if the assertion after
      // the PUT throws, so one failure here never leaves every later test in
      // this file without a stub button.
      try {
        const putRes = await superCtx.request.put(`${AUTH_SERVER_URL}/api/social-providers/${rsClientId}`, {
          data: { providers: disabledSet },
        })
        expect(putRes.ok(), `failed to disable stub for the RS app: ${putRes.status()}`).toBeTruthy()

        await page.goto(`${RS_BASE_URL}/auth/login`)
        await expect(page.getByRole('button', { name: /test idp/i })).toHaveCount(0)
      } finally {
        const restoreRes = await superCtx.request.put(`${AUTH_SERVER_URL}/api/social-providers/${rsClientId}`, {
          data: { providers: originalEnabled },
        })
        expect(restoreRes.ok(), `failed to restore social providers for the RS app: ${restoreRes.status()}`).toBeTruthy()
      }
    } finally {
      await superCtx.close()
    }
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
