import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ResetPasswordForm } from '../reset-password-form'

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

jest.mock('../actions', () => ({
  resetPasswordSubmitAction: jest.fn(),
}))

describe('ResetPasswordForm', () => {
  it('renders password input fields and submit button', () => {
    render(<ResetPasswordForm token="valid-token" />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('title')
    expect(screen.getByLabelText('password')).toBeInTheDocument()
    expect(screen.getByLabelText('confirmPassword')).toBeInTheDocument()
    const submitBtn = screen.getByRole('button', { name: 'submit' })
    expect(submitBtn).toBeInTheDocument()
  })

  it('displays mismatch error when passwords do not match', async () => {
    render(<ResetPasswordForm token="valid-token" />)
    fireEvent.change(screen.getByLabelText('password'), { target: { value: 'ValidPass1234!' } })
    fireEvent.change(screen.getByLabelText('confirmPassword'), { target: { value: 'DifferentPass1234!' } })
    fireEvent.click(screen.getByRole('button', { name: 'submit' }))
    expect(await screen.findByTestId('reset-error')).toHaveTextContent('mismatch')
  })

  it('displays tooShort error when password is less than 12 chars', async () => {
    render(<ResetPasswordForm token="valid-token" />)
    fireEvent.change(screen.getByLabelText('password'), { target: { value: 'Short1!' } })
    fireEvent.change(screen.getByLabelText('confirmPassword'), { target: { value: 'Short1!' } })
    fireEvent.click(screen.getByRole('button', { name: 'submit' }))
    expect(await screen.findByTestId('reset-error')).toHaveTextContent('tooShort')
  })

  it('submits successfully when passwords match criteria', async () => {
    const { resetPasswordSubmitAction } = require('../actions')
    resetPasswordSubmitAction.mockResolvedValue({})

    render(<ResetPasswordForm token="valid-token" />)
    fireEvent.change(screen.getByLabelText('password'), { target: { value: 'ValidPassword123!' } })
    fireEvent.change(screen.getByLabelText('confirmPassword'), { target: { value: 'ValidPassword123!' } })
    fireEvent.click(screen.getByRole('button', { name: 'submit' }))

    await waitFor(() => {
      expect(screen.getByTestId('reset-success')).toHaveTextContent('success')
    })
  })
})
