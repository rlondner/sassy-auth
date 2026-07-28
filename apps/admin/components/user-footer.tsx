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
    <>
      {/* Expanded mode */}
      <div className="flex items-center gap-2 border-t border-sidebar-border bg-[hsl(220_47%_3%)] p-4 group-data-[collapsible=icon]:hidden">
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
            className="rounded text-sidebar-foreground hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
            title={signOutLabel}
            aria-label={signOutLabel}
          >
            <LogOut className="h-4 w-4" />
          </button>
        </form>
      </div>

      {/* Collapsed mode (icon-rail) */}
      <div className="hidden flex-col items-center gap-2 border-t border-sidebar-border bg-[hsl(220_47%_3%)] p-2 group-data-[collapsible=icon]:flex">
        <UserAvatar firstName={user.firstName} lastName={user.lastName} size="sm" />
      </div>
    </>
  )
}
