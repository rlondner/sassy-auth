'use client'

import * as React from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { AuthCard, Button } from '@sassy-auth/ui'

const COOLDOWN_SECONDS = 30

export function CheckEmailCard({
  email,
  next,
  authServerUrl,
}: {
  email: string
  next: string
  authServerUrl: string
}) {
  const t = useTranslations('signup.checkEmail')
  const [cooldown, setCooldown] = React.useState(0)
  const [status, setStatus] = React.useState<'idle' | 'sending' | 'sent' | 'error'>('idle')

  React.useEffect(() => {
    if (cooldown === 0) return
    const id = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(id)
  }, [cooldown])

  async function resend() {
    setStatus('sending')
    try {
      const res = await fetch(`${authServerUrl}/api/auth/send-verification-email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email,
          callbackURL: `${window.location.origin}/signup/verified`,
        }),
      })
      if (!res.ok) {
        setStatus('error')
        return
      }
      setStatus('sent')
      setCooldown(COOLDOWN_SECONDS)
    } catch {
      setStatus('error')
    }
  }

  const loginHref = next ? `/login?next=${encodeURIComponent(next)}` : '/login'

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
      <div className="flex flex-col items-center gap-3">
        <Button type="button" onClick={resend} loading={status === 'sending'} disabled={cooldown > 0}>
          {cooldown > 0 ? t('resendCooldown', { seconds: cooldown }) : t('resendButton')}
        </Button>
        {status === 'sent' && (
          <p data-testid="check-email-resent" className="text-body-sm text-muted-foreground">
            {t('resendSent')}
          </p>
        )}
        {status === 'error' && (
          <p data-testid="check-email-error" className="text-label-md text-destructive">
            {t('resendError')}
          </p>
        )}
      </div>
    </AuthCard>
  )
}
