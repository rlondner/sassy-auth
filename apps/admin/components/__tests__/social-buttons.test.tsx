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

  // task-13: BetterAuth's /sign-in/social endpoint is POST-only (verified
  // live against a real auth-server: a GET 404s, a POST returns
  // `{ url, redirect: true }`). This test used to assert a synchronous GET
  // navigation, which is exactly the shape of the bug the e2e acceptance
  // gate caught — jsdom's window.location.href setter only ever *records*
  // an assignment, it never performs a real request, so a wrong HTTP
  // method/verb was invisible here. It now mocks `fetch` to return that
  // same response shape and asserts the button POSTs the right body to the
  // right origin, then navigates to the URL the response provides.
  it('POSTs to sign-in/social with the passed-in authServerUrl, not a hardcoded origin, then navigates to the returned url', async () => {
    const originalLocation = window.location
    // jsdom's window.location.href setter doesn't actually navigate, but it
    // does record the assignment, which is all we need to assert on.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, href: originalLocation.href },
    })

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: 'https://accounts.example.com/o/oauth2/authorize?...', redirect: true }),
    })
    const originalFetch = global.fetch
    global.fetch = fetchMock as unknown as typeof fetch

    renderWith(['google'], 'https://auth.example.com')
    screen.getByRole('button', { name: /google/i }).click()

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(fetchMock).toHaveBeenCalledWith(
      'https://auth.example.com/api/auth/sign-in/social',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({
          provider: 'google',
          callbackURL: '/api/token/oauth/authorize?client_id=qp31',
          errorCallbackURL: '/oauth-error',
        }),
      }),
    )
    expect(window.location.href).toBe('https://accounts.example.com/o/oauth2/authorize?...')

    global.fetch = originalFetch
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    })
  })

  it('sends the browser to /oauth-error when sign-in/social fails', async () => {
    const originalLocation = window.location
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, href: originalLocation.href },
    })

    const originalFetch = global.fetch
    global.fetch = jest.fn().mockResolvedValue({ ok: false, json: async () => ({}) }) as unknown as typeof fetch

    renderWith(['google'], 'https://auth.example.com')
    screen.getByRole('button', { name: /google/i }).click()

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(window.location.href).toBe('/oauth-error')

    global.fetch = originalFetch
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
