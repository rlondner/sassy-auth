'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { Button } from '@sassy-auth/ui'
import { evaluatePasswordPolicy } from '@sassy-auth/types'
import { acceptInvitation } from '@/lib/api-public'
import type { PasswordPolicy } from '@/lib/types'
import { PasswordRequirementsChecklist } from '@/components/password-requirements-checklist'

interface AcceptInviteFormProps {
  token: string
  firstName: string
  email: string
  passwordPolicy: PasswordPolicy
}

export function AcceptInviteForm({ token, firstName, email, passwordPolicy }: AcceptInviteFormProps) {
  const t = useTranslations()
  const router = useRouter()
  const [password, setPassword] = React.useState('')
  const [confirm, setConfirm] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const [success, setSuccess] = React.useState(false)

  const policyMet = evaluatePasswordPolicy(password, passwordPolicy).every((r) => r.met)
  // bug-0160: track the redirect timer in a ref so unmount can
  // cancel it. Previously the setTimeout could fire after the user
  // navigated away, triggering a router.push into a stale route.
  const redirectTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(
    () => () => {
      if (redirectTimerRef.current !== null) clearTimeout(redirectTimerRef.current)
    },
    [],
  )

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) { setError(t('acceptInvite.errors.passwordMismatch')); return }
    if (!policyMet) { setError(t('acceptInvite.errors.passwordComplexity')); return }
    setError(null)
    setSubmitting(true)
    try {
      await acceptInvitation(token, password)
      setSuccess(true)
      redirectTimerRef.current = setTimeout(() => router.push('/login'), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('acceptInvite.errors.genericError'))
    } finally {
      setSubmitting(false)
    }
  }

  if (success) {
    return (
      <div className="text-center">
        <div className="mb-4 flex justify-center">
          <span className="material-symbols-outlined text-[48px] text-[var(--primary)]" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
        </div>
        <p className="text-body-md text-[var(--foreground)]">{t('acceptInvite.success')}</p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-label-md font-semibold">{t('acceptInvite.password')}</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="flex h-9 rounded border border-[var(--border)] px-3 text-body-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        />
        <PasswordRequirementsChecklist password={password} policy={passwordPolicy} />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="confirm-password" className="text-label-md font-semibold">{t('acceptInvite.confirmPassword')}</label>
        <input
          id="confirm-password"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          className="flex h-9 rounded border border-[var(--border)] px-3 text-body-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        />
      </div>
      {error && <p className="text-label-md text-[var(--destructive)]">{error}</p>}
      <Button
        type="submit"
        className="w-full"
        loading={submitting}
        disabled={submitting || !policyMet || password !== confirm || password.length === 0}
      >
        {t('acceptInvite.submit')}
      </Button>
    </form>
  )
}
