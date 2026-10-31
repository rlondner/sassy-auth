import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { AuthCard } from '@sassy-auth/ui'
import { fetchAppInfo } from '@/lib/app-info'
import { fetchSocialProviders } from '@/lib/social-providers'
import { SignupForm } from './signup-form'
import { SignupWizardCard } from './signup-wizard-card'

// Browser-facing social sign-in needs a publicly reachable origin — see
// app/login/page.tsx's AUTH_SERVER comment for why this reuses
// AUTH_SERVER_URL rather than a separate public-facing override.
const AUTH_SERVER = process.env.AUTH_SERVER_URL ?? 'https://localhost:3010'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ client_id?: string; next?: string }>
}): Promise<Metadata> {
  const { client_id: clientId } = await searchParams
  if (!clientId) return {}
  const { name: appName, favicon } = await fetchAppInfo(clientId)
  return {
    ...(appName && { title: `${appName} Sign Up` }),
    ...(favicon && { icons: { icon: favicon } }),
  }
}

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ client_id?: string; next?: string }>
}) {
  const { client_id: clientId, next } = await searchParams
  const t = await getTranslations()

  if (!clientId) {
    return (
      <AuthCard
        className="max-w-md"
        icon={<span className="material-symbols-outlined text-[48px] text-destructive">error</span>}
      >
        <p className="text-center text-body-md text-foreground">{t('signup.invalidLink')}</p>
      </AuthCard>
    )
  }

  const {
    name: appName, hasDefaultOrg, canSocialSignup, passwordPolicy, logo, privacyPolicyUrl, termsUrl, gdprUrl, gdprRequired,
    emailVerificationMethod,
    pageLightBackgroundColor, pageDarkBackgroundColor, cardLightBackgroundColor, cardDarkBackgroundColor,
  } = await fetchAppInfo(clientId)
  // This synthetic `/signup?...` URL isn't the real `next` — fetchSocialProviders
  // only reads its client_id query param to look up the provider list; branding
  // for this page already comes from fetchAppInfo above.
  const { providers } = await fetchSocialProviders(`/signup?client_id=${encodeURIComponent(clientId)}`)
  const nextSafe = next ?? ''
  const footer = (
    <Link
      href={nextSafe ? `/login?next=${encodeURIComponent(nextSafe)}` : '/login'}
      className="text-label-md text-primary hover:underline"
    >
      {t('signup.backToLogin')}
    </Link>
  )

  if (emailVerificationMethod === 'code') {
    return (
      <SignupWizardCard
        clientId={clientId}
        next={nextSafe}
        hasDefaultOrg={hasDefaultOrg}
        passwordPolicy={passwordPolicy}
        privacyPolicyUrl={privacyPolicyUrl}
        termsUrl={termsUrl}
        gdprUrl={gdprRequired ? gdprUrl : null}
        appName={appName}
        logo={logo}
        pageLightBackgroundColor={pageLightBackgroundColor}
        pageDarkBackgroundColor={pageDarkBackgroundColor}
        cardLightBackgroundColor={cardLightBackgroundColor}
        cardDarkBackgroundColor={cardDarkBackgroundColor}
        footer={footer}
      />
    )
  }

  return (
    <AuthCard
      title={appName ? t('signup.titleWithApp', { appName }) : t('signup.title')}
      subtitle={hasDefaultOrg ? t('signup.subtitleDefaultOrg') : t('signup.subtitle')}
      logoUrl={logo}
      logoAlt={appName ?? t('signup.title')}
      pageLightBackgroundColor={pageLightBackgroundColor}
      pageDarkBackgroundColor={pageDarkBackgroundColor}
      cardLightBackgroundColor={cardLightBackgroundColor}
      cardDarkBackgroundColor={cardDarkBackgroundColor}
      footer={footer}
    >
      <SignupForm
        clientId={clientId}
        next={nextSafe}
        hasDefaultOrg={hasDefaultOrg}
        canSocialSignup={canSocialSignup}
        providers={providers}
        authServerUrl={AUTH_SERVER}
        passwordPolicy={passwordPolicy}
        privacyPolicyUrl={privacyPolicyUrl}
        termsUrl={termsUrl}
        gdprUrl={gdprRequired ? gdprUrl : null}
      />
    </AuthCard>
  )
}
