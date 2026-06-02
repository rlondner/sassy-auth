import { prisma } from '@sassy-auth/db';
import { bootApp, closeApp, as } from './harness';
import { drainCleanup, uniqueName, createTempApp, createTempRole } from './factories';
import { SEED_ADMINS, isPermitted } from './permissions-matrix';

describe('/roles matrix', () => {
  beforeAll(async () => { await bootApp(); });
  afterEach(async () => { await drainCleanup(); });
  afterAll(async () => { await closeApp(); });

  describe.each(SEED_ADMINS)('as $email', (admin) => {
    describe('GET /api/roles', () => {
      if (isPermitted(admin, 'roles', 'list')) {
        it('returns 200 with items[]', async () => {
          const res = await as(admin).get('/api/roles');
          expect(res.status).toBe(200);
          expect(Array.isArray(res.body.items)).toBe(true);
        });
      } else {
        it('returns 403', async () => {
          const res = await as(admin).get('/api/roles');
          expect(res.status).toBe(403);
        });
      }
    });

    describe('GET /api/roles/:publicId', () => {
      if (isPermitted(admin, 'roles', 'get')) {
        it('returns 200 for a real role', async () => {
          const role = await createTempRole();
          const res = await as(admin).get(`/api/roles/${role.publicId}`);
          expect(res.status).toBe(200);
        });
      } else {
        it('returns 403', async () => {
          const role = await createTempRole();
          const res = await as(admin).get(`/api/roles/${role.publicId}`);
          expect(res.status).toBe(403);
        });
      }
    });

    describe('POST /api/roles', () => {
      if (isPermitted(admin, 'roles', 'create')) {
        it('returns 201 under a temp app', async () => {
          const app = await createTempApp();
          const res = await as(admin).post('/api/roles', {
            name: uniqueName('e2e-role'),
            appId: app.publicId,
            permissionIds: [],
          });
          expect(res.status).toBe(201);
          await as(admin).del(`/api/roles/${res.body.publicId}`);
        });
      } else {
        it('returns 403', async () => {
          const app = await createTempApp();
          const res = await as(admin).post('/api/roles', {
            name: uniqueName('e2e-role'),
            appId: app.publicId,
            permissionIds: [],
          });
          expect(res.status).toBe(403);
        });
      }
    });

    describe('PATCH /api/roles/:publicId', () => {
      if (isPermitted(admin, 'roles', 'update')) {
        it('returns 200 on a temp role', async () => {
          const role = await createTempRole();
          const res = await as(admin).patch(`/api/roles/${role.publicId}`, { name: uniqueName('renamed') });
          expect(res.status).toBe(200);
        });
      } else {
        it('returns 403', async () => {
          const role = await createTempRole();
          const res = await as(admin).patch(`/api/roles/${role.publicId}`, { name: 'x' });
          expect(res.status).toBe(403);
        });
      }
    });

    describe('DELETE /api/roles/:publicId', () => {
      if (isPermitted(admin, 'roles', 'delete')) {
        it('returns 204 on a temp role and GET 404 afterward', async () => {
          const role = await createTempRole();
          const del = await as(admin).del(`/api/roles/${role.publicId}`);
          expect(del.status).toBe(204);
          const after = await as(admin).get(`/api/roles/${role.publicId}`);
          expect(after.status).toBe(404);
        });
      } else {
        it('returns 403', async () => {
          const role = await createTempRole();
          const res = await as(admin).del(`/api/roles/${role.publicId}`);
          expect(res.status).toBe(403);
        });
      }
    });

    if (isPermitted(admin, 'roles', 'create')
        && isPermitted(admin, 'roles', 'update')
        && isPermitted(admin, 'roles', 'delete')) {
      describe('Create → Get → Update → Delete → Get 404 round-trip', () => {
        it('completes end-to-end', async () => {
          const app = await createTempApp();
          const a = as(admin);

          const name = uniqueName('e2e-rt-role');
          const create = await a.post('/api/roles', { name, appId: app.publicId, permissionIds: [] });
          expect(create.status).toBe(201);
          const id = create.body.publicId as string;

          const got = await a.get(`/api/roles/${id}`);
          expect(got.status).toBe(200);

          const renamed = uniqueName('e2e-rt-renamed');
          const update = await a.patch(`/api/roles/${id}`, { name: renamed });
          expect(update.status).toBe(200);
          expect(update.body.name).toBe(renamed);

          const del = await a.del(`/api/roles/${id}`);
          expect(del.status).toBe(204);

          const after = await a.get(`/api/roles/${id}`);
          expect(after.status).toBe(404);

          const row = await prisma.saRole.findUnique({ where: { publicId: id } });
          expect(row).toBeNull();
        });
      });
    }
  });
});
