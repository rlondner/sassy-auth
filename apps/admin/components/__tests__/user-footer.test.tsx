import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { UserFooter } from '../user-footer'
import en from '@/messages/en.json'

// Mock signOutAction
jest.mock('@/app/(admin)/actions', () => ({
  signOutAction: jest.fn(),
  setLocaleAction: jest.fn(),
}))

// Mock useTheme
jest.mock('next-themes', () => ({
  useTheme: () => ({
    resolvedTheme: 'dark',
    setTheme: jest.fn(),
  }),
}))

// Mock next/navigation
jest.mock('next/navigation', () => ({
  usePathname: () => '/admin/apps',
}))

function withIntl(node: React.ReactNode) {
  return (
    <NextIntlClientProvider locale="en" messages={en}>
      {node}
    </NextIntlClientProvider>
  )
}

describe('UserFooter accessibility and styling', () => {
  const props = {
    user: { firstName: 'John', lastName: 'Doe', email: 'john@example.com' },
    currentLocale: 'en',
    availableLocales: ['en', 'fr'],
    signOutLabel: 'Sign Out',
    lightModeLabel: 'Light Mode',
    darkModeLabel: 'Dark Mode',
  }

  it('renders theme toggle, locale switcher, and signout button with correct style and focus/accessibility classes', () => {
    render(withIntl(<UserFooter {...props} />))

    // Theme Toggle checks
    const themeToggle = screen.getByRole('button', { name: /light mode/i })
    expect(themeToggle).toBeInTheDocument()
    expect(themeToggle).toHaveClass('focus-visible:ring-2')
    expect(themeToggle).toHaveClass('focus-visible:ring-sidebar-ring')
    expect(themeToggle).toHaveClass('hover:bg-sidebar-accent')
    expect(themeToggle).toHaveClass('transition-all')

    // Locale Switcher checks
    const localeSwitcher = screen.getByRole('button', { name: /change language/i })
    expect(localeSwitcher).toBeInTheDocument()
    expect(localeSwitcher).toHaveClass('focus-visible:ring-2')
    expect(localeSwitcher).toHaveClass('focus-visible:ring-sidebar-ring')
    expect(localeSwitcher).toHaveClass('hover:bg-sidebar-accent')
    expect(localeSwitcher).toHaveClass('transition-all')

    // Sign out button checks
    const signOutBtn = screen.getByRole('button', { name: /sign out/i })
    expect(signOutBtn).toBeInTheDocument()
    expect(signOutBtn).toHaveClass('focus-visible:ring-2')
    expect(signOutBtn).toHaveClass('focus-visible:ring-sidebar-ring')
    expect(signOutBtn).toHaveClass('hover:bg-sidebar-accent')
    expect(signOutBtn).toHaveClass('transition-all')
  })
})
