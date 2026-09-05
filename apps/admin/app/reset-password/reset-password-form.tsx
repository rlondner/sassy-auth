'use client'

import * as React from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Button } from '@sassy-auth/ui'
import { evaluatePasswordPolicy } from '@sassy-auth/types'
import { getPasswordPolicyForResetToken } from '@/lib/api-public'
import type { PasswordPolicy } from '@/lib/types'
import { PasswordRequirementsChecklist } from '@/components/password-requirements-checklist'
import { resetPasswordSubmitAction } from './actions'

// Matches the server's global default password policy. Used until the
// client-side policy fetch resolves, and kept on fetch failure — the
// server-side hooks.before enforcement (Task 7) is the real gate regardless
// of what this checklist shows.
const FALLBACK_POLICY: PasswordPolicy = {
  minLength: 12,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  requireSpecial: false,
  minNumbers: 1,
  minSpecial: 0,
}

export function ResetPasswordForm({ token }: { token: string }) {
  const t = useTranslations('resetPassword')
  const [password, setPassword] = React.useState('')
  const [confirm, setConfirm] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const [success, setSuccess] = React.useState(false)
  const [policy, setPolicy] = React.useState<PasswordPolicy>(FALLBACK_POLICY)

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
                <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
                  className="flex h-9 rounded border border-[var(--border)] px-3 text-body-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]" />
                <PasswordRequirementsChecklist password={password} policy={policy} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="confirm-password" className="text-label-md font-semibold">{t('confirmPassword')}</label>
                <input id="confirm-password" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required
                  className="flex h-9 rounded border border-[var(--border)] px-3 text-body-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]" />
              </div>
              {error && <p data-testid="reset-error" className="text-label-md text-[var(--destructive)]">{error}</p>}
              <Button
                type="submit"
                className="w-full"
                disabled={submitting || !policyMet || password !== confirm || password.length === 0}
              >
                {submitting ? '…' : t('submit')}
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
