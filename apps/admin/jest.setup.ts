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

const React = require('react')

jest.mock('@sassy-auth/ui', () => {
  const actual = jest.requireActual('@sassy-auth/ui')
  const Passthrough = ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children)
  const Trigger = ({
    children,
    asChild,
    ...rest
  }: {
    children?: React.ReactNode
    asChild?: boolean
  }) => {
    if (asChild && React.isValidElement(children)) {
      return React.cloneElement(children, rest)
    }
    return React.createElement('div', rest, children)
  }

  return {
    ...actual,
    TooltipProvider: Passthrough,
    Tooltip: Passthrough,
    TooltipTrigger: Trigger,
    TooltipContent: Passthrough,
  }
})

jest.mock('@sentry/nextjs', () => ({
  addBreadcrumb: jest.fn(),
  setUser: jest.fn(),
  setTag: jest.fn(),
  captureException: jest.fn(),
  withScope: jest.fn((cb: any) => cb({ setExtra: jest.fn(), setTag: jest.fn() })),
}))
