import type { Metadata } from 'next'
import { validateNextUrl } from '@/lib/safe-next'
import { clientIdFromNext } from '@/lib/client-id-from-next'
import { fetchAppBranding } from '@/lib/app-branding'
import { LoginOtpForm } from '../login-otp-form'

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

export default async function LoginCodePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const params = await searchParams
  const nextSafe = validateNextUrl(params.next)
  const branding = await fetchAppBranding(clientIdFromNext(nextSafe ?? ''))
  return (
    <LoginOtpForm
      next={nextSafe ?? ''}
      logo={branding.logo}
      pageLightBackgroundColor={branding.pageLightBackgroundColor}
      pageDarkBackgroundColor={branding.pageDarkBackgroundColor}
      cardLightBackgroundColor={branding.cardLightBackgroundColor}
      cardDarkBackgroundColor={branding.cardDarkBackgroundColor}
    />
  )
}
