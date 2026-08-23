import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import messages from '@/messages/en.json'
import { SocialButtons } from '@/app/login/social-buttons'

const DEFAULT_AUTH_SERVER_URL = 'https://auth.example.com'

function renderWith(providers: string[], authServerUrl = DEFAULT_AUTH_SERVER_URL) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SocialButtons
        providers={providers}
        next="/api/token/oauth/authorize?client_id=qp31"
        authServerUrl={authServerUrl}
      />
    </NextIntlClientProvider>,
  )
}

describe('SocialButtons', () => {
  it('renders nothing when no providers are enabled', () => {
    const { container } = renderWith([])
    expect(container).toBeEmptyDOMElement()
  })

  it('renders one button per enabled provider', () => {
    renderWith(['google', 'microsoft'])
    expect(screen.getByRole('button', { name: /google/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /microsoft/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /apple/i })).not.toBeInTheDocument()
  })

  it('renders the divider only when there is at least one provider', () => {
    renderWith(['google'])
    expect(screen.getByText(messages.login.socialDivider)).toBeInTheDocument()
  })

  it('builds the sign-in redirect from the passed-in authServerUrl, not a hardcoded origin', () => {
    const originalLocation = window.location
    // jsdom's window.location.href setter doesn't actually navigate, but it
    // does record the assignment, which is all we need to assert on.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, href: originalLocation.href },
    })

    renderWith(['google'], 'https://auth.example.com')
    screen.getByRole('button', { name: /google/i }).click()

    expect(window.location.href).toBe(
      'https://auth.example.com/api/auth/sign-in/social?provider=google&callbackURL=%2Fapi%2Ftoken%2Foauth%2Fauthorize%3Fclient_id%3Dqp31&errorCallbackURL=%2Foauth-error',
    )
    expect(window.location.href).not.toContain('localhost:3000')

    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    })
  })

  it('skips a provider id it has no label for instead of throwing', () => {
    renderWith(['google', 'unknown-future-provider', 'microsoft'])
    expect(screen.getByRole('button', { name: /google/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /microsoft/i })).toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(2)
  })

  it('renders nothing (no divider) when every provider id is unknown', () => {
    const { container } = renderWith(['unknown-future-provider'])
    expect(container).toBeEmptyDOMElement()
  })
})
