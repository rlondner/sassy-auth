'use client'

import { useState, useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@sassy-auth/ui'
import { verifyTotp, verifyBackupCode } from '../actions'

const inputClass =
  'flex h-9 w-full rounded border border-[var(--border)] bg-[var(--card)] px-3 text-body-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] tracking-widest'

export function TwoFactorForm({ next, trustDays = 14 }: { next: string; trustDays?: number }) {
  const t = useTranslations('twoFactor')
  const [mode, setMode] = useState<'totp' | 'backup'>('totp')
  const [trustDevice, setTrustDevice] = useState(true)

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

  // FIX 4: only show the active mode's error; toggling clears the other mode's stale error.
  const totpError = mode === 'totp' ? totpState?.error : undefined
  const backupError = mode === 'backup' ? backupState?.error : undefined

  const trustDeviceCheckbox = (
    <label className="flex items-center gap-2 text-label-md text-[var(--muted-foreground)] cursor-pointer">
      <input
        type="checkbox"
        checked={trustDevice}
        onChange={(e) => setTrustDevice(e.target.checked)}
        className="h-4 w-4 rounded border-[var(--border)] accent-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      />
      {t('trustDevice', { days: trustDays })}
    </label>
  )

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
            <input type="hidden" name="trustDevice" value={trustDevice ? 'true' : 'false'} />
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
            {totpError && (
              <p data-testid="totp-error" className="text-label-md text-[var(--destructive)]">
                {errMsg(totpError)}
              </p>
            )}
            {trustDeviceCheckbox}
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
            <input type="hidden" name="trustDevice" value={trustDevice ? 'true' : 'false'} />
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
            {backupError && (
              <p data-testid="backup-error" className="text-label-md text-[var(--destructive)]">
                {errMsg(backupError)}
              </p>
            )}
            {trustDeviceCheckbox}
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
