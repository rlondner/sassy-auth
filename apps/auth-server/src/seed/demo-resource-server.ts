import { prisma } from '@sassy-auth/db';
import Sqids from 'sqids';
import { auth } from '../auth/auth.config';
import { generatePendingPublicId } from '../common/pending-public-id';
import { resolveSeedPassword } from './seed-password';

const sqids = new Sqids({
  alphabet: process.env.SQIDS_ALPHABET || undefined,
  minLength: 4,
});

const APP_NAME = 'resourceserver01';
const APP_URL = process.env['RS_APP_URL'] ?? 'https://cheryl-crescentlike-monte.ngrok-free.dev/';
const CALLBACK_URL = new URL('/auth/callback', APP_URL).toString();
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
  // Dedicated 2FA account, mirroring why tfa@sa.io exists for the platform app:
  // enrolling any of the other demo users would leave them enrolled for every
  // later spec in the same run, and the e2e suite signs in as m@cpm.io expecting
  // no TOTP challenge. Kept in this org because /api/token/oauth/authorize
  // refuses a caller whose org belongs to a different app, so the 2FA
  // round-trip needs an enrolled user scoped to *this* app.
  //
  // Property Managers so its JWT carries rs.properties.create — the amr test
  // asserts on the token it gets back, not just on reaching the callback.
  {
    email: 'tfa@cpm.io',
    firstName: 'Citadel',
    lastName: 'TwoFactor',
    role: ROLE_PROPERTY_MANAGERS,
  },
  // Link target for the federated round-trip. Deliberately separate from
  // m@cpm.io: linking a provider account to that user would persist across
  // specs and change what the password round-trip exercises.
  {
    email: 'social@cpm.io',
    firstName: 'Citadel',
    lastName: 'Social',
    role: ROLE_PROPERTY_MANAGERS,
  },
] as const;

const PASSWORD = resolveSeedPassword();

async function ensureApp() {
  const found = await prisma.saApp.findUnique({ where: { name: APP_NAME } });
  if (found) return found;
  return prisma.$transaction(async (tx) => {
    const created = await tx.saApp.create({
      data: { publicId: generatePendingPublicId(), name: APP_NAME, url: APP_URL, callbackUrl: CALLBACK_URL, isPlatform: false },
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
  return prisma.$transaction(async (tx) => {
    const created = await tx.saOrg.create({
      data: { publicId: generatePendingPublicId(), name: ORG_NAME, appId, isPlatform: false },
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
      perm = await prisma.$transaction(async (tx) => {
        const c = await tx.saPermission.create({
          data: { publicId: generatePendingPublicId(), name, appId },
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
    role = await prisma.$transaction(async (tx) => {
      const c = await tx.saRole.create({
        data: { publicId: generatePendingPublicId(), name: roleName, appId },
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
    saUser = await prisma.$transaction(async (tx) => {
      const c = await tx.saUser.create({
        data: {
          publicId: generatePendingPublicId(),
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

  // Enable the e2e stub provider for this app. Google/Microsoft/Apple inherit
  // the deployment-global rows, so nothing app-specific is needed for them.
  // The stub is only ever *available* when E2E_STUB_IDP_URL is set (and
  // NODE_ENV is 'test' or 'development'), so this row is inert everywhere
  // else — seeding it only under the same condition keeps that intent explicit.
  if (process.env.E2E_STUB_IDP_URL) {
    await prisma.saSocialProvider.upsert({
      where: { appId_provider: { appId: app.id, provider: 'stub' } },
      create: { appId: app.id, provider: 'stub', enabled: true },
      update: { enabled: true },
    });
  }

  console.log('[demo] Done.');
}
