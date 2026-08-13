import 'dotenv/config';
import { prisma } from '@sassy-auth/db';
import Sqids from 'sqids';
import { auth } from '../auth/auth.config';
import { generatePendingPublicId } from '../common/pending-public-id';

const sqids = new Sqids({
  alphabet: process.env.SQIDS_ALPHABET || undefined,
  minLength: 4,
});

const PLATFORM_PERMISSIONS = [
  'platform.orgs.manage',
  'platform.apps.manage',
  'platform.users.manage',
  'platform.roles.manage',
  'platform.permissions.manage',
  'org.users.manage',
  'org.roles.manage',
] as const;

const ADMIN_PASSWORD = 'Pass@word1234';

type AdminGrant =
  | { kind: 'direct'; permission: string }
  | { kind: 'role'; role: string };

const PLATFORM_ADMINS: ReadonlyArray<{
  email: string;
  firstName: string;
  lastName: string;
  grant: AdminGrant;
}> = [
  { email: 'u@sa.io', firstName: 'Users', lastName: 'Admin', grant: { kind: 'direct', permission: 'platform.users.manage' } },
  { email: 'o@sa.io', firstName: 'Orgs',  lastName: 'Admin', grant: { kind: 'direct', permission: 'platform.orgs.manage' } },
  { email: 'a@sa.io', firstName: 'Apps',  lastName: 'Admin', grant: { kind: 'direct', permission: 'platform.apps.manage' } },
  { email: 'r@sa.io', firstName: 'Roles', lastName: 'Admin', grant: { kind: 'direct', permission: 'platform.roles.manage' } },
  { email: 'p@sa.io', firstName: 'Perms', lastName: 'Admin', grant: { kind: 'direct', permission: 'platform.permissions.manage' } },
  { email: 's@sa.io', firstName: 'Super', lastName: 'Admin', grant: { kind: 'role',   role: 'Platform Super Admin' } },
  { email: 'tfa@sa.io', firstName: 'TwoFactor', lastName: 'Test', grant: { kind: 'direct', permission: 'platform.users.manage' } },
];

const SUPER_ADMIN_ROLE_NAME = 'Platform Super Admin';

async function ensurePlatformSuperAdminRole(platformAppId: number) {
  let role = await prisma.saRole.findFirst({
    where: { name: SUPER_ADMIN_ROLE_NAME, appId: platformAppId },
  });

  if (!role) {
    role = await prisma.$transaction(async (tx) => {
      const created = await tx.saRole.create({
        data: {
          publicId: generatePendingPublicId(),
          name: SUPER_ADMIN_ROLE_NAME,
          appId: platformAppId,
        },
      });
      const publicId = sqids.encode([created.id]);
      return tx.saRole.update({
        where: { id: created.id },
        data: { publicId },
      });
    });
    console.log(`Created role: ${SUPER_ADMIN_ROLE_NAME} (publicId=${role.publicId})`);
  } else {
    console.log(`Role already exists: ${SUPER_ADMIN_ROLE_NAME} (publicId=${role.publicId})`);
  }

  const platformPerms = await prisma.saPermission.findMany({
    where: { appId: platformAppId, name: { startsWith: 'platform.' } },
  });

  for (const perm of platformPerms) {
    await prisma.saRolePermission.upsert({
      where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
      create: { roleId: role.id, permissionId: perm.id },
      update: {},
    });
  }
  console.log(`Role ${SUPER_ADMIN_ROLE_NAME} wired to ${platformPerms.length} platform.* permission(s)`);

  return role;
}

async function seedPlatformAdmin(
  admin: (typeof PLATFORM_ADMINS)[number],
  platformOrgId: number,
  superAdminRoleId: number,
) {
  const existing = await prisma.user.findUnique({ where: { email: admin.email } });
  if (existing) {
    console.log(`Admin already exists: ${admin.email}`);
    return;
  }

  const result = await auth.api.signUpEmail({
    body: {
      email: admin.email,
      password: ADMIN_PASSWORD,
      name: `${admin.firstName} ${admin.lastName}`,
    },
  });
  const baUserId: string = result.user.id;

  await prisma.user.update({
    where: { id: baUserId },
    data: { emailVerified: true },
  });

  const saUser = await prisma.$transaction(async (tx) => {
    const created = await tx.saUser.create({
      data: {
        publicId: generatePendingPublicId(),
        betterAuthUserId: baUserId,
        orgId: platformOrgId,
        firstName: admin.firstName,
        lastName: admin.lastName,
        status: 'active',
        twoFactorPromptedAt: new Date(),
      },
    });
    const publicId = sqids.encode([created.id]);
    return tx.saUser.update({
      where: { id: created.id },
      data: { publicId },
    });
  });

  if (admin.grant.kind === 'direct') {
    const perm = await prisma.saPermission.findUnique({ where: { name: admin.grant.permission } });
    if (!perm) throw new Error(`Permission not found: ${admin.grant.permission}`);
    await prisma.saUserPermission.create({
      data: { userId: saUser.id, permissionId: perm.id },
    });
    console.log(`Created admin ${admin.email} with direct permission ${admin.grant.permission}`);
  } else {
    await prisma.saUserRole.create({
      data: { userId: saUser.id, roleId: superAdminRoleId },
    });
    console.log(`Created admin ${admin.email} with role ${admin.grant.role}`);
  }
}

async function main() {
  console.log('Seeding platform data...');

  // 1. Platform app
  let platformApp = await prisma.saApp.findFirst({ where: { isPlatform: true } });

  if (!platformApp) {
    platformApp = await prisma.$transaction(async (tx) => {
      const created = await tx.saApp.create({
        data: {
          publicId: generatePendingPublicId(),
          name: 'SassyAuth',
          url: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
          isPlatform: true,
        },
      });
      const publicId = sqids.encode([created.id]);
      return tx.saApp.update({
        where: { id: created.id },
        data: { publicId },
      });
    });
    console.log(`Created platform app: id=${platformApp.id}, publicId=${platformApp.publicId}`);
  } else {
    console.log(`Platform app already exists: publicId=${platformApp.publicId}`);
  }

  // 2. Platform org
  let platformOrg = await prisma.saOrg.findFirst({ where: { isPlatform: true } });

  if (!platformOrg) {
    platformOrg = await prisma.$transaction(async (tx) => {
      const created = await tx.saOrg.create({
        data: {
          publicId: generatePendingPublicId(),
          name: 'Platform',
          appId: platformApp!.id,
          isPlatform: true,
        },
      });
      const publicId = sqids.encode([created.id]);
      return tx.saOrg.update({
        where: { id: created.id },
        data: { publicId },
      });
    });
    console.log(`Created platform org: id=${platformOrg.id}, publicId=${platformOrg.publicId}`);
  } else {
    console.log(`Platform org already exists: publicId=${platformOrg.publicId}`);
  }

  // 3. Platform permissions (immutable — create if absent, never rename)
  for (const name of PLATFORM_PERMISSIONS) {
    const isSystem = name.startsWith('org.');
    const existing = await prisma.saPermission.findUnique({ where: { name } });
    if (!existing) {
      await prisma.$transaction(async (tx) => {
        const c = await tx.saPermission.create({
          data: { publicId: generatePendingPublicId(), name, appId: platformApp!.id, isSystem },
        });
        const publicId = sqids.encode([c.id]);
        return tx.saPermission.update({ where: { id: c.id }, data: { publicId } });
      });
      console.log(`Created permission: ${name} (isSystem=${isSystem})`);
    } else {
      // Both fields may need repair on the same row (e.g. after a migration
      // that inserts placeholder publicIds). Combining avoids requiring a
      // second seed run to fix the second field.
      const needsSystemFix = existing.isSystem !== isSystem;
      const needsPublicIdFix = existing.publicId.startsWith('pending-');
      if (needsSystemFix || needsPublicIdFix) {
        const data: { isSystem?: boolean; publicId?: string } = {};
        if (needsSystemFix) data.isSystem = isSystem;
        if (needsPublicIdFix) data.publicId = sqids.encode([existing.id]);
        await prisma.saPermission.update({ where: { id: existing.id }, data });
        if (needsSystemFix) console.log(`Updated permission ${name}: isSystem=${isSystem}`);
        if (needsPublicIdFix)
          console.log(`Backfilled placeholder publicId for ${name}: ${data.publicId}`);
      }
    }
  }

  // 4. Platform Super Admin role
  const superAdminRole = await ensurePlatformSuperAdminRole(platformApp.id);

  // 5. Platform admin users
  for (const admin of PLATFORM_ADMINS) {
    await seedPlatformAdmin(admin, platformOrg.id, superAdminRole.id);
  }

  if (process.env.SEED_DEMO === '1') {
    const { seedDemoResourceServer } = await import('./demo-resource-server');
    await seedDemoResourceServer();
  }

  if (process.env.SEED_DEMO_MULTITENANT === '1') {
    const { seedDemoMultitenant } = await import('./demo-multitenant');
    await seedDemoMultitenant();
  }

  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
