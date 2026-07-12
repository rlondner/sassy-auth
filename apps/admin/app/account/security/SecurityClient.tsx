'use client'

import { useState, useTransition } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { useTranslations } from 'next-intl'
import {
  enable2fa,
  confirmEnable,
  disable2fa,
  regenerateBackupCodes,
  type Enable2faResult,
  type RegenerateBackupCodesResult,
} from './actions'

type Step =
  | 'idle'
  | 'entering-password'
  | 'showing-qr'
  | 'confirming-code'
  | 'done'
  | 'disabling'
  | 'regenerating'

interface Props {
  twoFactorEnabled: boolean
}

function BackupCodesDisplay({
  codes,
  t,
}: {
  codes: string[]
  t: ReturnType<typeof useTranslations>
}) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    void navigator.clipboard.writeText(codes.join('\n')).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const handleDownload = () => {
    const blob = new Blob([codes.join('\n')], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'sassy-auth-backup-codes.txt'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-900/20">
      <p className="mb-3 font-medium">{t('backupCodes.heading')}</p>
      <p className="mb-3 text-sm text-muted-foreground">{t('backupCodes.body')}</p>
      <div className="mb-4 grid grid-cols-2 gap-1 font-mono text-sm">
        {codes.map((code) => (
          <span key={code} className="rounded bg-muted px-2 py-1">
            {code}
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleCopy}
          className="rounded-md border px-3 py-1.5 text-sm"
        >
          {copied ? t('backupCodes.copied') : t('backupCodes.copyButton')}
        </button>
        <button
          type="button"
          onClick={handleDownload}
          className="rounded-md border px-3 py-1.5 text-sm"
        >
          {t('backupCodes.downloadButton')}
        </button>
      </div>
    </div>
  )
}

export function SecurityClient({ twoFactorEnabled: initialEnabled }: Props) {
  const t = useTranslations('security')
  const [isPending, startTransition] = useTransition()
  const [enabled, setEnabled] = useState(initialEnabled)
  const [step, setStep] = useState<Step>('idle')
  const [totpURI, setTotpURI] = useState<string | null>(null)
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Extract the base32 secret from the otpauth URI for manual entry.
  // Format: otpauth://totp/<issuer>:<email>?secret=BASE32&issuer=...
  const manualSecret = totpURI
    ? new URLSearchParams(totpURI.split('?')[1] ?? '').get('secret') ?? null
    : null

  // --- Enable flow ---

  const handleEnableSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      const result: Enable2faResult = await enable2fa(fd)
      if ('error' in result) {
        setError(t(`errors.${result.error}` as Parameters<typeof t>[0]))
        return
      }
      setTotpURI(result.totpURI)
      setBackupCodes(result.backupCodes)
      setStep('showing-qr')
    })
  }

  const handleConfirmSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      const result = await confirmEnable(fd)
      if ('error' in result) {
        setError(t(`errors.${result.error}` as Parameters<typeof t>[0]))
        return
      }
      setEnabled(true)
      setStep('done')
    })
  }

  // --- Disable flow ---

  const handleDisableSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      const result = await disable2fa(fd)
      if ('error' in result) {
        setError(t(`errors.${result.error}` as Parameters<typeof t>[0]))
        return
      }
      setEnabled(false)
      setStep('idle')
    })
  }

  // --- Regenerate flow ---

  const handleRegenerateSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      const result: RegenerateBackupCodesResult = await regenerateBackupCodes(fd)
      if ('error' in result) {
        setError(t(`errors.${result.error}` as Parameters<typeof t>[0]))
        return
      }
      setBackupCodes(result.backupCodes)
      setStep('done')
    })
  }

  return (
    <div className="mx-auto max-w-xl space-y-6 py-10 px-4">
      <div>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      {/* Status badge */}
      <p className="text-sm font-medium">
        {enabled ? t('status.enabled') : t('status.disabled')}
      </p>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {/* ---- Enable flow ---- */}
      {!enabled && step === 'idle' && (
        <form onSubmit={handleEnableSubmit} className="space-y-4">
          <h2 className="font-medium">{t('enable.heading')}</h2>
          <label className="block text-sm">
            {t('enable.passwordLabel')}
            <input
              type="password"
              name="password"
              placeholder={t('enable.passwordPlaceholder')}
              required
              className="mt-1 block w-full rounded-md border px-3 py-2 text-sm"
            />
          </label>
          <button
            type="submit"
            disabled={isPending}
            className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
          >
            {isPending ? t('enable.submitting') : t('enable.submitButton')}
          </button>
        </form>
      )}

      {/* QR code display */}
      {!enabled && step === 'showing-qr' && totpURI && (
        <div className="space-y-4">
          <h2 className="font-medium">{t('enable.scanHeading')}</h2>
          <div className="flex justify-center rounded-md border bg-white p-4">
            <QRCodeSVG value={totpURI} size={200} />
          </div>
          {manualSecret && (
            <div>
              <p className="text-sm">{t('enable.manualEntry')}</p>
              <code className="mt-1 block break-all rounded bg-muted px-2 py-1 text-sm">
                {manualSecret}
              </code>
            </div>
          )}

          {/* Backup codes shown once here */}
          {backupCodes && <BackupCodesDisplay codes={backupCodes} t={t} />}

          {/* Confirm form */}
          <form onSubmit={handleConfirmSubmit} className="space-y-4 pt-2">
            <h2 className="font-medium">{t('enable.confirmHeading')}</h2>
            <label className="block text-sm">
              {t('enable.codeLabel')}
              <input
                type="text"
                name="code"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                className="mt-1 block w-full rounded-md border px-3 py-2 text-sm tracking-widest"
              />
            </label>
            <button
              type="submit"
              disabled={isPending}
              className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
            >
              {isPending ? t('enable.confirming') : t('enable.confirmButton')}
            </button>
          </form>
        </div>
      )}

      {/* Post-enable done state */}
      {enabled && step === 'done' && backupCodes && (
        <BackupCodesDisplay codes={backupCodes} t={t} />
      )}

      {/* ---- Disable flow ---- */}
      {enabled && step !== 'regenerating' && (
        <>
          {step !== 'disabling' ? (
            <button
              type="button"
              onClick={() => { setError(null); setStep('disabling') }}
              className="rounded-md border px-4 py-2 text-sm text-destructive border-destructive"
            >
              {t('disable.heading')}
            </button>
          ) : (
            <form onSubmit={handleDisableSubmit} className="space-y-4">
              <h2 className="font-medium">{t('disable.heading')}</h2>
              <p className="text-sm text-muted-foreground">{t('disable.body')}</p>
              <label className="block text-sm">
                {t('disable.passwordLabel')}
                <input
                  type="password"
                  name="password"
                  placeholder={t('disable.passwordPlaceholder')}
                  required
                  className="mt-1 block w-full rounded-md border px-3 py-2 text-sm"
                />
              </label>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={isPending}
                  className="rounded-md bg-destructive px-4 py-2 text-sm text-destructive-foreground disabled:opacity-50"
                >
                  {isPending ? t('disable.submitting') : t('disable.submitButton')}
                </button>
                <button
                  type="button"
                  onClick={() => setStep('idle')}
                  className="rounded-md border px-4 py-2 text-sm"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </>
      )}

      {/* ---- Regenerate backup codes ---- */}
      {enabled && step !== 'disabling' && (
        <>
          {step !== 'regenerating' ? (
            <button
              type="button"
              onClick={() => { setError(null); setStep('regenerating') }}
              className="rounded-md border px-4 py-2 text-sm"
            >
              {t('regenerate.heading')}
            </button>
          ) : (
            <form onSubmit={handleRegenerateSubmit} className="space-y-4">
              <h2 className="font-medium">{t('regenerate.heading')}</h2>
              <p className="text-sm text-muted-foreground">{t('regenerate.body')}</p>
              <label className="block text-sm">
                {t('regenerate.passwordLabel')}
                <input
                  type="password"
                  name="password"
                  placeholder={t('regenerate.passwordPlaceholder')}
                  required
                  className="mt-1 block w-full rounded-md border px-3 py-2 text-sm"
                />
              </label>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={isPending}
                  className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
                >
                  {isPending ? t('regenerate.submitting') : t('regenerate.submitButton')}
                </button>
                <button
                  type="button"
                  onClick={() => setStep('idle')}
                  className="rounded-md border px-4 py-2 text-sm"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </>
      )}
    </div>
  )
}
