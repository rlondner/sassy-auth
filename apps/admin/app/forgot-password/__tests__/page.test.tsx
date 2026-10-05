import { render } from '@testing-library/react'
import ForgotPasswordPage, { generateMetadata } from '../page'
import { fetchAppBranding } from '@/lib/app-branding'

jest.mock('@/lib/app-branding', () => ({
  fetchAppBranding: jest.fn(),
}))

const mockForgotPasswordForm = jest.fn((_props: unknown) => <div data-testid="forgot-password-form" />)

jest.mock('../forgot-password-form', () => ({
  ForgotPasswordForm: (props: unknown) => mockForgotPasswordForm(props),
}))

const mockFetchAppBranding = fetchAppBranding as jest.MockedFunction<typeof fetchAppBranding>

// validateNextUrl only accepts a same-origin path or an absolute URL whose
// origin matches AUTH_SERVER_URL (default https://localhost:3010 — see
// apps/admin/lib/safe-next.ts's allowlist()), so this uses that default
// origin rather than a real resource server's domain — the shape mirrors
// the authorize-URL `next` a resource-server app actually sends (e.g.
// `https://auth-api-dev.milissai.com/api/token/oauth/authorize?client_id=...`),
// just on an origin this test environment's default allowlist accepts.
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
})

describe('ForgotPasswordPage', () => {
  it('renders ForgotPasswordForm with branding passed through', async () => {
    mockFetchAppBranding.mockResolvedValue({
      logo: 'data:image/png;base64,AAA=',
      favicon: null,
      pageLightBackgroundColor: '#fff0f0',
      pageDarkBackgroundColor: '#200000',
      cardLightBackgroundColor: '#ffffff',
      cardDarkBackgroundColor: '#111111',
    })
    const ui = await ForgotPasswordPage({ searchParams: Promise.resolve({ next: AUTHORIZE_NEXT }) })
    render(ui)
    expect(mockForgotPasswordForm).toHaveBeenCalledWith(
      expect.objectContaining({
        logo: 'data:image/png;base64,AAA=',
        pageLightBackgroundColor: '#fff0f0',
        pageDarkBackgroundColor: '#200000',
        cardLightBackgroundColor: '#ffffff',
        cardDarkBackgroundColor: '#111111',
      }),
    )
  })
})

describe('ForgotPasswordPage generateMetadata', () => {
  it('returns no metadata when next does not resolve to a client_id', async () => {
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
    const metadata = await generateMetadata({ searchParams: Promise.resolve({ next: AUTHORIZE_NEXT }) })
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
    const metadata = await generateMetadata({ searchParams: Promise.resolve({ next: AUTHORIZE_NEXT }) })
    expect(metadata).toEqual({})
  })
})
