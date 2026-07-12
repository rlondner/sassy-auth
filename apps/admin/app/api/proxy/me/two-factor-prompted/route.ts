import { cookies } from 'next/headers'

const AUTH_SERVER_URL = process.env.AUTH_SERVER_URL ?? 'http://localhost:3000'

export async function POST() {
  const cookieStore = await cookies()
  // Best-effort: forward session cookie to auth-server to record the prompt.
  await fetch(`${AUTH_SERVER_URL}/api/me/two-factor-prompted`, {
    method: 'POST',
    headers: { Cookie: cookieStore.toString() },
  }).catch(() => { /* ignore */ })
  return new Response(null, { status: 204 })
}
