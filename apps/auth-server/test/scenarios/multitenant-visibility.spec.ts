import { bootScenarioApp, closeScenarioApp, asEmail, DEMO_USERS, demoOrgIdByName } from './factories';

describe('multi-tenant visibility', () => {
  beforeAll(async () => {
    await bootScenarioApp();
  });
  afterAll(async () => {
    await closeScenarioApp();
  });

  it('acme-admin sees only Acme users when scoped to their own org', async () => {
    const acmeOrgId = await demoOrgIdByName('Acme');
    const res = await asEmail(DEMO_USERS.acmeAdmin).get(`/api/users?orgId=${acmeOrgId}`);
    expect(res.status).toBe(200);
    const body = res.body as Array<{ email: string; orgId: string }>;
    expect(body).toHaveLength(3);
    expect(body.every((u) => u.orgId === acmeOrgId)).toBe(true);
    expect(body.every((u) => u.email.startsWith('acme-'))).toBe(true);
  });

  it('acme-admin is rejected (403) when querying Globex users', async () => {
    const globexOrgId = await demoOrgIdByName('Globex');
    const res = await asEmail(DEMO_USERS.acmeAdmin).get(`/api/users?orgId=${globexOrgId}`);
    expect(res.status).toBe(403);
  });

  it('acme-admin is rejected (403) when listing users without an orgId', async () => {
    const res = await asEmail(DEMO_USERS.acmeAdmin).get('/api/users');
    expect(res.status).toBe(403);
  });

  it('globex-admin sees only Globex users when scoped to their own org', async () => {
    const globexOrgId = await demoOrgIdByName('Globex');
    const res = await asEmail(DEMO_USERS.globexAdmin).get(`/api/users?orgId=${globexOrgId}`);
    expect(res.status).toBe(200);
    const body = res.body as Array<{ email: string }>;
    expect(body).toHaveLength(3);
    expect(body.every((u) => u.email.startsWith('globex-'))).toBe(true);
  });

  it('globex-admin is rejected (403) when querying Acme users', async () => {
    const acmeOrgId = await demoOrgIdByName('Acme');
    const res = await asEmail(DEMO_USERS.globexAdmin).get(`/api/users?orgId=${acmeOrgId}`);
    expect(res.status).toBe(403);
  });
});
