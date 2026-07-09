/**
 * Mirrors apps/auth-server/test/matrix/permissions-matrix.ts.
 * Duplicated intentionally — admin-e2e must not depend on the auth-server build graph.
 * Keep the two files in sync by convention when seed grants change.
 */

// bug-0016: allow overriding the seeded admin password via env for CI/secret
// injection, falling back to the well-known local seed value.
export const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'Pass@word1234'

export type AdminKey = 'apps' | 'orgs' | 'users' | 'roles' | 'perms' | 'super'

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
    key: 'roles',
    email: 'r@sa.io',
    perms: ['platform.roles.manage'],
    storageStatePath: '.auth/roles-admin.json',
    projectName: 'chromium-roles',
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
      'platform.roles.manage',
      'platform.permissions.manage',
      'org.users.manage',
      'org.roles.manage',
    ],
    storageStatePath: '.auth/super-admin.json',
    projectName: 'chromium-super',
  },
]

/**
 * Demo multi-tenant tenant users (seeded by SEED_DEMO_MULTITENANT=1 against
 * apps/auth-server/src/seed/demo-multitenant.ts). The two *-admin users hold
 * `org.users.manage`; the rest are unprivileged tenant members. Used by
 * tests that exercise the tenant-admin promotion / visibility path.
 */
export const DEMO_TENANT_USERS = {
  acmeAdmin:   { email: 'acme-admin@app01.io',   password: 'Pass@word1234' },
  acmeAlice:   { email: 'acme-alice@app01.io',   password: 'Pass@word1234' },
  acmeBob:     { email: 'acme-bob@app01.io',     password: 'Pass@word1234' },
  globexAdmin: { email: 'globex-admin@app01.io', password: 'Pass@word1234' },
} as const

export type ResourceArea = 'apps' | 'orgs' | 'roles' | 'permissions' | 'users'

const AREA_TO_PERMS: Record<ResourceArea, readonly string[]> = {
  apps:        ['platform.apps.manage'],
  orgs:        ['platform.orgs.manage', 'org.users.manage'],
  // The admin /roles page reads with platform.roles.manage | org.roles.manage
  // (see app/(admin)/roles/page.tsx). The perms admin (platform.permissions.manage)
  // is correctly denied, so roles must map to the roles.manage perms.
  roles:       ['platform.roles.manage', 'org.roles.manage'],
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
