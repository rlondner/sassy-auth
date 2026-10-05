import { getTranslations } from 'next-intl/server'
import { AuthCard } from '@sassy-auth/ui'
import { fetchAppBranding } from '@/lib/app-branding'
import { CheckEmailCard } from './check-email-card'

export const dynamic = 'force-dynamic'

// This page's resend button fetches directly from the browser, so it needs
// an origin the browser can reach — see the matching comment on
// app/login/page.tsx's AUTH_SERVER for why AUTH_SERVER_URL already is one.
const AUTH_SERVER = process.env.AUTH_SERVER_URL ?? 'https://localhost:3010'

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
      authServerUrl={AUTH_SERVER}
      pageLightBackgroundColor={branding.pageLightBackgroundColor}
      pageDarkBackgroundColor={branding.pageDarkBackgroundColor}
      cardLightBackgroundColor={branding.cardLightBackgroundColor}
      cardDarkBackgroundColor={branding.cardDarkBackgroundColor}
    />
  )
}
