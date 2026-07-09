import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { validateNextUrl } from '@/lib/safe-next'
import { LoginForm } from './login-form'

const AUTH_SERVER = process.env.AUTH_SERVER_URL ?? 'http://localhost:3000'

export const dynamic = 'force-dynamic'

async function hasActiveSession(): Promise<boolean> {
  const cookieStore = await cookies()
  const cookieHeader = cookieStore.toString()
  if (!cookieHeader.includes('better-auth.session_token=')) return false
  try {
    const res = await fetch(`${AUTH_SERVER}/api/auth/get-session`, {
      headers: { Cookie: cookieHeader },
      cache: 'no-store',
    })
    if (!res.ok) return false
    const body = (await res.json()) as { user?: unknown } | null
    return Boolean(body?.user)
  } catch {
    // Auth-server transport failure — fail open into the form rather than
    // pretending the user is signed in. The form will fail in the same way
    // and surface `serverUnavailable` to the user.
    return false
  }
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const params = await searchParams
  const nextSafe = validateNextUrl(params.next)

  // If the browser already carries a valid BetterAuth session and `next`
  // points somewhere we trust, skip the form entirely and continue the
  // flow the caller started (e.g. the RS's authorize redirect). Without
  // this branch, returning to the RS's "Sign in" button always re-prompts
  // even though the auth-server still recognizes the session.
  if (nextSafe && (await hasActiveSession())) {
    redirect(nextSafe)
  }

  return <LoginForm next={nextSafe ?? ''} />
}
