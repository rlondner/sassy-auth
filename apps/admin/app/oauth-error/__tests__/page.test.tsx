import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import en from '@/messages/en.json'
import OauthErrorPage from '../page'

// Jest's jsdom env has no Next.js server context, so `getTranslations` from
// `next-intl/server` throws. Stub it with a resolver that walks the same
// JSON tree that NextIntlClientProvider uses for the client side, so server
// and client halves render against the same source of truth.
jest.mock('next-intl/server', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const enJson = require('@/messages/en.json') as Record<string, unknown>

  function resolveNamespace(messages: Record<string, unknown>, namespace: string) {
    return namespace.split('.').reduce<unknown>((acc, part) => {
      if (acc && typeof acc === 'object' && part in (acc as Record<string, unknown>)) {
        return (acc as Record<string, unknown>)[part]
      }
      return undefined
    }, messages)
  }

  function resolveKey(scope: unknown, key: string): string {
    const value = key.split('.').reduce<unknown>((acc, part) => {
      if (acc && typeof acc === 'object' && part in (acc as Record<string, unknown>)) {
        return (acc as Record<string, unknown>)[part]
      }
      return undefined
    }, scope)
    return typeof value === 'string' ? value : key
  }

  return {
    getTranslations: async (namespace: string) => {
      const scope = resolveNamespace(enJson, namespace)
      return (key: string) => resolveKey(scope, key)
    },
  }
})

function withIntl(node: React.ReactNode) {
  return (
    <NextIntlClientProvider locale="en" messages={en}>
      {node}
    </NextIntlClientProvider>
  )
}

// `page.tsx` is an async server component. Calling it like a function returns
// a Promise<JSX.Element>; resolve it before rendering.
async function renderPage(searchParams: Record<string, string | undefined>) {
  const element = await OauthErrorPage({
    searchParams: Promise.resolve(searchParams),
  })
  return render(withIntl(element))
}

describe('OauthErrorPage', () => {
  const ORIGINAL_ENV = process.env.NEXT_PUBLIC_ADMIN_CONTACT_EMAIL

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.NEXT_PUBLIC_ADMIN_CONTACT_EMAIL
    } else {
      process.env.NEXT_PUBLIC_ADMIN_CONTACT_EMAIL = ORIGINAL_ENV
    }
  })

  it('renders the localized heading + body for a known code', async () => {
    await renderPage({ code: 'invalid_redirect_uri', app: '84LRe' })
    expect(
      screen.getByText(en.oauthError.codes.invalid_redirect_uri.heading),
    ).toBeInTheDocument()
    expect(
      screen.getByText(en.oauthError.codes.invalid_redirect_uri.body),
    ).toBeInTheDocument()
    expect(
      screen.getByText(en.oauthError.codes.invalid_redirect_uri.hint),
    ).toBeInTheDocument()
    expect(screen.getByText('84LRe')).toBeInTheDocument()
  })

  it('falls back to the generic message when code is missing', async () => {
    await renderPage({})
    expect(
      screen.getByText(en.oauthError.fallbackHeading),
    ).toBeInTheDocument()
    expect(
      screen.getByText(en.oauthError.fallbackBody),
    ).toBeInTheDocument()
  })

  it('falls back to the generic message when code is unknown', async () => {
    await renderPage({ code: 'totally_made_up' })
    expect(
      screen.getByText(en.oauthError.fallbackHeading),
    ).toBeInTheDocument()
  })

  it('renders the "Return to sign-in" link pointing at /login', async () => {
    await renderPage({ code: 'invalid_redirect_uri' })
    const link = screen.getByRole('link', { name: en.oauthError.actions.returnToSignIn })
    expect(link).toHaveAttribute('href', '/login')
  })

  it('hides the contact link when NEXT_PUBLIC_ADMIN_CONTACT_EMAIL is unset', async () => {
    delete process.env.NEXT_PUBLIC_ADMIN_CONTACT_EMAIL
    await renderPage({ code: 'invalid_redirect_uri' })
    expect(
      screen.queryByRole('link', { name: en.oauthError.actions.contactAdministrator }),
    ).toBeNull()
  })

  it('renders the contact mailto with subject + body when NEXT_PUBLIC_ADMIN_CONTACT_EMAIL is set', async () => {
    process.env.NEXT_PUBLIC_ADMIN_CONTACT_EMAIL = 'admin@example.com'
    await renderPage({ code: 'invalid_redirect_uri', app: '84LRe' })
    const link = screen.getByRole('link', { name: en.oauthError.actions.contactAdministrator })
    const href = link.getAttribute('href') ?? ''
    expect(href.startsWith('mailto:admin@example.com')).toBe(true)
    expect(href).toContain('subject=')
    expect(decodeURIComponent(href)).toContain('invalid_redirect_uri')
    expect(decodeURIComponent(href)).toContain('84LRe')
  })

  it('preserves the raw code in the mailto even when code is not in the known set', async () => {
    process.env.NEXT_PUBLIC_ADMIN_CONTACT_EMAIL = 'admin@example.com'
    await renderPage({ code: 'something_unrecognised', app: 'AAA1' })
    const link = screen.getByRole('link', { name: en.oauthError.actions.contactAdministrator })
    const href = link.getAttribute('href') ?? ''
    expect(decodeURIComponent(href)).toContain('something_unrecognised')
    expect(decodeURIComponent(href)).toContain('AAA1')
  })
})
