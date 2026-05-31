import { getPermissions, getApps, getMyPermissions } from '@/lib/api'
import { PermissionsTable } from '@/components/permissions-table'
import { AccessDeniedPanel } from '@/components/access-denied-panel'

export default async function PermissionsPage() {
  const [permsResult, listResult, appsResult] = await Promise.allSettled([
    getMyPermissions(),
    getPermissions({ page: 1, pageSize: 25 }),
    getApps({ page: 1, pageSize: 200 }),
  ])
  const perms = permsResult.status === 'fulfilled' ? permsResult.value : []
  const canManage = perms.includes('platform.permissions.manage')

  if (!canManage) return <AccessDeniedPanel />
  if (listResult.status === 'rejected') throw listResult.reason
  if (appsResult.status === 'rejected') throw appsResult.reason

  return <PermissionsTable initial={listResult.value} apps={appsResult.value.items} />
}
