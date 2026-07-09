'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import * as Sentry from '@sentry/nextjs'
import { getForwardedOrigin } from '@/lib/auth-origin'
import { validateNextUrl } from '@/lib/safe-next'

const AUTH_SERVER = process.env.AUTH_SERVER_URL ?? 'http://localhost:3000'

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

export async function signIn(formData: FormData): Promise<{ error?: string }> {
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
    res = await fetch(`${AUTH_SERVER}/api/auth/sign-in/email`, {
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
    Sentry.addBreadcrumb({
      category: 'auth',
      message: 'Admin login failed',
      level: 'warning',
    })
    if (res.status === 401) return { error: 'invalidCredentials' }
    if (res.status === 403) return { error: 'inactive' }
    return { error: 'invalidCredentials' }
  }

  // Forward session cookie from auth server to the browser, preserving
  // the upstream Set-Cookie attributes (Max-Age, Expires, Path, Domain,
  // SameSite, HttpOnly, Secure). Hand-parse rather than regex-extract so
  // the lifetime upstream issued is honored on the client.
  const cookieStore = await cookies()
  const setCookieHeader = res.headers.get('set-cookie')
  if (setCookieHeader) {
    const parsed = parseSessionCookie(setCookieHeader)
    if (parsed) {
      cookieStore.set('better-auth.session_token', parsed.value, {
        httpOnly: parsed.httpOnly,
        secure: parsed.secure ?? process.env.NODE_ENV === 'production',
        sameSite: parsed.sameSite ?? 'lax',
        path: parsed.path ?? '/',
        ...(parsed.maxAge !== undefined && { maxAge: parsed.maxAge }),
        ...(parsed.expires !== undefined && { expires: parsed.expires }),
        ...(parsed.domain !== undefined && { domain: parsed.domain }),
      })
    }
  }

  // Do not pass plaintext email to Sentry; the admin layout will identify
  // the user by id after the next page render reads the session.
  Sentry.addBreadcrumb({
    category: 'auth',
    message: 'Admin login successful',
    level: 'info',
  })
  const nextRaw = formData.get('next')
  const nextSafe = typeof nextRaw === 'string' ? validateNextUrl(nextRaw) : null
  redirect(nextSafe ?? '/users')
}
