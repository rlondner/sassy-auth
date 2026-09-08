import { prisma } from '@sassy-auth/db';
import Sqids from 'sqids';
// Reuse BetterAuth's scrypt so the client secret is hashed the same way as a
// user password — client-auth.ts (verifyClientSecret) verifies it with the
// matching verifyPassword.
import { hashPassword } from 'better-auth/crypto';
import { auth } from '../auth/auth.config';
import { generatePendingPublicId } from '../common/pending-public-id';
import { resolveSeedPassword } from './seed-password';
import { resolveSeedClientSecret } from './seed-client-secret';

const sqids = new Sqids({
  alphabet: process.env.SQIDS_ALPHABET || undefined,
  minLength: 4,
});

// Task 12 (OIDC compatibility plan): the confidential client a stock,
// unmodified `openid-client` drives end-to-end in
// apps/admin-e2e/tests/oidc-round-trip.spec.ts. Everything below is test-only
// scaffolding for that spec — the app itself never receives real traffic.
const APP_NAME = 'E2E OIDC Client';
const APP_URL = 'http://localhost:3002';
const LOGIN_REDIRECT_URI = 'http://localhost:3002/callback';
const POST_LOGOUT_REDIRECT_URI = 'http://localhost:3002/bye';
const ORG_NAME = 'E2E OIDC Org';
const USER_EMAIL = 'oidc-e2e@sa.io';

const PASSWORD = resolveSeedPassword();
const CLIENT_SECRET = resolveSeedClientSecret();

async function ensureApp() {
  const found = await prisma.saApp.findUnique({ where: { name: APP_NAME } });
  if (found) {
    // Keep the stored hash in sync with the fixed dev secret across reseeds —
    // a stale hash from a previous CLIENT_SECRET value would silently break
    // client authentication for anyone re-running the seed locally.
    const clientSecretHash = await hashPassword(CLIENT_SECRET);
    return prisma.saApp.update({
      where: { id: found.id },
      data: { clientSecretHash, clientSecretUpdatedAt: new Date() },
    });
  }
  const clientSecretHash = await hashPassword(CLIENT_SECRET);
  return prisma.$transaction(async (tx) => {
    const created = await tx.saApp.create({
      data: {
        publicId: generatePendingPublicId(),
        name: APP_NAME,
        url: APP_URL,
        isPlatform: false,
        clientSecretHash,
        clientSecretUpdatedAt: new Date(),
      },
    });
    return tx.saApp.update({
      where: { id: created.id },
      data: { publicId: sqids.encode([created.id]) },
    });
  });
}

async function ensureRedirectUris(appId: number) {
  await prisma.saAppRedirectUri.upsert({
    where: { appId_uri_kind: { appId, uri: LOGIN_REDIRECT_URI, kind: 'login' } },
    create: { appId, uri: LOGIN_REDIRECT_URI, kind: 'login' },
    update: {},
  });
  await prisma.saAppRedirectUri.upsert({
    where: { appId_uri_kind: { appId, uri: POST_LOGOUT_REDIRECT_URI, kind: 'post_logout' } },
    create: { appId, uri: POST_LOGOUT_REDIRECT_URI, kind: 'post_logout' },
    update: {},
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

async function ensureUser(orgId: number) {
  const existing = await prisma.user.findUnique({ where: { email: USER_EMAIL } });
  let baUserId: string;
  if (existing) {
    baUserId = existing.id;
  } else {
    const result = await auth.api.signUpEmail({
      body: { email: USER_EMAIL, password: PASSWORD, name: 'E2E OIDC User' },
    });
    baUserId = result.user.id;
    await prisma.user.update({ where: { id: baUserId }, data: { emailVerified: true } });
  }

  const existingSaUser = await prisma.saUser.findFirst({ where: { betterAuthUserId: baUserId } });
  if (existingSaUser) return existingSaUser;

  return prisma.$transaction(async (tx) => {
    const created = await tx.saUser.create({
      data: {
        publicId: generatePendingPublicId(),
        betterAuthUserId: baUserId,
        orgId,
        firstName: 'E2E',
        lastName: 'OIDC',
        status: 'active',
      },
    });
    return tx.saUser.update({
      where: { id: created.id },
      data: { publicId: sqids.encode([created.id]) },
    });
  });
}

export async function seedE2eOidcClient() {
  console.log('[e2e-oidc] Seeding E2E OIDC Client app...');
  const app = await ensureApp();
  await ensureRedirectUris(app.id);
  const org = await ensureOrg(app.id);
  await ensureUser(org.id);
  console.log(`[e2e-oidc] Done. publicId=${app.publicId}`);
}
