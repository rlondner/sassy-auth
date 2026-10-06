import { render, screen } from '@testing-library/react'
import VerifiedPage, { generateMetadata } from '../page'
import { fetchAppBranding } from '@/lib/app-branding'

jest.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}))

// LinkExpiredCard (rendered for the TOKEN_EXPIRED+email branch) is a client
// component that calls the *client* useTranslations from 'next-intl', not
// 'next-intl/server' — mock it too, or rendering it here throws for missing
// intl context. This mock (like check-email-card.test.tsx's identical one)
// ignores the namespace argument and returns the bare key.
jest.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}))

jest.mock('@/lib/app-branding', () => ({
  fetchAppBranding: jest.fn(),
}))

const mockLinkExpiredCard = jest.fn((_props: unknown) => <div data-testid="link-expired-card" />)

jest.mock('../link-expired-card', () => ({
  LinkExpiredCard: (props: unknown) => mockLinkExpiredCard(props),
}))

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

describe('SignupVerifiedPage', () => {
  it('renders a confirmation message and a link to /login when there is no error', async () => {
    const ui = await VerifiedPage({ searchParams: Promise.resolve({}) })
    render(ui)
    expect(screen.getByText('signup.verified.title')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'signup.verified.continueToLogin' })).toHaveAttribute('href', '/login')
  })

  it('passes the app logo through to AuthCard on the success branch', async () => {
    mockFetchAppBranding.mockResolvedValue({
      logo: 'data:image/png;base64,AAA=',
      favicon: null,
      pageLightBackgroundColor: null,
      pageDarkBackgroundColor: null,
      cardLightBackgroundColor: null,
      cardDarkBackgroundColor: null,
    })
    const ui = await VerifiedPage({ searchParams: Promise.resolve({}) })
    const { container } = render(ui)
    expect(container.querySelector('img')).toHaveAttribute('src', 'data:image/png;base64,AAA=')
  })

  it('renders the LinkExpiredCard when error=TOKEN_EXPIRED and email is present', async () => {
    const ui = await VerifiedPage({
      searchParams: Promise.resolve({ error: 'TOKEN_EXPIRED', email: 'jane@example.com' }),
    })
    render(ui)
    expect(screen.getByTestId('link-expired-card')).toBeInTheDocument()
    expect(mockLinkExpiredCard).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'jane@example.com',
      }),
    )
  })

  it('passes the app logo and background colors through to LinkExpiredCard', async () => {
    mockFetchAppBranding.mockResolvedValue({
      logo: 'data:image/png;base64,AAA=',
      favicon: null,
      pageLightBackgroundColor: '#fff0f0',
      pageDarkBackgroundColor: '#200000',
      cardLightBackgroundColor: '#ffffff',
      cardDarkBackgroundColor: '#111111',
    })
    const ui = await VerifiedPage({
      searchParams: Promise.resolve({ error: 'TOKEN_EXPIRED', email: 'jane@example.com' }),
    })
    render(ui)
    expect(mockLinkExpiredCard).toHaveBeenCalledWith(
      expect.objectContaining({
        logo: 'data:image/png;base64,AAA=',
        pageLightBackgroundColor: '#fff0f0',
        pageDarkBackgroundColor: '#200000',
        cardLightBackgroundColor: '#ffffff',
        cardDarkBackgroundColor: '#111111',
      }),
    )
  })

  it('renders the generic invalid-link message when error=TOKEN_EXPIRED but there is no email', async () => {
    const ui = await VerifiedPage({ searchParams: Promise.resolve({ error: 'TOKEN_EXPIRED' }) })
    render(ui)
    expect(screen.getByText('signup.verified.invalid.title')).toBeInTheDocument()
  })

  it('passes the app logo through to AuthCard on the generic error branch', async () => {
    mockFetchAppBranding.mockResolvedValue({
      logo: 'data:image/png;base64,AAA=',
      favicon: null,
      pageLightBackgroundColor: null,
      pageDarkBackgroundColor: null,
      cardLightBackgroundColor: null,
      cardDarkBackgroundColor: null,
    })
    const ui = await VerifiedPage({ searchParams: Promise.resolve({ error: 'TOKEN_EXPIRED' }) })
    const { container } = render(ui)
    expect(container.querySelector('img')).toHaveAttribute('src', 'data:image/png;base64,AAA=')
  })

  it.each(['INVALID_TOKEN', 'USER_NOT_FOUND', 'INVALID_USER', 'SOMETHING_UNKNOWN'])(
    'renders the generic invalid-link message for error=%s',
    async (error) => {
      const ui = await VerifiedPage({ searchParams: Promise.resolve({ error, email: 'jane@example.com' }) })
      render(ui)
      expect(screen.getByText('signup.verified.invalid.title')).toBeInTheDocument()
    },
  )
})

describe('SignupVerifiedPage generateMetadata', () => {
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
