import * as crypto from 'crypto'
import { expect, type APIRequestContext } from '@playwright/test'

/**
 * Shared OAuth-related Playwright helpers: PKCE pair generation, lookup of
 * the platform app via /api/apps, and authorize URL composition. Used by
 * specs in tests/authed/ that exercise the auth-server's authorize endpoint
 * and the admin's session-aware /login.
 */

export const AUTH_SERVER_URL = process.env.AUTH_SERVER_URL ?? 'http://localhost:3000'
export const ADMIN_URL = process.env.ADMIN_URL ?? 'http://localhost:3001'

export function s256(verifier: string): string {
  return crypto
    .createHash('sha256')
    .update(verifier)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export function newPkce(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(64).toString('base64url')
  return { verifier, challenge: s256(verifier) }
}

export interface AppRow {
  publicId: string
  url: string
  isPlatform: boolean
}

/**
 * Look up the platform app via the admin API. Uses the caller's
 * APIRequestContext, which inherits cookies from storageState — so the
 * request is authenticated as whichever admin owns the project.
 */
export async function fetchPlatformApp(request: APIRequestContext): Promise<AppRow> {
  const res = await request.get(`${AUTH_SERVER_URL}/api/apps`)
  expect(res.ok(), `GET /api/apps failed: ${res.status()} ${await res.text()}`).toBe(true)
  const body = (await res.json()) as { items: ReadonlyArray<AppRow> }
  const platform = body.items.find((a) => a.isPlatform)
  expect(platform, 'no platform app returned from /api/apps').toBeDefined()
  return platform!
}

/**
 * Returns the first non-platform app from /api/apps, or null if none exists.
 * Used to exercise the USER_ORG_MISMATCH path where the super admin (member
 * of the platform org) authorizes against a different app.
 */
export async function fetchAnyNonPlatformApp(
  request: APIRequestContext,
): Promise<AppRow | null> {
  const res = await request.get(`${AUTH_SERVER_URL}/api/apps`)
  if (!res.ok()) return null
  const body = (await res.json()) as { items: ReadonlyArray<AppRow> }
  return body.items.find((a) => !a.isPlatform) ?? null
}

export function buildAuthorizeUrl(params: Record<string, string>): string {
  return `${AUTH_SERVER_URL}/api/token/oauth/authorize?${new URLSearchParams(params).toString()}`
}

/**
 * Builds an authorize URL for the platform app with valid PKCE and a
 * matching redirect_uri (path /cb under the platform app's origin).
 * The /cb path does not exist on the auth-server and yields a 404, but
 * the browser still lands on the redirect URL the auth-server emits.
 */
export function buildValidAuthorizeFlow(
  platformApp: AppRow,
  state: string,
): { authorizeUrl: string; redirectUri: string; verifier: string } {
  const { verifier, challenge } = newPkce()
  const redirectUri = `${platformApp.url.replace(/\/$/, '')}/cb`
  const authorizeUrl = buildAuthorizeUrl({
    client_id: platformApp.publicId,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  })
  return { authorizeUrl, redirectUri, verifier }
}

export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
