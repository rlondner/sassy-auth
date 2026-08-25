import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import messages from '@/messages/en.json'
import { ResetPasswordForm } from '../reset-password-form'
import { resetPasswordSubmitAction } from '../actions'

jest.mock('../actions', () => ({ resetPasswordSubmitAction: jest.fn() }))

const mockSubmit = resetPasswordSubmitAction as jest.MockedFunction<any>

function renderForm() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ResetPasswordForm token="tok" />
    </NextIntlClientProvider>,
  )
}

function fillAndSubmit(password: string, confirm = password) {
  fireEvent.change(screen.getByLabelText(messages.resetPassword.password), {
    target: { value: password },
  })
  fireEvent.change(
    screen.getByLabelText(messages.resetPassword.confirmPassword),
    { target: { value: confirm } },
  )
  // Submit the form directly: the inputs carry `required` / `minLength`, and
  // going through a button click would let jsdom's constraint validation
  // pre-empt the component's own checks, which are what these cases exercise.
  fireEvent.submit(screen.getByRole('button').closest('form')!)
}

const VALID = 'Str0ngPassw0rd'

beforeEach(() => {
  jest.clearAllMocks()
})

describe('ResetPasswordForm client-side validation', () => {
  it('rejects mismatched passwords without calling the action', async () => {
    renderForm()

    fillAndSubmit(VALID, 'Different123')

    expect(screen.getByTestId('reset-error')).toHaveTextContent(
      messages.resetPassword.mismatch,
    )
    expect(mockSubmit).not.toHaveBeenCalled()
  })

  it('rejects a password under 12 characters without calling the action', async () => {
    renderForm()

    fillAndSubmit('Sh0rtPass')

    expect(screen.getByTestId('reset-error')).toHaveTextContent(
      messages.resetPassword.tooShort,
    )
    expect(mockSubmit).not.toHaveBeenCalled()
  })

  it('rejects a password missing a character class without calling the action', async () => {
    renderForm()

    fillAndSubmit('alllowercaseletters')

    expect(screen.getByTestId('reset-error')).toHaveTextContent(
      messages.resetPassword.complexity,
    )
    expect(mockSubmit).not.toHaveBeenCalled()
  })
})

describe('ResetPasswordForm submission', () => {
  it('shows the success panel when the action succeeds', async () => {
    mockSubmit.mockResolvedValue({ ok: true })
    renderForm()

    fillAndSubmit(VALID)

    await waitFor(() =>
      expect(screen.getByTestId('reset-success')).toBeInTheDocument(),
    )
    expect(mockSubmit).toHaveBeenCalledWith('tok', VALID)
  })

  it('shows the invalid-link message when the token is rejected', async () => {
    mockSubmit.mockResolvedValue({ error: 'invalidToken' })
    renderForm()

    fillAndSubmit(VALID)

    await waitFor(() =>
      expect(screen.getByTestId('reset-error')).toHaveTextContent(
        messages.resetPassword.invalidToken,
      ),
    )
  })

  it('does not blame the link when the request was throttled', async () => {
    mockSubmit.mockResolvedValue({ error: 'tooManyRequests' })
    renderForm()

    fillAndSubmit(VALID)

    await waitFor(() =>
      expect(screen.getByTestId('reset-error')).toBeInTheDocument(),
    )
    expect(screen.getByTestId('reset-error')).not.toHaveTextContent(
      messages.resetPassword.invalidToken,
    )
  })

  // The action distinguishes a transport failure from a rejected token. Telling
  // a user with a valid link that it is invalid sends them to request another
  // one, which is itself rate-limited — a dead end during an outage.
  it('does not blame the link when the server is unreachable', async () => {
    mockSubmit.mockResolvedValue({ error: 'serverUnavailable' })
    renderForm()

    fillAndSubmit(VALID)

    await waitFor(() =>
      expect(screen.getByTestId('reset-error')).toBeInTheDocument(),
    )
    expect(screen.getByTestId('reset-error')).not.toHaveTextContent(
      messages.resetPassword.invalidToken,
    )
  })
})
