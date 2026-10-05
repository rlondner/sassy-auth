jest.mock('@/lib/forward-client-ip', () => ({ getForwardedClientIpHeader: jest.fn() }))

import { fetchAppInfo } from '@/lib/app-info'
import { getForwardedClientIpHeader } from '@/lib/forward-client-ip'

const mockGetForwardedClientIpHeader = getForwardedClientIpHeader as jest.MockedFunction<any>

beforeEach(() => {
  jest.clearAllMocks()
  mockGetForwardedClientIpHeader.mockResolvedValue({})
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
      logo: null,
      favicon: null,
      privacyPolicyUrl: null,
      termsUrl: null,
      gdprUrl: null,
      emailVerificationMethod: 'link',
      gdprRequired: false,
      pageLightBackgroundColor: null,
      pageDarkBackgroundColor: null,
      cardLightBackgroundColor: null,
      cardDarkBackgroundColor: null,
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
      logo: null,
      favicon: null,
      privacyPolicyUrl: null,
      termsUrl: null,
      gdprUrl: null,
      emailVerificationMethod: 'link',
      gdprRequired: false,
      pageLightBackgroundColor: null,
      pageDarkBackgroundColor: null,
      cardLightBackgroundColor: null,
      cardDarkBackgroundColor: null,
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
      logo: null,
      favicon: null,
      privacyPolicyUrl: null,
      termsUrl: null,
      gdprUrl: null,
      emailVerificationMethod: 'link',
      gdprRequired: false,
      pageLightBackgroundColor: null,
      pageDarkBackgroundColor: null,
      cardLightBackgroundColor: null,
      cardDarkBackgroundColor: null,
    })
  })

  it('falls back to name: null, hasDefaultOrg: false, passwordPolicy: null when fetch throws', async () => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockRejectedValue(new Error('ECONNREFUSED'))

    await expect(fetchAppInfo('sq_1')).resolves.toEqual({
      name: null,
      hasDefaultOrg: false,
      passwordPolicy: null,
      logo: null,
      favicon: null,
      privacyPolicyUrl: null,
      termsUrl: null,
      gdprUrl: null,
      emailVerificationMethod: 'link',
      gdprRequired: false,
      pageLightBackgroundColor: null,
      pageDarkBackgroundColor: null,
      cardLightBackgroundColor: null,
      cardDarkBackgroundColor: null,
    })
  })

  it('returns the favicon from a successful response', async () => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ name: 'Acme', hasDefaultOrg: true, passwordPolicy: POLICY, favicon: 'data:image/png;base64,FFF=' }),
    } as Response)

    await expect(fetchAppInfo('sq_1')).resolves.toEqual({
      name: 'Acme',
      hasDefaultOrg: true,
      passwordPolicy: POLICY,
      logo: null,
      favicon: 'data:image/png;base64,FFF=',
      privacyPolicyUrl: null,
      termsUrl: null,
      gdprUrl: null,
      emailVerificationMethod: 'link',
      gdprRequired: false,
      pageLightBackgroundColor: null,
      pageDarkBackgroundColor: null,
      cardLightBackgroundColor: null,
      cardDarkBackgroundColor: null,
    })
  })

  it('returns emailVerificationMethod "code" from a successful response', async () => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ name: 'Acme', hasDefaultOrg: true, passwordPolicy: POLICY, emailVerificationMethod: 'code' }),
    } as Response)

    const result = await fetchAppInfo('sq_1')
    expect(result.emailVerificationMethod).toBe('code')
  })

  it('passes through the 4 background color overrides', async () => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        name: 'App', hasDefaultOrg: false, logo: null, favicon: null,
        privacyPolicyUrl: null, termsUrl: null, gdprUrl: null, gdprRequired: false,
        emailVerificationMethod: 'link',
        pageLightBackgroundColor: '#111111',
        pageDarkBackgroundColor: '#222222',
        cardLightBackgroundColor: '#333333',
        cardDarkBackgroundColor: '#444444',
      }),
    } as Response)

    const result = await fetchAppInfo('client-1')

    expect(result.pageLightBackgroundColor).toBe('#111111')
    expect(result.pageDarkBackgroundColor).toBe('#222222')
    expect(result.cardLightBackgroundColor).toBe('#333333')
    expect(result.cardDarkBackgroundColor).toBe('#444444')
  })

  it('defaults the 4 background color overrides to null on fetch failure', async () => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({ ok: false } as Response)
    const result = await fetchAppInfo('client-1')
    expect(result.pageLightBackgroundColor).toBeNull()
    expect(result.cardDarkBackgroundColor).toBeNull()
  })
})
