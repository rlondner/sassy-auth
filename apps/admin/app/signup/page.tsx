import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { AuthCard } from '@sassy-auth/ui'
import { fetchAppInfo } from '@/lib/app-info'
import { SignupForm } from './signup-form'

export const dynamic = 'force-dynamic'

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

  const { name: appName, hasDefaultOrg, passwordPolicy, logo, privacyPolicyUrl, termsUrl, gdprUrl, gdprRequired } =
    await fetchAppInfo(clientId)
  const nextSafe = next ?? ''

  return (
    <AuthCard
      title={appName ? t('signup.titleWithApp', { appName }) : t('signup.title')}
      subtitle={hasDefaultOrg ? t('signup.subtitleDefaultOrg') : t('signup.subtitle')}
      logoUrl={logo}
      logoAlt={appName ?? t('signup.title')}
      footer={
        <Link
          href={nextSafe ? `/login?next=${encodeURIComponent(nextSafe)}` : '/login'}
          className="text-label-md text-primary hover:underline"
        >
          {t('signup.backToLogin')}
        </Link>
      }
    >
      <SignupForm
        clientId={clientId}
        next={nextSafe}
        hasDefaultOrg={hasDefaultOrg}
        passwordPolicy={passwordPolicy}
        privacyPolicyUrl={privacyPolicyUrl}
        termsUrl={termsUrl}
        gdprUrl={gdprRequired ? gdprUrl : null}
      />
    </AuthCard>
  )
}
