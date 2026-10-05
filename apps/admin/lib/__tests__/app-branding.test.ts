import { fetchAppBranding } from '../app-branding'

const mockFetch = jest.fn()
global.fetch = mockFetch as unknown as typeof fetch

beforeEach(() => mockFetch.mockReset())

describe('fetchAppBranding', () => {
  it('returns the 4 background colors (and logo) for a known client_id', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        providers: [], logo: 'data:image/png;base64,AAA=', name: 'App', favicon: null,
        pageLightBackgroundColor: '#111111', pageDarkBackgroundColor: '#222222',
        cardLightBackgroundColor: '#333333', cardDarkBackgroundColor: '#444444',
      }),
    })

    const result = await fetchAppBranding('client-1')

    expect(result.logo).toBe('data:image/png;base64,AAA=')
    expect(result.pageLightBackgroundColor).toBe('#111111')
    expect(result.cardDarkBackgroundColor).toBe('#444444')
  })

  it('returns all-null on a missing client_id', async () => {
    const result = await fetchAppBranding(null)
    expect(mockFetch).not.toHaveBeenCalled()
    expect(result.pageLightBackgroundColor).toBeNull()
  })

  it('returns all-null on fetch failure', async () => {
    mockFetch.mockResolvedValue({ ok: false })
    const result = await fetchAppBranding('client-1')
    expect(result.pageLightBackgroundColor).toBeNull()
  })

  it('returns all-null when fetch throws', async () => {
    mockFetch.mockRejectedValue(new Error('network'))
    const result = await fetchAppBranding('client-1')
    expect(result.cardLightBackgroundColor).toBeNull()
  })
})
