'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import * as Sentry from '@sentry/nextjs'

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
  await fetch(`${AUTH_SERVER}/api/auth/sign-out`, {
    method: 'POST',
    headers: { Cookie: cookieStore.toString() },
  })
  cookieStore.delete('better-auth.session_token')
  Sentry.addBreadcrumb({
    category: 'auth',
    message: 'Admin signed out',
    level: 'info',
  })
  redirect('/login')
}
