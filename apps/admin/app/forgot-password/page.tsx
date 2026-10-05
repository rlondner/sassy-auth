import { validateNextUrl } from '@/lib/safe-next'
import { clientIdFromNext } from '@/lib/client-id-from-next'
import { fetchAppBranding } from '@/lib/app-branding'
import { ForgotPasswordForm } from './forgot-password-form'

export const dynamic = 'force-dynamic'

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { next } = await searchParams
  const nextSafe = validateNextUrl(next)
  const branding = await fetchAppBranding(clientIdFromNext(nextSafe ?? ''))
  return (
    <ForgotPasswordForm
      next={nextSafe ?? ''}
      logo={branding.logo}
      pageLightBackgroundColor={branding.pageLightBackgroundColor}
      pageDarkBackgroundColor={branding.pageDarkBackgroundColor}
      cardLightBackgroundColor={branding.cardLightBackgroundColor}
      cardDarkBackgroundColor={branding.cardDarkBackgroundColor}
    />
  )
}
