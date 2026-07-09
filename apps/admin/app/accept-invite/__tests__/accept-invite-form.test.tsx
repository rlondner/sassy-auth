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

describe('AcceptInviteForm', () => {
  it('renders password fields', () => {
    render(<AcceptInviteForm token="test-token" firstName="Alice" email="alice@example.com" />)
    expect(screen.getByLabelText('acceptInvite.password')).toBeInTheDocument()
    expect(screen.getByLabelText('acceptInvite.confirmPassword')).toBeInTheDocument()
  })

  it('shows error when passwords do not match', async () => {
    render(<AcceptInviteForm token="test-token" firstName="Alice" email="alice@example.com" />)
    fireEvent.change(screen.getByLabelText('acceptInvite.password'), { target: { value: 'password1' } })
    fireEvent.change(screen.getByLabelText('acceptInvite.confirmPassword'), { target: { value: 'password2' } })
    fireEvent.click(screen.getByText('acceptInvite.submit'))
    await waitFor(() =>
      expect(screen.getByText('acceptInvite.errors.passwordMismatch')).toBeInTheDocument(),
    )
  })

  it('calls acceptInvitation on valid submit', async () => {
    const { acceptInvitation } = require('@/lib/api-public')
    render(<AcceptInviteForm token="test-token" firstName="Alice" email="alice@example.com" />)
    fireEvent.change(screen.getByLabelText('acceptInvite.password'), { target: { value: 'SecurePass1!' } })
    fireEvent.change(screen.getByLabelText('acceptInvite.confirmPassword'), { target: { value: 'SecurePass1!' } })
    fireEvent.click(screen.getByText('acceptInvite.submit'))
    await waitFor(() => expect(acceptInvitation).toHaveBeenCalledWith('test-token', 'SecurePass1!'))
  })
})
