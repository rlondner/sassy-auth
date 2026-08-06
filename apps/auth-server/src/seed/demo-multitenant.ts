import { prisma } from '@sassy-auth/db';
import Sqids from 'sqids';
import { auth } from '../auth/auth.config';
import { generatePendingPublicId } from '../common/pending-public-id';

const sqids = new Sqids({
  alphabet: process.env.SQIDS_ALPHABET || undefined,
  minLength: 4,
});

const APP_NAME = 'app01';
const APP_URL = 'http://localhost:4000';
const PASSWORD = 'Pass@word1234';

const APP_PERMISSIONS = ['contracts.read', 'contracts.create'] as const;
const ORGS = ['Acme', 'Globex'] as const;

interface UserSeed {
  email: string;
  firstName: string;
  lastName: string;
  org: typeof ORGS[number];
  /** Direct system perm granted (currently only org.users.manage for the two admins). */
  systemPerm?: 'org.users.manage';
}

const USERS: readonly UserSeed[] = [
  { email: 'acme-admin@app01.io',   firstName: 'Acme',   lastName: 'Admin',    org: 'Acme',   systemPerm: 'org.users.manage' },
  { email: 'acme-alice@app01.io',   firstName: 'Acme',   lastName: 'Alice',    org: 'Acme' },
  { email: 'acme-bob@app01.io',     firstName: 'Acme',   lastName: 'Bob',      org: 'Acme' },
  { email: 'globex-admin@app01.io', firstName: 'Globex', lastName: 'Admin',    org: 'Globex', systemPerm: 'org.users.manage' },
  { email: 'globex-gina@app01.io',  firstName: 'Globex', lastName: 'Gina',     org: 'Globex' },
  { email: 'globex-greg@app01.io',  firstName: 'Globex', lastName: 'Greg',     org: 'Globex' },
];

async function ensureApp() {
  const found = await prisma.saApp.findUnique({ where: { name: APP_NAME } });
  if (found) return found;
  return prisma.$transaction(async (tx) => {
    const created = await tx.saApp.create({
      data: { publicId: generatePendingPublicId(), name: APP_NAME, url: APP_URL, isPlatform: false },
    });
    return tx.saApp.update({
      where: { id: created.id },
      data: { publicId: sqids.encode([created.id]) },
    });
  });
}

async function ensureOrg(appId: number, name: string) {
  const found = await prisma.saOrg.findFirst({ where: { appId, name } });
  if (found) return found;
  return prisma.$transaction(async (tx) => {
    const created = await tx.saOrg.create({
      data: { publicId: generatePendingPublicId(), name, appId, isPlatform: false },
    });
    return tx.saOrg.update({
      where: { id: created.id },
      data: { publicId: sqids.encode([created.id]) },
    });
  });
}

async function ensureAppPermission(appId: number, name: string) {
  let perm = await prisma.saPermission.findUnique({ where: { name } });
  if (perm) return perm;
  perm = await prisma.$transaction(async (tx) => {
    const c = await tx.saPermission.create({
      data: { publicId: generatePendingPublicId(), name, appId, isSystem: false },
    });
    return tx.saPermission.update({
      where: { id: c.id },
      data: { publicId: sqids.encode([c.id]) },
    });
  });
  return perm;
}

async function ensureUser(seed: UserSeed, orgIdByName: Record<string, number>, sysPermByName: Record<string, number>) {
  const existing = await prisma.user.findUnique({ where: { email: seed.email } });
  let baUserId: string;
  if (existing) {
    baUserId = existing.id;
  } else {
    const result = await auth.api.signUpEmail({
      body: { email: seed.email, password: PASSWORD, name: `${seed.firstName} ${seed.lastName}` },
    });
    baUserId = result.user.id;
    await prisma.user.update({ where: { id: baUserId }, data: { emailVerified: true } });
  }

  let saUser = await prisma.saUser.findFirst({ where: { betterAuthUserId: baUserId } });
  if (!saUser) {
    saUser = await prisma.$transaction(async (tx) => {
      const c = await tx.saUser.create({
        data: {
          publicId: generatePendingPublicId(),
          betterAuthUserId: baUserId,
          orgId: orgIdByName[seed.org],
          firstName: seed.firstName,
          lastName: seed.lastName,
          status: 'active',
          twoFactorPromptedAt: new Date(),
        },
      });
      return tx.saUser.update({
        where: { id: c.id },
        data: { publicId: sqids.encode([c.id]) },
      });
    });
  }

  if (seed.systemPerm) {
    await prisma.saUserPermission.upsert({
      where: {
        userId_permissionId: {
          userId: saUser.id,
          permissionId: sysPermByName[seed.systemPerm],
        },
      },
      create: { userId: saUser.id, permissionId: sysPermByName[seed.systemPerm] },
      update: {},
    });
  }
}

export async function seedDemoMultitenant() {
  console.log('[demo-mt] Seeding app01 multi-tenant scenario...');
  const app = await ensureApp();
  const orgRows = await Promise.all(ORGS.map((name) => ensureOrg(app.id, name)));
  const orgIdByName: Record<string, number> = Object.fromEntries(
    ORGS.map((n, i) => [n, orgRows[i].id]),
  );

  for (const name of APP_PERMISSIONS) {
    await ensureAppPermission(app.id, name);
  }

  // org.users.manage is seeded by the platform seed (system perm in the platform app).
  const orgUsersPerm = await prisma.saPermission.findUnique({ where: { name: 'org.users.manage' } });
  if (!orgUsersPerm) throw new Error('seedDemoMultitenant requires org.users.manage to exist');
  const sysPermByName: Record<string, number> = { 'org.users.manage': orgUsersPerm.id };

  for (const u of USERS) {
    await ensureUser(u, orgIdByName, sysPermByName);
  }
  console.log('[demo-mt] Done.');
}
