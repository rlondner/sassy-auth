import { render, screen } from '@testing-library/react'
import CheckEmailPage from '../page'
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

jest.mock('../check-email-card', () => ({
  CheckEmailCard: () => <div data-testid="check-email-card" />,
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

  it('always renders CheckEmailCard — code-method apps never reach this page (see signup-wizard.tsx)', async () => {
    const ui = await CheckEmailPage({ searchParams: Promise.resolve({ email: 'a@x.com' }) })
    render(ui)
    expect(screen.getByTestId('check-email-card')).toBeInTheDocument()
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
