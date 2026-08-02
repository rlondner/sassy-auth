import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { UserFooter } from '../user-footer'

// Mock next-themes for ThemeToggle
jest.mock('next-themes', () => ({
  useTheme: () => ({
    resolvedTheme: 'dark',
    setTheme: jest.fn(),
  }),
}))

// Mock next/navigation for LocaleSwitcher
jest.mock('next/navigation', () => ({
  usePathname: () => '/apps',
}))

// Mock actions
jest.mock('@/app/(admin)/actions', () => ({
  signOutAction: 'mock-sign-out-action',
  setLocaleAction: jest.fn(),
}))

// Mock `@sassy-auth/ui` to avoid Radix UI Primitive context errors (e.g., Tooltip, DropdownMenu)
jest.mock('@sassy-auth/ui', () => {
  const Passthrough = ({ children }: { children?: React.ReactNode }) => <>{children}</>
  const Trigger = ({ children, asChild: _asChild, ...rest }: { children?: React.ReactNode; asChild?: boolean }) =>
    React.isValidElement(children) ? React.cloneElement(children, rest as object) : <>{children}</>
  return {
    UserAvatar: ({ firstName, lastName }: { firstName: string; lastName: string }) => (
      <div data-testid="user-avatar">{firstName[0]}{lastName[0]}</div>
    ),
    DropdownMenu: Passthrough,
    DropdownMenuTrigger: Trigger,
    DropdownMenuContent: Passthrough,
    DropdownMenuItem: Passthrough,
  }
})

describe('UserFooter', () => {
  const user = { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com' }
  const defaultProps = {
    user,
    currentLocale: 'en',
    availableLocales: ['en', 'fr'],
    signOutLabel: 'Sign Out',
    lightModeLabel: 'Switch to Light Mode',
    darkModeLabel: 'Switch to Dark Mode',
  }

  it('renders user information correctly', () => {
    render(<UserFooter {...defaultProps} />)
    expect(screen.getByText('Jane Doe')).toBeInTheDocument()
    expect(screen.getByText('jane.doe@example.com')).toBeInTheDocument()
    expect(screen.getAllByTestId('user-avatar')[0]).toHaveTextContent('JD')
  })

  it('contains the ThemeToggle button with correct transition and focus-visible classes', () => {
    render(<UserFooter {...defaultProps} />)
    const themeButton = screen.getByRole('button', { name: 'Switch to Light Mode' })
    expect(themeButton).toBeInTheDocument()
    expect(themeButton.className).toContain('transition-colors')
    expect(themeButton.className).toContain('hover:bg-sidebar-accent')
    expect(themeButton.className).toContain('focus-visible:ring-sidebar-ring')
  })

  it('contains the LocaleSwitcher button with correct transition and focus-visible classes', () => {
    render(<UserFooter {...defaultProps} />)
    const localeButton = screen.getByRole('button', { name: 'Change language' })
    expect(localeButton).toBeInTheDocument()
    expect(localeButton.className).toContain('transition-colors')
    expect(localeButton.className).toContain('hover:bg-sidebar-accent')
    expect(localeButton.className).toContain('focus-visible:ring-sidebar-ring')
  })

  it('contains the Sign Out button with correct transition and focus-visible classes', () => {
    render(<UserFooter {...defaultProps} />)
    const signOutButton = screen.getByRole('button', { name: 'Sign Out' })
    expect(signOutButton).toBeInTheDocument()
    expect(signOutButton.className).toContain('transition-colors')
    expect(signOutButton.className).toContain('hover:bg-sidebar-accent')
    expect(signOutButton.className).toContain('focus-visible:ring-sidebar-ring')
  })
})
