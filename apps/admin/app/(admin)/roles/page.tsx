import { getRoles, getApps, getMyPermissions } from '@/lib/api'
import { RolesTable } from '@/components/roles-table'
import { AccessDeniedPanel } from '@/components/access-denied-panel'

export default async function RolesPage() {
  const [permsResult, listResult, appsResult] = await Promise.allSettled([
    getMyPermissions(),
    getRoles({ page: 1, pageSize: 25 }),
    getApps({ page: 1, pageSize: 200 }),
  ])
  const perms = permsResult.status === 'fulfilled' ? permsResult.value : []
  const canManage = perms.includes('platform.permissions.manage') || perms.includes('org.permissions.manage')

  if (!canManage) return <AccessDeniedPanel />
  if (listResult.status === 'rejected') throw listResult.reason
  if (appsResult.status === 'rejected') throw appsResult.reason

  return <RolesTable initial={listResult.value} apps={appsResult.value.items} />
}
