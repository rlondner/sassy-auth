'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { copyToClipboard } from './clipboard'

/**
 * bug-0155: 13 admin components ran the same "copy → set copied flag →
 * setTimeout(clear, 2000)" recipe inline, and none of them cleared the
 * timer on unmount. Two failure modes were latent:
 *
 * 1. Fast unmount + late `setCopied(null)` — the state setter runs
 *    after the component tree is gone, producing React's "state update
 *    on unmounted component" warning at best and doing nothing at worst.
 * 2. Fast successive copies — each click stacked a new setTimeout on
 *    top of the pending one, so the icon would flicker as the trailing
 *    timers reset in the wrong order.
 *
 * This hook owns the timer in a ref, clears it before scheduling a new
 * one, and cleans up in the useEffect return so unmount is safe.
 *
 * Usage:
 *
 *   const { copiedKey, copy } = useCopyFeedback()
 *
 *   <button onClick={() => copy(row.publicId, row.publicId)}>
 *     <Icon name={copiedKey === row.publicId ? 'check' : 'copy'} />
 *   </button>
 */
interface CopyFeedbackOptions {
  /** Milliseconds before the "copied" flag clears. Defaults to 2000. */
  resetMs?: number
  /** Overrides the localized clipboard-failure toast. */
  errorMessage?: string
}

export function useCopyFeedback(options: number | CopyFeedbackOptions = {}) {
  // The hook has 14 call sites, several passing the reset delay positionally.
  // Accept both shapes so bug-0227 does not turn into a 14-file refactor.
  const { resetMs = 2000, errorMessage } =
    typeof options === 'number' ? { resetMs: options, errorMessage: undefined } : options

  // bug-0227: the failure toast used to be a hardcoded English string — the
  // only user-facing text in the admin app bypassing next-intl, so French
  // users got English. Translating inside the hook (rather than threading a
  // `t` through every caller) means a new call site cannot forget to localize
  // it. Safe here: this is a client hook and every caller already renders
  // under NextIntlClientProvider.
  const t = useTranslations()
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    },
    [],
  )

  const copy = useCallback(
    async (text: string, key: string): Promise<boolean> => {
      const ok = await copyToClipboard(text)
      if (!ok) {
        // bug-0171: previously the clipboard failure was silently
        // swallowed — the user got no "check" icon and no error, so
        // they thought the click didn't register. Surface a toast so
        // they know to try again (e.g. after granting the clipboard
        // permission on their browser).
        toast.error(errorMessage ?? t('common.copyFailed'))
        return false
      }
      if (timerRef.current !== null) clearTimeout(timerRef.current)
      setCopiedKey(key)
      timerRef.current = setTimeout(() => {
        setCopiedKey(null)
        timerRef.current = null
      }, resetMs)
      return true
    },
    [resetMs, errorMessage, t],
  )

  return { copiedKey, copy }
}
