import { render, screen } from '@testing-library/react'
import CheckEmailPage, { generateMetadata } from '../page'
import { fetchAppInfo } from '@/lib/app-info'
import { fetchAppBranding } from '@/lib/app-branding'

jest.mock('next-intl/server', () => ({
  getTranslations: async (namespace?: string) => {
    const t = (key: string, values?: Record<string, string>) => {
      const full = namespace ? `${namespace}.${key}` : key
      return values ? `${full} ${JSON.stringify(values)}` : full
    }
    return t
  },
}))

jest.mock('@/lib/app-info', () => ({
  fetchAppInfo: jest.fn(),
}))

jest.mock('@/lib/app-branding', () => ({
  fetchAppBranding: jest.fn(),
}))

const mockCheckEmailCard = jest.fn(() => <div data-testid="check-email-card" />)

jest.mock('../check-email-card', () => ({
  CheckEmailCard: (props: unknown) => mockCheckEmailCard(props),
}))

const mockFetchAppInfo = fetchAppInfo as jest.MockedFunction<typeof fetchAppInfo>
const mockFetchAppBranding = fetchAppBranding as jest.MockedFunction<typeof fetchAppBranding>

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

describe('CheckEmailPage', () => {
  it('shows the missing-email message when no email is given', async () => {
    const ui = await CheckEmailPage({ searchParams: Promise.resolve({}) })
    render(ui)
    expect(screen.getByText('signup.checkEmail.missingEmail')).toBeInTheDocument()
  })

  it('passes the app logo through to AuthCard on the missing-email branch', async () => {
    mockFetchAppBranding.mockResolvedValue({
      logo: 'data:image/png;base64,AAA=',
      favicon: null,
      pageLightBackgroundColor: null,
      pageDarkBackgroundColor: null,
      cardLightBackgroundColor: null,
      cardDarkBackgroundColor: null,
    })
    const ui = await CheckEmailPage({ searchParams: Promise.resolve({}) })
    const { container } = render(ui)
    expect(container.querySelector('img')).toHaveAttribute('src', 'data:image/png;base64,AAA=')
  })

  it('always renders CheckEmailCard — code-method apps never reach this page (see signup-wizard.tsx)', async () => {
    const ui = await CheckEmailPage({ searchParams: Promise.resolve({ email: 'a@x.com' }) })
    render(ui)
    expect(screen.getByTestId('check-email-card')).toBeInTheDocument()
  })

  it('passes the app logo and background colors through to CheckEmailCard', async () => {
    mockFetchAppBranding.mockResolvedValue({
      logo: 'data:image/png;base64,AAA=',
      favicon: null,
      pageLightBackgroundColor: '#fff0f0',
      pageDarkBackgroundColor: '#200000',
      cardLightBackgroundColor: '#ffffff',
      cardDarkBackgroundColor: '#111111',
    })
    const ui = await CheckEmailPage({ searchParams: Promise.resolve({ email: 'a@x.com' }) })
    render(ui)
    expect(mockCheckEmailCard).toHaveBeenCalledWith(
      expect.objectContaining({
        logo: 'data:image/png;base64,AAA=',
        pageLightBackgroundColor: '#fff0f0',
        pageDarkBackgroundColor: '#200000',
        cardLightBackgroundColor: '#ffffff',
        cardDarkBackgroundColor: '#111111',
      }),
    )
  })

  it('applies per-app background colors', async () => {
    mockFetchAppBranding.mockResolvedValue({
      logo: null,
      favicon: null,
      pageLightBackgroundColor: '#fff0f0',
      pageDarkBackgroundColor: '#200000',
      cardLightBackgroundColor: '#ffffff',
      cardDarkBackgroundColor: '#111111',
    })
    const ui = await CheckEmailPage({ searchParams: Promise.resolve({ client_id: 'sq_1' }) })
    const { container } = render(ui)
    expect(container.querySelector('[data-auth-page-bg]')).not.toBeNull()
    expect(mockFetchAppBranding).toHaveBeenCalledWith('sq_1')
  })
})

describe('CheckEmailPage generateMetadata', () => {
  it('returns no metadata when there is no client_id', async () => {
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
    const metadata = await generateMetadata({ searchParams: Promise.resolve({ client_id: 'sq_1' }) })
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
    const metadata = await generateMetadata({ searchParams: Promise.resolve({ client_id: 'sq_1' }) })
    expect(metadata).toEqual({})
  })
})
