import { renderHook, act, waitFor } from '@testing-library/react'
import { useResendVerificationEmail } from '../use-resend-verification-email'

describe('useResendVerificationEmail', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('posts to send-verification-email with the email and a same-origin callbackURL, then sets a cooldown', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ status: true }) })
    global.fetch = fetchMock as unknown as typeof fetch

    const { result } = renderHook(() =>
      useResendVerificationEmail({ email: 'jane@example.com', authServerUrl: 'https://auth.example.com' }),
    )

    await act(async () => {
      await result.current.resend()
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://auth.example.com/api/auth/send-verification-email',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          email: 'jane@example.com',
          callbackURL: `${window.location.origin}/signup/verified?email=${encodeURIComponent('jane@example.com')}`,
        }),
      }),
    )
    expect(result.current.status).toBe('sent')
    expect(result.current.cooldown).toBeGreaterThan(0)
  })

  it('sets status to error when the request fails', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, json: async () => ({}) }) as unknown as typeof fetch
    const { result } = renderHook(() =>
      useResendVerificationEmail({ email: 'jane@example.com', authServerUrl: 'https://auth.example.com' }),
    )

    await act(async () => {
      await result.current.resend()
    })

    expect(result.current.status).toBe('error')
  })

  it('sets status to error when fetch itself rejects (e.g. offline)', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network error')) as unknown as typeof fetch
    const { result } = renderHook(() =>
      useResendVerificationEmail({ email: 'jane@example.com', authServerUrl: 'https://auth.example.com' }),
    )

    await act(async () => {
      await expect(result.current.resend()).resolves.toBeUndefined()
    })

    expect(result.current.status).toBe('error')
  })

  it('ignores a second resend() call while the first is still in-flight', async () => {
    let resolveFetch: (value: unknown) => void = () => {}
    const fetchMock = jest.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve
        }),
    )
    global.fetch = fetchMock as unknown as typeof fetch

    const { result } = renderHook(() =>
      useResendVerificationEmail({ email: 'jane@example.com', authServerUrl: 'https://auth.example.com' }),
    )

    let firstCallSettled = false
    act(() => {
      result.current.resend().then(() => {
        firstCallSettled = true
      })
    })

    await waitFor(() => expect(result.current.status).toBe('sending'))

    // A second call while the first is still in-flight must be a no-op.
    await act(async () => {
      await result.current.resend()
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveFetch({ ok: true, json: async () => ({}) })
      await waitFor(() => expect(firstCallSettled).toBe(true))
    })

    expect(result.current.status).toBe('sent')
    expect(result.current.cooldown).toBeGreaterThan(0)

    // And a call during the resulting cooldown must also be a no-op.
    await act(async () => {
      await result.current.resend()
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
