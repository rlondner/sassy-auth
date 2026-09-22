import { AuthCard } from '@sassy-auth/ui'
import { getTranslations } from 'next-intl/server'
import { fetchOutstandingConsent } from '@/lib/consent'
import { validateNextUrl } from '@/lib/safe-next'
import { ConsentGateClient } from './ConsentGateClient'

export const dynamic = 'force-dynamic'

export default async function LoginConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ appPublicId?: string; next?: string }>
}) {
  const { appPublicId, next } = await searchParams
  const t = await getTranslations()
  const nextSafe = validateNextUrl(next) ?? ''

  const outstanding = appPublicId ? await fetchOutstandingConsent(appPublicId) : []

  return (
    <AuthCard title={t('loginConsent.title')} className="max-w-md">
      <ConsentGateClient appPublicId={appPublicId ?? ''} next={nextSafe} outstanding={outstanding} />
    </AuthCard>
  )
}
