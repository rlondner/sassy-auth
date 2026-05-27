# Apps Admin UI — Design Spec

**Date:** 2026-05-27
**Author:** brainstorming session (Claude + user)
**Implements designs:** `designs/apps-mgmt/{apps-mgmt-list-view, apps-mgmt-preview_en, apps-mgmt-preview_fr, apps-mgmt-create-app, apps-mgmt-edit-app}`
**Related prior specs:** `2026-05-25-data-model-core-auth-design.md`, `2026-05-26-user-management-ui-design.md`, `2026-05-27-platform-admin-seed-design.md`

## 1. Goal

Ship a working `/apps` page in `apps/admin` so a platform admin can list, create, view, edit, and delete authentication apps registered with SassyAuth. All five provided design files are used as the source of truth for visual treatment and copy. The work also adds a reusable destructive-action confirmation dialog to `@sassy-auth/ui` and wires it into both the new apps page and the existing users page.

## 2. Scope

### In scope

- **Server**: new NestJS `AppsModule` (`AppsController` + `AppsService`) on `auth-server` exposing `GET / POST / PATCH / DELETE /api/apps`. All endpoints gated by `platform.apps.manage` via the existing `checkPermission()` helper.
- **Server**: new `GET /api/me/permissions` endpoint returning the caller's effective permission names. Lives outside `AppsModule` (shared concern — possibly `auth/` or a new `me/` module).
- **Server**: self-delete guard on `DELETE /api/users/:id` — caller cannot delete their own SaUser.
- **Schema**: `@unique` constraint on `SaApp.name`. New Prisma migration.
- **Admin UI**: `/apps` route matching the Users-page pattern. Server component fetches data + permissions; renders either the table or an access-denied panel.
- **Admin UI**: list (full-width table with server-side pagination, debounced server-side search, copy-to-clipboard on sqid, row action menu, platform-app badge), View drawer, Create drawer, Edit drawer.
- **Shared UI**: new `<ConfirmDialog>` primitive in `@sassy-auth/ui` for destructive actions. Wired to:
  - Apps row Delete menu item + Apps View drawer Delete button.
  - Users row Delete menu item + new Users View drawer Delete button (added for parity with apps drawer).
- **i18n**: new `apps.*` key tree in `messages/en.json` and `messages/fr.json` (fully translated). Additional `users.confirmDelete.*` keys for the delete dialog on the users page.

### Explicitly NOT in scope

- Schema changes to `SaApp` beyond the unique constraint on `name`. No `type` (SPA/Web/M2M/Native), no `status` (active/paused/inactive), no callback URLs collection, no protocol field, no MFA settings, no audit log.
- The designs' "Authentication Settings" card, "Recent Activity" feed, "Last updated N ago" indicator, status chip, and type chip — all dropped because there is no backing data.
- The designs' "All Apps / Web / Mobile / M2M" filter chips and "Export Data" button — hidden (not rendered as inert controls).
- "Internal ID" field in drawers (the auto-inc `int` `id` is an implementation detail; only `publicId` (sqid) is user-facing).
- Wiring `Deactivate`/`Activate` row actions on the users page (status changes, not deletes).
- Master/detail layout chrome from `preview_en` / `preview_fr` — the View drawer reuses the *content* of their Core Details card but not the surrounding list-on-left layout (Users-pattern decision).
- Playwright/e2e tests — no harness exists today.
- Feature flag — net-new behind an unused sidebar link.

## 3. Architecture

### Layering

```
┌────────────────────────────────────────────────────┐
│ apps/admin (Next.js App Router)                    │
│  app/(admin)/apps/page.tsx        server component │
│  app/(admin)/apps/actions.ts      server actions   │
│  components/apps-table.tsx        client           │
│  components/app-{view,create,edit}-drawer.tsx      │
│  components/access-denied-panel.tsx                │
│  lib/api.ts                       HTTP client      │
└────────────────────────────────────────────────────┘
                       │ HTTP + session cookie
                       ▼
┌────────────────────────────────────────────────────┐
│ apps/auth-server (NestJS)                          │
│  src/apps/apps.controller.ts                       │
│  src/apps/apps.service.ts                          │
│  src/apps/apps.module.ts                           │
│  src/me/me.controller.ts          (new, shared)    │
│  src/common/permissions/check-permission.ts (used) │
└────────────────────────────────────────────────────┘
                       │
                       ▼
                  packages/db (Prisma)
                       │
                       ▼
                    Postgres
```

### Routing (admin app)

```
/apps                 list page (only route in this feature)
```

View / Create / Edit / Delete all happen in right-side drawers + modal dialog, controlled by client state in `<AppsTable />`. No `/apps/[publicId]` or `/apps/new` routes — matches the Users page exactly. Trade-off: View/Edit URLs are not shareable; can be added later via a `?app=<sqid>` query param without changing the file layout.

### Authorization model

- Every server endpoint under `/api/apps` calls `checkPermission(betterAuthUserId, 'platform.apps.manage')` as the first line. No `targetOrgId` — apps are platform-global resources, so any platform-scoped permission grants access (existing helper behaviour).
- The admin server component calls `getMyPermissions()` and renders `<AccessDeniedPanel />` when the caller lacks the permission. The API is the source of truth; the UI check exists only to render the right panel without a forbidden round-trip.
- `PATCH` and `DELETE` reject with `403` when the target app has `isPlatform: true`, even for callers with the permission. The UI hides the Edit/Delete buttons on platform-app rows; the server enforces.

## 4. Data model

### Migration

Add `@unique` to `SaApp.name`:

```prisma
model SaApp {
  id          Int            @id @default(autoincrement())
  publicId    String         @unique
  name        String         @unique   // ← new
  url         String
  isPlatform  Boolean        @default(false)
  // ... unchanged
}
```

Migration name: `apps_unique_name`. Safe on existing data (only the platform app row exists from seed). Run via `pnpm --filter @sassy-auth/db prisma:migrate:dev`.

No other schema changes.

## 5. Server API contract

All endpoints under `/api/apps`, guarded by `BetterAuthGuard`. Every handler calls `checkPermission(userId, 'platform.apps.manage')` first.

### `GET /api/apps`

**Query params**:
- `page` (1-indexed, default `1`, min `1`)
- `pageSize` (default `25`, max `100`, min `1`)
- `q` (optional substring, case-insensitive, applied to `name OR url` via `ILIKE`)

**Response 200**:
```json
{
  "items": [
    { "publicId": "sq_abc123", "name": "Customer Portal", "url": "https://portal.example.com", "isPlatform": false }
  ],
  "total": 24,
  "page": 1,
  "pageSize": 25
}
```

Internal `id` (auto-inc int) is **not** returned.

### `POST /api/apps`

**Body**: `{ name: string (1–120, trimmed), url: string (valid URL, max 2048) }`

**Response 201**: single item matching the list shape.

**Errors**: `400` (validation), `403` (no permission), `409` (name collision — `{ error: "App with this name already exists" }`).

**publicId generation**: two-step transaction matching `seed.ts`:
1. `create({ data: { publicId: 'placeholder', name, url, isPlatform: false } })` to obtain `id`.
2. `update({ where: { id }, data: { publicId: sqids.encode([id]) } })`.

### `PATCH /api/apps/:publicId`

**Body**: `{ name?: string, url?: string }` — partial, at least one field required.

**Response 200**: updated item.

**Errors**: `400` (validation / empty body), `403` (no permission OR target `isPlatform` — `{ error: "Platform app cannot be modified" }`), `404`, `409` (name collision).

### `DELETE /api/apps/:publicId`

**Response 204**.

**Errors**: `403` (no permission OR `isPlatform`), `404`, `409` (Prisma foreign-key failure from dependent `SaOrg`/`SaRole`/`SaPermission` rows — `{ error: "App has dependent organizations, roles, or permissions" }`).

### `GET /api/me/permissions` (new shared endpoint)

**Response 200**: `{ permissions: string[] }` — the union of role-derived and direct permission names for the caller.

Lives in a new `src/me/me.controller.ts` (and `me.service.ts` / `me.module.ts`). Justification: belongs neither to `auth/` (BetterAuth-owned) nor to `users/` (other-user-scoped).

### `DELETE /api/users/:id` — self-delete guard (new)

Existing endpoint adds: if the resolved target `SaUser.betterAuthUserId === req.betterAuthUser.id`, throw `ForbiddenException` with `{ error: "You cannot delete your own account" }`.

## 6. Admin UI

### Page-level data fetch (`apps/page.tsx`)

```tsx
const [permsResult, appsResult] = await Promise.allSettled([
  getMyPermissions(),
  getApps({ page: 1, pageSize: 25 }),
])
const perms = permsResult.status === 'fulfilled' ? permsResult.value : []
const canManage = perms.includes('platform.apps.manage')

if (!canManage) return <AccessDeniedPanel />
if (appsResult.status === 'rejected') throw appsResult.reason
return <AppsTable initial={appsResult.value} />
```

`Promise.allSettled` so the permissions call can succeed independent of the apps call.

### Server actions (`apps/actions.ts`)

All `'use server'`, all `revalidatePath('/apps')` on success. Return localized message *keys*, not strings — the client component does the `t(...)` lookup.

```ts
createAppAction(input: { name: string; url: string })
  → { app: App } | { errorKey: 'apps.errors.nameExists' | 'apps.errors.urlInvalid' | 'apps.errors.generic' }

updateAppAction(publicId: string, patch: { name?: string; url?: string })
  → { app: App } | { errorKey: ... }

deleteAppAction(publicId: string)
  → { ok: true } | { errorKey: 'apps.errors.hasDependents' | 'apps.errors.platformProtected' | 'apps.errors.forbidden' | 'apps.errors.generic' }
```

### Client state in `<AppsTable />`

Single client component owning all interaction state:

- `items, total, page, pageSize` — driven by server-side pagination.
- `query: string` — search input, debounced 300ms, triggers `getApps({ q, page: 1, pageSize })` refetch on change.
- `selectedApp: App | null`
- `viewOpen, editOpen, createOpen, deleteOpen: boolean`
- `useTransition` wraps mutation calls.

### Search behaviour

Debounced (300ms) client-side; each change triggers a server refetch with `q` and resets to page 1. Empty `q` returns the full list. Search input placeholder: `apps.search`.

### Pagination

Three controls: page-size `<select>` (5/10/25/50; default 25), Previous/Next buttons, numeric page buttons (1, 2, 3, …, last; truncates with `…` past 5 pages — same widget the design shows on the list view). Page-size change resets to page 1.

### Copy-to-clipboard

Shared helper `copyToClipboard(text, onCopied)` in `apps/admin/lib/clipboard.ts` (new). Uses `navigator.clipboard.writeText`, swaps icon for 2s. Used on: row sqid cell, View drawer Public ID, View drawer App URL, Edit drawer Public ID.

### Drawers

- **App View drawer** (`app-view-drawer.tsx`): reuses Sheet from `@sassy-auth/ui`. Header shows app name + generic `apps` icon. Body is the Core Details card from `preview_en` — fields: App Name (read-only label), App URL (read-only + copy), Public ID (read-only + copy). Header buttons: Edit (opens Edit drawer), Delete (opens ConfirmDialog) — both hidden when `isPlatform`. Platform-app shows a "Platform" badge in the header instead.
- **App Create drawer** (`app-create-drawer.tsx`): form with two required fields — App Name + App URL. Below the inputs, the "Identifiers Auto-Generated" info box from `create-app` design. Footer: Cancel + Create App buttons. On success, drawer closes and table refreshes via `revalidatePath`.
- **App Edit drawer** (`app-edit-drawer.tsx`): form with App Name + App URL editable; Public ID rendered as read-only with copy button (matches `edit-app` design's "System Identifiers" section, minus the Internal ID field). Footer: Cancel + Save Changes. Disabled when no fields dirty.

### Access denied panel (`access-denied-panel.tsx`)

Reusable, takes no props. Centered card inside the page area (sidebar remains visible). Lock icon, `apps.accessDenied.title`, `apps.accessDenied.body`. Designed to be reusable for future gated pages.

### Visual deviations from designs

The following design elements are intentionally NOT rendered (justified in §2 Not-in-scope):

- App-type icons per row (designs vary by type — language, api, smartphone, terminal). Replaced with a single generic `apps` material-symbol icon in a tinted square. Platform-app uses a distinct style.
- App-type chips in row subtitle (Web / Mobile / M2M / Native).
- All/Web/Mobile/M2M tab filter row.
- "Export Data" button in page header.
- Status chip (Active/Paused) in row and drawer header.
- "Last updated N ago" text in drawer header.
- Authentication Settings card in drawer.
- Recent Activity feed in drawer.
- Callback URLs row in drawer Core Details.
- Internal ID field in Edit drawer.

The "Sorted by: Recently Modified" indicator is dropped (no `updatedAt` to sort by today; default order is `id DESC` — newest first).

## 7. Shared `<ConfirmDialog>` primitive

New file: `packages/ui/src/components/confirm-dialog.tsx`. Built on `@radix-ui/react-alert-dialog`.

### Dependency

`@radix-ui/react-alert-dialog` is **not** currently in `packages/ui/package.json`. Add it (version `^1.1.0` to align with the other `@radix-ui/*` deps already there: `react-dialog@^1.1.0`, `react-dropdown-menu@^2.1.0`, `react-select@^2.1.0`). Bundle cost ≈ 3KB gzipped.

### Public API

```tsx
<ConfirmDialog
  open={open}
  onOpenChange={setOpen}
  title="Delete app"
  description={<>Delete <strong>Customer Portal</strong>? This cannot be undone.</>}
  confirmLabel="Delete"
  cancelLabel="Cancel"
  variant="destructive"
  onConfirm={async () => { ... }}
  pending={isPending}
  error={errorMessage}
/>
```

### Behaviour

- Click-outside does NOT dismiss; only Cancel or Esc closes.
- Confirm button shows pending spinner while `onConfirm`'s promise resolves; disabled during pending.
- If `onConfirm` throws or parent sets `error`, dialog stays open with inline error message; user can retry or cancel.
- On success, dialog closes itself (parent can still control `open`).
- Re-exported from `packages/ui/src/index.ts`.

## 8. Delete wiring (both pages)

### Apps page

- Row menu `Delete` (hidden when `isPlatform`) → opens `<ConfirmDialog>` → `deleteAppAction(selectedApp.publicId)`.
- View drawer `Delete` button (hidden when `isPlatform`) → same dialog, same handler. Drawer closes after delete succeeds.
- Error mapping: `apps.errors.hasDependents` (409), `apps.errors.platformProtected` (403 on platform), `apps.errors.forbidden` (403 lost permission), `apps.errors.generic`.

### Users page (existing component changes)

- **New server action** `deleteUserAction(userId)` in `app/(admin)/users/actions.ts`. Calls existing `deleteUser()` in `lib/api.ts` (which already routes to `DELETE /api/users/:id`). Returns `{ ok } | { errorKey }`. Handles 403 self-delete with `users.confirmDelete.selfDeleteError`.
- **`users-table.tsx`**: row Delete menu item gets `onClick` handler → opens `<ConfirmDialog>`.
- **`user-view-drawer.tsx`**: new destructive Delete button in header (left of Reset Password). Opens same dialog.
- **`Deactivate` / `Activate` menu items**: explicitly NOT wired here — status changes, separate concern.

## 9. i18n keys

### New `apps.*` namespace (both `en.json` and `fr.json`, fully translated)

```
apps.title
apps.subtitle
apps.totalCount                                       // "{count} Total" / "{count} au total"
apps.search
apps.create
apps.accessDenied.{title, body}
apps.columns.{nameAndUrl, sqid, actions}
apps.fields.{name, url, publicId, urlHint}
apps.actions.{view, edit, delete, copy, copied}
apps.drawer.{viewTitle, createTitle, createSubtitle, editTitle, save, saving, cancel, identifiersAutoGenerated}
apps.confirmDelete.{title, body, button}              // body uses {name}
apps.errors.{nameExists, hasDependents, platformProtected, forbidden, generic, urlInvalid, nameRequired}
apps.badges.platform                                  // "Platform" / "Plateforme"
apps.pagination.{pageSize, perPage, previous, next, showing}  // "Showing {from} to {to} of {total} apps"
```

### Additions to `users.*` namespace

```
users.confirmDelete.{title, body, button, selfDeleteError}
users.errors.{forbidden, generic}    // if not already present
```

### French translation source

For Core Details and adjacent labels, reuse strings from `preview_fr/code.html`: "Détails principaux", "URL de l'application", "ID Public (Sqid)", "Copier l'URL", "Copier le Sqid", "Éditer l'application", "Supprimer", "Actif", "Plateforme" (new), etc. For new strings without precedent in `preview_fr` (access denied panel, confirm dialog body, error messages, pagination labels), translate net-new following the formal tone established in existing `fr.json` (e.g., "Vous n'avez pas accès aux données de cette page.").

## 10. Testing

### Unit (Jest)

- `apps.service.spec.ts` — list (pagination + filter), get, create (incl. sqid generation), update, delete, isPlatform protection on PATCH and DELETE, name uniqueness 409, dependent-FK 409.
- `me.controller.spec.ts` — returns union of role-derived + direct permissions; empty when caller has none.
- Self-delete guard test added to `users.service.spec.ts` or `users.controller.spec.ts`.

### Component (React Testing Library)

- `apps-table.test.tsx` — renders rows; debounced search triggers refetch; pagination control updates page; clicking Delete opens ConfirmDialog with app name in body; confirm calls server action with `publicId`; 409 keeps dialog open with error.
- `app-create-drawer.test.tsx` — required-field validation; successful create closes drawer; 409 (name exists) shows inline error keyed by `errorKey`.
- `app-edit-drawer.test.tsx` — Public ID read-only; copy button calls clipboard API; Save disabled when clean; PATCH wires correctly.
- `app-view-drawer.test.tsx` — copy-to-clipboard; Edit button opens edit drawer; Delete hidden on platform app.
- `access-denied-panel.test.tsx` — renders translated title + body.
- `confirm-dialog.test.tsx` (in `packages/ui/src/__tests__/`) — destructive variant; pending state disables confirm; error state keeps dialog open; Esc cancels; click-outside does NOT dismiss.
- `users-table.test.tsx` (update) — row Delete now wires to ConfirmDialog; self-delete error renders.
- `user-view-drawer.test.tsx` (update) — new Delete button hidden when target user is the caller; otherwise opens dialog.

## 11. File map

### New files

**auth-server**
```
apps/auth-server/src/apps/apps.controller.ts
apps/auth-server/src/apps/apps.service.ts
apps/auth-server/src/apps/apps.service.spec.ts
apps/auth-server/src/apps/apps.module.ts
apps/auth-server/src/me/me.controller.ts
apps/auth-server/src/me/me.service.ts
apps/auth-server/src/me/me.controller.spec.ts
apps/auth-server/src/me/me.module.ts
```

**admin**
```
apps/admin/app/(admin)/apps/page.tsx
apps/admin/app/(admin)/apps/actions.ts
apps/admin/components/apps-table.tsx
apps/admin/components/app-view-drawer.tsx
apps/admin/components/app-create-drawer.tsx
apps/admin/components/app-edit-drawer.tsx
apps/admin/components/access-denied-panel.tsx
apps/admin/lib/clipboard.ts
apps/admin/components/__tests__/apps-table.test.tsx
apps/admin/components/__tests__/app-create-drawer.test.tsx
apps/admin/components/__tests__/app-edit-drawer.test.tsx
apps/admin/components/__tests__/app-view-drawer.test.tsx
apps/admin/components/__tests__/access-denied-panel.test.tsx
```

**ui package**
```
packages/ui/src/components/confirm-dialog.tsx
packages/ui/src/__tests__/confirm-dialog.test.tsx
```

**db**
```
packages/db/migrations/<timestamp>_apps_unique_name/migration.sql
```

### Modified files

```
apps/auth-server/src/app.module.ts                    register AppsModule + MeModule
apps/auth-server/src/users/users.service.ts           self-delete guard
apps/auth-server/src/users/users.service.spec.ts      self-delete test
apps/admin/lib/api.ts                                 getApps, createApp, updateApp, deleteApp, getMyPermissions
apps/admin/lib/types.ts                               App, CreateAppPayload, UpdateAppPayload, ListAppsResponse
apps/admin/app/(admin)/users/actions.ts               deleteUserAction
apps/admin/components/users-table.tsx                 wire Delete row action to ConfirmDialog
apps/admin/components/user-view-drawer.tsx            add Delete button + ConfirmDialog wiring
apps/admin/messages/en.json                           apps.*, users.confirmDelete.*, users.errors.*
apps/admin/messages/fr.json                           same, translated
packages/ui/src/index.ts                              export ConfirmDialog
packages/ui/package.json                              add @radix-ui/react-alert-dialog ^1.1.0
packages/db/schema.prisma                             SaApp.name @unique
```

## 12. Rollout

1. **Migration**: `pnpm --filter @sassy-auth/db prisma:migrate:dev --name apps_unique_name`. Safe — only the platform app row exists.
2. **Seed**: no change needed; existing seed already creates a single uniquely-named platform app.
3. **No feature flag**: net-new behind an existing-but-unused sidebar nav item.
4. **Deploy order**: auth-server first (new endpoints), then admin app. If bundled, auth-server starts first.
5. **Bundle impact**: `@radix-ui/react-alert-dialog` ≈ 3KB gzipped added to admin client bundle. Acceptable.

## 13. Risks and notes

- `q` search runs `ILIKE %q%` on `SaApp.name` and `SaApp.url` — no index, but scale is low-hundreds of rows at most. Revisit if app count grows.
- 409 from `DELETE` relies on dependent FKs having `onDelete: Restrict` (Prisma default). Confirmed in schema: `SaOrg.app`, `SaRole.app`, `SaPermission.app` all default behaviour, so a delete of an app with dependents will throw. Map Prisma error code `P2003` to HTTP 409.
- Self-delete also matters for the BetterAuth session — deleting the SaUser cascades the BetterAuth `User` row (FK relation), invalidating the caller's session mid-request. The guard prevents this entirely.
- Search reset behaviour: when a user has paged to e.g. page 4 and types a new query, page resets to 1. Same for page-size change. Both are server refetches.
- View / Edit / Create drawers do NOT persist their open state in the URL. Sharing a link to a specific app is not supported in this scope. Documented as a follow-up if/when needed.

## 14. Out-of-scope follow-ups (parking lot)

- App-type field (`SPA / Web / M2M / Native`) and the filter chips it enables.
- App status field (`active / paused / inactive`) and the status chip.
- Callback URLs collection (requires its own model, validation, UI).
- OIDC/SAML protocol selection and per-protocol settings (token endpoint auth, MFA policy).
- Audit log / activity feed (requires a new `SaAuditEvent` model + write-side instrumentation).
- Sortable / filterable columns beyond the search box.
- CSV / JSON export of the apps list.
- Per-app icon upload.
- Shareable URLs for View/Edit drawer state (`?app=<sqid>`).
- Playwright e2e harness — separate concern, not feature-specific.
