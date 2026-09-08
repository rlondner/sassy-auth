import { fetchAppInfo } from '../fetch-app-info'

beforeEach(() => {
  jest.clearAllMocks()
  global.fetch = jest.fn() as jest.MockedFunction<typeof fetch>
})

const POLICY = {
  minLength: 12,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  requireSpecial: false,
  minNumbers: 1,
  minSpecial: 0,
}

describe('fetchAppInfo', () => {
  it('returns the app name, hasDefaultOrg, and passwordPolicy when the response is ok', async () => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ name: 'Acme', hasDefaultOrg: true, passwordPolicy: POLICY }),
    } as Response)

    await expect(fetchAppInfo('sq_1')).resolves.toEqual({
      name: 'Acme',
      hasDefaultOrg: true,
      passwordPolicy: POLICY,
    })
  })

  it('falls back to passwordPolicy: null when the response omits it', async () => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ name: 'Acme', hasDefaultOrg: true }),
    } as Response)

    await expect(fetchAppInfo('sq_1')).resolves.toEqual({
      name: 'Acme',
      hasDefaultOrg: true,
      passwordPolicy: null,
    })
  })

  it('falls back to name: null, hasDefaultOrg: false, passwordPolicy: null when the response is not ok', async () => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ name: 'Acme', hasDefaultOrg: true, passwordPolicy: POLICY }),
    } as Response)

    await expect(fetchAppInfo('sq_1')).resolves.toEqual({
      name: null,
      hasDefaultOrg: false,
      passwordPolicy: null,
    })
  })

  it('falls back to name: null, hasDefaultOrg: false, passwordPolicy: null when fetch throws', async () => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockRejectedValue(new Error('ECONNREFUSED'))

    await expect(fetchAppInfo('sq_1')).resolves.toEqual({
      name: null,
      hasDefaultOrg: false,
      passwordPolicy: null,
    })
  })
})
