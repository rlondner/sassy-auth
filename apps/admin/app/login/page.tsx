import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { validateNextUrl } from '@/lib/safe-next'
import { fetchSocialProviders } from '@/lib/social-providers'
import { LoginForm } from './login-form'

const AUTH_SERVER = process.env.AUTH_SERVER_URL ?? 'http://localhost:3000'

// The origin the BROWSER uses to reach the auth server, for social sign-in
// redirects. This is deliberately separate from AUTH_SERVER_URL: that variable
// is the origin the SERVER (this Next.js process) uses to reach the auth
// server, which in containerised deployments is often an internal hostname
// (e.g. a docker-network name like `http://auth-server:3000`) that a
// browser on the operator's network cannot resolve. PUBLIC_AUTH_SERVER_URL
// lets operators state the publicly reachable origin separately when the two
// differ. Do NOT collapse these into one variable — that "simplification"
// breaks any deployment where the admin console and auth server talk to each
// other over an internal network but the browser needs the public one.
const PUBLIC_AUTH_SERVER = process.env.PUBLIC_AUTH_SERVER_URL ?? process.env.AUTH_SERVER_URL ?? 'http://localhost:3000'

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

  const providers = await fetchSocialProviders(nextSafe ?? '')

  return <LoginForm next={nextSafe ?? ''} providers={providers} authServerUrl={PUBLIC_AUTH_SERVER} />
}
