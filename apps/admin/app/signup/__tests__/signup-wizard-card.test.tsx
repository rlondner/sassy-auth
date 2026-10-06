import { render, screen, fireEvent } from '@testing-library/react'
import { SignupWizardCard } from '../signup-wizard-card'
import { startRegistrationAction, verifyRegistrationCodeAction } from '../wizard-actions'

// Same convention as signup-wizard.test.tsx: mock next-intl so the key itself
// (scoped under 'signup') is rendered, matching the real messages/en.json
// nesting the assertions below rely on.
jest.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
}))

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }))

jest.mock('@marsidev/react-turnstile', () => ({
  Turnstile: ({ onSuccess }: { onSuccess: (token: string) => void }) => (
    <button type="button" data-testid="mock-turnstile-success" onClick={() => onSuccess('test-captcha-token')}>
      Complete captcha
    </button>
  ),
}))

jest.mock('../wizard-actions', () => ({
  startRegistrationAction: jest.fn(),
  verifyRegistrationCodeAction: jest.fn(),
  completeRegistrationAction: jest.fn(),
}))

const mockStart = startRegistrationAction as jest.MockedFunction<typeof startRegistrationAction>
const mockVerify = verifyRegistrationCodeAction as jest.MockedFunction<typeof verifyRegistrationCodeAction>

const POLICY = {
  minLength: 12,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  requireSpecial: false,
  minNumbers: 1,
  minSpecial: 0,
}

const BASE_PROPS = {
  clientId: 'sq_1',
  next: '',
  hasDefaultOrg: true,
  passwordPolicy: POLICY,
  privacyPolicyUrl: null,
  termsUrl: null,
  gdprUrl: null,
  appName: null,
  logo: null,
  pageLightBackgroundColor: null,
  pageDarkBackgroundColor: null,
  cardLightBackgroundColor: null,
  cardDarkBackgroundColor: null,
  footer: null,
}

beforeEach(() => {
  jest.clearAllMocks()
})

function completeCaptcha() {
  fireEvent.click(screen.getByTestId('mock-turnstile-success'))
}

function fillOtp(code: string) {
  fireEvent.paste(screen.getByTestId('otp'), { clipboardData: { getData: () => code } })
}

async function advanceToPasswordStep() {
  render(<SignupWizardCard {...BASE_PROPS} />)
  mockStart.mockResolvedValue({ ok: true })
  fireEvent.change(screen.getByLabelText('email'), { target: { value: 'alice@example.com' } })
  completeCaptcha()
  fireEvent.click(screen.getByRole('button', { name: 'continue' }))
  await screen.findByTestId('otp')
  mockVerify.mockResolvedValue({ ok: true })
  fillOtp('123456')
  await screen.findByLabelText('password')
}

describe('SignupWizardCard', () => {
  it('shows the default welcome title/subtitle on the email step', () => {
    render(<SignupWizardCard {...BASE_PROPS} />)
    expect(screen.getByText('title')).toBeInTheDocument()
    expect(screen.getByText('subtitleDefaultOrg')).toBeInTheDocument()
  })

  it('shows the app-branded title when appName is set and the org is not shared', () => {
    render(<SignupWizardCard {...BASE_PROPS} hasDefaultOrg={false} appName="Acme" />)
    expect(screen.getByText('titleWithApp {"appName":"Acme"}')).toBeInTheDocument()
    expect(screen.getByText('subtitle')).toBeInTheDocument()
  })

  it('shows the verify-code title/subtitle on the code step', async () => {
    render(<SignupWizardCard {...BASE_PROPS} />)
    mockStart.mockResolvedValue({ ok: true })
    fireEvent.change(screen.getByLabelText('email'), { target: { value: 'alice@example.com' } })
    completeCaptcha()
    fireEvent.click(screen.getByRole('button', { name: 'continue' }))

    await screen.findByTestId('otp')
    expect(await screen.findByText('verifyCode.title')).toBeInTheDocument()
    expect(screen.getByText('verifyCode.headerSubtitle')).toBeInTheDocument()
  })

  it('shows the "set your password" title/subtitle on the password step', async () => {
    await advanceToPasswordStep()
    // The card's own `step` state updates via the child's onStepChange
    // effect, which flushes a tick after the password field itself appears
    // — wait for the title rather than asserting synchronously.
    expect(await screen.findByText('setPassword.title')).toBeInTheDocument()
    expect(screen.getByText('setPassword.subtitle')).toBeInTheDocument()
  })

  it('shows the "how should we call you" title/subtitle on the name step', async () => {
    await advanceToPasswordStep()
    fireEvent.change(screen.getByLabelText('password'), { target: { value: 'StrongPass123' } })
    fireEvent.change(screen.getByLabelText('confirmPassword'), { target: { value: 'StrongPass123' } })
    fireEvent.click(screen.getByRole('button', { name: 'continue' }))

    await screen.findByLabelText('firstName')
    expect(await screen.findByText('setName.title')).toBeInTheDocument()
    expect(screen.getByText('setName.subtitle')).toBeInTheDocument()
  })
})
