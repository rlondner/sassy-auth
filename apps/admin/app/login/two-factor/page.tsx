import type { Metadata } from 'next'
import { validateNextUrl } from '@/lib/safe-next'
import { getSystemTrustDaysClient } from '@/lib/two-factor-prompt'
import { clientIdFromNext } from '@/lib/client-id-from-next'
import { fetchAppBranding } from '@/lib/app-branding'
import { TwoFactorForm } from './TwoFactorForm'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}): Promise<Metadata> {
  const { next } = await searchParams
  const nextSafe = validateNextUrl(next)
  const clientId = clientIdFromNext(nextSafe ?? '')
  if (!clientId) return {}
  const { favicon } = await fetchAppBranding(clientId)
  return favicon ? { icons: { icon: favicon } } : {}
}

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
      logo={branding.logo}
      pageLightBackgroundColor={branding.pageLightBackgroundColor}
      pageDarkBackgroundColor={branding.pageDarkBackgroundColor}
      cardLightBackgroundColor={branding.cardLightBackgroundColor}
      cardDarkBackgroundColor={branding.cardDarkBackgroundColor}
    />
  )
}
