/**
 * Mirrors apps/auth-server/test/matrix/permissions-matrix.ts.
 * Duplicated intentionally — admin-e2e must not depend on the auth-server build graph.
 * Keep the two files in sync by convention when seed grants change.
 */

export const ADMIN_PASSWORD = 'Pass@word1234'

export type AdminKey = 'apps' | 'orgs' | 'users' | 'perms' | 'super'

export interface SeedAdmin {
  key: AdminKey
  email: string
  perms: readonly string[]
  storageStatePath: string
  projectName: string
}

export const SEED_ADMINS: readonly SeedAdmin[] = [
  {
    key: 'apps',
    email: 'a@sa.io',
    perms: ['platform.apps.manage'],
    storageStatePath: '.auth/apps-admin.json',
    projectName: 'chromium-apps',
  },
  {
    key: 'orgs',
    email: 'o@sa.io',
    perms: ['platform.orgs.manage'],
    storageStatePath: '.auth/orgs-admin.json',
    projectName: 'chromium-orgs',
  },
  {
    key: 'users',
    email: 'u@sa.io',
    perms: ['platform.users.manage'],
    storageStatePath: '.auth/users-admin.json',
    projectName: 'chromium-users',
  },
  {
    key: 'perms',
    email: 'p@sa.io',
    perms: ['platform.permissions.manage'],
    storageStatePath: '.auth/perms-admin.json',
    projectName: 'chromium-perms',
  },
  {
    key: 'super',
    email: 's@sa.io',
    perms: [
      'platform.apps.manage',
      'platform.orgs.manage',
      'platform.users.manage',
      'platform.permissions.manage',
      'org.users.manage',
      'org.permissions.manage',
    ],
    storageStatePath: '.auth/super-admin.json',
    projectName: 'chromium-super',
  },
]

export type ResourceArea = 'apps' | 'orgs' | 'roles' | 'permissions' | 'users'

const AREA_TO_PERMS: Record<ResourceArea, readonly string[]> = {
  apps:        ['platform.apps.manage'],
  orgs:        ['platform.orgs.manage', 'org.users.manage'],
  roles:       ['platform.permissions.manage', 'org.permissions.manage'],
  permissions: ['platform.permissions.manage'],
  users:       ['platform.users.manage', 'org.users.manage'],
}

/** True if this admin has the manage permission for the area's full CRUD. */
export function permittedForArea(admin: SeedAdmin, area: ResourceArea): boolean {
  return AREA_TO_PERMS[area].some((p) => admin.perms.includes(p))
}

/** Map a Playwright project name back to its SeedAdmin. */
export function adminFromProject(projectName: string): SeedAdmin {
  const a = SEED_ADMINS.find((x) => x.projectName === projectName)
  if (!a) throw new Error(`Unknown admin project: ${projectName}`)
  return a
}
