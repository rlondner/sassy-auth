import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import messages from '@/messages/en.json'
import { TwoFactorPromptClient } from '../TwoFactorPromptClient'

const mockPush = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

function wrap(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  )
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('TwoFactorPromptClient', () => {
  it('renders the prompt title and actions', () => {
    wrap(<TwoFactorPromptClient next="" />)
    expect(
      screen.getByText(messages.twoFactorPrompt.title),
    ).toBeInTheDocument()
  })

  it('renders the app logo when a logo URL is provided', () => {
    const { container } = wrap(
      <TwoFactorPromptClient next="" logo="data:image/png;base64,AAA=" />,
    )
    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    expect(img).toHaveAttribute('src', 'data:image/png;base64,AAA=')
  })

  it('renders no logo image when none is provided', () => {
    const { container } = wrap(<TwoFactorPromptClient next="" />)
    expect(container.querySelector('img')).toBeNull()
  })
})
