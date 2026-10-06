import { render, screen } from '@testing-library/react'
import LoginConsentPage, { generateMetadata } from '../page'
import { fetchAppBranding } from '@/lib/app-branding'
import { fetchOutstandingConsent } from '@/lib/consent'

jest.mock('next/navigation', () => ({
  redirect: jest.fn((url: string) => {
    const err = new Error(`NEXT_REDIRECT;${url}`) as Error & { digest: string }
    err.digest = `NEXT_REDIRECT;push;${url};307;`
    throw err
  }),
}))

jest.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}))

jest.mock('@/lib/app-branding', () => ({
  fetchAppBranding: jest.fn(),
}))

jest.mock('@/lib/consent', () => ({
  fetchOutstandingConsent: jest.fn(),
}))

const mockConsentGateClient = jest.fn((_props: unknown) => <div data-testid="consent-gate-client" />)

jest.mock('../ConsentGateClient', () => ({
  ConsentGateClient: (props: unknown) => mockConsentGateClient(props),
}))

const mockFetchAppBranding = fetchAppBranding as jest.MockedFunction<typeof fetchAppBranding>
const mockFetchOutstandingConsent = fetchOutstandingConsent as jest.MockedFunction<typeof fetchOutstandingConsent>

// validateNextUrl only accepts a same-origin path or an absolute URL whose
// origin matches AUTH_SERVER_URL (default https://localhost:3010 — see
// apps/admin/lib/safe-next.ts's allowlist()), so this uses that default
// origin rather than a real resource server's domain.
const AUTHORIZE_NEXT = 'https://localhost:3010/api/token/oauth/authorize?client_id=p5sV&redirect_uri=https%3A%2F%2Flocalhost%3A3030%2Fapi%2Fauth%2Fcallback&scope=openid+email+profile'

beforeEach(() => {
  jest.clearAllMocks()
  mockFetchAppBranding.mockResolvedValue({
    logo: null,
    favicon: null,
    pageLightBackgroundColor: null,
    pageDarkBackgroundColor: null,
    cardLightBackgroundColor: null,
    cardDarkBackgroundColor: null,
  })
  mockFetchOutstandingConsent.mockResolvedValue([{ documentType: 'terms', url: 'https://a.example.com/terms' }])
})

describe('LoginConsentPage', () => {
  it('renders the ConsentGateClient with branding passed through when consent is outstanding', async () => {
    mockFetchAppBranding.mockResolvedValue({
      logo: 'data:image/png;base64,AAA=',
      favicon: null,
      pageLightBackgroundColor: '#fff0f0',
      pageDarkBackgroundColor: '#200000',
      cardLightBackgroundColor: '#ffffff',
      cardDarkBackgroundColor: '#111111',
    })
    const ui = await LoginConsentPage({
      searchParams: Promise.resolve({ appPublicId: 'sq_1', next: AUTHORIZE_NEXT }),
    })
    render(ui)
    expect(screen.getByTestId('consent-gate-client')).toBeInTheDocument()
    expect(mockConsentGateClient).toHaveBeenCalledWith(
      expect.objectContaining({
        appPublicId: 'sq_1',
        outstanding: [{ documentType: 'terms', url: 'https://a.example.com/terms' }],
      }),
    )
  })

  it('redirects to /users (fail-open) when there is no outstanding consent', async () => {
    mockFetchOutstandingConsent.mockResolvedValue([])
    await expect(
      LoginConsentPage({ searchParams: Promise.resolve({ appPublicId: 'sq_1' }) }),
    ).rejects.toThrow('NEXT_REDIRECT;/users')
  })

  it('redirects to the validated next URL (fail-open) when there is no outstanding consent', async () => {
    mockFetchOutstandingConsent.mockResolvedValue([])
    await expect(
      LoginConsentPage({ searchParams: Promise.resolve({ appPublicId: 'sq_1', next: AUTHORIZE_NEXT }) }),
    ).rejects.toThrow(`NEXT_REDIRECT;${AUTHORIZE_NEXT}`)
  })
})

describe('LoginConsentPage generateMetadata', () => {
  it('returns no metadata when there is no appPublicId', async () => {
    const metadata = await generateMetadata({ searchParams: Promise.resolve({}) })
    expect(metadata).toEqual({})
    expect(mockFetchAppBranding).not.toHaveBeenCalled()
  })

  it('sets the tab icon when the app has a favicon', async () => {
    mockFetchAppBranding.mockResolvedValue({
      logo: null,
      favicon: 'data:image/png;base64,FFF=',
      pageLightBackgroundColor: null,
      pageDarkBackgroundColor: null,
      cardLightBackgroundColor: null,
      cardDarkBackgroundColor: null,
    })
    const metadata = await generateMetadata({ searchParams: Promise.resolve({ appPublicId: 'sq_1' }) })
    expect(metadata).toEqual({ icons: { icon: 'data:image/png;base64,FFF=' } })
  })

  it('leaves the icon unset when the app has no favicon', async () => {
    mockFetchAppBranding.mockResolvedValue({
      logo: null,
      favicon: null,
      pageLightBackgroundColor: null,
      pageDarkBackgroundColor: null,
      cardLightBackgroundColor: null,
      cardDarkBackgroundColor: null,
    })
    const metadata = await generateMetadata({ searchParams: Promise.resolve({ appPublicId: 'sq_1' }) })
    expect(metadata).toEqual({})
  })
})
