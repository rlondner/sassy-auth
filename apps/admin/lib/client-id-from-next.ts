/**
 * `next` may be a relative or absolute authorize URL carrying `client_id` —
 * the same shape login-form.tsx, social-providers.ts, login/actions.ts's
 * applyPerAppTrustCookie, and consent.ts's extractClientId each already
 * parse independently for their own purposes. A placeholder base lets a
 * relative `next` parse without throwing.
 */
export function clientIdFromNext(next: string): string | null {
  if (!next) return null
  try {
    return new URL(next, 'http://placeholder.invalid').searchParams.get('client_id')
  } catch {
    return null
  }
}
