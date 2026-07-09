import * as crypto from 'crypto';
import { prisma } from '@sassy-auth/db';
import { bootApp, closeApp, as } from './harness';
import { drainCleanup, createTempApp, createTempPermission } from './factories';
import { SEED_ADMINS, isPermitted } from './permissions-matrix';

/** Generates a permission name that always satisfies the dotted-lowercase-segments regex. */
function safePermName(prefix = 'rt'): string {
  const uid = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
  return `e2e.${prefix}.p${uid}`;
}

describe('/permissions matrix', () => {
  beforeAll(async () => { await bootApp(); });
  afterEach(async () => { await drainCleanup(); });
  afterAll(async () => { await closeApp(); });

  /** Pick one seeded platform.* permission to exercise the immutability rule. */
  async function seededPlatformPermissionId(): Promise<string> {
    const p = await prisma.saPermission.findFirst({ where: { name: { startsWith: 'platform.' } } });
    if (!p) throw new Error('no platform.* permission seeded');
    return p.publicId;
  }

  describe.each(SEED_ADMINS)('as $email', (admin) => {
    describe('GET /api/permissions', () => {
      if (isPermitted(admin, 'permissions', 'list')) {
        it('returns 200 with items[]', async () => {
          const res = await as(admin).get('/api/permissions');
          expect(res.status).toBe(200);
          expect(Array.isArray(res.body.items)).toBe(true);
        });
      } else {
        it('returns 403', async () => {
          const res = await as(admin).get('/api/permissions');
          expect(res.status).toBe(403);
        });
      }
    });

    describe('GET /api/permissions/:publicId', () => {
      if (isPermitted(admin, 'permissions', 'get')) {
        it('returns 200 for a real permission', async () => {
          const perm = await createTempPermission();
          const res = await as(admin).get(`/api/permissions/${perm.publicId}`);
          expect(res.status).toBe(200);
        });
      } else {
        it('returns 403', async () => {
          const perm = await createTempPermission();
          const res = await as(admin).get(`/api/permissions/${perm.publicId}`);
          expect(res.status).toBe(403);
        });
      }
    });

    describe('POST /api/permissions', () => {
      if (isPermitted(admin, 'permissions', 'create')) {
        it('returns 201 under a temp app with a non-platform.* name', async () => {
          const app = await createTempApp();
          const name = safePermName('perm');
          const res = await as(admin).post('/api/permissions', { name, appId: app.publicId });
          expect(res.status).toBe(201);
          await as(admin).del(`/api/permissions/${res.body.publicId}`);
        });
      } else {
        it('returns 403', async () => {
          const app = await createTempApp();
          const res = await as(admin).post('/api/permissions', {
            name: safePermName('perm'),
            appId: app.publicId,
          });
          expect(res.status).toBe(403);
        });
      }
    });

    describe('PATCH /api/permissions/:publicId', () => {
      if (isPermitted(admin, 'permissions', 'update')) {
        it('returns 200 on a temp non-platform permission', async () => {
          const perm = await createTempPermission();
          const res = await as(admin).patch(`/api/permissions/${perm.publicId}`, {
            name: safePermName('renamed'),
          });
          expect(res.status).toBe(200);
        });

        it('returns 403 against a seeded platform.* permission (immutable)', async () => {
          const platformPermId = await seededPlatformPermissionId();
          const res = await as(admin).patch(`/api/permissions/${platformPermId}`, { name: 'hacked.name' });
          expect(res.status).toBe(403);
        });
      } else {
        it('returns 403', async () => {
          const perm = await createTempPermission();
          const res = await as(admin).patch(`/api/permissions/${perm.publicId}`, { name: safePermName('upd') });
          expect(res.status).toBe(403);
        });
      }
    });

    describe('DELETE /api/permissions/:publicId', () => {
      if (isPermitted(admin, 'permissions', 'delete')) {
        it('returns 204 on a temp non-platform permission and GET 404 afterward', async () => {
          const perm = await createTempPermission();
          const del = await as(admin).del(`/api/permissions/${perm.publicId}`);
          expect(del.status).toBe(204);
          const after = await as(admin).get(`/api/permissions/${perm.publicId}`);
          expect(after.status).toBe(404);
        });

        it('returns 403 against a seeded platform.* permission (immutable)', async () => {
          const platformPermId = await seededPlatformPermissionId();
          const res = await as(admin).del(`/api/permissions/${platformPermId}`);
          expect(res.status).toBe(403);
        });
      } else {
        it('returns 403', async () => {
          const perm = await createTempPermission();
          const res = await as(admin).del(`/api/permissions/${perm.publicId}`);
          expect(res.status).toBe(403);
        });
      }
    });

    if (isPermitted(admin, 'permissions', 'create')
        && isPermitted(admin, 'permissions', 'update')
        && isPermitted(admin, 'permissions', 'delete')) {
      describe('Create → Get → Update → Delete → Get 404 round-trip', () => {
        it('completes end-to-end', async () => {
          const app = await createTempApp();
          const a = as(admin);

          const name = safePermName('rt');
          const create = await a.post('/api/permissions', { name, appId: app.publicId });
          expect(create.status).toBe(201);
          const id = create.body.publicId as string;

          const got = await a.get(`/api/permissions/${id}`);
          expect(got.status).toBe(200);

          const renamed = safePermName('rtr');
          const update = await a.patch(`/api/permissions/${id}`, { name: renamed });
          expect(update.status).toBe(200);
          expect(update.body.name).toBe(renamed);

          const del = await a.del(`/api/permissions/${id}`);
          expect(del.status).toBe(204);

          const after = await a.get(`/api/permissions/${id}`);
          expect(after.status).toBe(404);

          const row = await prisma.saPermission.findUnique({ where: { publicId: id } });
          expect(row).toBeNull();
        });
      });
    }
  });
});
