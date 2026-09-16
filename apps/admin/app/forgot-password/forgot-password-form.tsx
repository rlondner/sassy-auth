'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { useActionState } from 'react'
import { AuthCard, Button, FormField } from '@sassy-auth/ui'
import { requestPasswordResetAction } from './actions'

export function ForgotPasswordForm() {
  const t = useTranslations('forgotPassword')
  const [state, formAction, isPending] = useActionState(
    async (_prev: { done?: boolean } | { done: true }, formData: FormData) => requestPasswordResetAction(formData),
    {} as { done?: boolean },
  )

  return (
    <AuthCard
      title={t('title')}
      subtitle={t('subtitle')}
      footer={
        <Link href="/login" className="text-label-md text-primary hover:underline">
          {t('backToLogin')}
        </Link>
      }
    >
      {state?.done ? (
        <p data-testid="forgot-sent" className="text-body-md text-foreground">{t('sent')}</p>
      ) : (
        <form action={formAction} className="flex flex-col gap-4">
          <FormField id="email" name="email" type="email" autoComplete="email" required label={t('email')} />
          <Button type="submit" className="w-full" disabled={isPending}>{isPending ? '…' : t('submit')}</Button>
        </form>
      )}
    </AuthCard>
  )
}
