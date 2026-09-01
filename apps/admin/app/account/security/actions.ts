'use server'

import { cookies } from 'next/headers'
import { AUTH_SERVER_URL } from '@/lib/config'
import { getForwardedOrigin } from '@/lib/auth-origin'

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

/**
 * Forward the session cookie header from the incoming request so BetterAuth
 * can authenticate the server-action call. Mirrors forwardSessionCookie in
 * apps/admin/app/login/actions.ts but for reads (we forward the inbound
 * cookie, not parse a new Set-Cookie from the response).
 */
async function getSessionCookieHeader(): Promise<string> {
  const cookieStore = await cookies()
  return cookieStore.toString()
}

/**
 * Parse and set a named cookie from a Set-Cookie response header.
 * Used to forward the temporary 2FA cookie that BetterAuth returns after the
 * first factor when a user has 2FA enabled (twoFactorRedirect = true).
 */
export async function forwardNamedCookie(
  res: Response,
  cookieName: string,
): Promise<boolean> {
  const cookieStore = await cookies()
  const setCookieHeader = res.headers.get('set-cookie')
  if (!setCookieHeader) return false

  // Split on ", " boundary between separate cookies (not within Expires dates).
  const parts = setCookieHeader.split(/,(?=\s*[A-Za-z0-9!#$%&'*+\-.^_`|~]+=)/)
  for (const part of parts) {
    const segments = part.split(';').map((s) => s.trim())
    const [namePair, ...attrs] = segments
    const eq = namePair.indexOf('=')
    if (eq < 0) continue
    const name = namePair.slice(0, eq)
    if (name !== cookieName) continue

    let value: string
    try {
      value = decodeURIComponent(namePair.slice(eq + 1))
    } catch {
      value = namePair.slice(eq + 1)
    }

    const options: Parameters<typeof cookieStore.set>[2] = { path: '/' }
    for (const attr of attrs) {
      const [k, v] = attr.split('=', 2)
      switch (k.toLowerCase()) {
        case 'httponly': options.httpOnly = true; break
        case 'secure': options.secure = true; break
        case 'samesite': {
          const lower = (v ?? '').toLowerCase()
          if (lower === 'lax' || lower === 'strict' || lower === 'none') {
            options.sameSite = lower
          }
          break
        }
        case 'path': if (v) options.path = v; break
        case 'max-age': {
          const n = Number(v)
          if (Number.isFinite(n)) options.maxAge = n
          break
        }
        case 'expires':
          if (v) {
            const d = new Date(v)
            if (!Number.isNaN(d.getTime())) options.expires = d
          }
          break
      }
    }
    cookieStore.set(cookieName, value, options)
    return true
  }
  return false
}

/**
 * Same as forwardNamedCookie but overrides the Max-Age attribute.
 * Used to honour per-app twoFactorTrustDays when re-setting the
 * better-auth.trust_device cookie after a successful TOTP verify.
 */
export async function forwardNamedCookieWithMaxAge(
  res: Response,
  cookieName: string,
  maxAgeOverride: number,
): Promise<boolean> {
  const cookieStore = await cookies()
  const setCookieHeader = res.headers.get('set-cookie')
  if (!setCookieHeader) return false

  const parts = setCookieHeader.split(/,(?=\s*[A-Za-z0-9!#$%&'*+\-.^_`|~]+=)/)
  for (const part of parts) {
    const segments = part.split(';').map((s) => s.trim())
    const [namePair = '', ...attrs] = segments
    const eq = namePair.indexOf('=')
    if (eq < 0) continue
    const name = namePair.slice(0, eq)
    if (name !== cookieName) continue

    let value: string
    try { value = decodeURIComponent(namePair.slice(eq + 1)) } catch { value = namePair.slice(eq + 1) }

    const options: Parameters<typeof cookieStore.set>[2] = { path: '/', maxAge: maxAgeOverride }
    for (const attr of attrs) {
      const [k = '', v] = attr.split('=', 2)
      switch (k.toLowerCase()) {
        case 'httponly': options.httpOnly = true; break
        case 'secure': options.secure = true; break
        case 'samesite': {
          const lower = (v ?? '').toLowerCase()
          if (lower === 'lax' || lower === 'strict' || lower === 'none') {
            options.sameSite = lower as 'lax' | 'strict' | 'none'
          }
          break
        }
        case 'path': if (v) options.path = v; break
        // max-age from BetterAuth intentionally ignored — using maxAgeOverride.
      }
    }
    cookieStore.set(cookieName, value, options)
    return true
  }
  return false
}

/**
 * Pull a single cookie's decoded value out of a Set-Cookie response header,
 * without touching the Next.js cookie jar. Used when a follow-up server-side
 * call needs to authenticate as the session a response just minted, rather
 * than the (now-stale) session on the incoming request.
 */
function extractSetCookieValue(res: Response, cookieName: string): string | undefined {
  const setCookieHeader = res.headers.get('set-cookie')
  if (!setCookieHeader) return undefined

  const parts = setCookieHeader.split(/,(?=\s*[A-Za-z0-9!#$%&'*+\-.^_`|~]+=)/)
  for (const part of parts) {
    const [namePair = ''] = part.split(';').map((s) => s.trim())
    const eq = namePair.indexOf('=')
    if (eq < 0) continue
    if (namePair.slice(0, eq) !== cookieName) continue
    try {
      return decodeURIComponent(namePair.slice(eq + 1))
    } catch {
      return namePair.slice(eq + 1)
    }
  }
  return undefined
}

/**
 * bug-0275: enabling 2FA only rotates the session on the device where it was
 * enabled (better-auth creates a new session, deletes the old one) — any
 * other still-valid session for this user was never re-verified against 2FA.
 * deriveAuthMethods stamps `amr` from the account's live `twoFactorEnabled`
 * flag, so those other sessions would later mint OAuth codes falsely
 * asserting `otp`/`mfa` to resource servers. Revoking every other session the
 * moment 2FA is confirmed closes the gap the same way account deactivation
 * already does (users.service.ts) — best-effort: a failure here must not
 * turn a successful enrollment into a reported error.
 */
async function revokeOtherSessions(rotatedSessionToken: string, origin: string | null): Promise<void> {
  try {
    await fetch(`${AUTH_SERVER_URL}/api/auth/revoke-other-sessions`, {
      method: 'POST',
      headers: {
        Cookie: `better-auth.session_token=${rotatedSessionToken}`,
        ...(origin && { Origin: origin }),
      },
    })
  } catch {
    // Best-effort — see doc comment above.
  }
}

// ---------------------------------------------------------------------------
// 2FA server actions
// ---------------------------------------------------------------------------

export type Enable2faResult =
  | { totpURI: string; backupCodes: string[] }
  | { error: string }

/**
 * Step 1 of enrollment: POST /two-factor/enable with the user's password.
 * Returns { totpURI, backupCodes } on success — the caller renders the QR
 * and shows the backup codes ONCE. NEVER log totpURI or backupCodes.
 */
export async function enable2fa(formData: FormData): Promise<Enable2faResult> {
  const password = formData.get('password') as string
  if (!password) return { error: 'invalidPassword' }

  const origin = await getForwardedOrigin()
  const cookieHeader = await getSessionCookieHeader()

  let res: Response
  try {
    res = await fetch(`${AUTH_SERVER_URL}/api/auth/two-factor/enable`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieHeader,
        ...(origin && { Origin: origin }),
      },
      body: JSON.stringify({ password }),
    })
  } catch {
    return { error: 'serverUnavailable' }
  }

  if (!res.ok) {
    // /two-factor/* is a sensitive prefix for the auth rate limiter, so a
    // throttled call must say so rather than fall through to the catch-all
    // "something went wrong" — the one actionable fact is that they should
    // wait.
    if (res.status === 429) return { error: 'tooManyRequests' }
    // better-auth 1.6.11 returns 400 for an invalid password on the enable
    // endpoint (BAD_REQUEST / INVALID_PASSWORD in index.mjs).
    if (res.status === 400 || res.status === 401 || res.status === 403) return { error: 'invalidPassword' }
    return { error: 'generic' }
  }

  let body: { totpURI: string; backupCodes: string[] }
  try {
    body = (await res.json()) as { totpURI: string; backupCodes: string[] }
  } catch {
    return { error: 'generic' }
  }
  // Security: do not log body — it contains the TOTP URI and backup codes.
  return { totpURI: body.totpURI, backupCodes: body.backupCodes }
}

export type ConfirmEnableResult = { ok: true } | { error: string }

/**
 * Step 2 of enrollment: POST /two-factor/verify-totp with a live code.
 * Confirms enrollment — twoFactorEnabled flips to true only after this call.
 */
export async function confirmEnable(formData: FormData): Promise<ConfirmEnableResult> {
  const code = formData.get('code') as string
  if (!code) return { error: 'invalidCode' }

  const origin = await getForwardedOrigin()
  const cookieHeader = await getSessionCookieHeader()

  let res: Response
  try {
    res = await fetch(`${AUTH_SERVER_URL}/api/auth/two-factor/verify-totp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieHeader,
        ...(origin && { Origin: origin }),
      },
      body: JSON.stringify({ code }),
    })
  } catch {
    return { error: 'serverUnavailable' }
  }

  if (!res.ok) {
    // Same rate-limit budget as the other two-factor endpoints; a throttled
    // confirm must not be reported as a bad code.
    if (res.status === 429) return { error: 'tooManyRequests' }
    // better-auth 1.6.11 returns 401 for an invalid TOTP code
    // (INVALID_CODE → UNAUTHORIZED in verify-two-factor.mjs).
    if (res.status === 400 || res.status === 401) return { error: 'invalidCode' }
    return { error: 'generic' }
  }

  // better-auth rotates the session when confirm flips twoFactorEnabled on —
  // it creates a new session and deletes the old one. Forward the new session
  // token so the browser's cookie stays valid after enable completes.
  await forwardNamedCookie(res, 'better-auth.session_token')

  // bug-0275: also revoke every other active session for this user now that
  // 2FA is on, so a device that never completed the 2FA challenge can't keep
  // minting OAuth codes that falsely claim `amr: ['otp','mfa']`.
  const rotatedToken = extractSetCookieValue(res, 'better-auth.session_token')
  if (rotatedToken) {
    await revokeOtherSessions(rotatedToken, origin)
  }

  return { ok: true }
}

export type Disable2faResult = { ok: true } | { error: string }

/**
 * Disable 2FA. Requires the user's password.
 * POST /two-factor/disable.
 */
export async function disable2fa(formData: FormData): Promise<Disable2faResult> {
  const password = formData.get('password') as string
  if (!password) return { error: 'invalidPassword' }

  const origin = await getForwardedOrigin()
  const cookieHeader = await getSessionCookieHeader()

  let res: Response
  try {
    res = await fetch(`${AUTH_SERVER_URL}/api/auth/two-factor/disable`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieHeader,
        ...(origin && { Origin: origin }),
      },
      body: JSON.stringify({ password }),
    })
  } catch {
    return { error: 'serverUnavailable' }
  }

  if (!res.ok) {
    // /two-factor/* is a sensitive prefix for the auth rate limiter, so a
    // throttled call must say so rather than fall through to the catch-all
    // "something went wrong" — the one actionable fact is that they should
    // wait.
    if (res.status === 429) return { error: 'tooManyRequests' }
    // better-auth 1.6.11 returns 400 for an invalid password on the disable
    // endpoint (BAD_REQUEST / INVALID_PASSWORD in index.mjs).
    if (res.status === 400 || res.status === 401 || res.status === 403) return { error: 'invalidPassword' }
    return { error: 'generic' }
  }

  // better-auth rotates the session on the way DOWN as well as up: the
  // disable handler creates a new session, sets it via Set-Cookie, and then
  // deletes the caller's existing token (dist/plugins/two-factor/index.mjs,
  // disableTwoFactor). Without forwarding the replacement the browser keeps a
  // token that no longer exists, so the user is bounced to /login on the next
  // navigation while this action has already reported success. confirmEnable
  // has handled the enable direction since it was written; this is the mirror.
  await forwardNamedCookie(res, 'better-auth.session_token')
  // The same response expires the trust-device cookie when the user had one,
  // its verification record having just been deleted server-side. Forward that
  // too rather than leaving a cookie pointing at nothing.
  await forwardNamedCookie(res, 'better-auth.trust_device')

  return { ok: true }
}

export type RegenerateBackupCodesResult =
  | { backupCodes: string[] }
  | { error: string }

/**
 * Regenerate backup codes. Requires the user's password. Returns the new
 * codes ONCE — never logged.
 * POST /two-factor/generate-backup-codes.
 */
export async function regenerateBackupCodes(
  formData: FormData,
): Promise<RegenerateBackupCodesResult> {
  const password = formData.get('password') as string
  if (!password) return { error: 'invalidPassword' }

  const origin = await getForwardedOrigin()
  const cookieHeader = await getSessionCookieHeader()

  let res: Response
  try {
    res = await fetch(`${AUTH_SERVER_URL}/api/auth/two-factor/generate-backup-codes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieHeader,
        ...(origin && { Origin: origin }),
      },
      body: JSON.stringify({ password }),
    })
  } catch {
    return { error: 'serverUnavailable' }
  }

  if (!res.ok) {
    // Same rate-limit budget as the other two-factor endpoints; a throttled
    // regeneration must not be reported as a bad password.
    if (res.status === 429) return { error: 'tooManyRequests' }
    // better-auth 1.6.11 returns 400 for an invalid password on the
    // generate-backup-codes endpoint (BAD_REQUEST / INVALID_PASSWORD).
    if (res.status === 400 || res.status === 401 || res.status === 403) return { error: 'invalidPassword' }
    return { error: 'generic' }
  }

  let body: { backupCodes: string[] }
  try {
    body = (await res.json()) as { backupCodes: string[] }
  } catch {
    return { error: 'generic' }
  }
  // Security: do not log body.
  return { backupCodes: body.backupCodes }
}
