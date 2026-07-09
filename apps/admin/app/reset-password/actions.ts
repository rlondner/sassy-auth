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
  if (!res.ok) return { error: 'invalidToken' }
  return { ok: true }
}
