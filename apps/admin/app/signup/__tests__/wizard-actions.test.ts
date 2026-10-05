import { startRegistrationAction, verifyRegistrationCodeAction, completeRegistrationAction } from '../wizard-actions'

jest.mock('@/lib/auth-origin', () => ({ getForwardedOrigin: jest.fn().mockResolvedValue(null) }))
jest.mock('@/lib/forward-client-ip', () => ({ getForwardedClientIpHeader: jest.fn().mockResolvedValue({}) }))
jest.mock('@sentry/nextjs', () => ({ captureException: jest.fn() }))

const mockFetch = jest.fn()
global.fetch = mockFetch as unknown as typeof fetch

beforeEach(() => {
  jest.clearAllMocks()
})

describe('startRegistrationAction', () => {
  const input = { clientId: 'sq_1', email: 'a@x.com', turnstileToken: 'real-turnstile-token' }

  it('posts to /api/register/start and forwards the real turnstileToken as-is', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    const result = await startRegistrationAction(input)
    expect(result).toEqual({ ok: true })
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/register/start'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'a@x.com', appPublicId: 'sq_1', turnstileToken: 'real-turnstile-token' }),
      }),
    )
  })

  it('maps 409 to emailTaken', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 409 })
    expect(await startRegistrationAction(input)).toEqual({ error: 'emailTaken' })
  })

  it('maps 422 to captchaFailed', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 422 })
    expect(await startRegistrationAction(input)).toEqual({ error: 'captchaFailed' })
  })

  it('maps 429 to tooManyRequests', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 429 })
    expect(await startRegistrationAction(input)).toEqual({ error: 'tooManyRequests' })
  })

  it('maps a network failure to serverUnavailable', async () => {
    mockFetch.mockRejectedValue(new Error('network down'))
    expect(await startRegistrationAction(input)).toEqual({ error: 'serverUnavailable' })
  })
})

describe('verifyRegistrationCodeAction', () => {
  it('returns ok on success', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    expect(await verifyRegistrationCodeAction({ email: 'a@x.com', otp: '123456' })).toEqual({ ok: true })
  })

  it('returns the server-provided error code on failure', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 400, json: async () => ({ code: 'INVALID_OTP' }) })
    expect(await verifyRegistrationCodeAction({ email: 'a@x.com', otp: '000000' })).toEqual({ error: 'INVALID_OTP' })
  })

  it('falls back to a generic error code when the response has none', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    expect(await verifyRegistrationCodeAction({ email: 'a@x.com', otp: '000000' })).toEqual({ error: 'GENERIC' })
  })

  it('maps 429 to tooManyRequests before inspecting the body', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 429, json: async () => ({}) })
    expect(await verifyRegistrationCodeAction({ email: 'a@x.com', otp: '000000' })).toEqual({ error: 'tooManyRequests' })
  })

  it('falls back to GENERIC for an unrecognized code value', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 400, json: async () => ({ code: 'SOME_UNKNOWN_CODE' }) })
    expect(await verifyRegistrationCodeAction({ email: 'a@x.com', otp: '000000' })).toEqual({ error: 'GENERIC' })
  })
})

describe('completeRegistrationAction', () => {
  const input = {
    clientId: 'sq_1',
    email: 'a@x.com',
    otp: '123456',
    firstName: 'Alice',
    lastName: 'Wonder',
    password: 'StrongPass123',
  }

  it('returns ok + redirectUrl on success', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true, redirectUrl: 'https://x/callback' }) })
    expect(await completeRegistrationAction(input)).toEqual({ ok: true, redirectUrl: 'https://x/callback' })
  })

  it('maps OTP_EXPIRED from the response body', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 400, json: async () => ({ code: 'OTP_EXPIRED' }) })
    expect(await completeRegistrationAction(input)).toEqual({ error: 'OTP_EXPIRED' })
  })

  it('maps 404 to appNotFound', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) })
    expect(await completeRegistrationAction(input)).toEqual({ error: 'appNotFound' })
  })
})
