/**
 * Covers resetPasswordSubmitAction and requestPasswordResetAction.
 *
 * requestPasswordResetAction is deliberately total: it must reveal nothing
 * about whether an address exists, so every upstream outcome — including a
 * transport failure — resolves to the same neutral result.
 */
jest.mock('@sentry/nextjs', () => ({
  addBreadcrumb: jest.fn(),
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}))
jest.mock('@/lib/auth-origin', () => ({ getForwardedOrigin: jest.fn() }))

function upstream(status: number, body: unknown = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

function formData(fields: Record<string, string>) {
  return { get: (k: string) => fields[k] ?? null } as unknown as FormData
}

let resetPasswordSubmitAction: any
let requestPasswordResetAction: any
let captureException: jest.MockedFunction<any>

beforeEach(async () => {
  jest.clearAllMocks()
  jest.resetModules()
  global.fetch = jest.fn() as jest.MockedFunction<typeof fetch>
  const authOrigin = await import('@/lib/auth-origin')
  ;(authOrigin.getForwardedOrigin as jest.MockedFunction<any>).mockResolvedValue(
    'https://admin.example.com',
  )
  const sentry = await import('@sentry/nextjs')
  captureException = sentry.captureException as jest.MockedFunction<any>
  resetPasswordSubmitAction = (await import('../actions')).resetPasswordSubmitAction
  requestPasswordResetAction = (
    await import('../../forgot-password/actions')
  ).requestPasswordResetAction
})

describe('resetPasswordSubmitAction', () => {
  it('returns ok on a 200', async () => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(
      upstream(200),
    )

    const result = await resetPasswordSubmitAction('tok', 'Str0ngPassw0rd!')

    expect(result).toEqual({ ok: true })
  })

  it('posts the token and new password with the forwarded origin', async () => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(
      upstream(200),
    )

    await resetPasswordSubmitAction('tok', 'Str0ngPassw0rd!')

    const [url, init] = (global.fetch as jest.MockedFunction<typeof fetch>).mock
      .calls[0] as [string, RequestInit]
    expect(url).toBe('http://localhost:3000/api/auth/reset-password')
    expect(JSON.parse(init.body as string)).toEqual({
      token: 'tok',
      newPassword: 'Str0ngPassw0rd!',
    })
    expect((init.headers as Record<string, string>)['Origin']).toBe(
      'https://admin.example.com',
    )
  })

  it('returns invalidToken on a 400', async () => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(
      upstream(400),
    )

    const result = await resetPasswordSubmitAction('tok', 'Str0ngPassw0rd!')

    expect(result).toEqual({ error: 'invalidToken' })
  })

  it('returns serverUnavailable and reports to Sentry when the fetch rejects', async () => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockRejectedValue(
      new Error('ECONNREFUSED'),
    )

    const result = await resetPasswordSubmitAction('tok', 'Str0ngPassw0rd!')

    expect(result).toEqual({ error: 'serverUnavailable' })
    expect(captureException).toHaveBeenCalled()
  })

  // KNOWN GAP - grove W-58. /reset-password is in the auth server's
  // SENSITIVE_PREFIXES (apps/auth-server/src/auth/auth-rate-limit.ts:28), so a
  // 429 is reachable here, but the action has no 429 branch and reports
  // throttling as a bad link. D-01 says every credential-bearing admin action
  // maps 429 to its own result.
  it('currently reports an upstream 429 as invalidToken', async () => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(
      upstream(429),
    )

    const result = await resetPasswordSubmitAction('tok', 'Str0ngPassw0rd!')

    expect(result).toEqual({ error: 'invalidToken' })
  })
})

describe('requestPasswordResetAction', () => {
  it.each([200, 400, 404, 429, 500])(
    'returns the same neutral result regardless of upstream %d',
    async (status) => {
      ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(
        upstream(status),
      )

      const result = await requestPasswordResetAction(
        formData({ email: 'a@b.io' }),
      )

      expect(result).toEqual({ done: true })
    },
  )

  it('stays neutral even when the fetch rejects, reporting to Sentry instead', async () => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockRejectedValue(
      new Error('ECONNREFUSED'),
    )

    const result = await requestPasswordResetAction(
      formData({ email: 'a@b.io' }),
    )

    expect(result).toEqual({ done: true })
    expect(captureException).toHaveBeenCalled()
  })

  it('sends the admin reset-password URL as redirectTo', async () => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(
      upstream(200),
    )

    await requestPasswordResetAction(formData({ email: 'a@b.io' }))

    const [url, init] = (global.fetch as jest.MockedFunction<typeof fetch>).mock
      .calls[0] as [string, RequestInit]
    expect(url).toBe('http://localhost:3000/api/auth/request-password-reset')
    expect(JSON.parse(init.body as string)).toEqual({
      email: 'a@b.io',
      redirectTo: 'http://localhost:3001/reset-password',
    })
  })

  it('coerces a missing email field to an empty string rather than throwing', async () => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(
      upstream(200),
    )

    const result = await requestPasswordResetAction(formData({}))

    expect(result).toEqual({ done: true })
    const init = (global.fetch as jest.MockedFunction<typeof fetch>).mock
      .calls[0][1] as RequestInit
    expect(JSON.parse(init.body as string).email).toBe('')
  })
})
