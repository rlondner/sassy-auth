import '@testing-library/jest-dom'

/**
 * This setup file ensures mock function identity is stable across jest.resetModules().
 *
 * Problem: jest.resetModules() clears _mockRegistry (instantiated mock objects) so
 * that when a module is re-required, the factory runs again, creating new jest.fn()
 * instances. Mock setup done on the OLD instances (captured at test file load) has
 * no effect on the NEW instances used by the re-imported module.
 *
 * Solution: In a beforeEach (which runs before the test file's beforeEach), save
 * the current mock objects for 'fs' and 'next/headers' via jest.requireMock(), then
 * call jest.setMock() to register a stable factory (() => savedMock) for those modules.
 * This way, after jest.resetModules() clears _mockRegistry, the factory for 'fs' still
 * returns the SAME mock object, so the module under test gets the same mock instances
 * that the test file captured.
 */
beforeEach(() => {
  // Save the current mock objects. These are the same objects that test files
  // capture as mockReaddirSync, mockCookies, mockHeaders.
  let fsMock: unknown
  let nextHeadersMock: unknown

  try {
    fsMock = jest.requireMock('fs')
  } catch {
    return
  }

  try {
    nextHeadersMock = jest.requireMock('next/headers')
  } catch {
    return
  }

  // Re-register stable factories so that after jest.resetModules() clears
  // _mockRegistry, subsequent require('fs') calls return the same mock object.
  jest.setMock('fs', fsMock)
  jest.setMock('next/headers', nextHeadersMock)
})

jest.mock('@sassy-auth/ui', () => {
  const React = require('react')
  const actual = jest.requireActual('@sassy-auth/ui')

  // Tooltip components require TooltipProvider context which is often missing
  // in unit tests. We mock them as passthroughs.
  const Tooltip = ({ children }: any) => children
  const TooltipTrigger = ({ children, asChild }: any) => {
    if (asChild) {
      return React.cloneElement(React.Children.only(children))
    }
    return children
  }
  const TooltipContent = () => null
  const TooltipProvider = ({ children }: any) => children

  // DropdownMenu is often closed/portal-hidden in JSDOM, making it hard to
  // test content. We mock it to always render its content.
  const DropdownMenu = ({ children }: any) => children
  const DropdownMenuTrigger = ({ children, asChild }: any) => {
    if (asChild) {
      return React.cloneElement(React.Children.only(children))
    }
    return children
  }
  const DropdownMenuContent = ({ children }: any) => children

  // SidebarTrigger uses SidebarContext
  const SidebarTrigger = () => null

  return {
    ...actual,
    Tooltip,
    TooltipTrigger,
    TooltipContent,
    TooltipProvider,
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    SidebarTrigger,
  }
})

jest.mock('@sentry/nextjs', () => ({
  addBreadcrumb: jest.fn(),
  setUser: jest.fn(),
  setTag: jest.fn(),
  captureException: jest.fn(),
  withScope: jest.fn((cb: any) => cb({ setExtra: jest.fn(), setTag: jest.fn() })),
}))
