import { getRoles, getApps, getMyPermissions, getMyProfile } from '@/lib/api'
import { RolesTable } from '@/components/roles-table'
import { AccessDeniedPanel } from '@/components/access-denied-panel'

export default async function RolesPage() {
  const [permsResult, profileResult] = await Promise.allSettled([
    getMyPermissions(),
    getMyProfile(),
  ])
  const perms = permsResult.status === 'fulfilled' ? permsResult.value : []
  const profile = profileResult.status === 'fulfilled' ? profileResult.value : null

  const canRead = perms.includes('platform.roles.manage') || perms.includes('org.roles.manage')
  const canWrite = perms.includes('platform.roles.manage')
  if (!canRead) return <AccessDeniedPanel />

  const isPlatformRoles = canWrite
  const effectiveAppId = isPlatformRoles ? undefined : profile?.app.id

  const [listResult, appsResult] = await Promise.allSettled([
    getRoles({ page: 1, pageSize: 25, ...(effectiveAppId ? { appId: effectiveAppId } : {}) }),
    isPlatformRoles
      ? getApps({ page: 1, pageSize: 200 })
      : Promise.resolve({
          items: profile
            ? [{ publicId: profile.app.id, name: profile.app.name, url: '', isPlatform: profile.app.isPlatform, requireTwoFactor: false }]
            : [],
          total: 0,
          page: 1,
          pageSize: 200,
        }),
  ])

  if (listResult.status === 'rejected') throw listResult.reason
  if (appsResult.status === 'rejected') throw appsResult.reason

  return (
    <RolesTable
      initial={listResult.value}
      apps={appsResult.value.items}
      canWrite={canWrite}
      canPickApp={isPlatformRoles}
    />
  )
}
