'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
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
export function useCopyFeedback(resetMs = 2000) {
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
      if (!ok) return false
      if (timerRef.current !== null) clearTimeout(timerRef.current)
      setCopiedKey(key)
      timerRef.current = setTimeout(() => {
        setCopiedKey(null)
        timerRef.current = null
      }, resetMs)
      return true
    },
    [resetMs],
  )

  return { copiedKey, copy }
}
