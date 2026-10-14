/**
 * Covers requestPasswordResetAction in apps/admin/app/forgot-password/actions.ts.
 * See apps/admin/app/reset-password/__tests__/actions.test.ts for the
 * resetPasswordSubmitAction half of this pair (imported from here).
 */
export {}

jest.mock('@sentry/nextjs', () => ({
  addBreadcrumb: jest.fn(),
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}))
jest.mock('@/lib/auth-origin', () => ({ getForwardedOrigin: jest.fn() }))
jest.mock('@/lib/forward-client-ip', () => ({ getForwardedClientIpHeader: jest.fn().mockResolvedValue({}) }))

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

let requestPasswordResetAction: any
let mockGetForwardedClientIpHeader: jest.MockedFunction<any>

beforeEach(async () => {
  jest.clearAllMocks()
  jest.resetModules()
  global.fetch = jest.fn() as jest.MockedFunction<typeof fetch>
  const authOrigin = await import('@/lib/auth-origin')
  ;(authOrigin.getForwardedOrigin as jest.MockedFunction<any>).mockResolvedValue(
    'https://admin.example.com',
  )
  const forwardClientIp = await import('@/lib/forward-client-ip')
  mockGetForwardedClientIpHeader =
    forwardClientIp.getForwardedClientIpHeader as jest.MockedFunction<any>
  mockGetForwardedClientIpHeader.mockResolvedValue({})
  requestPasswordResetAction = (await import('../actions')).requestPasswordResetAction
})

// bug-0297: /forget-password is a SENSITIVE_PREFIXES entry in
// auth-rate-limit.ts, keyed on resolveClientIp. Without re-sending the
// browser's real X-Forwarded-For on this server-to-server call, every
// password-reset request proxied through admin shares one bucket keyed on
// the admin server's own egress address.
describe('requestPasswordResetAction client-IP forwarding', () => {
  it('forwards the X-Forwarded-For header returned by getForwardedClientIpHeader', async () => {
    mockGetForwardedClientIpHeader.mockResolvedValue({ 'X-Forwarded-For': '203.0.113.7' })
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(upstream(200))

    await requestPasswordResetAction(formData({ email: 'a@b.io' }))

    const init = (global.fetch as jest.MockedFunction<typeof fetch>).mock
      .calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>)['X-Forwarded-For']).toBe('203.0.113.7')
  })

  it('omits the header when no incoming X-Forwarded-For was present', async () => {
    mockGetForwardedClientIpHeader.mockResolvedValue({})
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(upstream(200))

    await requestPasswordResetAction(formData({ email: 'a@b.io' }))

    const init = (global.fetch as jest.MockedFunction<typeof fetch>).mock
      .calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>)['X-Forwarded-For']).toBeUndefined()
  })
})
