'use client'

import { LogOut } from 'lucide-react'
import { UserAvatar } from '@sassy-auth/ui'
import { LocaleSwitcher } from './locale-switcher'
import { ThemeToggle } from './theme-toggle'
import { signOutAction } from '@/app/(admin)/actions'

interface UserFooterProps {
  user: { firstName: string; lastName: string; email: string }
  currentLocale: string
  availableLocales: string[]
  signOutLabel: string
  lightModeLabel: string
  darkModeLabel: string
}

export function UserFooter({
  user, currentLocale, availableLocales, signOutLabel, lightModeLabel, darkModeLabel,
}: UserFooterProps) {
  return (
    <div className="flex items-center gap-2 border-t border-sidebar-border bg-[hsl(220_47%_3%)] p-4">
      <UserAvatar firstName={user.firstName} lastName={user.lastName} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-white">{user.firstName} {user.lastName}</p>
        <p className="truncate text-xs text-sidebar-foreground">{user.email}</p>
      </div>
      <ThemeToggle lightLabel={lightModeLabel} darkLabel={darkModeLabel} />
      <LocaleSwitcher currentLocale={currentLocale} availableLocales={availableLocales} />
      <form action={signOutAction}>
        <button
          type="submit"
          className="text-sidebar-foreground hover:text-white"
          title={signOutLabel}
          aria-label={signOutLabel}
        >
          <LogOut className="h-4 w-4" />
        </button>
      </form>
    </div>
  )
}
