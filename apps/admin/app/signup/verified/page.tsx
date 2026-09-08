import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { AuthCard } from '@sassy-auth/ui'

export default async function SignupVerifiedPage() {
  const t = await getTranslations()

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
