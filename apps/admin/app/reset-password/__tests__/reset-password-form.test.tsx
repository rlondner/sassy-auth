import * as React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ResetPasswordForm } from '../reset-password-form'
import { resetPasswordSubmitAction } from '../actions'

jest.mock('../actions', () => ({
  resetPasswordSubmitAction: jest.fn(),
}))

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

describe('ResetPasswordForm', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders correctly', () => {
    render(<ResetPasswordForm token="test-token" />)
    expect(screen.getByLabelText('password')).toBeInTheDocument()
    expect(screen.getByLabelText('confirmPassword')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'submit' })).toBeInTheDocument()
  })

  it('shows error if passwords do not match', async () => {
    render(<ResetPasswordForm token="test-token" />)
    fireEvent.change(screen.getByLabelText('password'), { target: { value: 'Short1!' } })
    fireEvent.change(screen.getByLabelText('confirmPassword'), { target: { value: 'Mismatch1!' } })
    fireEvent.click(screen.getByRole('button', { name: 'submit' }))

    await waitFor(() => {
      expect(screen.getByTestId('reset-error')).toHaveTextContent('mismatch')
    })
  })

  it('shows error if password is too short', async () => {
    render(<ResetPasswordForm token="test-token" />)
    fireEvent.change(screen.getByLabelText('password'), { target: { value: 'Short1!' } })
    fireEvent.change(screen.getByLabelText('confirmPassword'), { target: { value: 'Short1!' } })
    fireEvent.click(screen.getByRole('button', { name: 'submit' }))

    await waitFor(() => {
      expect(screen.getByTestId('reset-error')).toHaveTextContent('tooShort')
    })
  })

  it('shows error if password fails complexity requirements', async () => {
    render(<ResetPasswordForm token="test-token" />)
    fireEvent.change(screen.getByLabelText('password'), { target: { value: 'lowercaseonly123' } })
    fireEvent.change(screen.getByLabelText('confirmPassword'), { target: { value: 'lowercaseonly123' } })
    fireEvent.click(screen.getByRole('button', { name: 'submit' }))

    await waitFor(() => {
      expect(screen.getByTestId('reset-error')).toHaveTextContent('complexity')
    })
  })

  it('submits successfully and shows success message', async () => {
    ;(resetPasswordSubmitAction as jest.Mock).mockResolvedValue({ ok: true })

    render(<ResetPasswordForm token="test-token" />)
    fireEvent.change(screen.getByLabelText('password'), { target: { value: 'ValidPassword123' } })
    fireEvent.change(screen.getByLabelText('confirmPassword'), { target: { value: 'ValidPassword123' } })
    fireEvent.click(screen.getByRole('button', { name: 'submit' }))

    await waitFor(() => {
      expect(resetPasswordSubmitAction).toHaveBeenCalledWith('test-token', 'ValidPassword123')
      expect(screen.getByTestId('reset-success')).toHaveTextContent('success')
    })
  })

  it('shows error if submit action returns invalidToken', async () => {
    ;(resetPasswordSubmitAction as jest.Mock).mockResolvedValue({ error: 'invalidToken' })

    render(<ResetPasswordForm token="test-token" />)
    fireEvent.change(screen.getByLabelText('password'), { target: { value: 'ValidPassword123' } })
    fireEvent.change(screen.getByLabelText('confirmPassword'), { target: { value: 'ValidPassword123' } })
    fireEvent.click(screen.getByRole('button', { name: 'submit' }))

    await waitFor(() => {
      expect(screen.getByTestId('reset-error')).toHaveTextContent('invalidToken')
    })
  })
})
