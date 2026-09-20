import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import en from '@/messages/en.json'
import { AppViewDrawer } from '../app-view-drawer'
import * as actions from '@/app/(admin)/apps/actions'
import * as orgsActions from '@/app/(admin)/orgs/actions'
import * as rolesActions from '@/app/(admin)/roles/actions'
import type { PasswordPolicy } from '@/lib/types'

jest.mock('@/app/(admin)/apps/actions', () => ({
  getAppAction: jest.fn(),
  getSocialProviderSettingsAction: jest.fn(),
}))
jest.mock('@/app/(admin)/orgs/actions', () => ({
  listOrgsAction: jest.fn(),
}))
jest.mock('@/app/(admin)/roles/actions', () => ({
  listRolesAction: jest.fn(),
}))

const EFFECTIVE_PASSWORD_POLICY: PasswordPolicy = {
  minLength: 12,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  requireSpecial: false,
  minNumbers: 1,
  minSpecial: 0,
}

const app = {
  publicId: 'sq_1',
  name: 'Customer Portal',
  url: 'https://portal.example.com',
  isPlatform: false,
  requireTwoFactor: false,
  allowOfflineAccess: false,
  passwordPolicyOverride: null,
  effectivePasswordPolicy: EFFECTIVE_PASSWORD_POLICY,
  activationEmailOverride: null,
}
const platformApp = {
  publicId: 'sq_2',
  name: 'SassyAuth',
  url: 'https://auth',
  isPlatform: true,
  requireTwoFactor: false,
  allowOfflineAccess: false,
  passwordPolicyOverride: null,
  effectivePasswordPolicy: EFFECTIVE_PASSWORD_POLICY,
  activationEmailOverride: null,
}

function withIntl(node: React.ReactNode) {
  return <NextIntlClientProvider locale="en" messages={en}>{node}</NextIntlClientProvider>
}

describe('AppViewDrawer', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(actions.getAppAction as jest.Mock).mockResolvedValue({ app })
    ;(actions.getSocialProviderSettingsAction as jest.Mock).mockResolvedValue({ available: [], enabled: [] })
    ;(orgsActions.listOrgsAction as jest.Mock).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 200 })
    ;(rolesActions.listRolesAction as jest.Mock).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 200 })
  })

  it('renders core details and Edit/Delete for ordinary apps', async () => {
    render(withIntl(<AppViewDrawer app={app} open onOpenChange={() => undefined} onEdit={() => undefined} onDelete={() => undefined} />))
    expect(screen.getByText('Customer Portal')).toBeInTheDocument()
    expect(screen.getByText('https://portal.example.com')).toBeInTheDocument()
    expect(screen.getByText('sq_1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: en.apps.actions.edit })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: en.apps.actions.delete })).toBeInTheDocument()
    expect(screen.queryByText(en.apps.badges.platform)).not.toBeInTheDocument()
    await waitFor(() => expect(actions.getAppAction).toHaveBeenCalledWith('sq_1'))
  })

  it('hides Edit/Delete and shows Platform badge for platform apps', () => {
    render(withIntl(<AppViewDrawer app={platformApp} open onOpenChange={() => undefined} onEdit={() => undefined} onDelete={() => undefined} />))
    expect(screen.queryByRole('button', { name: en.apps.actions.edit })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: en.apps.actions.delete })).not.toBeInTheDocument()
    expect(screen.getByText(en.apps.badges.platform)).toBeInTheDocument()
  })

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

  it('shows the system-default and No/inherited-policy placeholders when unset', () => {
    render(withIntl(<AppViewDrawer app={app} open onOpenChange={() => undefined} onEdit={() => undefined} onDelete={() => undefined} />))
    expect(screen.getByText(en.apps.fields.twoFactorTrustDaysSystemDefault)).toBeInTheDocument()
    expect(screen.getByText(en.common.no)).toBeInTheDocument()
    expect(screen.getByText(en.apps.fields.noLogo)).toBeInTheDocument()
    expect(screen.getByText(en.apps.fields.defaultOrgNone)).toBeInTheDocument()
    expect(screen.getByText(en.apps.fields.defaultRoleNone)).toBeInTheDocument()
    expect(screen.getByText(en.apps.fields.noClientSecret)).toBeInTheDocument()
  })

  it('resolves the default org/role names and lists enabled social providers', async () => {
    ;(orgsActions.listOrgsAction as jest.Mock).mockResolvedValue({
      items: [{ publicId: 'org_1', name: 'Acme', isPlatform: false, userCount: 0, app: { publicId: 'sq_1', name: 'Customer Portal' } }],
      total: 1,
      page: 1,
      pageSize: 200,
    })
    ;(rolesActions.listRolesAction as jest.Mock).mockResolvedValue({
      items: [{ publicId: 'role_1', name: 'Admin', app: { publicId: 'sq_1', name: 'Customer Portal' } }],
      total: 1,
      page: 1,
      pageSize: 200,
    })
    ;(actions.getSocialProviderSettingsAction as jest.Mock).mockResolvedValue({ available: ['google'], enabled: ['google'] })
    const appWithDefaults = { ...app, defaultOrgId: 'org_1', defaultRoleId: 'role_1' }
    // The drawer renders from the freshly-fetched single-app record (falling
    // back to the `app` prop until it resolves), so the mock must carry the
    // same defaultOrgId/defaultRoleId as the prop — a real GET /api/apps/:id
    // response would.
    ;(actions.getAppAction as jest.Mock).mockResolvedValue({ app: appWithDefaults })
    render(withIntl(<AppViewDrawer app={appWithDefaults} open onOpenChange={() => undefined} onEdit={() => undefined} onDelete={() => undefined} />))
    await waitFor(() => expect(screen.getByText('Acme')).toBeInTheDocument())
    expect(screen.getByText('Admin')).toBeInTheDocument()
    expect(screen.getByText(en.apps.fields.socialProviderNames.google)).toBeInTheDocument()
  })
})
