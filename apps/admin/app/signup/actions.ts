'use server'

import * as Sentry from '@sentry/nextjs'
import { getForwardedOrigin } from '@/lib/auth-origin'
import { getForwardedClientIpHeader } from '@/lib/forward-client-ip'

const AUTH_SERVER = process.env.AUTH_SERVER_URL ?? 'https://localhost:3010'

export interface RegisterInput {
  clientId: string
  firstName: string
  lastName: string
  companyName?: string
  email: string
  password: string
  turnstileToken: string
  acceptedPrivacyPolicy?: boolean
  acceptedTerms?: boolean
  acceptedGdpr?: boolean
}

export async function registerAction(
  input: RegisterInput,
): Promise<{ ok: true } | { error: string }> {
  const origin = await getForwardedOrigin()
  const forwardedIp = await getForwardedClientIpHeader()
  let res: Response
  try {
    res = await fetch(`${AUTH_SERVER}/api/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(origin && { Origin: origin }),
        ...forwardedIp,
      },
      body: JSON.stringify({
        email: input.email,
        password: input.password,
        firstName: input.firstName,
        lastName: input.lastName,
        ...(input.companyName !== undefined && { companyName: input.companyName }),
        appPublicId: input.clientId,
        turnstileToken: input.turnstileToken,
        ...(input.acceptedPrivacyPolicy !== undefined && { acceptedPrivacyPolicy: input.acceptedPrivacyPolicy }),
        ...(input.acceptedTerms !== undefined && { acceptedTerms: input.acceptedTerms }),
        ...(input.acceptedGdpr !== undefined && { acceptedGdpr: input.acceptedGdpr }),
      }),
    })
  } catch (err) {
    Sentry.captureException(err, { tags: { area: 'auth', action: 'signup' } })
    return { error: 'serverUnavailable' }
  }

  if (res.ok) return { ok: true }
  if (res.status === 404) return { error: 'appNotFound' }
  if (res.status === 409) return { error: 'emailTaken' }
  if (res.status === 422) return { error: 'captchaFailed' }
  if (res.status === 429) return { error: 'tooManyRequests' }
  return { error: 'validationError' }
}
