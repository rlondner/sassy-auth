# API & E2E Test Coverage Campaign — Design

**Date:** 2026-06-01
**Status:** Draft for review
**Owner:** Raphael Londner
**Related:** [2026-05-27-platform-admin-seed-design](./2026-05-27-platform-admin-seed-design.md), [2026-05-28-playwright-e2e-design](./2026-05-28-playwright-e2e-design.md)

---

## 1. Goal

Provide complete, automated test coverage for the five resource APIs (`/apps`, `/orgs`, `/roles`, `/permissions`, `/users`) and the corresponding admin UI, exercised by each of the five seeded platform admins. Run the resulting test campaign end-to-end and produce `bugs/TEST_BUGS.md` capturing every issue surfaced.

This is **not** a bug-fixing spec. It produces a test harness, a test matrix, and a triaged bug list. Fixes ship as follow-up PRs.

## 2. Background

### 2.1 Seeded admins (`apps/auth-server/src/seed/seed.ts`)

| Email | Grant | Password |
|---|---|---|
| `a@sa.io` | direct: `platform.apps.manage` | `Pass@word1234` |
| `o@sa.io` | direct: `platform.orgs.manage` | `Pass@word1234` |
| `u@sa.io` | direct: `platform.users.manage` | `Pass@word1234` |
| `p@sa.io` | direct: `platform.permissions.manage` | `Pass@word1234` |
| `s@sa.io` | role: `Platform Super Admin` (all six platform.* perms) | `Pass@word1234` |

All admins live on the platform org. The Super Admin role wires all six seeded `platform.*` permissions.

### 2.2 Effective permission → endpoint map

Derived by reading each service's `checkPermission(...)` call. `platform.permissions.manage` gates **both** `/roles` and `/permissions`.

| Admin | /apps | /orgs | /roles | /permissions | /users |
|---|---|---|---|---|---|
| `a@sa.io` | ✅ all ops | ❌ | ❌ | ❌ | ❌ |
| `o@sa.io` | ❌ | ✅ all ops | ❌ | ❌ | ❌ |
| `p@sa.io` | ❌ | ❌ | ✅ all ops | ✅ all ops | ❌ |
| `u@sa.io` | ❌ | ❌ | ❌ | ❌ | ✅ all ops |
| `s@sa.io` | ✅ all ops | ✅ all ops | ✅ all ops | ✅ all ops | ✅ all ops |

Extra invariants (assertions woven into the matrix):
- `PATCH /apps/:id` and `DELETE /apps/:id` against the seeded platform app (`isPlatform=true`) return **403** for everyone — including `s@sa.io`.
- `PATCH /permissions/:id` and `DELETE /permissions/:id` against any seeded `platform.*` permission return **403** for everyone — including `p@sa.io` and `s@sa.io`.
- `DELETE /users/:id` where the target is the caller's own SaUser returns **403** (self-delete guard).
- `GET /users` with no `orgId` query is permitted only for `platform.users.manage` (the `-1` sentinel in `users.service.ts`).

### 2.3 Existing test surface

- Service unit specs exist for all five services + `me`, `token`, `invitations`. Mocks for Prisma and `checkPermission`.
- Controller spec exists only for `token.controller.spec.ts`. The other six controllers have no spec.
- API E2E exists at `apps/auth-server/test/app.e2e-spec.ts` — in-process Nest + supertest against real Prisma. Covers `/api/token/*` and one super-admin `/api/users` smoke.
- Playwright suite at `apps/admin-e2e/` covers `/login` and super-admin nav across `/users`, `/apps`, `/orgs`. Per-admin matrix does not exist.

## 3. Scope

In scope:
- Unit-test gap fill (audit + add missing specs).
- API E2E matrix: every seeded admin × every endpoint × every op, positive (2xx) and negative (403).
- UI E2E matrix: every API cell performed (or asserted blocked) through the admin UI.
- Run all of the above and produce `bugs/TEST_BUGS.md`.

Out of scope:
- Fixing any bug surfaced.
- CI integration / GitHub Actions wiring.
- E2E coverage of `/me`, `/invitations`, `/api/auth/*`, or the `/token` endpoints beyond what `app.e2e-spec.ts` already has.
- Load testing, fuzz testing, mutation testing.

## 4. Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  Test Coverage Campaign                                             │
├─────────────────────────────────────────────────────────────────────┤
│  Wave A  Unit-test gap fill         apps/auth-server/src/**/*.spec  │
│  Wave B  API E2E matrix             apps/auth-server/test/matrix/   │
│  Wave C  UI E2E matrix              apps/admin-e2e/tests/matrix/    │
│  Wave D  Run + triage               bugs/TEST_BUGS.md               │
└─────────────────────────────────────────────────────────────────────┘
```

Two shared modules drive the matrices:

**`apps/auth-server/test/matrix/permissions-matrix.ts`** — single source of truth for which admin can do what:

```ts
export const SEED_ADMINS = [
  { key: 'apps',  email: 'a@sa.io', perms: ['platform.apps.manage'] },
  { key: 'orgs',  email: 'o@sa.io', perms: ['platform.orgs.manage'] },
  { key: 'users', email: 'u@sa.io', perms: ['platform.users.manage'] },
  { key: 'perms', email: 'p@sa.io', perms: ['platform.permissions.manage'] },
  { key: 'super', email: 's@sa.io', perms: ['platform.*'] },
] as const;

export type ResourceArea = 'apps' | 'orgs' | 'roles' | 'permissions' | 'users';
export type Op = 'list' | 'get' | 'create' | 'update' | 'delete' | /* sub-route ops */;

export function isPermitted(admin, area, op): boolean { ... }
```

**`apps/admin-e2e/lib/admins.ts`** — mirrors the auth-server module's shape so the two matrices stay aligned by convention. Duplication is small and intentional — `admin-e2e` must not depend on the auth-server TS build graph.

## 5. Wave A — unit-test gap fill

**Goal:** every public method on every service and controller has at least one happy-path test and at least one failure-path test, without rewriting what already works.

**Steps:**
1. Run `pnpm --filter @sassy-auth/auth-server test -- --coverage`. Save the report to `coverage/baseline.txt` so the after-PR delta is visible in PR 1.
2. Add minimal controller specs for `apps`, `orgs`, `roles`, `permissions`, `users`, `me`, `invitations` controllers — prove `BetterAuthGuard` is wired and `callerBaId` flows from `req.betterAuthUser.id` into the service. Pattern lifted from `token.controller.spec.ts`. Service is mocked with `useValue`.
3. For each existing service spec, identify missing branches (especially `Forbidden`, `Conflict`, `BadRequest`) and add only the missing cases inline.
4. New files live next to their subject (`apps.controller.spec.ts` beside `apps.controller.ts`).

Out of scope for Wave A: integration via real Prisma — that's Wave B.

## 6. Wave B — API E2E matrix

### 6.1 Layout

```
apps/auth-server/test/
├─ matrix/
│  ├─ permissions-matrix.ts        single source of truth
│  ├─ harness.ts                    Nest bootstrap, signInAs(), as()
│  ├─ factories.ts                  uniqueName(), createTempApp/Org/Role/Permission/User, cleanup()
│  ├─ apps.matrix.e2e-spec.ts
│  ├─ orgs.matrix.e2e-spec.ts
│  ├─ roles.matrix.e2e-spec.ts
│  ├─ permissions.matrix.e2e-spec.ts
│  └─ users.matrix.e2e-spec.ts
└─ jest-e2e.json                    already picks up *.e2e-spec.ts
```

### 6.2 `harness.ts`

- `bootApp()` — boots Nest once per matrix file. Runs `prisma migrate deploy` and `pnpm seed` if not already present.
- `signInAs(email)` — returns the `better-auth.session_token=...` cookie string for the given seeded admin. Cached per admin within a file run so re-login is not paid per test.
- `as(admin)` — returns a supertest agent helper pre-loaded with that admin's cookie.

### 6.3 `factories.ts`

- `uniqueName(prefix)` → `${prefix}-${crypto.randomUUID().slice(0,8)}`.
- `createTempApp(asSuper)`, `createTempOrg(asSuper, appId)`, `createTempRole(asSuper, appId)`, `createTempPermission(asSuper, appId)`, `createTempUser(asSuper, orgId)` — each returns the created publicId AND registers a cleanup callback for the file's `afterEach`.
- `cleanup()` — drains the per-test cleanup queue in LIFO order so children fall before parents.

### 6.4 Spec shape (apps.matrix.e2e-spec.ts as template)

```ts
const PERMITTED_FOR = { apps: ['a@sa.io', 's@sa.io'] } as const;

describe.each(SEED_ADMINS)('/apps as $email', (admin) => {
  let cookie: string;
  beforeAll(async () => { cookie = await signInAs(admin.email); });

  const permitted = PERMITTED_FOR.apps.includes(admin.email);

  describe('LIST GET /api/apps', () => {
    if (permitted) {
      it('returns 200 with items[]', async () => { ... });
    } else {
      it('returns 403', async () => { ... });
    }
  });

  // CREATE, UPDATE, DELETE — same shape

  if (permitted) {
    it('Create → GET → Update → GET → Delete → GET 404 round-trip', async () => { ... });
  }
});
```

### 6.5 Extra assertions woven in

- Permitted CREATE → assert row appears in subsequent LIST.
- Permitted DELETE → assert subsequent GET returns 404.
- Permitted UPDATE/DELETE on the seeded platform app → assert 403 (platform app immutable).
- Permitted UPDATE/DELETE on any seeded `platform.*` permission → assert 403 (system permissions immutable).
- Permitted DELETE on `/users` targeting self → assert 403 (self-delete guard).
- `GET /users` with no `orgId` query → assert only `platform.users.manage` admins succeed.

### 6.6 Data lifecycle

- Seed runs once at suite start. The 5 admins, 6 platform perms, platform app, platform org persist across all tests.
- Every CREATE uses `uniqueName(...)` → no UNIQUE collisions across parallel runs.
- `afterEach` drains the cleanup queue. Orphans from a crashed test are tolerable — next CREATE uses a fresh uuid.
- `afterAll` does NOT truncate — keeps the seed intact for the next run.

### 6.7 Cell count

| Area | Ops | Cells × 5 admins | Round-trips | Total |
|---|---|---|---|---|
| apps | 5 | 25 | +2 (a, s) | 27 |
| orgs | 5 | 25 | +2 (o, s) | 27 |
| roles | 5 | 25 | +2 (p, s) | 27 |
| permissions | 5 + 3 immutability | 28 | +2 (p, s) | 30 |
| users | 10 | 50 | +2 (u, s) | 55 |
| **Total** | | | | **~166** |

## 7. Wave C — UI E2E matrix

### 7.1 Layout

```
apps/admin-e2e/
├─ .auth/
│  ├─ apps-admin.json               new
│  ├─ orgs-admin.json               new
│  ├─ perms-admin.json              new
│  ├─ users-admin.json              new
│  └─ super-admin.json              existing
├─ auth-state.setup.ts              extended: loops over 5 admins
├─ lib/
│  ├─ fixtures.ts                   existing diagnostics extension
│  ├─ i18n.ts                       existing
│  └─ admins.ts                     NEW: mirrors permissions-matrix.ts
├─ pages/
│  ├─ login.page.ts                 existing
│  ├─ apps.page.ts                  NEW
│  ├─ orgs.page.ts                  NEW
│  ├─ roles.page.ts                 NEW
│  ├─ permissions.page.ts           NEW
│  └─ users.page.ts                 NEW
└─ tests/
   ├─ login.spec.ts                 existing
   └─ matrix/
      ├─ nav-gates.spec.ts          5 tests (1 per admin)
      ├─ apps.matrix.spec.ts
      ├─ orgs.matrix.spec.ts
      ├─ roles.matrix.spec.ts
      ├─ permissions.matrix.spec.ts
      └─ users.matrix.spec.ts
```

### 7.2 Playwright config additions

One project per admin. Each matrix file runs once per project — Playwright multiplies tests by project automatically.

```ts
projects: [
  { name: 'setup', testMatch: /auth-state\.setup\.ts/ },
  { name: 'chromium',       use: { ... }, testIgnore: /(authed|matrix)\/.*\.spec\.ts/ },
  { name: 'chromium-super', use: { storageState: '.auth/super-admin.json' }, dependencies: ['setup'], testMatch: /(authed|matrix)\/.*\.spec\.ts/ },
  { name: 'chromium-apps',  use: { storageState: '.auth/apps-admin.json'  }, dependencies: ['setup'], testMatch: /matrix\/.*\.spec\.ts/ },
  { name: 'chromium-orgs',  use: { storageState: '.auth/orgs-admin.json'  }, dependencies: ['setup'], testMatch: /matrix\/.*\.spec\.ts/ },
  { name: 'chromium-perms', use: { storageState: '.auth/perms-admin.json' }, dependencies: ['setup'], testMatch: /matrix\/.*\.spec\.ts/ },
  { name: 'chromium-users', use: { storageState: '.auth/users-admin.json' }, dependencies: ['setup'], testMatch: /matrix\/.*\.spec\.ts/ },
]
```

### 7.3 Per-area spec shape (apps.matrix.spec.ts as template)

```ts
import { test, expect } from '../../lib/fixtures';
import { adminFromProject, permittedForArea } from '../../lib/admins';
import { AppsPage } from '../../pages/apps.page';

test.describe('/apps UI matrix', () => {
  test('list page renders for permitted admins, blocks for the rest', async ({ page }, info) => {
    const admin = adminFromProject(info.project.name);
    await page.goto('/apps');
    if (permittedForArea(admin, 'apps')) {
      await expect(page.getByRole('heading', { name: /^Apps\b/ })).toBeVisible();
    } else {
      await expect(page).toHaveURL(/\/(users|login|403|forbidden)/);
    }
  });

  test('Create drawer: open, submit, row appears in table', async ({ page }, info) => {
    const admin = adminFromProject(info.project.name);
    test.skip(!permittedForArea(admin, 'apps'), 'admin lacks platform.apps.manage');
    const apps = new AppsPage(page);
    await apps.goto();
    const name = `e2e-app-${crypto.randomUUID().slice(0,8)}`;
    await apps.createApp({ name, url: 'https://example.com' });
    await expect(apps.rowByName(name)).toBeVisible();
    await apps.deleteApp(name);
  });

  // Update via row action, Delete via row action — same shape
});
```

### 7.4 Page object pattern

- Role-based selectors (`getByRole('button', { name: t('apps.create') })`) per existing convention.
- Surfaces: `goto()`, `rowByName(name)`, `createX({...})`, `editX(name, patch)`, `deleteX(name)`. Each method awaits success-toast or drawer-close — no arbitrary `waitForTimeout`.

### 7.5 Race-and-assert pattern

Bake the `login.spec.ts` race-then-fail-with-rendered-text pattern into every page-object mutating method, so a UI error becomes the failure reason instead of a generic timeout.

### 7.6 Cleanup

- Each test that creates a row deletes it at the end via the UI delete flow (success-toast wait → assert gone). Avoids the test having to know about Prisma.
- If a UI delete itself is what's being tested, the test creates via the API (using the admin's session cookie reused from storageState) and asserts only the UI delete leg.

### 7.7 Cell count

| Area | UI ops per admin | Cells × 5 admins | Total |
|---|---|---|---|
| apps | nav-gate + list + create + edit + delete + platform-immutable | 6 | 30 |
| orgs | nav-gate + list + create + edit + delete | 5 | 25 |
| roles | nav-gate + list + create + edit + delete | 5 | 25 |
| permissions | nav-gate + list + create + edit + delete + system-immutable | 6 | 30 |
| users | nav-gate + list + create + edit + delete + resend-invite + assign-role + remove-role | 8 | 40 |
| **Total** | | | **~150** |

Plus `nav-gates.spec.ts` (5 tests).

Runtime estimate: ~150 cells × ~3s = ~7–8 min serial, ~2–3 min with `fullyParallel: true`.

## 8. Wave D — run everything + bug triage

### 8.1 Pre-run setup

1. Verify `.env` has `DATABASE_URL`, `BETTER_AUTH_SECRET`, `RSA_PRIVATE_KEY`, `RSA_PUBLIC_KEY`, `BETTER_AUTH_URL`. Bail with a clear error if missing.
2. `pnpm prisma migrate deploy --schema=packages/db/schema.prisma`.
3. `pnpm --filter @sassy-auth/auth-server seed` — idempotent.

### 8.2 Execution order (sequenced; Wave B and C share port 3000)

```
Wave A: pnpm --filter @sassy-auth/auth-server test -- --coverage
        → coverage/baseline.txt

Wave B: pnpm --filter @sassy-auth/auth-server test:e2e
        → Nest in-process, real Prisma. Save junit report.

Wave C: pnpm --filter @sassy-auth/admin-e2e test:e2e
        → Playwright with 5 admin projects. playwright-report/ + traces.
```

### 8.3 Stay-the-course rule

Unit-test failures do NOT abort the campaign. A failing Wave A spec becomes a `bug-NNNN` entry; Waves B and C still execute. Use `|| true` at the shell level. The whole point is to surface as many issues as possible in one pass.

### 8.4 Bug intake

Per failing test, build an entry with:
- `bug-NNNN` — incrementing from the last id in `bugs/BUGS_2026-05-31.md` (last: `bug-0023`; first new id: `bug-0024`). Verify against actual file at PR time.
- **Wave + spec path + test name** — so the user can re-run just that test.
- **Severity** using the existing legend:
  - 🔴 **Critical** — admin gets 2xx where matrix says 403 (privilege escalation), unauthenticated 2xx, seed inconsistency.
  - 🟡 **Warning** — admin gets 403 where matrix says 2xx, 5xx where 4xx expected, response shape contract drift.
  - 🔵 **Minor** — UI shows button it shouldn't (visible-but-disabled), wrong validation message, test-side race.
  - ⚪ **Info** — test infrastructure quirks, slow tests, advisory.
- **Reproducer** — single command (`pnpm --filter ... test:e2e -t "..."`).
- **Observed vs expected** — verbatim from the assertion failure.
- **Evidence** — Playwright trace + screenshot for Wave C; stack frame + supertest response body for Waves A/B.
- **Fix sketch** — optional; only when cause is obvious from the assertion.
- **Tests needed** — usually the failing test itself, kept for the fix-PR's regression check.

### 8.5 Root-cause deduplication

If one root cause produces N failures, they get one `bug-NNNN` entry with the failing-test list bundled. Avoids 30 duplicate bugs for one missing `checkPermission` call.

### 8.6 `bugs/TEST_BUGS.md` shape

```
# Test Coverage Campaign — Bug Log

Bugs surfaced by the 2026-06-01 test-coverage campaign. Each entry has a
stable bug-NNNN id. Numbering continues from BUGS_2026-05-31.md
(last: bug-0023).

Run command:
  pnpm --filter @sassy-auth/auth-server test
  pnpm --filter @sassy-auth/auth-server test:e2e
  pnpm --filter @sassy-auth/admin-e2e test:e2e

Severity legend: (same as BUGS_*.md)

## Summary
- Wave A (unit, services + controllers): N tests, X failing
- Wave B (API E2E matrix):                M tests, Y failing
- Wave C (UI E2E matrix):                 K tests, Z failing

---

## 🔴 bug-0024 — <one-line title>
**Fixed:** false
**Severity:** Critical
**Wave:** B
**Spec:** apps/auth-server/test/matrix/apps.matrix.e2e-spec.ts
**Test:** "/apps as o@sa.io  →  POST /api/apps returns 403"
**Reproducer:** pnpm --filter @sassy-auth/auth-server test:e2e -t "/apps as o@sa.io"

**Description.** o@sa.io holds only platform.orgs.manage but POST /api/apps
returned 201. Expected 403. ...

**Fix sketch.** (only when obvious)
**Tests needed.** (already exists — keep as regression)

---
```

### 8.7 Environmental vs code bugs

Failures from environment (DB not migrated, dev server not up, seed conflict on a prior orphan) go in `TEST_BUGS.md` as ⚪ Info with severity "Test-only" — distinct from code bugs.

## 9. Risks & mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| `pnpm seed` over a stale dev DB hits an orphan `e2e-user@example.com` | High | Existing cleanup describe at the bottom of `app.e2e-spec.ts` handles it. Worst case: document `pnpm prisma migrate reset` in the spec's run section. |
| Per-admin storageState files go stale (session expires, secret rotates) | Medium | `auth-state.setup.ts` is a `setup` project dependency — re-logs-in all 5 admins on every run. |
| `fullyParallel: true` Playwright across 5 admin projects causes UNIQUE collisions on factories | Medium | Use `crypto.randomUUID().slice(0,8)` not `Date.now()`. |
| Campaign surfaces 30+ bugs, `TEST_BUGS.md` balloons | Medium-low | Root-cause-dedup rule (§8.5) keeps the list short. If it does balloon, that's a useful signal. |
| In-process Nest E2E and Playwright dev-server fight over port 3000 | High if concurrent | Sequenced — Wave B finishes (`app.close()`) before Wave C starts. |
| Wave A controller specs accidentally hit real Prisma | Low | Each spec uses Nest `Test.createTestingModule` with `useValue` mocks for the service. Pattern from `token.controller.spec.ts`. |
| Matrix tests only test the test-data factories, not the product | Medium | The hand-written round-trips (§6.5) and per-area drawer flows (§7.3) verify real product behavior. Generated cells only check status codes — that's their purpose for 403 negatives. |

## 10. Sequencing — landable PRs

1. **PR 1 — Wave A:** unit-test gap fill. No infra changes. ~12 files.
2. **PR 2 — Wave B infra:** `permissions-matrix.ts`, `harness.ts`, `factories.ts`. Empty matrix files (no-op describes). Green CI on its own.
3. **PR 3 — Wave B specs:** populate the 5 matrix files. First wave of bugs likely surfaces here.
4. **PR 4 — Wave C infra:** `lib/admins.ts`, expanded `auth-state.setup.ts`, 5 page-object files, expanded `playwright.config.ts`. Empty matrix files.
5. **PR 5 — Wave C specs:** populate the 5 matrix files + `nav-gates.spec.ts`.
6. **PR 6 — `bugs/TEST_BUGS.md`:** the bug log from running everything end-to-end.

## 11. Definition of done

- All 6 PRs merged.
- `pnpm --filter @sassy-auth/auth-server test` passes (Wave A).
- `pnpm --filter @sassy-auth/auth-server test:e2e` runs to completion (Wave B). Failing tests are bugs, not blockers.
- `pnpm --filter @sassy-auth/admin-e2e test:e2e` runs to completion (Wave C). Same rule.
- `bugs/TEST_BUGS.md` exists with Summary + one entry per distinct root cause.
- Coverage delta documented in PR 1's description.
