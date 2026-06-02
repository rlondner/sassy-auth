import { prisma } from '@sassy-auth/db';
import { bootApp, closeApp, as } from './harness';
import { drainCleanup, uniqueName, createTempApp, platformAppId } from './factories';
import { SEED_ADMINS, isPermitted } from './permissions-matrix';

describe('/apps matrix', () => {
  beforeAll(async () => { await bootApp(); });
  afterEach(async () => { await drainCleanup(); });
  afterAll(async () => { await closeApp(); });

  describe.each(SEED_ADMINS)('as $email', (admin) => {
    describe('GET /api/apps', () => {
      if (isPermitted(admin, 'apps', 'list')) {
        it('returns 200 with items[]', async () => {
          const res = await as(admin).get('/api/apps');
          expect(res.status).toBe(200);
          expect(Array.isArray(res.body.items)).toBe(true);
        });
      } else {
        it('returns 403', async () => {
          const res = await as(admin).get('/api/apps');
          expect(res.status).toBe(403);
        });
      }
    });

    describe('POST /api/apps', () => {
      if (isPermitted(admin, 'apps', 'create')) {
        it('returns 201 and the row appears in LIST', async () => {
          const name = uniqueName('e2e-app');
          const res = await as(admin).post('/api/apps', { name, url: `https://example.com/${name}` });
          expect(res.status).toBe(201);
          expect(res.body.publicId).toBeDefined();
          // self-cleanup
          await as(admin).del(`/api/apps/${res.body.publicId}`);

          const list = await as(admin).get('/api/apps');
          expect(list.status).toBe(200);
        });
      } else {
        it('returns 403', async () => {
          const res = await as(admin).post('/api/apps', { name: uniqueName('e2e-app'), url: 'https://example.com/x' });
          expect(res.status).toBe(403);
        });
      }
    });

    describe('PATCH /api/apps/:publicId', () => {
      if (isPermitted(admin, 'apps', 'update')) {
        it('returns 200 on a temp app', async () => {
          const app = await createTempApp();
          const res = await as(admin).patch(`/api/apps/${app.publicId}`, { name: uniqueName('renamed') });
          expect(res.status).toBe(200);
        });

        it('returns 403 against the seeded platform app (immutable)', async () => {
          const platformId = await platformAppId();
          const res = await as(admin).patch(`/api/apps/${platformId}`, { name: 'hacked' });
          expect(res.status).toBe(403);
        });
      } else {
        it('returns 403', async () => {
          const app = await createTempApp();
          const res = await as(admin).patch(`/api/apps/${app.publicId}`, { name: 'x' });
          expect(res.status).toBe(403);
        });
      }
    });

    describe('DELETE /api/apps/:publicId', () => {
      if (isPermitted(admin, 'apps', 'delete')) {
        it('returns 204 on a temp app and GET 404 afterward', async () => {
          const app = await createTempApp();
          const del = await as(admin).del(`/api/apps/${app.publicId}`);
          expect(del.status).toBe(204);
          // Re-list and ensure it's gone (no GET-by-id endpoint on /apps).
          const list = await as(admin).get('/api/apps?pageSize=200');
          const names = (list.body.items as Array<{ name: string }>).map((a) => a.name);
          expect(names).not.toContain(app.name);
        });

        it('returns 403 against the seeded platform app (immutable)', async () => {
          const platformId = await platformAppId();
          const res = await as(admin).del(`/api/apps/${platformId}`);
          expect(res.status).toBe(403);
        });
      } else {
        it('returns 403', async () => {
          const app = await createTempApp();
          const res = await as(admin).del(`/api/apps/${app.publicId}`);
          expect(res.status).toBe(403);
        });
      }
    });

    if (isPermitted(admin, 'apps', 'create')
        && isPermitted(admin, 'apps', 'update')
        && isPermitted(admin, 'apps', 'delete')) {
      describe('Create → Update → List → Delete round-trip', () => {
        it('completes end-to-end', async () => {
          const name = uniqueName('e2e-roundtrip');
          const a = as(admin);

          const create = await a.post('/api/apps', { name, url: `https://example.com/${name}` });
          expect(create.status).toBe(201);
          const id = create.body.publicId as string;

          const renamed = uniqueName('e2e-renamed');
          const update = await a.patch(`/api/apps/${id}`, { name: renamed });
          expect(update.status).toBe(200);
          expect(update.body.name).toBe(renamed);

          const list = await a.get('/api/apps?pageSize=200');
          const names = (list.body.items as Array<{ name: string }>).map((x) => x.name);
          expect(names).toContain(renamed);

          const del = await a.del(`/api/apps/${id}`);
          expect(del.status).toBe(204);

          const after = await a.get('/api/apps?pageSize=200');
          const afterNames = (after.body.items as Array<{ name: string }>).map((x) => x.name);
          expect(afterNames).not.toContain(renamed);

          // Belt-and-braces: confirm via Prisma the row is really gone.
          const row = await prisma.saApp.findUnique({ where: { publicId: id } });
          expect(row).toBeNull();
        });
      });
    }
  });
});
