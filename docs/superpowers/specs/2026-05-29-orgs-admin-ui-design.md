# Orgs Admin UI — Design Spec

**Date:** 2026-05-29
**Author:** brainstorming session (Claude + user)
**Related prior specs:** `2026-05-25-data-model-core-auth-design.md`, `2026-05-26-user-management-ui-design.md`, `2026-05-27-apps-admin-ui-design.md`

## 1. Goal

Ship a working `/orgs` page in `apps/admin` so a platform admin can list, create, view, edit, and delete organizations across registered apps. Mirrors the existing `/apps` feature one-for-one (list / search / app-scoped filter / pagination / view drawer / create drawer / edit drawer / delete confirm). Extends the auth-server `OrgsModule` from its current minimal (`GET /`, `GET /:id`) shape into full CRUD with pagination + filtering, matching the `/api/apps` controller.

## 2. Scope

### In scope

- **Schema**: `@@unique([appId, name])` constraint on `SaOrg`. New Prisma migration.
- **Schema**: derived data — the list endpoint surfaces a per-org `userCount` via `_count` on the existing `SaOrg.users` relation. No schema column added.
- **Server (auth-server)**: extend `OrgsController` with `POST /`, `PATCH /:publicId`, `DELETE /:publicId`. Replace the existing `GET /` and `GET /:publicId` with handlers using new DTOs and a paginated/structured response shape. All endpoints gated by `platform.orgs.manage` via `checkPermission()`.
- **Server (auth-server)**: new DTOs — `CreateOrgDto`, `UpdateOrgDto`, `ListOrgsQueryDto` (with `q` and `appId` filters).
- **Server (auth-server)**: error mapping aligned with apps — `P2002` → `409 Conflict` (name-in-app), `P2003` → `409 Conflict` (dependent users), platform-org protection → `403`, missing app id on create → `404`.
- **Admin UI**: `/orgs` route under the `(admin)` route group. Server component fetches the first page + the apps list (for the filter dropdown) + permissions; renders either the table or `AccessDeniedPanel`.
- **Admin UI**: list (full-width table with server-side pagination, debounced server-side search, app-filter dropdown, copy-to-clipboard on sqid, row action menu, platform-org badge, Users count column), View drawer, Create drawer, Edit drawer.
- **Admin UI**: reuse the existing `ConfirmDialog` primitive in `@sassy-auth/ui` for the delete flow.
- **Admin UI**: extend `/users` page to read `orgId` from the query string so the "View users →" deep link from the org drawer pre-filters the users list.
- **lib/api.ts + lib/types.ts**: add `getOrgs`, `createOrg`, `updateOrg`, `deleteOrg`, plus the matching DTO and response interfaces.
- **i18n**: new `orgs.*` key tree in `messages/en.json` and `messages/fr.json` (FR flagged in the PR for a human-review pass).
- **Backend tests**: extend `orgs.service.spec.ts` with the new methods, mirroring `apps.service.spec.ts` coverage (auth gating, name conflict, platform protection, FK conflict on delete, sqid round-trip, app-filter sqid resolution).

### Explicitly NOT in scope

- Moving an org between apps. `appId` is read-only in the Edit drawer. Cross-app migration would need its own flow (reassign users, etc.).
- Embedding the users list inside the org View drawer. The drawer shows a `userCount` + deep link only; `/users?orgId=…` is the canonical users view.
- Persisting the app-filter selection across reloads (no URL/localStorage state in v1, to stay parity with apps).
- Bulk operations (multi-select, bulk delete, bulk reassign).
- Playwright/e2e specs for orgs. `apps/admin-e2e` is a single-login scaffold today (see recent `feat(admin-e2e)` commits); follow-up TODO noted in PR description.
- A combobox/search-as-you-type apps filter. The dropdown fetches up to 200 apps; if the platform grows past that, swap for a combobox as a follow-up.
- Changing the existing `users` page's filter UI. The deep link works because `getUsers({ orgId })` already supports it (`apps/admin/lib/api.ts:22`); only the page must read the query param.

## 3. Architecture

### Layering

```
┌────────────────────────────────────────────────────┐
│ apps/admin (Next.js App Router)                    │
│  app/(admin)/orgs/page.tsx        server component │
│  app/(admin)/orgs/actions.ts      server actions   │
│  components/orgs-table.tsx        client           │
│  components/org-{view,create,edit}-drawer.tsx      │
│  lib/api.ts                       HTTP client      │
│  lib/types.ts                     shared types     │
└────────────────────────────────────────────────────┘
                       │ HTTP + session cookie
                       ▼
┌────────────────────────────────────────────────────┐
│ apps/auth-server (NestJS)                          │
│  src/orgs/orgs.controller.ts        (rewritten)    │
│  src/orgs/orgs.service.ts           (rewritten)    │
│  src/orgs/dto/create-org.dto.ts     (new)          │
│  src/orgs/dto/update-org.dto.ts     (new)          │
│  src/orgs/dto/list-orgs-query.dto.ts (new)         │
│  src/common/sqid/sqid.service.ts    (used)         │
│  src/common/permissions/check-permission.ts (used) │
└────────────────────────────────────────────────────┘
                       │
                       ▼
┌────────────────────────────────────────────────────┐
│ packages/db (Prisma)                               │
│  schema.prisma  — add @@unique([appId, name])      │
│  migrations/<ts>_add_saorg_unique_app_name/        │
└────────────────────────────────────────────────────┘
```

### Sidebar nav

Unchanged. `/orgs` is already wired in `apps/admin/components/admin-shell.tsx` (`NAV_ITEMS`). The link previously dead-ended; it now resolves.

## 4. Data model

### Prisma — `SaOrg`

```prisma
model SaOrg {
  id         Int      @id @default(autoincrement())
  publicId   String   @unique
  name       String
  appId      Int
  app        SaApp    @relation(fields: [appId], references: [id])
  isPlatform Boolean  @default(false)
  users      SaUser[]

  @@unique([appId, name])
}
```

Only added line: `@@unique([appId, name])`. No new columns. `userCount` is computed via Prisma's `_count` on the `users` relation at query time.

### Migration

Generate `<timestamp>_add_saorg_unique_app_name`. The migration is safe on a fresh schema. Before generating, the implementor must:

1. Grep `apps/auth-server/src` and `packages/db` for seeds/fixtures that insert `SaOrg` rows (notably `platform-admin-seed`).
2. Verify no `(appId, name)` duplicates exist in those seeds. If they do, fix the seed.
3. Note in the PR description that any existing dev/prod DB with duplicate `(appId, name)` would need a one-time dedupe step before the migration applies.

## 5. Backend endpoints

All endpoints under `/api/orgs`, guarded by `BetterAuthGuard`. Mutating endpoints (`POST`, `PATCH`, `DELETE`) require `platform.orgs.manage`. Read endpoints (`GET /`, `GET /:publicId`) accept `platform.orgs.manage` and fall back to `org.users.manage` (preserving today's behavior so the existing `/users` page's org dropdown continues to work for org-scoped admins).

### `GET /api/orgs`

Query (`ListOrgsQueryDto`): `page?: number` (default 1), `pageSize?: number` (default 25), `q?: string` (case-insensitive `name` contains), `appId?: string` (parent app sqid). DTO validation mirrors `ListAppsQueryDto` — same numeric coercion, same upper bound (or lack thereof) on `pageSize`.

Response shape (breaking change from prior `Org[]`):

```ts
{
  items: Array<{
    publicId: string;
    name: string;
    isPlatform: boolean;
    userCount: number;
    app: { publicId: string; name: string };
  }>;
  total: number;
  page: number;
  pageSize: number;
}
```

Behavior:
- If `appId` is supplied: resolve sqid → numeric id. `404` if app missing.
- Filter `where.name` (insensitive contains) when `q` is supplied.
- `orderBy: { id: 'desc' }`, matching apps.
- `include: { app: { select: { publicId: true, name: true } }, _count: { select: { users: true } } }`.

### `POST /api/orgs`

Body (`CreateOrgDto`): `{ name: string (1..120, non-empty), appId: string (sqid) }`.

Behavior:
- Resolve `appId` sqid → numeric. `404` if missing.
- `403` if parent app is `isPlatform` (platform orgs can only be seeded).
- Two-step transaction (insert placeholder `publicId`, then update with `sqids.encode(id)`), matching `apps.service.ts:42-49`.
- `P2002` → `409 Conflict` "Org with this name already exists in this app".

Response: `{ publicId, name, isPlatform, userCount: 0, app: { publicId, name } }`.

### `PATCH /api/orgs/:publicId`

Body (`UpdateOrgDto`): `{ name?: string }`. `appId` is **not** patchable here.

Behavior:
- `404` if org missing.
- `403` if `existing.isPlatform`.
- `400` if no fields provided (matching apps' `BadRequestException` pattern).
- `P2002` → `409 Conflict` with the same message as create.

Response: same shape as create.

### `DELETE /api/orgs/:publicId`

Response: `204 No Content`.

Behavior:
- `404` if missing.
- `403` if `existing.isPlatform`.
- `P2003` → `409 Conflict` "Org has dependent users".

### Authorization summary

| Endpoint | Required permission |
|----------|---------------------|
| `GET /api/orgs` | `platform.orgs.manage` OR `org.users.manage` |
| `GET /api/orgs/:publicId` | `platform.orgs.manage` OR `org.users.manage` |
| `POST /api/orgs` | `platform.orgs.manage` |
| `PATCH /api/orgs/:publicId` | `platform.orgs.manage` |
| `DELETE /api/orgs/:publicId` | `platform.orgs.manage` |

The fallback on the read endpoints preserves the current behavior so the existing `/users` page (which calls `getOrgs()` to populate its org filter dropdown for org-scoped admins) keeps working.

## 6. Admin UI

### `app/(admin)/orgs/page.tsx`

Server component. Pattern mirrors `app/(admin)/apps/page.tsx:5-15`:

```ts
const [permsResult, orgsResult, appsResult] = await Promise.allSettled([
  getMyPermissions(),
  getOrgs({ page: 1, pageSize: 25 }),
  getApps({ page: 1, pageSize: 200 }),
])
const perms = permsResult.status === 'fulfilled' ? permsResult.value : []
const canManage = perms.includes('platform.orgs.manage')
if (!canManage) return <AccessDeniedPanel />
if (orgsResult.status === 'rejected') throw orgsResult.reason
if (appsResult.status === 'rejected') throw appsResult.reason
return <OrgsTable initial={orgsResult.value} apps={appsResult.value.items} />
```

The apps list is passed in for the filter dropdown so it renders on first paint.

### `app/(admin)/orgs/actions.ts`

Server actions, matching `apps/actions.ts` line-for-line:

- `createOrgAction(input: CreateOrgPayload)` → `{ org } | { errorKey }`
- `updateOrgAction(publicId, patch: UpdateOrgPayload)` → `{ org } | { errorKey }`
- `deleteOrgAction(publicId)` → `{ ok: true } | { errorKey }`
- `listOrgsAction(params: ListOrgsParams)` → `ListOrgsResponse | { errorKey }`

`mapError` returns one of: `orgs.errors.nameExists` (409 on create/update), `orgs.errors.hasDependents` (409 on delete), `orgs.errors.platformProtected` (403 on update/delete), `orgs.errors.appNotFound` (404 on create), `orgs.errors.forbidden` (403 on list), `orgs.errors.generic` (fallback).

### `components/orgs-table.tsx`

Mirror `apps-table.tsx`. Differences:

- **State**: add `appFilter: string` (selected app `publicId` or `''` for "All apps").
- **Effect**: `useEffect` deps include `appFilter`; the refetch call passes `appId: appFilter || undefined`.
- **Header chrome**: title pill + app filter `<select>` + search input + Create button (left to right on the right side).
- **Columns**:
  1. `id: 'nameAndApp'` — icon tile (`corporate_fare`) + org name + Platform badge inline + parent app name in muted subline.
  2. `id: 'app'` — parent app name as a plain cell.
  3. `id: 'sqid'` — org `publicId` with copy button (identical to apps).
  4. `id: 'userCount'` — right-aligned numeric, uses `orgs.fields.userCount` pluralization.
  5. `id: 'actions'` — kebab with View / Edit / Delete (Edit + Delete hidden when `isPlatform`).
- **Row click**: opens View drawer.
- **Delete flow**: `ConfirmDialog` with `orgs.confirmDelete.*` keys; reuses the apps pattern at `apps-table.tsx:133-146`.
- **Pagination component**: identical, with `orgs.pagination.*` keys.

### `components/org-view-drawer.tsx`

Mirror `app-view-drawer.tsx`. Body sections:

1. **Parent App** — `DetailRow` showing the app `name`. The "copy" button copies the app's `publicId` (use `tooltip`/`aria-label` "Copy app sqid").
2. **Public ID** — monospaced `DetailRow` for the org `publicId`.
3. **Users** — card-style row with `orgs.fields.userCount` count on the left, "View users →" `<Link>` on the right pointing to `/users?orgId={publicId}`. If `userCount === 0`, count text shows "No users yet" but the link remains.

Header buttons (Edit, Delete, close) follow apps' pattern, including the `isPlatform` hide.

### `components/org-create-drawer.tsx`

Mirror `app-create-drawer.tsx`. Fields:

1. **App** select — required, populated from the apps list passed in via props from the parent table (no re-fetch). Platform apps are filtered out. If the filtered list is empty, the form shows an inline notice (`orgs.drawer.noNonPlatformApps`) + a `goToApps` link and the submit button is disabled.
2. **Org Name** — required, trimmed, max 120 chars.

Validation: client-side `name.trim()` non-empty and `appId` selected. Errors mapped via `errorKey`.

### `components/org-edit-drawer.tsx`

Mirror `app-edit-drawer.tsx`. Fields:

1. **Org Name** — editable.
2. **App** — read-only display: app name with a copyable `publicId` row. Muted helper text below: `orgs.fields.appReadOnlyHint`.
3. **Public ID** — read-only, copyable, identical to apps.

`dirty = name !== org.name`. Save disabled until dirty.

### `lib/types.ts` additions

```ts
export interface OrgRow {
  publicId: string
  name: string
  isPlatform: boolean
  userCount: number
  app: { publicId: string; name: string }
}

export interface CreateOrgPayload { name: string; appId: string }
export interface UpdateOrgPayload { name?: string }

export interface ListOrgsParams {
  page?: number
  pageSize?: number
  q?: string
  appId?: string
}

export interface ListOrgsResponse {
  items: OrgRow[]
  total: number
  page: number
  pageSize: number
}
```

The existing minimal `Org` interface (`apps/admin/lib/types.ts:14-19`) is kept as-is — it is the shape the existing `/users` page consumes (see "`/users` page adapter for the new orgs shape" above). The new `OrgRow` interface is the richer shape returned by the rewritten `getOrgs` / `createOrg` / `updateOrg`.

### `lib/api.ts` additions

Replace the existing `getOrgs(): Promise<Org[]>` with:

```ts
export async function getOrgs(params: ListOrgsParams = {}): Promise<ListOrgsResponse> { ... }
export async function createOrg(payload: CreateOrgPayload): Promise<OrgRow> { ... }
export async function updateOrg(publicId: string, patch: UpdateOrgPayload): Promise<OrgRow> { ... }
export async function deleteOrg(publicId: string): Promise<void> { ... }
```

All four follow the same Sentry breadcrumb / error-throw pattern as the apps client.

### `/users` page query-param wiring

In `apps/admin/app/(admin)/users/page.tsx` (and wherever the page reads filters), parse `?orgId=…` from `searchParams` and pre-populate the existing org filter. No new server endpoint needed — `getUsers({ orgId })` already exists at `lib/api.ts:22`.

### `/users` page adapter for the new orgs shape

The rewrite of `getOrgs()` from `Promise<Org[]>` to `Promise<ListOrgsResponse>` breaks the existing `/users` page (`apps/admin/app/(admin)/users/page.tsx:5`), and the OLD `Org` shape (`{ id, name, appId, isPlatform }`) is consumed by `users-table.tsx:30,65` (via `orgMap`) and `user-create-drawer.tsx:54,204`. Rather than refactor those components, keep the existing `Org` interface name reserved for the OLD shape used by users-side code, and introduce a new name for the rich org row used by `/orgs`:

- Rename the new interface (Section 6) from `Org` to `OrgRow`. Apply the rename consistently across `lib/types.ts`, `lib/api.ts` return types, `org-*-drawer.tsx`, `orgs-table.tsx`, and `actions.ts`.
- Keep the existing `Org` interface as-is.
- In `users/page.tsx`, adapt at the boundary:

  ```ts
  const orgsRes = await getOrgs({ pageSize: 200 })
  const orgs: Org[] = orgsRes.items.map(o => ({
    id: o.publicId,
    name: o.name,
    appId: o.app.publicId,
    isPlatform: o.isPlatform,
  }))
  ```

This isolates the breaking change at the only existing caller and keeps `users-table.tsx` / `user-create-drawer.tsx` untouched.

## 7. i18n

New `orgs.*` block in both `messages/en.json` and `messages/fr.json`. Key list (see Section 5 of the brainstorm transcript or `2026-05-27-apps-admin-ui-design.md` for the parallel `apps.*` block):

- `orgs.title`, `orgs.subtitle`, `orgs.totalCount`, `orgs.search`, `orgs.create`.
- `orgs.filter.allApps`, `orgs.filter.appLabel`.
- `orgs.accessDenied.title`, `orgs.accessDenied.body`.
- `orgs.columns.nameAndApp`, `orgs.columns.app`, `orgs.columns.sqid`, `orgs.columns.users`, `orgs.columns.actions`.
- `orgs.fields.name`, `orgs.fields.app`, `orgs.fields.appReadOnlyHint`, `orgs.fields.publicId`, `orgs.fields.users`, `orgs.fields.userCount` (ICU plural), `orgs.fields.viewUsers`.
- `orgs.actions.view`, `orgs.actions.edit`, `orgs.actions.delete`, `orgs.actions.copy`, `orgs.actions.copied`.
- `orgs.drawer.viewTitle`, `orgs.drawer.createTitle`, `orgs.drawer.createSubtitle`, `orgs.drawer.editTitle`, `orgs.drawer.save`, `orgs.drawer.saving`, `orgs.drawer.cancel`, `orgs.drawer.identifiersAutoGenerated`, `orgs.drawer.noNonPlatformApps`, `orgs.drawer.goToApps`.
- `orgs.confirmDelete.title`, `orgs.confirmDelete.body`, `orgs.confirmDelete.button`.
- `orgs.errors.nameExists`, `orgs.errors.hasDependents`, `orgs.errors.platformProtected`, `orgs.errors.appNotFound`, `orgs.errors.forbidden`, `orgs.errors.generic`, `orgs.errors.nameRequired`, `orgs.errors.appRequired`.
- `orgs.badges.platform`.
- `orgs.pagination.pageSize`, `orgs.pagination.perPage`, `orgs.pagination.previous`, `orgs.pagination.next`, `orgs.pagination.showing` (mention "orgs" in the showing string).

FR translations: provided initially via an LLM pass matching the existing FR style; flag the PR description for a human-review pass before merge.

## 8. Tests

### Backend — `apps/auth-server/src/orgs/orgs.service.spec.ts`

Extend the existing spec. Test cases (mirroring `apps.service.spec.ts`):

- `listOrgs`:
  - returns paginated shape and total count.
  - filters by `q` (case-insensitive `name` contains).
  - filters by `appId` (sqid resolution).
  - `404` when `appId` sqid is invalid/missing.
  - `403` when caller lacks `platform.orgs.manage`.
- `createOrg`:
  - happy path; verifies sqid `publicId` round-trip.
  - `409` on per-app name conflict (P2002).
  - `404` when `appId` missing.
  - `403` when parent app is `isPlatform`.
  - `403` when caller lacks permission.
- `updateOrg`:
  - happy path.
  - `400` when no fields provided.
  - `404` when org missing.
  - `403` when `existing.isPlatform`.
  - `409` on name conflict.
- `deleteOrg`:
  - happy path.
  - `404` when missing.
  - `403` when `existing.isPlatform`.
  - `409` (P2003) when org has users.

### Admin UI

If `apps/admin/components/__tests__/apps-table.test.tsx` (or equivalent) exists, add the sibling `orgs-table.test.tsx` with parity coverage. If no sibling exists, do not introduce a new test harness — match the existing coverage level. (Implementor checks this during the plan step.)

### e2e

Out of scope. Add a TODO in PR description for follow-up.

## 9. Edge cases & gotchas

1. **No non-platform apps exist** → Create drawer disables submit, renders `orgs.drawer.noNonPlatformApps` notice + `goToApps` link.
2. **Parent app deleted while create drawer is open** → server returns `404`, mapped to `orgs.errors.appNotFound`.
3. **Org with users → DELETE** → backend `409`, mapped to `orgs.errors.hasDependents`; `ConfirmDialog` stays open with the error inline (see `apps-table.tsx:133-146`).
4. **`isPlatform` org** → Edit and Delete hidden in both the kebab and the View drawer header.
5. **`isPlatform` parent app** → cannot create orgs under it via UI (platform app excluded from the dropdown) or via API (backend returns `403`).
6. **App-filter persistence** → not persisted in v1 (parity with apps).
7. **Apps dropdown size** → the orgs page requests `getApps({ pageSize: 200 })` for the filter and create-drawer dropdown. This assumes the existing `ListAppsQueryDto` does not enforce a lower cap; implementor must verify when reading `apps/auth-server/src/apps/dto/list-apps-query.dto.ts` during the plan step and either raise the cap or page through. If the platform grows past a few hundred apps, swap for a search-as-you-type combobox.
8. **Breaking change to `GET /api/orgs` response** → was `Org[]`, becomes `{ items, total, page, pageSize }` with a richer per-item shape. The only known caller is the admin's `getOrgs`, which is rewritten in the same PR. The existing `/users` page is preserved via a one-call adapter (see Section 6 "`/users` page adapter for the new orgs shape"). Flag in PR description.
9. **Permission fallback preserved on reads** → `GET /api/orgs` and `GET /api/orgs/:publicId` continue to accept `org.users.manage` as a fallback so the `/users` page's org dropdown keeps working for org-scoped admins. Mutating endpoints require `platform.orgs.manage` only.
10. **Migration on populated DBs** — see Section 4 migration notes.

## 10. Out-of-band follow-ups

- e2e specs in `apps/admin-e2e/` for orgs.
- Human FR translation pass.
- URL-state persistence for the app filter + search (parity work also applicable to apps).
- Combobox upgrade for the app filter when app counts grow.
- Move-org-between-apps flow (requires user reassignment policy).
