'use server'

import * as Sentry from '@sentry/nextjs'
import { getForwardedOrigin } from '@/lib/auth-origin'
import { getForwardedClientIpHeader } from '@/lib/forward-client-ip'

const AUTH_SERVER = process.env.AUTH_SERVER_URL ?? 'https://localhost:3010'

async function postJson(
  path: string,
  body: unknown,
  action: string,
): Promise<Response | { networkError: true }> {
  const origin = await getForwardedOrigin()
  const forwardedIp = await getForwardedClientIpHeader()
  try {
    return await fetch(`${AUTH_SERVER}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(origin && { Origin: origin }),
        ...forwardedIp,
      },
      body: JSON.stringify(body),
    })
  } catch (err) {
    Sentry.captureException(err, { tags: { area: 'auth', action } })
    return { networkError: true }
  }
}

export interface StartRegistrationInput {
  clientId: string
  email: string
  turnstileToken: string
}

export async function startRegistrationAction(
  input: StartRegistrationInput,
): Promise<{ ok: true } | { error: string }> {
  const res = await postJson(
    '/api/register/start',
    {
      email: input.email,
      appPublicId: input.clientId,
      turnstileToken: input.turnstileToken,
    },
    'signup-wizard-start',
  )
  if ('networkError' in res) return { error: 'serverUnavailable' }
  if (res.ok) return { ok: true }
  if (res.status === 404) return { error: 'appNotFound' }
  if (res.status === 409) return { error: 'emailTaken' }
  if (res.status === 422) return { error: 'captchaFailed' }
  if (res.status === 429) return { error: 'tooManyRequests' }
  return { error: 'validationError' }
}

export interface VerifyRegistrationCodeInput {
  email: string
  otp: string
}

export async function verifyRegistrationCodeAction(
  input: VerifyRegistrationCodeInput,
): Promise<{ ok: true } | { error: string }> {
  const res = await postJson('/api/register/verify-code', input, 'signup-wizard-verify-code')
  if ('networkError' in res) return { error: 'GENERIC' }
  if (res.ok) return { ok: true }
  if (res.status === 429) return { error: 'tooManyRequests' }
  const body: { code?: string } = await res.json().catch(() => ({}))
  if (body.code === 'INVALID_OTP' || body.code === 'OTP_EXPIRED' || body.code === 'TOO_MANY_ATTEMPTS') {
    return { error: body.code }
  }
  return { error: 'GENERIC' }
}

export interface CompleteRegistrationInput {
  clientId: string
  email: string
  otp: string
  firstName: string
  lastName: string
  companyName?: string
  password: string
  acceptedPrivacyPolicy?: boolean
  acceptedTerms?: boolean
  acceptedGdpr?: boolean
  marketingOptIn?: boolean
  next?: string
}

export async function completeRegistrationAction(
  input: CompleteRegistrationInput,
): Promise<{ ok: true; redirectUrl?: string } | { error: string }> {
  const res = await postJson(
    '/api/register/complete',
    {
      email: input.email,
      otp: input.otp,
      firstName: input.firstName,
      lastName: input.lastName,
      ...(input.companyName !== undefined && { companyName: input.companyName }),
      appPublicId: input.clientId,
      password: input.password,
      ...(input.acceptedPrivacyPolicy !== undefined && { acceptedPrivacyPolicy: input.acceptedPrivacyPolicy }),
      ...(input.acceptedTerms !== undefined && { acceptedTerms: input.acceptedTerms }),
      ...(input.acceptedGdpr !== undefined && { acceptedGdpr: input.acceptedGdpr }),
      ...(input.marketingOptIn !== undefined && { marketingOptIn: input.marketingOptIn }),
      ...(input.next && { next: input.next }),
    },
    'signup-wizard-complete',
  )
  if ('networkError' in res) return { error: 'serverUnavailable' }
  if (res.ok) {
    const body: { redirectUrl?: string } = await res.json().catch(() => ({}))
    return { ok: true, ...(body.redirectUrl && { redirectUrl: body.redirectUrl }) }
  }
  if (res.status === 404) return { error: 'appNotFound' }
  const body: { code?: string } = await res.json().catch(() => ({}))
  if (body.code === 'OTP_EXPIRED' || body.code === 'INVALID_OTP' || body.code === 'TOO_MANY_ATTEMPTS') {
    return { error: body.code }
  }
  if (res.status === 429) return { error: 'tooManyRequests' }
  return { error: 'validationError' }
}
