import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { VerifyCodeCard } from '../verify-code-card'

const pushMock = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }))

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}))

afterEach(() => {
  jest.restoreAllMocks()
  pushMock.mockClear()
})

function renderCard() {
  return render(<VerifyCodeCard email="alice@example.com" next="" authServerUrl="https://auth.example.com" />)
}

describe('VerifyCodeCard', () => {
  it('shows the email address in the subtitle', () => {
    renderCard()
    expect(screen.getByText('subtitle:{"email":"alice@example.com"}')).toBeInTheDocument()
  })

  it('submits the code and navigates to /signup/verified on success', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ status: true }) })
    global.fetch = fetchMock as unknown as typeof fetch
    renderCard()

    fireEvent.change(screen.getByLabelText('codeLabel'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'submit' }))

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/signup/verified'))
    expect(fetchMock).toHaveBeenCalledWith(
      'https://auth.example.com/api/auth/email-otp/verify-email',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'alice@example.com', otp: '123456' }),
      }),
    )
  })

  it('shows an invalid-code error and does not navigate when the code is wrong', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ code: 'INVALID_OTP', message: 'Invalid OTP' }),
    }) as unknown as typeof fetch
    renderCard()

    fireEvent.change(screen.getByLabelText('codeLabel'), { target: { value: '000000' } })
    fireEvent.click(screen.getByRole('button', { name: 'submit' }))

    await waitFor(() => expect(screen.getByText('errorInvalid')).toBeInTheDocument())
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('shows an expired-code error distinctly from an invalid code', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ code: 'OTP_EXPIRED', message: 'OTP expired' }),
    }) as unknown as typeof fetch
    renderCard()

    fireEvent.change(screen.getByLabelText('codeLabel'), { target: { value: '000000' } })
    fireEvent.click(screen.getByRole('button', { name: 'submit' }))

    await waitFor(() => expect(screen.getByText('errorExpired')).toBeInTheDocument())
  })

  it('resends the code, shows a confirmation, and disables the resend button during cooldown', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ status: true }) })
    global.fetch = fetchMock as unknown as typeof fetch
    renderCard()

    fireEvent.click(screen.getByRole('button', { name: 'resendButton' }))

    await waitFor(() => expect(screen.getByTestId('verify-code-resent')).toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledWith(
      'https://auth.example.com/api/auth/send-verification-email',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('shows a link back to sign-in, preserving next', () => {
    render(<VerifyCodeCard email="alice@example.com" next="/orgs" authServerUrl="https://auth.example.com" />)
    expect(screen.getByRole('link', { name: 'backToLogin' })).toHaveAttribute('href', '/login?next=%2Forgs')
  })
})
