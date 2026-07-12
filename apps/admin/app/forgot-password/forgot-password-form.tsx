'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { useActionState } from 'react'
import { Button } from '@sassy-auth/ui'
import { requestPasswordResetAction } from './actions'

export function ForgotPasswordForm() {
  const t = useTranslations('forgotPassword')
  const [state, formAction, isPending] = useActionState(
    async (_prev: { done?: boolean } | { done: true }, formData: FormData) => requestPasswordResetAction(formData),
    {} as { done?: boolean },
  )

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--background)]">
      <div className="w-full max-w-sm rounded-lg border border-[var(--border)] bg-[var(--card)] p-8 shadow-sm">
        <div className="mb-6 text-center">
          <h1 className="text-headline-sm text-[var(--foreground)]">{t('title')}</h1>
          <p className="mt-1 text-body-sm text-[var(--muted-foreground)]">{t('subtitle')}</p>
        </div>
        {state?.done ? (
          <p data-testid="forgot-sent" className="text-body-md text-[var(--foreground)]">{t('sent')}</p>
        ) : (
          <form action={formAction} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-label-md font-semibold" htmlFor="email">{t('email')}</label>
              <input id="email" name="email" type="email" autoComplete="email" required
                className="flex h-9 w-full rounded border border-[var(--border)] bg-[var(--card)] px-3 text-body-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]" />
            </div>
            <Button type="submit" className="w-full" disabled={isPending}>{isPending ? '…' : t('submit')}</Button>
          </form>
        )}
        <div className="mt-4 text-center">
          <Link href="/login" className="text-label-md text-[var(--primary)] hover:underline">{t('backToLogin')}</Link>
        </div>
      </div>
    </div>
  )
}
