'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import * as Sentry from '@sentry/nextjs'

const AUTH_SERVER = process.env.AUTH_SERVER_URL ?? 'http://localhost:3000'

export async function signIn(formData: FormData): Promise<{ error?: string }> {
  const email = formData.get('email') as string
  const password = formData.get('password') as string

  if (!email || !password) {
    Sentry.addBreadcrumb({
      category: 'auth',
      message: 'Admin login failed',
      level: 'warning',
    })
    return { error: 'Email and password are required.' }
  }

  const res = await fetch(`${AUTH_SERVER}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })

  if (!res.ok) {
    Sentry.addBreadcrumb({
      category: 'auth',
      message: 'Admin login failed',
      level: 'warning',
    })
    if (res.status === 401) return { error: 'invalidCredentials' }
    if (res.status === 403) return { error: 'inactive' }
    return { error: 'invalidCredentials' }
  }

  // Forward session cookie from auth server to the browser
  const cookieStore = await cookies()
  const setCookieHeader = res.headers.get('set-cookie')
  if (setCookieHeader) {
    const tokenMatch = setCookieHeader.match(/better-auth\.session_token=([^;]+)/)
    if (tokenMatch) {
      cookieStore.set('better-auth.session_token', tokenMatch[1], {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
      })
    }
  }

  // Do not pass plaintext email to Sentry; the admin layout will identify
  // the user by id after the next page render reads the session.
  Sentry.addBreadcrumb({
    category: 'auth',
    message: 'Admin login successful',
    level: 'info',
  })
  redirect('/users')
}
