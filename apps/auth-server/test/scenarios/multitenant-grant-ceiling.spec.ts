import {
  bootScenarioApp, closeScenarioApp, asEmail, DEMO_USERS,
  demoUserIdByEmail, demoPermIdByName,
} from './factories';

describe('multi-tenant grant ceiling', () => {
  beforeAll(async () => {
    await bootScenarioApp();
  });
  afterAll(async () => {
    await closeScenarioApp();
  });

  it('acme-admin can grant contracts.read to acme-alice (app perm, in-app)', async () => {
    const aliceId = await demoUserIdByEmail(DEMO_USERS.acmeAlice);
    const permId  = await demoPermIdByName('contracts.read');
    const res = await asEmail(DEMO_USERS.acmeAdmin).put(
      `/api/users/${aliceId}/direct-permissions`,
      { permissionIds: [permId] },
    );
    expect(res.status).toBe(204);
  });

  it('acme-admin can grant contracts.create to acme-bob', async () => {
    const bobId = await demoUserIdByEmail(DEMO_USERS.acmeBob);
    const permId = await demoPermIdByName('contracts.create');
    const res = await asEmail(DEMO_USERS.acmeAdmin).put(
      `/api/users/${bobId}/direct-permissions`,
      { permissionIds: [permId] },
    );
    expect(res.status).toBe(204);
  });

  it('acme-admin can grant org.users.manage to acme-alice (caller holds it, isSystem cross-app)', async () => {
    const aliceId   = await demoUserIdByEmail(DEMO_USERS.acmeAlice);
    const contractsRead   = await demoPermIdByName('contracts.read');
    const orgUsersManage  = await demoPermIdByName('org.users.manage');
    // Replace alice's grants — keep contracts.read and add org.users.manage.
    const res = await asEmail(DEMO_USERS.acmeAdmin).put(
      `/api/users/${aliceId}/direct-permissions`,
      { permissionIds: [contractsRead, orgUsersManage] },
    );
    expect(res.status).toBe(204);
  });

  it('acme-admin CANNOT grant org.roles.manage to acme-bob (caller does not hold it)', async () => {
    const bobId          = await demoUserIdByEmail(DEMO_USERS.acmeBob);
    const orgRolesManage = await demoPermIdByName('org.roles.manage');
    const res = await asEmail(DEMO_USERS.acmeAdmin).put(
      `/api/users/${bobId}/direct-permissions`,
      { permissionIds: [orgRolesManage] },
    );
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).toMatch(/org\.roles\.manage/);
  });

  it('acme-admin CANNOT grant platform.users.manage to acme-alice (cross-app, non-system)', async () => {
    const aliceId = await demoUserIdByEmail(DEMO_USERS.acmeAlice);
    const platformPerm = await demoPermIdByName('platform.users.manage');
    const res = await asEmail(DEMO_USERS.acmeAdmin).put(
      `/api/users/${aliceId}/direct-permissions`,
      { permissionIds: [platformPerm] },
    );
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/different app/);
  });

  it('acme-admin CANNOT grant contracts.read to globex-gina (cross-org)', async () => {
    const ginaId = await demoUserIdByEmail(DEMO_USERS.globexGina);
    const contractsRead = await demoPermIdByName('contracts.read');
    const res = await asEmail(DEMO_USERS.acmeAdmin).put(
      `/api/users/${ginaId}/direct-permissions`,
      { permissionIds: [contractsRead] },
    );
    expect(res.status).toBe(403);
  });
});
