'use server'

import * as Sentry from '@sentry/nextjs'
import { getForwardedOrigin } from '@/lib/auth-origin'

const AUTH_SERVER = process.env.AUTH_SERVER_URL ?? 'http://localhost:3000'
const ADMIN_URL = process.env.ADMIN_URL ?? 'http://localhost:3001'

export async function requestPasswordResetAction(formData: FormData): Promise<{ done: true }> {
  const email = String(formData.get('email') ?? '')
  const origin = await getForwardedOrigin()
  try {
    await fetch(`${AUTH_SERVER}/api/auth/request-password-reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(origin && { Origin: origin }) },
      body: JSON.stringify({ email, redirectTo: `${ADMIN_URL}/reset-password` }),
    })
  } catch (err) {
    // Swallow: never reveal whether the address exists or the service state.
    Sentry.captureException(err, { tags: { area: 'auth', action: 'forgot-password' } })
  }
  return { done: true }
}
