'use client'

import { useTransition } from 'react'
import { usePathname } from 'next/navigation'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@sassy-auth/ui'
import { setLocaleAction } from '@/app/(admin)/actions'

interface LocaleSwitcherProps {
  currentLocale: string
  availableLocales: string[]
}

export function LocaleSwitcher({ currentLocale, availableLocales }: LocaleSwitcherProps) {
  const [isPending, startTransition] = useTransition()
  const pathname = usePathname()

  function handleLocaleChange(locale: string) {
    startTransition(() => {
      setLocaleAction(locale, pathname)
    })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center gap-1 rounded px-2 py-1 text-[var(--sidebar-fg)] hover:bg-white/10 disabled:opacity-50"
          disabled={isPending}
        >
          <span className="material-symbols-outlined text-[18px]">language</span>
          <span className="text-label-sm font-bold tracking-wider">{currentLocale.toUpperCase()}</span>
          <span className="material-symbols-outlined text-[14px]">expand_more</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="bg-[#2d4157] border-white/10">
        {availableLocales.map((locale) => (
          <DropdownMenuItem
            key={locale}
            onClick={() => handleLocaleChange(locale)}
            className="text-[var(--primary-fixed)] focus:bg-white/10 focus:text-white"
          >
            {locale.toUpperCase()}
            {locale === currentLocale && (
              <span className="material-symbols-outlined ml-auto text-[16px]">check</span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
