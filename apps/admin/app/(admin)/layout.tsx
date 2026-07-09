import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import * as Sentry from '@sentry/nextjs'
import { AdminShell } from '@/components/admin-shell'
import { getMyPermissions, getMyProfile } from '@/lib/api'
import { getAvailableLocales, getLocale } from '@/lib/locale'

const AUTH_SERVER = process.env.AUTH_SERVER_URL ?? 'http://localhost:3000'

async function getSession() {
  const cookieStore = await cookies()
  const res = await fetch(`${AUTH_SERVER}/api/auth/get-session`, {
    headers: { Cookie: cookieStore.toString() },
    cache: 'no-store',
  })
  if (!res.ok) return null
  return res.json()
}

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [session, currentLocale] = await Promise.all([getSession(), getLocale()])
  const availableLocales = getAvailableLocales()

  if (!session?.user) notFound()

  // Identify by opaque id only — never propagate plaintext email to Sentry.
  Sentry.setUser({ id: session.user.id })
  Sentry.setTag('locale', currentLocale)

  const user = {
    firstName: session.user.name?.split(' ')[0] ?? '',
    lastName: session.user.name?.split(' ').slice(1).join(' ') ?? '',
    email: session.user.email ?? '',
  }

  // Both fallbacks degrade gracefully into an empty sidebar instead of a 500,
  // but a transient /me outage that hides every nav item is exactly the kind
  // of regression we want to learn about — capture the cause to Sentry.
  const [perms, profile] = await Promise.all([
    getMyPermissions().catch((e) => {
      Sentry.captureException(e)
      return [] as string[]
    }),
    getMyProfile().catch((e) => {
      Sentry.captureException(e)
      return null
    }),
  ])

  return (
    <AdminShell
      user={user}
      perms={perms}
      profile={profile}
      currentLocale={currentLocale}
      availableLocales={availableLocales}
    >
      {children}
    </AdminShell>
  )
}
