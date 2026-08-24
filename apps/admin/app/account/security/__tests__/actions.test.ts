/**
 * Covers the account security 2FA server actions.
 *
 * forwardNamedCookie lives in the module under test rather than being mocked,
 * so these exercise the real Set-Cookie parsing rather than a stand-in.
 */
jest.mock('next/headers', () => ({ cookies: jest.fn() }))
jest.mock('@/lib/auth-origin', () => ({ getForwardedOrigin: jest.fn() }))

import { cookies } from 'next/headers'

const mockCookies = cookies as jest.MockedFunction<any>

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
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (n: string) => headers.get(n.toLowerCase()) ?? null },
    json: async () => body,
  } as unknown as Response
}

function formData(fields: Record<string, string>) {
  return { get: (k: string) => fields[k] ?? null } as unknown as FormData
}

// What better-auth 1.6.11's /two-factor/disable actually returns: a rotated
// session (createSession + setSessionCookie, with the caller's old token
// deleted server-side) and, when the user had a trusted device, an expiring
// trust-device cookie. Two clauses on one header.
const ROTATED_SESSION =
  'better-auth.session_token=rotated-token; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800'
const EXPIRING_TRUST_DEVICE =
  'better-auth.trust_device=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'

let disable2fa: any
let jar: ReturnType<typeof cookieJar>

beforeEach(async () => {
  jest.clearAllMocks()
  jest.resetModules()
  jar = cookieJar({ 'better-auth.session_token': 'stale-token' })
  mockCookies.mockResolvedValue(jar)
  global.fetch = jest.fn() as jest.MockedFunction<typeof fetch>
  const authOrigin = await import('@/lib/auth-origin')
  ;(authOrigin.getForwardedOrigin as jest.MockedFunction<any>).mockResolvedValue(
    'https://admin.example.com',
  )
  disable2fa = (await import('../actions')).disable2fa
})

describe('disable2fa validation and error mapping', () => {
  it('rejects a missing password without calling the auth server', async () => {
    const result = await disable2fa(formData({}))

    expect(result).toEqual({ error: 'invalidPassword' })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it.each([400, 401, 403])('maps upstream %d to invalidPassword', async (status) => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(
      upstream(status),
    )

    const result = await disable2fa(formData({ password: 'pw' }))

    expect(result).toEqual({ error: 'invalidPassword' })
  })

  it('returns serverUnavailable when the fetch rejects', async () => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockRejectedValue(
      new Error('ECONNREFUSED'),
    )

    const result = await disable2fa(formData({ password: 'pw' }))

    expect(result).toEqual({ error: 'serverUnavailable' })
  })
})

describe('disable2fa session rotation', () => {
  // better-auth deletes the caller's old session as part of disabling. Without
  // forwarding the replacement the browser keeps a token that no longer
  // exists, and the user is silently bounced to /login on the next navigation
  // while the UI reports success.
  it('forwards the rotated session cookie so the user stays signed in', async () => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(
      upstream(200, { status: true }, ROTATED_SESSION),
    )

    const result = await disable2fa(formData({ password: 'pw' }))

    expect(result).toEqual({ ok: true })
    expect(jar.set).toHaveBeenCalledWith(
      'better-auth.session_token',
      'rotated-token',
      expect.objectContaining({ httpOnly: true, path: '/' }),
    )
  })

  it('clears the trust-device cookie the same response expires', async () => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(
      upstream(
        200,
        { status: true },
        `${ROTATED_SESSION}, ${EXPIRING_TRUST_DEVICE}`,
      ),
    )

    await disable2fa(formData({ password: 'pw' }))

    // Both clauses must be picked out of the one header.
    expect(jar.set).toHaveBeenCalledWith(
      'better-auth.session_token',
      'rotated-token',
      expect.objectContaining({ path: '/' }),
    )
    expect(jar.set).toHaveBeenCalledWith(
      'better-auth.trust_device',
      '',
      expect.objectContaining({ maxAge: 0 }),
    )
  })

  it('still succeeds when the response carries no Set-Cookie at all', async () => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(
      upstream(200, { status: true }),
    )

    const result = await disable2fa(formData({ password: 'pw' }))

    expect(result).toEqual({ ok: true })
  })
})
