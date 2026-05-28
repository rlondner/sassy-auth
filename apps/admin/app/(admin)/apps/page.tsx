import { getApps, getMyPermissions } from '@/lib/api'
import { AppsTable } from '@/components/apps-table'
import { AccessDeniedPanel } from '@/components/access-denied-panel'

export default async function AppsPage() {
  const [permsResult, appsResult] = await Promise.allSettled([
    getMyPermissions(),
    getApps({ page: 1, pageSize: 25 }),
  ])
  const perms = permsResult.status === 'fulfilled' ? permsResult.value : []
  const canManage = perms.includes('platform.apps.manage')

  if (!canManage) return <AccessDeniedPanel />
  if (appsResult.status === 'rejected') throw appsResult.reason
  return <AppsTable initial={appsResult.value} />
}
