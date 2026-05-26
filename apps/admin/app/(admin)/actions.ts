'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

export async function setLocaleAction(locale: string, pathname: string) {
  const cookieStore = await cookies()
  cookieStore.set('NEXT_LOCALE', locale, {
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  })
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
  redirect('/login')
}
