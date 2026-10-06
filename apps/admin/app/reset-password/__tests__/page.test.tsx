import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import en from '@/messages/en.json'
import ResetPasswordPage, { generateMetadata } from '../page'
import { getPasswordPolicyForResetToken } from '@/lib/api-public'

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

const mockResetPasswordForm = jest.fn((_props: unknown) => <div data-testid="reset-password-form" />)

jest.mock('../reset-password-form', () => ({
  ResetPasswordForm: (props: unknown) => mockResetPasswordForm(props),
}))

jest.mock('@/lib/api-public', () => ({
  getPasswordPolicyForResetToken: jest.fn(),
}))

const mockGetPolicy = getPasswordPolicyForResetToken as jest.MockedFunction<typeof getPasswordPolicyForResetToken>

function withIntl(node: React.ReactNode) {
  return (
    <NextIntlClientProvider locale="en" messages={en}>
      {node}
    </NextIntlClientProvider>
  )
}

const POLICY_AND_BRANDING = {
  passwordPolicy: {
    minLength: 12,
    requireUppercase: true,
    requireLowercase: true,
    requireNumber: true,
    requireSpecial: false,
    minNumbers: 1,
    minSpecial: 0,
  },
  pageLightBackgroundColor: null,
  pageDarkBackgroundColor: null,
  cardLightBackgroundColor: null,
  cardDarkBackgroundColor: null,
  logo: null,
  favicon: null,
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('ResetPasswordPage', () => {
  it('renders the invalid-token message when there is no token', async () => {
    const ui = await ResetPasswordPage({ searchParams: Promise.resolve({}) })
    render(withIntl(ui))
    expect(screen.getByText(en.resetPassword.invalidToken)).toBeInTheDocument()
    expect(mockResetPasswordForm).not.toHaveBeenCalled()
  })

  it('renders ResetPasswordForm with the token when present', async () => {
    const ui = await ResetPasswordPage({ searchParams: Promise.resolve({ token: 'tok' }) })
    render(withIntl(ui))
    expect(mockResetPasswordForm).toHaveBeenCalledWith(expect.objectContaining({ token: 'tok' }))
  })
})

describe('ResetPasswordPage generateMetadata', () => {
  it('returns no metadata when there is no token', async () => {
    const metadata = await generateMetadata({ searchParams: Promise.resolve({}) })
    expect(metadata).toEqual({})
    expect(mockGetPolicy).not.toHaveBeenCalled()
  })

  it('sets the tab icon when the token resolves to a favicon', async () => {
    mockGetPolicy.mockResolvedValue({ ...POLICY_AND_BRANDING, favicon: 'data:image/png;base64,FFF=' })
    const metadata = await generateMetadata({ searchParams: Promise.resolve({ token: 'tok' }) })
    expect(metadata).toEqual({ icons: { icon: 'data:image/png;base64,FFF=' } })
  })

  it('leaves the icon unset when the token resolves to no favicon', async () => {
    mockGetPolicy.mockResolvedValue({ ...POLICY_AND_BRANDING, favicon: null })
    const metadata = await generateMetadata({ searchParams: Promise.resolve({ token: 'tok' }) })
    expect(metadata).toEqual({})
  })

  it('fails open to no metadata when the lookup throws', async () => {
    mockGetPolicy.mockRejectedValue(new Error('auth-server unreachable'))
    const metadata = await generateMetadata({ searchParams: Promise.resolve({ token: 'tok' }) })
    expect(metadata).toEqual({})
  })
})
