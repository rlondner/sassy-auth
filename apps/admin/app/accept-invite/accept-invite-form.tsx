'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { Button } from '@sassy-auth/ui'
import { acceptInvitation } from '@/lib/api-public'

interface AcceptInviteFormProps {
  token: string
  firstName: string
  email: string
}

export function AcceptInviteForm({ token, firstName, email }: AcceptInviteFormProps) {
  const t = useTranslations()
  const router = useRouter()
  const [password, setPassword] = React.useState('')
  const [confirm, setConfirm] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const [success, setSuccess] = React.useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) { setError('Passwords do not match.'); return }
    if (password.length < 12) {
      setError('Password must be at least 12 characters.')
      return
    }
    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/.test(password)) {
      setError(
        'Password must contain an uppercase letter, a lowercase letter, and a digit.',
      )
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      await acceptInvitation(token, password)
      setSuccess(true)
      setTimeout(() => router.push('/login'), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
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
          minLength={12}
          className="flex h-9 rounded border border-[var(--border)] px-3 text-body-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        />
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
      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting ? '…' : t('acceptInvite.submit')}
      </Button>
    </form>
  )
}
