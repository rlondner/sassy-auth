'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import { AuthCard, Button, FormField } from '@sassy-auth/ui'
import { requestOtp, verifyOtp } from './actions'

export function LoginOtpForm({ next }: { next: string }) {
  const t = useTranslations('login')
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [step, setStep] = useState<'email' | 'code'>('email')

  const [reqState, requestAction, reqPending] = useActionState<
    { sent?: true; error?: string },
    FormData
  >(
    async (_prev, formData) => {
      const res = await requestOtp(formData)
      if ('sent' in res) setStep('code')
      return res as { sent?: true; error?: string }
    },
    {},
  )

  const [verifyState, verifyActionFn, verifyPending] = useActionState<
    { error?: string } | { twoFactor: true },
    FormData
  >(
    async (_prev, formData) => {
      const result = await verifyOtp(formData)
      if ('twoFactor' in result && result.twoFactor) {
        router.push(`/login/two-factor${next ? `?next=${encodeURIComponent(next)}` : ''}`)
      }
      return result
    },
    {},
  )

  const errKey = (e?: string) =>
    e === 'invalidCode' || e === 'inactive' || e === 'serverUnavailable' || e === 'tooManyRequests'
      ? t(`error.${e}`)
      : e

  return (
    <AuthCard title={t('otp.title')} subtitle={t('otp.subtitle')}>
      {step === 'email' ? (
        <form action={requestAction} className="flex flex-col gap-4">
          <FormField
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            label={t('email')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {reqState?.error && (
            <p data-testid="otp-error" className="text-label-md text-destructive">{errKey(reqState.error)}</p>
          )}
          <Button type="submit" className="w-full" loading={reqPending}>{t('otp.sendCode')}</Button>
          <Link href="/login" className="self-center text-label-md text-primary hover:underline">
            {t('otp.usePassword')}
          </Link>
        </form>
      ) : (
        <form action={verifyActionFn} className="flex flex-col gap-4">
          <input type="hidden" name="next" value={next} />
          <input type="hidden" name="email" value={email} />
          <p data-testid="otp-sent" className="text-body-sm text-muted-foreground">{t('otp.sent')}</p>
          <p className="text-body-sm text-muted-foreground">
            {t('otp.twoFactorHint')}
          </p>
          <FormField
            id="otp"
            name="otp"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            label={t('otp.codeLabel')}
          />
          {'error' in verifyState && verifyState.error && (
            <p data-testid="otp-error" className="text-label-md text-destructive">{errKey(verifyState.error)}</p>
          )}
          <Button type="submit" className="w-full" loading={verifyPending}>{t('otp.verify')}</Button>
          <button
            type="button"
            onClick={() => setStep('email')}
            className="self-center text-label-md text-primary hover:underline"
          >
            {t('otp.changeEmail')}
          </button>
        </form>
      )}
    </AuthCard>
  )
}
