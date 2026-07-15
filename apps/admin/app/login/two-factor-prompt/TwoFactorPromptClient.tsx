'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button } from '@sassy-auth/ui'

interface Props { next: string }

export function TwoFactorPromptClient({ next }: Props) {
  const t = useTranslations('twoFactorPrompt')
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  async function recordPrompt() {
    // Best-effort: record that the prompt was shown.
    try {
      await fetch('/api/proxy/me/two-factor-prompted', { method: 'POST' })
    } catch { /* ignore */ }
  }

  function handleSetUp() {
    startTransition(async () => {
      await recordPrompt()
      const setupUrl = `/account/security${next ? `?next=${encodeURIComponent(next)}` : ''}`
      router.push(setupUrl)
    })
  }

  function handleSkip() {
    startTransition(async () => {
      await recordPrompt()
      router.push(next || '/users')
    })
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--background)]">
      <div className="w-full max-w-sm rounded-lg border border-[var(--border)] bg-[var(--card)] p-8 shadow-sm text-center space-y-4">
        <h1 className="text-headline-sm text-[var(--foreground)]">{t('title')}</h1>
        <p className="text-body-sm text-[var(--muted-foreground)]">{t('body')}</p>
        <div className="flex flex-col gap-3 pt-2">
          <Button className="w-full" onClick={handleSetUp} loading={isPending}>
            {t('setUp')}
          </Button>
          <button
            type="button"
            onClick={handleSkip}
            disabled={isPending}
            className="text-label-md text-[var(--muted-foreground)] hover:underline"
          >
            {t('skip')}
          </button>
        </div>
      </div>
    </div>
  )
}
