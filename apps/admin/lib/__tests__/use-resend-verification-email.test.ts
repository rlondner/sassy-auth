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
})
