import { validateNextUrl } from '@/lib/safe-next'
import { getSystemTrustDaysClient } from '@/lib/two-factor-prompt'
import { clientIdFromNext } from '@/lib/client-id-from-next'
import { fetchAppBranding } from '@/lib/app-branding'
import { TwoFactorForm } from './TwoFactorForm'

export const dynamic = 'force-dynamic'

export default async function TwoFactorPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const params = await searchParams
  const nextSafe = validateNextUrl(params.next)
  const trustDays = getSystemTrustDaysClient()
  const branding = await fetchAppBranding(clientIdFromNext(nextSafe ?? ''))
  return (
    <TwoFactorForm
      next={nextSafe ?? ''}
      trustDays={trustDays}
      pageLightBackgroundColor={branding.pageLightBackgroundColor}
      pageDarkBackgroundColor={branding.pageDarkBackgroundColor}
      cardLightBackgroundColor={branding.cardLightBackgroundColor}
      cardDarkBackgroundColor={branding.cardDarkBackgroundColor}
    />
  )
}
