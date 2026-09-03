import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { SignupForm } from './signup-form'

const AUTH_SERVER = process.env.AUTH_SERVER_URL ?? 'http://localhost:3000'

export const dynamic = 'force-dynamic'

async function fetchAppName(clientId: string): Promise<string | null> {
  try {
    const res = await fetch(`${AUTH_SERVER}/api/register/app?appPublicId=${encodeURIComponent(clientId)}`, {
      cache: 'no-store',
    })
    if (!res.ok) return null
    const body = (await res.json()) as { name?: string }
    return typeof body.name === 'string' ? body.name : null
  } catch {
    return null
  }
}

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ client_id?: string; next?: string }>
}) {
  const { client_id: clientId, next } = await searchParams
  const t = await getTranslations()

  if (!clientId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--background)] p-6">
        <div className="w-full max-w-md rounded-lg border border-[var(--border)] bg-[var(--card)] p-8 shadow-sm text-center">
          <span className="material-symbols-outlined text-[48px] text-[var(--destructive)]">error</span>
          <p className="mt-4 text-body-md text-[var(--foreground)]">{t('signup.invalidLink')}</p>
        </div>
      </div>
    )
  }

  const appName = await fetchAppName(clientId)
  const nextSafe = next ?? ''

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--background)]">
      <div className="w-full max-w-sm rounded-lg border border-[var(--border)] bg-[var(--card)] p-8 shadow-sm">
        <div className="mb-6 text-center">
          <h1 className="text-headline-sm text-[var(--foreground)]">
            {appName ? t('signup.titleWithApp', { appName }) : t('signup.title')}
          </h1>
          <p className="mt-1 text-body-sm text-[var(--muted-foreground)]">{t('signup.subtitle')}</p>
        </div>
        <SignupForm clientId={clientId} next={nextSafe} />
        <div className="mt-4 text-center">
          <Link
            href={nextSafe ? `/login?next=${encodeURIComponent(nextSafe)}` : '/login'}
            className="text-label-md text-[var(--primary)] hover:underline"
          >
            {t('signup.backToLogin')}
          </Link>
        </div>
      </div>
    </div>
  )
}
