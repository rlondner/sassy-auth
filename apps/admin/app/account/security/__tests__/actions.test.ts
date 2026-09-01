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

const TOTP_URI = 'otpauth://totp/Sassy:a@b.io?secret=JBSWY3DPEHPK3PXP&issuer=Sassy'
const BACKUP_CODES = ['aaaa-1111', 'bbbb-2222', 'cccc-3333']

let disable2fa: any
let enable2fa: any
let confirmEnable: any
let regenerateBackupCodes: any
let forwardNamedCookieWithMaxAge: any
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
  const mod = await import('../actions')
  disable2fa = mod.disable2fa
  enable2fa = mod.enable2fa
  confirmEnable = mod.confirmEnable
  regenerateBackupCodes = mod.regenerateBackupCodes
  forwardNamedCookieWithMaxAge = mod.forwardNamedCookieWithMaxAge
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

describe('enable2fa', () => {
  it('rejects a missing password without calling the auth server', async () => {
    const result = await enable2fa(formData({}))

    expect(result).toEqual({ error: 'invalidPassword' })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('returns the enrollment payload on success', async () => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(
      upstream(200, { totpURI: TOTP_URI, backupCodes: BACKUP_CODES }),
    )

    const result = await enable2fa(formData({ password: 'pw' }))

    expect(result).toEqual({ totpURI: TOTP_URI, backupCodes: BACKUP_CODES })
  })

  it('posts the password with the forwarded origin and session cookie', async () => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(
      upstream(200, { totpURI: TOTP_URI, backupCodes: BACKUP_CODES }),
    )

    await enable2fa(formData({ password: 'pw' }))

    const [url, init] = (global.fetch as jest.MockedFunction<typeof fetch>).mock
      .calls[0] as [string, RequestInit]
    expect(url).toBe('http://localhost:3000/api/auth/two-factor/enable')
    expect(JSON.parse(init.body as string)).toEqual({ password: 'pw' })
    const headers = init.headers as Record<string, string>
    expect(headers['Origin']).toBe('https://admin.example.com')
    expect(headers['Cookie']).toContain('better-auth.session_token=stale-token')
  })

  it.each([400, 401, 403])('maps upstream %d to invalidPassword', async (status) => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(
      upstream(status),
    )

    expect(await enable2fa(formData({ password: 'pw' }))).toEqual({
      error: 'invalidPassword',
    })
  })

  it('maps an unexpected upstream status to generic', async () => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(
      upstream(500),
    )

    expect(await enable2fa(formData({ password: 'pw' }))).toEqual({
      error: 'generic',
    })
  })

  it('returns serverUnavailable when the fetch rejects', async () => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockRejectedValue(
      new Error('ECONNREFUSED'),
    )

    expect(await enable2fa(formData({ password: 'pw' }))).toEqual({
      error: 'serverUnavailable',
    })
  })

  it('returns generic when the success body is not JSON', async () => {
    const res = {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => {
        throw new Error('not json')
      },
    } as unknown as Response
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(res)

    expect(await enable2fa(formData({ password: 'pw' }))).toEqual({
      error: 'generic',
    })
  })
})

describe('confirmEnable', () => {
  it('rejects a missing code without calling the auth server', async () => {
    const result = await confirmEnable(formData({}))

    expect(result).toEqual({ error: 'invalidCode' })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  // better-auth rotates the session when confirm flips twoFactorEnabled on.
  it('forwards the rotated session cookie on success', async () => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(
      upstream(200, { status: true }, ROTATED_SESSION),
    )

    const result = await confirmEnable(formData({ code: '123456' }))

    expect(result).toEqual({ ok: true })
    expect(jar.set).toHaveBeenCalledWith(
      'better-auth.session_token',
      'rotated-token',
      expect.objectContaining({ httpOnly: true, path: '/' }),
    )
  })

  it.each([400, 401])('maps upstream %d to invalidCode', async (status) => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(
      upstream(status),
    )

    expect(await confirmEnable(formData({ code: '123456' }))).toEqual({
      error: 'invalidCode',
    })
  })

  // bug-0275: better-auth only rotates the session on the device that
  // enabled 2FA. Any other still-valid session was never re-verified against
  // 2FA, yet deriveAuthMethods would later stamp its OAuth codes with
  // amr: ['otp','mfa'] based on the account's now-true twoFactorEnabled flag.
  // Revoking every other session on confirm closes that gap.
  it('revokes other sessions using the rotated token, not the stale one', async () => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(
      upstream(200, { status: true }, ROTATED_SESSION),
    )

    const result = await confirmEnable(formData({ code: '123456' }))

    expect(result).toEqual({ ok: true })
    expect(global.fetch).toHaveBeenCalledTimes(2)
    const [url, init] = (global.fetch as jest.MockedFunction<typeof fetch>).mock
      .calls[1] as [string, RequestInit]
    expect(url).toBe('http://localhost:3000/api/auth/revoke-other-sessions')
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers['Cookie']).toBe('better-auth.session_token=rotated-token')
  })

  it('does not call revoke-other-sessions when the response carries no rotated cookie', async () => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(
      upstream(200, { status: true }),
    )

    const result = await confirmEnable(formData({ code: '123456' }))

    expect(result).toEqual({ ok: true })
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('still reports success even if revoking other sessions fails', async () => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>)
      .mockResolvedValueOnce(upstream(200, { status: true }, ROTATED_SESSION))
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))

    const result = await confirmEnable(formData({ code: '123456' }))

    expect(result).toEqual({ ok: true })
  })

  it('maps an unexpected upstream status to generic', async () => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(
      upstream(500),
    )

    expect(await confirmEnable(formData({ code: '123456' }))).toEqual({
      error: 'generic',
    })
  })

  it('returns serverUnavailable when the fetch rejects', async () => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockRejectedValue(
      new Error('ECONNREFUSED'),
    )

    expect(await confirmEnable(formData({ code: '123456' }))).toEqual({
      error: 'serverUnavailable',
    })
  })
})

describe('regenerateBackupCodes', () => {
  it('rejects a missing password without calling the auth server', async () => {
    const result = await regenerateBackupCodes(formData({}))

    expect(result).toEqual({ error: 'invalidPassword' })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('returns the new codes on success', async () => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(
      upstream(200, { backupCodes: BACKUP_CODES }),
    )

    expect(await regenerateBackupCodes(formData({ password: 'pw' }))).toEqual({
      backupCodes: BACKUP_CODES,
    })
  })

  it.each([400, 401, 403])('maps upstream %d to invalidPassword', async (status) => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(
      upstream(status),
    )

    expect(await regenerateBackupCodes(formData({ password: 'pw' }))).toEqual({
      error: 'invalidPassword',
    })
  })

  it('returns serverUnavailable when the fetch rejects', async () => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockRejectedValue(
      new Error('ECONNREFUSED'),
    )

    expect(await regenerateBackupCodes(formData({ password: 'pw' }))).toEqual({
      error: 'serverUnavailable',
    })
  })

  it('returns generic when the success body is not JSON', async () => {
    const res = {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => {
        throw new Error('not json')
      },
    } as unknown as Response
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(res)

    expect(await regenerateBackupCodes(formData({ password: 'pw' }))).toEqual({
      error: 'generic',
    })
  })
})

// The TOTP URI is a shared secret and the backup codes are single-use
// credentials. They are returned to the caller to be rendered once, and must
// not reach anything that persists them.
describe('enrollment secrets are not logged', () => {
  let spies: jest.SpyInstance[]

  beforeEach(() => {
    spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      jest.spyOn(console, m).mockImplementation(() => {}),
    )
  })

  afterEach(() => {
    spies.forEach((s) => s.mockRestore())
  })

  function loggedText() {
    return spies
      .flatMap((s) => s.mock.calls)
      .flat()
      .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
      .join(' ')
  }

  it('enable2fa does not write the totpURI or backup codes to the console', async () => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(
      upstream(200, { totpURI: TOTP_URI, backupCodes: BACKUP_CODES }),
    )

    await enable2fa(formData({ password: 'pw' }))

    const text = loggedText()
    expect(text).not.toContain('JBSWY3DPEHPK3PXP')
    BACKUP_CODES.forEach((c) => expect(text).not.toContain(c))
  })

  it('regenerateBackupCodes does not write the codes to the console', async () => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(
      upstream(200, { backupCodes: BACKUP_CODES }),
    )

    await regenerateBackupCodes(formData({ password: 'pw' }))

    const text = loggedText()
    BACKUP_CODES.forEach((c) => expect(text).not.toContain(c))
  })
})

// Exercised indirectly by the login actions' trust-device path, where it is
// mocked; these cover the real implementation.
describe('forwardNamedCookieWithMaxAge', () => {
  it('overrides the upstream Max-Age with the supplied value', async () => {
    const res = upstream(
      200,
      {},
      'better-auth.trust_device=abc; Path=/; HttpOnly; Max-Age=60',
    )

    const ok = await forwardNamedCookieWithMaxAge(
      res,
      'better-auth.trust_device',
      1234,
    )

    expect(ok).toBe(true)
    expect(jar.set).toHaveBeenCalledWith(
      'better-auth.trust_device',
      'abc',
      expect.objectContaining({ maxAge: 1234, httpOnly: true }),
    )
  })

  it('returns false when the named cookie is absent from the response', async () => {
    const res = upstream(200, {}, 'some-other=1; Path=/')

    expect(
      await forwardNamedCookieWithMaxAge(res, 'better-auth.trust_device', 10),
    ).toBe(false)
    expect(jar.set).not.toHaveBeenCalled()
  })

  it('returns false when the response has no Set-Cookie header', async () => {
    expect(
      await forwardNamedCookieWithMaxAge(upstream(200), 'better-auth.trust_device', 10),
    ).toBe(false)
  })
})

// D-01: every credential-bearing admin action reports upstream throttling as
// its own result. /two-factor/* is a sensitive prefix for the auth rate
// limiter, so a 429 is reachable on all four of these.
describe('upstream throttling is reported as tooManyRequests', () => {
  it.each([
    ['enable2fa', () => enable2fa, { password: 'pw' }],
    ['disable2fa', () => disable2fa, { password: 'pw' }],
    ['regenerateBackupCodes', () => regenerateBackupCodes, { password: 'pw' }],
    ['confirmEnable', () => confirmEnable, { code: '123456' }],
  ])('%s maps a 429 to tooManyRequests', async (_name, getFn, fields) => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(
      upstream(429),
    )

    expect(await getFn()(formData(fields as Record<string, string>))).toEqual({
      error: 'tooManyRequests',
    })
  })

  // The result is rendered by SecurityClient as t(`errors.${result.error}`),
  // so a result with no matching key would surface as a broken lookup rather
  // than a message.
  it('has a message for every error result these actions can return', () => {
    const en = require('@/messages/en.json')
    const fr = require('@/messages/fr.json')
    const returned = [
      'invalidPassword',
      'invalidCode',
      'generic',
      'serverUnavailable',
      'tooManyRequests',
    ]
    returned.forEach((key) => {
      expect(en.security.errors).toHaveProperty(key)
      expect(fr.security.errors).toHaveProperty(key)
    })
  })
})
