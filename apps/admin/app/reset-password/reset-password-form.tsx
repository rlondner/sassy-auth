'use client'

import * as React from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { AuthCard, Button, FormField } from '@sassy-auth/ui'
import { evaluatePasswordPolicy } from '@sassy-auth/types'
import { getPasswordPolicyForResetToken } from '@/lib/api-public'
import { FALLBACK_PASSWORD_POLICY, type PasswordPolicy } from '@/lib/types'
import { PasswordRequirementsChecklist } from '@/components/password-requirements-checklist'
import { resetPasswordSubmitAction } from './actions'

export function ResetPasswordForm({ token }: { token: string }) {
  const t = useTranslations('resetPassword')
  const [password, setPassword] = React.useState('')
  const [confirm, setConfirm] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const [success, setSuccess] = React.useState(false)
  // FALLBACK_PASSWORD_POLICY: used until the client-side policy fetch
  // resolves, and kept on fetch failure — the server-side hooks.before
  // enforcement (Task 7) is the real gate regardless of what this checklist
  // shows.
  const [policy, setPolicy] = React.useState<PasswordPolicy>(FALLBACK_PASSWORD_POLICY)

  React.useEffect(() => {
    let cancelled = false
    getPasswordPolicyForResetToken(token)
      .then((fetched) => {
        if (cancelled) return
        setPolicy(fetched)
      })
      .catch(() => {
        // Silently keep FALLBACK_POLICY: the server-side hooks.before
        // enforcement is the real gate regardless of what this checklist
        // shows.
      })
    return () => {
      cancelled = true
    }
  }, [token])

  const policyMet = evaluatePasswordPolicy(password, policy).every((r) => r.met)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password !== confirm) { setError(t('mismatch')); return }
    if (!policyMet) { setError(t('complexity')); return }
    setSubmitting(true)
    const res = await resetPasswordSubmitAction(token, password)
    setSubmitting(false)
    // Branch on the error value, not merely its presence. The action
    // distinguishes an unreachable server and a throttled request from a
    // rejected token; blaming the link in either case sends the user to
    // request a new one, which is itself rate-limited.
    if ('error' in res) {
      const known = ['serverUnavailable', 'tooManyRequests'] as const
      const key = (known as readonly string[]).includes(res.error) ? res.error : 'invalidToken'
      setError(t(key as 'serverUnavailable' | 'tooManyRequests' | 'invalidToken'))
      return
    }
    setSuccess(true)
  }

  if (success) {
    return (
      <AuthCard
        footer={
          <Link href="/login" className="text-label-md text-primary hover:underline">
            {t('backToLogin')}
          </Link>
        }
      >
        <p data-testid="reset-success" className="text-center text-body-md text-foreground">{t('success')}</p>
      </AuthCard>
    )
  }

  return (
    <AuthCard title={t('title')}>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <FormField
            id="password"
            type="password"
            label={t('password')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <PasswordRequirementsChecklist password={password} policy={policy} />
        </div>
        <FormField
          id="confirm-password"
          type="password"
          label={t('confirmPassword')}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
        />
        {error && <p data-testid="reset-error" className="text-label-md text-destructive">{error}</p>}
        <Button
          type="submit"
          className="w-full"
          disabled={submitting || !policyMet || password !== confirm || password.length === 0}
        >
          {submitting ? '…' : t('submit')}
        </Button>
      </form>
    </AuthCard>
  )
}
