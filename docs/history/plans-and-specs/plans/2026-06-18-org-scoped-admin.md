# Org-Scoped Multi-Tenant Administration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users holding only `org.*` permissions log into SassyAuth and self-serve user management for their own organization (including promoting peers to other org admins), without any path to escalate to platform-tier authority.

**Architecture:** Add a single `SaPermission.isSystem` boolean that flips the cross-app rule for `org.*` perms only. Split `platform.permissions.manage` into `platform.roles.manage` + `platform.permissions.manage`. Wire a permission-driven sidebar in the existing admin shell, defaulting per-page filters to the caller's own scope. Add an explicit caller-must-hold guard at the user-assignment service paths to close horizontal escalation within the org tier.

**Tech Stack:** NestJS + Prisma + Postgres + BetterAuth on the API side, Next.js (App Router) + shadcn/ui on the admin side, Jest for unit/integration tests, Playwright for e2e (admin-e2e).

**Spec:** `docs/superpowers/specs/2026-06-18-org-scoped-admin-design.md`

---

## File Map

**Schema & migrations:**
- Modify: `packages/db/schema.prisma` (add `isSystem` field)
- Create: `packages/db/migrations/20260618220000_add_is_system_to_permissions/migration.sql`
- Create: `packages/db/migrations/20260618220100_seed_role_perms_and_drop_org_permissions_manage/migration.sql`

**Auth/resolver core:**
- Modify: `apps/auth-server/src/common/permissions/resolve-app-scoped-ids.ts`
- Modify: `apps/auth-server/src/common/permissions/resolve-app-scoped-ids.spec.ts`
- Create: `apps/auth-server/src/common/permissions/check-permission-for-app.ts`
- Create: `apps/auth-server/src/common/permissions/check-permission-for-app.spec.ts`
- Create: `apps/auth-server/src/common/permissions/assert-caller-can-grant-system-perms.ts`
- Create: `apps/auth-server/src/common/permissions/assert-caller-can-grant-system-perms.spec.ts`

**Service updates:**
- Modify: `apps/auth-server/src/permissions/permissions.service.ts`
- Modify: `apps/auth-server/src/permissions/permissions.service.spec.ts`
- Modify: `apps/auth-server/src/roles/roles.service.ts`
- Modify: `apps/auth-server/src/roles/roles.service.spec.ts`
- Modify: `apps/auth-server/src/users/users.service.ts`
- Modify: `apps/auth-server/src/users/users.service.spec.ts`

**`/me` endpoint:**
- Modify: `apps/auth-server/src/me/me.service.ts`
- Modify: `apps/auth-server/src/me/me.controller.ts`
- Modify: `apps/auth-server/src/me/me.service.spec.ts`

**Seed & matrix:**
- Modify: `apps/auth-server/src/seed/seed.ts`
- Create: `apps/auth-server/src/seed/demo-multitenant.ts`
- Modify: `apps/auth-server/test/matrix/permissions-matrix.ts`

**Admin UI:**
- Modify: `apps/admin/lib/types.ts`
- Modify: `apps/admin/lib/api.ts`
- Modify: `apps/admin/app/(admin)/layout.tsx`
- Modify: `apps/admin/components/admin-shell.tsx`
- Create: `apps/admin/components/__tests__/admin-shell.test.tsx`
- Modify: `apps/admin/app/(admin)/users/page.tsx`
- Modify: `apps/admin/components/users-table.tsx`
- Modify: `apps/admin/app/(admin)/roles/page.tsx`
- Modify: `apps/admin/components/roles-table.tsx`
- Modify: `apps/admin/components/permissions-table.tsx`
- Modify: `apps/admin/components/permission-view-drawer.tsx`
- Modify: `apps/admin/components/__tests__/permissions-table.test.tsx`
- Modify: `apps/admin/components/__tests__/permission-view-drawer.test.tsx`

**Scenario specs:**
- Create: `apps/auth-server/test/scenarios/multitenant-visibility.spec.ts`
- Create: `apps/auth-server/test/scenarios/multitenant-grant-ceiling.spec.ts`
- Create: `apps/auth-server/test/scenarios/factories.ts` (sign-in + path helpers, mirrors matrix harness)
- Create: `apps/auth-server/test/migrations/2026-06-18-org-roles-manage.spec.ts`

**E2E:**
- Modify: `apps/admin-e2e/lib/admins.ts`
- Create: `apps/admin-e2e/tests/multitenant-promotion.spec.ts`

---

## Task 1: Schema — add `SaPermission.isSystem`

**Files:**
- Modify: `packages/db/schema.prisma`
- Create: `packages/db/migrations/20260618220000_add_is_system_to_permissions/migration.sql`

- [ ] **Step 1: Edit schema.prisma**

In `packages/db/schema.prisma`, locate the `SaPermission` model (around line 129) and add the `isSystem` field:

```prisma
model SaPermission {
  id       Int                @id @default(autoincrement())
  publicId String             @unique
  name     String             @unique
  appId    Int
  isSystem Boolean            @default(false)
  app      SaApp              @relation(fields: [appId], references: [id])
  roles    SaRolePermission[]
  users    SaUserPermission[]

  @@index([appId])
}
```

- [ ] **Step 2: Create the migration directory and SQL**

```bash
mkdir -p packages/db/migrations/20260618220000_add_is_system_to_permissions
```

Create `packages/db/migrations/20260618220000_add_is_system_to_permissions/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "SaPermission" ADD COLUMN "isSystem" BOOLEAN NOT NULL DEFAULT false;
```

- [ ] **Step 3: Regenerate the Prisma client and verify**

Run:

```bash
pnpm --filter @sassy-auth/db prisma generate
```

Expected: "Generated Prisma Client" message, no errors.

Then run:

```bash
pnpm --filter @sassy-auth/db prisma migrate dev --create-only --name add_is_system_to_permissions
```

If Prisma says "Migration already exists" because we hand-wrote the SQL, that's fine — skip this step. The hand-written SQL becomes authoritative once `prisma migrate deploy` runs.

- [ ] **Step 4: Apply the migration locally**

```bash
pnpm --filter @sassy-auth/db prisma migrate deploy
```

Expected: "1 migration successfully applied" mentioning `add_is_system_to_permissions`.

- [ ] **Step 5: Verify column exists**

```bash
psql "$DATABASE_URL" -c "\d \"SaPermission\""
```

Expected: column listing includes `isSystem | boolean | not null default false`.

- [ ] **Step 6: Commit**

```bash
git add packages/db/schema.prisma packages/db/migrations/20260618220000_add_is_system_to_permissions/
git commit -m "feat(db): add SaPermission.isSystem column"
```

---

## Task 2: Resolver — `resolvePermissionIdsForApp` honors `isSystem`

**Files:**
- Modify: `apps/auth-server/src/common/permissions/resolve-app-scoped-ids.ts`
- Modify: `apps/auth-server/src/common/permissions/resolve-app-scoped-ids.spec.ts`

- [ ] **Step 1: Write failing tests for the new behavior**

Open `apps/auth-server/src/common/permissions/resolve-app-scoped-ids.spec.ts` and add three new cases inside the existing `describe('resolvePermissionIdsForApp', …)` block (after the BadRequestException test):

```ts
  it('lets an isSystem permission through even when its appId differs', async () => {
    mockPrisma.saPermission.findMany.mockResolvedValue([
      { id: 10, publicId: 'pA', appId: 1, isSystem: false },
      { id: 99, publicId: 'pSys', appId: 7, isSystem: true },   // belongs to a different app, but isSystem
    ]);
    const ids = await resolvePermissionIdsForApp(1, ['pA', 'pSys']);
    expect(ids).toEqual([10, 99]);
  });

  it('still rejects a non-system cross-app perm in a mixed list', async () => {
    mockPrisma.saPermission.findMany.mockResolvedValue([
      { id: 99, publicId: 'pSys', appId: 7, isSystem: true },
      { id: 12, publicId: 'pBad', appId: 2, isSystem: false },  // cross-app and non-system
    ]);
    await expect(
      resolvePermissionIdsForApp(1, ['pSys', 'pBad']),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('selects isSystem in the projection', async () => {
    mockPrisma.saPermission.findMany.mockResolvedValue([
      { id: 10, publicId: 'pA', appId: 1, isSystem: false },
    ]);
    await resolvePermissionIdsForApp(1, ['pA']);
    const call = mockPrisma.saPermission.findMany.mock.calls[0][0] as {
      select: Record<string, boolean>;
    };
    expect(call.select.isSystem).toBe(true);
  });
```

The two existing tests (`returns numeric ids …` and `throws BadRequestException …`) must keep passing. Their mock objects don't include `isSystem`; the resolver code below treats a missing `isSystem` as falsy, so they continue to work.

- [ ] **Step 2: Run the new tests to verify they fail**

```bash
pnpm --filter @sassy-auth/auth-server test src/common/permissions/resolve-app-scoped-ids.spec.ts
```

Expected: 3 new tests fail (the resolver doesn't read `isSystem` yet).

- [ ] **Step 3: Update the resolver**

In `apps/auth-server/src/common/permissions/resolve-app-scoped-ids.ts`, replace the body of `resolvePermissionIdsForApp`:

```ts
export async function resolvePermissionIdsForApp(
  appId: number,
  permissionPublicIds: string[],
): Promise<number[]> {
  if (permissionPublicIds.length === 0) return [];
  const perms = (await prisma.saPermission.findMany({
    where: { publicId: { in: permissionPublicIds } },
    select: { id: true, publicId: true, appId: true, isSystem: true },
  })) as Array<{ id: number; publicId: string; appId: number; isSystem: boolean }>;
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

`resolveRoleIdsForApp` is **not** touched — roles remain strictly app-scoped.

- [ ] **Step 4: Re-run the tests to verify all pass**

```bash
pnpm --filter @sassy-auth/auth-server test src/common/permissions/resolve-app-scoped-ids.spec.ts
```

Expected: all tests pass (original 8 plus 3 new).

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/common/permissions/resolve-app-scoped-ids.ts apps/auth-server/src/common/permissions/resolve-app-scoped-ids.spec.ts
git commit -m "feat(perms): resolvePermissionIdsForApp honors isSystem for cross-app exception"
```

---

## Task 3: Helper — `checkPermissionForApp`

**Files:**
- Create: `apps/auth-server/src/common/permissions/check-permission-for-app.ts`
- Create: `apps/auth-server/src/common/permissions/check-permission-for-app.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/auth-server/src/common/permissions/check-permission-for-app.spec.ts`:

```ts
import { ForbiddenException } from '@nestjs/common';
import { checkPermissionForApp } from './check-permission-for-app';

jest.mock('@sassy-auth/db', () => ({
  prisma: {
    saUser: { findUnique: jest.fn() },
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockPrisma = require('@sassy-auth/db').prisma as {
  saUser: { findUnique: jest.Mock };
};

const saUserWith = (permNames: string[]) => ({
  orgId: 1,
  roles: [],
  directPermissions: permNames.map((name) => ({ permission: { name } })),
});

describe('checkPermissionForApp', () => {
  beforeEach(() => jest.clearAllMocks());

  it('throws Forbidden when saUser not found', async () => {
    mockPrisma.saUser.findUnique.mockResolvedValue(null);
    await expect(
      checkPermissionForApp('ba-1', 'platform.roles.manage'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('throws Forbidden when caller has neither required perm', async () => {
    mockPrisma.saUser.findUnique.mockResolvedValue(saUserWith([]));
    await expect(
      checkPermissionForApp('ba-1', ['platform.roles.manage', 'org.roles.manage']),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('platform.* bypasses the app-scope check', async () => {
    mockPrisma.saUser.findUnique.mockResolvedValue(saUserWith(['platform.roles.manage']));
    await expect(
      checkPermissionForApp(
        'ba-1',
        ['platform.roles.manage', 'org.roles.manage'],
        { targetAppId: 99, callerAppId: 1 },
      ),
    ).resolves.toBeUndefined();
  });

  it('org.* allowed when callerAppId === targetAppId', async () => {
    mockPrisma.saUser.findUnique.mockResolvedValue(saUserWith(['org.roles.manage']));
    await expect(
      checkPermissionForApp(
        'ba-1',
        ['platform.roles.manage', 'org.roles.manage'],
        { targetAppId: 7, callerAppId: 7 },
      ),
    ).resolves.toBeUndefined();
  });

  it('org.* rejected when callerAppId !== targetAppId', async () => {
    mockPrisma.saUser.findUnique.mockResolvedValue(saUserWith(['org.roles.manage']));
    await expect(
      checkPermissionForApp(
        'ba-1',
        ['platform.roles.manage', 'org.roles.manage'],
        { targetAppId: 7, callerAppId: 8 },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('org.* rejected with the cross-app sentinel (-1)', async () => {
    mockPrisma.saUser.findUnique.mockResolvedValue(saUserWith(['org.roles.manage']));
    await expect(
      checkPermissionForApp(
        'ba-1',
        ['platform.roles.manage', 'org.roles.manage'],
        { targetAppId: -1, callerAppId: 7 },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('org.* with no targetAppId is allowed (unscoped read)', async () => {
    mockPrisma.saUser.findUnique.mockResolvedValue(saUserWith(['org.roles.manage']));
    await expect(
      checkPermissionForApp('ba-1', ['platform.roles.manage', 'org.roles.manage']),
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @sassy-auth/auth-server test src/common/permissions/check-permission-for-app.spec.ts
```

Expected: all tests fail with "Cannot find module './check-permission-for-app'".

- [ ] **Step 3: Implement the helper**

Create `apps/auth-server/src/common/permissions/check-permission-for-app.ts`:

```ts
import { ForbiddenException } from '@nestjs/common';
import { prisma } from '@sassy-auth/db';

/**
 * Sibling of `checkPermission` for routes whose target resource is
 * app-scoped (roles) rather than org-scoped (users). Pass
 * `callerAppId` so the helper can compare it against `targetAppId`.
 *
 * Behavior mirrors `checkPermission`: any `platform.*` permission the
 * caller holds bypasses the app-scope check; non-platform permissions
 * are allowed only when `callerAppId === targetAppId`. Pass
 * `targetAppId: -1` to force cross-app callers to require a `platform.*`
 * permission.
 */
export async function checkPermissionForApp(
  betterAuthUserId: string,
  required: string | string[],
  options: { targetAppId?: number; callerAppId?: number } = {},
): Promise<void> {
  const saUser = await prisma.saUser.findUnique({
    where: { betterAuthUserId },
    include: {
      roles: {
        include: {
          role: { include: { permissions: { include: { permission: true } } } },
        },
      },
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

  // platform.* bypasses the app-scope check.
  for (const r of requiredList) {
    if (r.startsWith('platform.') && perms.has(r)) return;
  }

  // org.* allowed only when the caller's app matches the target app.
  for (const r of requiredList) {
    if (r.startsWith('platform.')) continue;
    if (!perms.has(r)) continue;
    if (options.targetAppId === undefined) return;
    if (options.callerAppId === options.targetAppId) return;
  }

  throw new ForbiddenException();
}
```

- [ ] **Step 4: Re-run tests to verify all pass**

```bash
pnpm --filter @sassy-auth/auth-server test src/common/permissions/check-permission-for-app.spec.ts
```

Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/common/permissions/check-permission-for-app.ts apps/auth-server/src/common/permissions/check-permission-for-app.spec.ts
git commit -m "feat(perms): add checkPermissionForApp helper for app-scoped routes"
```

---

## Task 4: Helper — `assertCallerCanGrantSystemPerms`

**Files:**
- Create: `apps/auth-server/src/common/permissions/assert-caller-can-grant-system-perms.ts`
- Create: `apps/auth-server/src/common/permissions/assert-caller-can-grant-system-perms.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/auth-server/src/common/permissions/assert-caller-can-grant-system-perms.spec.ts`:

```ts
import { ForbiddenException } from '@nestjs/common';
import { assertCallerCanGrantSystemPerms } from './assert-caller-can-grant-system-perms';

jest.mock('@sassy-auth/db', () => ({
  prisma: {
    saUser: { findUnique: jest.fn() },
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockPrisma = require('@sassy-auth/db').prisma as {
  saUser: { findUnique: jest.Mock };
};

const callerWith = (names: string[]) => ({
  roles: [],
  directPermissions: names.map((name) => ({ permission: { name } })),
});

describe('assertCallerCanGrantSystemPerms', () => {
  beforeEach(() => jest.clearAllMocks());

  it('is a no-op when the system-perm list is empty', async () => {
    await expect(assertCallerCanGrantSystemPerms('ba-1', [])).resolves.toBeUndefined();
    expect(mockPrisma.saUser.findUnique).not.toHaveBeenCalled();
  });

  it('allows when caller holds platform.users.manage (platform-tier bypass)', async () => {
    mockPrisma.saUser.findUnique.mockResolvedValue(callerWith(['platform.users.manage']));
    await expect(
      assertCallerCanGrantSystemPerms('ba-1', ['org.users.manage', 'org.roles.manage']),
    ).resolves.toBeUndefined();
  });

  it('allows when caller holds every requested system perm directly', async () => {
    mockPrisma.saUser.findUnique.mockResolvedValue(callerWith(['org.users.manage']));
    await expect(
      assertCallerCanGrantSystemPerms('ba-1', ['org.users.manage']),
    ).resolves.toBeUndefined();
  });

  it('rejects when caller is missing one of the requested system perms', async () => {
    mockPrisma.saUser.findUnique.mockResolvedValue(callerWith(['org.users.manage']));
    await expect(
      assertCallerCanGrantSystemPerms('ba-1', ['org.users.manage', 'org.roles.manage']),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('error message names the missing perms', async () => {
    mockPrisma.saUser.findUnique.mockResolvedValue(callerWith([]));
    await expect(
      assertCallerCanGrantSystemPerms('ba-1', ['org.roles.manage']),
    ).rejects.toThrow(/org\.roles\.manage/);
  });

  it('rejects when saUser not found', async () => {
    mockPrisma.saUser.findUnique.mockResolvedValue(null);
    await expect(
      assertCallerCanGrantSystemPerms('ba-1', ['org.users.manage']),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @sassy-auth/auth-server test src/common/permissions/assert-caller-can-grant-system-perms.spec.ts
```

Expected: all fail with "Cannot find module …".

- [ ] **Step 3: Implement the helper**

Create `apps/auth-server/src/common/permissions/assert-caller-can-grant-system-perms.ts`:

```ts
import { ForbiddenException } from '@nestjs/common';
import { prisma } from '@sassy-auth/db';

/**
 * Closes horizontal escalation within the org.* tier. A non-platform
 * caller can only grant a system perm `X` to another user if they hold
 * `X` themselves. Holders of `platform.users.manage` bypass — that
 * permission is the platform-tier trust signal for user-assignment
 * surfaces.
 *
 * `systemPermNames` should already be filtered to perms whose
 * `isSystem === true`. The service layer is responsible for
 * extracting that list from the role/direct-perm assignment about
 * to be made.
 */
export async function assertCallerCanGrantSystemPerms(
  betterAuthUserId: string,
  systemPermNames: readonly string[],
): Promise<void> {
  if (systemPermNames.length === 0) return;

  const saUser = await prisma.saUser.findUnique({
    where: { betterAuthUserId },
    include: {
      roles: {
        include: {
          role: { include: { permissions: { include: { permission: true } } } },
        },
      },
      directPermissions: { include: { permission: true } },
    },
  });
  if (!saUser) throw new ForbiddenException();

  const callerPerms = new Set<string>();
  saUser.roles.forEach((ur) =>
    ur.role.permissions.forEach((rp) => callerPerms.add(rp.permission.name)),
  );
  saUser.directPermissions.forEach((up) => callerPerms.add(up.permission.name));

  // Platform-tier bypass.
  if (callerPerms.has('platform.users.manage')) return;

  const missing = systemPermNames.filter((n) => !callerPerms.has(n));
  if (missing.length > 0) {
    throw new ForbiddenException(
      `Cannot grant system permission(s) you do not hold: ${missing.join(', ')}`,
    );
  }
}
```

- [ ] **Step 4: Run the tests to verify all pass**

```bash
pnpm --filter @sassy-auth/auth-server test src/common/permissions/assert-caller-can-grant-system-perms.spec.ts
```

Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/common/permissions/assert-caller-can-grant-system-perms.ts apps/auth-server/src/common/permissions/assert-caller-can-grant-system-perms.spec.ts
git commit -m "feat(perms): add assertCallerCanGrantSystemPerms escalation guard"
```

---

## Task 5: Permissions service — immutability covers `isSystem`

**Files:**
- Modify: `apps/auth-server/src/permissions/permissions.service.ts`
- Modify: `apps/auth-server/src/permissions/permissions.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

Open `apps/auth-server/src/permissions/permissions.service.spec.ts`. Find the existing block that asserts `platform.*` cannot be updated/deleted (it's near `it('rejects when name starts with platform. (Forbidden)', …)` and `it('rejects platform.* with Forbidden', …)`). Add two new tests immediately after each respective block:

For `updatePermission`:

```ts
    it('rejects when isSystem is true (Forbidden)', async () => {
      mocks.saPermission.findUnique.mockResolvedValue({
        id: 1, publicId: 'sq_p1', name: 'org.users.manage', appId: 1, isSystem: true,
      });
      await expect(
        makeService().updatePermission('ba-caller', 'sq_p1', { name: 'org.users.manage.x' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
```

For `deletePermission`:

```ts
    it('rejects deleting isSystem with Forbidden', async () => {
      mocks.saPermission.findUnique.mockResolvedValue({
        id: 1, publicId: 'sq_p1', name: 'org.users.manage', appId: 1, isSystem: true,
      });
      await expect(
        makeService().deletePermission('ba-caller', 'sq_p1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
```

If existing tests' mock fixtures don't include `isSystem`, leave them as-is — the new logic treats missing `isSystem` as `false`, so the existing pass-through paths still work. If the type-checker complains, add `isSystem: false` to those fixtures.

- [ ] **Step 2: Run the new tests to verify they fail**

```bash
pnpm --filter @sassy-auth/auth-server test src/permissions/permissions.service.spec.ts
```

Expected: the two new tests fail (the service only checks the name prefix today).

- [ ] **Step 3: Update the service**

In `apps/auth-server/src/permissions/permissions.service.ts`, locate `updatePermission` (around line 149) and `deletePermission` (around line 180). Change the immutability check in both:

```ts
// updatePermission (around line 156)
if (isPlatform(existing.name) || existing.isSystem) {
  throw new ForbiddenException('Platform-system permissions cannot be modified');
}

// deletePermission (around line 184)
if (isPlatform(existing.name) || existing.isSystem) {
  throw new ForbiddenException('Platform-system permissions cannot be modified');
}
```

The error message string stays the same. `findUnique` already returns `isSystem` because the Prisma client includes all scalar fields by default.

- [ ] **Step 4: Run the tests to verify all pass**

```bash
pnpm --filter @sassy-auth/auth-server test src/permissions/permissions.service.spec.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/permissions/permissions.service.ts apps/auth-server/src/permissions/permissions.service.spec.ts
git commit -m "feat(perms): extend immutability check to isSystem permissions"
```

---

## Task 6: Permissions service — expose `isSystem` in API responses

**Files:**
- Modify: `apps/auth-server/src/permissions/permissions.service.ts`
- Modify: `apps/auth-server/src/permissions/permissions.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

In `apps/auth-server/src/permissions/permissions.service.spec.ts`, add a test inside the `listPermissions` describe block:

```ts
    it('includes isSystem in each item', async () => {
      mocks.saPermission.findMany.mockResolvedValue([
        { id: 1, publicId: 'sq_p1', name: 'org.users.manage', isSystem: true, app: { publicId: 'sq_a1', name: 'SassyAuth' } },
        { id: 2, publicId: 'sq_p2', name: 'rs.properties.read', isSystem: false, app: { publicId: 'sq_a2', name: 'rs' } },
      ]);
      mocks.saPermission.count.mockResolvedValue(2);
      mocks.saRolePermission.groupBy.mockResolvedValue([]);
      mocks.saUserPermission.groupBy.mockResolvedValue([]);
      const result = await makeService().listPermissions('ba-caller', {});
      expect(result.items[0].isSystem).toBe(true);
      expect(result.items[1].isSystem).toBe(false);
    });
```

If `getPermission` has a similar shape test, mirror the assertion: the returned object should include `isSystem`.

- [ ] **Step 2: Run to verify the new test fails**

```bash
pnpm --filter @sassy-auth/auth-server test src/permissions/permissions.service.spec.ts
```

Expected: the new test fails (the items returned don't carry `isSystem`).

- [ ] **Step 3: Update the service**

In `apps/auth-server/src/permissions/permissions.service.ts`:

In `listPermissions`, update the `rows.map(...)` block (around line 79) to include `isSystem`:

```ts
return {
  items: rows.map((r) => {
    const row = r as { id: number; publicId: string; name: string; isSystem: boolean; app: { publicId: string; name: string } };
    return {
      publicId: row.publicId, name: row.name, isSystem: row.isSystem,
      app: { publicId: row.app.publicId, name: row.app.name },
      roleCount: roleMap.get(row.id) ?? 0,
      userCount: userMap.get(row.id) ?? 0,
    };
  }),
  total, page, pageSize,
};
```

In `getPermission`, extend the row type cast and return object:

```ts
const row = p as unknown as {
  id: number; publicId: string; name: string; isSystem: boolean;
  app: { publicId: string; name: string };
  roles: Array<{ role: { publicId: string; name: string; app: { name: string } } }>;
  users: Array<{ user: { publicId: string; firstName: string; lastName: string; betterAuthUser: { email: string } } }>;
};
// ...
return {
  publicId: row.publicId, name: row.name, isSystem: row.isSystem,
  app: { publicId: row.app.publicId, name: row.app.name },
  roleCount, userCount,
  roles: row.roles.map(/* unchanged */),
  users: row.users.map(/* unchanged */),
};
```

In `createPermission` and `updatePermission`, add `isSystem` to the returned object the same way. (For create, default to `row.isSystem ?? false`.)

- [ ] **Step 4: Run the tests to verify all pass**

```bash
pnpm --filter @sassy-auth/auth-server test src/permissions/permissions.service.spec.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/permissions/permissions.service.ts apps/auth-server/src/permissions/permissions.service.spec.ts
git commit -m "feat(perms): expose isSystem in /api/permissions responses"
```

---

## Task 7: Roles service — switch gates and add app-scoped read

**Files:**
- Modify: `apps/auth-server/src/roles/roles.service.ts`
- Modify: `apps/auth-server/src/roles/roles.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

In `apps/auth-server/src/roles/roles.service.spec.ts`, add or modify tests so the gate names reflect the new design. Replace any existing references to `platform.permissions.manage` (in role CRUD tests) and `org.permissions.manage` (in role read tests) with the new names, and add a new test that proves the app-scoped read filter:

```ts
  it('listRoles uses platform.roles.manage / org.roles.manage gates', async () => {
    // Configure mocks so checkPermissionForApp is called with the expected list.
    // Use a spy on the helper if it's a top-level import; otherwise verify by
    // letting an org.roles.manage holder with matching app pass and a mismatched
    // one fail.
  });

  it('createRole gates on platform.roles.manage', async () => {
    // expect(checkPermission).toHaveBeenCalledWith('ba-caller', 'platform.roles.manage');
  });
```

Use the same mocking patterns the existing roles.service.spec uses for `checkPermission`. The spec file's structure tells you whether to mock the module-level import or expect a thrown ForbiddenException from a configured caller.

- [ ] **Step 2: Run to verify tests fail**

```bash
pnpm --filter @sassy-auth/auth-server test src/roles/roles.service.spec.ts
```

Expected: the gate-name assertions fail.

- [ ] **Step 3: Update the service**

In `apps/auth-server/src/roles/roles.service.ts`:

Import the new helper:

```ts
import { checkPermissionForApp } from '../common/permissions/check-permission-for-app';
```

Update `listRoles` (around line 36):

```ts
async listRoles(callerBaId: string, q: ListRolesQueryDto = {}) {
  // Resolve caller's org's app id up-front so we can pass an app-scope
  // sentinel when no appId filter is supplied. Mirrors the targetOrgId
  // sentinel pattern users.service.ts uses for cross-tenant guards.
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

  // ...rest of the body is unchanged: paginate, count, group, return.
}
```

(`ForbiddenException` and `NotFoundException` are already imported from `@nestjs/common` in this file.)

Update `getRole` (around line 78):

```ts
async getRole(callerBaId: string, publicId: string) {
  const r = await prisma.saRole.findUnique({ where: { publicId }, include: ROLE_DETAIL_INCLUDE });
  if (!r) throw new NotFoundException();
  const row = r as unknown as {
    id: number; appId: number; publicId: string; name: string;
    app: { publicId: string; name: string };
    permissions: Array<{ permission: { publicId: string; name: string } }>;
  };

  const caller = await prisma.saUser.findUnique({
    where: { betterAuthUserId: callerBaId },
    select: { org: { select: { appId: true } } },
  });
  if (!caller) throw new ForbiddenException();

  await checkPermissionForApp(
    callerBaId,
    ['platform.roles.manage', 'org.roles.manage'],
    { targetAppId: row.appId, callerAppId: caller.org.appId },
  );

  const userCount = await prisma.saUserRole.count({ where: { roleId: row.id } });
  return {
    publicId: row.publicId, name: row.name,
    app: { publicId: row.app.publicId, name: row.app.name },
    permissionCount: row.permissions.length, userCount,
    permissions: row.permissions.map((rp) => ({ publicId: rp.permission.publicId, name: rp.permission.name })),
  };
}
```

Update `createRole`, `updateRole`, `deleteRole` (around lines 97, 139, 186) — change the gate from `platform.permissions.manage` to `platform.roles.manage`:

```ts
await checkPermission(callerBaId, 'platform.roles.manage');
```

(Three occurrences. No other logic in these methods needs to change.)

- [ ] **Step 4: Run the tests to verify all pass**

```bash
pnpm --filter @sassy-auth/auth-server test src/roles/roles.service.spec.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/roles/roles.service.ts apps/auth-server/src/roles/roles.service.spec.ts
git commit -m "feat(roles): switch gates to platform.roles.manage / org.roles.manage and scope reads by app"
```

---

## Task 8: Users service — wire the escalation guard

**Files:**
- Modify: `apps/auth-server/src/users/users.service.ts`
- Modify: `apps/auth-server/src/users/users.service.spec.ts`

This task adds the `assertCallerCanGrantSystemPerms` guard to four assignment paths. The pattern is identical at each call site: after `checkPermission` resolves but before/around the resolver call, load the perms about to be granted, filter to `isSystem`, and assert the caller can grant them.

- [ ] **Step 1: Write the failing tests for `setUserDirectPermissions`**

In `apps/auth-server/src/users/users.service.spec.ts`, add a new describe block:

```ts
describe('setUserDirectPermissions escalation guard', () => {
  it('allows an org.users.manage holder to grant org.users.manage to a peer in their own org', async () => {
    // Caller: org.users.manage only, orgId=7
    // Target: a peer in orgId=7
    // Perm:   org.users.manage (isSystem=true)
    // EXPECT: resolves, SaUserPermission created
  });

  it('rejects an org.users.manage holder trying to grant org.roles.manage', async () => {
    // Caller: org.users.manage only
    // EXPECT: ForbiddenException, message contains "org.roles.manage"
  });

  it('rejects an org.users.manage holder trying to grant platform.users.manage', async () => {
    // EXPECT: BadRequestException ("different app") — fails at resolver
  });

  it('allows platform.users.manage holder to grant any org.* to any tenant user', async () => {
    // EXPECT: resolves
  });
});
```

Fill in the mock fixtures using the same pattern existing `users.service.spec.ts` tests use (mock `@sassy-auth/db` and stub `saUser.findUnique`, `saPermission.findMany`, `saUserPermission.deleteMany`/`createMany`).

- [ ] **Step 2: Write the failing tests for `setUserRoles`**

In the same spec file, add:

```ts
describe('setUserRoles escalation guard', () => {
  it('rejects assigning a role containing org.roles.manage when caller lacks it', async () => {
    // Caller: org.users.manage only
    // Role:   contains org.roles.manage (isSystem=true)
    // EXPECT: ForbiddenException
  });

  it('allows assigning a role containing only non-system perms', async () => {
    // EXPECT: resolves
  });
});
```

- [ ] **Step 3: Run the new tests to verify they fail**

```bash
pnpm --filter @sassy-auth/auth-server test src/users/users.service.spec.ts -t 'escalation guard'
```

Expected: all new tests fail.

- [ ] **Step 4: Wire the guard into `setUserDirectPermissions`**

In `apps/auth-server/src/users/users.service.ts`:

Add the import:

```ts
import { assertCallerCanGrantSystemPerms } from '../common/permissions/assert-caller-can-grant-system-perms';
```

Update `setUserDirectPermissions` (around line 412). Insert the guard between the existing `checkPermission` call and the `resolvePermissionIdsForApp` call:

```ts
async setUserDirectPermissions(
  callerBaId: string,
  userPublicId: string,
  permissionIds: string[],
): Promise<void> {
  const user = await prisma.saUser.findUnique({ where: { publicId: userPublicId } });
  if (!user) throw new NotFoundException('User not found');
  if (user.betterAuthUserId === callerBaId) {
    throw new ForbiddenException('You cannot edit your own access');
  }
  await checkPermission(
    callerBaId,
    ['platform.users.manage', 'org.users.manage'],
    { targetOrgId: user.orgId },
  );

  const org = await prisma.saOrg.findUnique({ where: { id: user.orgId } });
  if (!org) throw new NotFoundException('User org not found');

  // Load the permissions about to be granted so we can filter the
  // system ones and apply the escalation guard before resolution.
  const requestedPerms = permissionIds.length === 0
    ? []
    : await prisma.saPermission.findMany({
        where: { publicId: { in: permissionIds } },
        select: { name: true, isSystem: true },
      });
  const systemPermNames = requestedPerms
    .filter((p) => p.isSystem)
    .map((p) => p.name);
  await assertCallerCanGrantSystemPerms(callerBaId, systemPermNames);

  const numericIds = await resolvePermissionIdsForApp(org.appId, permissionIds);

  await prisma.$transaction(async (tx) => {
    await tx.saUserPermission.deleteMany({ where: { userId: user.id } });
    if (numericIds.length > 0) {
      await tx.saUserPermission.createMany({
        data: numericIds.map((permissionId) => ({ userId: user.id, permissionId })),
      });
    }
  });

  this.logger.getWinstonLogger().info('User direct permissions set', {
    context: 'UsersService',
    userId: userPublicId,
    permissionCount: numericIds.length,
  });
}
```

- [ ] **Step 5: Wire the guard into `setUserRoles`**

In the same file, update `setUserRoles` (around line 345). Insert the guard after `checkPermission` and before `resolveRoleIdsForApp`:

```ts
async setUserRoles(
  callerBaId: string,
  userPublicId: string,
  roleIds: string[],
): Promise<void> {
  const user = await prisma.saUser.findUnique({ where: { publicId: userPublicId } });
  if (!user) throw new NotFoundException('User not found');
  if (user.betterAuthUserId === callerBaId) {
    throw new ForbiddenException('You cannot edit your own access');
  }
  await checkPermission(
    callerBaId,
    ['platform.users.manage', 'org.users.manage'],
    { targetOrgId: user.orgId },
  );

  const org = await prisma.saOrg.findUnique({ where: { id: user.orgId } });
  if (!org) throw new NotFoundException('User org not found');

  // Apply escalation guard: collect every isSystem perm in every role
  // about to be assigned, then assert the caller can grant them.
  if (roleIds.length > 0) {
    const rolesWithPerms = await prisma.saRole.findMany({
      where: { publicId: { in: roleIds } },
      select: {
        permissions: {
          select: { permission: { select: { name: true, isSystem: true } } },
        },
      },
    });
    const systemPermNames = Array.from(new Set(
      rolesWithPerms.flatMap((r) =>
        r.permissions.filter((rp) => rp.permission.isSystem).map((rp) => rp.permission.name),
      ),
    ));
    await assertCallerCanGrantSystemPerms(callerBaId, systemPermNames);
  }

  const numericIds = await resolveRoleIdsForApp(org.appId, roleIds);

  await prisma.$transaction(async (tx) => {
    await tx.saUserRole.deleteMany({ where: { userId: user.id } });
    if (numericIds.length > 0) {
      await tx.saUserRole.createMany({
        data: numericIds.map((roleId) => ({ userId: user.id, roleId })),
      });
    }
  });

  this.logger.getWinstonLogger().info('User roles set', {
    context: 'UsersService',
    userId: userPublicId,
    roleCount: numericIds.length,
  });
}
```

- [ ] **Step 6: Wire the guard into `assignRole`**

Update `assignRole` (around line 291). Insert after the role lookup, before the `saUserRole.create` call:

```ts
async assignRole(callerBaId: string, userPublicId: string, dto: AssignRoleDto): Promise<void> {
  const user = await prisma.saUser.findUnique({ where: { publicId: userPublicId } });
  if (!user) throw new NotFoundException('User not found');
  await checkPermission(
    callerBaId,
    ['platform.users.manage', 'org.users.manage'],
    { targetOrgId: user.orgId },
  );

  const role = await prisma.saRole.findUnique({
    where: { publicId: dto.roleId },
    include: {
      permissions: { include: { permission: { select: { name: true, isSystem: true } } } },
    },
  });
  if (!role) throw new NotFoundException('Role not found');

  const systemPermNames = role.permissions
    .filter((rp) => rp.permission.isSystem)
    .map((rp) => rp.permission.name);
  await assertCallerCanGrantSystemPerms(callerBaId, systemPermNames);

  try {
    await prisma.saUserRole.create({ data: { userId: user.id, roleId: role.id } });
  } catch (e: unknown) {
    if (
      typeof e === 'object' &&
      e !== null &&
      'code' in e &&
      (e as { code?: string }).code === 'P2002'
    ) {
      return;
    }
    throw e;
  }
  this.logger.getWinstonLogger().info('Role assigned to user', {
    context: 'UsersService',
    userId: userPublicId,
    roleId: dto.roleId,
  });
}
```

- [ ] **Step 7: Wire the guard into `createUser`**

Update `createUser` (around line 147). Insert the two guard blocks after the `checkPermission` call and before `resolveRoleIdsForApp` / `resolvePermissionIdsForApp`:

```ts
async createUser(callerBaId: string, dto: CreateUserDto) {
  const org = await prisma.saOrg.findUnique({ where: { publicId: dto.orgId } });
  if (!org) throw new NotFoundException('Org not found');

  await checkPermission(
    callerBaId,
    ['platform.users.manage', 'org.users.manage'],
    { targetOrgId: org.id },
  );

  // Escalation guard for initial direct perms.
  const initialPerms = (dto.directPermissionIds ?? []).length === 0
    ? []
    : await prisma.saPermission.findMany({
        where: { publicId: { in: dto.directPermissionIds ?? [] } },
        select: { name: true, isSystem: true },
      });
  const directSystemPermNames = initialPerms
    .filter((p) => p.isSystem)
    .map((p) => p.name);

  // Escalation guard for initial roles.
  const initialRoles = (dto.roleIds ?? []).length === 0
    ? []
    : await prisma.saRole.findMany({
        where: { publicId: { in: dto.roleIds ?? [] } },
        select: {
          permissions: {
            select: { permission: { select: { name: true, isSystem: true } } },
          },
        },
      });
  const roleSystemPermNames = Array.from(new Set(
    initialRoles.flatMap((r) =>
      r.permissions.filter((rp) => rp.permission.isSystem).map((rp) => rp.permission.name),
    ),
  ));

  await assertCallerCanGrantSystemPerms(
    callerBaId,
    Array.from(new Set([...directSystemPermNames, ...roleSystemPermNames])),
  );

  // ...rest of createUser is unchanged: resolveRoleIdsForApp, resolvePermissionIdsForApp,
  // the transaction, the formatUser return.
}
```

- [ ] **Step 8: Run the user-service tests**

```bash
pnpm --filter @sassy-auth/auth-server test src/users/users.service.spec.ts
```

Expected: all tests pass (existing tests still green, new escalation-guard tests now green).

- [ ] **Step 9: Commit**

```bash
git add apps/auth-server/src/users/users.service.ts apps/auth-server/src/users/users.service.spec.ts
git commit -m "feat(users): wire escalation guard into all user-assignment paths"
```

---

## Task 9: Me service — add `/me` profile endpoint

**Files:**
- Modify: `apps/auth-server/src/me/me.service.ts`
- Modify: `apps/auth-server/src/me/me.controller.ts`
- Modify: `apps/auth-server/src/me/me.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

Add a new describe block to `apps/auth-server/src/me/me.service.spec.ts`:

```ts
describe('MeService.getMyProfile', () => {
  it('returns userId, org, and app metadata', async () => {
    mockPrisma.saUser.findUnique.mockResolvedValue({
      publicId: 'sq_u1',
      org: {
        publicId: 'sq_o1', name: 'Acme', isPlatform: false,
        app: { publicId: 'sq_a1', name: 'app01', isPlatform: false },
      },
    });
    const result = await service.getMyProfile('ba-caller');
    expect(result).toEqual({
      userId: 'sq_u1',
      org: { id: 'sq_o1', name: 'Acme', isPlatform: false },
      app: { id: 'sq_a1', name: 'app01', isPlatform: false },
    });
  });

  it('throws ForbiddenException when caller has no SaUser', async () => {
    mockPrisma.saUser.findUnique.mockResolvedValue(null);
    await expect(service.getMyProfile('ba-caller')).rejects.toBeInstanceOf(ForbiddenException);
  });
});
```

- [ ] **Step 2: Run to verify the new tests fail**

```bash
pnpm --filter @sassy-auth/auth-server test src/me/me.service.spec.ts
```

Expected: fails with "service.getMyProfile is not a function".

- [ ] **Step 3: Add `getMyProfile` to MeService**

In `apps/auth-server/src/me/me.service.ts`:

```ts
async getMyProfile(callerBaId: string): Promise<{
  userId: string;
  org: { id: string; name: string; isPlatform: boolean };
  app: { id: string; name: string; isPlatform: boolean };
}> {
  const user = await prisma.saUser.findUnique({
    where: { betterAuthUserId: callerBaId },
    include: { org: { include: { app: true } } },
  });
  if (!user) throw new ForbiddenException();
  return {
    userId: user.publicId,
    org: {
      id: user.org.publicId,
      name: user.org.name,
      isPlatform: user.org.isPlatform,
    },
    app: {
      id: user.org.app.publicId,
      name: user.org.app.name,
      isPlatform: user.org.app.isPlatform,
    },
  };
}
```

- [ ] **Step 4: Wire the controller route**

In `apps/auth-server/src/me/me.controller.ts`, add the new route:

```ts
@Get()
profile(@Req() req: Request) {
  return this.me.getMyProfile(callerBaId(req));
}
```

The existing `@Get('permissions')` route stays. The new `@Get()` resolves to `GET /api/me`.

- [ ] **Step 5: Run the spec to verify all pass**

```bash
pnpm --filter @sassy-auth/auth-server test src/me/me.service.spec.ts
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/auth-server/src/me/me.service.ts apps/auth-server/src/me/me.controller.ts apps/auth-server/src/me/me.service.spec.ts
git commit -m "feat(me): add GET /api/me profile endpoint (org + app context)"
```

---

## Task 10: Seed — rotate platform permissions

**Files:**
- Modify: `apps/auth-server/src/seed/seed.ts`

This task changes the seed but does **not** run a data migration on existing rows. Migration 2 (Task 12) handles re-pointing of `org.permissions.manage`. The seed is updated so a fresh dev DB and `pnpm seed` re-runs end up in the same state.

- [ ] **Step 1: Update PLATFORM_PERMISSIONS**

In `apps/auth-server/src/seed/seed.ts`, replace the `PLATFORM_PERMISSIONS` constant (around line 11):

```ts
const PLATFORM_PERMISSIONS = [
  'platform.orgs.manage',
  'platform.apps.manage',
  'platform.users.manage',
  'platform.roles.manage',
  'platform.permissions.manage',
  'org.users.manage',
  'org.roles.manage',
] as const;
```

(`org.permissions.manage` is removed; `platform.roles.manage` and `org.roles.manage` are added.)

- [ ] **Step 2: Set `isSystem` when ensuring each perm**

Locate the loop in `main()` that creates perms if absent (around line 192). Replace the body of the loop so it also sets `isSystem` based on the name prefix and re-applies it on every seed run (idempotent):

```ts
  // 3. Platform permissions (immutable — create if absent, never rename)
  for (const name of PLATFORM_PERMISSIONS) {
    const isSystem = name.startsWith('org.');
    const existing = await prisma.saPermission.findUnique({ where: { name } });
    if (!existing) {
      await prisma.$transaction(async (tx) => {
        const c = await tx.saPermission.create({
          data: { publicId: 'placeholder', name, appId: platformApp!.id, isSystem },
        });
        const publicId = sqids.encode([c.id]);
        return tx.saPermission.update({ where: { id: c.id }, data: { publicId } });
      });
      console.log(`Created permission: ${name} (isSystem=${isSystem})`);
    } else if (existing.isSystem !== isSystem) {
      await prisma.saPermission.update({
        where: { id: existing.id },
        data: { isSystem },
      });
      console.log(`Updated permission ${name}: isSystem=${isSystem}`);
    }
  }
```

- [ ] **Step 3: Add the new `r@sa.io` admin**

In the same file, locate `PLATFORM_ADMINS` (around line 26). Add the new admin right after `p@sa.io` and `s@sa.io` are kept in their existing positions. The full updated array:

```ts
const PLATFORM_ADMINS: ReadonlyArray<{
  email: string;
  firstName: string;
  lastName: string;
  grant: AdminGrant;
}> = [
  { email: 'u@sa.io', firstName: 'Users', lastName: 'Admin', grant: { kind: 'direct', permission: 'platform.users.manage' } },
  { email: 'o@sa.io', firstName: 'Orgs',  lastName: 'Admin', grant: { kind: 'direct', permission: 'platform.orgs.manage' } },
  { email: 'a@sa.io', firstName: 'Apps',  lastName: 'Admin', grant: { kind: 'direct', permission: 'platform.apps.manage' } },
  { email: 'r@sa.io', firstName: 'Roles', lastName: 'Admin', grant: { kind: 'direct', permission: 'platform.roles.manage' } },
  { email: 'p@sa.io', firstName: 'Perms', lastName: 'Admin', grant: { kind: 'direct', permission: 'platform.permissions.manage' } },
  { email: 's@sa.io', firstName: 'Super', lastName: 'Admin', grant: { kind: 'role',   role: 'Platform Super Admin' } },
];
```

- [ ] **Step 4: Re-run the seed against a fresh local DB**

```bash
# This assumes you have a dev DB you don't mind resetting. If you don't, skip this
# step — Task 12 covers production-equivalent behavior via the data migration.
pnpm --filter @sassy-auth/db prisma migrate reset --force
pnpm seed
```

Expected output includes lines like `Created permission: platform.roles.manage (isSystem=false)`, `Created permission: org.roles.manage (isSystem=true)`, `Created admin r@sa.io with direct permission platform.roles.manage`. No mention of `org.permissions.manage`.

- [ ] **Step 5: Verify the catalog in the DB**

```bash
psql "$DATABASE_URL" -c "SELECT name, \"isSystem\" FROM \"SaPermission\" WHERE name LIKE 'platform.%' OR name LIKE 'org.%' ORDER BY name;"
```

Expected rows:

```
            name             | isSystem
-----------------------------+----------
 org.roles.manage            | t
 org.users.manage            | t
 platform.apps.manage        | f
 platform.orgs.manage        | f
 platform.permissions.manage | f
 platform.roles.manage       | f
 platform.users.manage       | f
```

- [ ] **Step 6: Commit**

```bash
git add apps/auth-server/src/seed/seed.ts
git commit -m "feat(seed): add platform.roles.manage + org.roles.manage, drop org.permissions.manage, add r@sa.io"
```

---

## Task 11: Matrix — rotate gates and seed admins

**Files:**
- Modify: `apps/auth-server/test/matrix/permissions-matrix.ts`

- [ ] **Step 1: Rotate the GATE table**

In `apps/auth-server/test/matrix/permissions-matrix.ts`, replace the `roles` block in the `GATE` constant:

```ts
  roles: {
    list:   ['platform.roles.manage', 'org.roles.manage'],
    get:    ['platform.roles.manage', 'org.roles.manage'],
    create: ['platform.roles.manage'],
    update: ['platform.roles.manage'],
    delete: ['platform.roles.manage'],
  },
```

(`permissions`, `users`, `orgs`, `apps` blocks stay exactly as they are.)

- [ ] **Step 2: Update `SEED_ADMINS`**

Replace the constant (the file's around line 18):

```ts
export const SEED_ADMINS: readonly SeedAdmin[] = [
  { key: 'apps',  email: 'a@sa.io', perms: ['platform.apps.manage'] },
  { key: 'orgs',  email: 'o@sa.io', perms: ['platform.orgs.manage'] },
  { key: 'users', email: 'u@sa.io', perms: ['platform.users.manage'] },
  { key: 'roles', email: 'r@sa.io', perms: ['platform.roles.manage'] },
  { key: 'perms', email: 'p@sa.io', perms: ['platform.permissions.manage'] },
  {
    key: 'super',
    email: 's@sa.io',
    perms: [
      'platform.apps.manage',
      'platform.orgs.manage',
      'platform.users.manage',
      'platform.roles.manage',
      'platform.permissions.manage',
      'org.users.manage',
      'org.roles.manage',
    ],
  },
];
```

(`AdminKey` type also needs to grow: add `'roles'` to the union.)

```ts
export type AdminKey = 'apps' | 'orgs' | 'users' | 'roles' | 'perms' | 'super';
```

- [ ] **Step 3: Re-run the matrix suite (locally; it will fail until Task 12 runs the migration)**

```bash
pnpm --filter @sassy-auth/auth-server test test/matrix/roles.matrix.e2e-spec.ts
```

Expected (at this stage): the matrix may fail because `r@sa.io` doesn't exist in the DB yet (the seed change from Task 10 only runs on a reset DB; Task 12's migration is what makes the upgrade work in already-populated DBs). That's OK — the matrix will pass after Task 12 runs.

- [ ] **Step 4: Commit**

```bash
git add apps/auth-server/test/matrix/permissions-matrix.ts
git commit -m "test(matrix): rotate gates and seed admins for the platform.roles.manage split"
```

---

## Task 12: Migration 2 — drop `org.permissions.manage`, insert new perms, re-point

**Files:**
- Create: `packages/db/migrations/20260618220100_seed_role_perms_and_drop_org_permissions_manage/migration.sql`

The migration replaces what would otherwise be a re-seed in prod: it sets `isSystem` on existing rows, inserts the new perm rows with placeholder public IDs (a small TS step in the seed replaces them on next run, but production roll-forward is safe even without it), wires the Super Admin role to `platform.roles.manage`, and re-points/drops `org.permissions.manage`.

- [ ] **Step 1: Create the migration directory and SQL**

```bash
mkdir -p packages/db/migrations/20260618220100_seed_role_perms_and_drop_org_permissions_manage
```

Create `packages/db/migrations/20260618220100_seed_role_perms_and_drop_org_permissions_manage/migration.sql`:

```sql
-- ─────────────────────────────────────────────────────────────────────
-- 1. Mark every existing org.* perm as system.
-- ─────────────────────────────────────────────────────────────────────
UPDATE "SaPermission"
SET    "isSystem" = true
WHERE  "name" LIKE 'org.%';

-- ─────────────────────────────────────────────────────────────────────
-- 2. Insert platform.roles.manage and org.roles.manage if absent.
--    publicId is a placeholder; the seed (or a follow-up update query)
--    replaces it with a real sqid-encoded id on the next seed run.
--    The schema's @unique on name protects against duplicate inserts.
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO "SaPermission" ("publicId", "name", "appId", "isSystem")
SELECT 'pending-roles-manage', 'platform.roles.manage', a.id, false
FROM   "SaApp" a
WHERE  a."isPlatform" = true
  AND  NOT EXISTS (SELECT 1 FROM "SaPermission" WHERE "name" = 'platform.roles.manage');

INSERT INTO "SaPermission" ("publicId", "name", "appId", "isSystem")
SELECT 'pending-org-roles-manage', 'org.roles.manage', a.id, true
FROM   "SaApp" a
WHERE  a."isPlatform" = true
  AND  NOT EXISTS (SELECT 1 FROM "SaPermission" WHERE "name" = 'org.roles.manage');

-- ─────────────────────────────────────────────────────────────────────
-- 3. Re-point role-level grants of org.permissions.manage → org.roles.manage.
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO "SaRolePermission" ("roleId", "permissionId")
SELECT rp."roleId", new_perm.id
FROM   "SaRolePermission" rp
JOIN   "SaPermission" old_perm ON old_perm.id = rp."permissionId" AND old_perm.name = 'org.permissions.manage'
JOIN   "SaPermission" new_perm ON new_perm.name = 'org.roles.manage'
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- 4. Re-point user-level grants the same way.
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO "SaUserPermission" ("userId", "permissionId")
SELECT up."userId", new_perm.id
FROM   "SaUserPermission" up
JOIN   "SaPermission" old_perm ON old_perm.id = up."permissionId" AND old_perm.name = 'org.permissions.manage'
JOIN   "SaPermission" new_perm ON new_perm.name = 'org.roles.manage'
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- 5. Delete the obsolete perm. ON DELETE CASCADE on the join tables
--    cleans up leftovers we already mirrored above.
-- ─────────────────────────────────────────────────────────────────────
DELETE FROM "SaPermission" WHERE "name" = 'org.permissions.manage';

-- ─────────────────────────────────────────────────────────────────────
-- 6. Grant platform.roles.manage to the Platform Super Admin role,
--    so s@sa.io retains super-admin parity after the split.
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO "SaRolePermission" ("roleId", "permissionId")
SELECT r.id, p.id
FROM   "SaRole" r
JOIN   "SaApp"  a ON a.id = r."appId" AND a."isPlatform" = true
JOIN   "SaPermission" p ON p.name = 'platform.roles.manage'
WHERE  r.name = 'Platform Super Admin'
ON CONFLICT DO NOTHING;
```

- [ ] **Step 2: Apply the migration**

```bash
pnpm --filter @sassy-auth/db prisma migrate deploy
```

Expected: `1 migration successfully applied` referencing `seed_role_perms_and_drop_org_permissions_manage`.

- [ ] **Step 3: Re-run the seed to backfill real sqid `publicId`s**

```bash
pnpm seed
```

Expected output mentions creating the placeholder rows is skipped (they already exist) but the `else if (existing.isSystem !== isSystem)` branch from Task 10 sets `isSystem` correctly. Then add this small follow-up step in the seed to replace placeholder publicIds — open `apps/auth-server/src/seed/seed.ts` and inside the perm loop (right after the `else if (existing.isSystem !== isSystem)` branch), add:

```ts
    } else if (existing.publicId.startsWith('pending-')) {
      const publicId = sqids.encode([existing.id]);
      await prisma.saPermission.update({
        where: { id: existing.id },
        data: { publicId },
      });
      console.log(`Backfilled placeholder publicId for ${name}: ${publicId}`);
    }
```

Re-run `pnpm seed`. The placeholder strings get replaced.

- [ ] **Step 4: Verify the DB state**

```bash
psql "$DATABASE_URL" -c "SELECT name, \"publicId\", \"isSystem\" FROM \"SaPermission\" WHERE name LIKE 'platform.%' OR name LIKE 'org.%' ORDER BY name;"
psql "$DATABASE_URL" -c "SELECT 1 FROM \"SaPermission\" WHERE name = 'org.permissions.manage';"
```

Expected: 7 rows from the first query (4 `platform.*` + `platform.roles.manage` + 2 `org.*`), no `pending-` publicIds left, and zero rows from the second query.

- [ ] **Step 5: Run the matrix suite to confirm Task 11's matrix is satisfied**

```bash
pnpm --filter @sassy-auth/auth-server test test/matrix/
```

Expected: all matrix specs pass — `r@sa.io` exists, `org.permissions.manage` is gone, `s@sa.io` holds `platform.roles.manage`.

- [ ] **Step 6: Commit**

```bash
git add packages/db/migrations/20260618220100_seed_role_perms_and_drop_org_permissions_manage/ apps/auth-server/src/seed/seed.ts
git commit -m "feat(db): migrate perms catalog — split platform.permissions.manage, drop org.permissions.manage"
```

---

## Task 13: Admin types & API client — `Permission.isSystem` and `MeProfile`

**Files:**
- Modify: `apps/admin/lib/types.ts`
- Modify: `apps/admin/lib/api.ts`

- [ ] **Step 1: Update types**

In `apps/admin/lib/types.ts`, locate the `Permission` type (it represents a row from `/api/permissions`). Add `isSystem`:

```ts
export interface Permission {
  id: string;        // publicId
  name: string;
  appId: string;
  isSystem?: boolean;  // present on /api/permissions responses; older shapes may omit
}
```

If `PermissionRow` exists separately for the table view, add `isSystem: boolean` there too.

Add a new `MeProfile` type:

```ts
export interface MeProfile {
  userId: string;
  org: { id: string; name: string; isPlatform: boolean };
  app: { id: string; name: string; isPlatform: boolean };
}
```

- [ ] **Step 2: Add the `getMyProfile` API client**

In `apps/admin/lib/api.ts`, alongside `getMyPermissions`, add:

```ts
export async function getMyProfile(): Promise<MeProfile> {
  const res = await apiFetch('/api/me');
  return res.json();
}
```

Import `MeProfile` into the file's import block (the existing types import line).

- [ ] **Step 3: Run the admin test suite to catch type drift**

```bash
pnpm --filter sassy-auth-admin test
```

Expected: pre-existing tests pass; if the `getPermissions` API tests now mock a response without `isSystem`, that's fine — the field is optional in TypeScript and tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/lib/types.ts apps/admin/lib/api.ts
git commit -m "feat(admin): add Permission.isSystem and getMyProfile client"
```

---

## Task 14: Admin layout — fetch profile + thread context to shell

**Files:**
- Modify: `apps/admin/app/(admin)/layout.tsx`
- Modify: `apps/admin/components/admin-shell.tsx`

- [ ] **Step 1: Update the layout to fetch profile + permissions**

In `apps/admin/app/(admin)/layout.tsx`, replace the `getSession`-only block with a parallel fetch:

```ts
import { getMyPermissions, getMyProfile } from '@/lib/api'

// inside AdminLayout, after the existing session check:
const [perms, profile] = await Promise.all([
  getMyPermissions().catch(() => [] as string[]),
  getMyProfile().catch(() => null),
])

return (
  <AdminShell
    user={user}
    perms={perms}
    profile={profile}
    currentLocale={currentLocale}
    availableLocales={availableLocales}
  >
    {children}
  </AdminShell>
)
```

The `.catch(...)` defaults keep render-time errors from propagating into the shell — if the auth API is briefly unreachable, the user gets an empty sidebar rather than a 500. The error fallback is fine because the per-page access checks (Section 5(e)) re-validate before any sensitive action.

- [ ] **Step 2: Update AdminShell to accept the new props**

In `apps/admin/components/admin-shell.tsx`:

```ts
import { getTranslations } from 'next-intl/server'
import { SidebarShell, type NavIconName } from './sidebar-shell'
import type { MeProfile } from '@/lib/types'

interface AdminShellProps {
  children: React.ReactNode
  user: { firstName: string; lastName: string; email: string }
  perms: string[]
  profile: MeProfile | null
  currentLocale: string
  availableLocales: string[]
}

export async function AdminShell({
  children, user, perms, profile, currentLocale, availableLocales,
}: AdminShellProps) {
  const t = await getTranslations()

  // Single nav declaration with per-item permission requirements.
  const NAV: {
    group: 'directory' | 'accessControl';
    item: { href: string; label: string; icon: NavIconName };
    requires: string[];
  }[] = [
    { group: 'directory', item: { href: '/apps',  label: t('nav.apps'),  icon: 'Boxes' },       requires: ['platform.apps.manage'] },
    { group: 'directory', item: { href: '/orgs',  label: t('nav.orgs'),  icon: 'Building2' },   requires: ['platform.orgs.manage'] },
    { group: 'directory', item: { href: '/users', label: t('nav.users'), icon: 'Users' },       requires: ['platform.users.manage', 'org.users.manage'] },
    { group: 'accessControl', item: { href: '/roles',       label: t('nav.roles'),       icon: 'ShieldEllipsis' }, requires: ['platform.roles.manage', 'org.roles.manage'] },
    { group: 'accessControl', item: { href: '/permissions', label: t('nav.permissions'), icon: 'KeyRound' },       requires: ['platform.permissions.manage'] },
  ]

  const visible = NAV.filter((n) => n.requires.some((p) => perms.includes(p)))
  const groups: { label: string; items: { href: string; label: string; icon: NavIconName }[] }[] = []
  const directoryItems = visible.filter((n) => n.group === 'directory').map((n) => n.item)
  const accessItems    = visible.filter((n) => n.group === 'accessControl').map((n) => n.item)
  if (directoryItems.length > 0) groups.push({ label: t('nav.directory'), items: directoryItems })
  if (accessItems.length > 0)    groups.push({ label: t('nav.accessControl'), items: accessItems })

  void profile  // currently only consumed by child pages; reserved for shell-level breadcrumbs later

  return (
    <SidebarShell
      groups={groups}
      user={user}
      currentLocale={currentLocale}
      availableLocales={availableLocales}
      signOutLabel={t('nav.signOut')}
      lightModeLabel={t('nav.switchToLight')}
      darkModeLabel={t('nav.switchToDark')}
    >
      {children}
    </SidebarShell>
  )
}
```

- [ ] **Step 3: Manual sanity check (no test yet — that's Task 15)**

Start the dev stack:

```bash
pnpm dev
```

Sign in as `s@sa.io`. Expected: sidebar shows all five items. Sign in as `r@sa.io` (after the migration). Expected: sidebar shows only **Roles** under "Access Control" (Directory group is empty and hidden).

- [ ] **Step 4: Commit**

```bash
git add apps/admin/app/(admin)/layout.tsx apps/admin/components/admin-shell.tsx
git commit -m "feat(admin): permission-driven sidebar in admin shell"
```

---

## Task 15: Admin shell — tests for permission-driven sidebar

**Files:**
- Create: `apps/admin/components/__tests__/admin-shell.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `apps/admin/components/__tests__/admin-shell.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { AdminShell } from '@/components/admin-shell'

// next-intl + sidebar UI provider stubs. Mirror existing test files'
// mocking patterns — see e.g. apps/admin/components/__tests__/permissions-table.test.tsx
// for how next-intl's getTranslations is stubbed in tests for server components.
jest.mock('next-intl/server', () => ({
  getTranslations: jest.fn().mockResolvedValue((key: string) => key),
}))

const user = { firstName: 'X', lastName: 'Y', email: 'x@y.io' }
const profile = { userId: 'sq_u1', org: { id: 'sq_o1', name: 'Acme', isPlatform: false }, app: { id: 'sq_a1', name: 'app01', isPlatform: false } }

describe('AdminShell sidebar', () => {
  it('shows all 5 items for a platform super admin', async () => {
    const perms = ['platform.apps.manage','platform.orgs.manage','platform.users.manage','platform.roles.manage','platform.permissions.manage']
    const el = await AdminShell({ user, perms, profile, currentLocale: 'en', availableLocales: ['en'], children: <div /> })
    render(el)
    expect(screen.getByText('nav.apps')).toBeInTheDocument()
    expect(screen.getByText('nav.orgs')).toBeInTheDocument()
    expect(screen.getByText('nav.users')).toBeInTheDocument()
    expect(screen.getByText('nav.roles')).toBeInTheDocument()
    expect(screen.getByText('nav.permissions')).toBeInTheDocument()
  })

  it('shows only Users + Roles for an org admin holding org.users.manage + org.roles.manage', async () => {
    const perms = ['org.users.manage', 'org.roles.manage']
    const el = await AdminShell({ user, perms, profile, currentLocale: 'en', availableLocales: ['en'], children: <div /> })
    render(el)
    expect(screen.queryByText('nav.apps')).not.toBeInTheDocument()
    expect(screen.queryByText('nav.orgs')).not.toBeInTheDocument()
    expect(screen.getByText('nav.users')).toBeInTheDocument()
    expect(screen.getByText('nav.roles')).toBeInTheDocument()
    expect(screen.queryByText('nav.permissions')).not.toBeInTheDocument()
  })

  it('collapses the Access Control group when only org.users.manage is held', async () => {
    const perms = ['org.users.manage']
    const el = await AdminShell({ user, perms, profile, currentLocale: 'en', availableLocales: ['en'], children: <div /> })
    render(el)
    expect(screen.getByText('nav.users')).toBeInTheDocument()
    expect(screen.queryByText('nav.roles')).not.toBeInTheDocument()
    expect(screen.queryByText('nav.accessControl')).not.toBeInTheDocument()
  })
})
```

If `SidebarShell` needs a context provider in tests (because the existing pattern wraps it), follow the same mocking shape used in `apps/admin/components/__tests__/permissions-table.test.tsx`.

- [ ] **Step 2: Run the tests**

```bash
pnpm --filter sassy-auth-admin test admin-shell.test.tsx
```

Expected: 3 tests pass (the implementation is already in place from Task 14).

- [ ] **Step 3: Commit**

```bash
git add apps/admin/components/__tests__/admin-shell.test.tsx
git commit -m "test(admin): cover permission-driven sidebar (platform super, tenant admin, single-perm holder)"
```

---

## Task 16: Users page — default org filter to the caller's org

**Files:**
- Modify: `apps/admin/app/(admin)/users/page.tsx`
- Modify: `apps/admin/components/users-table.tsx`

- [ ] **Step 1: Update the page to default the org filter**

In `apps/admin/app/(admin)/users/page.tsx`:

```ts
import { getUsers, getOrgs, getMyPermissions, getMyProfile } from '@/lib/api'
import { UsersTable } from '@/components/users-table'
import type { Org } from '@/lib/types'

interface UsersPageProps {
  searchParams: Promise<{ orgId?: string }>
}

export default async function UsersPage({ searchParams }: UsersPageProps) {
  const { orgId: orgIdParam } = await searchParams
  const [perms, profile] = await Promise.all([
    getMyPermissions().catch(() => [] as string[]),
    getMyProfile().catch(() => null),
  ])

  const isPlatformUsers = perms.includes('platform.users.manage')

  // For non-platform callers, default the orgId to their own org if no
  // explicit URL param is set, and ignore any attempt to pass a different
  // orgId — the server will 403 either way, but defaulting cleanly avoids
  // the bare 403 panel on first load.
  const effectiveOrgId = isPlatformUsers
    ? orgIdParam
    : (orgIdParam && profile && orgIdParam === profile.org.id ? orgIdParam : profile?.org.id)

  const [users, orgsRes] = await Promise.all([
    getUsers(effectiveOrgId ? { orgId: effectiveOrgId } : undefined),
    isPlatformUsers ? getOrgs({ pageSize: 200 }) : Promise.resolve({ items: profile ? [{ publicId: profile.org.id, name: profile.org.name, app: { publicId: profile.app.id, name: profile.app.name }, isPlatform: profile.org.isPlatform }] : [], total: 0, page: 1, pageSize: 200 }),
  ])

  const orgs: Org[] = orgsRes.items.map((o) => ({
    id: o.publicId,
    name: o.name,
    appId: o.app.publicId,
    isPlatform: o.isPlatform,
  }))
  return (
    <UsersTable
      users={users}
      orgs={orgs}
      initialOrgId={effectiveOrgId}
      canPickOrg={isPlatformUsers}
    />
  )
}
```

- [ ] **Step 2: Update UsersTable to honor `canPickOrg`**

In `apps/admin/components/users-table.tsx`:

Add the prop:

```ts
interface UsersTableProps {
  users: User[]
  orgs: Org[]
  initialOrgId?: string
  canPickOrg?: boolean
}

export function UsersTable({ users, orgs, initialOrgId, canPickOrg = true }: UsersTableProps) {
```

Find the org-picker UI element in the table and wrap it in `canPickOrg && …` or disable it. Concretely, look for where `orgs` is rendered as a dropdown (`Select`, `Combobox`, or similar). The change is: when `canPickOrg` is false, render a read-only label showing the single org name instead of an interactive picker.

If `users-table.tsx` doesn't currently expose an org picker (some implementations rely on URL params only), this step reduces to: when `canPickOrg` is false, do not render an "All orgs" affordance — only show the locked-to-own-org breadcrumb.

- [ ] **Step 3: Smoke-test in the browser**

```bash
pnpm dev
```

Sign in as `s@sa.io`. Expected: org picker visible, all orgs listed, can switch. Sign in as a user holding only `org.users.manage` (you need to seed one first — Task 19 supplies that path; for now skip the second half).

- [ ] **Step 4: Update users-table tests if affected**

If `apps/admin/components/__tests__/users-table.test.tsx` already exists and tests the org picker, add a case that asserts the picker is hidden when `canPickOrg={false}`. Use the same render pattern existing tests use.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/app/(admin)/users/page.tsx apps/admin/components/users-table.tsx apps/admin/components/__tests__/users-table.test.tsx
git commit -m "feat(admin): default Users page filter to caller's own org for non-platform callers"
```

---

## Task 17: Roles page — default app filter, switch gate, gate write affordances

**Files:**
- Modify: `apps/admin/app/(admin)/roles/page.tsx`
- Modify: `apps/admin/components/roles-table.tsx`

- [ ] **Step 1: Update the page**

In `apps/admin/app/(admin)/roles/page.tsx`:

```ts
import { getRoles, getApps, getMyPermissions, getMyProfile } from '@/lib/api'
import { RolesTable } from '@/components/roles-table'
import { AccessDeniedPanel } from '@/components/access-denied-panel'

export default async function RolesPage() {
  const [permsResult, profileResult] = await Promise.allSettled([
    getMyPermissions(),
    getMyProfile(),
  ])
  const perms = permsResult.status === 'fulfilled' ? permsResult.value : []
  const profile = profileResult.status === 'fulfilled' ? profileResult.value : null

  const canRead  = perms.includes('platform.roles.manage') || perms.includes('org.roles.manage')
  const canWrite = perms.includes('platform.roles.manage')
  if (!canRead) return <AccessDeniedPanel />

  const isPlatformRoles = canWrite
  const effectiveAppId = isPlatformRoles ? undefined : profile?.app.id

  const [listResult, appsResult] = await Promise.allSettled([
    getRoles({ page: 1, pageSize: 25, ...(effectiveAppId ? { appId: effectiveAppId } : {}) }),
    isPlatformRoles
      ? getApps({ page: 1, pageSize: 200 })
      : Promise.resolve({ items: profile ? [{ publicId: profile.app.id, name: profile.app.name, url: '', isPlatform: profile.app.isPlatform }] : [], total: 0, page: 1, pageSize: 200 }),
  ])

  if (listResult.status === 'rejected') throw listResult.reason
  if (appsResult.status === 'rejected') throw appsResult.reason

  return (
    <RolesTable
      initial={listResult.value}
      apps={appsResult.value.items}
      canWrite={canWrite}
      canPickApp={isPlatformRoles}
    />
  )
}
```

- [ ] **Step 2: Update RolesTable**

In `apps/admin/components/roles-table.tsx`, accept the two new props and gate the write affordances:

```ts
interface RolesTableProps {
  initial: ListRolesResponse
  apps: App[]
  canWrite?: boolean
  canPickApp?: boolean
}

export function RolesTable({ initial, apps, canWrite = true, canPickApp = true }: RolesTableProps) {
  // ...
  // Find the "Create role" button and the row-level Edit/Delete dropdown items.
  // Wrap each in `canWrite && (...)`. Wrap the app picker in `canPickApp && (...)`.
  // For row-level menus, only "View" should remain when canWrite=false.
```

The concrete edits depend on the existing component structure — locate the create-button render and the row-action `<DropdownMenuItem>`s and add the conditional wrappers.

- [ ] **Step 3: Update or add roles-table tests**

In `apps/admin/components/__tests__/roles-table.test.tsx`, add cases:

```ts
it('hides Create/Edit/Delete affordances when canWrite=false', () => {
  render(<RolesTable initial={fixture} apps={apps} canWrite={false} />)
  expect(screen.queryByRole('button', { name: /create/i })).not.toBeInTheDocument()
  // open a row's actions menu and assert Edit / Delete are absent
})

it('hides the app picker when canPickApp=false', () => {
  render(<RolesTable initial={fixture} apps={apps} canPickApp={false} />)
  expect(screen.queryByRole('combobox', { name: /app/i })).not.toBeInTheDocument()
})
```

- [ ] **Step 4: Run admin tests**

```bash
pnpm --filter sassy-auth-admin test roles-table.test.tsx
```

Expected: tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/app/(admin)/roles/page.tsx apps/admin/components/roles-table.tsx apps/admin/components/__tests__/roles-table.test.tsx
git commit -m "feat(admin): scope Roles page to caller's app for non-platform callers + gate write affordances"
```

---

## Task 18: Permissions UI — System badge and `isSystem` immutability

**Files:**
- Modify: `apps/admin/components/permissions-table.tsx`
- Modify: `apps/admin/components/permission-view-drawer.tsx`
- Modify: `apps/admin/components/__tests__/permissions-table.test.tsx`
- Modify: `apps/admin/components/__tests__/permission-view-drawer.test.tsx`

- [ ] **Step 1: Update permissions-table.tsx**

In `apps/admin/components/permissions-table.tsx`, locate the two places that compute `const platform = p.name.startsWith('platform.')` (around lines 61 and 119). Replace with mutually-exclusive badge logic:

```ts
const isPlatform = p.name.startsWith('platform.')
const isSystem   = !isPlatform && (p.isSystem ?? false)
const isImmutable = isPlatform || isSystem
```

Where the existing code rendered a single `Platform` badge, render whichever badge applies (only one per row):

```tsx
{isPlatform && <Badge>Platform</Badge>}
{isSystem   && <Badge>System</Badge>}
```

Where the existing code hid Edit/Delete menu items based on `platform`, switch the condition to `isImmutable`.

- [ ] **Step 2: Update permission-view-drawer.tsx**

In `apps/admin/components/permission-view-drawer.tsx` around line 28:

```ts
const isPlatform  = permission.name.startsWith('platform.')
const isSystem    = !isPlatform && (permission.isSystem ?? false)
const isImmutable = isPlatform || isSystem
```

Render the corresponding badge and hide Edit/Delete actions when `isImmutable`.

- [ ] **Step 3: Update permissions-table tests**

In `apps/admin/components/__tests__/permissions-table.test.tsx`, add new cases:

```ts
it('renders the System badge for isSystem rows (and not the Platform badge)', () => {
  const rows = [{ publicId: 'sq_p1', name: 'org.users.manage', isSystem: true, app: { publicId: 'sq_a1', name: 'SassyAuth' }, roleCount: 0, userCount: 0 }]
  render(<PermissionsTable rows={rows} />)
  expect(screen.getByText('System')).toBeInTheDocument()
  expect(screen.queryByText('Platform')).not.toBeInTheDocument()
})

it('hides Edit and Delete menu items for isSystem rows', () => {
  const rows = [{ publicId: 'sq_p1', name: 'org.users.manage', isSystem: true, app: { publicId: 'sq_a1', name: 'SassyAuth' }, roleCount: 0, userCount: 0 }]
  render(<PermissionsTable rows={rows} />)
  // open the row's three-dot menu — assertion shape mirrors the existing
  // 'Edit and Delete menu items are hidden for platform.* rows' test.
})
```

- [ ] **Step 4: Update permission-view-drawer tests**

In `apps/admin/components/__tests__/permission-view-drawer.test.tsx`, add:

```ts
it('shows the System badge for isSystem permissions', () => {
  const systemPerm: PermissionRow = { ...permission, name: 'org.users.manage', isSystem: true }
  render(<PermissionViewDrawer permission={systemPerm} open onOpenChange={() => {}} />)
  expect(screen.getByText('System')).toBeInTheDocument()
  expect(screen.queryByText('Platform')).not.toBeInTheDocument()
  // Edit/Delete buttons absent
})
```

- [ ] **Step 5: Run the admin tests**

```bash
pnpm --filter sassy-auth-admin test permissions-table permission-view-drawer
```

Expected: all tests pass — existing `Platform` cases still green; new `System` cases green.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/components/permissions-table.tsx apps/admin/components/permission-view-drawer.tsx apps/admin/components/__tests__/permissions-table.test.tsx apps/admin/components/__tests__/permission-view-drawer.test.tsx
git commit -m "feat(admin): render System badge and lock edit/delete for isSystem permissions"
```

---

## Task 19: Demo seed — multi-tenant scenario (`app01`)

**Files:**
- Create: `apps/auth-server/src/seed/demo-multitenant.ts`
- Modify: `apps/auth-server/src/seed/seed.ts`

- [ ] **Step 1: Create the demo seed file**

Create `apps/auth-server/src/seed/demo-multitenant.ts`:

```ts
import { prisma } from '@sassy-auth/db';
import Sqids from 'sqids';
import { auth } from '../auth/auth.config';

const sqids = new Sqids({
  alphabet: process.env.SQIDS_ALPHABET || undefined,
  minLength: 4,
});

const APP_NAME = 'app01';
const APP_URL = 'http://localhost:4000';
const PASSWORD = 'Pass@word1234';

const APP_PERMISSIONS = ['contracts.read', 'contracts.create'] as const;
const ORGS = ['Acme', 'Globex'] as const;

interface UserSeed {
  email: string;
  firstName: string;
  lastName: string;
  org: typeof ORGS[number];
  /** Direct system perm granted (currently only org.users.manage for the two admins). */
  systemPerm?: 'org.users.manage';
}

const USERS: readonly UserSeed[] = [
  { email: 'acme-admin@app01.io',   firstName: 'Acme',   lastName: 'Admin',    org: 'Acme',   systemPerm: 'org.users.manage' },
  { email: 'acme-alice@app01.io',   firstName: 'Acme',   lastName: 'Alice',    org: 'Acme' },
  { email: 'acme-bob@app01.io',     firstName: 'Acme',   lastName: 'Bob',      org: 'Acme' },
  { email: 'globex-admin@app01.io', firstName: 'Globex', lastName: 'Admin',    org: 'Globex', systemPerm: 'org.users.manage' },
  { email: 'globex-gina@app01.io',  firstName: 'Globex', lastName: 'Gina',     org: 'Globex' },
  { email: 'globex-greg@app01.io',  firstName: 'Globex', lastName: 'Greg',     org: 'Globex' },
];

async function ensureApp() {
  const found = await prisma.saApp.findUnique({ where: { name: APP_NAME } });
  if (found) return found;
  return prisma.$transaction(async (tx) => {
    const created = await tx.saApp.create({
      data: { publicId: 'placeholder', name: APP_NAME, url: APP_URL, isPlatform: false },
    });
    return tx.saApp.update({
      where: { id: created.id },
      data: { publicId: sqids.encode([created.id]) },
    });
  });
}

async function ensureOrg(appId: number, name: string) {
  const found = await prisma.saOrg.findFirst({ where: { appId, name } });
  if (found) return found;
  return prisma.$transaction(async (tx) => {
    const created = await tx.saOrg.create({
      data: { publicId: 'placeholder', name, appId, isPlatform: false },
    });
    return tx.saOrg.update({
      where: { id: created.id },
      data: { publicId: sqids.encode([created.id]) },
    });
  });
}

async function ensureAppPermission(appId: number, name: string) {
  let perm = await prisma.saPermission.findUnique({ where: { name } });
  if (perm) return perm;
  perm = await prisma.$transaction(async (tx) => {
    const c = await tx.saPermission.create({
      data: { publicId: 'placeholder', name, appId, isSystem: false },
    });
    return tx.saPermission.update({
      where: { id: c.id },
      data: { publicId: sqids.encode([c.id]) },
    });
  });
  return perm;
}

async function ensureUser(seed: UserSeed, orgIdByName: Record<string, number>, sysPermByName: Record<string, number>) {
  const existing = await prisma.user.findUnique({ where: { email: seed.email } });
  let baUserId: string;
  if (existing) {
    baUserId = existing.id;
  } else {
    const result = await auth.api.signUpEmail({
      body: { email: seed.email, password: PASSWORD, name: `${seed.firstName} ${seed.lastName}` },
    });
    baUserId = result.user.id;
    await prisma.user.update({ where: { id: baUserId }, data: { emailVerified: true } });
  }

  let saUser = await prisma.saUser.findFirst({ where: { betterAuthUserId: baUserId } });
  if (!saUser) {
    saUser = await prisma.$transaction(async (tx) => {
      const c = await tx.saUser.create({
        data: {
          publicId: 'placeholder',
          betterAuthUserId: baUserId,
          orgId: orgIdByName[seed.org],
          firstName: seed.firstName,
          lastName: seed.lastName,
          status: 'active',
        },
      });
      return tx.saUser.update({
        where: { id: c.id },
        data: { publicId: sqids.encode([c.id]) },
      });
    });
  }

  if (seed.systemPerm) {
    await prisma.saUserPermission.upsert({
      where: {
        userId_permissionId: {
          userId: saUser.id,
          permissionId: sysPermByName[seed.systemPerm],
        },
      },
      create: { userId: saUser.id, permissionId: sysPermByName[seed.systemPerm] },
      update: {},
    });
  }
}

export async function seedDemoMultitenant() {
  console.log('[demo-mt] Seeding app01 multi-tenant scenario...');
  const app = await ensureApp();
  const orgRows = await Promise.all(ORGS.map((name) => ensureOrg(app.id, name)));
  const orgIdByName: Record<string, number> = Object.fromEntries(
    ORGS.map((n, i) => [n, orgRows[i].id]),
  );

  for (const name of APP_PERMISSIONS) {
    await ensureAppPermission(app.id, name);
  }

  // org.users.manage is seeded by the platform seed (system perm in the platform app).
  const orgUsersPerm = await prisma.saPermission.findUnique({ where: { name: 'org.users.manage' } });
  if (!orgUsersPerm) throw new Error('seedDemoMultitenant requires org.users.manage to exist');
  const sysPermByName: Record<string, number> = { 'org.users.manage': orgUsersPerm.id };

  for (const u of USERS) {
    await ensureUser(u, orgIdByName, sysPermByName);
  }
  console.log('[demo-mt] Done.');
}
```

- [ ] **Step 2: Wire the demo seed into `seed.ts`**

In `apps/auth-server/src/seed/seed.ts`, add the new import/branch immediately after the existing `SEED_DEMO` block:

```ts
if (process.env.SEED_DEMO_MULTITENANT === '1') {
  const { seedDemoMultitenant } = await import('./demo-multitenant');
  await seedDemoMultitenant();
}
```

- [ ] **Step 3: Run the demo seed**

```bash
SEED_DEMO_MULTITENANT=1 pnpm seed
```

Expected output: `[demo-mt] Seeding app01 multi-tenant scenario...` followed by `Done.`. Re-run to verify idempotency.

- [ ] **Step 4: Verify the seed**

```bash
psql "$DATABASE_URL" -c "SELECT u.email, o.name AS org, p.name AS perm FROM \"User\" u JOIN \"SaUser\" su ON su.\"betterAuthUserId\"=u.id JOIN \"SaOrg\" o ON o.id=su.\"orgId\" LEFT JOIN \"SaUserPermission\" up ON up.\"userId\"=su.id LEFT JOIN \"SaPermission\" p ON p.id=up.\"permissionId\" WHERE u.email LIKE '%@app01.io' ORDER BY u.email;"
```

Expected: 6 rows. Both `*-admin` rows show `org.users.manage`; the four non-admin rows show NULL for perm.

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/seed/demo-multitenant.ts apps/auth-server/src/seed/seed.ts
git commit -m "feat(seed): SEED_DEMO_MULTITENANT scenario — app01 with Acme + Globex"
```

---

## Task 20: Scenario factories — sign-in + path helpers for demo users

**Files:**
- Create: `apps/auth-server/test/scenarios/factories.ts`

- [ ] **Step 1: Create the factories module**

Create `apps/auth-server/test/scenarios/factories.ts`:

```ts
/**
 * Sign-in + request helpers for the multi-tenant demo scenario. Mirrors
 * the matrix harness shape (bootApp / signInAs / as) but keyed off the
 * SEED_DEMO_MULTITENANT users instead of SEED_ADMINS.
 */
import 'dotenv/config';
import * as crypto from 'crypto';
import express from 'express';
import request, { Response as SuperResponse } from 'supertest';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ExpressAdapter } from '@nestjs/platform-express';
import { toNodeHandler } from 'better-auth/node';
import { AppModule } from '../../src/app.module';
import { auth } from '../../src/auth/auth.config';
import { SentryExceptionFilter } from '../../src/common/filters/sentry-exception.filter';
import { LoggerService } from '../../src/common/logger/logger.service';

export const DEMO_PASSWORD = 'Pass@word1234';

export const DEMO_USERS = {
  acmeAdmin:   'acme-admin@app01.io',
  acmeAlice:   'acme-alice@app01.io',
  acmeBob:     'acme-bob@app01.io',
  globexAdmin: 'globex-admin@app01.io',
  globexGina:  'globex-gina@app01.io',
  globexGreg:  'globex-greg@app01.io',
} as const;

let sharedApp: INestApplication | null = null;
let sharedHttpServer: ReturnType<INestApplication['getHttpServer']> | null = null;
const sessionCookies = new Map<string, string>();

function ensureTestEnv() {
  if (process.env.RSA_PRIVATE_KEY && process.env.RSA_PUBLIC_KEY) return;
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  process.env.RSA_PRIVATE_KEY = Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' }) as string).toString('base64');
  process.env.RSA_PUBLIC_KEY = Buffer.from(publicKey.export({ type: 'spki', format: 'pem' }) as string).toString('base64');
  process.env.BETTER_AUTH_URL = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000';
  process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET ?? 'test-secret-at-least-32-chars-long!!';
}

export async function bootScenarioApp() {
  if (sharedApp && sharedHttpServer) {
    return { app: sharedApp, httpServer: sharedHttpServer };
  }
  ensureTestEnv();

  // Migrations + platform seed + demo seed (idempotent).
  if (!process.env.SCENARIO_DB_READY) {
    const { execSync } = await import('child_process');
    execSync(
      'npx prisma migrate deploy --schema=../../packages/db/schema.prisma',
      { stdio: 'inherit' },
    );
    execSync('pnpm seed', {
      stdio: 'inherit',
      cwd: process.cwd(),
      env: { ...process.env, SEED_DEMO_MULTITENANT: '1' },
    });
    process.env.SCENARIO_DB_READY = '1';
  }

  const expressApp = express();
  expressApp.all('/api/auth/*', toNodeHandler(auth));

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication(new ExpressAdapter(expressApp));
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new SentryExceptionFilter(new LoggerService()));
  await app.init();

  sharedApp = app;
  sharedHttpServer = app.getHttpServer();
  return { app, httpServer: sharedHttpServer };
}

export async function closeScenarioApp() {
  if (sharedApp) {
    await sharedApp.close();
    sharedApp = null;
    sharedHttpServer = null;
    sessionCookies.clear();
  }
}

export async function signInAs(email: string): Promise<string> {
  const cached = sessionCookies.get(email);
  if (cached) return cached;

  if (!sharedHttpServer) throw new Error('signInAs called before bootScenarioApp');

  const res = await request(sharedHttpServer)
    .post('/api/auth/sign-in/email')
    .send({ email, password: DEMO_PASSWORD })
    .expect(200);

  const setCookie = res.headers['set-cookie'] as unknown as string[] | string | undefined;
  const arr = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const pair = arr
    .map((c) => c.split(';')[0])
    .find((c) => c.startsWith('better-auth.session_token='));

  if (!pair) throw new Error(`No session cookie in sign-in response for ${email}`);

  sessionCookies.set(email, pair);
  return pair;
}

export function asEmail(email: string): {
  get(path: string): Promise<SuperResponse>;
  post(path: string, body: unknown): Promise<SuperResponse>;
  patch(path: string, body: unknown): Promise<SuperResponse>;
  put(path: string, body: unknown): Promise<SuperResponse>;
  del(path: string): Promise<SuperResponse>;
} {
  return {
    async get(path) {
      const cookie = await signInAs(email);
      return request(sharedHttpServer!).get(path).set('Cookie', cookie);
    },
    async post(path, body) {
      const cookie = await signInAs(email);
      return request(sharedHttpServer!).post(path).set('Cookie', cookie).send(body as object);
    },
    async patch(path, body) {
      const cookie = await signInAs(email);
      return request(sharedHttpServer!).patch(path).set('Cookie', cookie).send(body as object);
    },
    async put(path, body) {
      const cookie = await signInAs(email);
      return request(sharedHttpServer!).put(path).set('Cookie', cookie).send(body as object);
    },
    async del(path) {
      const cookie = await signInAs(email);
      return request(sharedHttpServer!).delete(path).set('Cookie', cookie);
    },
  };
}

/** Returns publicId of org by name within the demo app. */
export async function demoOrgIdByName(name: 'Acme' | 'Globex'): Promise<string> {
  const { prisma } = await import('@sassy-auth/db');
  const app = await prisma.saApp.findUnique({ where: { name: 'app01' } });
  if (!app) throw new Error('app01 not seeded — set SEED_DEMO_MULTITENANT=1');
  const org = await prisma.saOrg.findFirst({ where: { appId: app.id, name } });
  if (!org) throw new Error(`Demo org ${name} not seeded`);
  return org.publicId;
}

/** Returns publicId of a demo user by email. */
export async function demoUserIdByEmail(email: string): Promise<string> {
  const { prisma } = await import('@sassy-auth/db');
  const ba = await prisma.user.findUnique({ where: { email } });
  if (!ba) throw new Error(`Demo user ${email} not seeded`);
  const sa = await prisma.saUser.findUnique({ where: { betterAuthUserId: ba.id } });
  if (!sa) throw new Error(`SaUser for ${email} not found`);
  return sa.publicId;
}

/** Returns publicId of an app-perm by name within app01. */
export async function demoPermIdByName(name: 'contracts.read' | 'contracts.create' | 'org.users.manage' | 'org.roles.manage' | 'platform.users.manage'): Promise<string> {
  const { prisma } = await import('@sassy-auth/db');
  const perm = await prisma.saPermission.findUnique({ where: { name } });
  if (!perm) throw new Error(`Demo perm ${name} not seeded`);
  return perm.publicId;
}
```

- [ ] **Step 2: Commit (no test yet — tasks 21–22 consume this)**

```bash
git add apps/auth-server/test/scenarios/factories.ts
git commit -m "test(scenarios): add bootScenarioApp + demo-user helpers for multi-tenant specs"
```

---

## Task 21: Scenario spec — multi-tenant visibility

**Files:**
- Create: `apps/auth-server/test/scenarios/multitenant-visibility.spec.ts`

- [ ] **Step 1: Write the spec**

Create `apps/auth-server/test/scenarios/multitenant-visibility.spec.ts`:

```ts
import { bootScenarioApp, closeScenarioApp, asEmail, DEMO_USERS, demoOrgIdByName } from './factories';

describe('multi-tenant visibility', () => {
  beforeAll(async () => {
    await bootScenarioApp();
  });
  afterAll(async () => {
    await closeScenarioApp();
  });

  it('acme-admin sees only Acme users when scoped to their own org', async () => {
    const acmeOrgId = await demoOrgIdByName('Acme');
    const res = await asEmail(DEMO_USERS.acmeAdmin).get(`/api/users?orgId=${acmeOrgId}`);
    expect(res.status).toBe(200);
    const body = res.body as Array<{ email: string; orgId: string }>;
    expect(body).toHaveLength(3);
    expect(body.every((u) => u.orgId === acmeOrgId)).toBe(true);
    expect(body.every((u) => u.email.startsWith('acme-'))).toBe(true);
  });

  it('acme-admin is rejected (403) when querying Globex users', async () => {
    const globexOrgId = await demoOrgIdByName('Globex');
    const res = await asEmail(DEMO_USERS.acmeAdmin).get(`/api/users?orgId=${globexOrgId}`);
    expect(res.status).toBe(403);
  });

  it('acme-admin is rejected (403) when listing users without an orgId', async () => {
    const res = await asEmail(DEMO_USERS.acmeAdmin).get('/api/users');
    expect(res.status).toBe(403);
  });

  it('globex-admin sees only Globex users when scoped to their own org', async () => {
    const globexOrgId = await demoOrgIdByName('Globex');
    const res = await asEmail(DEMO_USERS.globexAdmin).get(`/api/users?orgId=${globexOrgId}`);
    expect(res.status).toBe(200);
    const body = res.body as Array<{ email: string }>;
    expect(body).toHaveLength(3);
    expect(body.every((u) => u.email.startsWith('globex-'))).toBe(true);
  });

  it('globex-admin is rejected (403) when querying Acme users', async () => {
    const acmeOrgId = await demoOrgIdByName('Acme');
    const res = await asEmail(DEMO_USERS.globexAdmin).get(`/api/users?orgId=${acmeOrgId}`);
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run the spec**

```bash
SEED_DEMO_MULTITENANT=1 pnpm --filter @sassy-auth/auth-server test test/scenarios/multitenant-visibility.spec.ts
```

Expected: all 5 tests pass.

- [ ] **Step 3: Commit**

```bash
git add apps/auth-server/test/scenarios/multitenant-visibility.spec.ts
git commit -m "test(scenarios): multi-tenant visibility — org admins can only see their own org's users"
```

---

## Task 22: Scenario spec — grant ceiling

**Files:**
- Create: `apps/auth-server/test/scenarios/multitenant-grant-ceiling.spec.ts`

- [ ] **Step 1: Write the spec**

Create `apps/auth-server/test/scenarios/multitenant-grant-ceiling.spec.ts`:

```ts
import {
  bootScenarioApp, closeScenarioApp, asEmail, DEMO_USERS,
  demoUserIdByEmail, demoPermIdByName,
} from './factories';

describe('multi-tenant grant ceiling', () => {
  beforeAll(async () => {
    await bootScenarioApp();
  });
  afterAll(async () => {
    await closeScenarioApp();
  });

  it('acme-admin can grant contracts.read to acme-alice (app perm, in-app)', async () => {
    const aliceId = await demoUserIdByEmail(DEMO_USERS.acmeAlice);
    const permId  = await demoPermIdByName('contracts.read');
    const res = await asEmail(DEMO_USERS.acmeAdmin).put(
      `/api/users/${aliceId}/direct-permissions`,
      { permissionIds: [permId] },
    );
    expect(res.status).toBe(200);
  });

  it('acme-admin can grant contracts.create to acme-bob', async () => {
    const bobId = await demoUserIdByEmail(DEMO_USERS.acmeBob);
    const permId = await demoPermIdByName('contracts.create');
    const res = await asEmail(DEMO_USERS.acmeAdmin).put(
      `/api/users/${bobId}/direct-permissions`,
      { permissionIds: [permId] },
    );
    expect(res.status).toBe(200);
  });

  it('acme-admin can grant org.users.manage to acme-alice (caller holds it, isSystem cross-app)', async () => {
    const aliceId   = await demoUserIdByEmail(DEMO_USERS.acmeAlice);
    const contractsRead   = await demoPermIdByName('contracts.read');
    const orgUsersManage  = await demoPermIdByName('org.users.manage');
    // Replace alice's grants — keep contracts.read and add org.users.manage.
    const res = await asEmail(DEMO_USERS.acmeAdmin).put(
      `/api/users/${aliceId}/direct-permissions`,
      { permissionIds: [contractsRead, orgUsersManage] },
    );
    expect(res.status).toBe(200);
  });

  it('acme-admin CANNOT grant org.roles.manage to acme-bob (caller does not hold it)', async () => {
    const bobId          = await demoUserIdByEmail(DEMO_USERS.acmeBob);
    const orgRolesManage = await demoPermIdByName('org.roles.manage');
    const res = await asEmail(DEMO_USERS.acmeAdmin).put(
      `/api/users/${bobId}/direct-permissions`,
      { permissionIds: [orgRolesManage] },
    );
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).toMatch(/org\.roles\.manage/);
  });

  it('acme-admin CANNOT grant platform.users.manage to acme-alice (cross-app, non-system)', async () => {
    const aliceId = await demoUserIdByEmail(DEMO_USERS.acmeAlice);
    const platformPerm = await demoPermIdByName('platform.users.manage');
    const res = await asEmail(DEMO_USERS.acmeAdmin).put(
      `/api/users/${aliceId}/direct-permissions`,
      { permissionIds: [platformPerm] },
    );
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/different app/);
  });

  it('acme-admin CANNOT grant contracts.read to globex-gina (cross-org)', async () => {
    const ginaId = await demoUserIdByEmail(DEMO_USERS.globexGina);
    const contractsRead = await demoPermIdByName('contracts.read');
    const res = await asEmail(DEMO_USERS.acmeAdmin).put(
      `/api/users/${ginaId}/direct-permissions`,
      { permissionIds: [contractsRead] },
    );
    expect(res.status).toBe(403);
  });
});
```

Note: the route path for setting direct permissions is `/api/users/:id/direct-permissions` based on `users.controller.ts` (verify in the spec file if it differs; the matrix tests have the exact path). If the project's controller exposes a different verb (POST instead of PUT, or a different sub-path), adjust accordingly.

- [ ] **Step 2: Run the spec**

```bash
SEED_DEMO_MULTITENANT=1 pnpm --filter @sassy-auth/auth-server test test/scenarios/multitenant-grant-ceiling.spec.ts
```

Expected: all 6 tests pass.

- [ ] **Step 3: Commit**

```bash
git add apps/auth-server/test/scenarios/multitenant-grant-ceiling.spec.ts
git commit -m "test(scenarios): grant-ceiling — org admin escalation guard end-to-end"
```

---

## Task 23: Migration test — re-point + drop of `org.permissions.manage`

**Files:**
- Create: `apps/auth-server/test/migrations/2026-06-18-org-roles-manage.spec.ts`

- [ ] **Step 1: Write the spec**

Create `apps/auth-server/test/migrations/2026-06-18-org-roles-manage.spec.ts`:

```ts
/**
 * Verifies that Migration 20260618220100_seed_role_perms_and_drop_org_permissions_manage
 * re-points org.permissions.manage grants to org.roles.manage and deletes the
 * old perm. Runs against a fresh DB primed with a pre-migration fixture, then
 * applies the migration and asserts the resulting state.
 *
 * To keep this isolated from the matrix/scenario suites, it boots its own
 * DB connection via prisma's client and assumes the migration set HAS NOT
 * yet been applied to the connected database. CI should run this against
 * a dedicated DATABASE_URL.
 */
import { prisma } from '@sassy-auth/db';

describe('migration: 20260618220100 (drop org.permissions.manage)', () => {
  it('re-points role and user grants and deletes the obsolete perm', async () => {
    // Skip if the migration has already run in the connected DB.
    const obsolete = await prisma.saPermission.findUnique({ where: { name: 'org.permissions.manage' } });
    if (!obsolete) {
      console.warn('Migration already applied; skipping re-point verification.');
      return;
    }

    // At this point the migration hasn't been applied. We expect the perm to
    // be present and any grants to be linkable. After the migration runs, the
    // following must hold:
    //   - org.permissions.manage row is gone
    //   - org.roles.manage row exists with isSystem=true
    //   - every grant that referenced the old perm now references the new one

    const { execSync } = await import('child_process');
    execSync(
      'npx prisma migrate deploy --schema=../../packages/db/schema.prisma',
      { stdio: 'inherit' },
    );

    const post = await prisma.saPermission.findUnique({ where: { name: 'org.permissions.manage' } });
    expect(post).toBeNull();

    const newPerm = await prisma.saPermission.findUnique({ where: { name: 'org.roles.manage' } });
    expect(newPerm).not.toBeNull();
    expect(newPerm!.isSystem).toBe(true);

    const platformRoles = await prisma.saPermission.findUnique({ where: { name: 'platform.roles.manage' } });
    expect(platformRoles).not.toBeNull();
    expect(platformRoles!.isSystem).toBe(false);
  });
});
```

This test is best run in CI against a dedicated DB that the test itself migrates. Locally it can be skipped (it gracefully no-ops when the migration has already run).

- [ ] **Step 2: Run the spec**

```bash
pnpm --filter @sassy-auth/auth-server test test/migrations/
```

Expected (after Task 12's migration already applied locally): skipped with the "Migration already applied" warning, test reported as passing.

- [ ] **Step 3: Commit**

```bash
git add apps/auth-server/test/migrations/2026-06-18-org-roles-manage.spec.ts
git commit -m "test(migration): verify org.permissions.manage re-point + drop"
```

---

## Task 24: E2E — multi-tenant promotion path

**Files:**
- Modify: `apps/admin-e2e/lib/admins.ts`
- Create: `apps/admin-e2e/tests/multitenant-promotion.spec.ts`

- [ ] **Step 1: Add demo-user entries to admin-e2e helpers**

In `apps/admin-e2e/lib/admins.ts`, add a section for the demo users (or a separate exported constant) so the spec can sign in as them:

```ts
export const DEMO_TENANT_USERS = {
  acmeAdmin:   { email: 'acme-admin@app01.io',   password: 'Pass@word1234' },
  acmeAlice:   { email: 'acme-alice@app01.io',   password: 'Pass@word1234' },
  acmeBob:     { email: 'acme-bob@app01.io',     password: 'Pass@word1234' },
  globexAdmin: { email: 'globex-admin@app01.io', password: 'Pass@word1234' },
} as const;
```

If `admins.ts` already has helpers like `signIn(page, admin)`, mirror that shape so the new spec can reuse them.

- [ ] **Step 2: Write the spec**

Create `apps/admin-e2e/tests/multitenant-promotion.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { DEMO_TENANT_USERS } from '../lib/admins';

test.describe('multi-tenant org admin promotes a peer', () => {
  test.beforeAll(async () => {
    // SEED_DEMO_MULTITENANT must be set when the auth-server boots.
    // The CI pipeline should set it; locally export it before `pnpm e2e`.
  });

  test('Acme admin promotes Alice to org admin and is blocked from cross-app perms', async ({ page }) => {
    // Sign in as Acme admin (mirror your repo's signIn helper).
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(DEMO_TENANT_USERS.acmeAdmin.email);
    await page.getByLabel(/password/i).fill(DEMO_TENANT_USERS.acmeAdmin.password);
    await page.getByRole('button', { name: /sign in/i }).click();

    // Sidebar should expose only Users and Roles.
    await expect(page.getByRole('link', { name: /users/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /roles/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /apps/i })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /orgs/i })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /permissions/i })).toHaveCount(0);

    // Users page lists exactly 3 Acme users (no Globex rows).
    await page.getByRole('link', { name: /users/i }).click();
    await expect(page.getByText(DEMO_TENANT_USERS.acmeAlice.email)).toBeVisible();
    await expect(page.getByText('globex-gina@app01.io')).toHaveCount(0);

    // Open Alice's row, set direct permission org.users.manage, save.
    // Concrete selectors mirror the existing roles-table/users-table e2e
    // patterns in admin-e2e. The high-level steps:
    //   1. Click Alice's row to open the View drawer.
    //   2. Open the "Direct permissions" editor.
    //   3. Add org.users.manage from the picker.
    //   4. Save and assert success toast.
    //
    // After save, attempt to add platform.users.manage — assert the
    // picker either does not list it (filtered by API) or the save
    // returns a visible error toast mentioning "different app".
  });
});
```

The exact selectors depend on the existing admin-e2e patterns. The spec body above lists the steps; if the project already has a `users-drawer` helper, use it.

- [ ] **Step 3: Run the e2e**

```bash
SEED_DEMO_MULTITENANT=1 pnpm e2e --grep 'multi-tenant'
```

(Or whatever command the admin-e2e workspace uses.) Expected: the spec passes.

- [ ] **Step 4: Commit**

```bash
git add apps/admin-e2e/lib/admins.ts apps/admin-e2e/tests/multitenant-promotion.spec.ts
git commit -m "test(e2e): multi-tenant org admin promotion path"
```

---

## Final Verification

- [ ] **Run the full auth-server test suite**

```bash
pnpm --filter @sassy-auth/auth-server test
```

Expected: every spec passes — units, matrix, scenarios, migration test.

- [ ] **Run the full admin test suite**

```bash
pnpm --filter sassy-auth-admin test
```

Expected: all passes.

- [ ] **Run the e2e suite**

```bash
SEED_DEMO_MULTITENANT=1 pnpm e2e
```

Expected: all passes including the new multi-tenant spec.

- [ ] **Smoke-test the live admin app**

```bash
pnpm dev
```

Sign in as each of: `s@sa.io` (all 5 tabs), `r@sa.io` (Roles only — under Access Control), `acme-admin@app01.io` (Users + Roles only). For the Acme admin, verify the Users list shows only Acme rows, the Roles list shows only app01 roles, and attempting to grant `platform.users.manage` to Alice via the UI surfaces the "different app" error.

- [ ] **Push and open a PR**

```bash
git push -u origin <branch-name>
gh pr create --title "feat: org-scoped multi-tenant administration" --body "$(cat <<'EOF'
## Summary
- Lets users with `org.*` permissions log into SassyAuth and self-serve user management for their own organization, with an explicit escalation ceiling at the `org.*` tier (no path to `platform.*`).
- Splits `platform.permissions.manage` into `platform.roles.manage` and `platform.permissions.manage`.
- Adds `SaPermission.isSystem`, flips `org.*` to system, extends the rename/delete immutability check to system perms.
- Drops the obsolete `org.permissions.manage` with a re-pointing migration.
- Permission-driven sidebar in the existing admin shell.
- Adds `SEED_DEMO_MULTITENANT` scenario (`app01`, `Acme`/`Globex`, 6 users, 2 org admins) plus two scenario specs that verify the visibility and grant-ceiling contracts end-to-end.

Spec: docs/superpowers/specs/2026-06-18-org-scoped-admin-design.md
Plan: docs/superpowers/plans/2026-06-18-org-scoped-admin.md

## Test plan
- [x] auth-server unit + matrix + scenario + migration specs
- [x] admin component tests (sidebar, tables, permissions UI)
- [x] admin-e2e multi-tenant promotion path
- [x] manual smoke: sign in as super, role admin, and tenant admin; verify sidebar + filtered lists + grant-ceiling
EOF
)"
```

---

## Spec coverage check

Every spec section maps to at least one task:

| Spec section | Tasks |
|---|---|
| §1 Data model (`isSystem` column) | T1 |
| §2 Permission catalog & seed | T10, T11, T12 |
| §3 Permission gate matrix | T7, T11 |
| §4(a) `resolvePermissionIdsForApp` | T2 |
| §4(b) `checkPermissionForApp` | T3 |
| §4(c) permissions immutability extension | T5 |
| §5(a) `/me` profile | T9 |
| §5(b) permission-driven sidebar | T13, T14, T15 |
| §5(c) users page filter default | T16 |
| §5(d) roles page filter default | T17 |
| §5(e) roles write affordances | T17 |
| §5(f) System badge + isSystem immutability in UI | T13, T18 |
| §6 Migration 1 (schema) | T1 |
| §6 Migration 2 (data) | T12 |
| §6 Seed updates | T10 |
| §6 Cleanup sweep (org.permissions.manage in code) | T7, T17 |
| §7 Testing strategy (units, matrix, immutability, migration, UI, e2e, orphan check) | T2–T8, T11, T15, T17, T18, T22, T23, T24, Final |
| §8 Escalation guard helper | T4 |
| §8 Guard wiring into user-assignment paths | T8 |
| §8 Demo seed scenario | T19, T20 |
| §8 Verification specs | T21, T22 |

No unmapped spec sections.
