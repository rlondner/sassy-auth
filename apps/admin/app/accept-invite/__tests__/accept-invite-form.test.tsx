import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AcceptInviteForm } from '../accept-invite-form'

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) => {
    if (params) return `${key}(${JSON.stringify(params)})`
    return key
  },
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}))

jest.mock('@/lib/api-public', () => ({
  acceptInvitation: jest.fn().mockResolvedValue(undefined),
}))

const POLICY = {
  minLength: 12,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  requireSpecial: false,
  minNumbers: 1,
  minSpecial: 0,
}

// The submit button is disabled whenever the live policy check fails or the
// passwords don't match, so a plain button click can't reach handleSubmit's
// own checks in those cases. Submit the form directly to exercise those
// checks, matching the convention in reset-password-form.test.tsx.
function submitForm() {
  fireEvent.submit(screen.getByText('acceptInvite.submit').closest('form')!)
}

describe('AcceptInviteForm', () => {
  it('renders password fields', () => {
    render(
      <AcceptInviteForm token="test-token" firstName="Alice" email="alice@example.com" passwordPolicy={POLICY} />,
    )
    expect(screen.getByLabelText('acceptInvite.password')).toBeInTheDocument()
    expect(screen.getByLabelText('acceptInvite.confirmPassword')).toBeInTheDocument()
  })

  it('shows error when passwords do not match', async () => {
    render(
      <AcceptInviteForm token="test-token" firstName="Alice" email="alice@example.com" passwordPolicy={POLICY} />,
    )
    fireEvent.change(screen.getByLabelText('acceptInvite.password'), { target: { value: 'SecurePass1!' } })
    fireEvent.change(screen.getByLabelText('acceptInvite.confirmPassword'), { target: { value: 'Different1!' } })
    submitForm()
    await waitFor(() =>
      expect(screen.getByText('acceptInvite.errors.passwordMismatch')).toBeInTheDocument(),
    )
  })

  it('calls acceptInvitation on valid submit', async () => {
    const { acceptInvitation } = require('@/lib/api-public')
    render(
      <AcceptInviteForm token="test-token" firstName="Alice" email="alice@example.com" passwordPolicy={POLICY} />,
    )
    fireEvent.change(screen.getByLabelText('acceptInvite.password'), { target: { value: 'SecurePass1!' } })
    fireEvent.change(screen.getByLabelText('acceptInvite.confirmPassword'), { target: { value: 'SecurePass1!' } })
    fireEvent.click(screen.getByText('acceptInvite.submit'))
    await waitFor(() => expect(acceptInvitation).toHaveBeenCalledWith('test-token', 'SecurePass1!'))
  })

  it('disables the submit button for a weak password and enables it for a strong matching one', () => {
    render(
      <AcceptInviteForm token="test-token" firstName="Alice" email="alice@example.com" passwordPolicy={POLICY} />,
    )
    fireEvent.change(screen.getByLabelText('acceptInvite.password'), { target: { value: 'weakpassword' } })
    fireEvent.change(screen.getByLabelText('acceptInvite.confirmPassword'), { target: { value: 'weakpassword' } })
    expect(screen.getByText('acceptInvite.submit').closest('button')).toBeDisabled()

    fireEvent.change(screen.getByLabelText('acceptInvite.password'), { target: { value: 'SecurePass1!' } })
    fireEvent.change(screen.getByLabelText('acceptInvite.confirmPassword'), { target: { value: 'SecurePass1!' } })
    expect(screen.getByText('acceptInvite.submit').closest('button')).not.toBeDisabled()
  })
})
