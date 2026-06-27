// @ts-nocheck
import { prisma } from '@sassy-auth/db';
import Sqids from 'sqids';
import { auth } from '../auth/auth.config';

const sqids = new Sqids({
  alphabet: process.env.SQIDS_ALPHABET || undefined,
  minLength: 4,
});

const APP_NAME = 'resourceserver01';
const APP_URL = 'https://cheryl-crescentlike-monte.ngrok-free.dev/';
const ORG_NAME = 'Citadel';

const PERMISSIONS = [
  'rs.properties.create',
  'rs.properties.read',
  'rs.properties.update',
  'rs.properties.delete',
  'rs.inspections.create',
  'rs.inspections.read',
  'rs.inspections.update',
  'rs.inspections.delete',
] as const;

const ROLE_PROPERTY_MANAGERS = 'Citadel Property Managers';
const ROLE_INSPECTORS = 'Citadel Inspectors';

const ROLE_PERMS: Record<string, readonly string[]> = {
  [ROLE_PROPERTY_MANAGERS]: PERMISSIONS, // all 8
  [ROLE_INSPECTORS]: [
    'rs.inspections.create',
    'rs.inspections.read',
    'rs.inspections.update',
    'rs.properties.read',
    'rs.properties.update',
  ],
};

const USERS = [
  {
    email: 'm@cpm.io',
    firstName: 'Citadel',
    lastName: 'Manager',
    role: ROLE_PROPERTY_MANAGERS,
  },
  {
    email: 'i@cpm.io',
    firstName: 'Citadel',
    lastName: 'Inspector',
    role: ROLE_INSPECTORS,
  },
] as const;

const PASSWORD = 'Pass@word1234';

async function ensureApp() {
  const found = await prisma.saApp.findUnique({ where: { name: APP_NAME } });
  if (found) return found;
  return prisma.$transaction(async (tx: any) => {
    const created = await tx.saApp.create({
      data: { publicId: 'placeholder', name: APP_NAME, url: APP_URL, isPlatform: false },
    });
    return tx.saApp.update({
      where: { id: created.id },
      data: { publicId: sqids.encode([created.id]) },
    });
  });
}

async function ensureOrg(appId: number) {
  const found = await prisma.saOrg.findFirst({ where: { appId, name: ORG_NAME } });
  if (found) return found;
  return prisma.$transaction(async (tx: any) => {
    const created = await tx.saOrg.create({
      data: { publicId: 'placeholder', name: ORG_NAME, appId, isPlatform: false },
    });
    return tx.saOrg.update({
      where: { id: created.id },
      data: { publicId: sqids.encode([created.id]) },
    });
  });
}

async function ensurePermissions(appId: number) {
  const out = new Map<string, { id: number }>();
  for (const name of PERMISSIONS) {
    let perm = await prisma.saPermission.findUnique({ where: { name } });
    if (!perm) {
      perm = await prisma.$transaction(async (tx: any) => {
        const c = await tx.saPermission.create({
          data: { publicId: 'placeholder', name, appId },
        });
        return tx.saPermission.update({
          where: { id: c.id },
          data: { publicId: sqids.encode([c.id]) },
        });
      });
    }
    out.set(name, { id: perm.id });
  }
  return out;
}

async function ensureRole(
  appId: number,
  roleName: string,
  permIds: number[],
) {
  let role = await prisma.saRole.findFirst({ where: { appId, name: roleName } });
  if (!role) {
    role = await prisma.$transaction(async (tx: any) => {
      const c = await tx.saRole.create({
        data: { publicId: 'placeholder', name: roleName, appId },
      });
      return tx.saRole.update({
        where: { id: c.id },
        data: { publicId: sqids.encode([c.id]) },
      });
    });
  }
  for (const permissionId of permIds) {
    await prisma.saRolePermission.upsert({
      where: { roleId_permissionId: { roleId: role.id, permissionId } },
      create: { roleId: role.id, permissionId },
      update: {},
    });
  }
  return role;
}

async function ensureUser(
  email: string,
  firstName: string,
  lastName: string,
  orgId: number,
  roleId: number,
) {
  const existing = await prisma.user.findUnique({ where: { email } });
  let baUserId: string;
  if (existing) {
    baUserId = existing.id;
  } else {
    const result = await auth.api.signUpEmail({
      body: { email, password: PASSWORD, name: `${firstName} ${lastName}` },
    });
    baUserId = result.user.id;
    await prisma.user.update({ where: { id: baUserId }, data: { emailVerified: true } });
  }

  let saUser = await prisma.saUser.findFirst({ where: { betterAuthUserId: baUserId } });
  if (!saUser) {
    saUser = await prisma.$transaction(async (tx: any) => {
      const c = await tx.saUser.create({
        data: {
          publicId: 'placeholder',
          betterAuthUserId: baUserId,
          orgId,
          firstName,
          lastName,
          status: 'active',
        },
      });
      return tx.saUser.update({
        where: { id: c.id },
        data: { publicId: sqids.encode([c.id]) },
      });
    });
  }

  await prisma.saUserRole.upsert({
    where: { userId_roleId: { userId: saUser.id, roleId } },
    create: { userId: saUser.id, roleId },
    update: {},
  });
}

export async function seedDemoResourceServer() {
  console.log('[demo] Seeding resourceserver01 demo data...');
  const app = await ensureApp();
  const org = await ensureOrg(app.id);
  const perms = await ensurePermissions(app.id);

  const rolePM = await ensureRole(
    app.id,
    ROLE_PROPERTY_MANAGERS,
    ROLE_PERMS[ROLE_PROPERTY_MANAGERS].map((n) => perms.get(n)!.id),
  );
  const roleIns = await ensureRole(
    app.id,
    ROLE_INSPECTORS,
    ROLE_PERMS[ROLE_INSPECTORS].map((n) => perms.get(n)!.id),
  );
  const rolesByName: Record<string, number> = {
    [ROLE_PROPERTY_MANAGERS]: rolePM.id,
    [ROLE_INSPECTORS]: roleIns.id,
  };

  for (const u of USERS) {
    await ensureUser(u.email, u.firstName, u.lastName, org.id, rolesByName[u.role]);
  }
  console.log('[demo] Done.');
}
