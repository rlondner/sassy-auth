'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { AuthCard, Button } from '@sassy-auth/ui'
import { useResendVerificationEmail } from '@/lib/use-resend-verification-email'

export function LinkExpiredCard({
  email,
  authServerUrl,
  logo = null,
  pageLightBackgroundColor = null,
  pageDarkBackgroundColor = null,
  cardLightBackgroundColor = null,
  cardDarkBackgroundColor = null,
}: {
  email: string
  authServerUrl: string
  logo?: string | null
  pageLightBackgroundColor?: string | null
  pageDarkBackgroundColor?: string | null
  cardLightBackgroundColor?: string | null
  cardDarkBackgroundColor?: string | null
}) {
  const t = useTranslations('signup.verified.expired')
  const { resend, status, cooldown } = useResendVerificationEmail({ email, authServerUrl })

  return (
    <AuthCard
      title={t('title')}
      logoUrl={logo}
      subtitle={t('subtitle', { email })}
      pageLightBackgroundColor={pageLightBackgroundColor}
      pageDarkBackgroundColor={pageDarkBackgroundColor}
      cardLightBackgroundColor={cardLightBackgroundColor}
      cardDarkBackgroundColor={cardDarkBackgroundColor}
      footer={
        <Link href="/login" className="text-label-md text-primary hover:underline">
          {t('backToLogin')}
        </Link>
      }
    >
      <div className="flex flex-col items-center gap-3">
        <Button type="button" onClick={resend} loading={status === 'sending'} disabled={cooldown > 0}>
          {cooldown > 0 ? t('resendCooldown', { seconds: cooldown }) : t('resendButton')}
        </Button>
        {status === 'sent' && (
          <p data-testid="link-expired-resent" className="text-body-sm text-muted-foreground">
            {t('resendSent')}
          </p>
        )}
        {status === 'error' && (
          <p data-testid="link-expired-error" className="text-label-md text-destructive">
            {t('resendError')}
          </p>
        )}
      </div>
    </AuthCard>
  )
}
