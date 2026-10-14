'use server'

import * as Sentry from '@sentry/nextjs'
import { getForwardedOrigin } from '@/lib/auth-origin'
import { getForwardedClientIpHeader } from '@/lib/forward-client-ip'

const AUTH_SERVER = process.env.AUTH_SERVER_URL ?? 'https://localhost:3010'
const ADMIN_URL = process.env.ADMIN_URL ?? 'http://localhost:3001'

export async function requestPasswordResetAction(formData: FormData): Promise<{ done: true }> {
  const email = String(formData.get('email') ?? '')
  const origin = await getForwardedOrigin()
  const forwardedIp = await getForwardedClientIpHeader()
  try {
    await fetch(`${AUTH_SERVER}/api/auth/request-password-reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(origin && { Origin: origin }), ...forwardedIp },
      body: JSON.stringify({ email, redirectTo: `${ADMIN_URL}/reset-password` }),
    })
  } catch (err) {
    // Swallow: never reveal whether the address exists or the service state.
    Sentry.captureException(err, { tags: { area: 'auth', action: 'forgot-password' } })
  }
  return { done: true }
}
