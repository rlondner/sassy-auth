'use client'

import * as React from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Button } from '@sassy-auth/ui'
import { evaluatePasswordPolicy } from '@sassy-auth/types'
import type { PasswordPolicy } from '@/lib/types'
import { PasswordRequirementsChecklist } from '@/components/password-requirements-checklist'
import { registerAction } from './actions'

interface SignupFormProps {
  clientId: string
  next: string
  hasDefaultOrg: boolean
  passwordPolicy: PasswordPolicy | null
}

// Matches the server's global default password policy. Used when the
// app-info fetch failed (passwordPolicy is null) so the live checklist still
// has something sane to render instead of crashing.
const FALLBACK_POLICY: PasswordPolicy = {
  minLength: 12,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  requireSpecial: false,
  minNumbers: 1,
  minSpecial: 0,
}

const KNOWN_ERRORS = [
  'appNotFound',
  'emailTaken',
  'tooManyRequests',
  'serverUnavailable',
  'validationError',
] as const

export function SignupForm({ clientId, next, hasDefaultOrg, passwordPolicy }: SignupFormProps) {
  const t = useTranslations()
  const [firstName, setFirstName] = React.useState('')
  const [lastName, setLastName] = React.useState('')
  const [companyName, setCompanyName] = React.useState('')
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [confirm, setConfirm] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const [success, setSuccess] = React.useState(false)

  const policy = passwordPolicy ?? FALLBACK_POLICY
  const policyMet = evaluatePasswordPolicy(password, policy).every((r) => r.met)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) { setError(t('signup.errors.passwordMismatch')); return }
    if (!policyMet) { setError(t('signup.errors.passwordComplexity')); return }
    setError(null)
    setSubmitting(true)
    try {
      const result = await registerAction({
        clientId, firstName, lastName, email, password,
        ...(hasDefaultOrg ? {} : { companyName }),
      })
      if ('error' in result) {
        const key = (KNOWN_ERRORS as readonly string[]).includes(result.error) ? result.error : 'validationError'
        setError(t(`signup.errors.${key as (typeof KNOWN_ERRORS)[number]}`))
        return
      }
      setSuccess(true)
    } catch {
      setError(t('signup.errors.validationError'))
    } finally {
      setSubmitting(false)
    }
  }

  if (success) {
    const loginHref = next ? `/login?next=${encodeURIComponent(next)}` : '/login'
    return (
      <div className="text-center">
        <div className="mb-4 flex justify-center">
          <span className="material-symbols-outlined text-[48px] text-[var(--primary)]" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
        </div>
        <p className="text-body-md text-[var(--foreground)]">{t('signup.success')}</p>
        <div className="mt-4">
          <Link href={loginHref} className="text-label-md text-[var(--primary)] hover:underline">
            {t('signup.continueToLogin')}
          </Link>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="firstName" className="text-label-md font-semibold">{t('signup.firstName')}</label>
          <input
            id="firstName"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            required
            className="flex h-9 rounded border border-[var(--border)] px-3 text-body-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="lastName" className="text-label-md font-semibold">{t('signup.lastName')}</label>
          <input
            id="lastName"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            required
            className="flex h-9 rounded border border-[var(--border)] px-3 text-body-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          />
        </div>
      </div>
      {!hasDefaultOrg && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="companyName" className="text-label-md font-semibold">{t('signup.companyName')}</label>
          <input
            id="companyName"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            required
            className="flex h-9 rounded border border-[var(--border)] px-3 text-body-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          />
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-label-md font-semibold">{t('signup.email')}</label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="flex h-9 rounded border border-[var(--border)] px-3 text-body-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-label-md font-semibold">{t('signup.password')}</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="flex h-9 rounded border border-[var(--border)] px-3 text-body-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        />
        <PasswordRequirementsChecklist password={password} policy={policy} />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="confirm-password" className="text-label-md font-semibold">{t('signup.confirmPassword')}</label>
        <input
          id="confirm-password"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          className="flex h-9 rounded border border-[var(--border)] px-3 text-body-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        />
      </div>
      {error && <p data-testid="signup-error" className="text-label-md text-[var(--destructive)]">{error}</p>}
      <Button
        type="submit"
        className="w-full"
        loading={submitting}
        disabled={submitting || !policyMet || password !== confirm || password.length === 0}
      >
        {t('signup.submit')}
      </Button>
    </form>
  )
}
