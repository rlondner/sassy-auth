import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { AuthCard } from '@sassy-auth/ui'
import { fetchAppBranding } from '@/lib/app-branding'
import { LinkExpiredCard } from './link-expired-card'

export const dynamic = 'force-dynamic'

// Same "PUBLIC vs internal auth-server origin" split as
// app/signup/check-email/page.tsx — this page's resend button fetches
// directly from the browser, so it needs the origin the browser can reach.
const PUBLIC_AUTH_SERVER =
  process.env.PUBLIC_AUTH_SERVER_URL ?? process.env.AUTH_SERVER_URL ?? 'https://localhost:3010'

export default async function SignupVerifiedPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; email?: string; client_id?: string }>
}) {
  const { error, email, client_id: clientId } = await searchParams
  const t = await getTranslations()
  const branding = await fetchAppBranding(clientId ?? null)

  if (error === 'TOKEN_EXPIRED' && email) {
    return (
      <LinkExpiredCard
        email={email}
        authServerUrl={PUBLIC_AUTH_SERVER}
        pageLightBackgroundColor={branding.pageLightBackgroundColor}
        pageDarkBackgroundColor={branding.pageDarkBackgroundColor}
        cardLightBackgroundColor={branding.cardLightBackgroundColor}
        cardDarkBackgroundColor={branding.cardDarkBackgroundColor}
      />
    )
  }

  if (error) {
    return (
      <AuthCard
        title={t('signup.verified.invalid.title')}
        subtitle={t('signup.verified.invalid.subtitle')}
        pageLightBackgroundColor={branding.pageLightBackgroundColor}
        pageDarkBackgroundColor={branding.pageDarkBackgroundColor}
        cardLightBackgroundColor={branding.cardLightBackgroundColor}
        cardDarkBackgroundColor={branding.cardDarkBackgroundColor}
        footer={
          <Link href="/login" className="text-label-md text-primary hover:underline">
            {t('signup.verified.invalid.backToLogin')}
          </Link>
        }
      />
    )
  }

  return (
    <AuthCard
      title={t('signup.verified.title')}
      subtitle={t('signup.verified.subtitle')}
      pageLightBackgroundColor={branding.pageLightBackgroundColor}
      pageDarkBackgroundColor={branding.pageDarkBackgroundColor}
      cardLightBackgroundColor={branding.cardLightBackgroundColor}
      cardDarkBackgroundColor={branding.cardDarkBackgroundColor}
      icon={
        <span
          className="material-symbols-outlined text-[48px] text-primary"
          style={{ fontVariationSettings: "'FILL' 1" }}
        >
          check_circle
        </span>
      }
      footer={
        <Link href="/login" className="text-label-md text-primary hover:underline">
          {t('signup.verified.continueToLogin')}
        </Link>
      }
    />
  )
}
