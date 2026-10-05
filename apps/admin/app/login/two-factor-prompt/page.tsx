import { validateNextUrl } from '@/lib/safe-next'
import { clientIdFromNext } from '@/lib/client-id-from-next'
import { fetchAppBranding } from '@/lib/app-branding'
import { TwoFactorPromptClient } from './TwoFactorPromptClient'

export const dynamic = 'force-dynamic'

export default async function TwoFactorPromptPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const params = await searchParams
  const nextSafe = validateNextUrl(params.next)
  const branding = await fetchAppBranding(clientIdFromNext(nextSafe ?? ''))
  return (
    <TwoFactorPromptClient
      next={nextSafe ?? ''}
      logo={branding.logo}
      pageLightBackgroundColor={branding.pageLightBackgroundColor}
      pageDarkBackgroundColor={branding.pageDarkBackgroundColor}
      cardLightBackgroundColor={branding.cardLightBackgroundColor}
      cardDarkBackgroundColor={branding.cardDarkBackgroundColor}
    />
  )
}
