import { render, screen } from '@testing-library/react'
import VerifiedPage from '../page'

jest.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}))

// LinkExpiredCard (rendered for the TOKEN_EXPIRED+email branch) is a client
// component that calls the *client* useTranslations from 'next-intl', not
// 'next-intl/server' — mock it too, or rendering it here throws for missing
// intl context. This mock (like check-email-card.test.tsx's identical one)
// ignores the namespace argument and returns the bare key.
jest.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}))

describe('SignupVerifiedPage', () => {
  it('renders a confirmation message and a link to /login when there is no error', async () => {
    const ui = await VerifiedPage({ searchParams: Promise.resolve({}) })
    render(ui)
    expect(screen.getByText('signup.verified.title')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'signup.verified.continueToLogin' })).toHaveAttribute('href', '/login')
  })

  it('renders the expired-link card with a resend button when error=TOKEN_EXPIRED and email is present', async () => {
    const ui = await VerifiedPage({
      searchParams: Promise.resolve({ error: 'TOKEN_EXPIRED', email: 'jane@example.com' }),
    })
    render(ui)
    // LinkExpiredCard's own useTranslations('signup.verified.expired') mock
    // ignores the namespace, so its rendered keys are bare ('title',
    // 'subtitle:{...}', 'resendButton'), unlike the page's own
    // next-intl/server-driven text below (full dotted keys). The subtitle
    // call passes {email}, so its rendered text carries that JSON suffix.
    expect(screen.getByText('subtitle:{"email":"jane@example.com"}')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'resendButton' })).toBeInTheDocument()
  })

  it('renders the generic invalid-link message when error=TOKEN_EXPIRED but there is no email', async () => {
    const ui = await VerifiedPage({ searchParams: Promise.resolve({ error: 'TOKEN_EXPIRED' }) })
    render(ui)
    expect(screen.getByText('signup.verified.invalid.title')).toBeInTheDocument()
  })

  it.each(['INVALID_TOKEN', 'USER_NOT_FOUND', 'INVALID_USER', 'SOMETHING_UNKNOWN'])(
    'renders the generic invalid-link message for error=%s',
    async (error) => {
      const ui = await VerifiedPage({ searchParams: Promise.resolve({ error, email: 'jane@example.com' }) })
      render(ui)
      expect(screen.getByText('signup.verified.invalid.title')).toBeInTheDocument()
    },
  )
})
