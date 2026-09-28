import 'server-only'
import { headers } from 'next/headers'

/**
 * Reads the real end-user IP off the INCOMING request to the admin server
 * (via `x-forwarded-for`, set by the proxy in front of the admin console —
 * the same one Render terminates TLS/HTTP at ahead of the auth-server, see
 * main.ts's `trust proxy` comment) and returns it as a header object ready
 * to spread into an outgoing `fetch()`'s `headers`.
 *
 * The admin console's own server actions/server components call the
 * auth-server over server-to-server `fetch()` — the auth-server's
 * `resolveClientIp` then sees the ADMIN SERVER's own egress IP, not the
 * browser's, unless this value is threaded through explicitly. Without it,
 * GDPR geo-detection (which keys off `resolveClientIp`) is effectively
 * broken for every path that goes through the admin console (all except
 * direct social sign-in, which the browser hits directly).
 *
 * Returns `{}` when no incoming `x-forwarded-for` header is present (e.g. a
 * direct/local connection with no proxy in front) — callers must never
 * fabricate a value, only forward what they actually received.
 */
export async function getForwardedClientIpHeader(): Promise<Record<string, string>> {
  const incoming = await headers()
  const forwardedFor = incoming.get('x-forwarded-for')
  if (!forwardedFor) return {}
  return { 'X-Forwarded-For': forwardedFor }
}
