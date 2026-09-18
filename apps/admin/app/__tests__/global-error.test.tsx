import { render } from '@testing-library/react'
import GlobalError from '../global-error'

const captureExceptionMock = jest.fn()
jest.mock('@sentry/nextjs', () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
}))

const initOtelClientMock = jest.fn()
const captureClientErrorMock = jest.fn()
jest.mock('@sassy-auth/telemetry/client', () => ({
  initOtelClient: (...args: unknown[]) => initOtelClientMock(...args),
  captureClientError: (...args: unknown[]) => captureClientErrorMock(...args),
}))

describe('GlobalError', () => {
  afterEach(() => jest.clearAllMocks())

  it('reports the error to both Sentry and the OTel client.error span', () => {
    const error = Object.assign(new Error('boom'), { digest: 'abc123' })
    render(<GlobalError error={error} reset={jest.fn()} />)

    expect(captureExceptionMock).toHaveBeenCalledWith(error)
    expect(initOtelClientMock).toHaveBeenCalledWith('sassy-auth-admin')
    expect(captureClientErrorMock).toHaveBeenCalledWith(error, { boundary: 'global-error' })
  })
})
