import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getBetterAuthCookieName, isSecureCookieEnv } from '@sassy-auth/types'
import { validateNextUrl } from '@/lib/safe-next'
import { fetchSocialProviders } from '@/lib/social-providers'
import { LoginForm } from './login-form'

// Must match the exact check auth.config.ts uses for
// `advanced.useSecureCookies` — see isSecureCookieEnv's doc comment
// (@sassy-auth/types) for why this can't just be `NODE_ENV === 'production'`.
// bug-0293: must match auth.config.ts's `advanced.cookiePrefix` — see
// getBetterAuthCookieName's doc comment.
const SESSION_COOKIE_NAME = getBetterAuthCookieName(
  'session_token',
  isSecureCookieEnv(),
  process.env.COOKIE_PREFIX || 'better-auth',
)

// Also used to build the browser-facing social sign-in redirect below.
// Every deployment this repo actually ships (Render, the Docker dev preview,
// DEPLOYMENT.md's standalone Docker example) sets AUTH_SERVER_URL to a
// publicly reachable origin, so the server and browser can share this one
// value. If a future deployment puts the admin console and auth server on
// an internal network where AUTH_SERVER_URL becomes unreachable from the
// browser (e.g. a docker-network hostname), reintroduce a separate
// PUBLIC_AUTH_SERVER_URL override here rather than hardcoding that split
// back in speculatively.
const AUTH_SERVER = process.env.AUTH_SERVER_URL ?? 'https://localhost:3010'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}): Promise<Metadata> {
  const { next } = await searchParams
  const nextSafe = validateNextUrl(next)
  if (!nextSafe) return {}
  const { name: appName, favicon } = await fetchSocialProviders(nextSafe)
  return {
    ...(appName && { title: `${appName} Sign In` }),
    ...(favicon && { icons: { icon: favicon } }),
  }
}

async function hasActiveSession(): Promise<boolean> {
  const cookieStore = await cookies()
  const cookieHeader = cookieStore.toString()
  if (!cookieHeader.includes(`${SESSION_COOKIE_NAME}=`)) return false
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

  const {
    providers, logo, pageLightBackgroundColor, pageDarkBackgroundColor,
    cardLightBackgroundColor, cardDarkBackgroundColor,
  } = await fetchSocialProviders(nextSafe ?? '')

  return (
    <LoginForm
      next={nextSafe ?? ''}
      providers={providers}
      logo={logo}
      pageLightBackgroundColor={pageLightBackgroundColor}
      pageDarkBackgroundColor={pageDarkBackgroundColor}
      cardLightBackgroundColor={cardLightBackgroundColor}
      cardDarkBackgroundColor={cardDarkBackgroundColor}
      authServerUrl={AUTH_SERVER}
    />
  )
}
