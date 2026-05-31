import { getTranslations } from 'next-intl/server'
import { SidebarShell, NavIcons } from './sidebar-shell'

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

  const groups = [
    {
      label: t('nav.directory'),
      items: [
        { href: '/apps', label: t('nav.apps'), icon: NavIcons.Boxes },
        { href: '/orgs', label: t('nav.orgs'), icon: NavIcons.Building2 },
        { href: '/users', label: t('nav.users'), icon: NavIcons.Users },
      ],
    },
    {
      label: t('nav.accessControl'),
      items: [
        { href: '/roles', label: t('nav.roles'), icon: NavIcons.ShieldEllipsis },
        { href: '/permissions', label: t('nav.permissions'), icon: NavIcons.KeyRound },
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
