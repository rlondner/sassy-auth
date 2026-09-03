import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import messages from '@/messages/en.json'
import { LoginForm } from '../login-form'
import { LoginOtpForm } from '../login-otp-form'
import { TwoFactorForm } from '../two-factor/TwoFactorForm'
import { signIn, requestOtp, verifyOtp, verifyTotp, verifyBackupCode } from '../actions'

const mockPush = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))
jest.mock('../actions', () => ({
  signIn: jest.fn(),
  requestOtp: jest.fn(),
  verifyOtp: jest.fn(),
  verifyTotp: jest.fn(),
  verifyBackupCode: jest.fn(),
}))
// SocialButtons has its own spec and pulls in the provider list; it is not
// what these cases are about.
jest.mock('../social-buttons', () => ({ SocialButtons: () => null }))

const mockSignIn = signIn as jest.MockedFunction<any>
const mockRequestOtp = requestOtp as jest.MockedFunction<any>
const mockVerifyOtp = verifyOtp as jest.MockedFunction<any>
const mockVerifyTotp = verifyTotp as jest.MockedFunction<any>
const mockVerifyBackup = verifyBackupCode as jest.MockedFunction<any>

function wrap(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  )
}

/** Submit the form owning a named field, bypassing jsdom constraint validation. */
function submitForm(fieldName: string, values: Record<string, string> = {}) {
  const field = document.querySelector(
    `input[name="${fieldName}"]`,
  ) as HTMLInputElement
  expect(field).not.toBeNull()
  Object.entries(values).forEach(([name, value]) => {
    const el = document.querySelector(`input[name="${name}"]`) as HTMLInputElement
    if (el) fireEvent.change(el, { target: { value } })
  })
  fireEvent.submit(field.closest('form')!)
}

beforeEach(() => {
  jest.clearAllMocks()
  mockSignIn.mockResolvedValue({})
  mockRequestOtp.mockResolvedValue({ sent: true })
  mockVerifyOtp.mockResolvedValue({})
  mockVerifyTotp.mockResolvedValue({})
  mockVerifyBackup.mockResolvedValue({})
})

describe('LoginForm', () => {
  it('submits the credentials through signIn', async () => {
    wrap(<LoginForm next="" authServerUrl="https://auth.test" />)

    submitForm('email', { email: 'a@b.io', password: 'pw' })

    await waitFor(() => expect(mockSignIn).toHaveBeenCalled())
    const fd = mockSignIn.mock.calls[0][0] as FormData
    expect(fd.get('email')).toBe('a@b.io')
    expect(fd.get('password')).toBe('pw')
  })

  it('forces the next value from props rather than trusting the hidden field', async () => {
    wrap(<LoginForm next="/orgs" authServerUrl="https://auth.test" />)

    const hidden = document.querySelector(
      'input[name="next"]',
    ) as HTMLInputElement
    fireEvent.change(hidden, { target: { value: '/tampered' } })
    submitForm('email', { email: 'a@b.io', password: 'pw' })

    await waitFor(() => expect(mockSignIn).toHaveBeenCalled())
    expect((mockSignIn.mock.calls[0][0] as FormData).get('next')).toBe('/orgs')
  })

  it.each([
    ['invalidCredentials', messages.login.error.invalidCredentials],
    ['inactive', messages.login.error.inactive],
    ['serverUnavailable', messages.login.error.serverUnavailable],
    ['tooManyRequests', messages.login.error.tooManyRequests],
  ])('renders the translated message for %s', async (code, text) => {
    mockSignIn.mockResolvedValue({ error: code })
    wrap(<LoginForm next="" authServerUrl="https://auth.test" />)

    submitForm('email', { email: 'a@b.io', password: 'pw' })

    await waitFor(() =>
      expect(screen.getByTestId('login-error')).toHaveTextContent(text),
    )
  })

  // signIn returns a raw English sentence when a field is missing, rather than
  // a key. The allowlist above does not match it, so it falls through and is
  // rendered verbatim — untranslated for a non-English operator.
  it('renders an unrecognised error string verbatim', async () => {
    mockSignIn.mockResolvedValue({ error: 'Email and password are required.' })
    wrap(<LoginForm next="" authServerUrl="https://auth.test" />)

    submitForm('email', { email: 'a@b.io', password: 'pw' })

    await waitFor(() =>
      expect(screen.getByTestId('login-error')).toHaveTextContent(
        'Email and password are required.',
      ),
    )
  })

  it('routes to the two-factor challenge when one is raised, carrying next', async () => {
    mockSignIn.mockResolvedValue({ twoFactor: true })
    wrap(<LoginForm next="/orgs" authServerUrl="https://auth.test" />)

    submitForm('email', { email: 'a@b.io', password: 'pw' })

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith('/login/two-factor?next=%2Forgs'),
    )
  })

  it('does not show an error before anything is submitted', () => {
    wrap(<LoginForm next="" authServerUrl="https://auth.test" />)

    expect(screen.queryByTestId('login-error')).not.toBeInTheDocument()
  })

  it('shows a signup link when next carries a client_id', () => {
    wrap(<LoginForm next="/api/token/oauth/authorize?client_id=sq_1&redirect_uri=x" authServerUrl="https://auth.test" />)

    const link = screen.getByText(messages.login.signupLink).closest('a')
    expect(link).toHaveAttribute(
      'href',
      '/signup?client_id=sq_1&next=%2Fapi%2Ftoken%2Foauth%2Fauthorize%3Fclient_id%3Dsq_1%26redirect_uri%3Dx',
    )
  })

  it('hides the signup link when next has no client_id', () => {
    wrap(<LoginForm next="/orgs" authServerUrl="https://auth.test" />)

    expect(screen.queryByText(messages.login.signupLink)).not.toBeInTheDocument()
  })

  it('hides the signup link when there is no next at all', () => {
    wrap(<LoginForm next="" authServerUrl="https://auth.test" />)

    expect(screen.queryByText(messages.login.signupLink)).not.toBeInTheDocument()
  })
})

describe('LoginOtpForm', () => {
  it('requests a code and advances to the code step', async () => {
    wrap(<LoginOtpForm next="" />)

    submitForm('email', { email: 'a@b.io' })

    await waitFor(() => expect(screen.getByTestId('otp-sent')).toBeInTheDocument())
    expect(mockRequestOtp).toHaveBeenCalled()
  })

  it('surfaces a request error and stays on the email step', async () => {
    mockRequestOtp.mockResolvedValue({ error: 'serverUnavailable' })
    wrap(<LoginOtpForm next="" />)

    submitForm('email', { email: 'a@b.io' })

    await waitFor(() =>
      expect(screen.getByTestId('otp-error')).toHaveTextContent(
        messages.login.error.serverUnavailable,
      ),
    )
    expect(screen.queryByTestId('otp-sent')).not.toBeInTheDocument()
  })

  it('submits the code with the email carried forward', async () => {
    wrap(<LoginOtpForm next="" />)

    submitForm('email', { email: 'a@b.io' })
    await waitFor(() => expect(screen.getByTestId('otp-sent')).toBeInTheDocument())

    submitForm('otp', { otp: '123456' })

    await waitFor(() => expect(mockVerifyOtp).toHaveBeenCalled())
    const fd = mockVerifyOtp.mock.calls[0][0] as FormData
    expect(fd.get('otp')).toBe('123456')
    expect(fd.get('email')).toBe('a@b.io')
  })

  it.each([
    ['invalidCode', messages.login.error.invalidCode],
    ['inactive', messages.login.error.inactive],
    ['tooManyRequests', messages.login.error.tooManyRequests],
  ])('renders the translated verify error for %s', async (code, text) => {
    mockVerifyOtp.mockResolvedValue({ error: code })
    wrap(<LoginOtpForm next="" />)

    submitForm('email', { email: 'a@b.io' })
    await waitFor(() => expect(screen.getByTestId('otp-sent')).toBeInTheDocument())
    submitForm('otp', { otp: '000000' })

    await waitFor(() =>
      expect(screen.getByTestId('otp-error')).toHaveTextContent(text),
    )
  })
})

describe('TwoFactorForm', () => {
  it('defaults the trust-device box to checked and submits trustDevice=true', async () => {
    wrap(<TwoFactorForm next="/orgs" trustDays={14} />)

    expect(screen.getByRole('checkbox')).toBeChecked()
    submitForm('code', { code: '123456' })

    await waitFor(() => expect(mockVerifyTotp).toHaveBeenCalled())
    const fd = mockVerifyTotp.mock.calls[0][0] as FormData
    expect(fd.get('code')).toBe('123456')
    expect(fd.get('next')).toBe('/orgs')
    expect(fd.get('trustDevice')).toBe('true')
  })

  it('sends trustDevice=false once the pre-checked box is unticked', async () => {
    wrap(<TwoFactorForm next="" trustDays={14} />)

    fireEvent.click(screen.getByRole('checkbox'))
    submitForm('code', { code: '123456' })

    await waitFor(() => expect(mockVerifyTotp).toHaveBeenCalled())
    expect((mockVerifyTotp.mock.calls[0][0] as FormData).get('trustDevice')).toBe(
      'false',
    )
  })

  it.each([
    ['invalidCode', messages.twoFactor.error.invalidCode],
    ['serverUnavailable', messages.twoFactor.error.serverUnavailable],
    ['tooManyRequests', messages.twoFactor.error.tooManyRequests],
  ])('renders the translated TOTP error for %s', async (code, text) => {
    mockVerifyTotp.mockResolvedValue({ error: code })
    wrap(<TwoFactorForm next="" trustDays={14} />)

    submitForm('code', { code: '000000' })

    await waitFor(() =>
      expect(screen.getByTestId('totp-error')).toHaveTextContent(text),
    )
  })

  it('switches to the backup-code mode and submits through the other action', async () => {
    wrap(<TwoFactorForm next="" trustDays={14} />)

    fireEvent.click(
      screen.getByRole('button', { name: messages.twoFactor.useBackupCode }),
    )
    submitForm('code', { code: 'aaaa-1111' })

    await waitFor(() => expect(mockVerifyBackup).toHaveBeenCalled())
    expect(mockVerifyTotp).not.toHaveBeenCalled()
  })

  // Toggling modes must not leave the previous mode's failure on screen, or a
  // user who switches after a bad TOTP sees a stale error against a fresh form.
  it('does not show the TOTP error after switching to backup mode', async () => {
    mockVerifyTotp.mockResolvedValue({ error: 'invalidCode' })
    wrap(<TwoFactorForm next="" trustDays={14} />)

    submitForm('code', { code: '000000' })
    await waitFor(() => expect(screen.getByTestId('totp-error')).toBeInTheDocument())

    fireEvent.click(
      screen.getByRole('button', { name: messages.twoFactor.useBackupCode }),
    )

    expect(screen.queryByTestId('totp-error')).not.toBeInTheDocument()
  })
})
