/**
 * Covers requestOtp and verifyOtp in apps/admin/app/login/actions.ts.
 *
 * The load-bearing property for requestOtp is that it reveals nothing about
 * whether an account exists: every upstream status must produce the same
 * neutral result, and only a transport failure may surface an error.
 */
import { jest } from '@jest/globals'

jest.mock('next/headers', () => ({ cookies: jest.fn() }))
jest.mock('next/navigation', () => ({
  redirect: jest.fn((url: string) => {
    const err = new Error(`NEXT_REDIRECT;${url}`) as Error & { digest: string }
    err.digest = `NEXT_REDIRECT;push;${url};307;`
    throw err
  }),
}))
jest.mock('@sentry/nextjs', () => ({
  addBreadcrumb: jest.fn(),
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}))
jest.mock('@/lib/auth-origin', () => ({ getForwardedOrigin: jest.fn() }))
jest.mock('../../account/security/actions', () => ({
  forwardNamedCookie: jest.fn(),
  forwardNamedCookieWithMaxAge: jest.fn(),
}))

import { cookies } from 'next/headers'

const mockCookies = cookies as jest.MockedFunction<any>

// Re-resolved in beforeEach: jest.resetModules() hands the dynamically imported
// module under test a fresh copy of the mock registry for relative-path mocks,
// so references captured at file scope point at stale jest.fn()s.
let mockForwardNamedCookie: jest.MockedFunction<any>

const SESSION_COOKIE =
  'better-auth.session_token=abc123; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800'

function cookieJar(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  return {
    set: jest.fn((name: string, value: string) => {
      store.set(name, value)
    }),
    get: jest.fn((name: string) =>
      store.has(name) ? { name, value: store.get(name) } : undefined,
    ),
    delete: jest.fn((name: string) => store.delete(name)),
    toString: () => [...store.entries()].map(([k, v]) => `${k}=${v}`).join('; '),
  }
}

function upstream(status: number, body: unknown = {}, setCookie?: string) {
  const headers = new Map<string, string>()
  if (setCookie) headers.set('set-cookie', setCookie)
  const res = {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (n: string) => headers.get(n.toLowerCase()) ?? null },
    json: async () => body,
  }
  return { ...res, clone: () => res } as unknown as Response
}

function formData(fields: Record<string, string>) {
  return { get: (k: string) => fields[k] ?? null } as unknown as FormData
}

let requestOtp: any
let verifyOtp: any
let jar: ReturnType<typeof cookieJar>

beforeEach(async () => {
  jest.clearAllMocks()
  jest.resetModules()
  jar = cookieJar()
  mockCookies.mockResolvedValue(jar)
  global.fetch = jest.fn() as jest.MockedFunction<typeof fetch>
  const authOrigin = await import('@/lib/auth-origin')
  ;(authOrigin.getForwardedOrigin as jest.MockedFunction<any>).mockResolvedValue(
    'https://admin.example.com',
  )
  const securityActions = await import('../../account/security/actions')
  mockForwardNamedCookie = securityActions.forwardNamedCookie as jest.MockedFunction<any>
  const mod = await import('../actions')
  requestOtp = mod.requestOtp
  verifyOtp = mod.verifyOtp
})

async function callExpectingRedirect(fn: any, fd: FormData): Promise<string> {
  try {
    await fn(fd)
  } catch (err) {
    const digest = (err as { digest?: string }).digest
    if (typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT')) {
      return digest.split(';')[2]
    }
    throw err
  }
  throw new Error('expected a redirect, but the action returned normally')
}

describe('requestOtp', () => {
  it('rejects a missing email without calling the auth server', async () => {
    const result = await requestOtp(formData({}))

    expect(result).toEqual({ error: 'invalidCredentials' })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  // The whole point of this action: a caller must not be able to tell an
  // existing account from an unknown or deactivated one.
  it.each([200, 400, 401, 403, 404, 429, 500])(
    'returns the same neutral result regardless of upstream %d',
    async (status) => {
      ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(
        upstream(status),
      )

      const result = await requestOtp(formData({ email: 'a@b.io' }))

      expect(result).toEqual({ sent: true })
    },
  )

  it('surfaces only a transport failure, the one case that is not about the account', async () => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockRejectedValue(
      new Error('ECONNREFUSED'),
    )

    const result = await requestOtp(formData({ email: 'a@b.io' }))

    expect(result).toEqual({ error: 'serverUnavailable' })
  })

  it('posts the sign-in OTP type to the auth server with the forwarded origin', async () => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(
      upstream(200),
    )

    await requestOtp(formData({ email: 'a@b.io' }))

    const [url, init] = (global.fetch as jest.MockedFunction<typeof fetch>).mock
      .calls[0] as [string, RequestInit]
    expect(url).toBe(
      'http://localhost:3000/api/auth/email-otp/send-verification-otp',
    )
    expect(JSON.parse(init.body as string)).toEqual({
      email: 'a@b.io',
      type: 'sign-in',
    })
    expect((init.headers as Record<string, string>)['Origin']).toBe(
      'https://admin.example.com',
    )
  })
})

describe('verifyOtp validation', () => {
  it('rejects a missing email without calling the auth server', async () => {
    const result = await verifyOtp(formData({ otp: '123456' }))

    expect(result).toEqual({ error: 'invalidCode' })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('rejects a missing code without calling the auth server', async () => {
    const result = await verifyOtp(formData({ email: 'a@b.io' }))

    expect(result).toEqual({ error: 'invalidCode' })
    expect(global.fetch).not.toHaveBeenCalled()
  })
})

describe('verifyOtp upstream status mapping', () => {
  it.each([
    [403, 'inactive'],
    [429, 'tooManyRequests'],
    [401, 'invalidCode'],
    [400, 'invalidCode'],
    [500, 'invalidCode'],
  ])('maps upstream %d to %s', async (status, expected) => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(
      upstream(status),
    )

    const result = await verifyOtp(formData({ email: 'a@b.io', otp: '123456' }))

    expect(result).toEqual({ error: expected })
  })

  it('returns serverUnavailable when the fetch itself rejects', async () => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockRejectedValue(
      new Error('ECONNREFUSED'),
    )

    const result = await verifyOtp(formData({ email: 'a@b.io', otp: '123456' }))

    expect(result).toEqual({ error: 'serverUnavailable' })
  })
})

describe('verifyOtp two-factor challenge', () => {
  // Defence in depth: redeeming a pre-enrolment OTP must not hand a 2FA-enrolled
  // user a full session.
  it('forwards the temp 2FA cookie and does not set a session cookie', async () => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(
      upstream(200, { twoFactorRedirect: true }),
    )

    const result = await verifyOtp(formData({ email: 'a@b.io', otp: '123456' }))

    expect(result).toEqual({ twoFactor: true })
    expect(mockForwardNamedCookie).toHaveBeenCalledWith(
      expect.anything(),
      'better-auth.two_factor',
    )
    expect(jar.set).not.toHaveBeenCalledWith(
      'better-auth.session_token',
      expect.anything(),
      expect.anything(),
    )
  })
})

describe('verifyOtp success', () => {
  it('sets the session cookie and redirects to /users by default', async () => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(
      upstream(200, {}, SESSION_COOKIE),
    )

    const target = await callExpectingRedirect(
      verifyOtp,
      formData({ email: 'a@b.io', otp: '123456' }),
    )

    expect(target).toBe('/users')
    expect(jar.set).toHaveBeenCalledWith(
      'better-auth.session_token',
      'abc123',
      expect.objectContaining({ httpOnly: true, path: '/' }),
    )
  })

  it('redirects to a safe next path when one is supplied', async () => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(
      upstream(200, {}, SESSION_COOKIE),
    )

    const target = await callExpectingRedirect(
      verifyOtp,
      formData({ email: 'a@b.io', otp: '123456', next: '/orgs' }),
    )

    expect(target).toBe('/orgs')
  })

  it('ignores an off-origin next value and falls back to /users', async () => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(
      upstream(200, {}, SESSION_COOKIE),
    )

    const target = await callExpectingRedirect(
      verifyOtp,
      formData({
        email: 'a@b.io',
        otp: '123456',
        next: 'https://evil.example.com/steal',
      }),
    )

    expect(target).toBe('/users')
  })

  it('returns invalidCode when the 200 response carries no Set-Cookie', async () => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(
      upstream(200, {}),
    )

    const result = await verifyOtp(formData({ email: 'a@b.io', otp: '123456' }))

    expect(result).toEqual({ error: 'invalidCode' })
  })
})
