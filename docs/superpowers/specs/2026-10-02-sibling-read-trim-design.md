# Trim sibling-read list responses — design

**Date:** 2026-10-02
**Status:** approved design, no implementation plan yet
**Scope:** `listApps` (`apps.service.ts`), `listOrgs` (`orgs.service.ts`),
`listRoles` (`roles.service.ts`), `listPermissions` (`permissions.service.ts`).
Single-item `getApp`/`getOrg`/`getRole`/`getPermission`, `listUsers`, and the
dead `canPickOrg`/`initialOrgId` wiring in `users-table.tsx` are explicitly
out of scope.

---

## 1. Problem and stance

Four list endpoints deliberately grant read access beyond the resource's own
`*.manage` permission, so another admin page's dropdown/picker can populate
without a cross-page permission grant. This is documented and intentional —
each call site has a comment explaining which sibling page needs the read
(e.g. `apps.service.ts:195-196`: *"Orgs, permissions and roles are scoped
per-app, so those admin pages need to read the apps list to drive their App
filter dropdown."*).

The gap: every sibling reader gets the **same full record** the resource's
own manager sees — not a dropdown-sized projection. Concretely, a
`users-admin` (`platform.users.manage` only), whom the admin UI's nav-gate
fully blocks from ever visiting `/orgs`, can call `GET /api/orgs` directly
and receive the complete, unfiltered org list — every org on the platform,
with `userCount` and app association — identical in shape and scope to what
an `orgs-admin` sees on the real `/orgs` page. For `/api/apps` the exposure
is worse: the full app record includes `redirectUris`, `isConfidential`,
`clientSecretUpdatedAt`, and `passwordPolicyOverride`, none of which any
sibling-page dropdown reads.

This was found via direct API probing (session cookie per platform-admin
role, calling the management API without going through the UI) while
investigating where "API output diverges from UI output."

**Fix:** keep the sibling-read access (it's correct and intentional), but
shrink what it returns to exactly the fields a dropdown/picker consumes.
Full detail stays available only to callers who hold the resource's own
manage permission — unchanged from today.

## 2. Confirmed field usage (inventory)

Every current sibling-read consumer in `apps/admin` was inventoried before
settling the trimmed shapes below — no field is cut that something actually
reads, and the shapes below don't invent new fields: non-manager callers may
now receive fewer per-item fields on the four affected endpoints, but every
item in a response they currently handle correctly is still present with
the fields they already use:

- **Apps**, read from `/roles`, `/permissions`, `/orgs` filter dropdowns and
  the app-select inside the role/permission/org create drawers: every
  consumer reads only `publicId`/`name`; the org-create-drawer additionally
  filters on `isPlatform` to exclude the platform app from the picker.
- **Orgs**, read from `/users` (org lookup backing the create-drawer's org
  select and the view-drawer's `appId` derivation): reads `publicId`, `name`,
  `isPlatform`, and `app.publicId` (the join key used to scope the
  downstream role/permission pickers).
- **Roles**, read from the role picker embedded in the `/users` create and
  view/edit drawers: reads only `publicId`/`name`. The appId scoping is
  already applied server-side (the admin's own server action calls
  `GET /api/roles?appId=...` before this list endpoint is ever reached), so
  the response itself doesn't need to carry `appId`.
- **Permissions**, read from the permission picker embedded in both the
  `/roles` drawers and the `/users` drawers: reads only `publicId`/`name`,
  same appId-already-scoped situation as roles.

## 3. Shapes

| Resource | Full shape (own-manager, unchanged) | Trimmed shape (sibling reader) |
|---|---|---|
| apps | `publicId, name, url, logo, favicon, isPlatform, twoFactorTrustDays, twoFactorPromptEnabled, requireTwoFactor, allowOfflineAccess, redirectUris, isConfidential, clientSecretUpdatedAt, defaultOrgId, defaultRoleId, passwordPolicyOverride` | `{ publicId, name, isPlatform }` |
| orgs | `{ publicId, name, isPlatform, userCount, app: { publicId, name } }` | `{ publicId, name, isPlatform, app: { publicId } }` |
| roles | `{ publicId, name, app: { publicId, name }, permissionCount, userCount }` | `{ publicId, name }` |
| permissions | `{ publicId, name, isSystem, app: { publicId, name }, roleCount, userCount }` | `{ publicId, name }` |

Pagination envelope (`total`, `page`, `pageSize`) is unaffected — only the
shape of each `items[]` entry changes. Search (`q.q`) and `appId` filtering
continue to apply server-side as today, regardless of which shape the
caller ends up receiving.

## 4. Mechanism

Add a non-throwing sibling to the existing `checkPermission` in
`apps/auth-server/src/common/permissions/check-permission.ts`:

```ts
export async function hasPermission(
  betterAuthUserId: string,
  permission: string,
): Promise<boolean>
```

Both functions share one private helper that loads the caller's permission
set from Prisma (today that query is inlined in `checkPermission`; extract
it so there's a single source of the "what permissions does this user hold"
logic). `hasPermission` has no `targetOrgId`/org-scope concept —
org-scoped roles don't enter into "does this caller manage this
resource type," which is purely a platform-permission question for all four
endpoints in scope here.

Each of the 4 `list*` methods, after its existing authorization check
(`checkPermission`/`resolveListScope`/`checkPermissionForApp` — unchanged),
adds one call:

```ts
// orgs.service.ts listOrgs()
const full = await hasPermission(callerBaId, 'platform.orgs.manage');
const items = rows.map((r) => (full ? formatOrg(r) : formatOrgTrimmed(r)));
```

The per-resource "own manage permission" used for this check:

- apps → `platform.apps.manage`
- orgs → `platform.orgs.manage`
- roles → `platform.roles.manage`
- permissions → `platform.permissions.manage`

Each is the single permission that resource's own `create`/`update`/`delete`
already requires (verified directly in each service — e.g.
`roles.service.ts` create/update/delete all check only
`platform.roles.manage`, never `org.roles.manage`, despite `listRoles`'s
broader authorization list including it for the org-scoped-caller branch).
So "full shape" tracks exactly "can this caller actually mutate this
resource," not the broader set of permissions that merely qualify for
list-level read access.

Two Prisma round-trips per request (one for the broad list-authorization
check, one for the full-vs-trim decision) rather than merging them into a
single query. These are low-volume admin-UI list endpoints, not a hot path;
the simplicity of keeping `checkPermission`'s existing contract untouched is
worth the extra query.

## 5. Testing

- `hasPermission.spec.ts` (new, next to `check-permission.spec.ts`): holds
  permission → true; lacks it → false; unknown user → false (mirrors
  `checkPermission`'s `ForbiddenException` case, but returns `false` instead
  of throwing).
- Each of the 4 services' existing `*.service.spec.ts`: add a case per
  resource asserting a sibling-reader caller (e.g. `users-admin` calling
  `listOrgs`) receives the trimmed shape, and the resource's own manager
  still receives the full shape — regression-proofing both directions.

## 6. Out of scope (confirmed)

- `getApp`/`getOrg`/`getRole`/`getPermission` (single-item fetch by id) —
  untouched.
- `listUsers` — no sibling-read pattern reads the user list for a picker, so
  nothing to trim.
- The dead `canPickOrg`/`initialOrgId` props in `apps/admin/components/users-table.tsx`
  (accepted but never rendered as a filter `<select>`) — flagged during
  investigation, not part of this fix.
