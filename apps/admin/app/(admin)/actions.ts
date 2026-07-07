'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import * as Sentry from '@sentry/nextjs'
import { getForwardedOrigin } from '@/lib/auth-origin'

export async function setLocaleAction(locale: string, pathname: string) {
  const cookieStore = await cookies()
  cookieStore.set('NEXT_LOCALE', locale, {
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
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
