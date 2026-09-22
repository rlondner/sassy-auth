import 'server-only'
import { cookies } from 'next/headers'
import { AUTH_SERVER_URL } from './config'

/**
 * `next` may be a relative or absolute authorize URL carrying `client_id` —
 * the same shape login-form.tsx's clientIdFromNext and login/actions.ts's
 * applyPerAppTrustCookie already parse for their own purposes. A
 * placeholder base lets a relative `next` parse without throwing.
 */
export function extractClientId(nextStr: string | null): string | null {
  if (!nextStr) return null
  try {
    return new URL(nextStr, 'http://placeholder.invalid').searchParams.get('client_id')
  } catch {
    return null
  }
}

export interface OutstandingConsentDocument {
  documentType: string
  url: string
}

/**
 * Session-authenticated GET /api/me/consent — fails open (returns []) on
 * any transport/parse failure, same stance as the 2FA-status lookup in
 * login/actions.ts: an unreachable consent check must never block a real,
 * already-authenticated login.
 */
export async function fetchOutstandingConsent(appPublicId: string): Promise<OutstandingConsentDocument[]> {
  try {
    const cookieStore = await cookies()
    const res = await fetch(`${AUTH_SERVER_URL}/api/me/consent?appPublicId=${encodeURIComponent(appPublicId)}`, {
      headers: { Cookie: cookieStore.toString() },
      cache: 'no-store',
    })
    if (!res.ok) return []
    const data = (await res.json()) as { outstanding?: OutstandingConsentDocument[] }
    return data.outstanding ?? []
  } catch {
    return []
  }
}
