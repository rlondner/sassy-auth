import '@testing-library/jest-dom'

/**
 * This setup file ensures mock function identity is stable across jest.resetModules().
 */
beforeEach(() => {
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

  jest.setMock('fs', fsMock)
  jest.setMock('next/headers', nextHeadersMock)
})

jest.mock('@sassy-auth/ui', () => {
  const React = require('react')
  const actual = jest.requireActual('@sassy-auth/ui')

  const TooltipProvider = ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children)

  const Tooltip = ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children)

  const TooltipTrigger = ({ children, asChild }: { children: React.ReactNode; asChild?: boolean }) => {
    if (asChild && React.isValidElement(children)) {
      return React.cloneElement(children as React.ReactElement<any>)
    }
    return React.createElement('div', null, children)
  }

  const TooltipContent = ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children)

  return {
    ...actual,
    TooltipProvider,
    Tooltip,
    TooltipTrigger,
    TooltipContent,
  }
})

jest.mock('@sentry/nextjs', () => ({
  addBreadcrumb: jest.fn(),
  setUser: jest.fn(),
  setTag: jest.fn(),
  captureException: jest.fn(),
  withScope: jest.fn((cb: any) => cb({ setExtra: jest.fn(), setTag: jest.fn() })),
}))
