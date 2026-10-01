import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { LinkExpiredCard } from '../link-expired-card'

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}))

afterEach(() => {
  jest.restoreAllMocks()
})

function renderCard() {
  return render(<LinkExpiredCard email="jane@example.com" authServerUrl="https://auth.example.com" />)
}

describe('LinkExpiredCard', () => {
  it('shows the email address in the subtitle', () => {
    renderCard()
    expect(screen.getByText('subtitle:{"email":"jane@example.com"}')).toBeInTheDocument()
  })

  it('resends the verification email, shows a confirmation, and disables the button during cooldown', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ status: true }) })
    global.fetch = fetchMock as unknown as typeof fetch
    renderCard()

    fireEvent.click(screen.getByRole('button', { name: 'resendButton' }))

    await waitFor(() => expect(screen.getByTestId('link-expired-resent')).toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledWith(
      'https://auth.example.com/api/auth/send-verification-email',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          email: 'jane@example.com',
          callbackURL: `${window.location.origin}/signup/verified?email=${encodeURIComponent('jane@example.com')}`,
        }),
      }),
    )
    expect(screen.getByRole('button')).toBeDisabled()
  })

  it('shows an error when the resend request fails', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, json: async () => ({}) }) as unknown as typeof fetch
    renderCard()

    fireEvent.click(screen.getByRole('button', { name: 'resendButton' }))

    await waitFor(() => expect(screen.getByTestId('link-expired-error')).toBeInTheDocument())
  })

  it('shows a link back to sign-in', () => {
    renderCard()
    expect(screen.getByRole('link', { name: 'backToLogin' })).toHaveAttribute('href', '/login')
  })
})
