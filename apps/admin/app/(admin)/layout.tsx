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

  const [perms, profile] = await Promise.all([
    getMyPermissions().catch(() => [] as string[]),
    getMyProfile().catch(() => null),
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
