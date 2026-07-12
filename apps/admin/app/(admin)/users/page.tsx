import { getUsers, getOrgs, getMyPermissions, getMyProfile } from '@/lib/api'
import { UsersTable } from '@/components/users-table'
import { AccessDeniedPanel } from '@/components/access-denied-panel'
import type { Org } from '@/lib/types'

interface UsersPageProps {
  searchParams: Promise<{ orgId?: string }>
}

export default async function UsersPage({ searchParams }: UsersPageProps) {
  const { orgId: orgIdParam } = await searchParams

  // bug-0196: switch from bare Promise.all to Promise.allSettled so a
  // failure in one call does not crash the whole page to the generic
  // error.tsx boundary. Also introduces the AccessDeniedPanel gate
  // used by every other admin page (apps, orgs, permissions, roles)
  // — previously the /users page was the odd one out, showing either
  // a full 500 or an empty list to callers who lacked the required
  // permissions.
  const [permsResult, profileResult] = await Promise.allSettled([
    getMyPermissions(),
    getMyProfile(),
  ])
  const perms = permsResult.status === 'fulfilled' ? permsResult.value : []
  const profile = profileResult.status === 'fulfilled' ? profileResult.value : null

  const isPlatformUsers = perms.includes('platform.users.manage')
  const isOrgUsers = perms.includes('org.users.manage')

  if (!isPlatformUsers && !isOrgUsers) return <AccessDeniedPanel />

  // For non-platform callers, default the orgId to their own org if no
  // explicit URL param is set, and ignore any attempt to pass a different
  // orgId — the server will 403 either way, but defaulting cleanly avoids
  // the bare 403 panel on first load.
  const effectiveOrgId = isPlatformUsers
    ? orgIdParam
    : (orgIdParam && profile && orgIdParam === profile.org.id ? orgIdParam : profile?.org.id)

  const [usersResult, orgsResult] = await Promise.allSettled([
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

  // If the primary users query rejected, bubble to error.tsx — the page
  // cannot render without it. A rejected orgs query is survivable
  // (empty orgs → no dropdown → user can still see their own list).
  if (usersResult.status === 'rejected') throw usersResult.reason

  const users = usersResult.value
  const orgsRes = orgsResult.status === 'fulfilled'
    ? orgsResult.value
    : { items: [], total: 0, page: 1, pageSize: 200 }

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
      currentUserId={profile?.userId}
    />
  )
}
