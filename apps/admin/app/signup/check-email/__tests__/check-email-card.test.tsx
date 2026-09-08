import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { CheckEmailCard } from '../check-email-card'

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}))

afterEach(() => {
  jest.restoreAllMocks()
})

function renderCard() {
  return render(<CheckEmailCard email="alice@example.com" next="" authServerUrl="https://auth.example.com" />)
}

describe('CheckEmailCard', () => {
  it('shows the email address in the subtitle', () => {
    renderCard()
    expect(screen.getByText('subtitle:{"email":"alice@example.com"}')).toBeInTheDocument()
  })

  it('resends the verification email, shows a confirmation, and disables the button during cooldown', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ status: true }) })
    global.fetch = fetchMock as unknown as typeof fetch
    renderCard()

    fireEvent.click(screen.getByRole('button', { name: 'resendButton' }))

    await waitFor(() => expect(screen.getByTestId('check-email-resent')).toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledWith(
      'https://auth.example.com/api/auth/send-verification-email',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          email: 'alice@example.com',
          callbackURL: `${window.location.origin}/signup/verified`,
        }),
      }),
    )
    expect(screen.getByRole('button')).toBeDisabled()
  })

  it('shows an error when the resend request fails', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, json: async () => ({}) }) as unknown as typeof fetch
    renderCard()

    fireEvent.click(screen.getByRole('button', { name: 'resendButton' }))

    await waitFor(() => expect(screen.getByTestId('check-email-error')).toBeInTheDocument())
  })

  it('shows a link back to sign-in, preserving next', () => {
    render(<CheckEmailCard email="alice@example.com" next="/orgs" authServerUrl="https://auth.example.com" />)
    expect(screen.getByRole('link', { name: 'backToLogin' })).toHaveAttribute(
      'href',
      '/login?next=%2Forgs',
    )
  })
})
