/**
 * Covers signIn in apps/admin/app/login/actions.ts: credential validation,
 * upstream status mapping, transport failure, the twoFactorRedirect branch,
 * and which cookies are forwarded on each path.
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
import { getForwardedOrigin } from '@/lib/auth-origin'

const mockCookies = cookies as jest.MockedFunction<any>
const mockGetForwardedOrigin = getForwardedOrigin as jest.MockedFunction<any>

// Re-resolved in beforeEach: jest.resetModules() hands the dynamically
// imported module under test a fresh copy of the mock registry, so a
// reference captured at file scope would point at a stale jest.fn().
let mockForwardNamedCookie: jest.MockedFunction<any>

const SESSION_COOKIE =
  'better-auth.session_token=abc123; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800'

/** Minimal cookie jar standing in for Next's cookie store. */
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
    toString: () =>
      [...store.entries()].map(([k, v]) => `${k}=${v}`).join('; '),
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

let signIn: any
let jar: ReturnType<typeof cookieJar>

beforeEach(async () => {
  jest.clearAllMocks()
  jest.resetModules()
  jar = cookieJar()
  mockCookies.mockResolvedValue(jar)
  mockGetForwardedOrigin.mockResolvedValue('https://admin.example.com')
  global.fetch = jest.fn() as jest.MockedFunction<typeof fetch>
  const securityActions = await import('../../account/security/actions')
  mockForwardNamedCookie = securityActions.forwardNamedCookie as jest.MockedFunction<any>
  const mod = await import('../actions')
  signIn = mod.signIn
})

/** signIn ends in redirect(), which our mock throws; unwrap the target. */
async function callExpectingRedirect(fd: FormData): Promise<string> {
  try {
    await signIn(fd)
  } catch (err) {
    const digest = (err as { digest?: string }).digest
    if (typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT')) {
      return digest.split(';')[2]
    }
    throw err
  }
  throw new Error('expected signIn to redirect, but it returned normally')
}

describe('signIn credential validation', () => {
  it('returns an error without calling the auth server when the email is missing', async () => {
    const result = await signIn(formData({ password: 'pw' }))

    expect(result).toEqual({ error: 'Email and password are required.' })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('returns an error without calling the auth server when the password is missing', async () => {
    const result = await signIn(formData({ email: 'a@b.io' }))

    expect(result).toEqual({ error: 'Email and password are required.' })
    expect(global.fetch).not.toHaveBeenCalled()
  })
})

describe('signIn upstream status mapping', () => {
  it.each([
    [401, 'invalidCredentials'],
    [403, 'inactive'],
    [429, 'tooManyRequests'],
    [500, 'invalidCredentials'],
  ])('maps upstream %d to %s', async (status, expected) => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(
      upstream(status),
    )

    const result = await signIn(formData({ email: 'a@b.io', password: 'pw' }))

    expect(result).toEqual({ error: expected })
  })

  it('returns serverUnavailable when the fetch itself rejects', async () => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockRejectedValue(
      new Error('ECONNREFUSED'),
    )

    const result = await signIn(formData({ email: 'a@b.io', password: 'pw' }))

    expect(result).toEqual({ error: 'serverUnavailable' })
  })
})

describe('signIn two-factor challenge', () => {
  it('forwards the temp 2FA cookie and does not set a session cookie', async () => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(
      upstream(200, { twoFactorRedirect: true }),
    )

    const result = await signIn(formData({ email: 'a@b.io', password: 'pw' }))

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

describe('signIn trust-device cookie forwarding', () => {
  it('forwards only the trust-device cookie, never the caller session token', async () => {
    jar = cookieJar({
      'better-auth.trust_device': 'trusted-value',
      'better-auth.session_token': 'pre-existing-session',
    })
    mockCookies.mockResolvedValue(jar)
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(
      upstream(401),
    )

    await signIn(formData({ email: 'a@b.io', password: 'pw' }))

    const init = (global.fetch as jest.MockedFunction<typeof fetch>).mock
      .calls[0][1] as RequestInit
    const cookieHeader = (init.headers as Record<string, string>)['Cookie']
    expect(cookieHeader).toBe('better-auth.trust_device=trusted-value')
    expect(cookieHeader).not.toContain('pre-existing-session')
  })

  it('sends no Cookie header when the browser holds no trust-device cookie', async () => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(
      upstream(401),
    )

    await signIn(formData({ email: 'a@b.io', password: 'pw' }))

    const init = (global.fetch as jest.MockedFunction<typeof fetch>).mock
      .calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>)['Cookie']).toBeUndefined()
  })
})

describe('signIn success', () => {
  it('sets the session cookie and redirects to /users by default', async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>
    fetchMock
      .mockResolvedValueOnce(upstream(200, {}, SESSION_COOKIE))
      // get-session and two-factor-status, both after the session is set
      .mockResolvedValueOnce(upstream(200, { user: { twoFactorEnabled: true } }))
      .mockResolvedValueOnce(upstream(200, { twoFactorPromptedAt: null }))

    const target = await callExpectingRedirect(
      formData({ email: 'a@b.io', password: 'pw' }),
    )

    expect(target).toBe('/users')
    expect(jar.set).toHaveBeenCalledWith(
      'better-auth.session_token',
      'abc123',
      expect.objectContaining({ httpOnly: true, path: '/', sameSite: 'lax' }),
    )
  })

  it('redirects to a safe next path when one is supplied', async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>
    fetchMock
      .mockResolvedValueOnce(upstream(200, {}, SESSION_COOKIE))
      .mockResolvedValueOnce(upstream(200, { user: { twoFactorEnabled: true } }))
      .mockResolvedValueOnce(upstream(200, { twoFactorPromptedAt: null }))

    const target = await callExpectingRedirect(
      formData({ email: 'a@b.io', password: 'pw', next: '/orgs' }),
    )

    expect(target).toBe('/orgs')
  })

  it('ignores an off-origin next value and falls back to /users', async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>
    fetchMock
      .mockResolvedValueOnce(upstream(200, {}, SESSION_COOKIE))
      .mockResolvedValueOnce(upstream(200, { user: { twoFactorEnabled: true } }))
      .mockResolvedValueOnce(upstream(200, { twoFactorPromptedAt: null }))

    const target = await callExpectingRedirect(
      formData({
        email: 'a@b.io',
        password: 'pw',
        next: 'https://evil.example.com/steal',
      }),
    )

    expect(target).toBe('/users')
  })

  // The auth server accepted the credentials and returned 200; we simply could
  // not extract a session from the response. That is a server-side fault, not a
  // bad password, and forwardSessionCookie already reports it to Sentry at
  // error level. Telling the user their credentials were wrong would make them
  // retype a password that was just accepted, burning rate-limit budget.
  it('returns serverUnavailable when the 200 response carries no Set-Cookie', async () => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(
      upstream(200, {}),
    )

    const result = await signIn(formData({ email: 'a@b.io', password: 'pw' }))

    expect(result).toEqual({ error: 'serverUnavailable' })
  })

  it('returns serverUnavailable when the Set-Cookie cannot be parsed', async () => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(
      upstream(200, {}, 'some-other-cookie=value; Path=/'),
    )

    const result = await signIn(formData({ email: 'a@b.io', password: 'pw' }))

    expect(result).toEqual({ error: 'serverUnavailable' })
  })
})

describe('signIn optional two-factor interstitial', () => {
  it('redirects to the prompt when the user is unenrolled and never prompted', async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>
    fetchMock
      .mockResolvedValueOnce(upstream(200, {}, SESSION_COOKIE))
      .mockResolvedValueOnce(
        upstream(200, { user: { twoFactorEnabled: false } }),
      )
      .mockResolvedValueOnce(upstream(200, { twoFactorPromptedAt: null }))

    const target = await callExpectingRedirect(
      formData({ email: 'a@b.io', password: 'pw' }),
    )

    expect(target).toBe('/login/two-factor-prompt')
  })

  it('carries the safe next through the prompt as an encoded query param', async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>
    fetchMock
      .mockResolvedValueOnce(upstream(200, {}, SESSION_COOKIE))
      .mockResolvedValueOnce(
        upstream(200, { user: { twoFactorEnabled: false } }),
      )
      .mockResolvedValueOnce(upstream(200, { twoFactorPromptedAt: null }))

    const target = await callExpectingRedirect(
      formData({ email: 'a@b.io', password: 'pw', next: '/orgs' }),
    )

    expect(target).toBe('/login/two-factor-prompt?next=%2Forgs')
  })

  it('does not prompt a user who already has 2FA enabled', async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>
    fetchMock
      .mockResolvedValueOnce(upstream(200, {}, SESSION_COOKIE))
      .mockResolvedValueOnce(upstream(200, { user: { twoFactorEnabled: true } }))
      .mockResolvedValueOnce(upstream(200, { twoFactorPromptedAt: null }))

    const target = await callExpectingRedirect(
      formData({ email: 'a@b.io', password: 'pw' }),
    )

    expect(target).toBe('/users')
  })

  // The interstitial is a nudge, not a gate. If we could not read the user's
  // real 2FA state we must not guess: guessing "unenrolled, never prompted"
  // is what turned a status-lookup outage into a setup prompt for every
  // login, enrolled users included.
  it('fails open and does not prompt when the status lookups reject', async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>
    fetchMock
      .mockResolvedValueOnce(upstream(200, {}, SESSION_COOKIE))
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockRejectedValueOnce(new Error('ECONNRESET'))

    const target = await callExpectingRedirect(
      formData({ email: 'a@b.io', password: 'pw' }),
    )

    expect(target).toBe('/users')
  })

  it('fails open and does not prompt when get-session returns non-ok', async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>
    fetchMock
      .mockResolvedValueOnce(upstream(200, {}, SESSION_COOKIE))
      .mockResolvedValueOnce(upstream(503))
      .mockResolvedValueOnce(upstream(503))

    const target = await callExpectingRedirect(
      formData({ email: 'a@b.io', password: 'pw' }),
    )

    expect(target).toBe('/users')
  })

  it('still fails open when only the two-factor-status lookup is unavailable', async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>
    fetchMock
      .mockResolvedValueOnce(upstream(200, {}, SESSION_COOKIE))
      .mockResolvedValueOnce(
        upstream(200, { user: { twoFactorEnabled: false } }),
      )
      .mockResolvedValueOnce(upstream(503))

    const target = await callExpectingRedirect(
      formData({ email: 'a@b.io', password: 'pw' }),
    )

    expect(target).toBe('/users')
  })
})
