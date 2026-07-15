import { cookies } from 'next/headers'
import * as Sentry from '@sentry/nextjs'

const AUTH_SERVER_URL = process.env.AUTH_SERVER_URL ?? 'http://localhost:3000'

export async function POST() {
  const cookieStore = await cookies()
  // Best-effort: forward session cookie to auth-server to record the prompt.
  try {
    const res = await fetch(`${AUTH_SERVER_URL}/api/me/two-factor-prompted`, {
      method: 'POST',
      headers: { Cookie: cookieStore.toString() },
    })
    if (!res.ok) {
      Sentry.addBreadcrumb({
        category: 'auth',
        message: `two-factor-prompted upstream returned ${res.status}`,
        level: 'warning',
      })
    }
  } catch (err) {
    Sentry.addBreadcrumb({
      category: 'auth',
      message: `two-factor-prompted transport error: ${err instanceof Error ? err.message : String(err)}`,
      level: 'warning',
    })
  }
  return new Response(null, { status: 204 })
}
