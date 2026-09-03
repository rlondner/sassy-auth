import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import en from '@/messages/en.json'
import { AppViewDrawer } from '../app-view-drawer'

const app = { publicId: 'sq_1', name: 'Customer Portal', url: 'https://portal.example.com', isPlatform: false, requireTwoFactor: false }
const platformApp = { publicId: 'sq_2', name: 'SassyAuth', url: 'https://auth', isPlatform: true, requireTwoFactor: false }

function withIntl(node: React.ReactNode) {
  return <NextIntlClientProvider locale="en" messages={en}>{node}</NextIntlClientProvider>
}

describe('AppViewDrawer', () => {
  it('renders core details and Edit/Delete for ordinary apps', () => {
    render(withIntl(<AppViewDrawer app={app} open onOpenChange={() => undefined} onEdit={() => undefined} onDelete={() => undefined} />))
    expect(screen.getByText('Customer Portal')).toBeInTheDocument()
    expect(screen.getByText('https://portal.example.com')).toBeInTheDocument()
    expect(screen.getByText('sq_1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: en.apps.actions.edit })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: en.apps.actions.delete })).toBeInTheDocument()
    expect(screen.queryByText(en.apps.badges.platform)).not.toBeInTheDocument()
  })

  it('hides Edit/Delete and shows Platform badge for platform apps', () => {
    render(withIntl(<AppViewDrawer app={platformApp} open onOpenChange={() => undefined} onEdit={() => undefined} onDelete={() => undefined} />))
    expect(screen.queryByRole('button', { name: en.apps.actions.edit })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: en.apps.actions.delete })).not.toBeInTheDocument()
    expect(screen.getByText(en.apps.badges.platform)).toBeInTheDocument()
  })

  // Task 4: callbackUrl is gone — the view drawer now groups redirect URIs
  // by kind (login / post_logout).
  it('shows the empty-state copy for both groups when no redirect URIs are registered', () => {
    render(withIntl(<AppViewDrawer app={app} open onOpenChange={() => undefined} onEdit={() => undefined} onDelete={() => undefined} />))
    expect(screen.getAllByText(en.apps.fields.noRedirectUris)).toHaveLength(2)
  })

  it('renders registered redirect URIs grouped by kind', () => {
    const appWithUris = {
      ...app,
      redirectUris: [
        { uri: 'https://portal.example.com/cb', kind: 'login' as const },
        { uri: 'https://portal.example.com/bye', kind: 'post_logout' as const },
      ],
    }
    render(withIntl(<AppViewDrawer app={appWithUris} open onOpenChange={() => undefined} onEdit={() => undefined} onDelete={() => undefined} />))
    expect(screen.getByText(en.apps.fields.loginRedirectUris)).toBeInTheDocument()
    expect(screen.getByText(en.apps.fields.postLogoutRedirectUris)).toBeInTheDocument()
    expect(screen.getByText('https://portal.example.com/cb')).toBeInTheDocument()
    expect(screen.getByText('https://portal.example.com/bye')).toBeInTheDocument()
  })
})
