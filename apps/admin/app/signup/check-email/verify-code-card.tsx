'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { AuthCard, Button, FormField } from '@sassy-auth/ui'
import { useResendVerificationEmail } from '@/lib/use-resend-verification-email'

const ERROR_KEY_BY_CODE: Record<string, string> = {
  INVALID_OTP: 'errorInvalid',
  OTP_EXPIRED: 'errorExpired',
  TOO_MANY_ATTEMPTS: 'errorTooManyAttempts',
}

export function VerifyCodeCard({
  email,
  next,
  authServerUrl,
}: {
  email: string
  next: string
  authServerUrl: string
}) {
  const t = useTranslations('signup.verifyCode')
  const router = useRouter()
  const { resend, status: resendStatus, cooldown } = useResendVerificationEmail({ email, authServerUrl })
  const [otp, setOtp] = React.useState('')
  const [verifying, setVerifying] = React.useState(false)
  const [errorKey, setErrorKey] = React.useState<string | null>(null)

  const loginHref = next ? `/login?next=${encodeURIComponent(next)}` : '/login'

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErrorKey(null)
    setVerifying(true)
    try {
      const res = await fetch(`${authServerUrl}/api/auth/email-otp/verify-email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, otp }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { code?: string }
        setErrorKey(ERROR_KEY_BY_CODE[body.code ?? ''] ?? 'errorGeneric')
        return
      }
      router.push('/signup/verified')
    } catch {
      setErrorKey('errorGeneric')
    } finally {
      setVerifying(false)
    }
  }

  return (
    <AuthCard
      title={t('title')}
      subtitle={t('subtitle', { email })}
      footer={
        <Link href={loginHref} className="text-label-md text-primary hover:underline">
          {t('backToLogin')}
        </Link>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <FormField
          id="otp"
          inputMode="numeric"
          autoComplete="one-time-code"
          required
          label={t('codeLabel')}
          value={otp}
          onChange={(e) => setOtp(e.target.value)}
        />
        {errorKey && (
          <p data-testid="verify-code-error" className="text-label-md text-destructive">
            {t(errorKey)}
          </p>
        )}
        <Button type="submit" className="w-full" loading={verifying}>
          {t('submit')}
        </Button>
        <div className="flex flex-col items-center gap-2">
          <Button type="button" variant="ghost" onClick={resend} loading={resendStatus === 'sending'} disabled={cooldown > 0}>
            {cooldown > 0 ? t('resendCooldown', { seconds: cooldown }) : t('resendButton')}
          </Button>
          {resendStatus === 'sent' && (
            <p data-testid="verify-code-resent" className="text-body-sm text-muted-foreground">
              {t('resendSent')}
            </p>
          )}
          {resendStatus === 'error' && (
            <p data-testid="verify-code-resend-error" className="text-label-md text-destructive">
              {t('resendError')}
            </p>
          )}
        </div>
      </form>
    </AuthCard>
  )
}
