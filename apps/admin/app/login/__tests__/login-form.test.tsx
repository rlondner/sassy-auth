import { render, screen, fireEvent } from '@testing-library/react'
import { LoginForm } from '../login-form'

// Mock react to support useActionState in React 18 JSDOM test environment
jest.mock('react', () => {
  const originalReact = jest.requireActual('react')
  return {
    ...originalReact,
    useActionState: (action: any, initialState: any) => {
      const [state, setState] = originalReact.useState(initialState)
      const [isPending, setIsPending] = originalReact.useState(false)
      const formAction = async (formData: any) => {
        setIsPending(true)
        try {
          const result = await action(state, formData)
          setState(result)
        } finally {
          setIsPending(false)
        }
      }
      return [state, formAction, isPending]
    },
  }
})

// Mock next-intl translations
jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => {
    const translations: Record<string, string> = {
      title: 'Admin Console',
      subtitle: 'Sign in to continue',
      email: 'Email Address',
      password: 'Password',
      showPassword: 'Show password',
      hidePassword: 'Hide password',
      submit: 'Sign In',
      forgotPassword: 'Forgot password?',
      useCode: 'Sign in with a code instead',
    }
    return translations[key] || key
  },
}))

// Mock next/navigation
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}))

// Mock actions
jest.mock('../actions', () => ({
  signIn: jest.fn(),
}))

describe('LoginForm Password Toggle', () => {
  it('renders password input as type password by default', () => {
    render(<LoginForm next="" />)
    const passwordInput = screen.getByLabelText('Password')
    expect(passwordInput).toHaveAttribute('type', 'password')

    // Check toggle button has correct aria-label
    const toggleButton = screen.getByRole('button', { name: 'Show password' })
    expect(toggleButton).toBeInTheDocument()
  })

  it('toggles password visibility and updates aria-label on click', () => {
    render(<LoginForm next="" />)
    const passwordInput = screen.getByLabelText('Password')
    const toggleButton = screen.getByRole('button', { name: 'Show password' })

    // Click to show password
    fireEvent.click(toggleButton)
    expect(passwordInput).toHaveAttribute('type', 'text')
    expect(screen.getByRole('button', { name: 'Hide password' })).toBeInTheDocument()

    // Click to hide password
    fireEvent.click(toggleButton)
    expect(passwordInput).toHaveAttribute('type', 'password')
    expect(screen.getByRole('button', { name: 'Show password' })).toBeInTheDocument()
  })
})
