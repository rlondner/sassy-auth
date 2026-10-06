import 'dotenv/config';
import { prisma } from '@sassy-auth/db';

/**
 * Deletes leftover e2e/lifecycle test data from the dev database: apps,
 * orgs, roles, permissions and users created by Playwright/Jest specs that
 * either crashed mid-run or deliberately skip cleanup (e.g.
 * apps/admin-e2e/tests/authed/lifecycle.spec.ts and the companion
 * "Lifecycle: provision app+perm+org+role+user..." block in
 * apps/auth-server/test/app.e2e-spec.ts both name entities
 * `*e2e*`/`*Lifecycle*` with a timestamp suffix and never delete them).
 *
 * Dry-run by default — prints what would be deleted. Pass --apply to commit.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register src/seed/cleanup-e2e-data.ts
 *   npx ts-node -r tsconfig-paths/register src/seed/cleanup-e2e-data.ts --apply
 */

if ((process.env.NODE_ENV ?? 'development') === 'production') {
  console.error('Refusing to run cleanup-e2e-data against NODE_ENV=production.');
  process.exit(1);
}

const APPLY = process.argv.includes('--apply');

// Permanent fixtures that happen to match the e2e/lifecycle name patterns
// below but must never be deleted.
const KEEP_APP_NAMES = ['SassyAuth', 'E2E OIDC Client'];
const KEEP_ORG_NAMES = ['Platform', 'E2E OIDC Org'];
const KEEP_ROLE_NAMES = ['Platform Super Admin'];
const KEEP_EMAIL_DOMAINS = ['@sa.io'];
const KEEP_EMAILS = ['contact@milissai.com'];

const NAME_PATTERN_SQL = (col: string) => `(${col} ILIKE '%e2e%' OR ${col} ILIKE '%lifecycle%')`;

function isKeptEmail(email: string): boolean {
  if (KEEP_EMAILS.includes(email)) return true;
  return KEEP_EMAIL_DOMAINS.some((d) => email.endsWith(d));
}

async function main() {
  // ── 1. Target apps ──────────────────────────────────────────────────────
  const apps = await prisma.saApp.findMany({
    where: {
      isPlatform: false,
      name: { not: { in: KEEP_APP_NAMES } },
      OR: [{ name: { contains: 'e2e', mode: 'insensitive' } }, { name: { contains: 'lifecycle', mode: 'insensitive' } }],
    },
    select: { id: true, name: true },
  });
  const appIds = apps.map((a) => a.id);

  // ── 2. Target orgs: under a target app, or independently name-matched ──
  const orgs = await prisma.saOrg.findMany({
    where: {
      name: { not: { in: KEEP_ORG_NAMES } },
      OR: [
        { appId: { in: appIds } },
        { name: { contains: 'e2e', mode: 'insensitive' } },
        { name: { contains: 'lifecycle', mode: 'insensitive' } },
      ],
    },
    select: { id: true, name: true, appId: true },
  });
  const orgIds = orgs.map((o) => o.id);

  // ── 3. Target roles: under a target app, or independently name-matched ─
  const roles = await prisma.saRole.findMany({
    where: {
      name: { not: { in: KEEP_ROLE_NAMES } },
      OR: [
        { appId: { in: appIds } },
        { name: { contains: 'e2e', mode: 'insensitive' } },
        { name: { contains: 'lifecycle', mode: 'insensitive' } },
      ],
    },
    select: { id: true, name: true, appId: true },
  });
  const roleIds = roles.map((r) => r.id);

  // ── 4. Target permissions: under a target app, or independently matched,
  // never a system permission (platform.* / org.*) ───────────────────────
  const permissions = await prisma.saPermission.findMany({
    where: {
      isSystem: false,
      OR: [
        { appId: { in: appIds } },
        { name: { contains: 'e2e', mode: 'insensitive' } },
        { name: { contains: 'lifecycle', mode: 'insensitive' } },
      ],
    },
    select: { id: true, name: true, appId: true },
  });
  const permissionIds = permissions.map((p) => p.id);

  // ── 5. Target SaUsers: in a target org, or whose BetterAuth email matches
  // e2e/lifecycle naming and isn't a permanent seed/admin account ─────────
  const candidateUsers = await prisma.saUser.findMany({
    where: {
      OR: [
        { orgId: { in: orgIds } },
        { betterAuthUser: { email: { contains: 'e2e', mode: 'insensitive' } } },
        { betterAuthUser: { email: { contains: 'lifecycle', mode: 'insensitive' } } },
        { betterAuthUser: { email: { contains: 'invite-e2e', mode: 'insensitive' } } },
        { betterAuthUser: { email: { contains: 'svc-target-', mode: 'insensitive' } } },
      ],
    },
    select: { id: true, betterAuthUserId: true, publicId: true, betterAuthUser: { select: { email: true } } },
  });
  const users = candidateUsers.filter((u) => !isKeptEmail(u.betterAuthUser.email));
  const saUserIds = users.map((u) => u.id);
  const betterAuthUserIds = users.map((u) => u.betterAuthUserId);

  // ── Report ───────────────────────────────────────────────────────────
  console.log(`Apps        : ${apps.length}`);
  apps.forEach((a) => console.log(`  - [${a.id}] ${a.name}`));
  console.log(`Orgs        : ${orgs.length}`);
  orgs.forEach((o) => console.log(`  - [${o.id}] ${o.name}`));
  console.log(`Roles       : ${roles.length}`);
  roles.forEach((r) => console.log(`  - [${r.id}] ${r.name}`));
  console.log(`Permissions : ${permissions.length}`);
  permissions.forEach((p) => console.log(`  - [${p.id}] ${p.name}`));
  console.log(`Users       : ${users.length}`);
  users.forEach((u) => console.log(`  - [${u.id}] ${u.betterAuthUser.email}`));

  if (!APPLY) {
    console.log('\nDry run only — rerun with --apply to delete the records above.');
    return;
  }

  if (apps.length === 0 && orgs.length === 0 && roles.length === 0 && permissions.length === 0 && users.length === 0) {
    console.log('\nNothing to delete.');
    return;
  }

  await prisma.$transaction(async (tx) => {
    // Clear self-referencing defaults on target apps before their orgs/roles go.
    await tx.saApp.updateMany({ where: { id: { in: appIds } }, data: { defaultOrgId: null, defaultRoleId: null } });

    await tx.saUserRole.deleteMany({ where: { OR: [{ userId: { in: saUserIds } }, { roleId: { in: roleIds } }] } });
    await tx.saUserPermission.deleteMany({
      where: { OR: [{ userId: { in: saUserIds } }, { permissionId: { in: permissionIds } }] },
    });
    await tx.saInvitation.deleteMany({ where: { userId: { in: saUserIds } } });
    await tx.saUserConsent.deleteMany({ where: { OR: [{ saUserId: { in: saUserIds } }, { appId: { in: appIds } }] } });
    await tx.saRolePermission.deleteMany({
      where: { OR: [{ roleId: { in: roleIds } }, { permissionId: { in: permissionIds } }] },
    });

    await tx.saUser.deleteMany({ where: { id: { in: saUserIds } } });
    await tx.user.deleteMany({ where: { id: { in: betterAuthUserIds } } }); // cascades Session/Account/TwoFactor

    await tx.saRole.deleteMany({ where: { id: { in: roleIds } } });
    await tx.saPermission.deleteMany({ where: { id: { in: permissionIds } } });
    await tx.saOrg.deleteMany({ where: { id: { in: orgIds } } });
    await tx.saApp.deleteMany({ where: { id: { in: appIds } } });
  });

  console.log('\nDeleted.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
