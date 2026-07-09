import { prisma } from '@sassy-auth/db';
import { bootApp, closeApp, as } from './harness';
import { drainCleanup, uniqueName, createTempApp, createTempOrg, platformOrgId } from './factories';
import { SEED_ADMINS, isPermitted } from './permissions-matrix';

describe('/orgs matrix', () => {
  beforeAll(async () => { await bootApp(); });
  afterEach(async () => { await drainCleanup(); });
  afterAll(async () => { await closeApp(); });

  describe.each(SEED_ADMINS)('as $email', (admin) => {
    describe('GET /api/orgs', () => {
      if (isPermitted(admin, 'orgs', 'list')) {
        it('returns 200 with items[]', async () => {
          const res = await as(admin).get('/api/orgs');
          expect(res.status).toBe(200);
          expect(Array.isArray(res.body.items)).toBe(true);
        });
      } else {
        it('returns 403', async () => {
          const res = await as(admin).get('/api/orgs');
          expect(res.status).toBe(403);
        });
      }
    });

    describe('GET /api/orgs/:publicId', () => {
      if (isPermitted(admin, 'orgs', 'get')) {
        it('returns 200 for a real org', async () => {
          const org = await createTempOrg();
          const res = await as(admin).get(`/api/orgs/${org.publicId}`);
          expect(res.status).toBe(200);
          expect(res.body.publicId).toBe(org.publicId);
        });
      } else {
        it('returns 403', async () => {
          const org = await createTempOrg();
          const res = await as(admin).get(`/api/orgs/${org.publicId}`);
          expect(res.status).toBe(403);
        });
      }
    });

    describe('POST /api/orgs', () => {
      if (isPermitted(admin, 'orgs', 'create')) {
        it('returns 201 under a non-platform app', async () => {
          const app = await createTempApp();
          const name = uniqueName('e2e-org');
          const res = await as(admin).post('/api/orgs', { name, appId: app.publicId });
          expect(res.status).toBe(201);
          await as(admin).del(`/api/orgs/${res.body.publicId}`);
        });
      } else {
        it('returns 403', async () => {
          const app = await createTempApp();
          const res = await as(admin).post('/api/orgs', { name: uniqueName('e2e-org'), appId: app.publicId });
          expect(res.status).toBe(403);
        });
      }
    });

    describe('PATCH /api/orgs/:publicId', () => {
      if (isPermitted(admin, 'orgs', 'update')) {
        it('returns 200 on a temp org', async () => {
          const org = await createTempOrg();
          const res = await as(admin).patch(`/api/orgs/${org.publicId}`, { name: uniqueName('renamed') });
          expect(res.status).toBe(200);
        });

        it('returns 403 against the seeded platform org (immutable)', async () => {
          const platformId = await platformOrgId();
          const res = await as(admin).patch(`/api/orgs/${platformId}`, { name: 'hacked' });
          expect(res.status).toBe(403);
        });
      } else {
        it('returns 403', async () => {
          const org = await createTempOrg();
          const res = await as(admin).patch(`/api/orgs/${org.publicId}`, { name: 'x' });
          expect(res.status).toBe(403);
        });
      }
    });

    describe('DELETE /api/orgs/:publicId', () => {
      if (isPermitted(admin, 'orgs', 'delete')) {
        it('returns 204 on a temp org and GET 404 afterward', async () => {
          const org = await createTempOrg();
          const del = await as(admin).del(`/api/orgs/${org.publicId}`);
          expect(del.status).toBe(204);
          const after = await as(admin).get(`/api/orgs/${org.publicId}`);
          expect(after.status).toBe(404);
        });

        it('returns 403 against the seeded platform org (immutable)', async () => {
          const platformId = await platformOrgId();
          const res = await as(admin).del(`/api/orgs/${platformId}`);
          expect(res.status).toBe(403);
        });
      } else {
        it('returns 403', async () => {
          const org = await createTempOrg();
          const res = await as(admin).del(`/api/orgs/${org.publicId}`);
          expect(res.status).toBe(403);
        });
      }
    });

    if (isPermitted(admin, 'orgs', 'create')
        && isPermitted(admin, 'orgs', 'update')
        && isPermitted(admin, 'orgs', 'delete')) {
      describe('Create → Get → Update → Delete → Get 404 round-trip', () => {
        it('completes end-to-end', async () => {
          const app = await createTempApp();
          const a = as(admin);

          const name = uniqueName('e2e-roundtrip');
          const create = await a.post('/api/orgs', { name, appId: app.publicId });
          expect(create.status).toBe(201);
          const id = create.body.publicId as string;

          const got = await a.get(`/api/orgs/${id}`);
          expect(got.status).toBe(200);
          expect(got.body.publicId).toBe(id);

          const renamed = uniqueName('e2e-renamed');
          const update = await a.patch(`/api/orgs/${id}`, { name: renamed });
          expect(update.status).toBe(200);
          expect(update.body.name).toBe(renamed);

          const del = await a.del(`/api/orgs/${id}`);
          expect(del.status).toBe(204);

          const after = await a.get(`/api/orgs/${id}`);
          expect(after.status).toBe(404);

          const row = await prisma.saOrg.findUnique({ where: { publicId: id } });
          expect(row).toBeNull();
        });
      });
    }
  });
});
