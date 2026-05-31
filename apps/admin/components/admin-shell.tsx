import { getTranslations } from 'next-intl/server'
import { SidebarShell, type NavIconName } from './sidebar-shell'

interface AdminShellProps {
  children: React.ReactNode
  currentPath: string
  user: { firstName: string; lastName: string; email: string }
  currentLocale: string
  availableLocales: string[]
}

export async function AdminShell({
  children, currentPath, user, currentLocale, availableLocales,
}: AdminShellProps) {
  const t = await getTranslations()

  // Icon NAMES (strings) — not component references. A 'use client' module's
  // non-component exports become opaque client references on the server side,
  // so e.g. `NavIcons.Boxes` would evaluate to `undefined` here and crash with
  // "Element type is invalid ... got: undefined" during SSR.
  const groups: { label: string; items: { href: string; label: string; icon: NavIconName }[] }[] = [
    {
      label: t('nav.directory'),
      items: [
        { href: '/apps', label: t('nav.apps'), icon: 'Boxes' },
        { href: '/orgs', label: t('nav.orgs'), icon: 'Building2' },
        { href: '/users', label: t('nav.users'), icon: 'Users' },
      ],
    },
    {
      label: t('nav.accessControl'),
      items: [
        { href: '/roles', label: t('nav.roles'), icon: 'ShieldEllipsis' },
        { href: '/permissions', label: t('nav.permissions'), icon: 'KeyRound' },
      ],
    },
  ]

  return (
    <SidebarShell
      groups={groups}
      currentPath={currentPath}
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
