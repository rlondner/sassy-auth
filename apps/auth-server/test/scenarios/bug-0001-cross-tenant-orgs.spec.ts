/**
 * bug-0001 — `checkPermission` grants access when the caller holds a
 * non-platform permission (e.g. `org.users.manage`) and no
 * `targetOrgId` is supplied. This spec proves the bug is exploitable
 * end-to-end today by driving the real HTTP + Prisma stack.
 *
 * The two vulnerable endpoints exercised here are both in
 * `OrgsService`:
 *   • `GET /api/orgs/:publicId` (getOrg)   — orgs.service.ts:76
 *   • `GET /api/orgs`           (listOrgs) — orgs.service.ts:45
 *
 * Both include `'org.users.manage'` in the required list without a
 * companion `targetOrgId`, so the second loop of `checkPermission`
 * falls through `options.targetOrgId === undefined` → silent success
 * for any caller holding `org.users.manage` in ANY org.
 *
 * Test intent — assert the SECURITY-CORRECT behavior on both paths:
 *   • Reading another org's detail must be 403.
 *   • Listing orgs must either 403 the org-scoped caller OR return a
 *     filtered list that excludes foreign orgs. Both are acceptable
 *     fixes; both fail against today's `master`, which returns 200
 *     with Globex's row visible to Acme's admin.
 *
 * When bug-0001 is fixed, both tests turn green. Failure output on
 * master will show the exact HTTP status and body payload proving the
 * leak.
 */
import {
  bootScenarioApp,
  closeScenarioApp,
  asEmail,
  DEMO_USERS,
  demoOrgIdByName,
} from './factories';

describe('bug-0001 — checkPermission not org-scoped for /api/orgs', () => {
  beforeAll(async () => {
    await bootScenarioApp();
  });
  afterAll(async () => {
    await closeScenarioApp();
  });

  // `it.failing` — these tests are the regression gate for bug-0001.
  // They EXPECT to fail today (that's how they prove the bug). When
  // bug-0001 is fixed, `it.failing` will flip them from "passing (as
  // expected-to-fail)" to "failing (unexpectedly-passing)", forcing
  // the fixer to remove `.failing` and turn them into normal `it`.
  it.failing('acme-admin (holds only `org.users.manage` in Acme) MUST NOT read Globex org detail', async () => {
    const globexOrgId = await demoOrgIdByName('Globex');
    const res = await asEmail(DEMO_USERS.acmeAdmin).get(`/api/orgs/${globexOrgId}`);

    // Post-fix: 403. Pre-fix (bug-0001 present): 200 with Globex's row.
    // We assert the ideal target so this test remains the regression
    // gate once the fix lands.
    expect(res.status).toBe(403);

    // Belt-and-suspenders: even if a future refactor changes the status
    // to something else, the body MUST NOT leak Globex's identifying
    // fields to an Acme-scoped caller.
    if (res.status === 200) {
      const body = res.body as { publicId?: string; name?: string };
      expect(body.name).not.toBe('Globex');
      expect(body.publicId).not.toBe(globexOrgId);
    }
  });

  it.failing('acme-admin MUST NOT see Globex when listing /api/orgs', async () => {
    const globexOrgId = await demoOrgIdByName('Globex');
    const res = await asEmail(DEMO_USERS.acmeAdmin).get('/api/orgs');

    // Two acceptable fixes:
    //   A) 403 the org-scoped caller entirely (strictest).
    //   B) 200 with a list filtered to only orgs the caller can see.
    // Both fail today because master returns 200 with BOTH orgs.
    if (res.status === 403) {
      // Fix option A — accepted.
      return;
    }
    expect(res.status).toBe(200);
    const items = (res.body?.items ?? res.body) as Array<{ publicId: string; name: string }>;
    expect(Array.isArray(items)).toBe(true);
    // The bug-0001 leak: Globex present in Acme-admin's view.
    const leaked = items.find((o) => o.publicId === globexOrgId || o.name === 'Globex');
    expect(leaked).toBeUndefined();
  });

  it.failing('symmetric check — globex-admin MUST NOT read Acme org detail', async () => {
    const acmeOrgId = await demoOrgIdByName('Acme');
    const res = await asEmail(DEMO_USERS.globexAdmin).get(`/api/orgs/${acmeOrgId}`);
    expect(res.status).toBe(403);
    if (res.status === 200) {
      const body = res.body as { publicId?: string; name?: string };
      expect(body.name).not.toBe('Acme');
      expect(body.publicId).not.toBe(acmeOrgId);
    }
  });
});
