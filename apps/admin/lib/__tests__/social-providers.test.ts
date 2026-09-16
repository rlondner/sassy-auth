import { fetchSocialProviders } from '../social-providers'

const originalFetch = global.fetch

afterEach(() => {
  global.fetch = originalFetch
})

describe('fetchSocialProviders', () => {
  it('returns providers and logo from a successful response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ providers: ['google'], logo: 'data:image/png;base64,AAA=' }),
    }) as unknown as typeof fetch

    await expect(fetchSocialProviders('/authorize?client_id=sq_1')).resolves.toEqual({
      providers: ['google'],
      logo: 'data:image/png;base64,AAA=',
    })
  })

  it('returns an empty providers list and null logo on a non-ok response', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false }) as unknown as typeof fetch

    await expect(fetchSocialProviders('/authorize?client_id=sq_1')).resolves.toEqual({
      providers: [],
      logo: null,
    })
  })

  it('returns an empty providers list and null logo when fetch throws', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network')) as unknown as typeof fetch

    await expect(fetchSocialProviders('/authorize?client_id=sq_1')).resolves.toEqual({
      providers: [],
      logo: null,
    })
  })

  it('tolerates a malformed logo field in the response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ providers: ['google'], logo: 123 }),
    }) as unknown as typeof fetch

    await expect(fetchSocialProviders('/authorize?client_id=sq_1')).resolves.toEqual({
      providers: ['google'],
      logo: null,
    })
  })
})
