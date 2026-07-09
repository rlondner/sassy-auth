'use client'

import { useTheme } from 'next-themes'
import { Toaster as Sonner } from 'sonner'

export function Toaster() {
  // Sonner's `theme="system"` follows the OS preference; we forward
  // next-themes' resolved value so manual light/dark toggles also take effect.
  const { resolvedTheme } = useTheme()
  return (
    <Sonner
      theme={(resolvedTheme as 'light' | 'dark' | undefined) ?? 'system'}
      position="bottom-right"
      richColors
      closeButton
    />
  )
}
