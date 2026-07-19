'use client'

import * as React from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Button } from '@sassy-auth/ui'
import { resetPasswordSubmitAction } from './actions'

export function ResetPasswordForm({ token }: { token: string }) {
  const t = useTranslations('resetPassword')
  const [password, setPassword] = React.useState('')
  const [confirm, setConfirm] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const [success, setSuccess] = React.useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password !== confirm) { setError(t('mismatch')); return }
    if (password.length < 12) { setError(t('tooShort')); return }
    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/.test(password)) { setError(t('complexity')); return }
    setSubmitting(true)
    const res = await resetPasswordSubmitAction(token, password)
    setSubmitting(false)
    if ('error' in res) { setError(t('invalidToken')); return }
    setSuccess(true)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--background)]">
      <div className="w-full max-w-sm rounded-lg border border-[var(--border)] bg-[var(--card)] p-8 shadow-sm">
        {success ? (
          <div className="text-center">
            <p data-testid="reset-success" className="text-body-md text-[var(--foreground)]">{t('success')}</p>
            <div className="mt-4"><Link href="/login" className="text-label-md text-[var(--primary)] hover:underline">{t('backToLogin')}</Link></div>
          </div>
        ) : (
          <>
            <h1 className="mb-6 text-center text-headline-sm text-[var(--foreground)]">{t('title')}</h1>
            <form onSubmit={onSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="password" className="text-label-md font-semibold">{t('password')}</label>
                <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={12}
                  className="flex h-9 rounded border border-[var(--border)] px-3 text-body-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="confirm-password" className="text-label-md font-semibold">{t('confirmPassword')}</label>
                <input id="confirm-password" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required
                  className="flex h-9 rounded border border-[var(--border)] px-3 text-body-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]" />
              </div>
              {error && <p data-testid="reset-error" className="text-label-md text-[var(--destructive)]">{error}</p>}
              <Button type="submit" className="w-full" loading={submitting}>{t('submit')}</Button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
