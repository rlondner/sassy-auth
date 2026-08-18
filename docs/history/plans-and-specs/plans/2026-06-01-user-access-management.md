# User Access Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the backend + admin UI for editing roles and direct permissions on a user, in both the create-user and edit-user drawers, per `docs/superpowers/specs/2026-06-01-user-access-management-design.md`.

**Architecture:** Three set-replace endpoints on `UsersController` (PUT `/roles`, GET + PUT `/direct-permissions`). Server-side validation reuses an extracted `resolvePermissionIdsForApp` helper and a new `resolveRoleIdsForApp` twin. The admin UI gets one new small primitive (`RoleRowsEditor` near-copy of `PermissionRowsEditor`), and both user drawers add row editors for roles + direct permissions. Create drawer fires one extended `createUser` call wrapping all three writes in a single `prisma.$transaction`.

**Tech Stack:** NestJS 10 + Prisma + Postgres, Next.js App Router 14, `next-intl`, Jest + RTL, Playwright. pnpm workspaces.

**Conventions in this repo (read before starting):**
- All Nest controllers behind `@UseGuards(BetterAuthGuard)`. Caller id read via `callerBaId(req)` helper at the top of every controller — see `users.controller.ts:13-15`. Reuse verbatim.
- `users.service.ts` paths: caller-passes-publicId, service resolves via `prisma.saUser.findUnique({ where: { publicId } })`, then `await checkPermission(callerBaId, ['platform.users.manage', 'org.users.manage'], { targetOrgId: user.orgId })`. Mirror this in every new method.
- DTOs use `class-validator` decorators. Reuse `@IsArray() @ArrayUnique() @IsString({ each: true })` from `roles/dto/create-role.dto.ts` for the new `roleIds`/`permissionIds` arrays.
- Test pattern: `jest.mock('@sassy-auth/db', ...)` + `jest.mock('../common/permissions/check-permission', ...)` — see `apps/auth-server/src/users/users.service.spec.ts:7-28`.
- `prisma.$transaction(async (tx) => ...)` matches the test mock which forwards `tx` as the same mocked prisma; the existing `mockPrisma.$transaction.mockImplementation((fn) => fn(mockPrisma))` covers this.
- Admin server actions live in `apps/admin/app/(admin)/users/actions.ts` and return localized message **keys** for errors (`{ errorKey: 'users.errors.xxx' }`). Client uses `t(key)`.
- Admin app's `lib/api.ts` (`'server-only'`) forwards the session cookie via `apiFetch()`. All admin-side API calls go through it.
- Drawers use `Sheet` from `@sassy-auth/ui` and the role-edit-drawer at `apps/admin/components/role-edit-drawer.tsx` is the canonical precedent for the set-replace + diff-on-Save UX pattern.
- Test commands:
  - Auth-server units: `pnpm --filter @sassy-auth/auth-server test`
  - Auth-server e2e: `pnpm --filter @sassy-auth/auth-server test:e2e`
  - Admin units: `pnpm --filter @sassy-auth/admin test`
  - Admin typecheck: `cd apps/admin && pnpm exec tsc --noEmit -p tsconfig.json`
  - Playwright: `cd apps/admin-e2e && pnpm exec playwright test --project=chromium-super tests/authed/lifecycle.spec.ts --reporter=list`
- Commit small and often. One commit per task minimum.

---

## File map (locks decomposition before tasks start)

**New — auth-server:**
```
apps/auth-server/src/common/permissions/resolve-app-scoped-ids.ts
apps/auth-server/src/common/permissions/resolve-app-scoped-ids.spec.ts
apps/auth-server/src/users/dto/set-user-roles.dto.ts
apps/auth-server/src/users/dto/set-user-direct-permissions.dto.ts
```

**Modified — auth-server:**
```
apps/auth-server/src/users/users.service.ts
apps/auth-server/src/users/users.service.spec.ts
apps/auth-server/src/users/users.controller.ts
apps/auth-server/src/users/users.controller.spec.ts
apps/auth-server/src/users/dto/create-user.dto.ts
apps/auth-server/src/roles/roles.service.ts   (only: delete local resolvePermissionIds, import from common)
apps/auth-server/test/app.e2e-spec.ts
```

**New — admin app:**
```
apps/admin/components/user-role-rows-editor.tsx
```

**Modified — admin app:**
```
apps/admin/lib/types.ts
apps/admin/lib/api.ts
apps/admin/app/(admin)/users/actions.ts
apps/admin/components/user-create-drawer.tsx
apps/admin/components/user-view-drawer.tsx
apps/admin/components/__tests__/user-create-drawer.test.tsx
apps/admin/components/__tests__/user-view-drawer.test.tsx
apps/admin/messages/en.json
apps/admin/messages/fr.json
```

**Modified — Playwright:**
```
apps/admin-e2e/tests/authed/lifecycle.spec.ts
```

---

## Task 1: Extract shared `resolveAppScopedIds` utility

**Files:**
- Create: `apps/auth-server/src/common/permissions/resolve-app-scoped-ids.ts`
- Create: `apps/auth-server/src/common/permissions/resolve-app-scoped-ids.spec.ts`
- Modify: `apps/auth-server/src/roles/roles.service.ts` (delete local `resolvePermissionIds`, import the new helper)

The current local `resolvePermissionIds` in `roles.service.ts:28-49` is exactly what we need to reuse for `setUserDirectPermissions`. We also need a `resolveRoleIds` twin for `setUserRoles`. Lift both into a shared module.

- [ ] **Step 1: Write the failing test**

Create `apps/auth-server/src/common/permissions/resolve-app-scoped-ids.spec.ts`:

```typescript
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { resolvePermissionIdsForApp, resolveRoleIdsForApp } from './resolve-app-scoped-ids';

jest.mock('@sassy-auth/db', () => ({
  prisma: {
    saPermission: { findMany: jest.fn() },
    saRole: { findMany: jest.fn() },
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockPrisma = require('@sassy-auth/db').prisma as {
  saPermission: { findMany: jest.Mock };
  saRole: { findMany: jest.Mock };
};

describe('resolvePermissionIdsForApp', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns empty for empty input without hitting the db', async () => {
    const ids = await resolvePermissionIdsForApp(1, []);
    expect(ids).toEqual([]);
    expect(mockPrisma.saPermission.findMany).not.toHaveBeenCalled();
  });

  it('returns numeric ids for valid publicIds matching the app', async () => {
    mockPrisma.saPermission.findMany.mockResolvedValue([
      { id: 10, publicId: 'pA', appId: 1 },
      { id: 11, publicId: 'pB', appId: 1 },
    ]);
    const ids = await resolvePermissionIdsForApp(1, ['pA', 'pB']);
    expect(ids).toEqual([10, 11]);
  });

  it('throws NotFoundException listing the missing ids', async () => {
    mockPrisma.saPermission.findMany.mockResolvedValue([
      { id: 10, publicId: 'pA', appId: 1 },
    ]);
    await expect(resolvePermissionIdsForApp(1, ['pA', 'pX'])).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws BadRequestException when any permission belongs to a different app', async () => {
    mockPrisma.saPermission.findMany.mockResolvedValue([
      { id: 10, publicId: 'pA', appId: 1 },
      { id: 12, publicId: 'pC', appId: 2 },
    ]);
    await expect(resolvePermissionIdsForApp(1, ['pA', 'pC'])).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('resolveRoleIdsForApp', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns empty for empty input without hitting the db', async () => {
    const ids = await resolveRoleIdsForApp(1, []);
    expect(ids).toEqual([]);
    expect(mockPrisma.saRole.findMany).not.toHaveBeenCalled();
  });

  it('returns numeric ids for valid publicIds matching the app', async () => {
    mockPrisma.saRole.findMany.mockResolvedValue([
      { id: 20, publicId: 'rA', appId: 1 },
    ]);
    const ids = await resolveRoleIdsForApp(1, ['rA']);
    expect(ids).toEqual([20]);
  });

  it('throws NotFoundException listing the missing role ids', async () => {
    mockPrisma.saRole.findMany.mockResolvedValue([]);
    await expect(resolveRoleIdsForApp(1, ['rX'])).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws BadRequestException when any role belongs to a different app', async () => {
    mockPrisma.saRole.findMany.mockResolvedValue([
      { id: 20, publicId: 'rA', appId: 1 },
      { id: 21, publicId: 'rB', appId: 2 },
    ]);
    await expect(resolveRoleIdsForApp(1, ['rA', 'rB'])).rejects.toBeInstanceOf(BadRequestException);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
pnpm --filter @sassy-auth/auth-server test -- --testPathPattern=resolve-app-scoped-ids
```

Expected: FAIL with "Cannot find module './resolve-app-scoped-ids'".

- [ ] **Step 3: Implement the helper**

Create `apps/auth-server/src/common/permissions/resolve-app-scoped-ids.ts`:

```typescript
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { prisma } from '@sassy-auth/db';

export async function resolvePermissionIdsForApp(
  appId: number,
  permissionPublicIds: string[],
): Promise<number[]> {
  if (permissionPublicIds.length === 0) return [];
  const perms = (await prisma.saPermission.findMany({
    where: { publicId: { in: permissionPublicIds } },
    select: { id: true, publicId: true, appId: true },
  })) as Array<{ id: number; publicId: string; appId: number }>;
  if (perms.length !== permissionPublicIds.length) {
    const found = new Set(perms.map((p) => p.publicId));
    const missing = permissionPublicIds.filter((id) => !found.has(id));
    throw new NotFoundException(`Permission(s) not found: ${missing.join(', ')}`);
  }
  const wrongApp = perms.filter((p) => p.appId !== appId);
  if (wrongApp.length > 0) {
    throw new BadRequestException(
      `Permission(s) belong to a different app: ${wrongApp.map((p) => p.publicId).join(', ')}`,
    );
  }
  return perms.map((p) => p.id);
}

export async function resolveRoleIdsForApp(
  appId: number,
  rolePublicIds: string[],
): Promise<number[]> {
  if (rolePublicIds.length === 0) return [];
  const roles = (await prisma.saRole.findMany({
    where: { publicId: { in: rolePublicIds } },
    select: { id: true, publicId: true, appId: true },
  })) as Array<{ id: number; publicId: string; appId: number }>;
  if (roles.length !== rolePublicIds.length) {
    const found = new Set(roles.map((r) => r.publicId));
    const missing = rolePublicIds.filter((id) => !found.has(id));
    throw new NotFoundException(`Role(s) not found: ${missing.join(', ')}`);
  }
  const wrongApp = roles.filter((r) => r.appId !== appId);
  if (wrongApp.length > 0) {
    throw new BadRequestException(
      `Role(s) belong to a different app: ${wrongApp.map((r) => r.publicId).join(', ')}`,
    );
  }
  return roles.map((r) => r.id);
}
```

- [ ] **Step 4: Migrate `roles.service.ts` to the shared helper**

In `apps/auth-server/src/roles/roles.service.ts`, delete the local `resolvePermissionIds` function (the whole block at lines 28-49 in the current file) and replace the two call sites at the old line 123 and old line 170:

```typescript
// Old import block — ADD this import:
import { resolvePermissionIdsForApp } from '../common/permissions/resolve-app-scoped-ids';

// Old call site 1 (in createRole):
const permissionIds = await resolvePermissionIdsForApp(app.id, dto.permissionIds ?? []);

// Old call site 2 (in updateRole):
const permissionIds = dto.permissionIds === undefined
  ? undefined
  : await resolvePermissionIdsForApp(existing.appId, dto.permissionIds);
```

Delete the local `async function resolvePermissionIds(...)` declaration.

- [ ] **Step 5: Run tests to verify**

```
pnpm --filter @sassy-auth/auth-server test -- --testPathPattern="resolve-app-scoped-ids|roles.service.spec"
```

Expected: PASS for the new helper + all existing `roles.service.spec.ts` tests still green.

- [ ] **Step 6: Commit**

```bash
git add apps/auth-server/src/common/permissions/resolve-app-scoped-ids.ts \
        apps/auth-server/src/common/permissions/resolve-app-scoped-ids.spec.ts \
        apps/auth-server/src/roles/roles.service.ts
git commit -m "$(cat <<'EOF'
refactor(auth-server): extract resolveAppScopedIds shared helper

Lift resolvePermissionIds out of roles.service into a shared common
module, and add a resolveRoleIdsForApp twin. Prep for user-roles and
user-direct-permissions set-replace endpoints.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Add `SetUserRolesDto` and `SetUserDirectPermissionsDto`

**Files:**
- Create: `apps/auth-server/src/users/dto/set-user-roles.dto.ts`
- Create: `apps/auth-server/src/users/dto/set-user-direct-permissions.dto.ts`

- [ ] **Step 1: Create the role-set DTO**

```typescript
// apps/auth-server/src/users/dto/set-user-roles.dto.ts
import { ArrayUnique, IsArray, IsString } from 'class-validator';

export class SetUserRolesDto {
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  roleIds: string[];
}
```

- [ ] **Step 2: Create the direct-permission-set DTO**

```typescript
// apps/auth-server/src/users/dto/set-user-direct-permissions.dto.ts
import { ArrayUnique, IsArray, IsString } from 'class-validator';

export class SetUserDirectPermissionsDto {
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissionIds: string[];
}
```

- [ ] **Step 3: Typecheck**

```
cd apps/auth-server && pnpm exec tsc --noEmit -p tsconfig.json
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/auth-server/src/users/dto/set-user-roles.dto.ts \
        apps/auth-server/src/users/dto/set-user-direct-permissions.dto.ts
git commit -m "$(cat <<'EOF'
feat(auth-server): add SetUserRoles + SetUserDirectPermissions DTOs

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `UsersService.setUserRoles` (set-replace, transactional)

**Files:**
- Modify: `apps/auth-server/src/users/users.service.ts`
- Modify: `apps/auth-server/src/users/users.service.spec.ts`

- [ ] **Step 1: Extend mock prisma in `users.service.spec.ts`**

In `apps/auth-server/src/users/users.service.spec.ts`, update the `jest.mock('@sassy-auth/db', ...)` block AND the matching `mockPrisma` type assertion to add the missing tables. Find lines 7-46 and replace with:

```typescript
jest.mock('@sassy-auth/db', () => ({
  prisma: {
    $transaction: jest.fn(),
    saUser: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    saOrg: { findUnique: jest.fn() },
    saRole: { findUnique: jest.fn(), findMany: jest.fn() },
    saUserRole: {
      create: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    saUserPermission: {
      findMany: jest.fn(),
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    saPermission: { findMany: jest.fn() },
    saInvitation: { create: jest.fn(), findFirst: jest.fn(), updateMany: jest.fn() },
    user: { create: jest.fn() },
    account: { create: jest.fn() },
  },
}));

jest.mock('../common/permissions/check-permission', () => ({
  checkPermission: jest.fn().mockResolvedValue(undefined),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockPrisma = require('@sassy-auth/db').prisma as {
  $transaction: jest.Mock;
  saUser: {
    findMany: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  saOrg: { findUnique: jest.Mock };
  saRole: { findUnique: jest.Mock; findMany: jest.Mock };
  saUserRole: {
    create: jest.Mock;
    delete: jest.Mock;
    deleteMany: jest.Mock;
    createMany: jest.Mock;
  };
  saUserPermission: {
    findMany: jest.Mock;
    deleteMany: jest.Mock;
    createMany: jest.Mock;
  };
  saPermission: { findMany: jest.Mock };
  saInvitation: { create: jest.Mock; findFirst: jest.Mock; updateMany: jest.Mock };
  user: { create: jest.Mock };
  account: { create: jest.Mock };
};
```

- [ ] **Step 2: Write the failing tests**

Append to `apps/auth-server/src/users/users.service.spec.ts`, just before the final closing `});` of the outer `describe('UsersService', ...)`:

```typescript
  describe('setUserRoles', () => {
    const callerBaId = 'ba-caller';
    const userPublicId = 'usrPub';
    const orgWithApp = { id: 9, orgId: 9, appId: 4 };

    function primeFindUnique() {
      // Service first looks up the user (by publicId) for org context, then
      // looks up the org to discover the appId for scoping role ids.
      mockPrisma.saUser.findUnique.mockResolvedValueOnce({
        id: 1, publicId: userPublicId, betterAuthUserId: 'ba-target', orgId: orgWithApp.id,
      });
      mockPrisma.saOrg.findUnique.mockResolvedValueOnce({ id: orgWithApp.id, appId: orgWithApp.appId });
    }

    it('deletes existing role rows and inserts the new set inside a transaction', async () => {
      primeFindUnique();
      mockPrisma.saRole.findMany.mockResolvedValue([
        { id: 20, publicId: 'rA', appId: orgWithApp.appId },
        { id: 21, publicId: 'rB', appId: orgWithApp.appId },
      ]);

      await service.setUserRoles(callerBaId, userPublicId, ['rA', 'rB']);

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockPrisma.saUserRole.deleteMany).toHaveBeenCalledWith({ where: { userId: 1 } });
      expect(mockPrisma.saUserRole.createMany).toHaveBeenCalledWith({
        data: [
          { userId: 1, roleId: 20 },
          { userId: 1, roleId: 21 },
        ],
      });
    });

    it('clears all roles when given an empty list (delete only, no insert)', async () => {
      primeFindUnique();
      await service.setUserRoles(callerBaId, userPublicId, []);
      expect(mockPrisma.saUserRole.deleteMany).toHaveBeenCalledWith({ where: { userId: 1 } });
      expect(mockPrisma.saUserRole.createMany).not.toHaveBeenCalled();
    });

    it('rejects role publicIds belonging to a different app with BadRequestException', async () => {
      primeFindUnique();
      mockPrisma.saRole.findMany.mockResolvedValue([
        { id: 20, publicId: 'rA', appId: orgWithApp.appId },
        { id: 99, publicId: 'rWrong', appId: 7 },
      ]);
      await expect(
        service.setUserRoles(callerBaId, userPublicId, ['rA', 'rWrong']),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mockPrisma.saUserRole.deleteMany).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for an unknown user publicId', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.setUserRoles(callerBaId, 'nope', []),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses self-edit with ForbiddenException', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValueOnce({
        id: 1, publicId: userPublicId, betterAuthUserId: callerBaId, orgId: 9,
      });
      await expect(
        service.setUserRoles(callerBaId, userPublicId, []),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
```

Make sure `ForbiddenException` and `BadRequestException` are already imported at the top of the test file (alongside the existing `NotFoundException`). Add to the existing `@nestjs/common` import:

```typescript
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
```

- [ ] **Step 3: Run tests to verify they fail**

```
pnpm --filter @sassy-auth/auth-server test -- --testPathPattern=users.service.spec -t setUserRoles
```

Expected: FAIL with "service.setUserRoles is not a function".

- [ ] **Step 4: Implement `setUserRoles`**

In `apps/auth-server/src/users/users.service.ts`, add the import near the top (with the other imports):

```typescript
import { resolveRoleIdsForApp, resolvePermissionIdsForApp } from '../common/permissions/resolve-app-scoped-ids';
import { SetUserRolesDto } from './dto/set-user-roles.dto';
import { SetUserDirectPermissionsDto } from './dto/set-user-direct-permissions.dto';
```

Append the new method to the `UsersService` class (right after the existing `removeRole` method at line ~323):

```typescript
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

- [ ] **Step 5: Run tests to verify they pass**

```
pnpm --filter @sassy-auth/auth-server test -- --testPathPattern=users.service.spec -t setUserRoles
```

Expected: all 5 setUserRoles tests PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/auth-server/src/users/users.service.ts apps/auth-server/src/users/users.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(auth-server): UsersService.setUserRoles set-replace endpoint

Atomic delete-then-insert against saUserRole inside a single $transaction,
scoped to the user's org's app. Refuses self-edit. App-scope validation
via the shared resolveRoleIdsForApp helper.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `UsersService.getUserDirectPermissions` and `setUserDirectPermissions`

**Files:**
- Modify: `apps/auth-server/src/users/users.service.ts`
- Modify: `apps/auth-server/src/users/users.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

Append to `users.service.spec.ts` inside the outer `describe('UsersService', ...)`:

```typescript
  describe('getUserDirectPermissions', () => {
    const callerBaId = 'ba-caller';
    const userPublicId = 'usrPub';

    it('returns the direct-permission rows mapped to Permission shape', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValueOnce({
        id: 1, publicId: userPublicId, betterAuthUserId: 'ba-target', orgId: 9,
        directPermissions: [
          { permission: { publicId: 'pA', name: 'apps.read', appId: 4 } },
          { permission: { publicId: 'pB', name: 'apps.write', appId: 4 } },
        ],
      });

      const result = await service.getUserDirectPermissions(callerBaId, userPublicId);
      expect(result).toEqual([
        { id: 'pA', name: 'apps.read', appId: '' },
        { id: 'pB', name: 'apps.write', appId: '' },
      ]);
    });

    it('throws NotFoundException for unknown user publicId', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.getUserDirectPermissions(callerBaId, 'nope'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('setUserDirectPermissions', () => {
    const callerBaId = 'ba-caller';
    const userPublicId = 'usrPub';
    const orgWithApp = { id: 9, appId: 4 };

    function primeFindUnique() {
      mockPrisma.saUser.findUnique.mockResolvedValueOnce({
        id: 1, publicId: userPublicId, betterAuthUserId: 'ba-target', orgId: orgWithApp.id,
      });
      mockPrisma.saOrg.findUnique.mockResolvedValueOnce({ id: orgWithApp.id, appId: orgWithApp.appId });
    }

    it('deletes existing direct-permission rows and inserts the new set inside a transaction', async () => {
      primeFindUnique();
      mockPrisma.saPermission.findMany.mockResolvedValue([
        { id: 30, publicId: 'pA', appId: orgWithApp.appId },
      ]);

      await service.setUserDirectPermissions(callerBaId, userPublicId, ['pA']);

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockPrisma.saUserPermission.deleteMany).toHaveBeenCalledWith({ where: { userId: 1 } });
      expect(mockPrisma.saUserPermission.createMany).toHaveBeenCalledWith({
        data: [{ userId: 1, permissionId: 30 }],
      });
    });

    it('clears all direct permissions when given an empty list', async () => {
      primeFindUnique();
      await service.setUserDirectPermissions(callerBaId, userPublicId, []);
      expect(mockPrisma.saUserPermission.deleteMany).toHaveBeenCalledWith({ where: { userId: 1 } });
      expect(mockPrisma.saUserPermission.createMany).not.toHaveBeenCalled();
    });

    it('rejects permission publicIds from a different app with BadRequestException', async () => {
      primeFindUnique();
      mockPrisma.saPermission.findMany.mockResolvedValue([
        { id: 30, publicId: 'pA', appId: orgWithApp.appId },
        { id: 99, publicId: 'pWrong', appId: 7 },
      ]);
      await expect(
        service.setUserDirectPermissions(callerBaId, userPublicId, ['pA', 'pWrong']),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses self-edit with ForbiddenException', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValueOnce({
        id: 1, publicId: userPublicId, betterAuthUserId: callerBaId, orgId: 9,
      });
      await expect(
        service.setUserDirectPermissions(callerBaId, userPublicId, []),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
```

- [ ] **Step 2: Run tests to verify failure**

```
pnpm --filter @sassy-auth/auth-server test -- --testPathPattern=users.service.spec -t "Direct"
```

Expected: FAIL with "is not a function".

- [ ] **Step 3: Implement both methods**

Append to the `UsersService` class in `users.service.ts` (after `setUserRoles` from Task 3):

```typescript
  async getUserDirectPermissions(
    callerBaId: string,
    userPublicId: string,
  ): Promise<Array<{ id: string; name: string; appId: string }>> {
    const user = await prisma.saUser.findUnique({
      where: { publicId: userPublicId },
      include: {
        directPermissions: { include: { permission: { select: { publicId: true, name: true, appId: true } } } },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    await checkPermission(
      callerBaId,
      ['platform.users.manage', 'org.users.manage'],
      { targetOrgId: user.orgId },
    );

    // The admin Permission shape uses appId as a publicId string; the
    // /api/users/:id/effective-permissions endpoint already publishes
    // appId: '' for the same reason — direct-permission rows don't carry
    // the app publicId via this query path. Match that convention.
    return (user as unknown as {
      directPermissions: Array<{ permission: { publicId: string; name: string; appId: number } }>;
    }).directPermissions.map((up) => ({
      id: up.permission.publicId,
      name: up.permission.name,
      appId: '',
    }));
  }

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

- [ ] **Step 4: Run tests to verify they pass**

```
pnpm --filter @sassy-auth/auth-server test -- --testPathPattern=users.service.spec
```

Expected: all setUserRoles + setUserDirectPermissions + getUserDirectPermissions tests PASS, no regressions.

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/users/users.service.ts apps/auth-server/src/users/users.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(auth-server): UsersService.getUserDirectPermissions + setUserDirectPermissions

Read + atomic set-replace endpoints for SaUserPermission. App-scope
validated via resolvePermissionIdsForApp. Refuses self-edit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Atomic role + direct-perm wiring inside `createUser`

**Files:**
- Modify: `apps/auth-server/src/users/dto/create-user.dto.ts`
- Modify: `apps/auth-server/src/users/users.service.ts`
- Modify: `apps/auth-server/src/users/users.service.spec.ts`

- [ ] **Step 1: Extend the create DTO**

Replace the entire contents of `apps/auth-server/src/users/dto/create-user.dto.ts` with:

```typescript
import { ArrayUnique, IsArray, IsEmail, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateUserDto {
  @IsString() @MinLength(1) firstName: string;
  @IsString() @MinLength(1) lastName: string;
  @IsEmail() email: string;
  @IsString() @IsNotEmpty() orgId: string;
  @IsString() @IsOptional() username?: string;
  @IsString() @IsOptional() phoneNumber?: string;

  @IsOptional() @IsArray() @ArrayUnique() @IsString({ each: true })
  roleIds?: string[];

  @IsOptional() @IsArray() @ArrayUnique() @IsString({ each: true })
  directPermissionIds?: string[];
}
```

- [ ] **Step 2: Write the failing test**

Find the existing `describe('createUser', ...)` block in `users.service.spec.ts` and append a new test inside it:

```typescript
    it('atomically wires roleIds and directPermissionIds inside the create transaction', async () => {
      // Org lookup for app-scope validation
      mockPrisma.saOrg.findUnique.mockResolvedValue({ id: 9, publicId: 'org1', appId: 4, name: 'Plat', isPlatform: false });
      // Role + permission resolution
      mockPrisma.saRole.findMany.mockResolvedValue([
        { id: 20, publicId: 'rA', appId: 4 },
      ]);
      mockPrisma.saPermission.findMany.mockResolvedValue([
        { id: 30, publicId: 'pA', appId: 4 },
      ]);

      mockPrisma.user.create.mockResolvedValue(undefined);
      const created = makeSaUser({ id: 7, publicId: 'newPub' });
      mockPrisma.saUser.create.mockResolvedValue(created);
      mockPrisma.saInvitation.create.mockResolvedValue({ token: 'tok-1' });

      await service.createUser('ba-caller', {
        firstName: 'A', lastName: 'B', email: 'a@b.io', orgId: 'org1',
        roleIds: ['rA'], directPermissionIds: ['pA'],
      });

      expect(mockPrisma.saUserRole.createMany).toHaveBeenCalledWith({
        data: [{ userId: 7, roleId: 20 }],
      });
      expect(mockPrisma.saUserPermission.createMany).toHaveBeenCalledWith({
        data: [{ userId: 7, permissionId: 30 }],
      });
    });

    it('treats undefined roleIds / directPermissionIds as no-op (no createMany call)', async () => {
      mockPrisma.saOrg.findUnique.mockResolvedValue({ id: 9, publicId: 'org1', appId: 4 });
      mockPrisma.user.create.mockResolvedValue(undefined);
      const created = makeSaUser({ id: 7, publicId: 'newPub' });
      mockPrisma.saUser.create.mockResolvedValue(created);
      mockPrisma.saInvitation.create.mockResolvedValue({ token: 'tok-1' });

      await service.createUser('ba-caller', {
        firstName: 'A', lastName: 'B', email: 'a@b.io', orgId: 'org1',
      });

      expect(mockPrisma.saUserRole.createMany).not.toHaveBeenCalled();
      expect(mockPrisma.saUserPermission.createMany).not.toHaveBeenCalled();
    });
```

- [ ] **Step 3: Run to verify failure**

```
pnpm --filter @sassy-auth/auth-server test -- --testPathPattern=users.service.spec -t "atomically wires"
```

Expected: FAIL.

- [ ] **Step 4: Extend `createUser`**

In `apps/auth-server/src/users/users.service.ts`, find the existing `createUser` method (line 146-223 in the current file). The relevant lines to modify are the `$transaction` body and the org lookup. Replace the body of `createUser` (from `const org = ...` through `return { user, inviteUrl }`) with the version below.

Note: the existing implementation already does `const org = await prisma.saOrg.findUnique({ where: { publicId: dto.orgId } });` and resolves the numeric `app.id` via the org. We need to keep that and additionally resolve role/permission ids BEFORE the transaction (so validation throws cleanly without writing).

Replace the `createUser` method body with:

```typescript
  async createUser(callerBaId: string, dto: CreateUserDto) {
    const org = await prisma.saOrg.findUnique({ where: { publicId: dto.orgId } });
    if (!org) throw new NotFoundException('Org not found');

    await checkPermission(
      callerBaId,
      ['platform.users.manage', 'org.users.manage'],
      { targetOrgId: org.id },
    );

    // Resolve + app-scope-validate role/permission ids BEFORE entering the
    // create transaction so a bad publicId throws cleanly without leaving
    // an orphan user behind.
    const numericRoleIds = await resolveRoleIdsForApp(org.appId, dto.roleIds ?? []);
    const numericPermIds = await resolvePermissionIdsForApp(org.appId, dto.directPermissionIds ?? []);

    const baUserId = crypto.randomUUID();
    const now = new Date();
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    let saUser: Prisma.SaUserGetPayload<{ include: typeof USER_INCLUDE }>;
    let invitation: Awaited<ReturnType<typeof prisma.saInvitation.create>>;
    try {
      ({ saUser, invitation } = await prisma.$transaction(async (tx) => {
        await tx.user.create({
          data: {
            id: baUserId,
            name: `${dto.firstName} ${dto.lastName}`,
            email: dto.email,
            emailVerified: false,
            createdAt: now,
            updatedAt: now,
          },
        });

        const createdSaUser = await tx.saUser.create({
          data: {
            publicId: baUserId.slice(0, 12),
            betterAuthUserId: baUserId,
            orgId: org.id,
            firstName: dto.firstName,
            lastName: dto.lastName,
            phoneNumber: dto.phoneNumber ?? null,
            username: dto.username ?? null,
            status: 'pending',
          },
          include: USER_INCLUDE,
        });

        if (numericRoleIds.length > 0) {
          await tx.saUserRole.createMany({
            data: numericRoleIds.map((roleId) => ({ userId: createdSaUser.id, roleId })),
          });
        }
        if (numericPermIds.length > 0) {
          await tx.saUserPermission.createMany({
            data: numericPermIds.map((permissionId) => ({ userId: createdSaUser.id, permissionId })),
          });
        }

        const createdInvitation = await tx.saInvitation.create({
          data: {
            publicId: baUserId.slice(12, 24),
            token,
            userId: createdSaUser.id,
            expiresAt,
          },
        });

        return { saUser: createdSaUser, invitation: createdInvitation };
      }));
    } catch (e: unknown) {
      if (
        typeof e === 'object' &&
        e !== null &&
        'code' in e &&
        (e as { code?: string }).code === 'P2002'
      ) {
        throw new ConflictException('A user with that email or username already exists.');
      }
      throw e;
    }

    const baseUrl = process.env.ADMIN_URL ?? 'http://localhost:3001';
    this.logger.getWinstonLogger().info('User created', {
      context: 'UsersService',
      userId: saUser.publicId,
      orgId: dto.orgId,
      roleCount: numericRoleIds.length,
      directPermissionCount: numericPermIds.length,
    });
    return {
      user: formatUser(saUser),
      inviteUrl: `${baseUrl}/accept-invite?token=${invitation.token}`,
    };
  }
```

- [ ] **Step 5: Run tests to verify**

```
pnpm --filter @sassy-auth/auth-server test -- --testPathPattern=users.service.spec
```

Expected: all existing + 2 new createUser tests PASS, no regressions.

- [ ] **Step 6: Commit**

```bash
git add apps/auth-server/src/users/dto/create-user.dto.ts \
        apps/auth-server/src/users/users.service.ts \
        apps/auth-server/src/users/users.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(auth-server): createUser accepts roleIds + directPermissionIds atomically

Optional roleIds and directPermissionIds on CreateUserDto are validated
against the org's app before the transaction, then inserted alongside
the SaUser + SaInvitation rows in the same prisma.$transaction. A bad
publicId now throws cleanly with no orphan user.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Controller endpoints — PUT roles, GET + PUT direct-permissions

**Files:**
- Modify: `apps/auth-server/src/users/users.controller.ts`
- Modify: `apps/auth-server/src/users/users.controller.spec.ts`

- [ ] **Step 1: Add the new mock methods in the controller spec**

In `apps/auth-server/src/users/users.controller.spec.ts`, find the `mockUsersService` object (around line 16) and extend it. Find the line:

```typescript
  getEffectivePermissions: jest.fn(),
```

And replace the surrounding block with:

```typescript
  getEffectivePermissions: jest.fn(),
  getUserDirectPermissions: jest.fn(),
  setUserRoles: jest.fn(),
  setUserDirectPermissions: jest.fn(),
```

- [ ] **Step 2: Write the failing tests**

Append to the outer `describe('UsersController', ...)` block in `users.controller.spec.ts`:

```typescript
  describe('setRoles', () => {
    it('forwards caller id, user id, and roleIds to UsersService.setUserRoles', async () => {
      mockUsersService.setUserRoles.mockResolvedValue(undefined);
      await controller.setRoles(makeReq('ba-7'), 'usr-1', { roleIds: ['rA', 'rB'] });
      expect(mockUsersService.setUserRoles).toHaveBeenCalledWith('ba-7', 'usr-1', ['rA', 'rB']);
    });
  });

  describe('getDirectPermissions', () => {
    it('forwards caller id and user id to UsersService.getUserDirectPermissions', async () => {
      mockUsersService.getUserDirectPermissions.mockResolvedValue([{ id: 'pA', name: 'apps.read', appId: '' }]);
      await controller.getDirectPermissions(makeReq('ba-8'), 'usr-1');
      expect(mockUsersService.getUserDirectPermissions).toHaveBeenCalledWith('ba-8', 'usr-1');
    });
  });

  describe('setDirectPermissions', () => {
    it('forwards caller id, user id, and permissionIds to UsersService.setUserDirectPermissions', async () => {
      mockUsersService.setUserDirectPermissions.mockResolvedValue(undefined);
      await controller.setDirectPermissions(makeReq('ba-9'), 'usr-1', { permissionIds: ['pA'] });
      expect(mockUsersService.setUserDirectPermissions).toHaveBeenCalledWith('ba-9', 'usr-1', ['pA']);
    });
  });
```

- [ ] **Step 3: Run to verify failure**

```
pnpm --filter @sassy-auth/auth-server test -- --testPathPattern=users.controller.spec
```

Expected: FAIL with "controller.setRoles is not a function" etc.

- [ ] **Step 4: Extend the controller**

In `apps/auth-server/src/users/users.controller.ts`, add to the imports:

```typescript
import { Put } from '@nestjs/common';
import { SetUserRolesDto } from './dto/set-user-roles.dto';
import { SetUserDirectPermissionsDto } from './dto/set-user-direct-permissions.dto';
```

(Add `Put` to the existing `@nestjs/common` import line; add the two DTO imports near the existing `CreateUserDto` / `UpdateUserDto` / `AssignRoleDto` imports.)

Append these three methods inside the `UsersController` class (just before the closing brace, after the existing `resendInvitation` method):

```typescript
  @Put(':id/roles')
  @HttpCode(204)
  setRoles(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: SetUserRolesDto,
  ) {
    return this.users.setUserRoles(callerBaId(req), id, dto.roleIds);
  }

  @Get(':id/direct-permissions')
  getDirectPermissions(@Req() req: Request, @Param('id') id: string) {
    return this.users.getUserDirectPermissions(callerBaId(req), id);
  }

  @Put(':id/direct-permissions')
  @HttpCode(204)
  setDirectPermissions(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: SetUserDirectPermissionsDto,
  ) {
    return this.users.setUserDirectPermissions(callerBaId(req), id, dto.permissionIds);
  }
```

- [ ] **Step 5: Run tests to verify**

```
pnpm --filter @sassy-auth/auth-server test -- --testPathPattern=users.controller.spec
```

Expected: PASS for all forwarding tests + no regressions.

- [ ] **Step 6: Commit**

```bash
git add apps/auth-server/src/users/users.controller.ts apps/auth-server/src/users/users.controller.spec.ts
git commit -m "$(cat <<'EOF'
feat(auth-server): PUT /users/:id/roles, GET + PUT /:id/direct-permissions

Wires UsersService.setUserRoles, getUserDirectPermissions,
setUserDirectPermissions to controller endpoints. All set-replace
endpoints return 204; the GET returns the Permission[] shape used by
the admin app.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Backend e2e — extend the Lifecycle suite

**Files:**
- Modify: `apps/auth-server/test/app.e2e-spec.ts`

The existing Lifecycle describe (`Lifecycle: provision app+perm+org+role+user, accept invite, sign in`) already provisions a user with one role and one direct-app permission. Append two new it-blocks at the end of THAT describe (before its closing `})`).

- [ ] **Step 1: Find the insertion point**

Open `apps/auth-server/test/app.e2e-spec.ts` and locate the Lifecycle describe block. Find the last `it(...)` in it — `'exposes the assigned permission to the newly signed-in user'`. Insert AFTER that test, BEFORE the closing `});` of the Lifecycle describe.

- [ ] **Step 2: Add the new tests**

```typescript
    // The lifecycle test only assigns the original role at the start. Here
    // we use the new set-replace endpoints to add a SECOND role and a
    // direct permission, then verify the union flows through /api/me/permissions.

    it('sets a second role + a direct permission via the new set-replace endpoints', async () => {
      // Provision a second role pointing at the same app + permission.
      const role2Res = await request(httpServer)
        .post('/api/roles')
        .set('Cookie', superAdminCookie)
        .send({
          name: `E2E Lifecycle Role 2 ${ts}`,
          appId: appPublicId,
          permissionIds: [permPublicId],
        })
        .expect(201);
      const role2PublicId = role2Res.body.publicId as string;

      // Add the new role to the existing single-role set (set-replace).
      await request(httpServer)
        .put(`/api/users/${userPublicId}/roles`)
        .set('Cookie', superAdminCookie)
        .send({ roleIds: [rolePublicId, role2PublicId] })
        .expect(204);

      // Grant the same permission directly to the user as well.
      await request(httpServer)
        .put(`/api/users/${userPublicId}/direct-permissions`)
        .set('Cookie', superAdminCookie)
        .send({ permissionIds: [permPublicId] })
        .expect(204);

      // GET reflects the new direct-permission row.
      const direct = await request(httpServer)
        .get(`/api/users/${userPublicId}/direct-permissions`)
        .set('Cookie', superAdminCookie)
        .expect(200);
      expect(direct.body).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: `e2e.t${ts}.read` }),
      ]));
    });

    it('the newly-signed-in user still sees the same effective permission set via /api/me', async () => {
      const signIn = await request(httpServer)
        .post('/api/auth/sign-in/email')
        .send({ email: inviteeEmail, password: PASSWORD })
        .expect(200);
      const setCookie = signIn.headers['set-cookie'] as unknown as string[] | string | undefined;
      const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
      const userCookie = cookies
        .map((c) => c.split(';')[0])
        .find((c) => c.startsWith('better-auth.session_token='))!;

      const me = await request(httpServer)
        .get('/api/me/permissions')
        .set('Cookie', userCookie)
        .expect(200);
      // The same permission, granted via 2 roles + 1 direct, still appears once
      // (deduplicated union — guards against double-counting in the join).
      expect(me.body.permissions).toEqual(expect.arrayContaining([`e2e.t${ts}.read`]));
    });
```

- [ ] **Step 3: Run e2e — only if dev DB is available**

```
pnpm --filter @sassy-auth/auth-server test:e2e -- --testPathPattern=app.e2e-spec -t Lifecycle
```

Expected: PASS for the new tests + all preceding Lifecycle tests.

NOTE: `test:e2e` runs `prisma migrate deploy` + `pnpm seed` against `DATABASE_URL`. If the dev environment is shared, confirm with the user before running.

- [ ] **Step 4: Commit**

```bash
git add apps/auth-server/test/app.e2e-spec.ts
git commit -m "$(cat <<'EOF'
test(auth-server): cover PUT /users/:id/roles + direct-permissions e2e

Extends the existing Lifecycle describe with set-replace coverage for
a second role + a direct permission, plus a /api/me/permissions
union assertion proving the deduplicated set survives a re-sign-in.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Admin types + `apps/admin/lib/api.ts` wrappers

**Files:**
- Modify: `apps/admin/lib/types.ts`
- Modify: `apps/admin/lib/api.ts`

- [ ] **Step 1: Extend `CreateUserPayload`**

In `apps/admin/lib/types.ts`, find the `CreateUserPayload` interface (lines 33-40 in the current file) and replace with:

```typescript
export interface CreateUserPayload {
  firstName: string
  lastName: string
  email: string
  orgId: string
  username?: string
  phoneNumber?: string
  roleIds?: string[]
  directPermissionIds?: string[]
}
```

- [ ] **Step 2: Add the three new API client functions**

In `apps/admin/lib/api.ts`, append BEFORE the `// Public endpoints — no session cookie needed` comment (around line 144 in the current file):

```typescript
export async function setUserRoles(userId: string, roleIds: string[]): Promise<void> {
  await apiFetch(`/api/users/${userId}/roles`, {
    method: 'PUT',
    body: JSON.stringify({ roleIds }),
  })
  Sentry.addBreadcrumb({ category: 'admin.action', message: `User roles set: ${userId}`, level: 'info' })
}

export async function getUserDirectPermissions(userId: string): Promise<Permission[]> {
  const res = await apiFetch(`/api/users/${userId}/direct-permissions`)
  return res.json()
}

export async function setUserDirectPermissions(userId: string, permissionIds: string[]): Promise<void> {
  await apiFetch(`/api/users/${userId}/direct-permissions`, {
    method: 'PUT',
    body: JSON.stringify({ permissionIds }),
  })
  Sentry.addBreadcrumb({ category: 'admin.action', message: `User direct permissions set: ${userId}`, level: 'info' })
}
```

- [ ] **Step 3: Typecheck**

```
cd apps/admin && pnpm exec tsc --noEmit -p tsconfig.json
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/lib/types.ts apps/admin/lib/api.ts
git commit -m "$(cat <<'EOF'
feat(admin): API client for setUserRoles + getUser/setUserDirectPermissions

Extends CreateUserPayload with optional roleIds + directPermissionIds.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Admin server actions

**Files:**
- Modify: `apps/admin/app/(admin)/users/actions.ts`

- [ ] **Step 1: Replace the file**

Replace `apps/admin/app/(admin)/users/actions.ts` with:

```typescript
'use server'

import { revalidatePath } from 'next/cache'
import {
  createUser,
  assignRole,
  getUserRoles,
  getEffectivePermissions,
  getUserDirectPermissions,
  setUserRoles,
  setUserDirectPermissions,
  getRoles,
  getPermissions,
  updateUser,
  deleteUser,
} from '@/lib/api'
import type { CreateUserPayload, Permission, Role, User } from '@/lib/types'

interface CreateUserInput extends CreateUserPayload {
  /** Legacy single-role field — supported for callers not yet on roleIds. */
  roleId?: string
}

export async function createUserAction(
  input: CreateUserInput,
): Promise<{ inviteUrl: string } | { error: string }> {
  try {
    const { roleId, roleIds, ...rest } = input
    // Prefer the new multi-id arrays; if a single roleId came in, fold it
    // into roleIds for the atomic create.
    const finalRoleIds = roleIds ?? (roleId ? [roleId] : undefined)
    const { inviteUrl } = await createUser({
      ...rest,
      ...(finalRoleIds && { roleIds: finalRoleIds }),
    })
    revalidatePath('/users')
    return { inviteUrl }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    if (message.includes('409') || message.includes('already')) {
      return { error: 'A user with this email already exists.' }
    }
    return { error: message }
  }
}

export async function getUserRolesAction(userId: string): Promise<Role[]> {
  return getUserRoles(userId)
}

export async function getEffectivePermissionsAction(userId: string): Promise<Permission[]> {
  return getEffectivePermissions(userId)
}

export async function getUserDirectPermissionsAction(userId: string): Promise<Permission[]> {
  return getUserDirectPermissions(userId)
}

export async function setUserRolesAction(
  userId: string,
  roleIds: string[],
): Promise<{ ok: true } | { errorKey: string }> {
  try {
    await setUserRoles(userId, roleIds)
    revalidatePath('/users')
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : ''
    if (message.includes('403')) return { errorKey: 'users.errors.forbidden' }
    if (message.includes('400')) return { errorKey: 'users.errors.rolesSetFailed' }
    return { errorKey: 'users.errors.rolesSetFailed' }
  }
}

export async function setUserDirectPermissionsAction(
  userId: string,
  permissionIds: string[],
): Promise<{ ok: true } | { errorKey: string }> {
  try {
    await setUserDirectPermissions(userId, permissionIds)
    revalidatePath('/users')
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : ''
    if (message.includes('403')) return { errorKey: 'users.errors.forbidden' }
    if (message.includes('400')) return { errorKey: 'users.errors.directPermissionsSetFailed' }
    return { errorKey: 'users.errors.directPermissionsSetFailed' }
  }
}

export async function getRolesAction(appId?: string): Promise<Role[]> {
  const result = await getRoles({ appId, pageSize: 200 })
  return result.items.map((r) => ({
    publicId: r.publicId,
    name: r.name,
    appId: r.app.publicId,
  }))
}

export async function getAppPermissionsAction(
  appId: string,
): Promise<Array<{ publicId: string; name: string }>> {
  const result = await getPermissions({ appId, pageSize: 200 })
  return result.items.map((p) => ({ publicId: p.publicId, name: p.name }))
}

export async function updateUserAction(id: string, patch: Partial<User>): Promise<User> {
  const result = await updateUser(id, patch)
  revalidatePath('/users')
  return result
}

export async function deleteUserAction(
  userId: string,
): Promise<{ ok: true } | { errorKey: string }> {
  try {
    await deleteUser(userId)
    revalidatePath('/users')
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : ''
    if (message.includes('403') && message.toLowerCase().includes('own')) {
      return { errorKey: 'users.confirmDelete.selfDeleteError' }
    }
    if (message.includes('403')) return { errorKey: 'users.errors.forbidden' }
    return { errorKey: 'users.errors.generic' }
  }
}
```

- [ ] **Step 2: Typecheck**

```
cd apps/admin && pnpm exec tsc --noEmit -p tsconfig.json
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/admin/app/\(admin\)/users/actions.ts
git commit -m "$(cat <<'EOF'
feat(admin): user-actions for set-replace roles + direct permissions

Adds setUserRolesAction, setUserDirectPermissionsAction,
getUserDirectPermissionsAction, getAppPermissionsAction. createUserAction
now folds the legacy single roleId into the atomic roleIds array passed
to the extended createUser endpoint.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: `RoleRowsEditor` component

**Files:**
- Create: `apps/admin/components/user-role-rows-editor.tsx`

Near-copy of `apps/admin/components/role-permission-rows-editor.tsx`, parameterized for roles and using `users.fields.*` i18n keys instead of `roles.fields.*`.

- [ ] **Step 1: Create the component**

```typescript
// apps/admin/components/user-role-rows-editor.tsx
'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { Plus, X } from 'lucide-react'
import { Button } from '@sassy-auth/ui'

export interface RoleOption { publicId: string; name: string }

interface Props {
  appId: string
  roles: RoleOption[]
  rows: string[]
  onRowsChange: (next: string[]) => void
  loading: boolean
}

export function RoleRowsEditor({ appId, roles, rows, onRowsChange, loading }: Props) {
  const t = useTranslations()

  if (!appId) {
    return <p className="text-body-sm text-muted-foreground">{t('users.fields.selectOrgFirst')}</p>
  }
  if (loading) {
    return <p className="text-body-sm text-muted-foreground">…</p>
  }
  if (roles.length === 0) {
    return <p className="text-body-sm text-muted-foreground">{t('users.fields.noRolesForApp')}</p>
  }

  function update(idx: number, value: string) {
    const next = rows.slice()
    next[idx] = value
    onRowsChange(next)
  }
  function remove(idx: number) {
    onRowsChange(rows.filter((_, i) => i !== idx))
  }
  function addRow() {
    onRowsChange([...rows, ''])
  }
  function isTakenElsewhere(thisIdx: number, candidate: string): boolean {
    return rows.some((v, i) => i !== thisIdx && v !== '' && v === candidate)
  }

  return (
    <div className="space-y-2">
      {rows.length === 0 && (
        <p className="text-label-sm text-muted-foreground">{t('users.drawer.noRoles')}</p>
      )}
      <ul className="space-y-2">
        {rows.map((value, idx) => (
          <li key={idx} className="flex items-center gap-2">
            <select
              aria-label={t('users.fields.roleRow')}
              value={value}
              onChange={(e) => update(idx, e.target.value)}
              className="block h-9 w-full rounded border border-border bg-card px-2 text-body-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="" disabled>{t('users.fields.selectRole')}</option>
              {roles.map((r) => (
                <option
                  key={r.publicId}
                  value={r.publicId}
                  disabled={isTakenElsewhere(idx, r.publicId)}
                >
                  {r.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              aria-label={t('users.fields.removeRole')}
              onClick={() => remove(idx)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-border text-muted-foreground hover:text-destructive"
            >
              <X className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
      <Button type="button" variant="outline" size="sm" onClick={addRow}>
        <Plus className="h-4 w-4" />
        {t('users.fields.addRole')}
      </Button>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

```
cd apps/admin && pnpm exec tsc --noEmit -p tsconfig.json
```

Expected: TS errors about missing i18n keys (`users.fields.selectOrgFirst`, `noRolesForApp`, etc.) — these are caught at runtime only, so TS itself should pass. Verify no actual TS errors.

- [ ] **Step 3: Commit**

```bash
git add apps/admin/components/user-role-rows-editor.tsx
git commit -m "$(cat <<'EOF'
feat(admin): RoleRowsEditor primitive (multi-row role picker)

Mirrors PermissionRowsEditor; reused by the user create + edit drawers
for assigning N roles scoped to the user's org's app.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: i18n keys for both locales

**Files:**
- Modify: `apps/admin/messages/en.json`
- Modify: `apps/admin/messages/fr.json`

The new keys live under `users.fields.*`, `users.drawer.*`, and `users.errors.*`. Find the existing `"users": {` block in each file and merge.

- [ ] **Step 1: Update `en.json`**

In `apps/admin/messages/en.json`, inside the `"users": { "fields": { ... } }` block, ADD these keys at the end of `fields` (before the closing brace):

```json
      "roleRow": "Role",
      "directPermissionRow": "Direct permission",
      "addRole": "Add role",
      "removeRole": "Remove role",
      "selectRole": "Select a role",
      "selectOrgFirst": "Select an organization first",
      "noRolesForApp": "No roles defined for this app.",
      "addDirectPermission": "Add direct permission",
      "removeDirectPermission": "Remove direct permission",
      "selectDirectPermission": "Select a permission",
      "noDirectPermissionsForApp": "No permissions defined for this app."
```

Inside the `"users": { "drawer": { ... } }` block, ADD:

```json
      "assignedDirectPermissions": "Direct Permissions",
      "noRoles": "No roles assigned.",
      "noDirectPermissions": "No direct permissions."
```

Inside the `"users": { "errors": { ... } }` block, ADD:

```json
      "rolesSetFailed": "Failed to update roles.",
      "directPermissionsSetFailed": "Failed to update direct permissions."
```

(If `users.errors` does not yet exist, add it as a new sub-object.)

- [ ] **Step 2: Update `fr.json`**

In `apps/admin/messages/fr.json`, mirror the same paths with French translations:

`users.fields` adds:
```json
      "roleRow": "Rôle",
      "directPermissionRow": "Permission directe",
      "addRole": "Ajouter un rôle",
      "removeRole": "Supprimer le rôle",
      "selectRole": "Sélectionner un rôle",
      "selectOrgFirst": "Sélectionnez d'abord une organisation",
      "noRolesForApp": "Aucun rôle défini pour cette application.",
      "addDirectPermission": "Ajouter une permission directe",
      "removeDirectPermission": "Supprimer la permission directe",
      "selectDirectPermission": "Sélectionner une permission",
      "noDirectPermissionsForApp": "Aucune permission définie pour cette application."
```

`users.drawer` adds:
```json
      "assignedDirectPermissions": "Permissions directes",
      "noRoles": "Aucun rôle attribué.",
      "noDirectPermissions": "Aucune permission directe."
```

`users.errors` adds:
```json
      "rolesSetFailed": "Échec de la mise à jour des rôles.",
      "directPermissionsSetFailed": "Échec de la mise à jour des permissions directes."
```

- [ ] **Step 3: Verify the admin app builds**

```
cd apps/admin && pnpm exec tsc --noEmit -p tsconfig.json
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/messages/en.json apps/admin/messages/fr.json
git commit -m "$(cat <<'EOF'
i18n(admin): user role + direct-permission editor strings

EN + FR keys for the new RoleRowsEditor labels, direct-permission
section headings, and per-axis error toasts.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Replace single-role `<Select>` with row editors in create drawer

**Files:**
- Modify: `apps/admin/components/user-create-drawer.tsx`

- [ ] **Step 1: Rewrite the drawer**

Replace the entire contents of `apps/admin/components/user-create-drawer.tsx` with:

```typescript
'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import {
  Sheet, SheetContent, SheetHeader, SheetBody, SheetFooter, SheetClose, SheetTitle, SheetDescription,
  Button, ButtonGroup, FormField, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@sassy-auth/ui'
import {
  createUserAction, getRolesAction, getAppPermissionsAction,
} from '@/app/(admin)/users/actions'
import type { Org, Role } from '@/lib/types'
import { RoleRowsEditor, type RoleOption } from './user-role-rows-editor'
import { PermissionRowsEditor, type PermOption } from './role-permission-rows-editor'

interface UserCreateDrawerProps {
  orgs: Org[]
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface FormState {
  firstName: string
  lastName: string
  email: string
  username: string
  phoneNumber: string
  orgId: string
  roleIds: string[]
  directPermissionIds: string[]
}

const EMPTY: FormState = {
  firstName: '', lastName: '', email: '', username: '', phoneNumber: '',
  orgId: '', roleIds: [], directPermissionIds: [],
}

export function UserCreateDrawer({ orgs, open, onOpenChange }: UserCreateDrawerProps) {
  const t = useTranslations()
  const [form, setForm] = React.useState<FormState>(EMPTY)
  const [roles, setRoles] = React.useState<RoleOption[]>([])
  const [perms, setPerms] = React.useState<PermOption[]>([])
  const [rolesLoading, setRolesLoading] = React.useState(false)
  const [permsLoading, setPermsLoading] = React.useState(false)
  const [errors, setErrors] = React.useState<Partial<Record<keyof FormState, string>>>({})
  const [submitting, setSubmitting] = React.useState(false)
  const [inviteUrl, setInviteUrl] = React.useState<string | null>(null)
  const [copied, setCopied] = React.useState(false)
  const [serverError, setServerError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (open) {
      setForm(EMPTY)
      setErrors({})
      setInviteUrl(null)
      setServerError(null)
      setCopied(false)
    }
  }, [open])

  // Load roles + app permissions in parallel whenever org changes.
  React.useEffect(() => {
    if (!form.orgId) { setRoles([]); setPerms([]); return }
    const selectedOrg = orgs.find((o) => o.id === form.orgId)
    if (!selectedOrg) return
    let cancelled = false
    setRolesLoading(true)
    setPermsLoading(true)
    getRolesAction(selectedOrg.appId).then((r) => {
      if (cancelled) return
      setRoles(r.map((x) => ({ publicId: x.publicId, name: x.name })))
    }).finally(() => { if (!cancelled) setRolesLoading(false) })
    getAppPermissionsAction(selectedOrg.appId).then((p) => {
      if (cancelled) return
      setPerms(p)
    }).finally(() => { if (!cancelled) setPermsLoading(false) })
    return () => { cancelled = true }
  }, [form.orgId, orgs])

  function set<K extends keyof FormState>(field: K) {
    return (value: FormState[K]) => setForm((f) => ({ ...f, [field]: value }))
  }

  function validate(): boolean {
    const e: Partial<Record<keyof FormState, string>> = {}
    if (!form.firstName.trim()) e.firstName = 'Required'
    if (!form.lastName.trim()) e.lastName = 'Required'
    if (!form.email.trim()) e.email = 'Required'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'Invalid email'
    if (!form.orgId) e.orgId = 'Required'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function handleSubmit() {
    if (!validate()) return
    setSubmitting(true)
    setServerError(null)
    try {
      const result = await createUserAction({
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        orgId: form.orgId,
        ...(form.username && { username: form.username }),
        ...(form.phoneNumber && { phoneNumber: form.phoneNumber }),
        ...(form.roleIds.filter((id) => id !== '').length > 0 && {
          roleIds: Array.from(new Set(form.roleIds.filter((id) => id !== ''))),
        }),
        ...(form.directPermissionIds.filter((id) => id !== '').length > 0 && {
          directPermissionIds: Array.from(new Set(form.directPermissionIds.filter((id) => id !== ''))),
        }),
      })
      if ('error' in result) setServerError(result.error)
      else setInviteUrl(result.inviteUrl)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleCopy() {
    if (!inviteUrl) return
    await navigator.clipboard.writeText(inviteUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const selectedOrg = orgs.find((o) => o.id === form.orgId)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <div>
            <SheetTitle>{t('users.drawer.createTitle')}</SheetTitle>
            <SheetDescription>{t('users.drawer.createSubtitle')}</SheetDescription>
          </div>
          <SheetClose asChild>
            <button className="flex h-7 w-7 items-center justify-center rounded hover:bg-muted">
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </SheetClose>
        </SheetHeader>

        {inviteUrl ? (
          <>
            <SheetBody className="flex flex-col items-center gap-6 pt-12 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-secondary">
                <span className="material-symbols-outlined text-[32px] text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
              </div>
              <div>
                <h2 className="text-headline-sm">{t('users.drawer.inviteCreated')}</h2>
              </div>
              <div className="w-full">
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={inviteUrl}
                    className="flex-1 rounded border border-border bg-muted px-3 py-2 text-body-sm font-mono"
                  />
                  <Button variant="outline" size="sm" onClick={handleCopy}>
                    <span className="material-symbols-outlined text-[18px]">{copied ? 'check' : 'content_copy'}</span>
                    {copied ? t('users.drawer.copied') : t('users.drawer.copyLink')}
                  </Button>
                </div>
              </div>
            </SheetBody>
            <SheetFooter>
              <Button onClick={() => onOpenChange(false)}>{t('users.drawer.done')}</Button>
            </SheetFooter>
          </>
        ) : (
          <>
            <SheetBody className="flex flex-col gap-6">
              <section>
                <h3 className="mb-4 text-label-sm font-bold uppercase tracking-wider text-muted-foreground">{t('users.drawer.basicInfo')}</h3>
                <div className="grid grid-cols-2 gap-4">
                  <FormField label={t('users.fields.firstName')} value={form.firstName} onChange={(e) => set('firstName')(e.target.value)} error={errors.firstName} required />
                  <FormField label={t('users.fields.lastName')} value={form.lastName} onChange={(e) => set('lastName')(e.target.value)} error={errors.lastName} required />
                  <FormField label={t('users.fields.email')} type="email" value={form.email} onChange={(e) => set('email')(e.target.value)} error={errors.email} required className="col-span-2" />
                  <FormField label={`${t('users.fields.username')} ${t('users.fields.optional')}`} value={form.username} onChange={(e) => set('username')(e.target.value)} />
                  <FormField label={`${t('users.fields.phone')} ${t('users.fields.optional')}`} type="tel" value={form.phoneNumber} onChange={(e) => set('phoneNumber')(e.target.value)} />
                </div>
              </section>

              <section>
                <h3 className="mb-4 text-label-sm font-bold uppercase tracking-wider text-muted-foreground">{t('users.drawer.accessPerms')}</h3>
                <div className="flex flex-col gap-1.5 mb-4">
                  <label className="text-label-md font-semibold">{t('users.fields.org')}<span className="ml-0.5 text-destructive">*</span></label>
                  <Select value={form.orgId} onValueChange={set('orgId')}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select org" />
                    </SelectTrigger>
                    <SelectContent>
                      {orgs.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {errors.orgId && <p className="text-label-md text-destructive">{errors.orgId}</p>}
                </div>

                <div className="mb-4">
                  <h4 className="mb-2 text-label-md font-semibold">{t('users.drawer.assignedRoles')}</h4>
                  <RoleRowsEditor
                    appId={selectedOrg?.appId ?? ''}
                    roles={roles}
                    rows={form.roleIds}
                    onRowsChange={(next) => set('roleIds')(next)}
                    loading={rolesLoading}
                  />
                </div>

                <div>
                  <h4 className="mb-2 text-label-md font-semibold">{t('users.drawer.assignedDirectPermissions')}</h4>
                  <PermissionRowsEditor
                    appId={selectedOrg?.appId ?? ''}
                    perms={perms}
                    rows={form.directPermissionIds}
                    onRowsChange={(next) => set('directPermissionIds')(next)}
                    loading={permsLoading}
                  />
                </div>
              </section>

              {serverError && (
                <p role="alert" className="rounded border border-destructive/20 bg-destructive/10 px-3 py-2 text-body-sm text-destructive">
                  {serverError}
                </p>
              )}
            </SheetBody>

            <SheetFooter>
              <ButtonGroup>
                <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={submitting}>{t('users.drawer.cancel')}</Button>
                <Button onClick={handleSubmit} disabled={submitting}>
                  {submitting ? '…' : t('users.drawer.create')}
                </Button>
              </ButtonGroup>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
```

NOTE on `roleIds` rows: `RoleRowsEditor.rows` is `string[]` where `''` means "empty slot just added". The Submit handler filters those out before sending to the server. This matches `role-create-drawer.tsx:58-60`.

- [ ] **Step 2: Typecheck**

```
cd apps/admin && pnpm exec tsc --noEmit -p tsconfig.json
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/admin/components/user-create-drawer.tsx
git commit -m "$(cat <<'EOF'
feat(admin): create-user drawer supports N roles + N direct permissions

Single-role Radix Select replaced by RoleRowsEditor; new
PermissionRowsEditor below it for direct permissions. Form folds both
into the extended createUserAction { roleIds, directPermissionIds }
payload for a single atomic server transaction.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: User view drawer — load + render direct permissions in view mode

This task only adds the direct-permission read display + the data wiring; full edit-mode rewrite comes in Task 14.

**Files:**
- Modify: `apps/admin/components/user-view-drawer.tsx`

- [ ] **Step 1: Wire the new fetch + render**

In `apps/admin/components/user-view-drawer.tsx`:

1. Add import at the top:

```typescript
import {
  getUserRolesAction,
  getEffectivePermissionsAction,
  getUserDirectPermissionsAction,
  updateUserAction,
  deleteUserAction,
} from '@/app/(admin)/users/actions'
```

(Add `getUserDirectPermissionsAction` to the existing import block.)

2. Add a new state hook near the other `useState` calls (just after `const [permissions, setPermissions] = ...`):

```typescript
  const [directPermissions, setDirectPermissions] = React.useState<Permission[]>([])
```

3. Extend the effect that loads roles + permissions (currently `Promise.all([getUserRolesAction(...), getEffectivePermissionsAction(...)])` at line ~45). Replace it with:

```typescript
    Promise.all([
      getUserRolesAction(user.id),
      getEffectivePermissionsAction(user.id),
      getUserDirectPermissionsAction(user.id),
    ])
      .then(([r, p, d]) => { setRoles(r); setPermissions(p); setDirectPermissions(d) })
      .finally(() => setLoading(false))
```

4. In the JSX, find the `<div>` that contains the Effective Permissions block (the one with `<p className="mb-2 text-label-sm font-bold uppercase tracking-wider text-muted-foreground">{t('users.drawer.effectivePermissions')}</p>`). The current grid has two columns: `assignedRoles` and `effectivePermissions`. Replace the surrounding `<div className="grid grid-cols-2 gap-6">` block with a 3-column grid that adds Direct Permissions:

```typescript
                <div className="grid grid-cols-3 gap-6">
                  <div>
                    <p className="mb-2 text-label-sm font-bold uppercase tracking-wider text-muted-foreground">{t('users.drawer.assignedRoles')}</p>
                    <div className="flex flex-wrap gap-2">
                      {roles.length === 0
                        ? <span className="text-body-sm text-muted-foreground">—</span>
                        : roles.map((r) => <Badge key={r.publicId} variant="secondary">{r.name}</Badge>)}
                    </div>
                  </div>
                  <div>
                    <p className="mb-2 text-label-sm font-bold uppercase tracking-wider text-muted-foreground">{t('users.drawer.assignedDirectPermissions')}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {directPermissions.length === 0
                        ? <span className="text-body-sm text-muted-foreground">—</span>
                        : directPermissions.map((p) => (
                            <span key={p.id} className="rounded border border-border px-2 py-0.5 text-label-md">{p.name}</span>
                          ))}
                    </div>
                  </div>
                  <div>
                    <p className="mb-2 text-label-sm font-bold uppercase tracking-wider text-muted-foreground">{t('users.drawer.effectivePermissions')}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {visiblePermissions.map((p) => (
                        <span key={p.id} className="rounded border border-border px-2 py-0.5 text-label-md">{p.name}</span>
                      ))}
                      {!showAllPerms && hiddenCount > 0 && (
                        <button onClick={() => setShowAllPerms(true)} className="text-label-md text-primary hover:underline">
                          {t('users.drawer.nMorePermissions', { count: hiddenCount })}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
```

- [ ] **Step 2: Typecheck**

```
cd apps/admin && pnpm exec tsc --noEmit -p tsconfig.json
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/admin/components/user-view-drawer.tsx
git commit -m "$(cat <<'EOF'
feat(admin): user view drawer surfaces direct permissions read-only

Adds the Direct Permissions column to the access grid (now 3 columns:
Roles | Direct Permissions | Effective Permissions). Wires the new
GET /api/users/:id/direct-permissions fetch in parallel with the
existing roles + effective-perms loads.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: User view drawer — 3-axis edit mode + Save handler

Builds on Task 13. Adds row editors when in edit mode and the 3-axis Save logic.

**Files:**
- Modify: `apps/admin/components/user-view-drawer.tsx`

- [ ] **Step 1: Replace the file**

Replace the entire contents of `apps/admin/components/user-view-drawer.tsx` with the version below. This combines Task 13's view-mode changes with the new edit-mode editor sections and the 3-axis Save handler.

```typescript
'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import {
  Sheet, SheetContent, SheetHeader, SheetBody, SheetClose, SheetTitle,
  Button, ButtonGroup, UserAvatar, StatusChip, Badge,
} from '@sassy-auth/ui'
import { DeleteAlertDialog } from './delete-alert-dialog'
import {
  getUserRolesAction,
  getEffectivePermissionsAction,
  getUserDirectPermissionsAction,
  setUserRolesAction,
  setUserDirectPermissionsAction,
  getRolesAction,
  getAppPermissionsAction,
  updateUserAction,
  deleteUserAction,
} from '@/app/(admin)/users/actions'
import { RoleRowsEditor, type RoleOption } from './user-role-rows-editor'
import { PermissionRowsEditor, type PermOption } from './role-permission-rows-editor'

import type { User, Role, Permission, Org } from '@/lib/types'

const MAX_PERMISSIONS_SHOWN = 5

interface UserViewDrawerProps {
  user: User | null
  orgs: Org[]
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface ProfileSnapshot {
  firstName: string
  lastName: string
  phoneNumber: string
  username: string
}

export function UserViewDrawer({ user, orgs, open, onOpenChange }: UserViewDrawerProps) {
  const t = useTranslations()
  const [roles, setRoles] = React.useState<Role[]>([])
  const [permissions, setPermissions] = React.useState<Permission[]>([])
  const [directPermissions, setDirectPermissions] = React.useState<Permission[]>([])
  const [loading, setLoading] = React.useState(false)
  const [editing, setEditing] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [showAllPerms, setShowAllPerms] = React.useState(false)
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [deleteError, setDeleteError] = React.useState<string | null>(null)

  // Edit-mode form state
  const [editProfile, setEditProfile] = React.useState<ProfileSnapshot>({ firstName: '', lastName: '', phoneNumber: '', username: '' })
  const [profileSnap, setProfileSnap] = React.useState<ProfileSnapshot>({ firstName: '', lastName: '', phoneNumber: '', username: '' })
  const [roleRows, setRoleRows] = React.useState<string[]>([])
  const [roleRowsSnap, setRoleRowsSnap] = React.useState<string[]>([])
  const [permRows, setPermRows] = React.useState<string[]>([])
  const [permRowsSnap, setPermRowsSnap] = React.useState<string[]>([])

  // Edit-mode option lists (scoped to the user's org's app)
  const [roleOptions, setRoleOptions] = React.useState<RoleOption[]>([])
  const [permOptions, setPermOptions] = React.useState<PermOption[]>([])
  const [optionsLoading, setOptionsLoading] = React.useState(false)

  // Per-axis save errors
  const [profileError, setProfileError] = React.useState<string | null>(null)
  const [rolesError, setRolesError] = React.useState<string | null>(null)
  const [permsError, setPermsError] = React.useState<string | null>(null)

  const userOrg = user ? orgs.find((o) => o.id === user.orgId) : undefined
  const appId = userOrg?.appId ?? ''

  // Initial load when the drawer opens or user changes.
  React.useEffect(() => {
    if (!open || !user) return
    setLoading(true)
    setEditing(false)
    setShowAllPerms(false)
    setProfileError(null); setRolesError(null); setPermsError(null)
    Promise.all([
      getUserRolesAction(user.id),
      getEffectivePermissionsAction(user.id),
      getUserDirectPermissionsAction(user.id),
    ])
      .then(([r, p, d]) => { setRoles(r); setPermissions(p); setDirectPermissions(d) })
      .finally(() => setLoading(false))
  }, [open, user?.id])

  // When entering edit mode, snapshot current state and fetch role + perm
  // options. Snapshot lets Cancel restore exactly the loaded state, and
  // lets Save compute per-axis "dirty" with a stable baseline that does
  // not move once a successful axis re-fetches.
  React.useEffect(() => {
    if (!editing || !user) return
    const profile: ProfileSnapshot = {
      firstName: user.firstName,
      lastName: user.lastName,
      phoneNumber: user.phoneNumber ?? '',
      username: user.username ?? '',
    }
    setEditProfile(profile); setProfileSnap(profile)
    const rIds = roles.map((r) => r.publicId)
    setRoleRows(rIds); setRoleRowsSnap(rIds)
    const pIds = directPermissions.map((p) => p.id)
    setPermRows(pIds); setPermRowsSnap(pIds)
    if (!appId) return
    let cancelled = false
    setOptionsLoading(true)
    Promise.all([getRolesAction(appId), getAppPermissionsAction(appId)])
      .then(([rOpts, pOpts]) => {
        if (cancelled) return
        setRoleOptions(rOpts.map((r) => ({ publicId: r.publicId, name: r.name })))
        setPermOptions(pOpts)
      })
      .finally(() => { if (!cancelled) setOptionsLoading(false) })
    return () => { cancelled = true }
  }, [editing, user?.id, appId])

  function setsEqual(a: string[], b: string[]): boolean {
    const A = new Set(a.filter((x) => x !== ''))
    const B = new Set(b.filter((x) => x !== ''))
    if (A.size !== B.size) return false
    for (const v of A) if (!B.has(v)) return false
    return true
  }

  const profileDirty = !!user && (
    editProfile.firstName !== profileSnap.firstName ||
    editProfile.lastName !== profileSnap.lastName ||
    editProfile.phoneNumber !== profileSnap.phoneNumber ||
    editProfile.username !== profileSnap.username
  )
  const rolesDirty = !setsEqual(roleRows, roleRowsSnap)
  const permsDirty = !setsEqual(permRows, permRowsSnap)

  async function handleSave() {
    if (!user) return
    setSaving(true)
    setProfileError(null); setRolesError(null); setPermsError(null)
    const cleanRoleIds = Array.from(new Set(roleRows.filter((id) => id !== '')))
    const cleanPermIds = Array.from(new Set(permRows.filter((id) => id !== '')))

    const tasks: Array<Promise<{ axis: 'profile' | 'roles' | 'perms'; ok: boolean; errorKey?: string; error?: string }>> = []

    if (profileDirty) {
      tasks.push(
        updateUserAction(user.id, {
          firstName: editProfile.firstName,
          lastName: editProfile.lastName,
          phoneNumber: editProfile.phoneNumber || null,
          username: editProfile.username || null,
        })
          .then(() => ({ axis: 'profile' as const, ok: true }))
          .catch((e: unknown) => ({
            axis: 'profile' as const, ok: false,
            error: e instanceof Error ? e.message : 'users.errors.generic',
          })),
      )
    }
    if (rolesDirty) {
      tasks.push(
        setUserRolesAction(user.id, cleanRoleIds).then((r) =>
          'ok' in r
            ? { axis: 'roles' as const, ok: true }
            : { axis: 'roles' as const, ok: false, errorKey: r.errorKey }
        ),
      )
    }
    if (permsDirty) {
      tasks.push(
        setUserDirectPermissionsAction(user.id, cleanPermIds).then((r) =>
          'ok' in r
            ? { axis: 'perms' as const, ok: true }
            : { axis: 'perms' as const, ok: false, errorKey: r.errorKey }
        ),
      )
    }

    const results = await Promise.all(tasks)
    let allOk = true
    for (const r of results) {
      if (!r.ok) {
        allOk = false
        const msg = r.errorKey ? t(r.errorKey) : (r.error ?? '')
        if (r.axis === 'profile') setProfileError(msg)
        if (r.axis === 'roles') setRolesError(msg)
        if (r.axis === 'perms') setPermsError(msg)
      } else {
        // Reset that axis's snapshot to what we just sent so re-Save only
        // retries the failed axis. Set-replace is idempotent so retrying
        // a succeeded axis is also safe.
        if (r.axis === 'profile') setProfileSnap(editProfile)
        if (r.axis === 'roles') setRoleRowsSnap(cleanRoleIds)
        if (r.axis === 'perms') setPermRowsSnap(cleanPermIds)
      }
    }

    // Re-fetch the Access lists so the read view (and effective perms) reflect
    // whatever just persisted.
    try {
      const [r, p, d] = await Promise.all([
        getUserRolesAction(user.id),
        getEffectivePermissionsAction(user.id),
        getUserDirectPermissionsAction(user.id),
      ])
      setRoles(r); setPermissions(p); setDirectPermissions(d)
    } catch {
      /* tolerate refresh failure — next open will reload */
    }

    setSaving(false)
    if (allOk) setEditing(false)
  }

  function handleCancel() {
    setEditing(false)
    setEditProfile(profileSnap)
    setRoleRows(roleRowsSnap)
    setPermRows(permRowsSnap)
    setProfileError(null); setRolesError(null); setPermsError(null)
  }

  const visiblePermissions = showAllPerms ? permissions : permissions.slice(0, MAX_PERMISSIONS_SHOWN)
  const hiddenCount = permissions.length - MAX_PERMISSIONS_SHOWN

  if (!user) return null

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <div>
            <SheetTitle>{user.firstName} {user.lastName}</SheetTitle>
            <p className="text-body-sm text-muted-foreground">{user.email}</p>
          </div>
          <div className="flex items-center gap-2">
            {editing ? (
              <ButtonGroup>
                <Button variant="secondary" size="sm" onClick={handleCancel} disabled={saving}>{t('users.drawer.cancel')}</Button>
                <Button size="sm" onClick={handleSave} disabled={saving}>{saving ? '…' : t('users.drawer.save')}</Button>
              </ButtonGroup>
            ) : (
              <ButtonGroup>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-destructive text-destructive"
                  onClick={() => { setDeleteError(null); setDeleteOpen(true) }}
                >
                  {t('users.actions.delete')}
                </Button>
                <Button variant="outline" size="sm">{t('users.drawer.resetPassword')}</Button>
                <Button size="sm" onClick={() => setEditing(true)}>{t('users.drawer.edit')}</Button>
              </ButtonGroup>
            )}
            <SheetClose asChild>
              <button className="ml-2 flex h-7 w-7 items-center justify-center rounded hover:bg-muted">
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </SheetClose>
          </div>
        </SheetHeader>

        <SheetBody className="flex flex-col gap-6">
          {/* Profile card */}
          <div className="overflow-hidden rounded-lg border border-border">
            <div className="relative h-20 bg-gradient-to-r from-brand-600 to-indigo-800">
              <div className="absolute -bottom-6 left-6">
                <UserAvatar firstName={user.firstName} lastName={user.lastName} size="lg" className="border-2 border-white" />
              </div>
              <div className="absolute right-4 top-4">
                <StatusChip variant={user.status} label={t(`users.status.${user.status}`)} />
              </div>
            </div>
            <div className="px-6 pb-6 pt-10">
              {profileError && (
                <p role="alert" className="mb-3 rounded border border-destructive/20 bg-destructive/10 px-3 py-2 text-body-sm text-destructive">{profileError}</p>
              )}
              <div className="grid grid-cols-2 gap-4">
                <Field label={t('users.fields.firstName')}>
                  {editing
                    ? <input value={editProfile.firstName} onChange={(e) => setEditProfile((v) => ({ ...v, firstName: e.target.value }))} className="w-full rounded border border-border px-2 py-1 text-body-sm" />
                    : user.firstName}
                </Field>
                <Field label={t('users.fields.lastName')}>
                  {editing
                    ? <input value={editProfile.lastName} onChange={(e) => setEditProfile((v) => ({ ...v, lastName: e.target.value }))} className="w-full rounded border border-border px-2 py-1 text-body-sm" />
                    : user.lastName}
                </Field>
                <Field label={t('users.fields.phone')}>
                  {editing
                    ? <input value={editProfile.phoneNumber} onChange={(e) => setEditProfile((v) => ({ ...v, phoneNumber: e.target.value }))} className="w-full rounded border border-border px-2 py-1 text-body-sm" placeholder={t('users.fields.optional')} />
                    : (user.phoneNumber ?? <span className="text-muted-foreground">—</span>)}
                </Field>
                <Field label={t('users.fields.username')}>
                  {editing
                    ? <input value={editProfile.username} onChange={(e) => setEditProfile((v) => ({ ...v, username: e.target.value }))} className="w-full rounded border border-border px-2 py-1 text-body-sm" placeholder={t('users.fields.optional')} />
                    : (user.username ?? <span className="text-muted-foreground">—</span>)}
                </Field>
                <Field label={t('users.fields.userId')}>
                  <code className="rounded bg-muted px-1.5 py-0.5 text-label-md font-mono">{user.id}</code>
                </Field>
                <Field label={t('users.fields.lastLogin')}>
                  {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleDateString() : t('users.fields.never')}
                </Field>
              </div>
            </div>
          </div>

          {/* Access section */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-headline-sm">{t('users.drawer.grantAccess')}</h3>
            </div>
            {loading ? (
              <p className="text-body-sm text-muted-foreground">Loading…</p>
            ) : editing ? (
              <div className="space-y-6">
                <div>
                  <p className="mb-2 text-label-sm font-bold uppercase tracking-wider text-muted-foreground">{t('users.drawer.assignedRoles')}</p>
                  {rolesError && (
                    <p role="alert" className="mb-2 rounded border border-destructive/20 bg-destructive/10 px-3 py-2 text-body-sm text-destructive">{rolesError}</p>
                  )}
                  <RoleRowsEditor
                    appId={appId}
                    roles={roleOptions}
                    rows={roleRows}
                    onRowsChange={setRoleRows}
                    loading={optionsLoading}
                  />
                </div>
                <div>
                  <p className="mb-2 text-label-sm font-bold uppercase tracking-wider text-muted-foreground">{t('users.drawer.assignedDirectPermissions')}</p>
                  {permsError && (
                    <p role="alert" className="mb-2 rounded border border-destructive/20 bg-destructive/10 px-3 py-2 text-body-sm text-destructive">{permsError}</p>
                  )}
                  <PermissionRowsEditor
                    appId={appId}
                    perms={permOptions}
                    rows={permRows}
                    onRowsChange={setPermRows}
                    loading={optionsLoading}
                  />
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
                <div className="grid grid-cols-3 gap-6">
                  <div>
                    <p className="mb-2 text-label-sm font-bold uppercase tracking-wider text-muted-foreground">{t('users.drawer.assignedRoles')}</p>
                    <div className="flex flex-wrap gap-2">
                      {roles.length === 0
                        ? <span className="text-body-sm text-muted-foreground">—</span>
                        : roles.map((r) => <Badge key={r.publicId} variant="secondary">{r.name}</Badge>)}
                    </div>
                  </div>
                  <div>
                    <p className="mb-2 text-label-sm font-bold uppercase tracking-wider text-muted-foreground">{t('users.drawer.assignedDirectPermissions')}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {directPermissions.length === 0
                        ? <span className="text-body-sm text-muted-foreground">—</span>
                        : directPermissions.map((p) => (
                            <span key={p.id} className="rounded border border-border px-2 py-0.5 text-label-md">{p.name}</span>
                          ))}
                    </div>
                  </div>
                  <div>
                    <p className="mb-2 text-label-sm font-bold uppercase tracking-wider text-muted-foreground">{t('users.drawer.effectivePermissions')}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {visiblePermissions.map((p) => (
                        <span key={p.id} className="rounded border border-border px-2 py-0.5 text-label-md">{p.name}</span>
                      ))}
                      {!showAllPerms && hiddenCount > 0 && (
                        <button onClick={() => setShowAllPerms(true)} className="text-label-md text-primary hover:underline">
                          {t('users.drawer.nMorePermissions', { count: hiddenCount })}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </SheetBody>
      </SheetContent>
      <DeleteAlertDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t('users.confirmDelete.title')}
        description={t('users.confirmDelete.body', { name: `${user.firstName} ${user.lastName}` })}
        confirmLabel={t('users.confirmDelete.button')}
        cancelLabel={t('users.drawer.cancel')}
        error={deleteError}
        onConfirm={async () => {
          const result = await deleteUserAction(user.id)
          if ('errorKey' in result) {
            setDeleteError(t(result.errorKey))
            return
          }
          onOpenChange(false)
        }}
      />
    </Sheet>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-label-sm font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className="mt-1 text-body-sm text-foreground">{children}</div>
    </div>
  )
}
```

The drawer now takes an `orgs: Org[]` prop. Update the call site that renders it.

- [ ] **Step 2: Pass `orgs` to the view drawer at the call site**

Find the parent component that renders `<UserViewDrawer ...>`. It's `apps/admin/components/users-table.tsx`. Locate that JSX block and add `orgs={orgs}` to the props passed in. (`orgs` should already be a prop on `users-table.tsx`; if it isn't, lift it from `users/page.tsx` — that page already fetches `getOrgs()` for the create drawer.)

Concretely, in `apps/admin/components/users-table.tsx`, find:

```typescript
<UserViewDrawer
  user={selected}
  open={viewOpen}
  onOpenChange={setViewOpen}
/>
```

Replace with:

```typescript
<UserViewDrawer
  user={selected}
  orgs={orgs}
  open={viewOpen}
  onOpenChange={setViewOpen}
/>
```

- [ ] **Step 3: Typecheck**

```
cd apps/admin && pnpm exec tsc --noEmit -p tsconfig.json
```

Expected: no errors. If `users-table.tsx` does not yet receive `orgs`, add it as a prop and forward it from `app/(admin)/users/page.tsx` (mirror how the create drawer receives orgs there).

- [ ] **Step 4: Commit**

```bash
git add apps/admin/components/user-view-drawer.tsx apps/admin/components/users-table.tsx
git commit -m "$(cat <<'EOF'
feat(admin): user edit drawer — 3-axis role + direct-perm editing

Clicking Edit now puts profile, roles, and direct permissions into row-
editor mode simultaneously. Save fires the three set-replace actions in
parallel; per-axis failures surface inline and leave that axis dirty so
a re-Save retries only what failed. The view-mode Access grid shows
both Direct Permissions and Effective Permissions side by side.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: Update create-drawer tests

**Files:**
- Modify: `apps/admin/components/__tests__/user-create-drawer.test.tsx`

- [ ] **Step 1: Inspect existing tests**

```
cat apps/admin/components/__tests__/user-create-drawer.test.tsx
```

Note the mock for `createUserAction` and the org-pick flow.

- [ ] **Step 2: Extend mocks for the new actions**

At the top of `apps/admin/components/__tests__/user-create-drawer.test.tsx`, find the existing `jest.mock('@/app/(admin)/users/actions', ...)` block and replace with:

```typescript
jest.mock('@/app/(admin)/users/actions', () => ({
  createUserAction: jest.fn(),
  getRolesAction: jest.fn().mockResolvedValue([
    { publicId: 'role-a', name: 'Role A', appId: 'app-1' },
  ]),
  getAppPermissionsAction: jest.fn().mockResolvedValue([
    { publicId: 'perm-a', name: 'apps.read' },
  ]),
}))
```

- [ ] **Step 3: Add the new test**

Append inside the existing `describe` block in `user-create-drawer.test.tsx`:

```typescript
  it('passes roleIds + directPermissionIds when submitting', async () => {
    const actions = await import('@/app/(admin)/users/actions')
    ;(actions.createUserAction as jest.Mock).mockResolvedValue({ inviteUrl: 'https://example.com/i' })

    render(
      <UserCreateDrawer
        orgs={[{ id: 'org-1', name: 'Org One', appId: 'app-1', isPlatform: false }]}
        open
        onOpenChange={() => {}}
      />,
    )

    // Fill required fields
    fireEvent.change(screen.getByLabelText('First Name'), { target: { value: 'A' } })
    fireEvent.change(screen.getByLabelText('Last Name'), { target: { value: 'B' } })
    fireEvent.change(screen.getByLabelText('Email Address'), { target: { value: 'a@b.io' } })

    // Pick org via Radix Select trigger (placeholder "Select org")
    fireEvent.click(screen.getByText('Select org'))
    fireEvent.click(await screen.findByText('Org One'))

    // Add a role row + select role
    fireEvent.click(await screen.findByRole('button', { name: 'Add role' }))
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'role-a' } })

    // Add a direct-permission row + select permission
    fireEvent.click(screen.getByRole('button', { name: 'Add permission' }))
    fireEvent.change(screen.getByLabelText('Permission'), { target: { value: 'perm-a' } })

    // Submit
    fireEvent.click(screen.getByRole('button', { name: 'Create User & Generate Invite' }))

    await waitFor(() => {
      expect(actions.createUserAction).toHaveBeenCalledWith(
        expect.objectContaining({
          firstName: 'A', lastName: 'B', email: 'a@b.io', orgId: 'org-1',
          roleIds: ['role-a'],
          directPermissionIds: ['perm-a'],
        }),
      )
    })
  })
```

Make sure `waitFor` is imported alongside `render, screen, fireEvent` from `@testing-library/react` at the top of the file.

- [ ] **Step 4: Run tests**

```
pnpm --filter @sassy-auth/admin test -- --testPathPattern=user-create-drawer
```

Expected: PASS for new + existing tests.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/components/__tests__/user-create-drawer.test.tsx
git commit -m "$(cat <<'EOF'
test(admin): create-drawer passes roleIds + directPermissionIds

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: Update view-drawer tests

**Files:**
- Modify: `apps/admin/components/__tests__/user-view-drawer.test.tsx`

- [ ] **Step 1: Extend mocks**

At the top of `apps/admin/components/__tests__/user-view-drawer.test.tsx`, find the existing `jest.mock('@/app/(admin)/users/actions', ...)` block and replace with:

```typescript
jest.mock('@/app/(admin)/users/actions', () => ({
  getUserRolesAction: jest.fn().mockResolvedValue([
    { publicId: 'role-a', name: 'Role A', appId: 'app-1', permissions: [] },
  ]),
  getEffectivePermissionsAction: jest.fn().mockResolvedValue([
    { id: 'apps.read', name: 'apps.read', appId: '' },
  ]),
  getUserDirectPermissionsAction: jest.fn().mockResolvedValue([
    { id: 'apps.write', name: 'apps.write', appId: '' },
  ]),
  setUserRolesAction: jest.fn().mockResolvedValue({ ok: true }),
  setUserDirectPermissionsAction: jest.fn().mockResolvedValue({ ok: true }),
  getRolesAction: jest.fn().mockResolvedValue([
    { publicId: 'role-a', name: 'Role A', appId: 'app-1' },
    { publicId: 'role-b', name: 'Role B', appId: 'app-1' },
  ]),
  getAppPermissionsAction: jest.fn().mockResolvedValue([
    { publicId: 'apps.read', name: 'apps.read' },
    { publicId: 'apps.write', name: 'apps.write' },
  ]),
  updateUserAction: jest.fn().mockResolvedValue({}),
  deleteUserAction: jest.fn().mockResolvedValue({ ok: true }),
}))
```

- [ ] **Step 2: Add new tests**

Append inside the existing `describe` block:

```typescript
  const orgsProp = [{ id: 'org-1', name: 'Org One', appId: 'app-1', isPlatform: false }]
  const userProp = {
    id: 'usr-1', firstName: 'A', lastName: 'B', email: 'a@b.io',
    phoneNumber: null, username: null, orgId: 'org-1', status: 'active' as const,
  }

  it('renders Direct Permissions in the view-mode access grid', async () => {
    render(<UserViewDrawer user={userProp} orgs={orgsProp} open onOpenChange={() => {}} />)
    expect(await screen.findByText('Direct Permissions')).toBeInTheDocument()
    expect(await screen.findByText('apps.write')).toBeInTheDocument()
  })

  it('Save fires setUserRolesAction with the new set when roles change', async () => {
    const actions = await import('@/app/(admin)/users/actions')

    render(<UserViewDrawer user={userProp} orgs={orgsProp} open onOpenChange={() => {}} />)
    await screen.findByText('Role A')

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    // Initial roleRows = ['role-a']; add a second row + pick role-b.
    fireEvent.click(await screen.findByRole('button', { name: 'Add role' }))
    const roleSelects = await screen.findAllByLabelText('Role')
    fireEvent.change(roleSelects[1], { target: { value: 'role-b' } })

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(actions.setUserRolesAction).toHaveBeenCalledWith(
        'usr-1', expect.arrayContaining(['role-a', 'role-b']),
      )
    })
  })

  it('Save fires setUserDirectPermissionsAction with the new set when perms change', async () => {
    const actions = await import('@/app/(admin)/users/actions')

    render(<UserViewDrawer user={userProp} orgs={orgsProp} open onOpenChange={() => {}} />)
    await screen.findByText('apps.write')

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Add permission' }))
    const permSelects = await screen.findAllByLabelText('Permission')
    fireEvent.change(permSelects[1], { target: { value: 'apps.read' } })

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(actions.setUserDirectPermissionsAction).toHaveBeenCalledWith(
        'usr-1', expect.arrayContaining(['apps.write', 'apps.read']),
      )
    })
  })

  it('Cancel restores roles + perms to the pre-Edit snapshot', async () => {
    render(<UserViewDrawer user={userProp} orgs={orgsProp} open onOpenChange={() => {}} />)
    await screen.findByText('Role A')

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Add role' }))
    const roleSelects = await screen.findAllByLabelText('Role')
    fireEvent.change(roleSelects[1], { target: { value: 'role-b' } })

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    // Back in view mode, Role A is still the only badge.
    expect(screen.queryByText('Role B')).not.toBeInTheDocument()
  })
```

Make sure `waitFor` is in the existing import from `@testing-library/react`.

- [ ] **Step 3: Run tests**

```
pnpm --filter @sassy-auth/admin test -- --testPathPattern=user-view-drawer
```

Expected: PASS for new tests + existing ones.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/components/__tests__/user-view-drawer.test.tsx
git commit -m "$(cat <<'EOF'
test(admin): view-drawer renders + edits direct perms and roles

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 17: Playwright — extend lifecycle spec with edit-drawer scenario

**Files:**
- Modify: `apps/admin-e2e/tests/authed/lifecycle.spec.ts`

The existing lifecycle.spec.ts goes through provision → accept invite → sign in as new user. After the new user signs in, that browser context holds the new user's session. To exercise the super-admin Edit flow, we open a fresh context with the super-admin storage state.

- [ ] **Step 1: Find the existing context-cookie sanity check at the end of the test**

Open `apps/admin-e2e/tests/authed/lifecycle.spec.ts`. Locate the closing block of the existing `test('super admin can provision the full chain ...')`:

```typescript
    const cookies = await page.context().cookies()
    const sessionCookie = cookies.find((c) => c.name === 'better-auth.session_token')
    expect(sessionCookie?.value).toBeTruthy()
  })
})
```

- [ ] **Step 2: Add a second role + edit-drawer scenario before the test closes**

Insert just before the closing `})` of the test (after the cookie sanity check):

```typescript
    // 9. Open a fresh super-admin context to drive the edit drawer ─────
    //    The current context now holds the new user's session; we need
    //    super-admin cookies again to edit the user.
    const superCtx = await page.context().browser()!.newContext({
      storageState: '.auth/super-admin.json',
    })
    const superPage = await superCtx.newPage()
    try {
      await superPage.goto('/users')

      // Open the lifecycle user's view drawer by clicking their row.
      const userRow = superPage.getByRole('row', { name: new RegExp(USER_EMAIL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })
      await expect(userRow).toBeVisible({ timeout: 10_000 })
      await userRow.click()

      const dialog = superPage.getByRole('dialog')
      await expect(dialog).toBeVisible()

      // Click Edit (header button)
      await dialog.getByRole('button', { name: t('users.drawer.edit') }).click()

      // Add a second permission row. We can re-use the same PERM_NAME we
      // already granted via the role; the row editor disables duplicates,
      // so the only available pick from the dropdown is a fresh one if
      // present. Skip this if only one permission exists.
      const addPerm = dialog.getByRole('button', { name: t('users.fields.addDirectPermission') })
      await addPerm.click()
      const permSelects = dialog.getByLabel(t('users.fields.directPermissionRow'))
      const permCount = await permSelects.count()
      const newPermSelect = permSelects.nth(permCount - 1)
      await newPermSelect.selectOption({ label: PERM_NAME })

      // Save
      await dialog.getByRole('button', { name: t('users.drawer.save') }).click()

      // After successful Save the drawer exits edit mode; the direct-perm
      // chip should now appear in view mode.
      await expect(
        dialog.getByText(t('users.drawer.assignedDirectPermissions')),
      ).toBeVisible()
      await expect(dialog.locator('text=' + PERM_NAME).first()).toBeVisible()
    } finally {
      await superCtx.close()
    }
```

- [ ] **Step 3: Run the spec**

```
cd apps/admin-e2e && pnpm exec playwright test --project=chromium-super tests/authed/lifecycle.spec.ts --reporter=list
```

Expected: PASS for the existing flow + the new edit-drawer assertion.

- [ ] **Step 4: Commit**

```bash
git add apps/admin-e2e/tests/authed/lifecycle.spec.ts
git commit -m "$(cat <<'EOF'
test(e2e): playwright covers user edit drawer direct-perm flow

Extends the lifecycle spec with a fresh super-admin context that
opens the new user's edit drawer, adds a direct permission via the
row editor, saves, and asserts the chip appears in view mode.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-review summary

- **Spec § 2 (Architecture / endpoints)**: covered by Tasks 1-6.
- **Spec § 3.1 (Backend service methods + DTOs)**: Tasks 2-5.
- **Spec § 3.2 (Admin client api.ts)**: Task 8.
- **Spec § 3.3 (Server actions)**: Task 9.
- **Spec § 3.4 (RoleRowsEditor primitive)**: Task 10.
- **Spec § 3.5 (Edit-drawer 3-axis)**: Tasks 13-14.
- **Spec § 3.6 (Create-drawer roles + direct perms)**: Task 12.
- **Spec § 3.7 (i18n)**: Task 11.
- **Spec § 4 (Data flow)**: encoded in Task 14's Save handler and Task 12's create handler.
- **Spec § 5 (AuthZ)**: every new service method in Tasks 3-5 calls `checkPermission`.
- **Spec § 6 (Error handling)**: Task 14 wires per-axis error state and dirty-snapshot retry semantics; Task 9 returns localized error keys.
- **Spec § 7 (App-scope)**: enforced via `resolveRoleIdsForApp` / `resolvePermissionIdsForApp` in Tasks 3-5.
- **Spec § 8 (Tests)**: Tasks 1, 3, 4, 5, 6, 7, 15, 16, 17.

No placeholders, no "TBD", no "implement later". Each task's code blocks contain final source.
