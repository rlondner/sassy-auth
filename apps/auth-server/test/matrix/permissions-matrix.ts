/**
 * Single source of truth for which seeded admin can do what.
 * Mirrors apps/auth-server/src/seed/seed.ts. If seed changes, this
 * file changes — every matrix spec re-derives expected outcomes here.
 */

export const ADMIN_PASSWORD = 'Pass@word1234';

export type AdminKey = 'apps' | 'orgs' | 'users' | 'roles' | 'perms' | 'super';

export interface SeedAdmin {
  key: AdminKey;
  email: string;
  /** Direct permission(s) held. 'super' holds all platform.*  via the role. */
  perms: readonly string[];
}

export const SEED_ADMINS: readonly SeedAdmin[] = [
  { key: 'apps',  email: 'a@sa.io', perms: ['platform.apps.manage'] },
  { key: 'orgs',  email: 'o@sa.io', perms: ['platform.orgs.manage'] },
  { key: 'users', email: 'u@sa.io', perms: ['platform.users.manage'] },
  { key: 'roles', email: 'r@sa.io', perms: ['platform.roles.manage'] },
  { key: 'perms', email: 'p@sa.io', perms: ['platform.permissions.manage'] },
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
  },
];

export type ResourceArea = 'apps' | 'orgs' | 'roles' | 'permissions' | 'users';

export type Op =
  | 'list' | 'get' | 'create' | 'update' | 'delete'
  /* /users sub-routes */
  | 'getRoles' | 'effectivePermissions' | 'assignRole' | 'removeRole' | 'resendInvitation';

/** Which permission gates each (area, op). Derived from each service's checkPermission call. */
const GATE: Record<ResourceArea, Partial<Record<Op, readonly string[]>>> = {
  apps: {
    list:   ['platform.apps.manage', 'platform.orgs.manage', 'platform.permissions.manage', 'platform.roles.manage'],
    create: ['platform.apps.manage'],
    update: ['platform.apps.manage'],
    delete: ['platform.apps.manage'],
  },
  orgs: {
    list:   ['platform.orgs.manage', 'platform.users.manage', 'org.users.manage'],
    get:    ['platform.orgs.manage', 'platform.users.manage', 'org.users.manage'],
    create: ['platform.orgs.manage'],
    update: ['platform.orgs.manage'],
    delete: ['platform.orgs.manage'],
  },
  roles: {
    list:   ['platform.roles.manage', 'org.roles.manage'],
    get:    ['platform.roles.manage', 'org.roles.manage'],
    create: ['platform.roles.manage'],
    update: ['platform.roles.manage'],
    delete: ['platform.roles.manage'],
  },
  permissions: {
    list:   ['platform.permissions.manage', 'platform.users.manage'],
    get:    ['platform.permissions.manage', 'platform.users.manage'],
    create: ['platform.permissions.manage'],
    update: ['platform.permissions.manage'],
    delete: ['platform.permissions.manage'],
  },
  users: {
    list:                 ['platform.users.manage', 'org.users.manage'],
    get:                  ['platform.users.manage', 'org.users.manage'],
    create:               ['platform.users.manage', 'org.users.manage'],
    update:               ['platform.users.manage', 'org.users.manage'],
    delete:               ['platform.users.manage'], // strictest: delete only platform-wide
    getRoles:             ['platform.users.manage', 'org.users.manage'],
    effectivePermissions: ['platform.users.manage', 'org.users.manage'],
    assignRole:           ['platform.users.manage', 'org.users.manage'],
    removeRole:           ['platform.users.manage', 'org.users.manage'],
    resendInvitation:     ['platform.users.manage', 'org.users.manage'],
  },
};

/** True if this seeded admin is permitted on (area, op). */
export function isPermitted(admin: SeedAdmin, area: ResourceArea, op: Op): boolean {
  const required = GATE[area][op];
  if (!required) return false;
  return required.some((perm) => admin.perms.includes(perm));
}

/** Convenience: returns all admins permitted on (area, op). */
export function permittedAdmins(area: ResourceArea, op: Op): readonly SeedAdmin[] {
  return SEED_ADMINS.filter((a) => isPermitted(a, area, op));
}
