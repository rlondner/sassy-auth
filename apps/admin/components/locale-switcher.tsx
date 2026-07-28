'use client'

import { useTransition } from 'react'
import { usePathname } from 'next/navigation'
import { Globe, Check, ChevronDown } from 'lucide-react'
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
          type="button"
          className="flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold text-sidebar-foreground hover:bg-sidebar-accent hover:text-white disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
          disabled={isPending}
          aria-label="Change language"
        >
          <Globe className="h-4 w-4" />
          <span className="tracking-wider">{currentLocale.toUpperCase()}</span>
          <ChevronDown className="h-3 w-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top">
        {availableLocales.map((locale) => (
          <DropdownMenuItem key={locale} onClick={() => handleLocaleChange(locale)}>
            {locale.toUpperCase()}
            {locale === currentLocale && <Check className="ml-auto h-4 w-4" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
