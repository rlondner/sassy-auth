import { render, screen } from '@testing-library/react'
import SignupPage from '../page'
import { fetchAppInfo } from '@/lib/app-info'

jest.mock('next-intl/server', () => ({
  getTranslations: async () => {
    const t = (key: string, values?: Record<string, string>) =>
      values ? `${key} ${JSON.stringify(values)}` : key
    return t
  },
}))

jest.mock('@/lib/app-info', () => ({
  fetchAppInfo: jest.fn(),
}))

jest.mock('../signup-form', () => ({
  SignupForm: () => <div data-testid="signup-form" />,
}))

const mockFetchAppInfo = fetchAppInfo as jest.MockedFunction<typeof fetchAppInfo>

const BASE_APP_INFO = {
  name: null,
  hasDefaultOrg: false,
  passwordPolicy: null,
  logo: null,
  privacyPolicyUrl: null,
  termsUrl: null,
  gdprUrl: null,
  gdprRequired: false,
}

describe('SignupPage subtitle', () => {
  it('shows the default-org subtitle when there is no specific app', async () => {
    mockFetchAppInfo.mockResolvedValue({ ...BASE_APP_INFO, hasDefaultOrg: true })
    const ui = await SignupPage({ searchParams: Promise.resolve({ client_id: 'sq_1' }) })
    render(ui)

    expect(screen.getByText('signup.subtitleDefaultOrg')).toBeInTheDocument()
  })

  it('hides the default-org subtitle when signing up for a specific app', async () => {
    mockFetchAppInfo.mockResolvedValue({ ...BASE_APP_INFO, hasDefaultOrg: true, name: 'Acme' })
    const ui = await SignupPage({ searchParams: Promise.resolve({ client_id: 'sq_1' }) })
    render(ui)

    expect(screen.queryByText('signup.subtitleDefaultOrg')).not.toBeInTheDocument()
  })

  it('still shows the organization subtitle for a specific app without a default org', async () => {
    mockFetchAppInfo.mockResolvedValue({ ...BASE_APP_INFO, hasDefaultOrg: false, name: 'Acme' })
    const ui = await SignupPage({ searchParams: Promise.resolve({ client_id: 'sq_1' }) })
    render(ui)

    expect(screen.getByText('signup.subtitle')).toBeInTheDocument()
  })
})
