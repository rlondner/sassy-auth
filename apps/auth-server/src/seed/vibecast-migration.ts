import 'dotenv/config';
import { prisma, Prisma } from '@sassy-auth/db';
import type { ActivationEmailBranding } from '@sassy-auth/types';
import Sqids from 'sqids';
import { auth } from '../auth/auth.config';
import { generatePendingPublicId } from '../common/pending-public-id';
import { resolveSeedPassword } from './seed-password';

/**
 * One-shot, idempotent provisioning of every vibecast construct — the
 * SaApp, its full vibecast.* SaPermission set, its SaRole ->
 * SaPermission wiring, the "VibeCast Default Org" (required because the
 * app's defaultOrgId and the admin user both need an org to point at),
 * and the admin@getvibecast.com platform user for that app.
 *
 * This is a snapshot of the real dev database as of 2026-09-16, not a
 * computed matrix — an earlier vibecast-permissions.ts seed script computed
 * permissions from a resource/action matrix (content/connection/member/
 * settings x read/write/delete/approve) that drifted out of sync with what
 * actually exists (billing.*, brands.*, dashboard.read, the *.admin/
 * *.viewer roles, etc. were added by hand afterwards and never folded back
 * into that matrix) and has been removed in favor of this file.
 *
 * Deliberately NOT carried over from dev, and left for the admin console
 * after this runs instead:
 *   - logo: cosmetic, upload it via the Apps edit drawer.
 *   - activationWebhookSecret: must never live in a checked-in file. Generate it via
 *     the "Generate webhook secret" flow (AppsService.rotateWebhookSecret) once the
 *     app exists — the webhook won't actually fire until a secret is set, even if
 *     activationWebhookUrl (below) was seeded.
 *   - The extra dev-only orgs seen alongside vibecast in the source
 *     database ("Smoke Test Co", "Marketing Agency", "Toto inc") are test
 *     fixtures, not part of the vibecast construct itself.
 *
 * Safe to re-run: every step is find-or-create, and admin.env in
 * production must supply a real SEED_ADMIN_PASSWORD (resolveSeedPassword
 * refuses its dev default outside NODE_ENV=development/test).
 *
 * The app's url, login/logout redirect URIs, activation webhook url, and activation
 * email branding are seeded from VIBECAST_APP_URL/VIBECAST_LOGIN_REDIRECT_URI/
 * VIBECAST_LOGOUT_REDIRECT_URI/VIBECAST_ACTIVATION_WEBHOOK_URL/
 * VIBECAST_ACTIVATION_EMAIL_FROM_NAME/VIBECAST_ACTIVATION_EMAIL_FROM_ADDRESS/
 * VIBECAST_ACTIVATION_EMAIL_SUBJECT/VIBECAST_ACTIVATION_EMAIL_MESSAGE only the first
 * time the SaApp is created. Once it exists, those fields are owned by the SaApp
 * record itself (editable via the admin console) — the env vars are not read again on
 * subsequent runs, so they're no longer required (or wired) in render.yaml for
 * environments where vibecast has already been provisioned.
 */

const sqids = new Sqids({
  alphabet: process.env.SQIDS_ALPHABET || undefined,
  minLength: 4,
});

const APP_NAME = 'vibecast';
const isProd = (process.env.NODE_ENV ?? 'development') === 'production';

/**
 * Reads an env var, falling back to the dev-observed value everywhere
 * except production — a prod run with the var unset fails loudly instead
 * of silently wiring vibecast's OAuth client to a localhost URL.
 */
function requireEnvOutsideProd(name: string, devFallback: string): string {
  const value = process.env[name];
  if (value) return value;
  if (isProd) {
    throw new Error(`${name} must be set when seeding vibecast in production`);
  }
  return devFallback;
}

const DEFAULT_ORG_NAME = 'VibeCast Default Org';
// A brand-new self-signup always becomes the sole admin of their own
// freshly-created personal org (see content-social-automation's
// apps/api/src/routes/identity.py's provision()), so the default role a
// fresh signup is granted here must be org.admin, not org.member --
// otherwise the BFF's role/permission intersection
// (apps/web/src/app/api/auth/callback/route.ts) caps every new user below
// vibecast.org.settings.write and the onboarding wizard 403s immediately
// after signup.
const DEFAULT_ROLE_NAME = 'vibecast.org.admin';

const ADMIN_PASSWORD = resolveSeedPassword();
const ADMIN = {
  email: 'admin@getvibecast.com',
  firstName: 'VibeCast',
  lastName: 'App Admin',
  username: 'vc_admin',
  roles: ['vibecast.app.admin', 'vibecast.org.admin', 'vibecast.org.member', 'vibecast.org.viewer'] as const,
};

// Every vibecast.* SaPermission that exists in the source dev database.
const PERMISSIONS = [
  'vibecast.app.admin',
  'vibecast.app.settings.read',
  'vibecast.app.settings.write',
  'vibecast.billing.read',
  'vibecast.billing.write',
  'vibecast.brands.read',
  'vibecast.brands.write',
  'vibecast.connections.delete',
  'vibecast.connections.read',
  'vibecast.connections.write',
  'vibecast.content.approve',
  'vibecast.content.delete',
  'vibecast.content.read',
  'vibecast.content.write',
  'vibecast.dashboard.read',
  'vibecast.member.delete',
  'vibecast.member.read',
  'vibecast.member.write',
  'vibecast.org.admin',
  'vibecast.org.member',
  'vibecast.org.settings.read',
  'vibecast.org.settings.write',
  'vibecast.org.viewer',
  'vibecast.settings.delete',
  'vibecast.settings.read',
  'vibecast.settings.write',
] as const;

// SaRole name -> the SaPermission names wired to it, exactly as found in dev.
const ROLE_PERMISSIONS: Readonly<Record<string, readonly string[]>> = {
  'vibecast.app.admin': [
    'vibecast.billing.write',
    'vibecast.billing.read',
    'vibecast.app.admin',
    'vibecast.brands.write',
    'vibecast.brands.read',
    'vibecast.settings.write',
    'vibecast.settings.delete',
    'vibecast.app.settings.write',
    'vibecast.app.settings.read',
  ],
  'vibecast.org.admin': [
    'vibecast.dashboard.read',
    'vibecast.content.approve',
    'vibecast.member.read',
    'vibecast.member.write',
    'vibecast.member.delete',
    'vibecast.settings.read',
    'vibecast.settings.write',
    'vibecast.org.settings.write',
    'vibecast.org.settings.read',
    'vibecast.connections.read',
    'vibecast.connections.write',
  ],
  'vibecast.org.member': ['vibecast.content.read', 'vibecast.content.write', 'vibecast.content.approve'],
  'vibecast.org.viewer': ['vibecast.content.read'],
};

async function createWithPublicId<T extends { id: number }>(
  create: () => Promise<T>,
  update: (id: number, publicId: string) => Promise<T>,
): Promise<T> {
  const draft = await create();
  return update(draft.id, sqids.encode([draft.id]));
}

/**
 * Builds the activation email override from whichever VIBECAST_ACTIVATION_EMAIL_*
 * vars are set, same "genuinely optional, no dev fallback" treatment as the
 * webhook url above — every field already falls back to the platform default
 * (see @sassy-auth/types ActivationEmailBranding), and this only runs once.
 * Returns null (not an empty object) when nothing is set, matching the "null
 * means use the platform default" contract on SaApp.activationEmailOverride.
 */
function buildActivationEmailOverride(): ActivationEmailBranding | null {
  const branding: ActivationEmailBranding = {
    fromName: process.env.VIBECAST_ACTIVATION_EMAIL_FROM_NAME || undefined,
    fromAddress: process.env.VIBECAST_ACTIVATION_EMAIL_FROM_ADDRESS || undefined,
    subject: process.env.VIBECAST_ACTIVATION_EMAIL_SUBJECT || undefined,
    message: process.env.VIBECAST_ACTIVATION_EMAIL_MESSAGE || undefined,
  };
  return Object.values(branding).some((v) => v !== undefined) ? branding : null;
}

async function ensureApp() {
  const existing = await prisma.saApp.findUnique({ where: { name: APP_NAME } });
  if (existing) {
    console.log(`App already exists: ${APP_NAME} (publicId=${existing.publicId})`);
    return existing;
  }
  const url = requireEnvOutsideProd('VIBECAST_APP_URL', 'https://localhost:3030');
  // Genuinely optional (unlike url/redirect URIs above): notify-activation.ts already
  // treats a missing activationWebhookUrl as "don't send", and the webhook won't fire
  // until an admin also generates a secret via the console, so there's no dev fallback.
  const activationWebhookUrl = process.env.VIBECAST_ACTIVATION_WEBHOOK_URL || undefined;
  const activationEmailOverride = buildActivationEmailOverride();
  const app = await prisma.$transaction((tx) =>
    createWithPublicId(
      () =>
        tx.saApp.create({
          data: {
            publicId: generatePendingPublicId(),
            name: APP_NAME,
            url,
            activationWebhookUrl,
            activationEmailOverride: (activationEmailOverride as unknown as Prisma.InputJsonValue) ?? undefined,
            isPlatform: false,
            requireTwoFactor: false,
          },
        }),
      (id, publicId) => tx.saApp.update({ where: { id }, data: { publicId } }),
    ),
  );
  console.log(`Created app: ${APP_NAME} (publicId=${app.publicId})`);
  return app;
}

/**
 * Ensures at least one redirect URI of this kind exists. Keyed on `kind`
 * alone (not the URI value) — once one exists, it's owned by the SaApp
 * record (editable via the admin console), so a re-run must not re-add the
 * env var's value as a duplicate if an admin has since changed it.
 */
async function ensureRedirectUri(appId: number, kind: 'login' | 'post_logout', devFallback: string) {
  const existing = await prisma.saAppRedirectUri.findFirst({ where: { appId, kind } });
  if (existing) return;
  const envName = kind === 'login' ? 'VIBECAST_LOGIN_REDIRECT_URI' : 'VIBECAST_LOGOUT_REDIRECT_URI';
  const uri = requireEnvOutsideProd(envName, devFallback);
  await prisma.saAppRedirectUri.create({ data: { appId, uri, kind } });
  console.log(`Added ${kind} redirect URI: ${uri}`);
}

async function ensureOrg(appId: number) {
  const existing = await prisma.saOrg.findFirst({ where: { appId, name: DEFAULT_ORG_NAME } });
  if (existing) {
    console.log(`Org already exists: ${DEFAULT_ORG_NAME} (publicId=${existing.publicId})`);
    return existing;
  }
  const org = await prisma.$transaction((tx) =>
    createWithPublicId(
      () =>
        tx.saOrg.create({
          data: { publicId: generatePendingPublicId(), name: DEFAULT_ORG_NAME, appId, isPlatform: false },
        }),
      (id, publicId) => tx.saOrg.update({ where: { id }, data: { publicId } }),
    ),
  );
  console.log(`Created org: ${DEFAULT_ORG_NAME} (publicId=${org.publicId})`);
  return org;
}

async function ensurePermissions(appId: number): Promise<Record<string, number>> {
  const idByName: Record<string, number> = {};
  for (const name of PERMISSIONS) {
    const existing = await prisma.saPermission.findUnique({ where: { name } });
    if (existing) {
      idByName[name] = existing.id;
      continue;
    }
    const created = await prisma.$transaction((tx) =>
      createWithPublicId(
        () => tx.saPermission.create({ data: { publicId: generatePendingPublicId(), name, appId, isSystem: false } }),
        (id, publicId) => tx.saPermission.update({ where: { id }, data: { publicId } }),
      ),
    );
    idByName[name] = created.id;
    console.log(`Created permission: ${name}`);
  }
  return idByName;
}

async function ensureRoles(appId: number, permIdByName: Record<string, number>): Promise<Record<string, number>> {
  const idByName: Record<string, number> = {};
  for (const [roleName, permNames] of Object.entries(ROLE_PERMISSIONS)) {
    let role = await prisma.saRole.findFirst({ where: { appId, name: roleName } });
    if (!role) {
      role = await prisma.$transaction((tx) =>
        createWithPublicId(
          () => tx.saRole.create({ data: { publicId: generatePendingPublicId(), name: roleName, appId } }),
          (id, publicId) => tx.saRole.update({ where: { id }, data: { publicId } }),
        ),
      );
      console.log(`Created role: ${roleName} (publicId=${role.publicId})`);
    } else {
      console.log(`Role already exists: ${roleName} (publicId=${role.publicId})`);
    }
    idByName[roleName] = role.id;

    for (const permName of permNames) {
      const permissionId = permIdByName[permName];
      await prisma.saRolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId } },
        create: { roleId: role.id, permissionId },
        update: {},
      });
    }
  }
  return idByName;
}

/**
 * Wires the app's defaultOrgId/defaultRoleId only if unset, so a re-run
 * against an environment where an admin already changed the default
 * elsewhere doesn't silently revert their choice.
 */
async function ensureAppDefaults(appId: number, orgId: number, roleId: number) {
  const app = await prisma.saApp.findUniqueOrThrow({ where: { id: appId } });
  const data: { defaultOrgId?: number; defaultRoleId?: number } = {};
  if (app.defaultOrgId === null) data.defaultOrgId = orgId;
  if (app.defaultRoleId === null) data.defaultRoleId = roleId;
  if (Object.keys(data).length === 0) return;
  await prisma.saApp.update({ where: { id: appId }, data });
  console.log(`Set app defaults: ${JSON.stringify(data)}`);
}

async function ensureAdmin(orgId: number, roleIdByName: Record<string, number>) {
  let baUserId: string;
  const existingBaUser = await prisma.user.findUnique({ where: { email: ADMIN.email } });
  if (existingBaUser) {
    baUserId = existingBaUser.id;
  } else {
    const result = await auth.api.signUpEmail({
      body: { email: ADMIN.email, password: ADMIN_PASSWORD, name: `${ADMIN.firstName} ${ADMIN.lastName}` },
    });
    baUserId = result.user.id;
    await prisma.user.update({ where: { id: baUserId }, data: { emailVerified: true } });
    console.log(`Created BetterAuth user: ${ADMIN.email}`);
  }

  let saUser = await prisma.saUser.findFirst({ where: { betterAuthUserId: baUserId } });
  if (!saUser) {
    saUser = await prisma.$transaction((tx) =>
      createWithPublicId(
        () =>
          tx.saUser.create({
            data: {
              publicId: generatePendingPublicId(),
              betterAuthUserId: baUserId,
              orgId,
              firstName: ADMIN.firstName,
              lastName: ADMIN.lastName,
              username: ADMIN.username,
              status: 'active',
            },
          }),
        (id, publicId) => tx.saUser.update({ where: { id }, data: { publicId } }),
      ),
    );
    console.log(`Created SaUser: ${ADMIN.email} (publicId=${saUser.publicId})`);
  } else {
    console.log(`SaUser already exists: ${ADMIN.email} (publicId=${saUser.publicId})`);
  }

  for (const roleName of ADMIN.roles) {
    const roleId = roleIdByName[roleName];
    await prisma.saUserRole.upsert({
      where: { userId_roleId: { userId: saUser.id, roleId } },
      create: { userId: saUser.id, roleId },
      update: {},
    });
  }
  console.log(`Wired admin roles: ${ADMIN.roles.join(', ')}`);
}

async function main() {
  console.log('Provisioning vibecast...');

  const app = await ensureApp();
  await ensureRedirectUri(app.id, 'login', 'https://localhost:3030/api/auth/callback');
  await ensureRedirectUri(app.id, 'post_logout', 'https://localhost:3030/api/auth/signout');

  const org = await ensureOrg(app.id);
  const permIdByName = await ensurePermissions(app.id);
  const roleIdByName = await ensureRoles(app.id, permIdByName);
  await ensureAppDefaults(app.id, org.id, roleIdByName[DEFAULT_ROLE_NAME]);
  await ensureAdmin(org.id, roleIdByName);

  console.log('Vibecast provisioning complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
