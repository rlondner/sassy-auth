import { getUsers, getOrgs, getMyPermissions, getMyProfile } from '@/lib/api'
import { UsersTable } from '@/components/users-table'
import type { Org } from '@/lib/types'

interface UsersPageProps {
  searchParams: Promise<{ orgId?: string }>
}

export default async function UsersPage({ searchParams }: UsersPageProps) {
  const { orgId: orgIdParam } = await searchParams
  const [perms, profile] = await Promise.all([
    getMyPermissions().catch(() => [] as string[]),
    getMyProfile().catch(() => null),
  ])

  const isPlatformUsers = perms.includes('platform.users.manage')

  // For non-platform callers, default the orgId to their own org if no
  // explicit URL param is set, and ignore any attempt to pass a different
  // orgId — the server will 403 either way, but defaulting cleanly avoids
  // the bare 403 panel on first load.
  const effectiveOrgId = isPlatformUsers
    ? orgIdParam
    : (orgIdParam && profile && orgIdParam === profile.org.id ? orgIdParam : profile?.org.id)

  const [users, orgsRes] = await Promise.all([
    getUsers(effectiveOrgId ? { orgId: effectiveOrgId } : undefined),
    isPlatformUsers
      ? getOrgs({ pageSize: 200 })
      : Promise.resolve({
          items: profile
            ? [{
                publicId: profile.org.id,
                name: profile.org.name,
                app: { publicId: profile.app.id, name: profile.app.name },
                isPlatform: profile.org.isPlatform,
                userCount: 0,
              }]
            : [],
          total: 0,
          page: 1,
          pageSize: 200,
        }),
  ])

  const orgs: Org[] = orgsRes.items.map((o) => ({
    id: o.publicId,
    name: o.name,
    appId: o.app.publicId,
    isPlatform: o.isPlatform,
  }))
  return (
    <UsersTable
      users={users}
      orgs={orgs}
      initialOrgId={effectiveOrgId}
      canPickOrg={isPlatformUsers}
    />
  )
}
