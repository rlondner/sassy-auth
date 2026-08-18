# Test Coverage Campaign — Bug Log

Bugs surfaced by the 2026-06-01 test-coverage campaign. Each entry has a
stable bug-NNNN id. Numbering continues from BUGS_2026-05-31.md
(last: bug-0023).

**Run commands:**
- `pnpm --filter @sassy-auth/auth-server test`
- `pnpm --filter @sassy-auth/auth-server test:e2e`
- `CI_TESTS=true pnpm --filter @sassy-auth/admin-e2e test:e2e`

**Severity legend:**
- 🔴 Critical — privilege escalation, auth bypass, unauthenticated 2xx, seed inconsistency.
- 🟡 Warning — legitimate action blocked (403 where 2xx expected), 5xx where 4xx expected, contract drift.
- 🔵 Minor — UI permission visible-but-disabled leak, validation message wrong, test-side race.
- ⚪ Info — test infrastructure quirks, environmental, advisory.

---

## Summary

- Wave A (unit, services + controllers): 228 tests, 0 failing — clean run.
- Wave B (API E2E matrix):                184 tests, 0 failing — clean run (after the 9 bug fixes below were applied during Phase 3).
- Wave C (UI E2E matrix):                 ~152 tests × 7 projects = ~456 expected events; ~95% completed before the test runner was killed by the parent process. Captured failures included.

---

## Bugs surfaced and fixed during the campaign (Phase 3)

The 9 bug-NNNN entries below were surfaced by Wave B matrix tests and silently fixed by the
implementer rather than logged at the time. They are now documented here for completeness;
each maps to a `fix(bug-NNNN): ...` commit on this branch and an existing `fix/bug-NNNN-...` branch.

---

### bug-0024 — PermissionsService missing org/tenant isolation on all mutating operations

- **Severity:** 🔴 Critical
- **Wave:** B
- **Commit:** `f8cb355`
- **Area:** `apps/auth-server/src/permissions/permissions.service.ts`

**Description:**
All mutating methods in `PermissionsService` (`createPermission`, `updatePermission`,
`deletePermission`) called `checkPermission` with `platform.permissions.manage` but never
passed a `targetOrgId`. As a result, a super-admin token from Organisation A could create,
update, or delete permissions belonging to Organisation B. The missing `targetOrgId`
argument caused the permission check to operate at the global platform scope rather than
the org scope, defeating the entire tenant-isolation model.

**Fix sketch:** Pass the caller's `orgId` (extracted from the JWT) as `targetOrgId` in
every `checkPermission` call inside `PermissionsService`.

**Tests that surfaced this:** Wave B `/permissions` matrix — POST/PATCH/DELETE rows for
admins whose org should not have access returned 200 instead of 403.

---

### bug-0025 — RolesService missing org/tenant isolation on all mutating operations

- **Severity:** 🔴 Critical
- **Wave:** B
- **Commit:** `072ad5b`
- **Area:** `apps/auth-server/src/roles/roles.service.ts`

**Description:**
Identical to bug-0024 but in `RolesService`. All mutating operations (`createRole`,
`updateRole`, `deleteRole`) checked `platform.permissions.manage` without supplying
`targetOrgId`, allowing a caller from any org to mutate roles belonging to another org.

**Fix sketch:** Pass `targetOrgId` in every `checkPermission` call inside `RolesService`.

**Tests that surfaced this:** Wave B `/roles` matrix — cross-org mutation paths returned
2xx instead of 403.

---

### bug-0026 — SaPermission.name uniqueness is global instead of per-app

- **Severity:** 🟡 Warning
- **Wave:** B
- **Commit:** `77fab18`
- **Area:** `apps/auth-server/prisma/schema.prisma` (SaPermission model)

**Description:**
The `SaPermission` model had a unique constraint on `name` alone (globally unique). The
correct cardinality is unique per `(appId, name)` — two different apps should be able to
define a permission named `read` independently. The global uniqueness caused valid
`createPermission` calls from different apps to collide with a Prisma P2002 and return 409.

**Fix sketch:** Replace `@@unique([name])` with `@@unique([appId, name])` in the
`SaPermission` model and generate/run a migration.

**Tests that surfaced this:** Wave B `/permissions` POST matrix — second-app create
attempts returned 409 Conflict instead of 201.

---

### bug-0027 — SaRole.name has no uniqueness constraint at all

- **Severity:** 🟡 Warning
- **Wave:** B
- **Commit:** `dfc8ac7`
- **Area:** `apps/auth-server/prisma/schema.prisma` (SaRole model)

**Description:**
The `SaRole` model had no uniqueness constraint on `name` whatsoever, allowing duplicate
role names within the same app/org. The correct constraint should be
`@@unique([appId, name])`. Without it, the matrix round-trip tests could create two roles
with the same name and then be unable to distinguish them during teardown, producing
phantom failures and data drift.

**Fix sketch:** Add `@@unique([appId, name])` to the `SaRole` model and run a migration.

**Tests that surfaced this:** Wave B `/roles` POST round-trip + idempotency tests.

---

### bug-0028 — Three drawer components use weak `publicId` check for success detection

- **Severity:** 🟡 Warning
- **Wave:** B
- **Commit:** `88f9ec1`
- **Area:** `apps/admin/components/` (create/edit drawers for apps, orgs, roles)

**Description:**
In three server-action drawer components the success guard was written as
`if (res && res.publicId)` to decide whether the server action returned a real entity or
an error object. This is weak: an error response that happens to include a `publicId` field
(e.g., a conflict error that echoes back the conflicting record) would be treated as
success, causing the drawer to close and the table to show stale data rather than surfacing
the error to the user.

**Fix sketch:** Replace the `publicId` truthiness check with a typed `errorKey`
discriminant check: `if (!('errorKey' in res))` — use the presence of the error
discriminant field to detect failure, not the absence of a business field.

**Tests that surfaced this:** Wave B matrix tests that provoke a 409 Conflict on create —
the drawer closed and reported success when it should have shown an error.

---

### bug-0029 — Role name field in admin UI accepts any string; no NAME_REGEX validation

- **Severity:** 🔵 Minor
- **Wave:** B
- **Commit:** `ba66b80`
- **Area:** `apps/admin/components/RoleCreateDrawer.tsx` (and edit equivalent)

**Description:**
The permission-name input enforces `NAME_REGEX` (`^[a-z][a-z0-9]*(\.[a-z][a-z0-9]+)+$`)
before submission. The role-name input had no client-side validation at all, allowing names
that would be rejected by the server `CreateRoleDto`. This caused the server to return 400,
which the drawer converted into a generic error toast rather than an inline field error,
degrading the UX and making Wave B matrix assertions for role create to fail.

**Fix sketch:** Add the same `NAME_REGEX` validation to the role-name `<Input>` in
`RoleCreateDrawer` and `RoleEditDrawer`, with an inline helper text.

**Tests that surfaced this:** Wave B `/roles` POST tests with names that do not match
`NAME_REGEX`.

---

### bug-0030 — Delete buttons use `data-disabled` attribute instead of native `disabled`

- **Severity:** 🔵 Minor
- **Wave:** B
- **Commit:** `a463801`
- **Area:** `apps/admin/components/` (table row delete buttons across all resource tables)

**Description:**
Row-level delete buttons that should be disabled (e.g., the platform-seed row that must not
be deleted) rendered with a Radix UI `data-disabled="true"` attribute but without the
native HTML `disabled` attribute. Keyboard and assistive-technology users could still tab
to and activate these buttons, bypassing the visual affordance. Wave B tests that checked
`toBeDisabled()` failed because Playwright's `isDisabled()` checks the native `disabled`
attribute, not `data-disabled`.

**Fix sketch:** Add `disabled={isProtected}` alongside the existing Radix `data-disabled`
prop so the native attribute is also set.

**Tests that surfaced this:** Wave B matrix immutability tests (`Platform app row exposes no
destructive controls` style).

---

### bug-0031 — Matrix test cleanup queue and session cache are module-scoped; cross-spec pollution

- **Severity:** 🔵 Minor
- **Wave:** B
- **Commit:** `b0ae4d2`
- **Area:** `apps/auth-server/test/matrix/harness.ts`

**Description:**
The API test harness accumulated created resources in a module-level array (cleanup queue)
and cached admin sessions in a module-level map. When Jest runs multiple spec files in the
same worker the queue and cache persisted across spec files, causing resource cleanup from
spec A to run (or fail) inside spec B's `afterAll`, and cached tokens from spec A to be
reused in spec B even if the token had expired or the session context had changed.

**Fix sketch:** Reset both the cleanup queue and the session cache in a `beforeEach` (or
per-spec `beforeAll`) hook so each spec file starts with a clean slate.

**Tests that surfaced this:** Wave B cross-spec ordering — tests occasionally received 401
(stale token) or cleaned up the wrong resources.

---

### bug-0032 — Server actions match errors via `message.includes('409')` string comparison

- **Severity:** 🔵 Minor
- **Wave:** B
- **Commit:** `989f005`
- **Area:** `apps/admin/lib/actions/` (server action files for resource CRUD)

**Description:**
Several Next.js server actions detected conflict errors by testing whether the server's
error message string contained the literal characters `'409'` (e.g.,
`err.message.includes('409')`). This is brittle — any change to the error message format,
internationalisation, or a transient error whose message coincidentally contains `'409'`
would either silently swallow a real conflict or misclassify an unrelated error.

**Fix sketch:** Import and use the typed `ApiError` class. Check `err instanceof ApiError &&
err.statusCode === 409` instead of string matching.

**Tests that surfaced this:** Wave B conflict-detection paths in matrix create tests.

---

## Bugs surfaced by Wave C (not yet fixed)

---

### bug-0033 — Admin nav (authed) test: `s@sa.io stays signed in across /users, refresh, /apps, /orgs` fails for chromium-super

- **Severity:** 🔵 Minor
- **Wave:** C
- **Spec:** `apps/admin-e2e/tests/authed/admin-nav.spec.ts:9`

**Description:**
The authed regression test for cross-page persistence consistently fails for the
`chromium-super` project across 3 attempts (events 7–9 in wave-c-run.log). The test
navigates to `/users`, reloads, navigates to `/apps`, then to `/orgs`, asserting the URL
and heading remain correct at each step. API calls to `/api/users`, `/api/apps`, and
`/api/orgs?page=1&pageSize=25` all returned HTTP 200 in the server log, confirming the
session and data are valid. The failure therefore originates in the heading locator or URL
assertion. The `/apps` or `/orgs` heading locators in the test use a regex anchored on the
i18n key (`t('apps.title')` / `t('orgs.title')`); if the rendered heading text includes a
count badge or different casing that does not match the regex, the assertion times out.
Duration ~7 s per attempt (full timeout).

**Fix sketch:** Inspect the actual heading text rendered on `/apps` and `/orgs` pages. If
the heading renders as "Applications (3 Total)" and `t('apps.title')` returns `"Applications"`,
the regex `^Applications\b` should match — verify the `escapeRe` helper and the i18n key
value. If the heading has been renamed in the UI, update `t('apps.title')` or the locator
pattern.

**Tests needed:**
- `[chromium-super] tests/authed/admin-nav.spec.ts:9 › Admin nav (authed) › s@sa.io stays signed in across /users, refresh, /apps, /orgs`

---

### bug-0034 — chromium-super matrix: all `/apps` UI matrix CRUD tests timeout (~30 s each); API returns 200

- **Severity:** 🟡 Warning
- **Wave:** C
- **Spec:** `apps/admin-e2e/tests/matrix/apps.matrix.spec.ts:31`, `:42`, `:55`

**Description:**
Three mutating tests for the `/apps` page (`Create row appears in table`, `Edit row updates
the name`, `Delete row removes it from the table`) each time out after the full 30 s
timeout across 3 retries when run as `chromium-super` (events 10–21). The server logs
confirm `GET /api/apps?page=1&pageSize=25` returns 200 and the page itself loads (HTTP 200
in ~150 ms). The failure is therefore in the page-object interaction: either the
`createButton` locator (`getByRole('button', { name: t('apps.create') })`), a form field
label (`t('apps.fields.name')`, `t('apps.fields.url')`), the save button
(`t('common.save')`), the success toast (`t('apps.toast.created')`), or the edit/delete
button selectors. If any i18n key has been renamed or the button role has changed in the
UI, the page object will spin waiting for an element that never appears.

The `list renders` test (event 10–12) also fails, suggesting `apps.heading` locator
(`getByRole('heading', { name: /^<AppsTitle>\b/ })`) does not match the rendered element.

**Fix sketch:** Run the test in headed mode and inspect which locator step times out.
Cross-reference all i18n keys used in `AppsPage` (`t('apps.create')`, `t('apps.fields.name')`,
`t('apps.fields.url')`, `t('common.save')`, `t('apps.toast.created')`, `t('common.edit')`,
`t('common.delete')`, `t('common.confirm')`, `t('apps.toast.updated')`,
`t('apps.toast.deleted')`) against the actual UI strings in
`apps/admin/app/(admin)/apps/page.tsx` and the relevant drawer components.

**Tests needed:**
- `[chromium-super] tests/matrix/apps.matrix.spec.ts:11 › /apps UI matrix › list renders for permitted admins, blocks for the rest`
- `[chromium-super] tests/matrix/apps.matrix.spec.ts:31 › /apps UI matrix › Create row appears in table`
- `[chromium-super] tests/matrix/apps.matrix.spec.ts:42 › /apps UI matrix › Edit row updates the name`
- `[chromium-super] tests/matrix/apps.matrix.spec.ts:55 › /apps UI matrix › Delete row removes it from the table`

---

### bug-0035 — chromium-super matrix: all `/orgs`, `/roles`, `/permissions`, `/users` UI matrix CRUD tests timeout (~30 s each)

- **Severity:** 🟡 Warning
- **Wave:** C
- **Spec:** `apps/admin-e2e/tests/matrix/orgs.matrix.spec.ts`, `roles.matrix.spec.ts`, `permissions.matrix.spec.ts`, `users.matrix.spec.ts`

**Description:**
Same symptom as bug-0034 but across all remaining resource pages for the `chromium-super`
project (events 29–85). The pattern is identical: API responses return 200, the page
renders, but page-object interactions time out. Each failing test ran for the full 30 s
before each of 3 retries, except for tests that ran after `orgs.matrix.spec.ts:77` where
subsequent tests in `permissions`, `roles`, and `users` specs immediately complete at 0 ms
— indicating those tests were never started (likely a worker-level crash or timeout cascade
from the orgs delete test).

This is likely the same root cause as bug-0034: i18n key mismatches in the page objects
for `OrgsPage`, `RolesPage`, `PermissionsPage`, and `UsersPage`.

**Fix sketch:** Audit `t(...)` calls in all four page objects
(`apps/admin-e2e/pages/orgs.page.ts`, `roles.page.ts`, `permissions.page.ts`,
`users.page.ts`) against their corresponding UI components. Pay particular attention to
create-button labels, form-field labels, save/confirm button labels, and success toast text.

**Tests needed:**
- `[chromium-super] tests/matrix/orgs.matrix.spec.ts:21` — list renders
- `[chromium-super] tests/matrix/orgs.matrix.spec.ts:41` — Create row appears in table
- `[chromium-super] tests/matrix/orgs.matrix.spec.ts:59` — Edit row updates the name
- `[chromium-super] tests/matrix/orgs.matrix.spec.ts:77` — Delete row removes it from the table
- `[chromium-super] tests/matrix/permissions.matrix.spec.ts:20` — list renders
- `[chromium-super] tests/matrix/permissions.matrix.spec.ts:40` — Create row appears in table
- `[chromium-super] tests/matrix/permissions.matrix.spec.ts:56` — Edit row updates the name
- `[chromium-super] tests/matrix/permissions.matrix.spec.ts:74` — Delete row removes it from the table
- `[chromium-super] tests/matrix/permissions.matrix.spec.ts:90` — Seeded platform.* permission row exposes no destructive controls
- `[chromium-super] tests/matrix/roles.matrix.spec.ts:20` — list renders
- `[chromium-super] tests/matrix/roles.matrix.spec.ts:40` — Create row appears in table
- `[chromium-super] tests/matrix/roles.matrix.spec.ts:56` — Edit row updates the name
- `[chromium-super] tests/matrix/roles.matrix.spec.ts:74` — Delete row removes it from the table
- `[chromium-super] tests/matrix/users.matrix.spec.ts:11` — list renders
- `[chromium-super] tests/matrix/users.matrix.spec.ts:31` — Create user row appears in table (platform org)
- `[chromium-super] tests/matrix/users.matrix.spec.ts:47` — Edit user updates the first name
- `[chromium-super] tests/matrix/users.matrix.spec.ts:64` — Delete user removes the row from the table
- `[chromium-super] tests/matrix/users.matrix.spec.ts:80` — Resend invitation succeeds for a pending user
- `[chromium-super] tests/matrix/users.matrix.spec.ts:96` — Self-row exposes no destructive delete control

---

### bug-0036 — chromium-apps / chromium-orgs / chromium-perms / chromium-users: all matrix tests fail at 0 ms — storage state not loaded

- **Severity:** 🔴 Critical
- **Wave:** C
- **Spec:** All `tests/matrix/*.spec.ts` for projects `chromium-apps`, `chromium-orgs`, `chromium-perms`, `chromium-users`

**Description:**
Every single test from the four resource-scoped admin projects fails immediately at 0 ms
(events 86–433 in wave-c-run.log). The `setup` project ran successfully and authenticated
all 5 admins (events 1–5 confirm `authenticate as a@sa.io` through `authenticate as
s@sa.io` all passed). The storage state files are written to `.auth/apps-admin.json`,
`.auth/orgs-admin.json`, etc. However when the dependent projects (`chromium-apps` etc.)
attempt to run their first test they abort instantly without any page load or network
activity, indicating the browser context was never initialised from the storage state.

Possible causes:
1. The `.auth/` directory is not relative to the `testDir` used by the matrix projects, so
   Playwright cannot resolve the `storageState` path and silently falls back to an
   unauthenticated context that then fails the first assertion.
2. The storage state files were written outside the `apps/admin-e2e/` working directory
   when `CI_TESTS=true` (the setup runs with `cwd` = workspace root, not the e2e app dir).
3. The `dependencies: ['setup']` contract is not honoured when `workers: 1` and the setup
   project completes on the first worker iteration but the dependent projects are scheduled
   on the same worker with a stale context.

The 0 ms duration (no browser launch overhead) strongly favours cause (1) or (2): the
storage state path resolution is wrong.

**Fix sketch:** In `playwright.config.ts`, change the `storageState` paths from relative
strings (`.auth/apps-admin.json`) to absolute paths constructed via `path.join(__dirname,
'.auth/apps-admin.json')` to ensure they resolve correctly regardless of the working
directory. Verify the same fix in `auth-state.setup.ts` where `path.join(__dirname,
admin.storageStatePath)` is already used — confirm the relative base of `storageStatePath`
in `admins.ts` is consistent.

**Tests needed:** All 87 unique (deduplicated) matrix test instances across the four projects:
- `[chromium-apps]` — all tests in `apps.matrix.spec.ts`, `orgs.matrix.spec.ts`,
  `roles.matrix.spec.ts`, `permissions.matrix.spec.ts`, `users.matrix.spec.ts`,
  `nav-gates.spec.ts`
- `[chromium-orgs]` — same set
- `[chromium-perms]` — same set
- `[chromium-users]` — same set

Note: Wave C run was terminated mid-execution at ~95% complete; remaining failures
(chromium-roles project, if present) could not be captured.

---

## Run completeness note

> Wave C run was killed by parent process termination after ~11 minutes (~95% of expected
> events captured). Re-running the suite end-to-end is recommended before treating this
> bug list as exhaustive. The last captured event was event 433 out of an estimated ~456.
> Projects that ran after `chromium-users` (if any — e.g. a `chromium-roles` project) were
> not observed. A clean re-run is needed to confirm the complete failure count.
