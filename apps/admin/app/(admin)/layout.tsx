import { headers, cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import * as Sentry from '@sentry/nextjs'
import { AdminShell } from '@/components/admin-shell'
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
  const headersList = await headers()
  const pathname = headersList.get('x-pathname') ?? '/users'

  const [session, currentLocale] = await Promise.all([getSession(), getLocale()])
  const availableLocales = getAvailableLocales()

  if (!session?.user) notFound()

  Sentry.setUser({ email: session.user.email })
  Sentry.setTag('locale', currentLocale)

  const user = {
    firstName: session.user.name?.split(' ')[0] ?? '',
    lastName: session.user.name?.split(' ').slice(1).join(' ') ?? '',
    email: session.user.email ?? '',
  }

  return (
    <AdminShell
      currentPath={pathname}
      user={user}
      currentLocale={currentLocale}
      availableLocales={availableLocales}
    >
      {children}
    </AdminShell>
  )
}
