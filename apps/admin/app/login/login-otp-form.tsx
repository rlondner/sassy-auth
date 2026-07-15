'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@sassy-auth/ui'
import { requestOtp, verifyOtp } from './actions'

const inputClass =
  'flex h-9 w-full rounded border border-[var(--border)] bg-[var(--card)] px-3 text-body-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]'

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
    e === 'invalidCode' || e === 'inactive' || e === 'serverUnavailable' ? t(`error.${e}`) : e

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--background)]">
      <div className="w-full max-w-sm rounded-lg border border-[var(--border)] bg-[var(--card)] p-8 shadow-sm">
        <div className="mb-6 text-center">
          <h1 className="text-headline-sm text-[var(--foreground)]">{t('otp.title')}</h1>
          <p className="mt-1 text-body-sm text-[var(--muted-foreground)]">{t('otp.subtitle')}</p>
        </div>

        {step === 'email' ? (
          <form action={requestAction} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-label-md font-semibold" htmlFor="email">{t('email')}</label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
              />
            </div>
            {reqState?.error && (
              <p data-testid="otp-error" className="text-label-md text-[var(--destructive)]">{errKey(reqState.error)}</p>
            )}
            <Button type="submit" className="w-full" loading={reqPending}>{t('otp.sendCode')}</Button>
            <Link href="/login" className="text-label-md text-[var(--primary)] hover:underline self-center">
              {t('otp.usePassword')}
            </Link>
          </form>
        ) : (
          <form action={verifyActionFn} className="flex flex-col gap-4">
            <input type="hidden" name="next" value={next} />
            <input type="hidden" name="email" value={email} />
            <p data-testid="otp-sent" className="text-body-sm text-[var(--muted-foreground)]">{t('otp.sent')}</p>
            <p className="text-body-sm text-[var(--muted-foreground)]">
              {t('otp.twoFactorHint')}
            </p>
            <div className="flex flex-col gap-1.5">
              <label className="text-label-md font-semibold" htmlFor="otp">{t('otp.codeLabel')}</label>
              <input
                id="otp"
                name="otp"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                className={inputClass}
              />
            </div>
            {'error' in verifyState && verifyState.error && (
              <p data-testid="otp-error" className="text-label-md text-[var(--destructive)]">{errKey(verifyState.error)}</p>
            )}
            <Button type="submit" className="w-full" loading={verifyPending}>{t('otp.verify')}</Button>
            <button
              type="button"
              onClick={() => setStep('email')}
              className="text-label-md text-[var(--primary)] hover:underline self-center"
            >
              {t('otp.changeEmail')}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
