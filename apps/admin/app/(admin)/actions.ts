'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import * as Sentry from '@sentry/nextjs'
import { getForwardedOrigin } from '@/lib/auth-origin'

// bug-0159: 1-year maxAge so a locale choice survives the browser
// closing. Previously the cookie was session-only, forcing users to
// re-select their language every new browser session — annoying,
// but also masked (the accept-language header fallback in
// `lib/locale.ts::getLocale` usually picks a reasonable default).
const LOCALE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365

export async function setLocaleAction(locale: string, pathname: string) {
  const cookieStore = await cookies()
  cookieStore.set('NEXT_LOCALE', locale, {
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: LOCALE_COOKIE_MAX_AGE_SECONDS,
  })
  Sentry.addBreadcrumb({
    category: 'ui',
    message: `Locale switched to ${locale}`,
    level: 'info',
  })
  Sentry.setTag('locale', locale)
  redirect(pathname)
}

export async function signOutAction() {
  const AUTH_SERVER = process.env.AUTH_SERVER_URL ?? 'http://localhost:3000'
  const cookieStore = await cookies()
  const origin = await getForwardedOrigin()
  // Always drop the local session cookie and redirect, even if the auth-server is
  // unreachable — the server-side session will expire on its own, and stranding the
  // user with a stale cookie on a transient outage is worse than a best-effort logout.
  try {
    await fetch(`${AUTH_SERVER}/api/auth/sign-out`, {
      method: 'POST',
      headers: {
        Cookie: cookieStore.toString(),
        ...(origin && { Origin: origin }),
      },
    })
  } catch (err) {
    Sentry.captureException(err)
  }
  cookieStore.delete('better-auth.session_token')
  Sentry.addBreadcrumb({
    category: 'auth',
    message: 'Admin signed out',
    level: 'info',
  })
  // Redirect to the app root; the middleware will bounce the now-unauthenticated
  // request to /login, so the user lands there without us hardcoding that route here.
  redirect('/')
}
