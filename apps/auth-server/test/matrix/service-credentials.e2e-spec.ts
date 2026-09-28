import request from 'supertest';
import { prisma } from '@sassy-auth/db';
import { bootApp, closeApp, as } from './harness';
import { createTempApp, superAdmin } from './factories';

describe('Service client_credentials → /api/service/users', () => {
  let httpServer: Awaited<ReturnType<typeof bootApp>>['httpServer'];
  let appPublicId: string;
  let clientSecret: string;
  let orgPublicId: string;
  let userPublicId: string;
  let rolePublicId: string;
  let otherAppPublicId: string;
  let otherRolePublicId: string;

  beforeAll(async () => {
    const booted = await bootApp();
    httpServer = booted.httpServer;
    const admin = as(superAdmin());

    const app = await createTempApp();
    appPublicId = app.publicId;

    // No @HttpCode override on AppsController.rotateClientSecret
    // (apps.controller.ts:44-47), so this is Nest's default 201 for POST.
    const secretRes = await admin.post(`/api/apps/${appPublicId}/client-secret`, {});
    if (secretRes.status !== 201) {
      throw new Error(`rotate client-secret failed (${secretRes.status}): ${JSON.stringify(secretRes.body)}`);
    }
    clientSecret = secretRes.body.clientSecret;

    const orgRes = await admin.post('/api/orgs', { name: `svc-org-${appPublicId}`, appId: appPublicId });
    orgPublicId = orgRes.body.publicId;

    const userRes = await admin.post('/api/users', {
      firstName: 'Svc', lastName: 'Target',
      email: `svc-target-${appPublicId}@example.com`,
      orgId: orgPublicId,
    });
    userPublicId = userRes.body.user.id;

    const roleRes = await admin.post('/api/roles', {
      name: `svc-role-${appPublicId}`, appId: appPublicId, permissionIds: [],
    });
    rolePublicId = roleRes.body.publicId;

    const otherApp = await createTempApp();
    otherAppPublicId = otherApp.publicId;
    const otherRoleRes = await admin.post('/api/roles', {
      name: `other-role-${otherAppPublicId}`, appId: otherAppPublicId, permissionIds: [],
    });
    otherRolePublicId = otherRoleRes.body.publicId;
  });

  afterAll(async () => {
    await closeApp();
  });

  async function exchangeServiceToken(clientId: string, secret: string) {
    return request(httpServer)
      .post('/api/token/oauth/token')
      .send({ grant_type: 'client_credentials', client_id: clientId, client_secret: secret, scope: 'roles:write' });
  }

  it('rejects a wrong client secret with invalid_client', async () => {
    const res = await exchangeServiceToken(appPublicId, 'not-the-secret');
    expect(res.status).toBe(401);
    expect(res.body.message).toContain('invalid_client');
  });

  it('grants an empty scope when canManageOwnRoles is false (the default)', async () => {
    const res = await exchangeServiceToken(appPublicId, clientSecret);
    expect(res.status).toBe(200);
    expect(res.body.scope).toBe('');

    // A token with no roles:write scope must be rejected by the guard.
    const putRes = await request(httpServer)
      .put(`/api/service/users/${userPublicId}/roles/${rolePublicId}`)
      .set('Authorization', `Bearer ${res.body.access_token}`);
    expect(putRes.status).toBe(403);
  });

  it('assigns and removes a role once canManageOwnRoles is enabled', async () => {
    await prisma.saApp.update({ where: { publicId: appPublicId }, data: { canManageOwnRoles: true } });

    const tokenRes = await exchangeServiceToken(appPublicId, clientSecret);
    expect(tokenRes.status).toBe(200);
    expect(tokenRes.body.scope).toBe('roles:write');
    const serviceToken = tokenRes.body.access_token;

    const assignRes = await request(httpServer)
      .put(`/api/service/users/${userPublicId}/roles/${rolePublicId}`)
      .set('Authorization', `Bearer ${serviceToken}`);
    expect(assignRes.status).toBe(204);

    // Immediately reflected for a human admin reading the same user's roles
    // — resolveRoles/resolvePermissions re-query on every issueJwt call, so
    // there's no separate cache to invalidate.
    const rolesRes = await as(superAdmin()).get(`/api/users/${userPublicId}/roles`);
    expect(rolesRes.body.some((r: { publicId: string }) => r.publicId === rolePublicId)).toBe(true);

    const removeRes = await request(httpServer)
      .delete(`/api/service/users/${userPublicId}/roles/${rolePublicId}`)
      .set('Authorization', `Bearer ${serviceToken}`);
    expect(removeRes.status).toBe(204);

    const rolesAfterRes = await as(superAdmin()).get(`/api/users/${userPublicId}/roles`);
    expect(rolesAfterRes.body.some((r: { publicId: string }) => r.publicId === rolePublicId)).toBe(false);
  });

  it('404s assigning a role that belongs to a different app', async () => {
    await prisma.saApp.update({ where: { publicId: appPublicId }, data: { canManageOwnRoles: true } });
    const tokenRes = await exchangeServiceToken(appPublicId, clientSecret);
    const serviceToken = tokenRes.body.access_token;

    const res = await request(httpServer)
      .put(`/api/service/users/${userPublicId}/roles/${otherRolePublicId}`)
      .set('Authorization', `Bearer ${serviceToken}`);
    expect(res.status).toBe(404);
  });

  it('rejects client_credentials entirely for a non-confidential (no secret rotated) app', async () => {
    const publicApp = await createTempApp();
    const res = await exchangeServiceToken(publicApp.publicId, 'anything');
    expect(res.status).toBe(401);
    expect(res.body.message).toContain('invalid_client');
  });
});
