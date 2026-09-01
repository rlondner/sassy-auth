import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import messages from '@/messages/en.json'
import { SecurityClient } from '../SecurityClient'
import {
  enable2fa,
  confirmEnable,
  disable2fa,
  regenerateBackupCodes,
} from '../actions'

jest.mock('../actions', () => ({
  enable2fa: jest.fn(),
  confirmEnable: jest.fn(),
  disable2fa: jest.fn(),
  regenerateBackupCodes: jest.fn(),
}))

const mockEnable = enable2fa as jest.MockedFunction<any>
const mockConfirm = confirmEnable as jest.MockedFunction<any>
const mockDisable = disable2fa as jest.MockedFunction<any>
const mockRegenerate = regenerateBackupCodes as jest.MockedFunction<any>

const TOTP_URI = 'otpauth://totp/Sassy:a@b.io?secret=JBSWY3DPEHPK3PXP&issuer=Sassy'
const CODES = ['aaaa-1111', 'bbbb-2222', 'cccc-3333']

function renderClient(props: Partial<Parameters<typeof SecurityClient>[0]> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SecurityClient twoFactorEnabled={false} {...(props as any)} />
    </NextIntlClientProvider>,
  )
}

/**
 * Submit the form that owns the given field, bypassing jsdom's constraint
 * validation so the component's own handling is what runs.
 */
function submitFormWith(fieldName: string, value: string) {
  const field = document.querySelector(
    `input[name="${fieldName}"]`,
  ) as HTMLInputElement
  expect(field).not.toBeNull()
  fireEvent.change(field, { target: { value } })
  fireEvent.submit(field.closest('form')!)
}

/**
 * With 2FA on, the disable and regenerate forms sit behind a disclosure
 * button; only one can be open at a time. Click through to reveal one.
 */
function openSection(headingText: string) {
  fireEvent.click(screen.getByRole('button', { name: headingText }))
}

beforeEach(() => {
  jest.clearAllMocks()
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: jest.fn().mockResolvedValue(undefined) },
    configurable: true,
  })
})

describe('SecurityClient enable flow', () => {
  it('shows the enrollment form when 2FA is off', () => {
    renderClient()

    expect(
      screen.getByText(messages.security.enable.heading),
    ).toBeInTheDocument()
  })

  it('advances to the QR step and surfaces the manual secret', async () => {
    mockEnable.mockResolvedValue({ totpURI: TOTP_URI, backupCodes: CODES })
    renderClient()

    submitFormWith('password', 'pw')

    await waitFor(() =>
      expect(
        screen.getByText(messages.security.enable.confirmHeading),
      ).toBeInTheDocument(),
    )
    // Extracted from the otpauth URI so a user without a camera can type it.
    expect(screen.getByText(/JBSWY3DPEHPK3PXP/)).toBeInTheDocument()
  })

  it('surfaces an enable error and stays on the enrollment step', async () => {
    mockEnable.mockResolvedValue({ error: 'invalidPassword' })
    renderClient()

    submitFormWith('password', 'wrong')

    await waitFor(() =>
      expect(
        screen.getByText(messages.security.errors.invalidPassword),
      ).toBeInTheDocument(),
    )
    expect(
      screen.queryByText(messages.security.enable.confirmHeading),
    ).not.toBeInTheDocument()
  })

  it('confirms enrollment and reveals the backup codes', async () => {
    mockEnable.mockResolvedValue({ totpURI: TOTP_URI, backupCodes: CODES })
    mockConfirm.mockResolvedValue({ ok: true })
    renderClient()

    submitFormWith('password', 'pw')
    await waitFor(() =>
      expect(document.querySelector('input[name="code"]')).toBeInTheDocument(),
    )

    submitFormWith('code', '123456')

    await waitFor(() =>
      expect(screen.getByText(CODES[0])).toBeInTheDocument(),
    )
    CODES.forEach((c) => expect(screen.getByText(c)).toBeInTheDocument())
  })

  it('surfaces a confirm error without enabling', async () => {
    mockEnable.mockResolvedValue({ totpURI: TOTP_URI, backupCodes: CODES })
    mockConfirm.mockResolvedValue({ error: 'invalidCode' })
    renderClient()

    submitFormWith('password', 'pw')
    await waitFor(() =>
      expect(document.querySelector('input[name="code"]')).toBeInTheDocument(),
    )

    submitFormWith('code', '000000')

    await waitFor(() =>
      expect(
        screen.getByText(messages.security.errors.invalidCode),
      ).toBeInTheDocument(),
    )
    // Still on the enrollment step: the confirm form is present and the
    // disable section, which only renders once enabled, is not.
    expect(document.querySelector('input[name="code"]')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: messages.security.disable.heading }),
    ).not.toBeInTheDocument()
  })

  // The codes are returned by /two-factor/enable and rendered next to the QR,
  // before confirmation — the user needs them recorded before they can be
  // locked out by a mistyped code.
  it('shows the backup codes alongside the QR, not only after confirming', async () => {
    mockEnable.mockResolvedValue({ totpURI: TOTP_URI, backupCodes: CODES })
    renderClient()

    submitFormWith('password', 'pw')

    await waitFor(() => expect(screen.getByText(CODES[0])).toBeInTheDocument())
    expect(document.querySelector('input[name="code"]')).toBeInTheDocument()
  })
})

describe('SecurityClient disable flow', () => {
  it('returns to the enrollment step after a successful disable', async () => {
    mockDisable.mockResolvedValue({ ok: true })
    renderClient({ twoFactorEnabled: true })

    openSection(messages.security.disable.heading)
    submitFormWith('password', 'pw')

    await waitFor(() =>
      expect(
        screen.getByText(messages.security.enable.heading),
      ).toBeInTheDocument(),
    )
  })

  it('surfaces a disable error and stays enabled', async () => {
    mockDisable.mockResolvedValue({ error: 'invalidPassword' })
    renderClient({ twoFactorEnabled: true })

    openSection(messages.security.disable.heading)
    submitFormWith('password', 'wrong')

    await waitFor(() =>
      expect(
        screen.getByText(messages.security.errors.invalidPassword),
      ).toBeInTheDocument(),
    )
    expect(
      screen.queryByText(messages.security.enable.heading),
    ).not.toBeInTheDocument()
  })

  it('renders the throttled message when the action reports tooManyRequests', async () => {
    mockDisable.mockResolvedValue({ error: 'tooManyRequests' })
    renderClient({ twoFactorEnabled: true })

    openSection(messages.security.disable.heading)
    submitFormWith('password', 'pw')

    await waitFor(() =>
      expect(
        screen.getByText(messages.security.errors.tooManyRequests),
      ).toBeInTheDocument(),
    )
  })
})

describe('SecurityClient backup codes', () => {
  async function regenerateAndReveal() {
    openSection(messages.security.regenerate.heading)
    submitFormWith('password', 'pw')
    await waitFor(() => expect(screen.getByText(CODES[0])).toBeInTheDocument())
  }

  it('reveals a fresh set after regenerating', async () => {
    mockRegenerate.mockResolvedValue({ backupCodes: CODES })
    renderClient({ twoFactorEnabled: true })

    await regenerateAndReveal()

    CODES.forEach((c) => expect(screen.getByText(c)).toBeInTheDocument())
  })

  // The codes are single-use credentials. They are rendered as text for the
  // user to copy, and must never land in an input value, where a password
  // manager or form autofill could capture and persist them.
  it('never writes the codes into an input value', async () => {
    mockRegenerate.mockResolvedValue({ backupCodes: CODES })
    renderClient({ twoFactorEnabled: true })

    await regenerateAndReveal()

    const values = Array.from(document.querySelectorAll('input')).map(
      (i) => (i as HTMLInputElement).value,
    )
    CODES.forEach((c) => expect(values).not.toContain(c))
  })

  it('surfaces a regenerate error without revealing anything', async () => {
    mockRegenerate.mockResolvedValue({ error: 'invalidPassword' })
    renderClient({ twoFactorEnabled: true })

    openSection(messages.security.regenerate.heading)
    submitFormWith('password', 'wrong')

    await waitFor(() =>
      expect(
        screen.getByText(messages.security.errors.invalidPassword),
      ).toBeInTheDocument(),
    )
    expect(screen.queryByText(CODES[0])).not.toBeInTheDocument()
  })

  it('copies the codes to the clipboard as newline-separated text', async () => {
    mockRegenerate.mockResolvedValue({ backupCodes: CODES })
    renderClient({ twoFactorEnabled: true })

    await regenerateAndReveal()

    fireEvent.click(
      screen.getByRole('button', {
        name: messages.security.backupCodes.copyButton,
      }),
    )

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(CODES.join('\n'))
  })
})
