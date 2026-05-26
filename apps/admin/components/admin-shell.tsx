import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { UserAvatar } from '@sassy-auth/ui'
import { LocaleSwitcher } from './locale-switcher'
import { signOutAction } from '@/app/(admin)/actions'

interface NavItem {
  href: string
  labelKey: string
  icon: string
  section?: string
}

const NAV_ITEMS: NavItem[] = [
  { href: '/apps', labelKey: 'nav.apps', icon: 'apps', section: 'nav.directory' },
  { href: '/orgs', labelKey: 'nav.orgs', icon: 'corporate_fare' },
  { href: '/users', labelKey: 'nav.users', icon: 'group' },
  { href: '/roles', labelKey: 'nav.roles', icon: 'verified_user', section: 'nav.accessControl' },
  { href: '/permissions', labelKey: 'nav.permissions', icon: 'vpn_key' },
]

interface AdminShellProps {
  children: React.ReactNode
  currentPath: string
  user: { firstName: string; lastName: string; email: string }
  currentLocale: string
  availableLocales: string[]
}

export async function AdminShell({ children, currentPath, user, currentLocale, availableLocales }: AdminShellProps) {
  const t = await getTranslations()

  let lastSection = ''

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="flex w-pane-nav flex-shrink-0 flex-col bg-[var(--sidebar-bg)]">
        {/* Logo */}
        <div className="border-b border-white/10 px-5 py-5">
          <div className="text-headline-sm font-bold text-[var(--sidebar-fg)]">SassyAuth</div>
          <div className="text-label-sm text-[var(--sidebar-fg)]/60">Admin Console</div>
          <div className="mt-3">
            <LocaleSwitcher currentLocale={currentLocale} availableLocales={availableLocales} />
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-4">
          {NAV_ITEMS.map((item) => {
            const isActive = currentPath.startsWith(item.href)
            const showSection = item.section && item.section !== lastSection
            if (showSection) lastSection = item.section!

            return (
              <div key={item.href}>
                {showSection && (
                  <p className="px-5 pb-1 pt-4 text-label-sm font-bold tracking-wider text-[var(--sidebar-fg)]/40 uppercase">
                    {t(item.section!)}
                  </p>
                )}
                <Link
                  href={item.href}
                  className={`flex items-center gap-3 py-2.5 text-body-sm transition-colors ${
                    isActive
                      ? 'border-l-2 border-[var(--sidebar-active-border)] bg-white/5 pl-4 text-[var(--sidebar-active-fg)] font-semibold'
                      : 'pl-5 text-[var(--sidebar-fg)]/70 hover:bg-white/5 hover:text-[var(--sidebar-fg)]'
                  }`}
                >
                  <span
                    className="material-symbols-outlined text-[20px]"
                    style={isActive ? { fontVariationSettings: "'FILL' 1" } : undefined}
                  >
                    {item.icon}
                  </span>
                  {t(item.labelKey)}
                </Link>
              </div>
            )
          })}
        </nav>

        {/* Bottom: user + sign out */}
        <div className="border-t border-white/10 p-4">
          <div className="flex items-center gap-3">
            <UserAvatar firstName={user.firstName} lastName={user.lastName} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-label-md font-semibold text-[var(--sidebar-fg)]">
                {user.firstName} {user.lastName}
              </p>
              <p className="truncate text-label-sm text-[var(--sidebar-fg)]/60">{user.email}</p>
            </div>
            <form action={signOutAction}>
              <button type="submit" className="text-[var(--sidebar-fg)]/60 hover:text-[var(--sidebar-fg)]" title={t('nav.signOut')}>
                <span className="material-symbols-outlined text-[20px]">logout</span>
              </button>
            </form>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  )
}
