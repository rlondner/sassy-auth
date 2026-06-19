import { getTranslations } from 'next-intl/server'
import { SidebarShell, type NavIconName } from './sidebar-shell'
import type { MeProfile } from '@/lib/types'

interface AdminShellProps {
  children: React.ReactNode
  user: { firstName: string; lastName: string; email: string }
  perms: string[]
  profile: MeProfile | null
  currentLocale: string
  availableLocales: string[]
}

export async function AdminShell({
  children, user, perms, profile, currentLocale, availableLocales,
}: AdminShellProps) {
  const t = await getTranslations()

  // Icon NAMES (strings) — not component references. A 'use client' module's
  // non-component exports become opaque client references on the server side,
  // so e.g. `NavIcons.Boxes` would evaluate to `undefined` here and crash with
  // "Element type is invalid ... got: undefined" during SSR.
  //
  // Single nav declaration with per-item permission requirements.
  const NAV: {
    group: 'directory' | 'accessControl';
    item: { href: string; label: string; icon: NavIconName };
    requires: string[];
  }[] = [
    { group: 'directory', item: { href: '/apps',  label: t('nav.apps'),  icon: 'Boxes' },       requires: ['platform.apps.manage'] },
    { group: 'directory', item: { href: '/orgs',  label: t('nav.orgs'),  icon: 'Building2' },   requires: ['platform.orgs.manage'] },
    { group: 'directory', item: { href: '/users', label: t('nav.users'), icon: 'Users' },       requires: ['platform.users.manage', 'org.users.manage'] },
    { group: 'accessControl', item: { href: '/roles',       label: t('nav.roles'),       icon: 'ShieldEllipsis' }, requires: ['platform.roles.manage', 'org.roles.manage'] },
    { group: 'accessControl', item: { href: '/permissions', label: t('nav.permissions'), icon: 'KeyRound' },       requires: ['platform.permissions.manage'] },
  ]

  const visible = NAV.filter((n) => n.requires.some((p) => perms.includes(p)))
  const groups: { label: string; items: { href: string; label: string; icon: NavIconName }[] }[] = []
  const directoryItems = visible.filter((n) => n.group === 'directory').map((n) => n.item)
  const accessItems    = visible.filter((n) => n.group === 'accessControl').map((n) => n.item)
  if (directoryItems.length > 0) groups.push({ label: t('nav.directory'), items: directoryItems })
  if (accessItems.length > 0)    groups.push({ label: t('nav.accessControl'), items: accessItems })

  void profile  // currently only consumed by child pages; reserved for shell-level breadcrumbs later

  return (
    <SidebarShell
      groups={groups}
      user={user}
      currentLocale={currentLocale}
      availableLocales={availableLocales}
      signOutLabel={t('nav.signOut')}
      lightModeLabel={t('nav.switchToLight')}
      darkModeLabel={t('nav.switchToDark')}
    >
      {children}
    </SidebarShell>
  )
}
