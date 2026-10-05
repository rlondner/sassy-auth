import { render, screen } from '@testing-library/react'
import SignupPage, { generateMetadata } from '../page'
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

jest.mock('../signup-wizard', () => ({
  SignupWizard: () => <div data-testid="signup-wizard" />,
}))

const mockFetchAppInfo = fetchAppInfo as jest.MockedFunction<typeof fetchAppInfo>

beforeEach(() => {
  jest.clearAllMocks()
})

const BASE_APP_INFO = {
  name: null,
  hasDefaultOrg: false,
  passwordPolicy: null,
  logo: null,
  favicon: null,
  privacyPolicyUrl: null,
  termsUrl: null,
  gdprUrl: null,
  gdprRequired: false,
  emailVerificationMethod: 'link' as const,
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

describe('SignupPage verification method', () => {
  it('renders SignupForm when the app uses the link verification method', async () => {
    mockFetchAppInfo.mockResolvedValue({ ...BASE_APP_INFO, emailVerificationMethod: 'link' })
    const ui = await SignupPage({ searchParams: Promise.resolve({ client_id: 'sq_1' }) })
    render(ui)
    expect(screen.getByTestId('signup-form')).toBeInTheDocument()
    expect(screen.queryByTestId('signup-wizard')).not.toBeInTheDocument()
  })

  it('renders SignupWizard when the app uses the code verification method', async () => {
    mockFetchAppInfo.mockResolvedValue({ ...BASE_APP_INFO, emailVerificationMethod: 'code' })
    const ui = await SignupPage({ searchParams: Promise.resolve({ client_id: 'sq_1' }) })
    render(ui)
    expect(screen.getByTestId('signup-wizard')).toBeInTheDocument()
    expect(screen.queryByTestId('signup-form')).not.toBeInTheDocument()
  })
})

describe('SignupPage generateMetadata', () => {
  it('sets the title to "{appName} Sign Up" when the app has a name', async () => {
    mockFetchAppInfo.mockResolvedValue({ ...BASE_APP_INFO, name: 'Acme' })
    const metadata = await generateMetadata({ searchParams: Promise.resolve({ client_id: 'sq_1' }) })
    expect(metadata.title).toBe('Acme Sign Up')
  })

  it('leaves the title unset when there is no client_id', async () => {
    const metadata = await generateMetadata({ searchParams: Promise.resolve({}) })
    expect(metadata.title).toBeUndefined()
    expect(mockFetchAppInfo).not.toHaveBeenCalled()
  })

  it('leaves the title unset when the app has no name', async () => {
    mockFetchAppInfo.mockResolvedValue({ ...BASE_APP_INFO, name: null })
    const metadata = await generateMetadata({ searchParams: Promise.resolve({ client_id: 'sq_1' }) })
    expect(metadata.title).toBeUndefined()
  })

  it('sets the tab icon when the app has a favicon', async () => {
    mockFetchAppInfo.mockResolvedValue({ ...BASE_APP_INFO, name: 'Acme', favicon: 'data:image/png;base64,FFF=' })
    const metadata = await generateMetadata({ searchParams: Promise.resolve({ client_id: 'sq_1' }) })
    expect(metadata.icons).toEqual({ icon: 'data:image/png;base64,FFF=' })
  })

  it('leaves the icon unset when the app has no favicon', async () => {
    mockFetchAppInfo.mockResolvedValue({ ...BASE_APP_INFO, name: 'Acme', favicon: null })
    const metadata = await generateMetadata({ searchParams: Promise.resolve({ client_id: 'sq_1' }) })
    expect(metadata.icons).toBeUndefined()
  })
})
