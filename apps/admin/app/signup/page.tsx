import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { SignupForm } from './signup-form'
import { fetchAppInfo } from './fetch-app-info'

export const dynamic = 'force-dynamic'

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

  const { name: appName, hasDefaultOrg, passwordPolicy } = await fetchAppInfo(clientId)
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
        <SignupForm clientId={clientId} next={nextSafe} hasDefaultOrg={hasDefaultOrg} passwordPolicy={passwordPolicy} />
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
