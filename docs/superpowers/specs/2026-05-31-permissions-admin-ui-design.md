# Permissions Admin UI — Design

**Date:** 2026-05-31
**Scope:** `apps/auth-server` (new permissions module) + `apps/admin` (new /permissions page + drawers + i18n)
**Design references:** `designs/main-design/variant.html` (light), `designs/main-design/variant-dark.html` (dark)
**Prior art:** `docs/superpowers/specs/2026-05-27-apps-admin-ui-design.md`, `2026-05-29-orgs-admin-ui-design.md`

## Goal

Ship CRUD admin UI for `SaPermission` — name + app, list + view + create + edit + delete — following the exact pattern already established by /apps and /orgs. The sidebar entry for `Permissions` is already wired; this spec implements what it links to.

## Non-goals

- Bulk operations (multi-create or multi-delete).
- Assigning permissions to roles or users from this page (that's the /roles UI, future work).
- Changing the `appId` of an existing permission.
- "Load more" pagination inside the view-drawer's roles/users lists (capped at 50 each).
- A separate seed for permissions — the existing `apps/auth-server/src/seed/seed.ts` already creates the platform-system permissions; this UI is for managing the rest.

## Key decisions (locked at brainstorm)

1. **Platform-prefix lock.** Any permission whose `name` starts with `platform.` is treated as read-only by both the API (server-enforced, throws `ForbiddenException`) and the UI (a `Platform` badge renders next to the name, and the edit / delete dropdown items are hidden for those rows).
2. **`appId` is immutable.** Set at create-time. The edit drawer renders it read-only. Server's `PATCH` DTO does not accept `appId`; sending it returns 400.
3. **View drawer renders usage counts + the actual roles/users lists** (top 50 each). Two `count()` + two paginated `findMany()` queries on `GET /api/permissions/:publicId`.

## Architecture

### Auth-server module

New module at `apps/auth-server/src/permissions/`, mirroring `apps/auth-server/src/orgs/`:

```
permissions/
├── permissions.controller.ts
├── permissions.service.ts
├── permissions.service.spec.ts
├── permissions.module.ts
└── dto/
    ├── create-permission.dto.ts
    ├── update-permission.dto.ts
    └── list-permissions-query.dto.ts
```

`PermissionsModule` is added to `app.module.ts`'s `imports` array next to `OrgsModule`.

### Admin app

New page route + actions + table + three drawers in the established pattern:

```
apps/admin/
├── app/(admin)/permissions/
│   ├── page.tsx
│   └── actions.ts
├── components/
│   ├── permissions-table.tsx
│   ├── permission-view-drawer.tsx
│   ├── permission-create-drawer.tsx
│   ├── permission-edit-drawer.tsx
│   └── __tests__/
│       ├── permissions-table.test.tsx
│       ├── permission-view-drawer.test.tsx
│       ├── permission-create-drawer.test.tsx
│       └── permission-edit-drawer.test.tsx
├── lib/
│   ├── api.ts          # +5 fetch helpers
│   └── types.ts        # extended Permission type + new view-drawer response type
└── messages/
    ├── en.json         # new permissions.* block
    └── fr.json         # new permissions.* block (French translations)
```

No changes to `admin-shell.tsx` — the sidebar already links to `/permissions`.

## Auth-server API

### `GET /api/permissions`

Query params (`ListPermissionsQueryDto`): `q?: string`, `appId?: string`, `page?: number`, `pageSize?: number`.

Returns `{ items: PermissionRow[]; total: number; page: number; pageSize: number }`.

Each `PermissionRow`:
```ts
{
  publicId: string
  name: string
  app: { publicId: string; name: string }
  roleCount: number
  userCount: number
}
```

Where:
- Filter `q` matches `name ILIKE '%q%'`.
- Filter `appId` resolves the app sqid → internal id, then filters `permissions.appId = X`.
- `roleCount` = `prisma.saRolePermission.count({ where: { permissionId } })` per row (batched via Prisma `groupBy`, not N+1).
- `userCount` = same for `saUserPermission`.
- Default `pageSize = 25`, `orderBy: { id: 'desc' }`.

Gate: `checkPermission(callerBaId, 'platform.permissions.manage')`.

### `GET /api/permissions/:publicId`

Returns the row above PLUS:
```ts
roles: Array<{ publicId: string; name: string; appName: string }>   // top 50 by role.name ASC
users: Array<{ publicId: string; email: string; firstName: string; lastName: string }>  // top 50 by email ASC
```

Implementation: one `prisma.saPermission.findUnique({ where: { publicId }, include: { app, roles: { take: 50, include: { role: { include: { app } } } }, users: { take: 50, include: { user: { include: { betterAuthUser } } } } } })`, plus two `count()` calls for the full totals.

404 if not found. Gate: same `platform.permissions.manage`.

### `POST /api/permissions`

Body (`CreatePermissionDto`):
```ts
{
  name: string    // required, matches /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]+)+$/
  appId: string   // required, app sqid
}
```

Behavior:
- Resolve `appId` sqid → internal id. 400 if not a valid sqid; 404 if app not found.
- Create with `publicId: 'placeholder'`, then update with `sqids.encode(draft.id)` — same two-step pattern as apps/orgs.
- Prisma `P2002` on `name` → `ConflictException('Permission with this name already exists')` → 409.
- Returns the created row in the `PermissionRow` shape (with `roleCount: 0, userCount: 0`).

Gate: same.

### `PATCH /api/permissions/:publicId`

Body (`UpdatePermissionDto`):
```ts
{
  name?: string   // optional; same regex
}
```

`appId` is intentionally NOT in the DTO. If a client sends extra fields, class-validator's `whitelist` strips them (or `forbidNonWhitelisted` returns 400 — match whatever orgs does).

Behavior:
- Load existing; 404 if not found.
- If `existing.name.startsWith('platform.')` → `ForbiddenException('Platform-system permissions cannot be modified')` → 403.
- Apply update. `P2002` on `name` → 409 conflict.
- Returns updated `PermissionRow`.

Gate: same.

### `DELETE /api/permissions/:publicId`

Behavior:
- Load existing; 404 if not found.
- If `existing.name.startsWith('platform.')` → 403.
- Try `prisma.saPermission.delete`. `P2003` (FK constraint from `saRolePermission` or `saUserPermission`) → `ConflictException('Permission is in use by N roles and M users')` → 409, where N and M come from a pre-delete count.

Returns 204. Gate: same.

## Admin app — files and behavior

### `app/(admin)/permissions/page.tsx`

Server component, same shape as `apps/page.tsx`:

```tsx
import { getPermissions, getApps, getMyPermissions } from '@/lib/api'
import { PermissionsTable } from '@/components/permissions-table'
import { AccessDeniedPanel } from '@/components/access-denied-panel'

export default async function PermissionsPage() {
  const [permsResult, listResult, appsResult] = await Promise.allSettled([
    getMyPermissions(),
    getPermissions({ page: 1, pageSize: 25 }),
    getApps({ pageSize: 200 }),
  ])
  const perms = permsResult.status === 'fulfilled' ? permsResult.value : []
  const canManage = perms.includes('platform.permissions.manage')
  if (!canManage) return <AccessDeniedPanel />
  if (listResult.status === 'rejected') throw listResult.reason
  if (appsResult.status === 'rejected') throw appsResult.reason
  return <PermissionsTable initial={listResult.value} apps={appsResult.value.items} />
}
```

### `app/(admin)/permissions/actions.ts`

Five server actions: `createPermissionAction`, `updatePermissionAction`, `deletePermissionAction`, `listPermissionsAction`, `getPermissionAction`. Same error-mapping pattern as `apps/actions.ts`:

```ts
function mapError(message: string, kind: 'create' | 'update' | 'delete'): string {
  if (message.includes('409')) {
    if (kind === 'delete') return 'permissions.errors.inUse'
    return 'permissions.errors.nameExists'
  }
  if (message.includes('403')) {
    if (kind !== 'delete') return 'permissions.errors.platformProtected'
    return 'permissions.errors.forbidden'
  }
  if (message.includes('400')) return 'permissions.errors.nameInvalid'
  return 'permissions.errors.generic'
}
```

Each successful mutation calls `revalidatePath('/permissions')`.

### `components/permissions-table.tsx`

Client component, same shape as `orgs-table.tsx`:
- PageHeader breadcrumbs: `[{ href: '/permissions', label: t('nav.accessControl') }, { label: t('permissions.title') }]`
- Actions slot: app-filter `<select>` (drives `appId` URL param via the existing pattern) + Search input + `<ButtonGroup>` wrapping the "Add Permission" `<Button>` (with lucide `Plus`).
- DataTable columns:
  - **Name + App** (40%): `<KeyRound>` icon (lucide), name on top line with optional `<Badge variant="secondary">Platform</Badge>` to the right of name, app name beneath in muted text.
  - **Public ID** (20%): `<code>{publicId}</code>` + copy button (reuse the same pattern as orgs/apps).
  - **Usage** (20%): `{roleCount} {t('permissions.fields.rolesShort')} · {userCount} {t('permissions.fields.usersShort')}`.
  - **Actions** (right-aligned): `DropdownMenu` — `View` always; `Edit` only if not platform.*; `Delete` only if not platform.* AND `roleCount + userCount === 0` (otherwise show disabled with title "In use by N roles, M users — remove assignments first").
- Row click → opens view drawer.
- Debounced 300ms refetch on search/appFilter/page/pageSize change (same `initialRefRef` pattern as orgs).
- Footer pagination (same shape).
- AlertDialog for delete (uses the shared `DeleteAlertDialog` component).

### `components/permission-view-drawer.tsx`

Sheet content sections:
1. **Header**: `<KeyRound>` icon + name + `Platform` badge (if applicable) + close button.
2. **Detail card** (`rounded-xl border border-border bg-card shadow-sm p-6`): two `DetailRow`s — Name (with copy), Public ID (mono, with copy). App row shows app name + small app-sqid in mono.
3. **Roles section** (`rounded-xl ... p-6`): header `<ShieldEllipsis>` icon + "Assigned to {roleCount} roles" + (if `roleCount > 50`) muted right-aligned text "Showing top 50". Body: badge-style chips for each role (`<Badge variant="secondary">{role.name}</Badge>`, with role's app name as tooltip).
4. **Users section** (same pattern): `<Users>` icon + "Granted directly to {userCount} users" + 50-cap notice. Body: list of users with `<UserAvatar>` + name + email per row.
5. Empty-state for either section: muted `"—"` placeholder + helper text `t('permissions.drawer.noRoles')` / `t('permissions.drawer.noUsers')`.

The drawer's effect fetches the detailed payload via `getPermissionAction(publicId)` when `open && permission` change (same loading flow as user-view-drawer).

### `components/permission-create-drawer.tsx`

Form fields:
- `name` — `<Input>`, helper text `t('permissions.fields.nameHint')` ("lowercase, dotted, e.g. `apps.read`"). Client-side regex validation runs on blur; error key `permissions.errors.nameInvalid` shown inline.
- `appId` — `<Select>` populated from the `apps` prop passed by the page. Required.
- `<ButtonGroup>` footer: Cancel + Create.

On submit, calls `createPermissionAction`. Inline error on `errorKey` result.

### `components/permission-edit-drawer.tsx`

- `name` — editable `<Input>`, same validation.
- `appId` — read-only display: app name + sqid, with help text `t('permissions.fields.appImmutable')`.
- `<ButtonGroup>` footer: Cancel + Save.

### `lib/api.ts`

Five new functions:
```ts
export async function getPermissions(params: ListPermissionsParams): Promise<ListPermissionsResponse>
export async function getPermission(publicId: string): Promise<PermissionDetail>
export async function createPermission(payload: CreatePermissionPayload): Promise<Permission>
export async function updatePermission(publicId: string, patch: UpdatePermissionPayload): Promise<Permission>
export async function deletePermission(publicId: string): Promise<void>
```

All five use `apiFetch` (existing helper). `deletePermission` uses `method: 'DELETE'`.

### `lib/types.ts`

The existing `Permission` interface (id/name/appId) stays. New types added:

```ts
export interface PermissionRow {
  publicId: string
  name: string
  app: { publicId: string; name: string }
  roleCount: number
  userCount: number
}

export interface PermissionDetail extends PermissionRow {
  roles: Array<{ publicId: string; name: string; appName: string }>
  users: Array<{ publicId: string; email: string; firstName: string; lastName: string }>
}

export interface CreatePermissionPayload { name: string; appId: string }
export interface UpdatePermissionPayload { name?: string }
export interface ListPermissionsParams { q?: string; appId?: string; page?: number; pageSize?: number }
export interface ListPermissionsResponse { items: PermissionRow[]; total: number; page: number; pageSize: number }
```

(The existing `Permission` interface — used by `user-view-drawer.tsx` to show effective permissions — is unrelated and stays unchanged.)

### `messages/en.json`

New `permissions.*` block, mirroring the shape of `orgs.*`:

```json
"permissions": {
  "title": "Permissions",
  "subtitle": "Manage the permissions that roles and users can be assigned.",
  "totalCount": "{count} Total",
  "search": "Search by permission name…",
  "create": "Add Permission",
  "accessDenied": { "title": "Access denied", "body": "You do not have access to data on this page." },
  "columns": { "nameAndApp": "Permission & App", "sqid": "Public ID (Sqid)", "usage": "Usage", "actions": "Actions" },
  "fields": {
    "name": "Name",
    "nameHint": "Lowercase dotted notation, e.g. apps.read or org.users.manage.",
    "app": "App",
    "appImmutable": "App cannot be changed after creation.",
    "publicId": "Public ID",
    "rolesShort": "roles",
    "usersShort": "users"
  },
  "badges": { "platform": "Platform" },
  "actions": { "view": "View", "edit": "Edit", "delete": "Delete", "copy": "Copy", "copied": "Copied!" },
  "drawer": {
    "cancel": "Cancel",
    "save": "Save",
    "saving": "Saving…",
    "createTitle": "Add Permission",
    "createSubtitle": "Define a new permission scoped to one app.",
    "editTitle": "Edit Permission",
    "viewTitle": "Permission Details",
    "rolesSection": "Assigned to roles",
    "usersSection": "Granted directly to users",
    "noRoles": "No roles hold this permission.",
    "noUsers": "No users hold this permission directly.",
    "showingTop50": "Showing top 50 of {total}"
  },
  "filter": { "appLabel": "Filter by app", "allApps": "All apps" },
  "pagination": { "showing": "Showing {from}–{to} of {total}", "pageSize": "{count} per page", "previous": "Previous", "next": "Next" },
  "confirmDelete": {
    "title": "Delete permission",
    "body": "Delete “{name}”? This cannot be undone.",
    "button": "Delete"
  },
  "errors": {
    "nameRequired": "Name is required.",
    "nameInvalid": "Name must be lowercase, dotted (e.g. apps.read).",
    "nameExists": "A permission with that name already exists.",
    "inUse": "Permission is in use by roles or users. Remove assignments first.",
    "platformProtected": "Platform-system permissions cannot be modified.",
    "forbidden": "You do not have permission to perform this action.",
    "generic": "Something went wrong. Please try again."
  }
}
```

`messages/fr.json` gets matching French translations for every key.

## Tests

### Auth-server: `permissions.service.spec.ts`

- `listPermissions` filters by `q` and `appId`; pagination math correct; returns row counts.
- `getPermission` includes top-50 roles + users with their related fields.
- `createPermission` rejects malformed names (regex), throws `ConflictException` on `P2002`, throws `NotFoundException` if `appId` sqid invalid.
- `updatePermission` rejects when `existing.name.startsWith('platform.')` with `ForbiddenException`; happy path updates name.
- `deletePermission` rejects platform.*; rejects when row has `SaRolePermission`/`SaUserPermission` (mocked `P2003`); happy path deletes.

### Admin component tests

Mirror existing `orgs-table.test.tsx`, `org-create-drawer.test.tsx`, etc.:
- `permissions-table.test.tsx` — renders rows, search filters, Delete opens AlertDialog with the permission's name, Platform badge appears on `platform.*` rows, Edit/Delete dropdown items hidden for platform.* rows.
- `permission-create-drawer.test.tsx` — name regex validation surfaces inline error; happy submit closes drawer.
- `permission-edit-drawer.test.tsx` — name editable, app shown read-only.
- `permission-view-drawer.test.tsx` — shows role/user lists; "Showing top 50 of N" appears when count > 50; empty state when both are zero.

Each test mocks `@/app/(admin)/permissions/actions` and `@sassy-auth/ui` (including `SidebarTrigger` per the established pattern).

## Risks

- **Permission rename ripples.** Roles and users hold permissions by FK (`permissionId`), not by name string, so renaming a permission does NOT break existing assignments — but any code/seed that grants by name lookup (`prisma.saPermission.findUnique({ where: { name } })`) WILL break the next time it runs. The platform-prefix lock protects the seeded names. Mitigation noted; no code change here.
- **Per-row role/user counts.** The list endpoint does N+1 if implemented naively. Use a single `groupBy` (`prisma.saRolePermission.groupBy({ by: ['permissionId'], _count: true, where: { permissionId: { in: pageIds } } })`) and merge into the rows.
- **403 vs 404 disclosure.** When a user lacks `platform.permissions.manage`, the page returns `<AccessDeniedPanel>` based on `getMyPermissions()` — same pattern as /apps and /orgs. The auth-server itself returns 403 for any caller that fails `checkPermission`.

## File-touch list

**Net new:**
- `apps/auth-server/src/permissions/permissions.controller.ts`
- `apps/auth-server/src/permissions/permissions.service.ts`
- `apps/auth-server/src/permissions/permissions.service.spec.ts`
- `apps/auth-server/src/permissions/permissions.module.ts`
- `apps/auth-server/src/permissions/dto/create-permission.dto.ts`
- `apps/auth-server/src/permissions/dto/update-permission.dto.ts`
- `apps/auth-server/src/permissions/dto/list-permissions-query.dto.ts`
- `apps/admin/app/(admin)/permissions/page.tsx`
- `apps/admin/app/(admin)/permissions/actions.ts`
- `apps/admin/components/permissions-table.tsx`
- `apps/admin/components/permission-view-drawer.tsx`
- `apps/admin/components/permission-create-drawer.tsx`
- `apps/admin/components/permission-edit-drawer.tsx`
- `apps/admin/components/__tests__/permissions-table.test.tsx`
- `apps/admin/components/__tests__/permission-view-drawer.test.tsx`
- `apps/admin/components/__tests__/permission-create-drawer.test.tsx`
- `apps/admin/components/__tests__/permission-edit-drawer.test.tsx`

**Modified:**
- `apps/auth-server/src/app.module.ts` (register `PermissionsModule`)
- `apps/admin/lib/api.ts` (5 new fetch helpers)
- `apps/admin/lib/types.ts` (new types added; existing `Permission` interface untouched)
- `apps/admin/messages/en.json` (new `permissions.*` block)
- `apps/admin/messages/fr.json` (new `permissions.*` block, translated)

## Verification

1. `pnpm --filter @sassy-auth/auth-server test` — all green; new spec adds ~8 tests.
2. `pnpm --filter @sassy-auth/admin test` — all green; new specs add ~10 tests.
3. `pnpm --filter @sassy-auth/admin build` — clean.
4. Boot dev (admin + auth-server) and visit `/permissions`:
   - Verify list renders with the 6 seeded platform.* permissions, each carrying the `Platform` badge and no edit/delete option.
   - Create a fresh `apps.test` permission scoped to a non-platform app → succeeds, appears in the list.
   - Open its view drawer → shows usage counts 0 + empty role/user lists.
   - Edit its name → succeeds.
   - Try to edit a platform.* via API directly → 403.
   - Delete the test permission → succeeds; AlertDialog confirms.
5. Repeat the spot-check in dark mode via the sidebar-footer toggle.
