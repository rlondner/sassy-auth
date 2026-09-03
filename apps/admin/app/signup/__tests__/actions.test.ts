jest.mock('@sentry/nextjs', () => ({ captureException: jest.fn() }))
jest.mock('@/lib/auth-origin', () => ({ getForwardedOrigin: jest.fn() }))

import { getForwardedOrigin } from '@/lib/auth-origin'

const mockGetForwardedOrigin = getForwardedOrigin as jest.MockedFunction<any>

function upstream(status: number) {
  return { ok: status >= 200 && status < 300, status } as Response
}

let registerAction: typeof import('../actions').registerAction

const INPUT = {
  clientId: 'sq_1',
  firstName: 'Alice',
  lastName: 'Wonder',
  companyName: 'Acme Inc',
  email: 'alice@example.com',
  password: 'SecurePass1!',
}

beforeEach(async () => {
  jest.clearAllMocks()
  jest.resetModules()
  mockGetForwardedOrigin.mockResolvedValue('https://admin.example.com')
  global.fetch = jest.fn() as jest.MockedFunction<typeof fetch>
  const mod = await import('../actions')
  registerAction = mod.registerAction
})

describe('registerAction', () => {
  it('posts the mapped fields to /api/register', async () => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(upstream(201))

    await registerAction(INPUT)

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/register'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          email: INPUT.email,
          password: INPUT.password,
          firstName: INPUT.firstName,
          lastName: INPUT.lastName,
          companyName: INPUT.companyName,
          appPublicId: INPUT.clientId,
        }),
      }),
    )
  })

  it('returns ok on a 2xx response', async () => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(upstream(201))

    await expect(registerAction(INPUT)).resolves.toEqual({ ok: true })
  })

  it.each([
    [404, 'appNotFound'],
    [409, 'emailTaken'],
    [429, 'tooManyRequests'],
    [400, 'validationError'],
    [500, 'validationError'],
  ])('maps upstream %d to %s', async (status, expected) => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(upstream(status))

    await expect(registerAction(INPUT)).resolves.toEqual({ error: expected })
  })

  it('returns serverUnavailable when the fetch itself rejects', async () => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockRejectedValue(new Error('ECONNREFUSED'))

    await expect(registerAction(INPUT)).resolves.toEqual({ error: 'serverUnavailable' })
  })
})
