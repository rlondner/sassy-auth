import { fetchSocialProviders } from '../social-providers'

const originalFetch = global.fetch

afterEach(() => {
  global.fetch = originalFetch
})

describe('fetchSocialProviders', () => {
  it('returns providers, logo, name, and favicon from a successful response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ providers: ['google'], logo: 'data:image/png;base64,AAA=', name: 'Acme', favicon: 'data:image/png;base64,FFF=' }),
    }) as unknown as typeof fetch

    await expect(fetchSocialProviders('/authorize?client_id=sq_1')).resolves.toEqual({
      providers: ['google'],
      logo: 'data:image/png;base64,AAA=',
      name: 'Acme',
      favicon: 'data:image/png;base64,FFF=',
      pageLightBackgroundColor: null,
      pageDarkBackgroundColor: null,
      cardLightBackgroundColor: null,
      cardDarkBackgroundColor: null,
    })
  })

  it('returns an empty providers list and all-null fields on a non-ok response', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false }) as unknown as typeof fetch

    await expect(fetchSocialProviders('/authorize?client_id=sq_1')).resolves.toEqual({
      providers: [],
      logo: null,
      name: null,
      favicon: null,
      pageLightBackgroundColor: null,
      pageDarkBackgroundColor: null,
      cardLightBackgroundColor: null,
      cardDarkBackgroundColor: null,
    })
  })

  it('returns an empty providers list and all-null fields when fetch throws', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network')) as unknown as typeof fetch

    await expect(fetchSocialProviders('/authorize?client_id=sq_1')).resolves.toEqual({
      providers: [],
      logo: null,
      name: null,
      favicon: null,
      pageLightBackgroundColor: null,
      pageDarkBackgroundColor: null,
      cardLightBackgroundColor: null,
      cardDarkBackgroundColor: null,
    })
  })

  it('tolerates malformed logo/name/favicon fields in the response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ providers: ['google'], logo: 123, name: 456, favicon: 789 }),
    }) as unknown as typeof fetch

    await expect(fetchSocialProviders('/authorize?client_id=sq_1')).resolves.toEqual({
      providers: ['google'],
      logo: null,
      name: null,
      favicon: null,
      pageLightBackgroundColor: null,
      pageDarkBackgroundColor: null,
      cardLightBackgroundColor: null,
      cardDarkBackgroundColor: null,
    })
  })
})
