import { render, screen } from '@testing-library/react'
import { ForgotPasswordForm } from '../forgot-password-form'

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

jest.mock('react', () => {
  const actualReact = jest.requireActual('react')
  return {
    ...actualReact,
    useActionState: (
      fn: (prev: unknown, formData: FormData) => Promise<unknown>,
      initialState: unknown,
    ) => [initialState, fn, false],
  }
})

jest.mock('../actions', () => ({
  requestPasswordResetAction: jest.fn(),
}))

describe('ForgotPasswordForm', () => {
  it('renders title, email input, and submit button', () => {
    render(<ForgotPasswordForm />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('title')
    expect(screen.getByLabelText('email')).toBeInTheDocument()
    const submitBtn = screen.getByRole('button', { name: 'submit' })
    expect(submitBtn).toBeInTheDocument()
    expect(submitBtn).not.toHaveAttribute('aria-busy', 'true')
  })
})
