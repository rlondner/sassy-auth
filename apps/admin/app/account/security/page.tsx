import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { AUTH_SERVER_URL } from '@/lib/config'
import { validateNextUrl } from '@/lib/safe-next'
import { SecurityClient } from './SecurityClient'

// Session-required. The middleware already guards this route via
// validateSession. This page additionally reads the live 2FA status from
// BetterAuth to seed the client component's initial state, avoiding a
// redundant client-side fetch on first render.
export default async function SecurityPage({
  searchParams,
}: {
  searchParams?: Promise<{ enroll?: string; next?: string }>
}) {
  const sp = searchParams ? await searchParams : {}
  const forced = sp.enroll === '1'
  const next = typeof sp.next === 'string' ? validateNextUrl(sp.next) : null

  const cookieStore = await cookies()
  const res = await fetch(`${AUTH_SERVER_URL}/api/auth/get-session`, {
    headers: { Cookie: cookieStore.toString() },
    cache: 'no-store',
  })

  if (!res.ok) {
    redirect('/login')
  }

  const session = (await res.json()) as {
    user?: { twoFactorEnabled?: boolean }
  } | null

  if (!session?.user) {
    redirect('/login')
  }

  const twoFactorEnabled = session.user.twoFactorEnabled ?? false

  return <SecurityClient twoFactorEnabled={twoFactorEnabled} forced={forced} next={next} />
}
