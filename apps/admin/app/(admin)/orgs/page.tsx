import { getOrgs, getApps, getMyPermissions } from '@/lib/api'
import { OrgsTable } from '@/components/orgs-table'
import { AccessDeniedPanel } from '@/components/access-denied-panel'

export default async function OrgsPage() {
  const [permsResult, orgsResult, appsResult] = await Promise.allSettled([
    getMyPermissions(),
    getOrgs({ page: 1, pageSize: 25 }),
    getApps({ page: 1, pageSize: 200 }),
  ])
  const perms = permsResult.status === 'fulfilled' ? permsResult.value : []
  const canManage = perms.includes('platform.orgs.manage')

  if (!canManage) return <AccessDeniedPanel />
  if (orgsResult.status === 'rejected') throw orgsResult.reason
  if (appsResult.status === 'rejected') throw appsResult.reason

  return <OrgsTable initial={orgsResult.value} apps={appsResult.value.items} />
}
