'use server'

import * as Sentry from '@sentry/nextjs'
import { getForwardedOrigin } from '@/lib/auth-origin'

const AUTH_SERVER = process.env.AUTH_SERVER_URL ?? 'http://localhost:3000'

export interface RegisterInput {
  clientId: string
  firstName: string
  lastName: string
  companyName: string
  email: string
  password: string
}

export async function registerAction(
  input: RegisterInput,
): Promise<{ ok: true } | { error: string }> {
  const origin = await getForwardedOrigin()
  let res: Response
  try {
    res = await fetch(`${AUTH_SERVER}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(origin && { Origin: origin }) },
      body: JSON.stringify({
        email: input.email,
        password: input.password,
        firstName: input.firstName,
        lastName: input.lastName,
        companyName: input.companyName,
        appPublicId: input.clientId,
      }),
    })
  } catch (err) {
    Sentry.captureException(err, { tags: { area: 'auth', action: 'signup' } })
    return { error: 'serverUnavailable' }
  }

  if (res.ok) return { ok: true }
  if (res.status === 404) return { error: 'appNotFound' }
  if (res.status === 409) return { error: 'emailTaken' }
  if (res.status === 429) return { error: 'tooManyRequests' }
  return { error: 'validationError' }
}
