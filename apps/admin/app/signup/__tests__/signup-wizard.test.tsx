import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SignupWizard } from '../signup-wizard'
import { startRegistrationAction, verifyRegistrationCodeAction, completeRegistrationAction } from '../wizard-actions'

// This codebase's established convention for these specs (see
// verify-code-card.test.tsx and check-email-card.test.tsx) is to mock
// next-intl's useTranslations to ignore the namespace argument and return the
// key itself (with an interpolated-values suffix when present), since the
// real component scopes its translator with useTranslations('signup') (and
// useTranslations('common') for shared strings) to match the actual nested
// messages/en.json structure. A real NextIntlClientProvider would render the
// actual English copy instead of the key, which the assertions below rely on.
jest.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
}))

const mockPush = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }))

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
const mockComplete = completeRegistrationAction as jest.MockedFunction<typeof completeRegistrationAction>

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
}

beforeEach(() => {
  jest.clearAllMocks()
})

function completeCaptcha() {
  fireEvent.click(screen.getByTestId('mock-turnstile-success'))
}

async function advanceToPasswordStep() {
  render(<SignupWizard {...BASE_PROPS} />)
  mockStart.mockResolvedValue({ ok: true })
  fireEvent.change(screen.getByLabelText('email'), { target: { value: 'alice@example.com' } })
  completeCaptcha()
  fireEvent.click(screen.getByRole('button', { name: 'continue' }))
  await screen.findByTestId('otp')
  mockVerify.mockResolvedValue({ ok: true })
  fireEvent.change(screen.getByTestId('otp'), { target: { value: '123456' } })
  fireEvent.click(screen.getByRole('button', { name: 'verifyCode.submit' }))
  await screen.findByLabelText('password')
}

describe('SignupWizard', () => {
  it('starts on the email step with a captcha widget, and advances to the code step on success', async () => {
    render(<SignupWizard {...BASE_PROPS} />)
    expect(screen.getByLabelText('email')).toBeInTheDocument()
    expect(screen.getByTestId('mock-turnstile-success')).toBeInTheDocument()

    mockStart.mockResolvedValue({ ok: true })
    fireEvent.change(screen.getByLabelText('email'), { target: { value: 'alice@example.com' } })
    completeCaptcha()
    fireEvent.click(screen.getByRole('button', { name: 'continue' }))

    await screen.findByTestId('otp')
    expect(mockStart).toHaveBeenCalledWith({ clientId: 'sq_1', email: 'alice@example.com', turnstileToken: 'test-captcha-token' })
  })

  it('does not call startRegistrationAction if the captcha has not been completed', async () => {
    render(<SignupWizard {...BASE_PROPS} />)
    fireEvent.change(screen.getByLabelText('email'), { target: { value: 'alice@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'continue' }))

    expect(mockStart).not.toHaveBeenCalled()
    expect(await screen.findByTestId('signup-error')).toHaveTextContent('errors.captchaRequired')
  })

  it('shows an inline error and stays on the email step when start fails', async () => {
    render(<SignupWizard {...BASE_PROPS} />)
    mockStart.mockResolvedValue({ error: 'emailTaken' })
    fireEvent.change(screen.getByLabelText('email'), { target: { value: 'alice@example.com' } })
    completeCaptcha()
    fireEvent.click(screen.getByRole('button', { name: 'continue' }))

    expect(await screen.findByTestId('signup-error')).toHaveTextContent('errors.emailTaken')
    expect(screen.getByLabelText('email')).toBeInTheDocument()
  })

  it('shows an inline error and stays on the code step for an invalid code', async () => {
    render(<SignupWizard {...BASE_PROPS} />)
    mockStart.mockResolvedValue({ ok: true })
    fireEvent.change(screen.getByLabelText('email'), { target: { value: 'alice@example.com' } })
    completeCaptcha()
    fireEvent.click(screen.getByRole('button', { name: 'continue' }))
    await screen.findByTestId('otp')

    mockVerify.mockResolvedValue({ error: 'INVALID_OTP' })
    fireEvent.change(screen.getByTestId('otp'), { target: { value: '000000' } })
    fireEvent.click(screen.getByRole('button', { name: 'verifyCode.submit' }))

    expect(await screen.findByTestId('signup-error')).toHaveTextContent('verifyCode.errorInvalid')
    expect(screen.getByTestId('otp')).toBeInTheDocument()
  })

  it('advances through password and name steps and submits on the final step', async () => {
    await advanceToPasswordStep()

    fireEvent.change(screen.getByLabelText('password'), { target: { value: 'StrongPass123' } })
    fireEvent.change(screen.getByLabelText('confirmPassword'), { target: { value: 'StrongPass123' } })
    fireEvent.click(screen.getByRole('button', { name: 'continue' }))

    await screen.findByLabelText('firstName')
    mockComplete.mockResolvedValue({ ok: true })
    fireEvent.change(screen.getByLabelText('firstName'), { target: { value: 'Alice' } })
    fireEvent.change(screen.getByLabelText('lastName'), { target: { value: 'Wonder' } })
    fireEvent.click(screen.getByRole('button', { name: 'submit' }))

    await waitFor(() => expect(mockComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'sq_1',
        email: 'alice@example.com',
        otp: '123456',
        password: 'StrongPass123',
        firstName: 'Alice',
        lastName: 'Wonder',
        marketingOptIn: false,
      }),
    ))
    expect(mockPush).toHaveBeenCalledWith('/signup/verified')
  })

  it('redirects via window.location when complete returns a redirectUrl', async () => {
    const original = window.location
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).location
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    window.location = { ...original, href: '' } as any

    await advanceToPasswordStep()
    fireEvent.change(screen.getByLabelText('password'), { target: { value: 'StrongPass123' } })
    fireEvent.change(screen.getByLabelText('confirmPassword'), { target: { value: 'StrongPass123' } })
    fireEvent.click(screen.getByRole('button', { name: 'continue' }))
    await screen.findByLabelText('firstName')
    mockComplete.mockResolvedValue({ ok: true, redirectUrl: 'https://app.example.com/callback?code=abc' })
    fireEvent.change(screen.getByLabelText('firstName'), { target: { value: 'Alice' } })
    fireEvent.change(screen.getByLabelText('lastName'), { target: { value: 'Wonder' } })
    fireEvent.click(screen.getByRole('button', { name: 'submit' }))

    await waitFor(() => expect(window.location.href).toBe('https://app.example.com/callback?code=abc'))
    window.location = original
  })

  it('bounces back to the code step on an expired code at final submit, keeping password and name', async () => {
    await advanceToPasswordStep()
    fireEvent.change(screen.getByLabelText('password'), { target: { value: 'StrongPass123' } })
    fireEvent.change(screen.getByLabelText('confirmPassword'), { target: { value: 'StrongPass123' } })
    fireEvent.click(screen.getByRole('button', { name: 'continue' }))
    await screen.findByLabelText('firstName')
    fireEvent.change(screen.getByLabelText('firstName'), { target: { value: 'Alice' } })
    fireEvent.change(screen.getByLabelText('lastName'), { target: { value: 'Wonder' } })

    mockComplete.mockResolvedValue({ error: 'OTP_EXPIRED' })
    mockStart.mockResolvedValue({ ok: true })
    fireEvent.click(screen.getByRole('button', { name: 'submit' }))

    await screen.findByTestId('otp')
    expect(screen.getByTestId('signup-error')).toHaveTextContent('verifyCode.errorExpired')

    // Go forward again with a fresh code — password/name must still be there.
    mockVerify.mockResolvedValue({ ok: true })
    fireEvent.change(screen.getByTestId('otp'), { target: { value: '654321' } })
    fireEvent.click(screen.getByRole('button', { name: 'verifyCode.submit' }))
    await screen.findByLabelText('password')
    expect(screen.getByLabelText('password')).toHaveValue('StrongPass123')
    fireEvent.click(screen.getByRole('button', { name: 'continue' }))
    await screen.findByLabelText('firstName')
    expect(screen.getByLabelText('firstName')).toHaveValue('Alice')
  })

  it('sends the user back to the email step to re-verify when the expired-code resend itself fails (stale captcha token)', async () => {
    await advanceToPasswordStep()
    fireEvent.change(screen.getByLabelText('password'), { target: { value: 'StrongPass123' } })
    fireEvent.change(screen.getByLabelText('confirmPassword'), { target: { value: 'StrongPass123' } })
    fireEvent.click(screen.getByRole('button', { name: 'continue' }))
    await screen.findByLabelText('firstName')
    fireEvent.change(screen.getByLabelText('firstName'), { target: { value: 'Alice' } })
    fireEvent.change(screen.getByLabelText('lastName'), { target: { value: 'Wonder' } })

    // The captcha token captured on the email step was already consumed by
    // the original startRegistrationAction call, so reusing it for the
    // resend fails — no new code is actually sent.
    mockComplete.mockResolvedValue({ error: 'OTP_EXPIRED' })
    mockStart.mockResolvedValue({ error: 'captchaFailed' })
    fireEvent.click(screen.getByRole('button', { name: 'submit' }))

    await screen.findByLabelText('email')
    expect(screen.getByTestId('signup-error')).toHaveTextContent('errors.captchaRequired')
    expect(screen.getByLabelText('email')).toHaveValue('alice@example.com')
    expect(screen.getByTestId('mock-turnstile-success')).toBeInTheDocument()
  })
})
