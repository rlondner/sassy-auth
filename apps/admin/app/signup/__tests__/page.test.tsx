import { fetchAppInfo } from '../page'

beforeEach(() => {
  jest.clearAllMocks()
  global.fetch = jest.fn() as jest.MockedFunction<typeof fetch>
})

describe('fetchAppInfo', () => {
  it('returns the app name and hasDefaultOrg when the response is ok', async () => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ name: 'Acme', hasDefaultOrg: true }),
    } as Response)

    await expect(fetchAppInfo('sq_1')).resolves.toEqual({ name: 'Acme', hasDefaultOrg: true })
  })

  it('falls back to name: null, hasDefaultOrg: false when the response is not ok', async () => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ name: 'Acme', hasDefaultOrg: true }),
    } as Response)

    await expect(fetchAppInfo('sq_1')).resolves.toEqual({ name: null, hasDefaultOrg: false })
  })

  it('falls back to name: null, hasDefaultOrg: false when fetch throws', async () => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockRejectedValue(new Error('ECONNREFUSED'))

    await expect(fetchAppInfo('sq_1')).resolves.toEqual({ name: null, hasDefaultOrg: false })
  })
})
