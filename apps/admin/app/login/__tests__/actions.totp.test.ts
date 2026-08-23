/**
 * Covers verifyTotp, verifyBackupCode and the applyPerAppTrustCookie helper
 * they share, in apps/admin/app/login/actions.ts.
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

// Re-resolved in beforeEach; see the note in actions.otp.test.ts.
let mockForwardNamedCookie: jest.MockedFunction<any>
let mockForwardNamedCookieWithMaxAge: jest.MockedFunction<any>

const SESSION_COOKIE =
  'better-auth.session_token=abc123; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800'

const DAY_SECONDS = 24 * 60 * 60

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

let verifyTotp: any
let verifyBackupCode: any
let jar: ReturnType<typeof cookieJar>

beforeEach(async () => {
  jest.clearAllMocks()
  jest.resetModules()
  jar = cookieJar({ 'better-auth.two_factor': 'temp-2fa' })
  mockCookies.mockResolvedValue(jar)
  global.fetch = jest.fn() as jest.MockedFunction<typeof fetch>
  const authOrigin = await import('@/lib/auth-origin')
  ;(authOrigin.getForwardedOrigin as jest.MockedFunction<any>).mockResolvedValue(
    'https://admin.example.com',
  )
  const securityActions = await import('../../account/security/actions')
  mockForwardNamedCookie = securityActions.forwardNamedCookie as jest.MockedFunction<any>
  mockForwardNamedCookieWithMaxAge =
    securityActions.forwardNamedCookieWithMaxAge as jest.MockedFunction<any>
  const mod = await import('../actions')
  verifyTotp = mod.verifyTotp
  verifyBackupCode = mod.verifyBackupCode
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

describe.each([
  ['verifyTotp', () => verifyTotp, 'code'],
  ['verifyBackupCode', () => verifyBackupCode, 'code'],
])('%s shared contract', (_name, getFn, codeField) => {
  it('rejects a missing code without calling the auth server', async () => {
    const result = await getFn()(formData({}))

    expect(result).toEqual({ error: 'invalidCode' })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('returns serverUnavailable when the fetch itself rejects', async () => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockRejectedValue(
      new Error('ECONNREFUSED'),
    )

    const result = await getFn()(formData({ [codeField]: '123456' }))

    expect(result).toEqual({ error: 'serverUnavailable' })
  })

  it('returns invalidCode on a 401', async () => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(
      upstream(401),
    )

    const result = await getFn()(formData({ [codeField]: '123456' }))

    expect(result).toEqual({ error: 'invalidCode' })
  })

  it('forwards the full cookie jar so the temp 2FA cookie reaches the auth server', async () => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(
      upstream(401),
    )

    await getFn()(formData({ [codeField]: '123456' }))

    const init = (global.fetch as jest.MockedFunction<typeof fetch>).mock
      .calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>)['Cookie']).toContain(
      'better-auth.two_factor=temp-2fa',
    )
  })

  it('sets the session cookie, clears the temp 2FA cookie and redirects on success', async () => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(
      upstream(200, {}, SESSION_COOKIE),
    )

    const target = await callExpectingRedirect(
      getFn(),
      formData({ [codeField]: '123456' }),
    )

    expect(target).toBe('/users')
    expect(jar.set).toHaveBeenCalledWith(
      'better-auth.session_token',
      'abc123',
      expect.objectContaining({ httpOnly: true, path: '/' }),
    )
    expect(mockForwardNamedCookie).toHaveBeenCalledWith(
      expect.anything(),
      'better-auth.two_factor',
    )
  })

  it('ignores an off-origin next value and falls back to /users', async () => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(
      upstream(200, {}, SESSION_COOKIE),
    )

    const target = await callExpectingRedirect(
      getFn(),
      formData({
        [codeField]: '123456',
        next: 'https://evil.example.com/steal',
      }),
    )

    expect(target).toBe('/users')
  })

  it('does not touch the trust-device cookie when trustDevice is absent', async () => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(
      upstream(200, {}, SESSION_COOKIE),
    )

    await callExpectingRedirect(getFn(), formData({ [codeField]: '123456' }))

    expect(mockForwardNamedCookieWithMaxAge).not.toHaveBeenCalled()
  })
})

describe('verifyTotp rate limiting', () => {
  it('maps a 429 to tooManyRequests rather than a bad code', async () => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(
      upstream(429),
    )

    const result = await verifyTotp(formData({ code: '123456' }))

    expect(result).toEqual({ error: 'tooManyRequests' })
  })
})

describe('applyPerAppTrustCookie via trustDevice', () => {
  it('uses the system default interval when next carries no client_id', async () => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(
      upstream(200, {}, SESSION_COOKIE),
    )

    await callExpectingRedirect(
      verifyTotp,
      formData({ code: '123456', trustDevice: 'true', next: '/users' }),
    )

    expect(mockForwardNamedCookieWithMaxAge).toHaveBeenCalledWith(
      expect.anything(),
      'better-auth.trust_device',
      14 * DAY_SECONDS,
    )
  })

  it('honours a per-app override returned by the trust-days endpoint', async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>
    fetchMock
      .mockResolvedValueOnce(upstream(200, {}, SESSION_COOKIE))
      .mockResolvedValueOnce(upstream(200, { effectiveTrustDays: 30 }))

    await callExpectingRedirect(
      verifyTotp,
      formData({
        code: '123456',
        trustDevice: 'true',
        next: '/authorize?client_id=app_42',
      }),
    )

    expect(mockForwardNamedCookieWithMaxAge).toHaveBeenCalledWith(
      expect.anything(),
      'better-auth.trust_device',
      30 * DAY_SECONDS,
    )
  })

  it('falls back to the system default when the trust-days endpoint is unavailable', async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>
    fetchMock
      .mockResolvedValueOnce(upstream(200, {}, SESSION_COOKIE))
      .mockRejectedValueOnce(new Error('ECONNRESET'))

    await callExpectingRedirect(
      verifyTotp,
      formData({
        code: '123456',
        trustDevice: 'true',
        next: '/authorize?client_id=app_42',
      }),
    )

    expect(mockForwardNamedCookieWithMaxAge).toHaveBeenCalledWith(
      expect.anything(),
      'better-auth.trust_device',
      14 * DAY_SECONDS,
    )
  })

  it('ignores a non-positive effectiveTrustDays from a skewed deployment', async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>
    fetchMock
      .mockResolvedValueOnce(upstream(200, {}, SESSION_COOKIE))
      .mockResolvedValueOnce(upstream(200, { effectiveTrustDays: 0 }))

    await callExpectingRedirect(
      verifyTotp,
      formData({
        code: '123456',
        trustDevice: 'true',
        next: '/authorize?client_id=app_42',
      }),
    )

    expect(mockForwardNamedCookieWithMaxAge).toHaveBeenCalledWith(
      expect.anything(),
      'better-auth.trust_device',
      14 * DAY_SECONDS,
    )
  })

  // applyPerAppTrustCookie is handed the RAW next (actions.ts:419, :467), not
  // the validateNextUrl-checked value used for the redirect. An off-origin next
  // is therefore still parsed for its client_id and drives a request to the
  // auth server, even though the same value is rejected for redirection.
  it('reads client_id out of an off-origin next that the redirect itself rejects', async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>
    fetchMock
      .mockResolvedValueOnce(upstream(200, {}, SESSION_COOKIE))
      .mockResolvedValueOnce(upstream(200, { effectiveTrustDays: 30 }))

    const target = await callExpectingRedirect(
      verifyTotp,
      formData({
        code: '123456',
        trustDevice: 'true',
        next: 'https://evil.example.com/x?client_id=attacker_app',
      }),
    )

    // The redirect correctly refuses the off-origin value...
    expect(target).toBe('/users')
    // ...but the trust-days lookup was still driven by its client_id.
    const trustCall = fetchMock.mock.calls[1][0] as string
    expect(trustCall).toContain('client_id=attacker_app')
    expect(mockForwardNamedCookieWithMaxAge).toHaveBeenCalledWith(
      expect.anything(),
      'better-auth.trust_device',
      30 * DAY_SECONDS,
    )
  })
})
