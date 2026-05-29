import { getTranslations } from 'next-intl/server'
import { validateInvitation } from '@/lib/api-public'
import { AcceptInviteForm } from './accept-invite-form'

interface Props {
  searchParams: Promise<{ token?: string }>
}

export default async function AcceptInvitePage({ searchParams }: Props) {
  const { token } = await searchParams
  const t = await getTranslations()

  if (!token) {
    return <ErrorState message={t('acceptInvite.expired')} />
  }

  let info: { firstName: string; email: string; expired: boolean } | null = null
  try {
    info = await validateInvitation(token)
  } catch {
    // token not found → treat as expired
  }

  if (!info || info.expired) {
    return <ErrorState message={t('acceptInvite.expired')} />
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--background)]">
      <div className="w-full max-w-sm rounded-lg border border-[var(--border)] bg-[var(--card)] p-8 shadow-sm">
        <div className="mb-6 text-center">
          <h1 className="text-headline-sm">{t('acceptInvite.title')}</h1>
          <p className="mt-1 text-body-sm text-[var(--muted-foreground)]">
            {t('acceptInvite.subtitle', { firstName: info.firstName })}
          </p>
        </div>
        <AcceptInviteForm token={token} firstName={info.firstName} email={info.email} />
      </div>
    </div>
  )
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--background)]">
      <div className="w-full max-w-sm rounded-lg border border-[var(--border)] bg-[var(--card)] p-8 shadow-sm text-center">
        <span className="material-symbols-outlined text-[48px] text-[var(--destructive)]">error</span>
        <p className="mt-4 text-body-md text-[var(--foreground)]">{message}</p>
      </div>
    </div>
  )
}
