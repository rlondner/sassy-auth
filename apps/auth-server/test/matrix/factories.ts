/**
 * Test-data factories with per-test cleanup. Every CREATE registers a
 * cleanup callback. Tests opt in via `withCleanup(...)` in beforeEach/afterEach.
 */
import * as crypto from 'crypto';
import { prisma } from '@sassy-auth/db';
import { as } from './harness';
import { SEED_ADMINS, SeedAdmin } from './permissions-matrix';

type Cleanup = () => Promise<void>;
const queue: Cleanup[] = [];

export function uniqueName(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

export function registerCleanup(fn: Cleanup) {
  queue.push(fn);
}

/** Drains the per-test cleanup queue in LIFO order. Call from afterEach. */
export async function drainCleanup() {
  while (queue.length > 0) {
    const fn = queue.pop()!;
    try { await fn(); } catch { /* best-effort */ }
  }
}

/** Returns the super-admin SeedAdmin (s@sa.io). */
export function superAdmin(): SeedAdmin {
  const s = SEED_ADMINS.find((a) => a.key === 'super');
  if (!s) throw new Error('super admin missing from SEED_ADMINS');
  return s;
}

/** Returns the seeded platform app's publicId. Cached after first lookup. */
let platformAppPublicId: string | null = null;
export async function platformAppId(): Promise<string> {
  if (platformAppPublicId) return platformAppPublicId;
  const app = await prisma.saApp.findFirst({ where: { isPlatform: true } });
  if (!app) throw new Error('platform app not seeded');
  platformAppPublicId = app.publicId;
  return platformAppPublicId;
}

let platformOrgPublicId: string | null = null;
export async function platformOrgId(): Promise<string> {
  if (platformOrgPublicId) return platformOrgPublicId;
  const org = await prisma.saOrg.findFirst({ where: { isPlatform: true } });
  if (!org) throw new Error('platform org not seeded');
  platformOrgPublicId = org.publicId;
  return platformOrgPublicId;
}

/** Creates a non-platform app via the API (as super admin) and registers cleanup. */
export async function createTempApp(name = uniqueName('e2e-app')): Promise<{ publicId: string; name: string }> {
  const s = as(superAdmin());
  const res = await s.post('/api/apps', { name, url: `https://example.com/${name}` });
  if (res.status !== 201) throw new Error(`createTempApp failed (${res.status}): ${JSON.stringify(res.body)}`);
  const created = res.body as { publicId: string; name: string };
  registerCleanup(async () => {
    await s.del(`/api/apps/${created.publicId}`);
  });
  return created;
}

/** Creates a non-platform org under a fresh temp app. */
export async function createTempOrg(): Promise<{ publicId: string; name: string; appPublicId: string }> {
  const app = await createTempApp();
  const s = as(superAdmin());
  const orgName = uniqueName('e2e-org');
  const res = await s.post('/api/orgs', { name: orgName, appId: app.publicId });
  if (res.status !== 201) throw new Error(`createTempOrg failed (${res.status}): ${JSON.stringify(res.body)}`);
  const created = res.body as { publicId: string; name: string };
  registerCleanup(async () => {
    await s.del(`/api/orgs/${created.publicId}`);
  });
  return { ...created, appPublicId: app.publicId };
}

/** Creates a role under a fresh temp app (no permissions assigned). */
export async function createTempRole(): Promise<{ publicId: string; name: string; appPublicId: string }> {
  const app = await createTempApp();
  const s = as(superAdmin());
  const roleName = uniqueName('e2e-role');
  const res = await s.post('/api/roles', { name: roleName, appId: app.publicId, permissionIds: [] });
  if (res.status !== 201) throw new Error(`createTempRole failed (${res.status}): ${JSON.stringify(res.body)}`);
  const created = res.body as { publicId: string; name: string };
  registerCleanup(async () => {
    await s.del(`/api/roles/${created.publicId}`);
  });
  return { ...created, appPublicId: app.publicId };
}

/** Creates a permission under a fresh temp app. Name is auto-prefixed `e2e.` to avoid the immutability rule. */
export async function createTempPermission(): Promise<{ publicId: string; name: string; appPublicId: string }> {
  const app = await createTempApp();
  const s = as(superAdmin());
  const uid = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
  const permName = `e2e.perm.p${uid}`;
  const res = await s.post('/api/permissions', { name: permName, appId: app.publicId });
  if (res.status !== 201) throw new Error(`createTempPermission failed (${res.status}): ${JSON.stringify(res.body)}`);
  const created = res.body as { publicId: string; name: string };
  registerCleanup(async () => {
    await s.del(`/api/permissions/${created.publicId}`);
  });
  return { ...created, appPublicId: app.publicId };
}

/** Creates a non-platform user via the API under a fresh temp org. */
export async function createTempUser(): Promise<{ publicId: string; email: string; orgPublicId: string }> {
  const org = await createTempOrg();
  const s = as(superAdmin());
  const email = `e2e-${crypto.randomUUID().slice(0, 8)}@example.com`;
  const res = await s.post('/api/users', {
    firstName: 'E2E',
    lastName: 'Temp',
    email,
    orgId: org.publicId,
  });
  if (res.status !== 201) throw new Error(`createTempUser failed (${res.status}): ${JSON.stringify(res.body)}`);
  const body = res.body as { user: { id: string } };
  registerCleanup(async () => {
    // Delete via API (super has platform.users.manage), then clean up the
    // dangling BetterAuth row that /api/users doesn't touch.
    await s.del(`/api/users/${body.user.id}`);
    await prisma.user.deleteMany({ where: { email } });
  });
  return { publicId: body.user.id, email, orgPublicId: org.publicId };
}
