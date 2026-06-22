import '@testing-library/jest-dom'
import * as React from 'react'

// Radix Tooltip components require a TooltipProvider context which is often
// missing in unit tests. Mock them globally as simple passthroughs to avoid
// context errors and keep tests focused on the component under test.
// We mock @sassy-auth/ui here, but since many tests also mock it, we need to
// be careful. However, global mocks in jest.setup.ts are usually overridden
// by jest.mock() in test files.
jest.mock('@sassy-auth/ui', () => {
  const actual = jest.requireActual('@sassy-auth/ui')
  return {
    ...actual,
    TooltipProvider: ({ children }: any) => React.createElement(React.Fragment, null, children),
    Tooltip: ({ children }: any) => React.createElement(React.Fragment, null, children),
    TooltipTrigger: ({ children, asChild }: any) => {
      if (asChild && React.isValidElement(children)) {
        return React.cloneElement(children as React.ReactElement, { ...(children as React.ReactElement).props })
      }
      return React.createElement(React.Fragment, null, children)
    },
    TooltipContent: ({ children }: any) => React.createElement(React.Fragment, null, children),
  }
})

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


jest.mock('@sentry/nextjs', () => ({
  addBreadcrumb: jest.fn(),
  setUser: jest.fn(),
  setTag: jest.fn(),
  captureException: jest.fn(),
  withScope: jest.fn((cb: any) => cb({ setExtra: jest.fn(), setTag: jest.fn() })),
}))
