/**
 * bug-0001 — `checkPermission` previously granted access when the
 * caller held a non-platform permission (e.g. `org.users.manage`) and
 * no `targetOrgId` was supplied. This spec covers the two vulnerable
 * endpoints in `OrgsService` end-to-end:
 *
 *   • `GET /api/orgs/:publicId` (getOrg)   — orgs.service.ts
 *   • `GET /api/orgs`           (listOrgs) — orgs.service.ts
 *
 * The fix landed as three coordinated changes:
 *   1. `checkPermission` now falls through to ForbiddenException when
 *      a non-platform perm matches but `targetOrgId` is undefined
 *      (symmetric to the bug-0094 fix on `checkPermissionForApp`).
 *   2. `getOrg` fetches the org first and passes `{ targetOrgId: org.id }`.
 *   3. `listOrgs` uses the new `resolveListScope` helper — platform.*
 *      holders keep unscoped access; org.* holders get a `where` clause
 *      filter to their own org.
 *
 * These tests now serve as the regression gate. If bug-0001 ever comes
 * back (e.g., someone reverts `checkPermission` or removes the
 * `targetOrgId` argument in `getOrg`), the assertions here flip red.
 */
import {
  bootScenarioApp,
  closeScenarioApp,
  asEmail,
  DEMO_USERS,
  demoOrgIdByName,
} from './factories';

describe('bug-0001 — checkPermission org-scope enforcement on /api/orgs', () => {
  beforeAll(async () => {
    await bootScenarioApp();
  });
  afterAll(async () => {
    await closeScenarioApp();
  });

  // ── Cross-tenant reads MUST be rejected ───────────────────────────

  it('acme-admin (holds only `org.users.manage` in Acme) MUST NOT read Globex org detail', async () => {
    const globexOrgId = await demoOrgIdByName('Globex');
    const res = await asEmail(DEMO_USERS.acmeAdmin).get(`/api/orgs/${globexOrgId}`);
    expect(res.status).toBe(403);
  });

  it('symmetric check — globex-admin MUST NOT read Acme org detail', async () => {
    const acmeOrgId = await demoOrgIdByName('Acme');
    const res = await asEmail(DEMO_USERS.globexAdmin).get(`/api/orgs/${acmeOrgId}`);
    expect(res.status).toBe(403);
  });

  it('acme-admin MUST NOT see Globex when listing /api/orgs', async () => {
    const globexOrgId = await demoOrgIdByName('Globex');
    const res = await asEmail(DEMO_USERS.acmeAdmin).get('/api/orgs');
    expect(res.status).toBe(200);
    const items = (res.body?.items ?? res.body) as Array<{ publicId: string; name: string }>;
    expect(Array.isArray(items)).toBe(true);
    const leaked = items.find((o) => o.publicId === globexOrgId || o.name === 'Globex');
    expect(leaked).toBeUndefined();
  });

  // ── Positive paths — the org admin still gets what they should ────

  it('acme-admin reading their own Acme org succeeds (200)', async () => {
    const acmeOrgId = await demoOrgIdByName('Acme');
    const res = await asEmail(DEMO_USERS.acmeAdmin).get(`/api/orgs/${acmeOrgId}`);
    expect(res.status).toBe(200);
    expect(res.body?.publicId).toBe(acmeOrgId);
    expect(res.body?.name).toBe('Acme');
  });

  it('acme-admin listing /api/orgs sees exactly one row — their own Acme org', async () => {
    const acmeOrgId = await demoOrgIdByName('Acme');
    const res = await asEmail(DEMO_USERS.acmeAdmin).get('/api/orgs');
    expect(res.status).toBe(200);
    const items = (res.body?.items ?? res.body) as Array<{ publicId: string; name: string }>;
    expect(items).toHaveLength(1);
    expect(items[0].publicId).toBe(acmeOrgId);
    expect(items[0].name).toBe('Acme');
  });

  it('globex-admin listing /api/orgs sees exactly one row — their own Globex org', async () => {
    const globexOrgId = await demoOrgIdByName('Globex');
    const res = await asEmail(DEMO_USERS.globexAdmin).get('/api/orgs');
    expect(res.status).toBe(200);
    const items = (res.body?.items ?? res.body) as Array<{ publicId: string; name: string }>;
    expect(items).toHaveLength(1);
    expect(items[0].publicId).toBe(globexOrgId);
    expect(items[0].name).toBe('Globex');
  });
});
