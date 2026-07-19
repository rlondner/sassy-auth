import * as React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ForgotPasswordForm } from '../forgot-password-form'
import { requestPasswordResetAction } from '../actions'

jest.mock('../actions', () => ({
  requestPasswordResetAction: jest.fn(),
}))

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

jest.mock('react', () => {
  const originalReact = jest.requireActual('react')
  return {
    ...originalReact,
    useActionState: (action: any, initialState: any) => {
      const [state, setState] = originalReact.useState(initialState)
      const [isPending, setIsPending] = originalReact.useState(false)
      const runAction = originalReact.useCallback(async (formData: FormData) => {
        setIsPending(true)
        try {
          const result = await action(state, formData)
          setState(result)
        } finally {
          setIsPending(false)
        }
      }, [state])

      originalReact.useEffect(() => {
        const handleFormSubmit = async (e: Event) => {
          e.preventDefault()
          const target = e.target as HTMLFormElement
          const formData = new FormData(target)
          await runAction(formData)
        }
        window.addEventListener('submit', handleFormSubmit)
        return () => window.removeEventListener('submit', handleFormSubmit)
      }, [runAction])

      return [state, runAction, isPending]
    },
  }
})

describe('ForgotPasswordForm', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders correctly', () => {
    render(<ForgotPasswordForm />)
    expect(screen.getByLabelText('email')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'submit' })).toBeInTheDocument()
    expect(screen.getByText('backToLogin')).toBeInTheDocument()
  })

  it('submits successfully and shows success message', async () => {
    ;(requestPasswordResetAction as jest.Mock).mockResolvedValue({ done: true })

    render(<ForgotPasswordForm />)

    fireEvent.change(screen.getByLabelText('email'), { target: { value: 'test@example.com' } })

    const button = screen.getByRole('button', { name: 'submit' })
    fireEvent.click(button)

    await waitFor(() => {
      expect(requestPasswordResetAction).toHaveBeenCalled()
      expect(screen.getByTestId('forgot-sent')).toBeInTheDocument()
    })
  })
})
