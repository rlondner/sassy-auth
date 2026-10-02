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

const mockFetchAppInfo = fetchAppInfo as jest.MockedFunction<typeof fetchAppInfo>

beforeEach(() => {
  jest.clearAllMocks()
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
})
