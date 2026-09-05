import { request as pwRequest, expect } from '@playwright/test'
import path from 'path'
import { SEED_ADMINS } from './admins'

/**
 * Admin-API app creation for e2e specs that need a purpose-built SaApp
 * (e.g. one with a specific password policy override) rather than the
 * shared RS_CLIENT_ID fixture app used by rs-round-trip.spec.ts /
 * signup.spec.ts's base test.
 *
 * POST /api/apps deliberately does not accept passwordPolicyOverride (see
 * design spec §7) — only PATCH /api/apps/:publicId does — so this always
 * creates first, then patches. Callers get back the created app's publicId
 * to drive the browser-facing flow (e.g. /signup?client_id=<publicId>).
 *
 * Auth: AppsController's endpoints sit behind BetterAuthGuard and require
 * platform.apps.manage, so this authenticates via the 'apps' seed admin's
 * saved storageState (populated by auth-state.setup.ts, which every
 * chromium* project depends on) rather than the test's own (often
 * unauthenticated) page/request fixtures. Mirrors fetchPlatformApp in
 * oauth-fixtures.ts: an authenticated APIRequestContext talking directly to
 * AUTH_SERVER_URL.
 */

export const AUTH_SERVER_URL = process.env.AUTH_SERVER_URL ?? 'http://localhost:3000'

// Mirrors PasswordPolicy from packages/types/index.ts. Duplicated rather than
// imported: admin-e2e intentionally doesn't depend on the app build graph
// (see the header comment in lib/admins.ts for the same rationale).
export interface PasswordPolicyOverride {
  minLength: number
  requireUppercase: boolean
  requireLowercase: boolean
  requireNumber: boolean
  requireSpecial: boolean
  minNumbers: number
  minSpecial: number
}

export interface CreatedApp {
  publicId: string
  name: string
  url: string
}

/**
 * Creates a fresh SaApp via POST /api/apps, then PATCHes it with the given
 * password policy override via PATCH /api/apps/:publicId. Returns the app's
 * publicId (usable directly as the /signup ?client_id=).
 */
export async function createAppWithPasswordPolicyOverride(
  passwordPolicyOverride: PasswordPolicyOverride,
): Promise<CreatedApp> {
  const appsAdmin = SEED_ADMINS.find((a) => a.key === 'apps')
  if (!appsAdmin) throw new Error("SEED_ADMINS has no 'apps' admin")

  const ctx = await pwRequest.newContext({
    baseURL: AUTH_SERVER_URL,
    storageState: path.join(__dirname, '..', appsAdmin.storageStatePath),
  })
  try {
    const name = `e2e-policy-app-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const createRes = await ctx.post('/api/apps', {
      data: { name, url: `https://example.com/${name}` },
    })
    expect(createRes.ok(), `POST /api/apps failed: ${createRes.status()} ${await createRes.text()}`).toBe(true)
    const created = (await createRes.json()) as CreatedApp

    const patchRes = await ctx.patch(`/api/apps/${created.publicId}`, {
      data: { passwordPolicyOverride },
    })
    expect(
      patchRes.ok(),
      `PATCH /api/apps/${created.publicId} failed: ${patchRes.status()} ${await patchRes.text()}`,
    ).toBe(true)

    return created
  } finally {
    await ctx.dispose()
  }
}
