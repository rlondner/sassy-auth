import { getUsers, getOrgs } from '@/lib/api'
import { UsersTable } from '@/components/users-table'
import type { Org } from '@/lib/types'

interface UsersPageProps {
  searchParams: Promise<{ orgId?: string }>
}

export default async function UsersPage({ searchParams }: UsersPageProps) {
  const { orgId } = await searchParams
  const [users, orgsRes] = await Promise.all([
    getUsers(orgId ? { orgId } : undefined),
    getOrgs({ pageSize: 200 }),
  ])
  const orgs: Org[] = orgsRes.items.map((o) => ({
    id: o.publicId,
    name: o.name,
    appId: o.app.publicId,
    isPlatform: o.isPlatform,
  }))
  return <UsersTable users={users} orgs={orgs} initialOrgId={orgId} />
}
