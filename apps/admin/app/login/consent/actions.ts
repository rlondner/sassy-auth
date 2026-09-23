'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import * as Sentry from '@sentry/nextjs'
import { AUTH_SERVER_URL } from '@/lib/config'
import { validateNextUrl } from '@/lib/safe-next'
import { getForwardedClientIpHeader } from '@/lib/forward-client-ip'

export async function acceptConsentAction(
  appPublicId: string,
  accepted: string[],
  next: string,
): Promise<{ error: true } | never> {
  const cookieStore = await cookies()
  const forwardedIp = await getForwardedClientIpHeader()
  let res: Response
  try {
    res = await fetch(`${AUTH_SERVER_URL}/api/me/consent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieStore.toString(),
        ...forwardedIp,
      },
      body: JSON.stringify({ appPublicId, accepted }),
    })
  } catch (err) {
    Sentry.captureException(err, { tags: { area: 'auth', action: 'login-consent' } })
    return { error: true }
  }
  if (!res.ok) return { error: true }

  const nextSafe = validateNextUrl(next)
  redirect(nextSafe ?? '/users')
}
