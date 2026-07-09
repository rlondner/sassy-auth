import { prisma } from '@sassy-auth/db';
import { bootApp, closeApp, as } from './harness';
import { drainCleanup, uniqueName, createTempOrg, createTempUser, createTempRole, superAdmin } from './factories';
import { SEED_ADMINS, isPermitted } from './permissions-matrix';

describe('/users matrix', () => {
  beforeAll(async () => { await bootApp(); });
  afterEach(async () => { await drainCleanup(); });
  afterAll(async () => { await closeApp(); });

  /** Returns the publicId of the SaUser for the given seeded admin email. */
  async function saUserIdFor(email: string): Promise<string> {
    const row = await prisma.saUser.findFirst({
      where: { betterAuthUser: { email } },
      select: { publicId: true },
    });
    if (!row) throw new Error(`SaUser not found for ${email}`);
    return row.publicId;
  }

  describe.each(SEED_ADMINS)('as $email', (admin) => {
    describe('GET /api/users (no orgId)', () => {
      if (admin.perms.includes('platform.users.manage')) {
        it('returns 200 with the cross-tenant list', async () => {
          const res = await as(admin).get('/api/users');
          expect(res.status).toBe(200);
          expect(Array.isArray(res.body)).toBe(true);
        });
      } else {
        it('returns 403 (cross-tenant list requires platform.users.manage)', async () => {
          const res = await as(admin).get('/api/users');
          expect(res.status).toBe(403);
        });
      }
    });

    describe('GET /api/users?orgId=<temp>', () => {
      if (isPermitted(admin, 'users', 'list')) {
        it('returns 200 scoped to a temp org', async () => {
          const org = await createTempOrg();
          const res = await as(admin).get(`/api/users?orgId=${org.publicId}`);
          expect(res.status).toBe(200);
        });
      } else {
        it('returns 403', async () => {
          const org = await createTempOrg();
          const res = await as(admin).get(`/api/users?orgId=${org.publicId}`);
          expect(res.status).toBe(403);
        });
      }
    });

    describe('GET /api/users/:id', () => {
      if (isPermitted(admin, 'users', 'get')) {
        it('returns 200 for a temp user', async () => {
          const u = await createTempUser();
          const res = await as(admin).get(`/api/users/${u.publicId}`);
          expect(res.status).toBe(200);
        });
      } else {
        it('returns 403', async () => {
          const u = await createTempUser();
          const res = await as(admin).get(`/api/users/${u.publicId}`);
          expect(res.status).toBe(403);
        });
      }
    });

    describe('POST /api/users', () => {
      if (isPermitted(admin, 'users', 'create')) {
        it('returns 201 with an inviteUrl', async () => {
          const org = await createTempOrg();
          const email = `e2e-${uniqueName('u')}@example.com`;
          const res = await as(admin).post('/api/users', {
            firstName: 'A', lastName: 'B', email, orgId: org.publicId,
          });
          expect(res.status).toBe(201);
          expect(res.body.inviteUrl).toBeDefined();
          // self-cleanup
          await as(superAdmin()).del(`/api/users/${res.body.user.id}`);
          await prisma.user.deleteMany({ where: { email } });
        });
      } else {
        it('returns 403', async () => {
          const org = await createTempOrg();
          const res = await as(admin).post('/api/users', {
            firstName: 'A', lastName: 'B',
            email: `e2e-${uniqueName('u')}@example.com`,
            orgId: org.publicId,
          });
          expect(res.status).toBe(403);
        });
      }
    });

    describe('PATCH /api/users/:id', () => {
      if (isPermitted(admin, 'users', 'update')) {
        it('returns 200 on a temp user', async () => {
          const u = await createTempUser();
          const res = await as(admin).patch(`/api/users/${u.publicId}`, { firstName: uniqueName('Renamed') });
          expect(res.status).toBe(200);
        });
      } else {
        it('returns 403', async () => {
          const u = await createTempUser();
          const res = await as(admin).patch(`/api/users/${u.publicId}`, { firstName: 'X' });
          expect(res.status).toBe(403);
        });
      }
    });

    describe('DELETE /api/users/:id', () => {
      if (isPermitted(admin, 'users', 'delete')) {
        it('returns 204 on a temp user and GET 404 afterward', async () => {
          const u = await createTempUser();
          const del = await as(admin).del(`/api/users/${u.publicId}`);
          expect(del.status).toBe(204);
          const after = await as(admin).get(`/api/users/${u.publicId}`);
          expect(after.status).toBe(404);
        });

        it('returns 403 when deleting self', async () => {
          const selfId = await saUserIdFor(admin.email);
          const res = await as(admin).del(`/api/users/${selfId}`);
          expect(res.status).toBe(403);
        });
      } else {
        it('returns 403', async () => {
          const u = await createTempUser();
          const res = await as(admin).del(`/api/users/${u.publicId}`);
          expect(res.status).toBe(403);
        });
      }
    });

    describe('GET /api/users/:id/roles', () => {
      if (isPermitted(admin, 'users', 'getRoles')) {
        it('returns 200 with an array', async () => {
          const u = await createTempUser();
          const res = await as(admin).get(`/api/users/${u.publicId}/roles`);
          expect(res.status).toBe(200);
          expect(Array.isArray(res.body)).toBe(true);
        });
      } else {
        it('returns 403', async () => {
          const u = await createTempUser();
          const res = await as(admin).get(`/api/users/${u.publicId}/roles`);
          expect(res.status).toBe(403);
        });
      }
    });

    describe('GET /api/users/:id/effective-permissions', () => {
      if (isPermitted(admin, 'users', 'effectivePermissions')) {
        it('returns 200 with { userId, permissions: [] }', async () => {
          const u = await createTempUser();
          const res = await as(admin).get(`/api/users/${u.publicId}/effective-permissions`);
          expect(res.status).toBe(200);
          expect(res.body.userId).toBe(u.publicId);
          expect(Array.isArray(res.body.permissions)).toBe(true);
        });
      } else {
        it('returns 403', async () => {
          const u = await createTempUser();
          const res = await as(admin).get(`/api/users/${u.publicId}/effective-permissions`);
          expect(res.status).toBe(403);
        });
      }
    });

    describe('POST /api/users/:id/roles', () => {
      if (isPermitted(admin, 'users', 'assignRole')) {
        it('returns 204 when assigning an existing role', async () => {
          const u = await createTempUser();
          const role = await createTempRole();
          const res = await as(admin).post(`/api/users/${u.publicId}/roles`, { roleId: role.publicId });
          expect(res.status).toBe(204);
          // cleanup the assignment so the role can be deleted
          await as(superAdmin()).del(`/api/users/${u.publicId}/roles/${role.publicId}`);
        });
      } else {
        it('returns 403', async () => {
          const u = await createTempUser();
          const role = await createTempRole();
          const res = await as(admin).post(`/api/users/${u.publicId}/roles`, { roleId: role.publicId });
          expect(res.status).toBe(403);
        });
      }
    });

    describe('DELETE /api/users/:id/roles/:roleId', () => {
      if (isPermitted(admin, 'users', 'removeRole')) {
        it('returns 204 when removing an assigned role', async () => {
          const u = await createTempUser();
          const role = await createTempRole();
          await as(superAdmin()).post(`/api/users/${u.publicId}/roles`, { roleId: role.publicId });
          const res = await as(admin).del(`/api/users/${u.publicId}/roles/${role.publicId}`);
          expect(res.status).toBe(204);
        });
      } else {
        it('returns 403', async () => {
          const u = await createTempUser();
          const role = await createTempRole();
          await as(superAdmin()).post(`/api/users/${u.publicId}/roles`, { roleId: role.publicId });
          const res = await as(admin).del(`/api/users/${u.publicId}/roles/${role.publicId}`);
          expect(res.status).toBe(403);
        });
      }
    });

    describe('POST /api/users/:id/resend-invitation', () => {
      if (isPermitted(admin, 'users', 'resendInvitation')) {
        it('returns 201 with a fresh inviteUrl for a pending user', async () => {
          const u = await createTempUser(); // createTempUser creates a 'pending' user
          const res = await as(admin).post(`/api/users/${u.publicId}/resend-invitation`, {});
          expect(res.status).toBe(201);
          expect(res.body.inviteUrl).toBeDefined();
        });
      } else {
        it('returns 403', async () => {
          const u = await createTempUser();
          const res = await as(admin).post(`/api/users/${u.publicId}/resend-invitation`, {});
          expect(res.status).toBe(403);
        });
      }
    });

    if (isPermitted(admin, 'users', 'create')
        && isPermitted(admin, 'users', 'update')
        && isPermitted(admin, 'users', 'delete')) {
      describe('Create → Get → Update → Delete → Get 404 round-trip', () => {
        it('completes end-to-end', async () => {
          const org = await createTempOrg();
          const a = as(admin);
          const email = `e2e-rt-${uniqueName('u')}@example.com`;

          const create = await a.post('/api/users', {
            firstName: 'RT', lastName: 'User', email, orgId: org.publicId,
          });
          expect(create.status).toBe(201);
          const id = create.body.user.id as string;

          const got = await a.get(`/api/users/${id}`);
          expect(got.status).toBe(200);

          const update = await a.patch(`/api/users/${id}`, { firstName: 'Renamed' });
          expect(update.status).toBe(200);
          expect(update.body.firstName).toBe('Renamed');

          const del = await a.del(`/api/users/${id}`);
          expect(del.status).toBe(204);

          const after = await a.get(`/api/users/${id}`);
          expect(after.status).toBe(404);

          // Tidy the dangling BetterAuth row (API doesn't touch it).
          await prisma.user.deleteMany({ where: { email } });
        });
      });
    }
  });
});
