'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import * as Sentry from '@sentry/nextjs'
import { getForwardedOrigin } from '@/lib/auth-origin'
import { validateNextUrl } from '@/lib/safe-next'
import { AUTH_SERVER_URL } from '@/lib/config'
import { forwardNamedCookie } from '../account/security/actions'
import { shouldPromptTwoFactor, getSystemTrustDaysClient } from '@/lib/two-factor-prompt'

interface ParsedSessionCookie {
  value: string
  httpOnly: boolean
  secure?: boolean
  sameSite?: 'lax' | 'strict' | 'none'
  path?: string
  domain?: string
  maxAge?: number
  expires?: Date
}

// Known limitation: the comma-splitting regex may fail when Node concatenates
// multiple Set-Cookie headers with ", " and one contains an Expires date.
// BetterAuth currently returns a single session cookie so this is safe.
// Consider replacing with `set-cookie-parser` if more cookies are added.
//
// Parse the first Set-Cookie clause that matches `better-auth.session_token=...`.
// Node fetch combines multiple Set-Cookie headers with ", " — split on that
// boundary while NOT splitting on the "," inside an Expires=Wed, 21 Oct ... date.
function parseSessionCookie(header: string): ParsedSessionCookie | null {
  // Cookies are separated by ", " followed by a token=value pair.
  // The regex below splits only when the next segment starts with cookie-name.
  const cookies = header.split(/,(?=\s*[A-Za-z0-9!#$%&'*+\-.^_`|~]+=)/)
  for (const cookie of cookies) {
    const parts = cookie.split(';').map((p) => p.trim())
    const [namePair, ...attrs] = parts
    const eq = namePair.indexOf('=')
    if (eq < 0) continue
    const name = namePair.slice(0, eq)
    if (name !== 'better-auth.session_token') continue
    // The upstream Set-Cookie carries the value in its on-the-wire form
    // (e.g. base64 `=` arrives as `%3D`). Next.js's cookieStore.set runs
    // the value through cookie.serialize, which encodeURIComponent's it
    // again — yielding `%253D` on the wire. better-auth's parser decodes
    // exactly once, so the signature ends up as `…%3D` (length 48 ≠ 44),
    // session lookup returns null, and every refresh bounces to /login.
    // Single-decode here so the round-trip is identity.
    let value: string
    try {
      value = decodeURIComponent(namePair.slice(eq + 1))
    } catch {
      value = namePair.slice(eq + 1)
    }

    const parsed: ParsedSessionCookie = { value, httpOnly: false }
    for (const attr of attrs) {
      const [k, v] = attr.split('=', 2)
      switch (k.toLowerCase()) {
        case 'httponly':
          parsed.httpOnly = true
          break
        case 'secure':
          parsed.secure = true
          break
        case 'samesite': {
          const lower = (v ?? '').toLowerCase()
          if (lower === 'lax' || lower === 'strict' || lower === 'none') {
            parsed.sameSite = lower
          }
          break
        }
        case 'path':
          if (v) parsed.path = v
          break
        case 'domain':
          if (v) parsed.domain = v
          break
        case 'max-age': {
          const n = Number(v)
          if (Number.isFinite(n)) parsed.maxAge = n
          break
        }
        case 'expires':
          if (v) {
            const d = new Date(v)
            if (!Number.isNaN(d.getTime())) parsed.expires = d
          }
          break
      }
    }
    return parsed
  }
  return null
}

async function forwardSessionCookie(res: Response): Promise<boolean> {
  const cookieStore = await cookies()
  const setCookieHeader = res.headers.get('set-cookie')
  if (!setCookieHeader) {
    Sentry.captureMessage('Auth server returned 200 but no Set-Cookie header', { level: 'error' })
    return false
  }
  const parsed = parseSessionCookie(setCookieHeader)
  if (!parsed) {
    Sentry.captureMessage('Failed to parse session cookie from auth server response', { level: 'error' })
    return false
  }
  cookieStore.set('better-auth.session_token', parsed.value, {
    httpOnly: parsed.httpOnly,
    secure: parsed.secure ?? process.env.NODE_ENV === 'production',
    sameSite: parsed.sameSite ?? 'lax',
    path: parsed.path ?? '/',
    ...(parsed.maxAge !== undefined && { maxAge: parsed.maxAge }),
    ...(parsed.expires !== undefined && { expires: parsed.expires }),
    ...(parsed.domain !== undefined && { domain: parsed.domain }),
  })
  return true
}

export async function signIn(formData: FormData): Promise<{ error?: string } | { twoFactor: true }> {
  const email = formData.get('email') as string
  const password = formData.get('password') as string

  if (!email || !password) {
    Sentry.addBreadcrumb({
      category: 'auth',
      message: 'Admin login failed',
      level: 'warning',
    })
    return { error: 'Email and password are required.' }
  }

  const origin = await getForwardedOrigin()

  let res: Response
  try {
    res = await fetch(`${AUTH_SERVER_URL}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(origin && { Origin: origin }),
      },
      body: JSON.stringify({ email, password }),
    })
  } catch (err) {
    // Transport-level failure (auth server down, DNS, TLS). Surface a
    // dedicated error so the form can prompt the operator to retry
    // instead of crashing the action with a 500.
    Sentry.captureException(err, { tags: { area: 'auth', action: 'admin-login' } })
    return { error: 'serverUnavailable' }
  }

  if (!res.ok) {
    Sentry.addBreadcrumb({ category: 'auth', message: 'Admin login failed', level: 'warning' })
    if (res.status === 401) return { error: 'invalidCredentials' }
    if (res.status === 403) return { error: 'inactive' }
    return { error: 'invalidCredentials' }
  }

  // Detect 2FA challenge. BetterAuth returns { twoFactorRedirect: true } with
  // a temp 2FA cookie (better-auth.two_factor) instead of a session cookie.
  let responseBody: Record<string, unknown> = {}
  try {
    responseBody = (await res.clone().json()) as Record<string, unknown>
  } catch {
    // Non-JSON response — treat as normal session response.
  }

  if (responseBody['twoFactorRedirect'] === true) {
    // Forward the temporary 2FA cookie so the browser can present it on the
    // /login/two-factor page. Do NOT set a session cookie.
    await forwardNamedCookie(res, 'better-auth.two_factor')
    return { twoFactor: true } as { twoFactor: true }
  }

  const ok = await forwardSessionCookie(res)
  if (!ok) return { error: 'invalidCredentials' }

  Sentry.addBreadcrumb({ category: 'auth', message: 'Admin login successful', level: 'info' })
  const nextRaw = formData.get('next')
  const nextSafe = typeof nextRaw === 'string' ? validateNextUrl(nextRaw) : null

  // Optional 2FA interstitial: show once per interval for unenrolled users.
  // Read twoFactorEnabled from the just-established session.
  const cookieStore2 = await cookies()
  let twoFactorEnabled = false
  let twoFactorPromptedAt: string | null = null
  try {
    const [sessRes, statusRes] = await Promise.all([
      fetch(`${AUTH_SERVER_URL}/api/auth/get-session`, {
        headers: { Cookie: cookieStore2.toString() },
        cache: 'no-store',
      }),
      fetch(`${AUTH_SERVER_URL}/api/me/two-factor-status`, {
        headers: { Cookie: cookieStore2.toString() },
        cache: 'no-store',
      }),
    ])
    if (sessRes.ok) {
      const sess = (await sessRes.json()) as { user?: { twoFactorEnabled?: boolean } } | null
      twoFactorEnabled = sess?.user?.twoFactorEnabled ?? false
    }
    if (statusRes.ok) {
      const statusData = (await statusRes.json()) as { twoFactorPromptedAt: string | null }
      twoFactorPromptedAt = statusData.twoFactorPromptedAt
    }
  } catch { /* fail open — no prompt on error */ }

  // Resolve interval: check if next contains a client_id for per-app override.
  let intervalDays = getSystemTrustDaysClient()
  if (nextSafe) {
    try {
      const nextUrl = new URL(nextSafe)
      const clientId = nextUrl.searchParams.get('client_id')
      if (clientId) {
        const trustRes = await fetch(
          `${AUTH_SERVER_URL}/api/token/app-trust-days?client_id=${encodeURIComponent(clientId)}`,
          { cache: 'no-store' },
        )
        if (trustRes.ok) {
          const data = (await trustRes.json()) as { effectiveTrustDays: number }
          intervalDays = data.effectiveTrustDays
        }
      }
    } catch { /* use system default */ }
  }

  if (shouldPromptTwoFactor({ twoFactorEnabled, promptedAt: twoFactorPromptedAt ? new Date(twoFactorPromptedAt) : null, now: new Date(), intervalDays })) {
    const encodedNext = nextSafe ? encodeURIComponent(nextSafe) : ''
    redirect(`/login/two-factor-prompt${encodedNext ? `?next=${encodedNext}` : ''}`)
  }

  redirect(nextSafe ?? '/users')
}

export async function requestOtp(formData: FormData): Promise<{ sent: true } | { error: string }> {
  const email = formData.get('email') as string
  if (!email) return { error: 'invalidCredentials' }

  const origin = await getForwardedOrigin()
  try {
    // Fire the request; the response status is intentionally ignored for the
    // client result. Whether the account exists/is active or not, the caller
    // gets a neutral { sent: true } (no user enumeration). Only a transport
    // failure is surfaced, so the operator knows to retry.
    await fetch(`${AUTH_SERVER_URL}/api/auth/email-otp/send-verification-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(origin && { Origin: origin }) },
      body: JSON.stringify({ email, type: 'sign-in' }),
    })
  } catch (err) {
    Sentry.captureException(err, { tags: { area: 'auth', action: 'otp-request' } })
    return { error: 'serverUnavailable' }
  }
  return { sent: true }
}

export async function verifyOtp(formData: FormData): Promise<{ error?: string }> {
  const email = formData.get('email') as string
  const otp = formData.get('otp') as string
  if (!email || !otp) return { error: 'invalidCode' }

  const origin = await getForwardedOrigin()
  let res: Response
  try {
    res = await fetch(`${AUTH_SERVER_URL}/api/auth/sign-in/email-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(origin && { Origin: origin }) },
      body: JSON.stringify({ email, otp }),
    })
  } catch (err) {
    Sentry.captureException(err, { tags: { area: 'auth', action: 'otp-verify' } })
    return { error: 'serverUnavailable' }
  }

  if (!res.ok) {
    Sentry.addBreadcrumb({ category: 'auth', message: 'Admin OTP login failed', level: 'warning' })
    // The session-creation gate rejects non-active users with 403 → inactive.
    if (res.status === 403) return { error: 'inactive' }
    return { error: 'invalidCode' }
  }

  const ok = await forwardSessionCookie(res)
  if (!ok) return { error: 'invalidCode' }

  Sentry.addBreadcrumb({ category: 'auth', message: 'Admin OTP login successful', level: 'info' })
  const nextRaw = formData.get('next')
  const nextSafe = typeof nextRaw === 'string' ? validateNextUrl(nextRaw) : null
  redirect(nextSafe ?? '/users')
}

export async function verifyTotp(formData: FormData): Promise<{ error?: string }> {
  const code = formData.get('code') as string
  const trustDevice = formData.get('trustDevice') === 'true'
  const nextRaw = formData.get('next')
  const nextSafe = typeof nextRaw === 'string' ? validateNextUrl(nextRaw) : null

  if (!code) return { error: 'invalidCode' }

  const origin = await getForwardedOrigin()
  const cookieStore = await cookies()
  // Forward all cookies so BetterAuth can validate the better-auth.two_factor temp cookie.
  const cookieHeader = cookieStore.toString()

  let res: Response
  try {
    res = await fetch(`${AUTH_SERVER_URL}/api/auth/two-factor/verify-totp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieHeader,
        ...(origin && { Origin: origin }),
      },
      body: JSON.stringify({ code, trustDevice }),
    })
  } catch (err) {
    Sentry.captureException(err, { tags: { area: 'auth', action: 'totp-verify' } })
    return { error: 'serverUnavailable' }
  }

  if (!res.ok) {
    Sentry.addBreadcrumb({ category: 'auth', message: 'TOTP verify failed', level: 'warning' })
    return { error: 'invalidCode' }
  }

  const ok = await forwardSessionCookie(res)
  if (!ok) return { error: 'serverUnavailable' }

  Sentry.addBreadcrumb({ category: 'auth', message: 'TOTP verify success', level: 'info' })
  redirect(nextSafe ?? '/users')
}

export async function verifyBackupCode(formData: FormData): Promise<{ error?: string }> {
  const code = formData.get('code') as string
  const nextRaw = formData.get('next')
  const nextSafe = typeof nextRaw === 'string' ? validateNextUrl(nextRaw) : null

  if (!code) return { error: 'invalidCode' }

  const origin = await getForwardedOrigin()
  const cookieStore = await cookies()
  const cookieHeader = cookieStore.toString()

  let res: Response
  try {
    res = await fetch(`${AUTH_SERVER_URL}/api/auth/two-factor/verify-backup-code`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieHeader,
        ...(origin && { Origin: origin }),
      },
      body: JSON.stringify({ code, trustDevice: false }),
    })
  } catch (err) {
    Sentry.captureException(err, { tags: { area: 'auth', action: 'backup-code-verify' } })
    return { error: 'serverUnavailable' }
  }

  if (!res.ok) {
    Sentry.addBreadcrumb({ category: 'auth', message: 'Backup code verify failed', level: 'warning' })
    return { error: 'invalidCode' }
  }

  const ok = await forwardSessionCookie(res)
  if (!ok) return { error: 'serverUnavailable' }

  Sentry.addBreadcrumb({ category: 'auth', message: 'Backup code verify success', level: 'info' })
  redirect(nextSafe ?? '/users')
}
