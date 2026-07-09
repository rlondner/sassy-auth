# Org-Scoped Multi-Tenant Administration — Design

**Date:** 2026-06-18
**Status:** Approved (pending implementation plan)
**Slice:** 2 — minimum-viable multi-tenant admin + dead-code cleanup

## Goal

Let an "org admin" — a SassyAuth user holding only `org.*` permissions — log in to the existing SassyAuth admin UI and self-serve user management for their own organization, without granting any path to escalate to platform-tier authority. The motivating user story:

> A customer organization owns its user list. One of their employees is designated as the org admin. That person logs into SassyAuth and can invite, edit, and manage roles for users in their own org, including promoting a peer to be another org admin of the same org. They can never see, edit, or affect users in any other org, and they can never grant any `platform.*` permission to anyone.

## Non-goals

- Org-scoped role inventory (roles stay app-scoped — see Decision Q1).
- A separate "tenant admin" UI surface (the existing `apps/admin` adapts via a permission-driven sidebar — see Decision Q5).
- Hard-delete of users by org admins (`users.delete` stays platform-only — `status: inactive` covers the common tenant need).
- Cross-app role assignment (a role lives in exactly one app; only the perms *inside* roles can cross apps, and only when system-tagged).

## Decisions log

| # | Question | Choice |
|---|---|---|
| Q1 | What does "manage roles" mean for an org admin? | **Assignment-only**: org admins assign existing roles to users; they don't CRUD role definitions. |
| Q2 | Where's the line between `org.users.manage` and `org.roles.manage`? | **`org.users.manage` keeps full user CRUD + role/direct-perm assignment.** `org.roles.manage` is read-only — view the role catalog scoped to the caller's app. |
| Q3 | How is cross-app perm assignment modeled? | **`SaPermission.isSystem` boolean.** Resolver allows a perm through when `target.appId === perm.appId` OR `perm.isSystem === true`. |
| Q4 | New `platform.roles.manage` — net new perm, rename, or split? | **Split** `platform.permissions.manage` into `platform.roles.manage` (role CRUD) and `platform.permissions.manage` (permission CRUD only). |
| Q5 | Sidebar adaptation for non-platform users? | **Permission-driven sidebar** — fetch `/me/permissions` in the layout, hide nav items the user can't use. |
| Slice | Scope of this change? | **Slice 2** — the schema/seed/resolver/UI changes, plus formal removal of the obsolete `org.permissions.manage`. No Orgs-tab read for org admins. |
| Delete | `users.delete` for org admins? | **No.** Stays `platform.users.manage`-only. |
| Seed split | What happens to the `p@sa.io` admin after the platform.permissions.manage split? | **Add a new `r@sa.io` admin** holding `platform.roles.manage` only; `p@sa.io` keeps `platform.permissions.manage` only. Matrix invariant preserved (each seeded admin holds exactly one perm). |
| Immutability | Should the rename/delete protection extend beyond `platform.*`? | **Yes.** Extend the existing prefix check to `isPlatform(name) OR isSystem` so `org.*` rows can't be renamed or deleted either (pre-existing footgun, closed here). |
| Escalation guard | Can an org admin grant a system perm they themselves don't hold? | **No.** A non-platform caller can grant `isSystem` perm `X` only if they hold `X` themselves. Platform-tier callers (`platform.users.manage`) bypass. |

## Section 1 — Data model

One column added to `SaPermission`:

```prisma
model SaPermission {
  id       Int                @id @default(autoincrement())
  publicId String             @unique
  name     String             @unique
  appId    Int
  isSystem Boolean            @default(false)   // NEW
  app      SaApp              @relation(fields: [appId], references: [id])
  roles    SaRolePermission[]
  users    SaUserPermission[]

  @@index([appId])
}
```

`isSystem` is the single switch that says "this permission can live inside a role or be granted directly to a user regardless of what app the host role/user belongs to". System perms still have an `appId` (the platform app's id, same as today) — the resolver just stops treating that `appId` as a wall.

Only `org.*` perms are flagged `isSystem = true`. `platform.*` perms stay `isSystem = false`, which keeps them strictly app-scoped to the platform app and therefore unreachable by an org admin in a customer app. This closes the escalation hole that an "all system perms cross-app" formulation would open.

Nothing else in the schema changes. `SaRole` stays app-scoped. `SaOrg`/`SaUser`/`SaUserRole`/`SaUserPermission` are untouched.

## Section 2 — Permission catalog & seed

The catalog at the end of this work:

| Name | App | `isSystem` | Notes |
|---|---|---|---|
| `platform.apps.manage` | platform | `false` | unchanged |
| `platform.orgs.manage` | platform | `false` | unchanged |
| `platform.users.manage` | platform | `false` | unchanged |
| `platform.roles.manage` | platform | `false` | **NEW** — gates `roles.*` writes |
| `platform.permissions.manage` | platform | `false` | scope shrinks to `permissions.*` writes only |
| `org.users.manage` | platform | `true` | **flipped to system** — gates user CRUD + role/direct-perm assignment in caller's own org |
| `org.roles.manage` | platform | `true` | **NEW** — read-only role catalog scoped to caller's org's app |
| `org.permissions.manage` | — | — | **REMOVED** from seed list, role wiring, matrix; data migration deletes the row + re-points its references to `org.roles.manage` |

`PLATFORM_PERMISSIONS` in `apps/auth-server/src/seed/seed.ts`:

```ts
const PLATFORM_PERMISSIONS = [
  'platform.orgs.manage',
  'platform.apps.manage',
  'platform.users.manage',
  'platform.roles.manage',         // NEW
  'platform.permissions.manage',
  'org.users.manage',              // isSystem: true
  'org.roles.manage',              // NEW, isSystem: true
] as const;
```

The seed's perm-ensure step is extended to set `isSystem` to `name.startsWith('org.')` after the row is created or found. Idempotent across re-runs against an already-migrated DB.

`ensurePlatformSuperAdminRole` already wires the Super Admin role to "every `platform.*` perm in the platform app" via `name: { startsWith: 'platform.' }`. That auto-picks up `platform.roles.manage` — `s@sa.io` keeps super-admin parity for free.

A new seeded admin is added so the matrix's "one perm per seed admin" invariant holds:

```ts
{ key: 'roles', email: 'r@sa.io', firstName: 'Roles', lastName: 'Admin',
  grant: { kind: 'direct', permission: 'platform.roles.manage' } }
```

`p@sa.io` stays as it is, now scoped to permission CRUD only.

## Section 3 — Permission gate matrix

The `GATE` table at `apps/auth-server/test/matrix/permissions-matrix.ts:45` shifts as follows. Only the rows that move are shown; everything else stays exactly as today.

```ts
roles: {
  list:   ['platform.roles.manage', 'org.roles.manage'],   // was: platform.permissions.manage, org.permissions.manage
  get:    ['platform.roles.manage', 'org.roles.manage'],   // was: same
  create: ['platform.roles.manage'],                       // was: platform.permissions.manage
  update: ['platform.roles.manage'],                       // was: platform.permissions.manage
  delete: ['platform.roles.manage'],                       // was: platform.permissions.manage
},
// permissions, users, orgs, apps gates: unchanged
```

`SEED_ADMINS` gets one new entry and `super`'s permission list rotates:

```ts
{ key: 'apps',  email: 'a@sa.io', perms: ['platform.apps.manage'] },
{ key: 'orgs',  email: 'o@sa.io', perms: ['platform.orgs.manage'] },
{ key: 'users', email: 'u@sa.io', perms: ['platform.users.manage'] },
{ key: 'roles', email: 'r@sa.io', perms: ['platform.roles.manage'] },   // NEW
{ key: 'perms', email: 'p@sa.io', perms: ['platform.permissions.manage'] },
{
  key: 'super',
  email: 's@sa.io',
  perms: [
    'platform.apps.manage',
    'platform.orgs.manage',
    'platform.users.manage',
    'platform.roles.manage',         // NEW
    'platform.permissions.manage',
    'org.users.manage',
    'org.roles.manage',              // NEW
    // org.permissions.manage REMOVED
  ],
},
```

Two service-side scoping behaviors fall out:

**(a) `roles.list` filtered by caller's org's app when only `org.roles.manage` is held.** Mirrors the `targetOrgId: -1` sentinel pattern that `users.service.ts` already uses for cross-tenant guards:

```ts
async listRoles(callerBaId: string, q: ListRolesQueryDto = {}) {
  const caller = await prisma.saUser.findUnique({
    where: { betterAuthUserId: callerBaId },
    select: { org: { select: { appId: true } } },
  });
  if (!caller) throw new ForbiddenException();

  let targetAppId: number;
  if (q.appId) {
    const app = await prisma.saApp.findUnique({ where: { publicId: q.appId } });
    if (!app) throw new NotFoundException('App not found');
    targetAppId = app.id;
  } else {
    targetAppId = -1; // force cross-app to require platform.roles.manage
  }

  await checkPermissionForApp(
    callerBaId,
    ['platform.roles.manage', 'org.roles.manage'],
    { targetAppId, callerAppId: caller.org.appId },
  );
  // ...rest unchanged, with where.appId filter when q.appId is set
}
```

`roles.get` does the same — load the role, derive `targetAppId = role.appId`, then check.

**(b) `roles.create/update/delete` switch from `platform.permissions.manage` to `platform.roles.manage`.** One-line change at each call site in `apps/auth-server/src/roles/roles.service.ts:97, 139, 186`.

`users.*` matrix gates do **not** change — `org.users.manage` continues to alternate with `platform.users.manage` on the assignment routes. The behavioral change inside those routes is twofold: (1) `resolveRoleIdsForApp` / `resolvePermissionIdsForApp` now permit `isSystem` perms cross-app, which is where the "org admin promotes a peer" capability lands; and (2) the assignment paths (`setUserRoles`, `setUserDirectPermissions`, `assignRole`, `createUser`) gain the `assertCallerCanGrantSystemPerms` guard detailed in Section 8 — the escalation ceiling within the `org.*` tier.

## Section 4 — Resolver / check-permission behavior

Three small functions change.

**(a) `resolvePermissionIdsForApp`** at `apps/auth-server/src/common/permissions/resolve-app-scoped-ids.ts:4`:

```ts
export async function resolvePermissionIdsForApp(
  appId: number,
  permissionPublicIds: string[],
): Promise<number[]> {
  if (permissionPublicIds.length === 0) return [];
  const perms = await prisma.saPermission.findMany({
    where: { publicId: { in: permissionPublicIds } },
    select: { id: true, publicId: true, appId: true, isSystem: true },   // + isSystem
  });
  if (perms.length !== permissionPublicIds.length) {
    const found = new Set(perms.map((p) => p.publicId));
    const missing = permissionPublicIds.filter((id) => !found.has(id));
    throw new NotFoundException(`Permission(s) not found: ${missing.join(', ')}`);
  }
  // System perms (org.*) bypass the app-scope check; everything else
  // must match the target app exactly.
  const wrongApp = perms.filter((p) => !p.isSystem && p.appId !== appId);
  if (wrongApp.length > 0) {
    throw new BadRequestException(
      `Permission(s) belong to a different app: ${wrongApp.map((p) => p.publicId).join(', ')}`,
    );
  }
  return perms.map((p) => p.id);
}
```

`resolveRoleIdsForApp` is **unchanged**. Roles remain strictly app-scoped — the only thing system perms unlock is what can live inside a role on that app.

**(b) New `checkPermissionForApp`** in the same `common/permissions/` directory — sibling of `checkPermission`, scoped against `appId` instead of `orgId`. Used by `roles.list` / `roles.get`. Same shape as the existing helper:

```ts
export async function checkPermissionForApp(
  betterAuthUserId: string,
  required: string | string[],
  options: { targetAppId?: number; callerAppId?: number } = {},
): Promise<void> {
  const saUser = await prisma.saUser.findUnique({
    where: { betterAuthUserId },
    include: {
      roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
      directPermissions: { include: { permission: true } },
    },
  });
  if (!saUser) throw new ForbiddenException();

  const perms = new Set<string>();
  saUser.roles.forEach((ur) =>
    ur.role.permissions.forEach((rp) => perms.add(rp.permission.name)),
  );
  saUser.directPermissions.forEach((up) => perms.add(up.permission.name));

  const requiredList = Array.isArray(required) ? required : [required];

  // platform.* bypasses the app-scope check
  for (const r of requiredList) {
    if (r.startsWith('platform.') && perms.has(r)) return;
  }
  // org.* allowed only when target app matches caller's app
  for (const r of requiredList) {
    if (r.startsWith('platform.')) continue;
    if (!perms.has(r)) continue;
    if (options.targetAppId === undefined) return;
    if (options.callerAppId === options.targetAppId) return;
  }
  throw new ForbiddenException();
}
```

`checkPermission` (the org-scoped one) is **unchanged**.

**(c) `permissions.service.ts` immutability** — `updatePermission` (line 156) and `deletePermission` (line 184):

```ts
if (isPlatform(existing.name) || existing.isSystem) {
  throw new ForbiddenException('Platform-system permissions cannot be modified');
}
```

Error message string is preserved so existing tests/clients don't break.

**Behavior summary:**

| Caller | Action | Result |
|---|---|---|
| Org admin (customer app) | direct-grant `org.users.manage` to peer in own org | **allowed** (isSystem bypass) |
| Org admin (customer app) | direct-grant `platform.users.manage` to peer | **rejected** (BadRequest, cross-app) |
| Platform admin (`platform.roles.manage`) | create role in customer app containing `org.users.manage` | **allowed** |
| Platform admin (`platform.roles.manage`) | create role in customer app containing `platform.users.manage` | **rejected** (cross-app, non-system) |
| Anyone | rename or delete `org.users.manage` | **Forbidden** (newly closed via `isSystem`) |
| Anyone | rename or delete `platform.users.manage` | **Forbidden** (unchanged) |
| Platform admin (`platform.permissions.manage`) | rename or delete `rs.inspections.read` | **allowed** (unchanged) |

## Section 5 — Admin UI

The UI needs identity context it doesn't currently expose — specifically the caller's own org's `publicId` and that org's app's `publicId`, so list pages can default their filter to "my own scope" when the caller is org-tier only.

**(a) Extend `/me` with a profile payload.** Same controller (`apps/auth-server/src/me/me.controller.ts`):

```ts
@Get()
profile(@Req() req: Request) {
  return this.me.getMyProfile(callerBaId(req));
}
```

```ts
// me.service.ts
async getMyProfile(callerBaId: string) {
  const user = await prisma.saUser.findUnique({
    where: { betterAuthUserId: callerBaId },
    include: { org: { include: { app: true } } },
  });
  if (!user) throw new ForbiddenException();
  return {
    userId: user.publicId,
    org:    { id: user.org.publicId, name: user.org.name, isPlatform: user.org.isPlatform },
    app:    { id: user.org.app.publicId, name: user.org.app.name, isPlatform: user.org.app.isPlatform },
  };
}
```

The admin layout (`apps/admin/app/(admin)/layout.tsx`) fetches `/me` and `/me/permissions` once per request and threads `{ perms, org, app }` down through the shell.

**(b) Permission-driven sidebar** in `apps/admin/components/admin-shell.tsx`. The static `groups` array becomes a filter pass:

```ts
const NAV: { item: NavItem; group: 'directory' | 'accessControl'; requires: string[] }[] = [
  { group: 'directory', item: { href:'/apps',  ... }, requires: ['platform.apps.manage'] },
  { group: 'directory', item: { href:'/orgs',  ... }, requires: ['platform.orgs.manage'] },
  { group: 'directory', item: { href:'/users', ... }, requires: ['platform.users.manage','org.users.manage'] },
  { group: 'accessControl', item: { href:'/roles',       ... }, requires: ['platform.roles.manage','org.roles.manage'] },
  { group: 'accessControl', item: { href:'/permissions', ... }, requires: ['platform.permissions.manage'] },
];
const visible = NAV.filter(n => n.requires.some(p => perms.includes(p)));
```

Group headers hide when their group has no visible items.

**(c) Users page filter default** (`apps/admin/app/(admin)/users/page.tsx`). If no `orgId` URL param AND the caller doesn't hold `platform.users.manage`, default `orgId` to `profile.org.id` before calling `getUsers`. The org picker in `users-table.tsx` is locked/hidden for non-platform callers.

**(d) Roles page filter default** (`apps/admin/app/(admin)/roles/page.tsx`). `canManage` becomes:

```ts
const canManage = perms.includes('platform.roles.manage') || perms.includes('org.roles.manage');
```

If no `platform.roles.manage` AND `org.roles.manage` is held, default `appId` to `profile.app.id` when calling `getRoles`. App picker locks/hides similarly.

**(e) Roles page write affordances.** `RolesTable` receives a `canWrite` prop driven by `perms.includes('platform.roles.manage')`. Edit/Delete affordances hide when false. The `org.roles.manage`-only caller sees a read-only catalog.

**(f) Permissions UI immutability** (`apps/admin/components/permissions-table.tsx:61, 119` and `permission-view-drawer.tsx:28`). The API list payload starts returning `isSystem` (single field added to `PERMISSION_INCLUDE` in `permissions.service.ts`). UI condition:

```ts
const isImmutable = p.name.startsWith('platform.') || p.isSystem;
```

Two badges, **mutually exclusive** per row:

- `Platform` for rows where `name.startsWith('platform.')`.
- `System` for rows where `isSystem === true` AND the row does not already qualify for the `Platform` badge.

In the current catalog this means `platform.*` rows show `Platform` only, `org.*` rows show `System` only, and custom app perms show no badge. The two classes are kept visually distinct because they mean different things: `Platform` rows are owned by SassyAuth itself, `System` rows are cross-app-assignable primitives. The rule is one-badge-per-row so `org.users.manage` doesn't double-stamp.

## Section 6 — Migration & cleanup

Three migrations land, in order.

**Migration 1 — `add_is_system_to_permissions` (schema):**

```sql
ALTER TABLE "SaPermission" ADD COLUMN "isSystem" BOOLEAN NOT NULL DEFAULT false;
```

No backfill in the migration itself — the seed step below handles known rows; custom tenant perms stay `false` (correct).

**Migration 2 — `seed_role_perms_and_drop_org_permissions_manage` (data):**

```sql
-- 1. Mark org.* as system.
UPDATE "SaPermission" SET "isSystem" = true WHERE "name" LIKE 'org.%';

-- 2. Insert the two new platform perms if not already present. publicId
--    starts as a placeholder string; a follow-up TS step in the same
--    migration replaces it with a real sqid-encoded value (same shape
--    as ensurePlatformSuperAdminRole uses today).
INSERT INTO "SaPermission" ("publicId", "name", "appId", "isSystem")
SELECT 'placeholder-roles', 'platform.roles.manage', a.id, false
FROM   "SaApp" a
WHERE  a."isPlatform" = true
  AND  NOT EXISTS (SELECT 1 FROM "SaPermission" WHERE "name" = 'platform.roles.manage');

INSERT INTO "SaPermission" ("publicId", "name", "appId", "isSystem")
SELECT 'placeholder-orgroles', 'org.roles.manage', a.id, true
FROM   "SaApp" a
WHERE  a."isPlatform" = true
  AND  NOT EXISTS (SELECT 1 FROM "SaPermission" WHERE "name" = 'org.roles.manage');

-- 3. Re-point any role/direct-grant of org.permissions.manage → org.roles.manage
--    (the closest semantic successor — that perm only gated catalog reads).
INSERT INTO "SaRolePermission" ("roleId", "permissionId")
SELECT rp."roleId", new_perm.id
FROM   "SaRolePermission" rp
JOIN   "SaPermission" old_perm ON old_perm.id = rp."permissionId" AND old_perm.name = 'org.permissions.manage'
JOIN   "SaPermission" new_perm ON new_perm.name = 'org.roles.manage'
ON CONFLICT DO NOTHING;

INSERT INTO "SaUserPermission" ("userId", "permissionId")
SELECT up."userId", new_perm.id
FROM   "SaUserPermission" up
JOIN   "SaPermission" old_perm ON old_perm.id = up."permissionId" AND old_perm.name = 'org.permissions.manage'
JOIN   "SaPermission" new_perm ON new_perm.name = 'org.roles.manage'
ON CONFLICT DO NOTHING;

-- 4. Delete org.permissions.manage. ON DELETE CASCADE on the join tables
--    cleans up any leftover rows we already mirrored above.
DELETE FROM "SaPermission" WHERE "name" = 'org.permissions.manage';

-- 5. Grant platform.roles.manage to the Platform Super Admin role.
INSERT INTO "SaRolePermission" ("roleId", "permissionId")
SELECT r.id, p.id
FROM   "SaRole" r
JOIN   "SaApp"  a ON a.id = r."appId" AND a."isPlatform" = true
JOIN   "SaPermission" p ON p.name = 'platform.roles.manage'
WHERE  r.name = 'Platform Super Admin'
ON CONFLICT DO NOTHING;
```

A TS follow-up step in the same migration replaces the two `'placeholder-*'` strings with real sqids — same `tx.saPermission.update`-after-read-back pattern the seed uses.

**Re-point rationale:** anyone holding `org.permissions.manage` today was using it to read the role catalog (the only thing it gated). `org.roles.manage` does exactly that, scoped. Re-pointing preserves intent. Orphan-and-revoke would silently break any tenant who'd granted the old perm.

**Rollback story.** If anything goes wrong post-deploy, rollback isn't via `prisma migrate resolve` — it's a forward fix: re-insert `org.permissions.manage` with a new migration that mirrors `org.roles.manage` assignments back. Down-migrations aren't auto-generated for Migration 2 — Prisma doesn't run downs in prod, and a half-applied inverse is worse than a forward patch.

**Seed code updates (no migration, just code edits):**

- `apps/auth-server/src/seed/seed.ts:11` — `PLATFORM_PERMISSIONS` rotates per Section 2. After ensure-creating each perm, set `isSystem` based on `name.startsWith('org.')`. Idempotent on re-seed.
- `apps/auth-server/src/seed/seed.ts:32` — add `r@sa.io` admin.
- `apps/auth-server/test/matrix/permissions-matrix.ts:18` — `SEED_ADMINS` and `super`'s `perms` rotate per Section 3. `GATE` table rotates per Section 3.

**Cleanup sweep — code references to `org.permissions.manage`:**

```
apps/auth-server/src/roles/roles.service.ts:37, 79     → platform.roles.manage / org.roles.manage
apps/auth-server/src/roles/roles.service.ts:97,139,186 → platform.roles.manage
apps/admin/app/(admin)/roles/page.tsx:12               → new pair
docs/superpowers/specs/* (older)                       → out of scope; historical record
```

## Section 7 — Testing strategy

**(a) Matrix updates carry the bulk of route-level assertions.** `GATE` rotates per Section 3; `SEED_ADMINS` adds `r@sa.io` and rotates `super`. Every matrix-driven spec (`orgs`, `roles`, `permissions`, `users`, `me`) auto-re-derives its expected 2xx/403 set from `isPermitted` / `permittedAdmins`.

**(b) New unit tests:**

- `resolve-app-scoped-ids.spec.ts` — three new cases: `isSystem` perm passes cross-app, non-system perm still rejects cross-app, mixed list rejects on the non-system mismatch. One negative case on `resolveRoleIdsForApp` to lock the "roles stay app-scoped" guarantee.
- `check-permission-for-app.spec.ts` (new) — mirrors `check-permission.spec.ts` shape: `platform.*` bypasses app scope, `org.*` allowed only when `callerAppId === targetAppId`, missing both → Forbidden.

**(c) Escalation-guard tests** (the load-bearing ones — they fail if anyone re-opens the hole):

```ts
// users.service.spec.ts
it('allows org.users.manage holder to grant org.users.manage to a peer in own org', /*...*/);
it('rejects org.users.manage holder granting platform.users.manage', /*...*/);
it('rejects org.users.manage holder granting org.roles.manage (Section 8 guard)', /*...*/);

// roles.service.spec.ts
it('allows platform.roles.manage holder to put org.users.manage into a customer-app role', /*...*/);
it('rejects platform.roles.manage holder putting platform.users.manage into a customer-app role', /*...*/);
```

**(d) Immutability extension** (`permissions.service.spec.ts`):

```ts
it('rejects updating an isSystem permission (Forbidden)', /*...*/);
it('rejects deleting an isSystem permission (Forbidden)', /*...*/);
```

**(e) Migration test** at `apps/auth-server/test/migrations/2026-06-18-org-roles-manage.spec.ts`. Seeds a fixture with one role + one user holding `org.permissions.manage`, runs the migration's data step, asserts: old perm gone, `org.roles.manage` exists with `isSystem=true`, role and user re-pointed, `platform.roles.manage` exists with `isSystem=false`.

**(f) Admin UI tests:**

- `admin-shell.test.tsx` (new): platform super sees all 5 nav items; `org.users.manage`+`org.roles.manage` holder sees only Users + Roles; `org.users.manage`-only holder sees only Users (Access Control group collapses).
- `roles-table.test.tsx`: Edit/Delete hidden when `canWrite={false}`.
- `permissions-table.test.tsx:54, 61`: new `System` badge on `isSystem=true` rows; hide-Edit/Delete on those rows. Existing `Platform` cases stay.

**(g) E2E scenario in `apps/admin-e2e`** — proves the full multi-tenant promotion path:

1. Platform admin creates a customer org and a role in that customer app containing `org.users.manage` + `org.roles.manage`.
2. Platform admin creates a user in the customer org and assigns the role.
3. User logs in, lands on `/users` auto-filtered to their org.
4. User invites a peer, then promotes the peer (via setUserRoles) to the same admin role. Assert 200.
5. User attempts to grant `platform.users.manage` directly. Assert 400.

**(h) Matrix orphan check.** After the rotation, the suite confirms every (area, op) pair has at least one permitted admin among `SEED_ADMINS`. Catches "we forgot to grant `r@sa.io` write access to the roles routes"-class mistakes.

## Section 8 — Escalation guard refinement + demo seed verification

**The guard.** A non-platform caller can grant a system perm `X` only if they hold `X` themselves. Platform-tier callers (holders of `platform.users.manage`) bypass.

New helper `assertCallerCanGrantSystemPerms` in `apps/auth-server/src/common/permissions/`:

```ts
export async function assertCallerCanGrantSystemPerms(
  callerBaId: string,
  systemPermNames: readonly string[],
): Promise<void> {
  if (systemPermNames.length === 0) return;
  const callerPerms = await loadPermNames(callerBaId);
  if (callerPerms.has('platform.users.manage')) return;   // platform-tier bypass
  const cannotGrant = systemPermNames.filter((n) => !callerPerms.has(n));
  if (cannotGrant.length > 0) {
    throw new ForbiddenException(
      `Cannot grant system permission(s) you do not hold: ${cannotGrant.join(', ')}`,
    );
  }
}
```

**Call sites:**

| Method | Location | What the guard checks |
|---|---|---|
| `setUserDirectPermissions` | `users.service.ts:412` | `isSystem` perms in the direct-perms list |
| `setUserRoles` | `users.service.ts:345` | `isSystem` perms inside each role being assigned (loaded + deduped) |
| `assignRole` | `users.service.ts:291` | `isSystem` perms inside the single role |
| `createUser` | `users.service.ts:147` | both, for initial `roleIds` + `directPermissionIds` |

Revocations (`removeRole`, direct-perm removals) don't need the guard. Role CRUD (`createRole`/`updateRole`) doesn't need it either — that surface is already `platform.roles.manage`-only.

**Updated escalation table:**

| Caller | Action | Result |
|---|---|---|
| Org admin with `org.users.manage` only | grant `org.users.manage` to peer | **allowed** |
| Org admin with `org.users.manage` only | grant `org.roles.manage` to peer | **rejected (Forbidden)** |
| Org admin with `org.users.manage` only | assign role containing `org.roles.manage` to peer | **rejected (Forbidden)** |
| Org admin with both `org.*.manage` perms | grant either to peer | **allowed** |
| Platform admin (`platform.users.manage`) | grant any `org.*` to any user | **allowed** (platform-tier bypass) |

### Demo seed scenario

A new file `apps/auth-server/src/seed/demo-multitenant.ts` (alongside `demo-resource-server.ts`), gated by `SEED_DEMO_MULTITENANT=1`. Idempotent across re-runs.

```
App: app01

Permissions (in app01, isSystem=false):
  contracts.read
  contracts.create

Orgs (in app01):
  Acme
  Globex

Users (password: Pass@word1234 for all):
  Acme:
    acme-admin@app01.io   → direct perm: org.users.manage
    acme-alice@app01.io   → (no perms)
    acme-bob@app01.io     → (no perms)

  Globex:
    globex-admin@app01.io → direct perm: org.users.manage
    globex-gina@app01.io  → (no perms)
    globex-greg@app01.io  → (no perms)
```

Both org admins get **only** `org.users.manage` directly — deliberately not `org.roles.manage` — so the escalation guard is exercised.

### Verification specs

Two new spec files, run against the real Postgres + seed (same pattern the matrix tests use):

**`apps/auth-server/test/scenarios/multitenant-visibility.spec.ts`** — org-isolation half:

1. Sign in as `acme-admin@app01.io`. `GET /api/users?orgId=<acme>` → 3 Acme users.
2. `GET /api/users?orgId=<globex>` → **403**.
3. `GET /api/users` (no orgId) → **403** (existing `-1` sentinel).
4. Mirror for `globex-admin@app01.io`, inverse.

**`apps/auth-server/test/scenarios/multitenant-grant-ceiling.spec.ts`** — grant-ceiling half:

1. Sign in as `acme-admin@app01.io`.
2. Grant `contracts.read` to `acme-alice` → **200** (app perm, in-app).
3. Grant `contracts.create` to `acme-bob` → **200**.
4. Grant `org.users.manage` to `acme-alice` (caller holds it) → **200**.
5. Grant `org.roles.manage` to `acme-bob` (caller does **not** hold it) → **403**, message contains `org.roles.manage`.
6. Attempt to grant `platform.users.manage` → **400**, "different app".
7. Attempt to grant `contracts.read` to `globex-gina` (cross-org) → **403**.

If both specs pass on every CI run, the multi-tenant story holds end-to-end and any regression that loosens the guard fails loudly.

The demo admins are **not** added to `SEED_ADMINS` — the matrix is the contract for the platform admin surface, and mixing in tenant-org admins would conflate two concerns. The scenario specs above stand on their own.

## Out of scope (explicit non-features)

- Org-scoped role inventory (Q1 picked assignment-only).
- A separate "tenant admin" route group or UI shell (Q5 picked permission-driven sidebar in the existing shell).
- `users.delete` for org admins.
- Orgs-tab read access for org admins (Slice 2 picked over Slice 3).
- Audit log surface or per-action history (deferrable; the existing structured logs in services capture the events).
- A self-service password / email verification flow specifically for tenant org admins beyond what already exists.

## Open questions deferred to implementation plan

- Exact `publicId` placeholder strategy in Migration 2 — current sketch uses placeholder strings then updates; the implementation may prefer to run a small TS data migration after the SQL one. Functional behavior is unchanged either way.
