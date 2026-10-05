import { AuthCard } from '@sassy-auth/ui'
import { getTranslations } from 'next-intl/server'
import { redirect } from 'next/navigation'
import { fetchAppBranding } from '@/lib/app-branding'
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

  const [outstanding, branding] = await Promise.all([
    appPublicId ? fetchOutstandingConsent(appPublicId) : Promise.resolve([]),
    fetchAppBranding(appPublicId ?? null),
  ])

  // An empty outstanding list means either genuinely nothing is required, or
  // fetchOutstandingConsent fail-opened on a transport error — in both cases
  // this whole gate's established fail-open stance says proceed rather than
  // render a form with zero checkboxes whose vacuously-true "every checkbox
  // is checked" would let the user click Continue straight into a 400 with
  // nothing left to fix.
  if (outstanding.length === 0) {
    redirect(nextSafe || '/users')
  }

  return (
    <AuthCard
      title={t('loginConsent.title')}
      logoUrl={branding.logo}
      className="max-w-md"
      pageLightBackgroundColor={branding.pageLightBackgroundColor}
      pageDarkBackgroundColor={branding.pageDarkBackgroundColor}
      cardLightBackgroundColor={branding.cardLightBackgroundColor}
      cardDarkBackgroundColor={branding.cardDarkBackgroundColor}
    >
      <ConsentGateClient appPublicId={appPublicId ?? ''} next={nextSafe} outstanding={outstanding} />
    </AuthCard>
  )
}
