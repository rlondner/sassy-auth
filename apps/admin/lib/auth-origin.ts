import { headers } from 'next/headers'

// Forward the browser's Origin to BetterAuth on server-to-server fetches.
// Undici sets Sec-Fetch-* on every outgoing fetch, which trips BetterAuth's
// formCsrfMiddleware into requiring a trusted Origin. Without this, calls
// to /api/auth/sign-in/email, /api/auth/sign-out, etc. return 403.
// The admin's URL must be present in the auth-server's trustedOrigins list.
export async function getForwardedOrigin(): Promise<string | null> {
  const incoming = await headers()
  const raw = incoming.get('origin') ?? incoming.get('referer')
  if (!raw) return null
  try {
    return new URL(raw).origin
  } catch {
    return null
  }
}
