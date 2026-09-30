import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { AuthCard } from '@sassy-auth/ui'
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
  searchParams: Promise<{ error?: string; email?: string }>
}) {
  const { error, email } = await searchParams
  const t = await getTranslations()

  if (error === 'TOKEN_EXPIRED' && email) {
    return <LinkExpiredCard email={email} authServerUrl={PUBLIC_AUTH_SERVER} />
  }

  if (error) {
    return (
      <AuthCard
        title={t('signup.verified.invalid.title')}
        subtitle={t('signup.verified.invalid.subtitle')}
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
