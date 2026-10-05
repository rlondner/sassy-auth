import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { AuthCard } from '@sassy-auth/ui'
import { fetchAppBranding } from '@/lib/app-branding'
import { CheckEmailCard } from './check-email-card'

export const dynamic = 'force-dynamic'

const PUBLIC_AUTH_SERVER =
  process.env.PUBLIC_AUTH_SERVER_URL ?? process.env.AUTH_SERVER_URL ?? 'https://localhost:3010'

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ client_id?: string }>
}): Promise<Metadata> {
  const { client_id: clientId } = await searchParams
  if (!clientId) return {}
  const { favicon } = await fetchAppBranding(clientId)
  return favicon ? { icons: { icon: favicon } } : {}
}

export default async function CheckEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; next?: string; client_id?: string }>
}) {
  const { email, next, client_id: clientId } = await searchParams
  const t = await getTranslations('signup.checkEmail')
  const branding = await fetchAppBranding(clientId ?? null)

  if (!email) {
    return (
      <AuthCard
        title={t('title')}
        logoUrl={branding.logo}
        subtitle={t('missingEmail')}
        pageLightBackgroundColor={branding.pageLightBackgroundColor}
        pageDarkBackgroundColor={branding.pageDarkBackgroundColor}
        cardLightBackgroundColor={branding.cardLightBackgroundColor}
        cardDarkBackgroundColor={branding.cardDarkBackgroundColor}
      />
    )
  }

  // code-method apps verify entirely within /signup (see signup-wizard.tsx)
  // and never navigate here — this page now always serves the link flow.
  return (
    <CheckEmailCard
      email={email}
      next={next ?? ''}
      authServerUrl={PUBLIC_AUTH_SERVER}
      logo={branding.logo}
      pageLightBackgroundColor={branding.pageLightBackgroundColor}
      pageDarkBackgroundColor={branding.pageDarkBackgroundColor}
      cardLightBackgroundColor={branding.cardLightBackgroundColor}
      cardDarkBackgroundColor={branding.cardDarkBackgroundColor}
    />
  )
}
