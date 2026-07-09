import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { AdminShell } from '../admin-shell'
import type { MeProfile } from '@/lib/types'

// next-intl/server's getTranslations is async and returns a `t` function.
// In AdminShell we call `const t = await getTranslations()` then `t('nav.apps')`.
// We resolve to an identity function so labels equal their keys in assertions.
jest.mock('next-intl/server', () => ({
  getTranslations: jest.fn().mockResolvedValue((key: string) => key),
}))

// Mock SidebarShell to a thin renderer that just lists the items it was given.
// This avoids the full client-side sidebar tree (next/navigation, theme toggle,
// locale switcher, signOutAction) and lets us assert directly on what nav items
// the permission-driven AdminShell decided to render.
jest.mock('../sidebar-shell', () => ({
  SidebarShell: ({
    groups,
    children,
  }: {
    groups: { label: string; items: { href: string; label: string; icon: string }[] }[]
    children: React.ReactNode
  }) => (
    <div data-testid="sidebar-shell">
      {groups.map((g) => (
        <div key={g.label} data-testid={`group-${g.label}`}>
          <span data-testid="group-label">{g.label}</span>
          <ul>
            {g.items.map((it) => (
              <li key={it.href}>{it.label}</li>
            ))}
          </ul>
        </div>
      ))}
      {children}
    </div>
  ),
}))

const user = { firstName: 'X', lastName: 'Y', email: 'x@y.io' }
const profile: MeProfile = {
  userId: 'sq_u1',
  org: { id: 'sq_o1', name: 'Acme', isPlatform: false },
  app: { id: 'sq_a1', name: 'app01', isPlatform: false },
}

async function renderShell(perms: string[]) {
  const el = await AdminShell({
    user,
    perms,
    profile,
    currentLocale: 'en',
    availableLocales: ['en'],
    children: <div />,
  })
  render(el)
}

describe('AdminShell sidebar', () => {
  it('shows all 5 items for a platform super admin', async () => {
    const perms = [
      'platform.apps.manage',
      'platform.orgs.manage',
      'platform.users.manage',
      'platform.roles.manage',
      'platform.permissions.manage',
    ]
    await renderShell(perms)
    expect(screen.getByText('nav.apps')).toBeInTheDocument()
    expect(screen.getByText('nav.orgs')).toBeInTheDocument()
    expect(screen.getByText('nav.users')).toBeInTheDocument()
    expect(screen.getByText('nav.roles')).toBeInTheDocument()
    expect(screen.getByText('nav.permissions')).toBeInTheDocument()
  })

  it('shows only Users + Roles for an org admin holding org.users.manage + org.roles.manage', async () => {
    const perms = ['org.users.manage', 'org.roles.manage']
    await renderShell(perms)
    expect(screen.queryByText('nav.apps')).not.toBeInTheDocument()
    expect(screen.queryByText('nav.orgs')).not.toBeInTheDocument()
    expect(screen.getByText('nav.users')).toBeInTheDocument()
    expect(screen.getByText('nav.roles')).toBeInTheDocument()
    expect(screen.queryByText('nav.permissions')).not.toBeInTheDocument()
  })

  it('collapses the Access Control group when only org.users.manage is held', async () => {
    const perms = ['org.users.manage']
    await renderShell(perms)
    expect(screen.getByText('nav.users')).toBeInTheDocument()
    expect(screen.queryByText('nav.roles')).not.toBeInTheDocument()
    expect(screen.queryByText('nav.accessControl')).not.toBeInTheDocument()
  })
})
