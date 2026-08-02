'use client'

import * as React from 'react'
import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'

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
    <button
      type="button"
      onClick={() => setTheme(next)}
      className="rounded-md p-1.5 text-sidebar-foreground hover:bg-sidebar-accent hover:text-white transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
      aria-label={label}
      title={label}
    >
      {mounted ? (
        isDark
          ? <Sun className="h-4 w-4" />
          : <Moon className="h-4 w-4" />
      ) : (
        <Moon className="h-4 w-4 opacity-0" />
      )}
    </button>
  )
}
