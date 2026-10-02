import { render, screen } from '@testing-library/react'
import CheckEmailPage from '../page'
import { fetchAppInfo } from '@/lib/app-info'

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

jest.mock('../check-email-card', () => ({
  CheckEmailCard: () => <div data-testid="check-email-card" />,
}))

jest.mock('../verify-code-card', () => ({
  VerifyCodeCard: () => <div data-testid="verify-code-card" />,
}))

const mockFetchAppInfo = fetchAppInfo as jest.MockedFunction<typeof fetchAppInfo>

const BASE_APP_INFO = {
  name: null, hasDefaultOrg: false, passwordPolicy: null, logo: null, favicon: null,
  privacyPolicyUrl: null, termsUrl: null, gdprUrl: null, gdprRequired: false,
  emailVerificationMethod: 'link' as const,
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('CheckEmailPage', () => {
  it('shows the missing-email message when no email is given', async () => {
    const ui = await CheckEmailPage({ searchParams: Promise.resolve({}) })
    render(ui)
    expect(screen.getByText('signup.checkEmail.missingEmail')).toBeInTheDocument()
    expect(mockFetchAppInfo).not.toHaveBeenCalled()
  })

  it('renders CheckEmailCard when no clientId is given (fail open)', async () => {
    const ui = await CheckEmailPage({ searchParams: Promise.resolve({ email: 'a@x.com' }) })
    render(ui)
    expect(screen.getByTestId('check-email-card')).toBeInTheDocument()
    expect(mockFetchAppInfo).not.toHaveBeenCalled()
  })

  it('renders CheckEmailCard when the app is configured for the link method', async () => {
    mockFetchAppInfo.mockResolvedValue({ ...BASE_APP_INFO, emailVerificationMethod: 'link' })
    const ui = await CheckEmailPage({ searchParams: Promise.resolve({ email: 'a@x.com', clientId: 'sq_1' }) })
    render(ui)
    expect(screen.getByTestId('check-email-card')).toBeInTheDocument()
  })

  it('renders VerifyCodeCard when the app is configured for the code method', async () => {
    mockFetchAppInfo.mockResolvedValue({ ...BASE_APP_INFO, emailVerificationMethod: 'code' })
    const ui = await CheckEmailPage({ searchParams: Promise.resolve({ email: 'a@x.com', clientId: 'sq_1' }) })
    render(ui)
    expect(screen.getByTestId('verify-code-card')).toBeInTheDocument()
  })
})
