# User Access Management — Design Spec

**Date:** 2026-06-01
**Status:** Approved
**Scope:** Backend endpoints + admin UI to edit roles and direct permissions on a user, in both the create-user and edit-user drawers.

---

## 1. Context

The admin user drawers today have two gaps:

1. **Edit drawer** (`apps/admin/components/user-view-drawer.tsx`) — clicking Edit toggles only the basic profile fields (`firstName`, `lastName`, `phoneNumber`, `username`). Assigned roles render as read-only `<Badge>`s and the effective-permissions block is read-only chips. There is no path to add or remove a role from an existing user.
2. **Direct permissions** — the `SaUserPermission` table is real (the seed grants `platform.*.manage` directly to four area admins at `apps/auth-server/src/seed/seed.ts:32-35`), but neither the API nor the admin UI exposes it. Neither drawer can grant a direct permission.

The role-edit-drawer (`apps/admin/components/role-edit-drawer.tsx`) is a strong precedent for the multi-item set-replace pattern this spec adopts — it loads an initial permission set, edits rows via `PermissionRowsEditor`, and on Save sends `PATCH /api/roles/:id { permissionIds }`. The server diffs the set inside a transaction (`roles.service.ts:178-184`).

---

## 2. Architecture

Three independent edit axes on a user, each a single set-replace API call. Existing granular endpoints stay; new UI uses the new PUT endpoints.

| Axis | HTTP | Path | Body | Returns |
|---|---|---|---|---|
| Profile | `PATCH` *(existing)* | `/api/users/:id` | `UpdateUserDto` | `User` |
| Roles | **new** `PUT` | `/api/users/:id/roles` | `{ roleIds: string[] }` | `204` |
| Direct permissions list | **new** `GET` | `/api/users/:id/direct-permissions` | — | `Permission[]` |
| Direct permissions set | **new** `PUT` | `/api/users/:id/direct-permissions` | `{ permissionIds: string[] }` | `204` |

`POST /api/users/:id/roles` and `DELETE /api/users/:id/roles/:roleId` remain — they are still wired through `users.controller.ts:60-70` and used by `createUserAction` indirectly today via `assignRole`. The new PUT shape lives next to them.

### Create flow change

`CreateUserDto` gains two optional fields:

```ts
roleIds?: string[]            // publicIds, scoped to the org's app
directPermissionIds?: string[] // publicIds, scoped to the org's app
```

`UsersService.createUser` writes the SaUser row, invitation row, role assignments, and direct-permission assignments inside the **same** `prisma.$transaction`. No more `createUserAction` two-step (`createUser` then `assignRole`) — that branch dies.

---

## 3. Components

### 3.1 Backend — `apps/auth-server/src/users/`

**`users.service.ts`** gains:

```ts
async setUserRoles(callerBaId, publicId, roleIds: string[]): Promise<void>
async getUserDirectPermissions(callerBaId, publicId): Promise<Permission[]>
async setUserDirectPermissions(callerBaId, publicId, permissionIds: string[]): Promise<void>
```

Each method:
1. Resolves `saUser` by publicId, 404 if missing.
2. Authorizes via `checkPermission(callerBaId, ['platform.users.manage', 'org.users.manage'], { targetOrgId: user.orgId })`.
3. For set-replace methods, validates every supplied publicId belongs to the user's org's app via the same helper pattern as `resolvePermissionIds` in `roles.service.ts:115` (extract that helper or inline a `resolveRoleIds` twin).
4. Inside `$transaction`: `deleteMany` existing junction rows + `createMany` the new ones. Idempotent — re-saving the same set is a no-op write pattern.

**`users.controller.ts`** gains:

```ts
@Put(':id/roles')
@HttpCode(204)
setRoles(@Req, @Param('id'), @Body() dto: SetUserRolesDto)

@Get(':id/direct-permissions')
getDirectPermissions(@Req, @Param('id'))

@Put(':id/direct-permissions')
@HttpCode(204)
setDirectPermissions(@Req, @Param('id'), @Body() dto: SetUserDirectPermissionsDto)
```

**New DTOs** in `apps/auth-server/src/users/dto/`:
- `set-user-roles.dto.ts` — `roleIds: string[]`, `@IsArray() @ArrayUnique() @IsString({ each: true })`
- `set-user-direct-permissions.dto.ts` — `permissionIds: string[]`, same validators
- `create-user.dto.ts` extended with `roleIds?` and `directPermissionIds?`, both optional, same validators.

### 3.2 Admin client — `apps/admin/lib/api.ts`

```ts
setUserRoles(userId: string, roleIds: string[]): Promise<void>
getUserDirectPermissions(userId: string): Promise<Permission[]>
setUserDirectPermissions(userId: string, permissionIds: string[]): Promise<void>
```

`createUser` payload accepts the new optional fields.

### 3.3 Admin actions — `apps/admin/app/(admin)/users/actions.ts`

- `createUserAction` — replace the post-create `assignRole` branch with a single `createUser({ ...input, roleIds, directPermissionIds })` call.
- `setUserRolesAction(userId, roleIds)` — new.
- `getUserDirectPermissionsAction(userId)` — new.
- `setUserDirectPermissionsAction(userId, permissionIds)` — new.
- `getAppPermissionsAction(appId)` — exists for role-create-drawer; reuse.
- `getAppRolesAction(appId)` — new helper (the existing `getRolesAction(appId)` already covers this; reuse).

### 3.4 New small primitive — `RoleRowsEditor`

`apps/admin/components/user-role-rows-editor.tsx`. A near-copy of `role-permission-rows-editor.tsx` with `RoleOption { publicId, name }`:

- Rows of `<select aria-label={t('users.fields.roleRow')}>`.
- Disable already-picked roles in other rows (deduplication).
- "Add role" button appends an empty row.
- X button removes a row.

Could templatize the existing one over `Option`, but a separate small file is clearer than a generic primitive parameterized on label + option-shape.

### 3.5 Edit drawer — `user-view-drawer.tsx`

The current top-level Edit/Save toggle expands to flip the whole drawer into edit mode:

| Section | View mode | Edit mode |
|---|---|---|
| Profile | Static fields | Inputs (today's behavior) |
| Assigned Roles | `<Badge>` chips | `RoleRowsEditor` |
| Direct Permissions | `<chip>` list (new) | `PermissionRowsEditor` |
| Effective Permissions | Read-only chips | Read-only chips, refresh after Save |

Direct Permissions becomes a new view-mode subsection inside the existing Access card (above Effective Permissions). When the drawer opens it fetches both `getUserDirectPermissions` and the existing `getUserRoles` + `getEffectivePermissions` in parallel.

**Save behavior** — single Save button in the header. On click:

```ts
await Promise.all([
  profileDirty ? updateUser(id, profilePatch) : null,
  rolesDirty   ? setUserRoles(id, currentRoleIds) : null,
  permsDirty   ? setUserDirectPermissions(id, currentPermIds) : null,
])
// then re-fetch roles + direct perms + effective perms
```

Cancel reverts all three axes to the snapshot captured on Edit-click.

### 3.6 Create drawer — `user-create-drawer.tsx`

After Org is selected, two new sections appear in the existing **Access** block:

- **Assigned Roles** — `RoleRowsEditor`. Role options load when org changes (the existing `getRolesAction(selectedOrg.appId)` call).
- **Direct Permissions** — `PermissionRowsEditor`. Permission options load when org changes (new `getAppPermissionsAction(selectedOrg.appId)` call — already exists for role-create-drawer).

The current single-role `<Select>` is removed; the row editor subsumes it. Submit calls the extended `createUser` with `roleIds` and `directPermissionIds` arrays.

### 3.7 i18n additions to `apps/admin/messages/{en,fr}.json`

Under `users`:

```json
"fields": {
  "roleRow": "Role",
  "directPermissionRow": "Direct permission",
  ...
},
"drawer": {
  "directPermissions": "Direct Permissions",
  "addRole": "Add role",
  "removeRole": "Remove role",
  "addDirectPermission": "Add direct permission",
  "removeDirectPermission": "Remove direct permission",
  "selectRole": "Select a role",
  "selectDirectPermission": "Select a permission",
  ...
},
"errors": {
  "rolesSetFailed": "Failed to update roles.",
  "directPermissionsSetFailed": "Failed to update direct permissions.",
  ...
}
```

---

## 4. Data flow

### Edit flow

```
[Open drawer]
  → getUserRolesAction(id)         ─┐
  → getEffectivePermissionsAction(id) │ parallel
  → getUserDirectPermissionsAction(id) ┘
  → snapshot initial state for Cancel

[Click Edit]
  → swap to edit-mode UI, populate row editors from initial state
  → for roles: load getAppRolesAction(user.org.appId)
  → for direct perms: load getAppPermissionsAction(user.org.appId)

[Click Save]
  → diff (per axis): dirty?
  → Promise.all([
      updateUserAction(...) if profileDirty,
      setUserRolesAction(id, roleIds) if rolesDirty,
      setUserDirectPermissionsAction(id, permIds) if permsDirty,
    ])
  → on each settled, surface per-axis error inline (alert at top of section)
  → after settled, clear the `dirty` flag on each axis that succeeded
  → re-fetch the three Access lists
  → if all 3 axes succeeded with no errors, exit edit mode;
    otherwise stay in edit mode with the failed axis still dirty so a
    second Save click retries only the failed axis (set-replace is
    idempotent, so retrying a succeeded axis would also be safe).

[Click Cancel]
  → restore each axis from snapshot, exit edit mode
```

### Create flow

```
[Open drawer]
  → snapshot empty form

[Select Org]
  → getRolesAction(org.appId)          ─┐
  → getAppPermissionsAction(org.appId) ─┘ parallel
  → enable row editors

[Click Create]
  → validate locally
  → createUserAction({
      firstName, lastName, email, orgId, username?, phoneNumber?,
      roleIds: [...], directPermissionIds: [...]
    })
  → server: single $transaction creates user + invitation + role rows + direct-perm rows
  → on success, show invite URL panel as today
```

### Server-side set-replace transaction shape (mirrors `roles.service.ts:175-185`)

```ts
await prisma.$transaction(async (tx) => {
  await tx.saUserRole.deleteMany({ where: { userId: user.id } });
  if (roleIds.length > 0) {
    await tx.saUserRole.createMany({
      data: roleIds.map((rid) => ({ userId: user.id, roleId: rid })),
    });
  }
});
```

Same shape for `saUserPermission`.

---

## 5. Authorization

All three new endpoints accept the same permission shape as the existing user endpoints:

```ts
await checkPermission(callerBaId, ['platform.users.manage', 'org.users.manage'], {
  targetOrgId: user.orgId,
});
```

- `platform.users.manage` callers can edit users in any org.
- `org.users.manage` callers can edit users in their own org.

The new `GET /api/users/:id/direct-permissions` uses the **same** gate — viewing direct perms reveals authorization state, so it requires the same authority as setting them. (Effective permissions are already gated identically at `users.controller.ts:55-58`.)

---

## 6. Error handling

### Server

- Unknown user publicId → `404 NotFoundException`.
- Caller lacks permission → `403 ForbiddenException`.
- Any supplied role/permission publicId does not exist or does not belong to the user's org's app → `400 BadRequestException` with the offending id list, mirroring `resolvePermissionIds` behavior.
- DB transaction failure → `500`, no partial mutation (single transaction per axis).

### UI

- Each Save axis fails independently. The drawer surfaces a per-section `<p role="alert">` inline (not a global toast), reuses the existing `users.errors.*` i18n style.
- Save button stays disabled while any of the 3 requests is in flight to avoid double-submits.
- Partial failure leaves the other axes already persisted. The drawer re-fetches on next open, so the user sees consistent state. The failed axis keeps its pending edits in the form so the admin can retry without re-typing.
- A user cannot self-edit their own roles or direct permissions — `DELETE` already enforces this via `users.service.ts:256-258`, and `setUserRoles`/`setUserDirectPermissions` add the same `existing.betterAuthUserId === callerBaId → ForbiddenException` guard.

---

## 7. Scope of role and permission options

Both pickers scope to the **user's org's app**, mirroring `role-create-drawer.tsx:44-46`. The platform admin role-grant pattern (e.g., seeding `platform.users.manage` directly to `u@sa.io` in the platform org) still works because platform.* permissions belong to the platform app, and `u@sa.io`'s org IS the platform org.

If a user later needs permissions from a different app, they must be moved between orgs — same limitation as today's role-create-drawer. Out of scope for this spec.

---

## 8. Tests

### Backend unit

`apps/auth-server/src/users/users.service.spec.ts` — new describe blocks:

- `setUserRoles` — happy path, set [] (clear all), idempotent re-set (same input → same final rows), invalid role publicId → 400, role belongs to wrong app → 400, caller-is-self → 403.
- `setUserDirectPermissions` — same matrix.
- `getUserDirectPermissions` — returns the saUserPermission rows mapped to `Permission` shape.
- `createUser` — extended cases for `roleIds` and `directPermissionIds`, including invalid ids rolling back the whole transaction (no orphan saUser).

`apps/auth-server/src/users/users.controller.spec.ts` — forwarding tests for the three new methods.

### Backend e2e

`apps/auth-server/test/app.e2e-spec.ts` — extend the existing Lifecycle describe (`Lifecycle: provision app+perm+org+role+user, accept invite, sign in`) with two new tests at the end:

1. **`adds a second role + a direct permission via the set-replace endpoints`** — `PUT /api/users/:id/roles { roleIds: [existing, newRole] }` and `PUT /api/users/:id/direct-permissions { permissionIds: [directPerm] }`. Asserts `204`.
2. **`the newly-signed-in user sees the union in /api/me/permissions`** — user signs in again, the effective permission list now contains the original role's perm + the new role's perm + the new direct perm.

### Admin component unit

`apps/admin/components/__tests__/user-view-drawer.test.tsx` — extend with:
- Edit mode renders both row editors when access section is expanded.
- Save fires all three actions in parallel only when their axes are dirty.
- Per-axis error renders inline.
- Cancel restores all three axes to snapshot.

`apps/admin/components/__tests__/user-create-drawer.test.tsx` — add:
- Selecting an org populates both role and direct-permission options.
- Submit posts roleIds + directPermissionIds.

### Playwright

`apps/admin-e2e/tests/authed/lifecycle.spec.ts` — extend the existing end-to-end spec. After the final sign-in assertion:

1. Re-sign-in as super admin (or use a fresh context with that storage state).
2. Open the edit drawer for the lifecycle user.
3. Click Edit, add a second role row, add a direct permission row, click Save.
4. Re-open the drawer, assert both new badges are visible.

---

## 9. Out of scope

- Reset Password button on the edit drawer (already a TODO in the codebase, separate concern).
- Cross-app permission picker (granting perms from app X to a user in app Y's org). Locked to org-app scope per §7.
- Role search/filter inside the row editor — list is short enough at current scale.
- Audit log entries beyond the existing `logger.info('User updated', ...)` breadcrumbs.
- Surfacing direct permissions on the users list table (still effective-permission-only).
