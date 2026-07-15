'use client'

import * as React from 'react'
import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Tooltip, TooltipTrigger, TooltipContent } from '@sassy-auth/ui'

interface ThemeToggleProps {
  lightLabel: string
  darkLabel: string
}

export function ThemeToggle({ lightLabel, darkLabel }: ThemeToggleProps) {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => { setMounted(true) }, [])

  const isDark = mounted && resolvedTheme === 'dark'
  const next = isDark ? 'light' : 'dark'
  const label = isDark ? lightLabel : darkLabel

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => setTheme(next)}
          className="text-sidebar-foreground hover:text-white focus-visible:ring-2"
          aria-label={label}
        >
          {mounted ? (
            isDark
              ? <Sun className="h-4 w-4" />
              : <Moon className="h-4 w-4" />
          ) : (
            <Moon className="h-4 w-4 opacity-0" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
