import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SignupForm } from '../signup-form'

// This codebase's convention for these lightweight form-component specs (see
// accept-invite-form.test.tsx) is to mock next-intl's useTranslations to
// return the dotted key itself, since the component calls the namespace-less
// t('signup.xxx') form. A real NextIntlClientProvider would render the
// actual English copy instead of the key, which the assertions below rely on.
jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

jest.mock('@marsidev/react-turnstile', () => ({
  Turnstile: ({ onSuccess }: { onSuccess: (token: string) => void }) => (
    <button type="button" data-testid="mock-turnstile-success" onClick={() => onSuccess('test-captcha-token')}>
      Complete captcha
    </button>
  ),
}))

jest.mock('../actions', () => ({
  registerAction: jest.fn(),
}))

import { registerAction } from '../actions'
const mockRegisterAction = registerAction as jest.MockedFunction<any>

function fillValidForm() {
  fireEvent.change(screen.getByLabelText('signup.firstName'), { target: { value: 'Alice' } })
  fireEvent.change(screen.getByLabelText('signup.lastName'), { target: { value: 'Wonder' } })
  fireEvent.change(screen.getByLabelText('signup.companyName'), { target: { value: 'Acme Inc' } })
  fireEvent.change(screen.getByLabelText('signup.email'), { target: { value: 'alice@example.com' } })
  fireEvent.change(screen.getByLabelText('signup.password'), { target: { value: 'SecurePass1!' } })
  fireEvent.change(screen.getByLabelText('signup.confirmPassword'), { target: { value: 'SecurePass1!' } })
}

function completeCaptcha() {
  fireEvent.click(screen.getByTestId('mock-turnstile-success'))
}

beforeEach(() => {
  jest.clearAllMocks()
  mockRegisterAction.mockResolvedValue({ ok: true })
})

describe('SignupForm', () => {
  it('renders all fields', () => {
    render(<SignupForm clientId="sq_1" next="" />)
    expect(screen.getByLabelText('signup.firstName')).toBeInTheDocument()
    expect(screen.getByLabelText('signup.lastName')).toBeInTheDocument()
    expect(screen.getByLabelText('signup.companyName')).toBeInTheDocument()
    expect(screen.getByLabelText('signup.email')).toBeInTheDocument()
    expect(screen.getByLabelText('signup.password')).toBeInTheDocument()
    expect(screen.getByLabelText('signup.confirmPassword')).toBeInTheDocument()
  })

  it('shows an error when passwords do not match, without submitting', async () => {
    render(<SignupForm clientId="sq_1" next="" />)
    fillValidForm()
    fireEvent.change(screen.getByLabelText('signup.confirmPassword'), { target: { value: 'Different1!' } })
    fireEvent.click(screen.getByText('signup.submit'))

    await waitFor(() =>
      expect(screen.getByTestId('signup-error')).toHaveTextContent('signup.errors.passwordMismatch'),
    )
    expect(mockRegisterAction).not.toHaveBeenCalled()
  })

  it('shows an error for a password under 12 characters', async () => {
    render(<SignupForm clientId="sq_1" next="" />)
    fillValidForm()
    fireEvent.change(screen.getByLabelText('signup.password'), { target: { value: 'Short1!' } })
    fireEvent.change(screen.getByLabelText('signup.confirmPassword'), { target: { value: 'Short1!' } })
    fireEvent.click(screen.getByText('signup.submit'))

    await waitFor(() =>
      expect(screen.getByTestId('signup-error')).toHaveTextContent('signup.errors.passwordTooShort'),
    )
    expect(mockRegisterAction).not.toHaveBeenCalled()
  })

  it('shows an error for a password missing complexity', async () => {
    render(<SignupForm clientId="sq_1" next="" />)
    fillValidForm()
    fireEvent.change(screen.getByLabelText('signup.password'), { target: { value: 'lowercaseonly1' } })
    fireEvent.change(screen.getByLabelText('signup.confirmPassword'), { target: { value: 'lowercaseonly1' } })
    fireEvent.click(screen.getByText('signup.submit'))

    await waitFor(() =>
      expect(screen.getByTestId('signup-error')).toHaveTextContent('signup.errors.passwordComplexity'),
    )
    expect(mockRegisterAction).not.toHaveBeenCalled()
  })

  it('calls registerAction with the mapped fields on valid submit', async () => {
    render(<SignupForm clientId="sq_1" next="" />)
    fillValidForm()
    completeCaptcha()
    fireEvent.click(screen.getByText('signup.submit'))

    await waitFor(() =>
      expect(mockRegisterAction).toHaveBeenCalledWith({
        clientId: 'sq_1',
        firstName: 'Alice',
        lastName: 'Wonder',
        companyName: 'Acme Inc',
        email: 'alice@example.com',
        password: 'SecurePass1!',
        turnstileToken: 'test-captcha-token',
      }),
    )
  })

  it('shows a translated error returned by registerAction', async () => {
    mockRegisterAction.mockResolvedValue({ error: 'emailTaken' })
    render(<SignupForm clientId="sq_1" next="" />)
    fillValidForm()
    completeCaptcha()
    fireEvent.click(screen.getByText('signup.submit'))

    await waitFor(() =>
      expect(screen.getByTestId('signup-error')).toHaveTextContent('signup.errors.emailTaken'),
    )
  })

  it('shows an error and clears the loading state when registerAction rejects', async () => {
    mockRegisterAction.mockRejectedValue(new Error('boom'))
    render(<SignupForm clientId="sq_1" next="" />)
    fillValidForm()
    completeCaptcha()
    fireEvent.click(screen.getByText('signup.submit'))

    await waitFor(() =>
      expect(screen.getByTestId('signup-error')).toHaveTextContent('signup.errors.validationError'),
    )
    expect(screen.getByText('signup.submit').closest('button')).not.toBeDisabled()
  })

  it('shows the success state and a link to /login after a successful submit', async () => {
    render(<SignupForm clientId="sq_1" next="" />)
    fillValidForm()
    completeCaptcha()
    fireEvent.click(screen.getByText('signup.submit'))

    await waitFor(() => expect(screen.getByText('signup.success')).toBeInTheDocument())
    expect(screen.getByText('signup.continueToLogin').closest('a')).toHaveAttribute('href', '/login')
  })

  it('carries next forward into the post-signup login link', async () => {
    render(<SignupForm clientId="sq_1" next="/orgs" />)
    fillValidForm()
    completeCaptcha()
    fireEvent.click(screen.getByText('signup.submit'))

    await waitFor(() => expect(screen.getByText('signup.success')).toBeInTheDocument())
    expect(screen.getByText('signup.continueToLogin').closest('a')).toHaveAttribute(
      'href',
      '/login?next=%2Forgs',
    )
  })

  it('shows a captchaRequired error and does not submit when the captcha has not been completed', async () => {
    render(<SignupForm clientId="sq_1" next="" />)
    fillValidForm()
    fireEvent.click(screen.getByText('signup.submit'))

    await waitFor(() =>
      expect(screen.getByTestId('signup-error')).toHaveTextContent('signup.errors.captchaRequired'),
    )
    expect(mockRegisterAction).not.toHaveBeenCalled()
  })

  describe('missing NEXT_PUBLIC_TURNSTILE_SITE_KEY diagnostic', () => {
    const originalSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
    let warnSpy: jest.SpyInstance

    beforeEach(() => {
      warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    })

    afterEach(() => {
      warnSpy.mockRestore()
      if (originalSiteKey === undefined) {
        delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
      } else {
        process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = originalSiteKey
      }
    })

    it('warns once on mount when the site key is unset', () => {
      delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
      render(<SignupForm clientId="sq_1" next="" />)

      expect(warnSpy).toHaveBeenCalledTimes(1)
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('NEXT_PUBLIC_TURNSTILE_SITE_KEY'),
      )
    })

    it('does not warn when the site key is set', () => {
      process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = 'test-site-key'
      render(<SignupForm clientId="sq_1" next="" />)

      expect(warnSpy).not.toHaveBeenCalled()
    })
  })
})
