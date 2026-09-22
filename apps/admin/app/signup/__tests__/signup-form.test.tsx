import type { ReactNode } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SignupForm } from '../signup-form'

// This codebase's convention for these lightweight form-component specs (see
// accept-invite-form.test.tsx) is to mock next-intl's useTranslations to
// return the dotted key itself, since the component calls the namespace-less
// t('signup.xxx') form. A real NextIntlClientProvider would render the
// actual English copy instead of the key, which the assertions below rely on.
//
// t.rich (used for the consent checkbox labels, which embed a link around
// part of the copy) can't be expressed by the plain `(key) => key` form, so
// it gets its own implementation below that renders the real English copy
// with the <link> placeholder substituted for the caller's chunk renderer —
// the consent tests assert on the actual label text (e.g. /Privacy Policy/i).
const RICH_STRINGS: Record<string, string> = {
  'signup.acceptPrivacyPolicy': 'I have read and accept the <link>Privacy Policy</link>',
  'signup.acceptTerms': 'I have read and accept the <link>Terms and Conditions</link>',
  'signup.acceptGdpr': 'I have read and accept the <link>GDPR Disclosure</link>',
}

jest.mock('next-intl', () => {
  const t = (key: string) => key
  t.rich = (key: string, values: { link: (chunks: string) => ReactNode }) => {
    const template = RICH_STRINGS[key] ?? key
    const match = template.match(/^(.*)<link>(.*)<\/link>(.*)$/)
    if (!match) return template
    const [, before, linkText, after] = match
    return (
      <>
        {before}
        {values.link(linkText)}
        {after}
      </>
    )
  }
  return { useTranslations: () => t }
})

const mockPush = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
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

const POLICY = {
  minLength: 12,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  requireSpecial: false,
  minNumbers: 1,
  minSpecial: 0,
}

// The submit button is now disabled whenever the live policy check fails or
// the passwords don't match, so a plain button click can't reach
// handleSubmit's own checks in those cases. Submit the form directly to
// exercise those checks, matching the established convention in
// reset-password-form.test.tsx.
function submitForm() {
  fireEvent.submit(screen.getByText('signup.submit').closest('form')!)
}

function fillValidFormWithoutCompanyName() {
  fireEvent.change(screen.getByLabelText('signup.firstName'), { target: { value: 'Alice' } })
  fireEvent.change(screen.getByLabelText('signup.lastName'), { target: { value: 'Wonder' } })
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
    render(<SignupForm clientId="sq_1" next="" hasDefaultOrg={false} passwordPolicy={POLICY} privacyPolicyUrl={null} termsUrl={null} gdprUrl={null} />)
    expect(screen.getByLabelText('signup.firstName')).toBeInTheDocument()
    expect(screen.getByLabelText('signup.lastName')).toBeInTheDocument()
    expect(screen.getByLabelText('signup.companyName')).toBeInTheDocument()
    expect(screen.getByLabelText('signup.email')).toBeInTheDocument()
    expect(screen.getByLabelText('signup.password')).toBeInTheDocument()
    expect(screen.getByLabelText('signup.confirmPassword')).toBeInTheDocument()
  })

  it('shows an error when passwords do not match, without submitting', async () => {
    render(<SignupForm clientId="sq_1" next="" hasDefaultOrg={false} passwordPolicy={POLICY} privacyPolicyUrl={null} termsUrl={null} gdprUrl={null} />)
    fillValidForm()
    fireEvent.change(screen.getByLabelText('signup.confirmPassword'), { target: { value: 'Different1!' } })
    // The mismatch also disables the submit button, so submit the form
    // directly to exercise handleSubmit's own mismatch check.
    submitForm()

    await waitFor(() =>
      expect(screen.getByTestId('signup-error')).toHaveTextContent('signup.errors.passwordMismatch'),
    )
    expect(mockRegisterAction).not.toHaveBeenCalled()
  })

  it('disables the submit button for a password under 12 characters', () => {
    render(<SignupForm clientId="sq_1" next="" hasDefaultOrg={false} passwordPolicy={POLICY} privacyPolicyUrl={null} termsUrl={null} gdprUrl={null} />)
    fillValidForm()
    fireEvent.change(screen.getByLabelText('signup.password'), { target: { value: 'Short1!' } })
    fireEvent.change(screen.getByLabelText('signup.confirmPassword'), { target: { value: 'Short1!' } })

    expect(screen.getByText('signup.submit').closest('button')).toBeDisabled()
    expect(mockRegisterAction).not.toHaveBeenCalled()
  })

  it('shows an error for a password missing complexity when the form is submitted directly', async () => {
    render(<SignupForm clientId="sq_1" next="" hasDefaultOrg={false} passwordPolicy={POLICY} privacyPolicyUrl={null} termsUrl={null} gdprUrl={null} />)
    fillValidForm()
    fireEvent.change(screen.getByLabelText('signup.password'), { target: { value: 'lowercaseonly1' } })
    fireEvent.change(screen.getByLabelText('signup.confirmPassword'), { target: { value: 'lowercaseonly1' } })
    expect(screen.getByText('signup.submit').closest('button')).toBeDisabled()
    submitForm()

    await waitFor(() =>
      expect(screen.getByTestId('signup-error')).toHaveTextContent('signup.errors.passwordComplexity'),
    )
    expect(mockRegisterAction).not.toHaveBeenCalled()
  })

  it('disables the submit button for a weak password and enables it for a strong matching one', () => {
    render(<SignupForm clientId="sq_1" next="" hasDefaultOrg={false} passwordPolicy={POLICY} privacyPolicyUrl={null} termsUrl={null} gdprUrl={null} />)
    fillValidForm()
    fireEvent.change(screen.getByLabelText('signup.password'), { target: { value: 'weakpassword' } })
    fireEvent.change(screen.getByLabelText('signup.confirmPassword'), { target: { value: 'weakpassword' } })
    expect(screen.getByText('signup.submit').closest('button')).toBeDisabled()

    fireEvent.change(screen.getByLabelText('signup.password'), { target: { value: 'SecurePass1!' } })
    fireEvent.change(screen.getByLabelText('signup.confirmPassword'), { target: { value: 'SecurePass1!' } })
    expect(screen.getByText('signup.submit').closest('button')).not.toBeDisabled()
  })

  it('calls registerAction with the mapped fields on valid submit', async () => {
    render(<SignupForm clientId="sq_1" next="" hasDefaultOrg={false} passwordPolicy={POLICY} privacyPolicyUrl={null} termsUrl={null} gdprUrl={null} />)
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
    render(<SignupForm clientId="sq_1" next="" hasDefaultOrg={false} passwordPolicy={POLICY} privacyPolicyUrl={null} termsUrl={null} gdprUrl={null} />)
    fillValidForm()
    completeCaptcha()
    fireEvent.click(screen.getByText('signup.submit'))

    await waitFor(() =>
      expect(screen.getByTestId('signup-error')).toHaveTextContent('signup.errors.emailTaken'),
    )
  })

  it('shows an error and clears the loading state when registerAction rejects', async () => {
    mockRegisterAction.mockRejectedValue(new Error('boom'))
    render(<SignupForm clientId="sq_1" next="" hasDefaultOrg={false} passwordPolicy={POLICY} privacyPolicyUrl={null} termsUrl={null} gdprUrl={null} />)
    fillValidForm()
    completeCaptcha()
    fireEvent.click(screen.getByText('signup.submit'))

    await waitFor(() =>
      expect(screen.getByTestId('signup-error')).toHaveTextContent('signup.errors.validationError'),
    )
    expect(screen.getByText('signup.submit').closest('button')).not.toBeDisabled()
  })

  it('navigates to /signup/check-email with the submitted address after a successful submit', async () => {
    render(<SignupForm clientId="sq_1" next="" hasDefaultOrg={false} passwordPolicy={POLICY} privacyPolicyUrl={null} termsUrl={null} gdprUrl={null} />)
    fillValidForm()
    completeCaptcha()
    fireEvent.click(screen.getByText('signup.submit'))

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith('/signup/check-email?email=alice%40example.com'),
    )
  })

  it('carries next forward into the check-email redirect', async () => {
    render(<SignupForm clientId="sq_1" next="/orgs" hasDefaultOrg={false} passwordPolicy={POLICY} privacyPolicyUrl={null} termsUrl={null} gdprUrl={null} />)
    fillValidForm()
    completeCaptcha()
    fireEvent.click(screen.getByText('signup.submit'))

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith(
        '/signup/check-email?email=alice%40example.com&next=%2Forgs',
      ),
    )
  })

  it('hides the Company name field when hasDefaultOrg is true, and omits it from the submit payload', async () => {
    render(<SignupForm clientId="sq_1" next="" hasDefaultOrg passwordPolicy={POLICY} privacyPolicyUrl={null} termsUrl={null} gdprUrl={null} />)
    expect(screen.queryByLabelText('signup.companyName')).not.toBeInTheDocument()

    fillValidFormWithoutCompanyName()
    completeCaptcha()
    fireEvent.click(screen.getByText('signup.submit'))

    await waitFor(() =>
      expect(mockRegisterAction).toHaveBeenCalledWith({
        clientId: 'sq_1',
        firstName: 'Alice',
        lastName: 'Wonder',
        email: 'alice@example.com',
        password: 'SecurePass1!',
        turnstileToken: 'test-captcha-token',
      }),
    )
    const payload = mockRegisterAction.mock.calls[0][0]
    expect(payload).not.toHaveProperty('companyName')
  })

  it('shows the Company name field when hasDefaultOrg is false', () => {
    render(<SignupForm clientId="sq_1" next="" hasDefaultOrg={false} passwordPolicy={POLICY} privacyPolicyUrl={null} termsUrl={null} gdprUrl={null} />)
    expect(screen.getByLabelText('signup.companyName')).toBeInTheDocument()
  })

  it('shows a captchaRequired error and does not submit when the captcha has not been completed', async () => {
    render(<SignupForm clientId="sq_1" next="" hasDefaultOrg={false} passwordPolicy={POLICY} privacyPolicyUrl={null} termsUrl={null} gdprUrl={null} />)
    fillValidForm()
    fireEvent.click(screen.getByText('signup.submit'))

    await waitFor(() =>
      expect(screen.getByTestId('signup-error')).toHaveTextContent('signup.errors.captchaRequired'),
    )
    expect(mockRegisterAction).not.toHaveBeenCalled()
  })

  it('renders a checkbox for each configured document and requires it before submit is enabled', () => {
    render(
      <SignupForm
        clientId="sq_1"
        next=""
        hasDefaultOrg
        passwordPolicy={null}
        privacyPolicyUrl="https://x.example.com/privacy"
        termsUrl="https://x.example.com/terms"
        gdprUrl={null}
      />,
    )
    expect(screen.getByRole('checkbox', { name: /Privacy Policy/i })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /Terms and Conditions/i })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: /GDPR/i })).not.toBeInTheDocument()
  })

  it('disables submit until the rendered consent checkbox is checked, and passes only the accepted flag for the checkbox that was actually rendered', async () => {
    // This codebase does not have @testing-library/user-event installed
    // (checked package.json and every other test file); every other test in
    // this file drives the form with fireEvent, so this test follows the same
    // convention rather than the brief's userEvent snippet.
    render(
      <SignupForm
        clientId="sq_1"
        next=""
        hasDefaultOrg
        passwordPolicy={null}
        privacyPolicyUrl="https://x.example.com/privacy"
        termsUrl={null}
        gdprUrl={null}
      />,
    )
    fillValidFormWithoutCompanyName()
    completeCaptcha()
    expect(screen.getByText('signup.submit').closest('button')).toBeDisabled()

    fireEvent.click(screen.getByRole('checkbox', { name: /Privacy Policy/i }))
    expect(screen.getByText('signup.submit').closest('button')).not.toBeDisabled()

    fireEvent.click(screen.getByText('signup.submit'))

    await waitFor(() =>
      expect(mockRegisterAction).toHaveBeenCalledWith({
        clientId: 'sq_1',
        firstName: 'Alice',
        lastName: 'Wonder',
        email: 'alice@example.com',
        password: 'SecurePass1!',
        turnstileToken: 'test-captcha-token',
        acceptedPrivacyPolicy: true,
      }),
    )
    const payload = mockRegisterAction.mock.calls[0][0]
    expect(payload).not.toHaveProperty('acceptedTerms')
    expect(payload).not.toHaveProperty('acceptedGdpr')
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
      render(<SignupForm clientId="sq_1" next="" hasDefaultOrg={false} passwordPolicy={POLICY} privacyPolicyUrl={null} termsUrl={null} gdprUrl={null} />)

      expect(warnSpy).toHaveBeenCalledTimes(1)
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('NEXT_PUBLIC_TURNSTILE_SITE_KEY'),
      )
    })

    it('does not warn when the site key is set', () => {
      process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = 'test-site-key'
      render(<SignupForm clientId="sq_1" next="" hasDefaultOrg={false} passwordPolicy={POLICY} privacyPolicyUrl={null} termsUrl={null} gdprUrl={null} />)

      expect(warnSpy).not.toHaveBeenCalled()
    })
  })
})
