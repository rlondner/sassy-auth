'use client'

import { useState, useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@sassy-auth/ui'
import { verifyTotp, verifyBackupCode } from '../actions'

const inputClass =
  'flex h-9 w-full rounded border border-[var(--border)] bg-[var(--card)] px-3 text-body-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] tracking-widest'

export function TwoFactorForm({ next }: { next: string }) {
  const t = useTranslations('twoFactor')
  const [mode, setMode] = useState<'totp' | 'backup'>('totp')

  const [totpState, totpAction, totpPending] = useActionState<{ error?: string }, FormData>(
    async (_prev, formData) => verifyTotp(formData),
    {},
  )

  const [backupState, backupAction, backupPending] = useActionState<{ error?: string }, FormData>(
    async (_prev, formData) => verifyBackupCode(formData),
    {},
  )

  const errMsg = (e?: string) =>
    e === 'invalidCode' || e === 'serverUnavailable' ? t(`error.${e}`) : (e ?? '')

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--background)]">
      <div className="w-full max-w-sm rounded-lg border border-[var(--border)] bg-[var(--card)] p-8 shadow-sm">
        <div className="mb-6 text-center">
          <h1 className="text-headline-sm text-[var(--foreground)]">
            {mode === 'totp' ? t('title') : t('backupTitle')}
          </h1>
          <p className="mt-1 text-body-sm text-[var(--muted-foreground)]">
            {mode === 'totp' ? t('subtitle') : t('backupSubtitle')}
          </p>
        </div>

        {mode === 'totp' ? (
          <form action={totpAction} className="flex flex-col gap-4">
            <input type="hidden" name="next" value={next} />
            <input type="hidden" name="trustDevice" value="true" />
            <div className="flex flex-col gap-1.5">
              <label className="text-label-md font-semibold" htmlFor="totp-code">
                {t('codeLabel')}
              </label>
              <input
                id="totp-code"
                name="code"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                autoComplete="one-time-code"
                required
                className={inputClass}
              />
            </div>
            {totpState?.error && (
              <p data-testid="totp-error" className="text-label-md text-[var(--destructive)]">
                {errMsg(totpState.error)}
              </p>
            )}
            <Button type="submit" className="w-full" loading={totpPending}>
              {t('submit')}
            </Button>
            <button
              type="button"
              onClick={() => setMode('backup')}
              className="text-label-md text-[var(--primary)] hover:underline self-center"
            >
              {t('useBackupCode')}
            </button>
          </form>
        ) : (
          <form action={backupAction} className="flex flex-col gap-4">
            <input type="hidden" name="next" value={next} />
            <div className="flex flex-col gap-1.5">
              <label className="text-label-md font-semibold" htmlFor="backup-code">
                {t('backupCodeLabel')}
              </label>
              <input
                id="backup-code"
                name="code"
                autoComplete="off"
                required
                className={inputClass}
              />
            </div>
            {backupState?.error && (
              <p data-testid="backup-error" className="text-label-md text-[var(--destructive)]">
                {errMsg(backupState.error)}
              </p>
            )}
            <Button type="submit" className="w-full" loading={backupPending}>
              {t('submit')}
            </Button>
            <button
              type="button"
              onClick={() => setMode('totp')}
              className="text-label-md text-[var(--primary)] hover:underline self-center"
            >
              {t('useTotpCode')}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
