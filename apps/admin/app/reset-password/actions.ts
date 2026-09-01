'use server'

import * as Sentry from '@sentry/nextjs'
import { getForwardedOrigin } from '@/lib/auth-origin'

const AUTH_SERVER = process.env.AUTH_SERVER_URL ?? 'http://localhost:3000'

export async function resetPasswordSubmitAction(
  token: string,
  newPassword: string,
): Promise<{ ok: true } | { error: string }> {
  const origin = await getForwardedOrigin()
  let res: Response
  try {
    res = await fetch(`${AUTH_SERVER}/api/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(origin && { Origin: origin }) },
      body: JSON.stringify({ token, newPassword }),
    })
  } catch (err) {
    Sentry.captureException(err, { tags: { area: 'auth', action: 'reset-password' } })
    return { error: 'serverUnavailable' }
  }
  // /reset-password is a sensitive prefix for the auth rate limiter, so a
  // throttled submission must not be reported as a bad link — that would send
  // the user to request a new one, which is rate-limited too.
  if (res.status === 429) return { error: 'tooManyRequests' }
  if (!res.ok) return { error: 'invalidToken' }
  return { ok: true }
}
