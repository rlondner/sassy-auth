# Permissions Admin UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CRUD admin UI for `SaPermission` at `/permissions` — list / view / create / edit / delete — gated by `platform.permissions.manage`, with platform-prefix lock and an `appId` that's immutable post-create.

**Architecture:** Mirrors `/apps` and `/orgs`. New NestJS module `permissions/` in `apps/auth-server/src/` (controller + service + 3 DTOs + spec + module). New Next.js route `(admin)/permissions/{page.tsx,actions.ts}` plus four client components in `apps/admin/components/`. Reuses every shadcn primitive shipped in the reskin (PageHeader, DataTable, Sheet, AlertDialog, ButtonGroup, Badge).

**Tech Stack:** NestJS 10 + Prisma 5 (postgres) on the server. Next.js 15 (App Router) + next-intl + shadcn primitives via `@sassy-auth/ui` on the client. Jest + ts-jest + @testing-library/react for both packages.

**Spec:** [`docs/superpowers/specs/2026-05-31-permissions-admin-ui-design.md`](../specs/2026-05-31-permissions-admin-ui-design.md)

---

## File map

**New (auth-server):**
- `apps/auth-server/src/permissions/permissions.module.ts`
- `apps/auth-server/src/permissions/permissions.controller.ts`
- `apps/auth-server/src/permissions/permissions.service.ts`
- `apps/auth-server/src/permissions/permissions.service.spec.ts`
- `apps/auth-server/src/permissions/dto/create-permission.dto.ts`
- `apps/auth-server/src/permissions/dto/update-permission.dto.ts`
- `apps/auth-server/src/permissions/dto/list-permissions-query.dto.ts`

**New (admin):**
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
- `apps/admin/lib/types.ts` (5 new interfaces — existing `Permission` interface stays untouched)
- `apps/admin/lib/api.ts` (5 new fetch helpers)
- `apps/admin/messages/en.json` (new `permissions.*` block)
- `apps/admin/messages/fr.json` (new `permissions.*` block, translated)

**Working directory for every command in this plan:** `C:\Users\rlond\Documents\GitHub\sassy-auth` (master).

**Baseline state:** master is at the post-reskin tip. The /apps and /orgs admin UIs are working references. `pnpm test -r` is green (194/194). Use a fresh worktree on `feat/permissions-admin-ui` for the work — the previous reskin pattern.

---

## Task 1: Worktree + branch

**Files:** none (just git plumbing).

- [ ] **Step 1: Create the worktree**

Run:
```bash
git worktree add .worktrees/permissions-admin-ui -b feat/permissions-admin-ui master
```

Expected: `Preparing worktree (new branch 'feat/permissions-admin-ui')`. The remaining steps in this plan run from inside `.worktrees/permissions-admin-ui` — pass that as the cwd in subagent invocations or `cd` once at the top of each shell session.

- [ ] **Step 2: Install deps in the worktree**

Run (from the worktree root):
```bash
pnpm install --prefer-offline
```

Expected: completes in ~30s with "Done in Xs". If you see a "Cannot find module 'server-only'" type error later, ensure `apps/admin/__mocks__/server-only.ts` exists (it should — it was added in the reskin clean-up). No commit yet; the worktree itself is the deliverable.

- [ ] **Step 3: Verify baseline tests green**

Run:
```bash
pnpm --filter @sassy-auth/admin test 2>&1 | tail -5
pnpm --filter @sassy-auth/auth-server test 2>&1 | tail -5
```

Expected:
- Admin: `Tests: 43 passed, 43 total`.
- Auth-server: `Tests: 136 passed, 136 total`.

If either differs, stop and reconcile — don't start building on a red baseline.

---

## Task 2: Auth-server DTOs

**Files:**
- Create: `apps/auth-server/src/permissions/dto/create-permission.dto.ts`
- Create: `apps/auth-server/src/permissions/dto/update-permission.dto.ts`
- Create: `apps/auth-server/src/permissions/dto/list-permissions-query.dto.ts`

- [ ] **Step 1: Create the directory**

Run: `mkdir -p apps/auth-server/src/permissions/dto`

- [ ] **Step 2: Write `create-permission.dto.ts`**

Write the file exactly:

```ts
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

// Lowercase dotted segments: lowercase letter start, [a-z0-9]+ body,
// >=2 segments joined by dots. Accepts: apps.read, platform.users.manage,
// org.users.manage. Rejects: Apps.read, 1apps.read, apps, apps_read.
const NAME_REGEX = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]+)+$/;

export class CreatePermissionDto {
  @IsString() @MinLength(3) @MaxLength(120) @Matches(NAME_REGEX, { message: 'name must be lowercase dotted segments (e.g. apps.read)' })
  name: string;

  @IsString() @MinLength(1) @MaxLength(40)
  appId: string;
}
```

- [ ] **Step 3: Write `update-permission.dto.ts`**

```ts
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

const NAME_REGEX = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]+)+$/;

// appId is intentionally NOT in this DTO. With whitelist:true at the
// ValidationPipe (the project default), any appId sent in the body is
// stripped. Service still throws BadRequest if nothing else is supplied.
export class UpdatePermissionDto {
  @IsOptional() @IsString() @MinLength(3) @MaxLength(120) @Matches(NAME_REGEX, { message: 'name must be lowercase dotted segments (e.g. apps.read)' })
  name?: string;
}
```

- [ ] **Step 4: Write `list-permissions-query.dto.ts`**

```ts
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class ListPermissionsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number = 1;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200)
  pageSize?: number = 25;

  @IsOptional() @IsString() @MaxLength(200)
  q?: string;

  @IsOptional() @IsString() @MaxLength(40)
  appId?: string;
}
```

- [ ] **Step 5: Type-check passes**

Run: `pnpm --filter @sassy-auth/auth-server exec tsc --noEmit 2>&1 | grep -E "permissions/dto" || echo "OK"`

Expected: `OK`. No errors from the new files.

- [ ] **Step 6: Commit**

```bash
git add apps/auth-server/src/permissions/dto
git commit -m "$(cat <<'EOF'
feat(auth-server): permissions DTOs

Create / update / list-query DTOs for SaPermission. Name is locked
to a lowercase-dotted-segments regex (e.g. apps.read,
platform.users.manage). appId is required on create, intentionally
not in the update DTO (whitelist strips it; the service still
enforces "at least one field" with BadRequest).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Auth-server service (with TDD spec)

**Files:**
- Create: `apps/auth-server/src/permissions/permissions.service.ts`
- Create: `apps/auth-server/src/permissions/permissions.service.spec.ts`

The spec is the load-bearing test. Write it first.

- [ ] **Step 1: Write `permissions.service.spec.ts`**

```ts
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PermissionsService } from './permissions.service';

jest.mock('@sassy-auth/db', () => ({
  prisma: {
    saPermission: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    saApp: { findUnique: jest.fn() },
    saRolePermission: { count: jest.fn(), groupBy: jest.fn() },
    saUserPermission: { count: jest.fn(), groupBy: jest.fn() },
    $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => {
      const txStub = {
        saPermission: {
          create: jest.fn().mockResolvedValue({ id: 42, name: 'apps.read', appId: 1, publicId: 'placeholder' }),
          update: jest.fn().mockResolvedValue({
            id: 42, publicId: 'XyZ4', name: 'apps.read', appId: 1,
            app: { publicId: 'sq_app1', name: 'Customer Portal' },
          }),
        },
      };
      return cb(txStub);
    }),
  },
}));

jest.mock('../common/permissions/check-permission', () => ({
  checkPermission: jest.fn().mockResolvedValue(undefined),
}));

import { prisma } from '@sassy-auth/db';
import { checkPermission } from '../common/permissions/check-permission';

const mocks = prisma as unknown as {
  saPermission: Record<string, jest.Mock>;
  saApp: Record<string, jest.Mock>;
  saRolePermission: Record<string, jest.Mock>;
  saUserPermission: Record<string, jest.Mock>;
};

function makeService() {
  return new PermissionsService(
    { encode: (id: number) => `sq_${id}` } as never,
    { getWinstonLogger: () => ({ info: jest.fn() }) } as never,
  );
}

describe('PermissionsService', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('listPermissions', () => {
    it('returns rows with roleCount/userCount and respects q + appId filters', async () => {
      mocks.saApp.findUnique.mockResolvedValue({ id: 5, publicId: 'sq_app5' });
      mocks.saPermission.findMany.mockResolvedValue([
        { id: 1, publicId: 'sq_p1', name: 'apps.read', app: { publicId: 'sq_app5', name: 'Portal' } },
        { id: 2, publicId: 'sq_p2', name: 'apps.write', app: { publicId: 'sq_app5', name: 'Portal' } },
      ]);
      mocks.saPermission.count.mockResolvedValue(2);
      mocks.saRolePermission.groupBy.mockResolvedValue([{ permissionId: 1, _count: { _all: 3 } }]);
      mocks.saUserPermission.groupBy.mockResolvedValue([{ permissionId: 2, _count: { _all: 1 } }]);

      const result = await makeService().listPermissions('ba-caller', { q: 'apps', appId: 'sq_app5', page: 1, pageSize: 25 });

      expect(checkPermission).toHaveBeenCalledWith('ba-caller', 'platform.permissions.manage');
      expect(mocks.saPermission.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { appId: 5, name: { contains: 'apps', mode: 'insensitive' } } }),
      );
      expect(result.items).toEqual([
        { publicId: 'sq_p1', name: 'apps.read', app: { publicId: 'sq_app5', name: 'Portal' }, roleCount: 3, userCount: 0 },
        { publicId: 'sq_p2', name: 'apps.write', app: { publicId: 'sq_app5', name: 'Portal' }, roleCount: 0, userCount: 1 },
      ]);
      expect(result.total).toBe(2);
    });

    it('throws NotFound when appId filter does not match an app', async () => {
      mocks.saApp.findUnique.mockResolvedValue(null);
      await expect(makeService().listPermissions('ba-caller', { appId: 'bogus' })).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getPermission', () => {
    it('returns the row with top-50 roles and users + full counts', async () => {
      mocks.saPermission.findUnique.mockResolvedValue({
        id: 7, publicId: 'sq_p7', name: 'apps.write',
        app: { publicId: 'sq_app1', name: 'Portal' },
        roles: [{ role: { publicId: 'sq_r1', name: 'Editor', app: { name: 'Portal' } } }],
        users: [{ user: { publicId: 'sq_u1', firstName: 'Alice', lastName: 'Smith', betterAuthUser: { email: 'alice@example.com' } } }],
      });
      mocks.saRolePermission.count.mockResolvedValue(1);
      mocks.saUserPermission.count.mockResolvedValue(1);

      const result = await makeService().getPermission('ba-caller', 'sq_p7');

      expect(result.publicId).toBe('sq_p7');
      expect(result.roleCount).toBe(1);
      expect(result.userCount).toBe(1);
      expect(result.roles).toEqual([{ publicId: 'sq_r1', name: 'Editor', appName: 'Portal' }]);
      expect(result.users).toEqual([{ publicId: 'sq_u1', email: 'alice@example.com', firstName: 'Alice', lastName: 'Smith' }]);
    });

    it('throws NotFound when the permission does not exist', async () => {
      mocks.saPermission.findUnique.mockResolvedValue(null);
      await expect(makeService().getPermission('ba-caller', 'missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('createPermission', () => {
    it('rejects unknown appId with NotFound', async () => {
      mocks.saApp.findUnique.mockResolvedValue(null);
      await expect(makeService().createPermission('ba-caller', { name: 'apps.read', appId: 'bad' })).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns the new row with zero counts on success', async () => {
      mocks.saApp.findUnique.mockResolvedValue({ id: 1, publicId: 'sq_app1' });
      const result = await makeService().createPermission('ba-caller', { name: 'apps.read', appId: 'sq_app1' });
      expect(result).toEqual({
        publicId: 'sq_42', name: 'apps.read',
        app: { publicId: 'sq_app1', name: 'Customer Portal' },
        roleCount: 0, userCount: 0,
      });
    });

    it('translates Prisma P2002 to ConflictException', async () => {
      mocks.saApp.findUnique.mockResolvedValue({ id: 1, publicId: 'sq_app1' });
      (prisma.$transaction as jest.Mock).mockRejectedValue({ code: 'P2002' });
      await expect(makeService().createPermission('ba-caller', { name: 'apps.read', appId: 'sq_app1' })).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('updatePermission', () => {
    it('rejects when name starts with platform. (Forbidden)', async () => {
      mocks.saPermission.findUnique.mockResolvedValue({ id: 1, publicId: 'sq_p1', name: 'platform.users.manage', appId: 1 });
      await expect(makeService().updatePermission('ba-caller', 'sq_p1', { name: 'platform.users.manage.x' })).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects empty patch with BadRequest', async () => {
      mocks.saPermission.findUnique.mockResolvedValue({ id: 1, publicId: 'sq_p1', name: 'apps.read', appId: 1 });
      await expect(makeService().updatePermission('ba-caller', 'sq_p1', {})).rejects.toBeInstanceOf(BadRequestException);
    });

    it('happy path updates and returns the row', async () => {
      mocks.saPermission.findUnique.mockResolvedValue({ id: 1, publicId: 'sq_p1', name: 'apps.read', appId: 1 });
      mocks.saPermission.update.mockResolvedValue({
        publicId: 'sq_p1', name: 'apps.list', app: { publicId: 'sq_app1', name: 'Portal' },
      });
      mocks.saRolePermission.count.mockResolvedValue(0);
      mocks.saUserPermission.count.mockResolvedValue(0);
      const result = await makeService().updatePermission('ba-caller', 'sq_p1', { name: 'apps.list' });
      expect(result.name).toBe('apps.list');
    });
  });

  describe('deletePermission', () => {
    it('rejects platform.* with Forbidden', async () => {
      mocks.saPermission.findUnique.mockResolvedValue({ id: 1, publicId: 'sq_p1', name: 'platform.users.manage' });
      await expect(makeService().deletePermission('ba-caller', 'sq_p1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('translates Prisma P2003 to ConflictException with a useful message', async () => {
      mocks.saPermission.findUnique.mockResolvedValue({ id: 1, publicId: 'sq_p1', name: 'apps.read' });
      mocks.saRolePermission.count.mockResolvedValue(2);
      mocks.saUserPermission.count.mockResolvedValue(3);
      mocks.saPermission.delete.mockRejectedValue({ code: 'P2003' });
      const promise = makeService().deletePermission('ba-caller', 'sq_p1');
      await expect(promise).rejects.toBeInstanceOf(ConflictException);
      await expect(promise).rejects.toMatchObject({ message: expect.stringContaining('2 roles') });
    });

    it('happy path deletes', async () => {
      mocks.saPermission.findUnique.mockResolvedValue({ id: 1, publicId: 'sq_p1', name: 'apps.read' });
      mocks.saPermission.delete.mockResolvedValue(undefined);
      await expect(makeService().deletePermission('ba-caller', 'sq_p1')).resolves.toBeUndefined();
    });
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails (service doesn't exist yet)**

Run: `pnpm --filter @sassy-auth/auth-server test -- permissions.service.spec`
Expected: FAIL with "Cannot find module './permissions.service'".

- [ ] **Step 3: Write `permissions.service.ts`**

```ts
import {
  BadRequestException, ConflictException, ForbiddenException,
  Injectable, NotFoundException,
} from '@nestjs/common';
import { prisma } from '@sassy-auth/db';
import { SqidService } from '../common/sqid/sqid.service';
import { LoggerService } from '../common/logger/logger.service';
import { checkPermission } from '../common/permissions/check-permission';
import { CreatePermissionDto } from './dto/create-permission.dto';
import { UpdatePermissionDto } from './dto/update-permission.dto';
import { ListPermissionsQueryDto } from './dto/list-permissions-query.dto';

const PERMISSION_INCLUDE = {
  app: { select: { publicId: true, name: true } },
} as const;

const PERMISSION_DETAIL_INCLUDE = {
  app: { select: { publicId: true, name: true } },
  roles: {
    take: 50,
    include: { role: { include: { app: { select: { name: true } } } } },
    orderBy: { role: { name: 'asc' } },
  },
  users: {
    take: 50,
    include: { user: { include: { betterAuthUser: { select: { email: true } } } } },
    orderBy: { user: { betterAuthUser: { email: 'asc' } } },
  },
} as const;

function isPrismaCode(e: unknown, code: string): boolean {
  return typeof e === 'object' && e !== null && 'code' in e && (e as { code?: string }).code === code;
}

function isPlatform(name: string): boolean {
  return name.startsWith('platform.');
}

@Injectable()
export class PermissionsService {
  constructor(
    private readonly sqids: SqidService,
    private readonly logger: LoggerService,
  ) {}

  async listPermissions(callerBaId: string, q: ListPermissionsQueryDto = {}) {
    await checkPermission(callerBaId, 'platform.permissions.manage');
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 25;

    const where: { appId?: number; name?: { contains: string; mode: 'insensitive' } } = {};
    if (q.appId) {
      const app = await prisma.saApp.findUnique({ where: { publicId: q.appId } });
      if (!app) throw new NotFoundException('App not found');
      where.appId = app.id;
    }
    if (q.q) where.name = { contains: q.q, mode: 'insensitive' };

    const [rows, total] = await Promise.all([
      prisma.saPermission.findMany({
        where, skip: (page - 1) * pageSize, take: pageSize,
        orderBy: { id: 'desc' }, include: PERMISSION_INCLUDE,
      }),
      prisma.saPermission.count({ where }),
    ]);

    // Single roundtrip for role/user counts across this page (no N+1).
    const ids = rows.map((r) => (r as { id: number }).id);
    const [roleGroups, userGroups] = ids.length === 0
      ? [[], []] as [Array<{ permissionId: number; _count: { _all: number } }>, Array<{ permissionId: number; _count: { _all: number } }>]
      : await Promise.all([
          prisma.saRolePermission.groupBy({ by: ['permissionId'], where: { permissionId: { in: ids } }, _count: { _all: true } }),
          prisma.saUserPermission.groupBy({ by: ['permissionId'], where: { permissionId: { in: ids } }, _count: { _all: true } }),
        ]);
    const roleMap = new Map(roleGroups.map((g) => [g.permissionId, g._count._all]));
    const userMap = new Map(userGroups.map((g) => [g.permissionId, g._count._all]));

    return {
      items: rows.map((r) => {
        const row = r as { id: number; publicId: string; name: string; app: { publicId: string; name: string } };
        return {
          publicId: row.publicId, name: row.name,
          app: { publicId: row.app.publicId, name: row.app.name },
          roleCount: roleMap.get(row.id) ?? 0,
          userCount: userMap.get(row.id) ?? 0,
        };
      }),
      total, page, pageSize,
    };
  }

  async getPermission(callerBaId: string, publicId: string) {
    await checkPermission(callerBaId, 'platform.permissions.manage');
    const p = await prisma.saPermission.findUnique({ where: { publicId }, include: PERMISSION_DETAIL_INCLUDE });
    if (!p) throw new NotFoundException();
    const row = p as unknown as {
      id: number; publicId: string; name: string;
      app: { publicId: string; name: string };
      roles: Array<{ role: { publicId: string; name: string; app: { name: string } } }>;
      users: Array<{ user: { publicId: string; firstName: string; lastName: string; betterAuthUser: { email: string } } }>;
    };
    const [roleCount, userCount] = await Promise.all([
      prisma.saRolePermission.count({ where: { permissionId: row.id } }),
      prisma.saUserPermission.count({ where: { permissionId: row.id } }),
    ]);
    return {
      publicId: row.publicId, name: row.name,
      app: { publicId: row.app.publicId, name: row.app.name },
      roleCount, userCount,
      roles: row.roles.map((rp) => ({ publicId: rp.role.publicId, name: rp.role.name, appName: rp.role.app.name })),
      users: row.users.map((up) => ({
        publicId: up.user.publicId,
        email: up.user.betterAuthUser.email,
        firstName: up.user.firstName,
        lastName: up.user.lastName,
      })),
    };
  }

  async createPermission(callerBaId: string, dto: CreatePermissionDto) {
    await checkPermission(callerBaId, 'platform.permissions.manage');
    const app = await prisma.saApp.findUnique({ where: { publicId: dto.appId } });
    if (!app) throw new NotFoundException('App not found');
    try {
      type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
      const created = await prisma.$transaction(async (tx: Tx) => {
        const draft = await tx.saPermission.create({
          data: { publicId: 'placeholder', name: dto.name, appId: app.id },
        });
        return tx.saPermission.update({
          where: { id: draft.id },
          data: { publicId: this.sqids.encode(draft.id) },
          include: PERMISSION_INCLUDE,
        });
      });
      this.logger.getWinstonLogger().info('Permission created', { context: 'PermissionsService', permissionId: created.publicId });
      const row = created as unknown as { publicId: string; name: string; app: { publicId: string; name: string } };
      return {
        publicId: row.publicId, name: row.name,
        app: { publicId: row.app.publicId, name: row.app.name },
        roleCount: 0, userCount: 0,
      };
    } catch (e: unknown) {
      if (isPrismaCode(e, 'P2002')) throw new ConflictException('Permission with this name already exists');
      throw e;
    }
  }

  async updatePermission(callerBaId: string, publicId: string, dto: UpdatePermissionDto) {
    await checkPermission(callerBaId, 'platform.permissions.manage');
    if (dto.name === undefined) {
      throw new BadRequestException('At least one of name must be provided');
    }
    const existing = await prisma.saPermission.findUnique({ where: { publicId } });
    if (!existing) throw new NotFoundException();
    if (isPlatform(existing.name)) {
      throw new ForbiddenException('Platform-system permissions cannot be modified');
    }
    try {
      const updated = await prisma.saPermission.update({
        where: { publicId }, data: { name: dto.name }, include: PERMISSION_INCLUDE,
      });
      this.logger.getWinstonLogger().info('Permission updated', { context: 'PermissionsService', permissionId: publicId });
      const row = updated as unknown as { id: number; publicId: string; name: string; app: { publicId: string; name: string } };
      const [roleCount, userCount] = await Promise.all([
        prisma.saRolePermission.count({ where: { permissionId: row.id } }),
        prisma.saUserPermission.count({ where: { permissionId: row.id } }),
      ]);
      return {
        publicId: row.publicId, name: row.name,
        app: { publicId: row.app.publicId, name: row.app.name },
        roleCount, userCount,
      };
    } catch (e: unknown) {
      if (isPrismaCode(e, 'P2002')) throw new ConflictException('Permission with this name already exists');
      throw e;
    }
  }

  async deletePermission(callerBaId: string, publicId: string): Promise<void> {
    await checkPermission(callerBaId, 'platform.permissions.manage');
    const existing = await prisma.saPermission.findUnique({ where: { publicId } });
    if (!existing) throw new NotFoundException();
    if (isPlatform(existing.name)) {
      throw new ForbiddenException('Platform-system permissions cannot be modified');
    }
    try {
      await prisma.saPermission.delete({ where: { publicId } });
      this.logger.getWinstonLogger().info('Permission deleted', { context: 'PermissionsService', permissionId: publicId });
    } catch (e: unknown) {
      if (isPrismaCode(e, 'P2003')) {
        const [roleCount, userCount] = await Promise.all([
          prisma.saRolePermission.count({ where: { permissionId: existing.id } }),
          prisma.saUserPermission.count({ where: { permissionId: existing.id } }),
        ]);
        throw new ConflictException(`Permission is in use by ${roleCount} roles and ${userCount} users`);
      }
      throw e;
    }
  }
}
```

- [ ] **Step 4: Run the spec — expect green**

Run: `pnpm --filter @sassy-auth/auth-server test -- permissions.service.spec`
Expected: `Tests: 11 passed, 11 total`.

If any test fails: read the failure, fix the service (NOT the test, unless the test has a typo) — the test encodes the spec.

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/permissions/permissions.service.ts apps/auth-server/src/permissions/permissions.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(auth-server): PermissionsService with TDD spec

list/get/create/update/delete on SaPermission. Gated by
platform.permissions.manage on every method. Single groupBy for
role/user counts on list (no N+1). View endpoint returns the top 50
roles + users with full counts. Update and delete both throw 403 when
existing.name starts with "platform." — server-enforced lock that
mirrors how isPlatform locks apps/orgs. P2002 -> 409 "name exists",
P2003 on delete -> 409 with role/user count in the message.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Auth-server controller + module + register

**Files:**
- Create: `apps/auth-server/src/permissions/permissions.controller.ts`
- Create: `apps/auth-server/src/permissions/permissions.module.ts`
- Modify: `apps/auth-server/src/app.module.ts`

- [ ] **Step 1: Write `permissions.controller.ts`**

```ts
import {
  Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { BetterAuthGuard } from '../auth/better-auth.guard';
import { BETTER_AUTH_SESSION_COOKIE } from '../common/constants';
import { PermissionsService } from './permissions.service';
import { CreatePermissionDto } from './dto/create-permission.dto';
import { UpdatePermissionDto } from './dto/update-permission.dto';
import { ListPermissionsQueryDto } from './dto/list-permissions-query.dto';

function callerBaId(req: Request): string {
  return (req as unknown as Record<string, { id: string }>)['betterAuthUser'].id;
}

@ApiTags('Permissions')
@ApiCookieAuth(BETTER_AUTH_SESSION_COOKIE)
@UseGuards(BetterAuthGuard)
@Controller('permissions')
export class PermissionsController {
  constructor(private readonly permissions: PermissionsService) {}

  @Get()
  list(@Req() req: Request, @Query() q: ListPermissionsQueryDto) {
    return this.permissions.listPermissions(callerBaId(req), q);
  }

  @Get(':publicId')
  get(@Req() req: Request, @Param('publicId') publicId: string) {
    return this.permissions.getPermission(callerBaId(req), publicId);
  }

  @Post()
  create(@Req() req: Request, @Body() dto: CreatePermissionDto) {
    return this.permissions.createPermission(callerBaId(req), dto);
  }

  @Patch(':publicId')
  update(@Req() req: Request, @Param('publicId') publicId: string, @Body() dto: UpdatePermissionDto) {
    return this.permissions.updatePermission(callerBaId(req), publicId, dto);
  }

  @Delete(':publicId')
  @HttpCode(204)
  remove(@Req() req: Request, @Param('publicId') publicId: string) {
    return this.permissions.deletePermission(callerBaId(req), publicId);
  }
}
```

- [ ] **Step 2: Write `permissions.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { PermissionsService } from './permissions.service';
import { PermissionsController } from './permissions.controller';

@Module({ providers: [PermissionsService], controllers: [PermissionsController] })
export class PermissionsModule {}
```

- [ ] **Step 3: Register in `app.module.ts`**

Read `apps/auth-server/src/app.module.ts`. Add the import after `AppsModule` and put `PermissionsModule` in the `imports` array next to `AppsModule`.

Change line ~10 (the `AppsModule` import) to add a sibling line:
```ts
import { AppsModule } from './apps/apps.module';
import { PermissionsModule } from './permissions/permissions.module';
```

Change the `imports: [...]` array — append `PermissionsModule` after `AppsModule`:
```ts
imports: [SentryModule.forRoot(), CommonModule, AuthModule, TokenModule, UsersModule, InvitationsModule, OrgsModule, RolesModule, AppsModule, PermissionsModule, MeModule],
```

- [ ] **Step 4: Boot auth-server compiles cleanly**

Run: `pnpm --filter @sassy-auth/auth-server exec tsc --noEmit 2>&1 | head -20`
Expected: no output (no errors), or only "warnings" if any pre-existed.

- [ ] **Step 5: Auth-server tests still green**

Run: `pnpm --filter @sassy-auth/auth-server test 2>&1 | tail -5`
Expected: `Tests: 147 passed, 147 total` (baseline 136 + 11 new from Task 3).

- [ ] **Step 6: Commit**

```bash
git add apps/auth-server/src/permissions/permissions.controller.ts apps/auth-server/src/permissions/permissions.module.ts apps/auth-server/src/app.module.ts
git commit -m "$(cat <<'EOF'
feat(auth-server): mount PermissionsController at /api/permissions

5 routes: GET / (list), GET /:publicId (detail), POST / (create),
PATCH /:publicId (update name), DELETE /:publicId. All behind
BetterAuthGuard; the service further gates each call on
platform.permissions.manage.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Admin types + API client helpers

**Files:**
- Modify: `apps/admin/lib/types.ts`
- Modify: `apps/admin/lib/api.ts`

- [ ] **Step 1: Add types to `apps/admin/lib/types.ts`**

Append to the end of the file (DON'T modify the existing `Permission` interface — it's used by the user-view-drawer):

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

export interface CreatePermissionPayload {
  name: string
  appId: string
}

export interface UpdatePermissionPayload {
  name?: string
}

export interface ListPermissionsParams {
  q?: string
  appId?: string
  page?: number
  pageSize?: number
}

export interface ListPermissionsResponse {
  items: PermissionRow[]
  total: number
  page: number
  pageSize: number
}
```

- [ ] **Step 2: Extend the top-level type import in `apps/admin/lib/api.ts`**

Change the single `import type { ... } from './types'` line at the top of `api.ts`. Append these names to the existing import list:
`PermissionRow, PermissionDetail, CreatePermissionPayload, UpdatePermissionPayload, ListPermissionsParams, ListPermissionsResponse`.

After the change, the import should still be one (long) line.

- [ ] **Step 3: Append the 5 fetch helpers to `apps/admin/lib/api.ts`**

Append at the end of the file, after `getMyPermissions`:

```ts
export async function getPermissions(params: ListPermissionsParams = {}): Promise<ListPermissionsResponse> {
  const qs = new URLSearchParams()
  if (params.q) qs.set('q', params.q)
  if (params.appId) qs.set('appId', params.appId)
  if (params.page) qs.set('page', String(params.page))
  if (params.pageSize) qs.set('pageSize', String(params.pageSize))
  const suffix = qs.toString() ? `?${qs.toString()}` : ''
  const res = await apiFetch(`/api/permissions${suffix}`)
  return res.json()
}

export async function getPermission(publicId: string): Promise<PermissionDetail> {
  const res = await apiFetch(`/api/permissions/${publicId}`)
  return res.json()
}

export async function createPermission(payload: CreatePermissionPayload): Promise<PermissionRow> {
  const res = await apiFetch('/api/permissions', { method: 'POST', body: JSON.stringify(payload) })
  return res.json()
}

export async function updatePermission(publicId: string, patch: UpdatePermissionPayload): Promise<PermissionRow> {
  const res = await apiFetch(`/api/permissions/${publicId}`, { method: 'PATCH', body: JSON.stringify(patch) })
  return res.json()
}

export async function deletePermission(publicId: string): Promise<void> {
  await apiFetch(`/api/permissions/${publicId}`, { method: 'DELETE' })
}
```

- [ ] **Step 4: Type-check passes**

Run: `pnpm --filter @sassy-auth/admin exec tsc --noEmit 2>&1 | grep -E "(api\.ts|types\.ts)" || echo "OK"`
Expected: `OK`.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/lib/types.ts apps/admin/lib/api.ts
git commit -m "$(cat <<'EOF'
feat(admin): types + api client for permissions

PermissionRow + PermissionDetail + the 3 payload/param shapes. Five
fetch helpers (getPermissions/getPermission/createPermission/
updatePermission/deletePermission). The existing Permission interface
used by user-view-drawer is intentionally untouched — these are
distinct named types.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Server actions

**Files:**
- Create: `apps/admin/app/(admin)/permissions/actions.ts`

- [ ] **Step 1: Create the directory**

Run: `mkdir -p 'apps/admin/app/(admin)/permissions'`

- [ ] **Step 2: Write `actions.ts`**

```ts
'use server'

import { revalidatePath } from 'next/cache'
import {
  createPermission, updatePermission, deletePermission, getPermissions, getPermission,
} from '@/lib/api'
import type {
  PermissionRow, PermissionDetail,
  CreatePermissionPayload, UpdatePermissionPayload,
  ListPermissionsParams, ListPermissionsResponse,
} from '@/lib/types'

type ErrorResult = { errorKey: string }

function mapError(message: string, kind: 'create' | 'update' | 'delete'): string {
  if (message.includes('409')) {
    if (kind === 'delete') return 'permissions.errors.inUse'
    return 'permissions.errors.nameExists'
  }
  if (message.includes('404')) {
    if (kind === 'create') return 'permissions.errors.appNotFound'
    return 'permissions.errors.generic'
  }
  if (message.includes('403')) {
    if (kind !== 'delete') return 'permissions.errors.platformProtected'
    return 'permissions.errors.forbidden'
  }
  if (message.includes('400')) return 'permissions.errors.nameInvalid'
  return 'permissions.errors.generic'
}

export async function createPermissionAction(
  input: CreatePermissionPayload,
): Promise<{ permission: PermissionRow } | ErrorResult> {
  try {
    const permission = await createPermission(input)
    revalidatePath('/permissions')
    return { permission }
  } catch (err) {
    return { errorKey: mapError(err instanceof Error ? err.message : '', 'create') }
  }
}

export async function updatePermissionAction(
  publicId: string,
  patch: UpdatePermissionPayload,
): Promise<{ permission: PermissionRow } | ErrorResult> {
  try {
    const permission = await updatePermission(publicId, patch)
    revalidatePath('/permissions')
    return { permission }
  } catch (err) {
    return { errorKey: mapError(err instanceof Error ? err.message : '', 'update') }
  }
}

export async function deletePermissionAction(
  publicId: string,
): Promise<{ ok: true } | ErrorResult> {
  try {
    await deletePermission(publicId)
    revalidatePath('/permissions')
    return { ok: true }
  } catch (err) {
    return { errorKey: mapError(err instanceof Error ? err.message : '', 'delete') }
  }
}

export async function listPermissionsAction(
  params: ListPermissionsParams,
): Promise<ListPermissionsResponse | ErrorResult> {
  try {
    return await getPermissions(params)
  } catch (err) {
    return {
      errorKey:
        err instanceof Error && err.message.includes('403')
          ? 'permissions.errors.forbidden'
          : 'permissions.errors.generic',
    }
  }
}

export async function getPermissionAction(
  publicId: string,
): Promise<PermissionDetail | ErrorResult> {
  try {
    return await getPermission(publicId)
  } catch (err) {
    return {
      errorKey:
        err instanceof Error && err.message.includes('403')
          ? 'permissions.errors.forbidden'
          : 'permissions.errors.generic',
    }
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add 'apps/admin/app/(admin)/permissions/actions.ts'
git commit -m "$(cat <<'EOF'
feat(admin): server actions for permissions CRUD

Five actions (create/update/delete/list/get) wrap lib/api with the
same mapError pattern as /apps and /orgs. 409->nameExists/inUse;
404->appNotFound/generic; 403->platformProtected/forbidden;
400->nameInvalid. Each mutation revalidatePath('/permissions').

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: i18n strings (en + fr)

**Files:**
- Modify: `apps/admin/messages/en.json`
- Modify: `apps/admin/messages/fr.json`

- [ ] **Step 1: Add the `permissions.*` block to `en.json`**

Read the existing file. Insert this block as a sibling of the existing `orgs` block (top-level key, immediately after `orgs`):

```json
"permissions": {
  "title": "Permissions",
  "subtitle": "Manage the permissions that roles and users can be assigned.",
  "totalCount": "{count} Total",
  "search": "Search by permission name…",
  "create": "Add Permission",
  "accessDenied": {
    "title": "Access denied",
    "body": "You do not have access to data on this page."
  },
  "columns": {
    "nameAndApp": "Permission & App",
    "sqid": "Public ID (Sqid)",
    "usage": "Usage",
    "actions": "Actions"
  },
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
  "actions": {
    "view": "View",
    "edit": "Edit",
    "delete": "Delete",
    "copy": "Copy",
    "copied": "Copied!"
  },
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
    "showingTop50": "Showing top 50 of {total}",
    "inUseTooltip": "In use by {roleCount} roles, {userCount} users — remove assignments first"
  },
  "filter": { "appLabel": "Filter by app", "allApps": "All apps" },
  "pagination": {
    "showing": "Showing {from}–{to} of {total}",
    "pageSize": "{count} per page",
    "previous": "Previous",
    "next": "Next"
  },
  "confirmDelete": {
    "title": "Delete permission",
    "body": "Delete \"{name}\"? This cannot be undone.",
    "button": "Delete"
  },
  "errors": {
    "nameRequired": "Name is required.",
    "nameInvalid": "Name must be lowercase, dotted (e.g. apps.read).",
    "nameExists": "A permission with that name already exists.",
    "appRequired": "App is required.",
    "appNotFound": "Selected app could not be found.",
    "inUse": "Permission is in use by roles or users. Remove assignments first.",
    "platformProtected": "Platform-system permissions cannot be modified.",
    "forbidden": "You do not have permission to perform this action.",
    "generic": "Something went wrong. Please try again."
  }
}
```

Make sure the JSON stays valid — add a trailing comma to the previous block, no trailing comma on the new block if it's the last sibling.

- [ ] **Step 2: Validate JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('apps/admin/messages/en.json','utf8')); console.log('OK')"`
Expected: `OK`.

- [ ] **Step 3: Add the matching block to `fr.json`**

Read `apps/admin/messages/fr.json`. Insert the same block under `permissions`, with French strings:

```json
"permissions": {
  "title": "Permissions",
  "subtitle": "Gérez les permissions assignables aux rôles et utilisateurs.",
  "totalCount": "{count} au total",
  "search": "Rechercher par nom de permission…",
  "create": "Ajouter une permission",
  "accessDenied": {
    "title": "Accès refusé",
    "body": "Vous n'avez pas accès aux données de cette page."
  },
  "columns": {
    "nameAndApp": "Permission et application",
    "sqid": "ID public (Sqid)",
    "usage": "Utilisation",
    "actions": "Actions"
  },
  "fields": {
    "name": "Nom",
    "nameHint": "Notation pointée en minuscules, par ex. apps.read ou org.users.manage.",
    "app": "Application",
    "appImmutable": "L'application ne peut pas être modifiée après création.",
    "publicId": "ID public",
    "rolesShort": "rôles",
    "usersShort": "utilisateurs"
  },
  "badges": { "platform": "Plateforme" },
  "actions": {
    "view": "Voir",
    "edit": "Modifier",
    "delete": "Supprimer",
    "copy": "Copier",
    "copied": "Copié !"
  },
  "drawer": {
    "cancel": "Annuler",
    "save": "Enregistrer",
    "saving": "Enregistrement…",
    "createTitle": "Ajouter une permission",
    "createSubtitle": "Définir une nouvelle permission liée à une application.",
    "editTitle": "Modifier la permission",
    "viewTitle": "Détails de la permission",
    "rolesSection": "Assignée aux rôles",
    "usersSection": "Attribuée directement aux utilisateurs",
    "noRoles": "Aucun rôle ne détient cette permission.",
    "noUsers": "Aucun utilisateur ne détient directement cette permission.",
    "showingTop50": "Affichage des 50 premiers sur {total}",
    "inUseTooltip": "Utilisée par {roleCount} rôles, {userCount} utilisateurs — retirez les assignations d'abord"
  },
  "filter": { "appLabel": "Filtrer par application", "allApps": "Toutes les applications" },
  "pagination": {
    "showing": "Affichage de {from}–{to} sur {total}",
    "pageSize": "{count} par page",
    "previous": "Précédent",
    "next": "Suivant"
  },
  "confirmDelete": {
    "title": "Supprimer la permission",
    "body": "Supprimer « {name} » ? Cette action est irréversible.",
    "button": "Supprimer"
  },
  "errors": {
    "nameRequired": "Le nom est obligatoire.",
    "nameInvalid": "Le nom doit être en minuscules et pointé (par ex. apps.read).",
    "nameExists": "Une permission avec ce nom existe déjà.",
    "appRequired": "L'application est obligatoire.",
    "appNotFound": "L'application sélectionnée est introuvable.",
    "inUse": "Permission utilisée par des rôles ou utilisateurs. Retirez d'abord les assignations.",
    "platformProtected": "Les permissions système de la plateforme ne peuvent pas être modifiées.",
    "forbidden": "Vous n'avez pas la permission d'effectuer cette action.",
    "generic": "Une erreur est survenue. Veuillez réessayer."
  }
}
```

- [ ] **Step 4: Validate JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('apps/admin/messages/fr.json','utf8')); console.log('OK')"`
Expected: `OK`.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/messages/en.json apps/admin/messages/fr.json
git commit -m "$(cat <<'EOF'
i18n(admin): permissions.* block (en + fr)

Mirrors the shape of orgs.*. Includes column headers, drawer copy,
field hints, filter labels, pagination, delete confirm, full error
key set (nameInvalid, nameExists, inUse, platformProtected,
appNotFound, forbidden, generic).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: PermissionCreateDrawer

**Files:**
- Create: `apps/admin/components/permission-create-drawer.tsx`

- [ ] **Step 1: Write the component**

```tsx
'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import {
  Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle,
  Button, ButtonGroup, Input, Label,
} from '@sassy-auth/ui'
import { createPermissionAction } from '@/app/(admin)/permissions/actions'
import type { App } from '@/lib/types'

const NAME_REGEX = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]+)+$/

interface Props {
  apps: App[]
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function PermissionCreateDrawer({ apps, open, onOpenChange }: Props) {
  const t = useTranslations()
  const [name, setName] = React.useState('')
  const [appId, setAppId] = React.useState('')
  const [errorKey, setErrorKey] = React.useState<string | null>(null)
  const [pending, startTransition] = React.useTransition()

  React.useEffect(() => {
    if (!open) {
      setName('')
      setAppId('')
      setErrorKey(null)
    }
  }, [open])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!appId) { setErrorKey('permissions.errors.appRequired'); return }
    if (!name.trim()) { setErrorKey('permissions.errors.nameRequired'); return }
    if (!NAME_REGEX.test(name.trim())) { setErrorKey('permissions.errors.nameInvalid'); return }
    setErrorKey(null)
    startTransition(async () => {
      const result = await createPermissionAction({ name: name.trim(), appId })
      if ('errorKey' in result) setErrorKey(result.errorKey)
      else onOpenChange(false)
    })
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <div>
            <SheetTitle>{t('permissions.drawer.createTitle')}</SheetTitle>
            <SheetDescription>{t('permissions.drawer.createSubtitle')}</SheetDescription>
          </div>
        </SheetHeader>
        <SheetBody>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="permApp">{t('permissions.fields.app')}</Label>
              <select
                id="permApp"
                value={appId}
                onChange={(e) => setAppId(e.target.value)}
                required
                className="mt-1 block h-9 w-full rounded border border-border bg-card px-2 text-body-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="" disabled>—</option>
                {apps.map((a) => (
                  <option key={a.publicId} value={a.publicId}>{a.name}</option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="permName">{t('permissions.fields.name')}</Label>
              <Input
                id="permName"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="apps.read"
                className="font-mono"
              />
              <p className="mt-1 text-label-sm text-muted-foreground">{t('permissions.fields.nameHint')}</p>
            </div>
            {errorKey && (
              <p role="alert" className="text-body-sm text-destructive">
                {t(errorKey)}
              </p>
            )}
            <div className="flex justify-end pt-4">
              <ButtonGroup>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={pending}
                >
                  {t('permissions.drawer.cancel')}
                </Button>
                <Button type="submit" disabled={pending}>
                  {pending ? t('permissions.drawer.saving') : t('permissions.drawer.createTitle')}
                </Button>
              </ButtonGroup>
            </div>
          </form>
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/admin/components/permission-create-drawer.tsx
git commit -m "$(cat <<'EOF'
feat(admin): PermissionCreateDrawer

Sheet form with App select (all apps, including platform — server
gates create at the route, not the form) + Name input (mono font,
client-side regex check on submit). ButtonGroup footer.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: PermissionEditDrawer

**Files:**
- Create: `apps/admin/components/permission-edit-drawer.tsx`

- [ ] **Step 1: Write the component**

```tsx
'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import {
  Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle,
  Button, ButtonGroup, Input, Label,
} from '@sassy-auth/ui'
import { updatePermissionAction } from '@/app/(admin)/permissions/actions'
import { copyToClipboard } from '@/lib/clipboard'
import type { PermissionRow } from '@/lib/types'

const NAME_REGEX = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]+)+$/

interface Props {
  permission: PermissionRow
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function PermissionEditDrawer({ permission, open, onOpenChange }: Props) {
  const t = useTranslations()
  const [name, setName] = React.useState(permission.name)
  const [errorKey, setErrorKey] = React.useState<string | null>(null)
  const [copied, setCopied] = React.useState(false)
  const [pending, startTransition] = React.useTransition()

  React.useEffect(() => {
    setName(permission.name)
    setErrorKey(null)
  }, [permission])

  const dirty = name !== permission.name

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!dirty) return
    if (!NAME_REGEX.test(name.trim())) { setErrorKey('permissions.errors.nameInvalid'); return }
    startTransition(async () => {
      const result = await updatePermissionAction(permission.publicId, { name: name.trim() })
      if ('errorKey' in result) setErrorKey(result.errorKey)
      else onOpenChange(false)
    })
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{t('permissions.drawer.editTitle')}</SheetTitle>
        </SheetHeader>
        <SheetBody>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="permName">{t('permissions.fields.name')}</Label>
              <Input
                id="permName"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="font-mono"
              />
              <p className="mt-1 text-label-sm text-muted-foreground">{t('permissions.fields.nameHint')}</p>
            </div>
            <div>
              <Label>{t('permissions.fields.app')}</Label>
              <div className="mt-1 flex items-center justify-between rounded border border-border bg-card px-3 py-2">
                <span className="text-body-sm">{permission.app.name}</span>
                <code className="font-mono text-label-md text-muted-foreground">{permission.app.publicId}</code>
              </div>
              <p className="mt-1 text-label-sm text-muted-foreground">{t('permissions.fields.appImmutable')}</p>
            </div>
            <div>
              <Label htmlFor="permPublicId">{t('permissions.fields.publicId')}</Label>
              <div className="flex gap-2">
                <Input id="permPublicId" value={permission.publicId} readOnly className="font-mono" />
                <Button
                  type="button"
                  variant="outline"
                  aria-label={t('permissions.actions.copy')}
                  onClick={() =>
                    copyToClipboard(permission.publicId, () => {
                      setCopied(true)
                      setTimeout(() => setCopied(false), 2000)
                    })
                  }
                >
                  <span className="material-symbols-outlined text-[16px]">
                    {copied ? 'check' : 'content_copy'}
                  </span>
                </Button>
              </div>
              {copied && (
                <p className="mt-1 text-label-sm text-primary">{t('permissions.actions.copied')}</p>
              )}
            </div>
            {errorKey && (
              <p role="alert" className="text-body-sm text-destructive">{t(errorKey)}</p>
            )}
            <div className="flex justify-end pt-4">
              <ButtonGroup>
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
                  {t('permissions.drawer.cancel')}
                </Button>
                <Button type="submit" disabled={!dirty || pending}>
                  {pending ? t('permissions.drawer.saving') : t('permissions.drawer.save')}
                </Button>
              </ButtonGroup>
            </div>
          </form>
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/admin/components/permission-edit-drawer.tsx
git commit -m "$(cat <<'EOF'
feat(admin): PermissionEditDrawer

Editable Name (mono, regex'd on submit). Read-only App display +
copy-able Public ID. Save disabled until dirty. Mirrors OrgEditDrawer
pattern.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: PermissionViewDrawer

**Files:**
- Create: `apps/admin/components/permission-view-drawer.tsx`

- [ ] **Step 1: Write the component**

```tsx
'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { KeyRound, ShieldEllipsis, Users } from 'lucide-react'
import {
  Sheet, SheetBody, SheetClose, SheetContent, SheetHeader, SheetTitle,
  Button, ButtonGroup, Badge, UserAvatar,
} from '@sassy-auth/ui'
import { copyToClipboard } from '@/lib/clipboard'
import { getPermissionAction } from '@/app/(admin)/permissions/actions'
import type { PermissionRow, PermissionDetail } from '@/lib/types'

interface Props {
  permission: PermissionRow
  open: boolean
  onOpenChange: (open: boolean) => void
  onEdit: () => void
  onDelete: () => void
}

export function PermissionViewDrawer({ permission, open, onOpenChange, onEdit, onDelete }: Props) {
  const t = useTranslations()
  const [detail, setDetail] = React.useState<PermissionDetail | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [copied, setCopied] = React.useState<string | null>(null)

  const isPlatform = permission.name.startsWith('platform.')

  React.useEffect(() => {
    if (!open) return
    setLoading(true)
    setDetail(null)
    getPermissionAction(permission.publicId)
      .then((res) => { if ('publicId' in res) setDetail(res) })
      .finally(() => setLoading(false))
  }, [open, permission.publicId])

  function copy(text: string, key: string) {
    copyToClipboard(text, () => {
      setCopied(key)
      setTimeout(() => setCopied(null), 2000)
    })
  }

  const roles = detail?.roles ?? []
  const users = detail?.users ?? []
  const roleCount = detail?.roleCount ?? permission.roleCount
  const userCount = detail?.userCount ?? permission.userCount

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded border border-border bg-muted text-primary">
              <KeyRound className="h-5 w-5" />
            </div>
            <SheetTitle className="font-mono">{permission.name}</SheetTitle>
            {isPlatform && <Badge variant="secondary">{t('permissions.badges.platform')}</Badge>}
          </div>
          <div className="flex items-center gap-2">
            {!isPlatform && (
              <ButtonGroup>
                <Button size="sm" variant="outline" onClick={onEdit}>{t('permissions.actions.edit')}</Button>
                <Button
                  size="sm" variant="outline"
                  className="border-destructive text-destructive"
                  onClick={onDelete}
                  disabled={roleCount + userCount > 0}
                  title={roleCount + userCount > 0 ? t('permissions.drawer.inUseTooltip', { roleCount, userCount }) : undefined}
                >
                  {t('permissions.actions.delete')}
                </Button>
              </ButtonGroup>
            )}
            <SheetClose asChild>
              <button className="ml-2 flex h-7 w-7 items-center justify-center rounded hover:bg-muted">
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </SheetClose>
          </div>
        </SheetHeader>
        <SheetBody className="space-y-6">
          <DetailRow
            label={t('permissions.fields.app')}
            value={permission.app.name}
            onCopy={() => copy(permission.app.publicId, 'app')}
            copied={copied === 'app'}
            copyLabel={t('permissions.actions.copy')}
          />
          <DetailRow
            label={t('permissions.fields.publicId')}
            value={permission.publicId}
            mono
            onCopy={() => copy(permission.publicId, 'sqid')}
            copied={copied === 'sqid'}
            copyLabel={t('permissions.actions.copy')}
          />

          {/* Roles section */}
          <section className="rounded-xl border border-border bg-card shadow-sm p-6">
            <header className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-label-sm font-bold uppercase tracking-wider text-muted-foreground">
                <ShieldEllipsis className="h-4 w-4" />
                {t('permissions.drawer.rolesSection')}
                <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{roleCount}</span>
              </h3>
              {roleCount > 50 && (
                <span className="text-label-sm text-muted-foreground">{t('permissions.drawer.showingTop50', { total: roleCount })}</span>
              )}
            </header>
            {loading ? (
              <p className="text-body-sm text-muted-foreground">…</p>
            ) : roles.length === 0 ? (
              <p className="text-body-sm text-muted-foreground">{t('permissions.drawer.noRoles')}</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {roles.map((r) => (
                  <Badge key={r.publicId} variant="secondary" title={r.appName}>{r.name}</Badge>
                ))}
              </div>
            )}
          </section>

          {/* Users section */}
          <section className="rounded-xl border border-border bg-card shadow-sm p-6">
            <header className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-label-sm font-bold uppercase tracking-wider text-muted-foreground">
                <Users className="h-4 w-4" />
                {t('permissions.drawer.usersSection')}
                <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{userCount}</span>
              </h3>
              {userCount > 50 && (
                <span className="text-label-sm text-muted-foreground">{t('permissions.drawer.showingTop50', { total: userCount })}</span>
              )}
            </header>
            {loading ? (
              <p className="text-body-sm text-muted-foreground">…</p>
            ) : users.length === 0 ? (
              <p className="text-body-sm text-muted-foreground">{t('permissions.drawer.noUsers')}</p>
            ) : (
              <ul className="divide-y divide-border">
                {users.map((u) => (
                  <li key={u.publicId} className="flex items-center gap-3 py-2">
                    <UserAvatar firstName={u.firstName} lastName={u.lastName} size="sm" />
                    <div className="min-w-0">
                      <p className="truncate text-body-sm font-medium text-foreground">{u.firstName} {u.lastName}</p>
                      <p className="truncate text-label-sm text-muted-foreground">{u.email}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}

function DetailRow({
  label, value, onCopy, copied, mono, copyLabel,
}: { label: string; value: string; onCopy: () => void; copied: boolean; mono?: boolean; copyLabel: string }) {
  return (
    <div>
      <p className="text-label-sm font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-center justify-between rounded border border-border bg-card px-3 py-2">
        <code className={mono ? 'font-mono text-body-sm' : 'text-body-sm'}>{value}</code>
        <button type="button" aria-label={copyLabel} onClick={onCopy} className="text-muted-foreground hover:text-primary">
          <span className="material-symbols-outlined text-[16px]">{copied ? 'check' : 'content_copy'}</span>
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/admin/components/permission-view-drawer.tsx
git commit -m "$(cat <<'EOF'
feat(admin): PermissionViewDrawer

Header with KeyRound icon + mono name + Platform badge (when prefix
matches) + Edit/Delete ButtonGroup (hidden entirely for platform.*).
Two card sections: Roles (Badge chips, role.appName as tooltip) and
Users (avatar + name + email list). Both show count + "top 50 of N"
when capped. Delete button is disabled with tooltip when roleCount +
userCount > 0; the AlertDialog in the table also fronts the server's
P2003 -> 409 with the inUse error key.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: PermissionsTable

**Files:**
- Create: `apps/admin/components/permissions-table.tsx`

- [ ] **Step 1: Write the component**

```tsx
'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { ColumnDef } from '@tanstack/react-table'
import { KeyRound, Plus, Search } from 'lucide-react'
import {
  Button, ButtonGroup, DataTable, DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger, Badge,
} from '@sassy-auth/ui'
import { copyToClipboard } from '@/lib/clipboard'
import { deletePermissionAction, listPermissionsAction } from '@/app/(admin)/permissions/actions'
import type { App, PermissionRow, ListPermissionsResponse } from '@/lib/types'
import { PermissionViewDrawer } from './permission-view-drawer'
import { PermissionCreateDrawer } from './permission-create-drawer'
import { PermissionEditDrawer } from './permission-edit-drawer'
import { DeleteAlertDialog } from './delete-alert-dialog'
import { PageHeader } from './page-header'

interface Props { initial: ListPermissionsResponse; apps: App[] }

export function PermissionsTable({ initial, apps }: Props) {
  const t = useTranslations()
  const [data, setData] = React.useState(initial)
  const [query, setQuery] = React.useState('')
  const [appFilter, setAppFilter] = React.useState('')
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(initial.pageSize ?? 25)
  const [selected, setSelected] = React.useState<PermissionRow | null>(null)
  const [viewOpen, setViewOpen] = React.useState(false)
  const [editOpen, setEditOpen] = React.useState(false)
  const [createOpen, setCreateOpen] = React.useState(false)
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [deleteError, setDeleteError] = React.useState<string | null>(null)
  const [copiedSqid, setCopiedSqid] = React.useState<string | null>(null)
  const initialRefRef = React.useRef(true)

  React.useEffect(() => {
    if (initialRefRef.current) {
      initialRefRef.current = false
      return
    }
    const timer = setTimeout(async () => {
      const params = {
        q: query || undefined,
        appId: appFilter || undefined,
        page, pageSize,
      }
      const result = await listPermissionsAction(params)
      if (result && 'items' in result) setData(result)
    }, 300)
    return () => clearTimeout(timer)
  }, [query, appFilter, page, pageSize])

  const columns: ColumnDef<PermissionRow>[] = [
    {
      id: 'nameAndApp',
      header: t('permissions.columns.nameAndApp'),
      cell: ({ row }) => {
        const p = row.original
        const platform = p.name.startsWith('platform.')
        return (
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded border border-border bg-muted text-primary">
              <KeyRound className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <code className="font-mono text-body-sm font-semibold">{p.name}</code>
                {platform && <Badge variant="secondary">{t('permissions.badges.platform')}</Badge>}
              </div>
              <p className="text-label-md text-muted-foreground">{p.app.name}</p>
            </div>
          </div>
        )
      },
    },
    {
      id: 'sqid',
      header: t('permissions.columns.sqid'),
      cell: ({ row }) => {
        const p = row.original
        const copied = copiedSqid === p.publicId
        return (
          <div className="flex items-center gap-2">
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-label-md">{p.publicId}</code>
            <button
              type="button"
              aria-label={t('permissions.actions.copy')}
              onClick={(e) => {
                e.stopPropagation()
                copyToClipboard(p.publicId, () => {
                  setCopiedSqid(p.publicId)
                  setTimeout(() => setCopiedSqid(null), 2000)
                })
              }}
              className="text-muted-foreground hover:text-primary"
            >
              <span className="material-symbols-outlined text-[14px]">{copied ? 'check' : 'content_copy'}</span>
            </button>
          </div>
        )
      },
    },
    {
      id: 'usage',
      header: t('permissions.columns.usage'),
      cell: ({ row }) => (
        <span className="tabular-nums text-body-sm text-muted-foreground">
          {row.original.roleCount} {t('permissions.fields.rolesShort')} · {row.original.userCount} {t('permissions.fields.usersShort')}
        </span>
      ),
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => {
        const p = row.original
        const platform = p.name.startsWith('platform.')
        const inUse = p.roleCount + p.userCount > 0
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <button aria-label="more actions" className="flex h-7 w-7 items-center justify-center rounded hover:bg-muted">
                <span className="material-symbols-outlined text-[20px] text-muted-foreground">more_vert</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setSelected(p); setViewOpen(true) }}>
                {t('permissions.actions.view')}
              </DropdownMenuItem>
              {!platform && (
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setSelected(p); setEditOpen(true) }}>
                  {t('permissions.actions.edit')}
                </DropdownMenuItem>
              )}
              {!platform && <DropdownMenuSeparator />}
              {!platform && (
                <DropdownMenuItem
                  className="text-destructive"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (inUse) return
                    setSelected(p); setDeleteError(null); setDeleteOpen(true)
                  }}
                  title={inUse ? t('permissions.drawer.inUseTooltip', { roleCount: p.roleCount, userCount: p.userCount }) : undefined}
                  data-disabled={inUse ? '' : undefined}
                >
                  {t('permissions.actions.delete')}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )
      },
    },
  ]

  async function handleDelete() {
    if (!selected) return
    const result = await deletePermissionAction(selected.publicId)
    if (result && 'errorKey' in result) {
      setDeleteError(t(result.errorKey))
      return
    }
    setDeleteOpen(false)
    setViewOpen(false)
    const refreshed = await listPermissionsAction({
      q: query || undefined, appId: appFilter || undefined, page, pageSize,
    })
    if (refreshed && 'items' in refreshed) setData(refreshed)
  }

  return (
    <>
      <PageHeader
        crumbs={[
          { href: '/permissions', label: t('nav.accessControl') },
          { label: t('permissions.title') },
        ]}
        actions={
          <>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="sr-only">{t('permissions.filter.appLabel')}</span>
              <select
                aria-label={t('permissions.filter.appLabel')}
                value={appFilter}
                onChange={(e) => { setAppFilter(e.target.value); setPage(1) }}
                className="h-9 rounded-md border border-input bg-card px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">{t('permissions.filter.allApps')}</option>
                {apps.map((a) => (
                  <option key={a.publicId} value={a.publicId}>{a.name}</option>
                ))}
              </select>
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                placeholder={t('permissions.search')}
                value={query}
                onChange={(e) => { setQuery(e.target.value); setPage(1) }}
                className="h-9 w-64 rounded-md border border-input bg-muted pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <ButtonGroup>
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" />
                {t('permissions.create')}
              </Button>
            </ButtonGroup>
          </>
        }
      />

      <div className="px-8 py-4">
        <DataTable
          columns={columns}
          data={data.items}
          onRowClick={(p) => { setSelected(p); setViewOpen(true) }}
        />
        <Pagination
          page={page} pageSize={pageSize} total={data.total}
          onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1) }}
          t={t}
        />
      </div>

      {selected && (
        <PermissionViewDrawer
          permission={selected}
          open={viewOpen}
          onOpenChange={setViewOpen}
          onEdit={() => { setViewOpen(false); setEditOpen(true) }}
          onDelete={() => { setDeleteError(null); setDeleteOpen(true) }}
        />
      )}
      {selected && (
        <PermissionEditDrawer
          permission={selected}
          open={editOpen}
          onOpenChange={setEditOpen}
        />
      )}
      <PermissionCreateDrawer apps={apps} open={createOpen} onOpenChange={setCreateOpen} />
      {selected && (
        <DeleteAlertDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          title={t('permissions.confirmDelete.title')}
          description={t('permissions.confirmDelete.body', { name: selected.name })}
          confirmLabel={t('permissions.confirmDelete.button')}
          cancelLabel={t('permissions.drawer.cancel')}
          error={deleteError}
          onConfirm={handleDelete}
        />
      )}
    </>
  )
}

function Pagination({
  page, pageSize, total, onPage, onPageSize, t,
}: { page: number; pageSize: number; total: number; onPage: (n: number) => void; onPageSize: (n: number) => void; t: ReturnType<typeof useTranslations> }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(total, page * pageSize)

  return (
    <div className="mt-4 flex items-center justify-between text-body-sm text-muted-foreground">
      <div className="flex items-center gap-3">
        <span>{t('permissions.pagination.showing', { from, to, total })}</span>
        <select
          value={pageSize}
          onChange={(e) => onPageSize(Number(e.target.value))}
          className="rounded border border-border bg-card px-2 py-1 text-body-sm"
        >
          {[5, 10, 25, 50].map((n) => (
            <option key={n} value={n}>{t('permissions.pagination.pageSize', { count: n })}</option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <button disabled={page <= 1} onClick={() => onPage(page - 1)} className="rounded border border-border px-2 py-1 disabled:opacity-30">
          {t('permissions.pagination.previous')}
        </button>
        <span>{page} / {totalPages}</span>
        <button disabled={page >= totalPages} onClick={() => onPage(page + 1)} className="rounded border border-border px-2 py-1 disabled:opacity-30">
          {t('permissions.pagination.next')}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/admin/components/permissions-table.tsx
git commit -m "$(cat <<'EOF'
feat(admin): PermissionsTable

PageHeader with App filter + Search + Add Permission ButtonGroup.
DataTable columns: Name+App (mono name, Platform badge for
platform.*), Public ID + copy, Usage ("N roles · M users"), Actions
dropdown. Edit/Delete hidden for platform.* rows; Delete is disabled
client-side when in use (server still 409s as a safety net).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Page

**Files:**
- Create: `apps/admin/app/(admin)/permissions/page.tsx`

- [ ] **Step 1: Write the page**

```tsx
import { getPermissions, getApps, getMyPermissions } from '@/lib/api'
import { PermissionsTable } from '@/components/permissions-table'
import { AccessDeniedPanel } from '@/components/access-denied-panel'

export default async function PermissionsPage() {
  const [permsResult, listResult, appsResult] = await Promise.allSettled([
    getMyPermissions(),
    getPermissions({ page: 1, pageSize: 25 }),
    getApps({ page: 1, pageSize: 200 }),
  ])
  const perms = permsResult.status === 'fulfilled' ? permsResult.value : []
  const canManage = perms.includes('platform.permissions.manage')

  if (!canManage) return <AccessDeniedPanel />
  if (listResult.status === 'rejected') throw listResult.reason
  if (appsResult.status === 'rejected') throw appsResult.reason

  return <PermissionsTable initial={listResult.value} apps={appsResult.value.items} />
}
```

- [ ] **Step 2: Build the admin app**

Run: `pnpm --filter @sassy-auth/admin build 2>&1 | tail -15`
Expected: build succeeds, `/permissions` shows up in the routes table next to `/orgs` and `/users`.

If the build fails with a type error, fix it in the indicated file and re-run.

- [ ] **Step 3: Commit**

```bash
git add 'apps/admin/app/(admin)/permissions/page.tsx'
git commit -m "$(cat <<'EOF'
feat(admin): /permissions route

Server component. Parallel Promise.allSettled for permissions check +
permissions list + apps list. Renders AccessDeniedPanel without
platform.permissions.manage, otherwise PermissionsTable.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Component tests (4 files)

**Files:**
- Create: `apps/admin/components/__tests__/permissions-table.test.tsx`
- Create: `apps/admin/components/__tests__/permission-create-drawer.test.tsx`
- Create: `apps/admin/components/__tests__/permission-edit-drawer.test.tsx`
- Create: `apps/admin/components/__tests__/permission-view-drawer.test.tsx`

- [ ] **Step 1: Write `permissions-table.test.tsx`**

```tsx
import * as React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import en from '@/messages/en.json'
import { PermissionsTable } from '../permissions-table'
import * as actions from '@/app/(admin)/permissions/actions'
import type { App, PermissionRow } from '@/lib/types'

jest.mock('@/app/(admin)/permissions/actions', () => ({
  deletePermissionAction: jest.fn(),
  listPermissionsAction: jest.fn(),
  getPermissionAction: jest.fn(),
}))

jest.mock('@sassy-auth/ui', () => {
  const actual = jest.requireActual('@sassy-auth/ui')
  const Passthrough = ({ children }: { children?: React.ReactNode }) => <>{children}</>
  const Trigger = ({ children, asChild: _asChild, ...rest }: { children?: React.ReactNode; asChild?: boolean }) =>
    React.isValidElement(children) ? React.cloneElement(children, rest as object) : <>{children}</>
  const Item = ({ children, onClick, className }: { children?: React.ReactNode; onClick?: (e: React.MouseEvent) => void; className?: string }) => (
    <div role="menuitem" tabIndex={-1} className={className} onClick={onClick}>{children}</div>
  )
  return {
    ...actual,
    DropdownMenu: Passthrough,
    DropdownMenuTrigger: Trigger,
    DropdownMenuContent: Passthrough,
    DropdownMenuItem: Item,
    DropdownMenuSeparator: () => <hr />,
    SidebarTrigger: () => <button type="button" aria-label="Toggle Sidebar" />,
  }
})

const apps: App[] = [
  { publicId: 'sq_a1', name: 'Customer Portal', url: 'https://portal.example.com', isPlatform: false },
  { publicId: 'sq_a2', name: 'SassyAuth', url: 'https://auth.example.com', isPlatform: true },
]

const initial = {
  items: [
    { publicId: 'sq_p1', name: 'apps.read', app: { publicId: 'sq_a1', name: 'Customer Portal' }, roleCount: 2, userCount: 0 },
    { publicId: 'sq_p2', name: 'platform.users.manage', app: { publicId: 'sq_a2', name: 'SassyAuth' }, roleCount: 1, userCount: 0 },
  ] satisfies PermissionRow[],
  total: 2, page: 1, pageSize: 25,
}

function withIntl(node: React.ReactNode) {
  return <NextIntlClientProvider locale="en" messages={en}>{node}</NextIntlClientProvider>
}

describe('PermissionsTable', () => {
  beforeEach(() => jest.clearAllMocks())

  it('renders rows with names and the Platform badge for platform.*', () => {
    render(withIntl(<PermissionsTable initial={initial} apps={apps} />))
    expect(screen.getByText('apps.read')).toBeInTheDocument()
    expect(screen.getByText('platform.users.manage')).toBeInTheDocument()
    expect(screen.getByText(en.permissions.badges.platform)).toBeInTheDocument()
  })

  it('Edit and Delete menu items are hidden for platform.* rows', () => {
    render(withIntl(<PermissionsTable initial={initial} apps={apps} />))
    // With Dropdown mocked as passthrough, every row's items are in the DOM.
    // The platform.* row contributes 1 menuitem ("View"). The non-platform
    // row contributes 3 ("View", "Edit", "Delete"). Total = 4.
    expect(screen.getAllByRole('menuitem')).toHaveLength(4)
    expect(screen.getAllByRole('menuitem', { name: en.permissions.actions.view })).toHaveLength(2)
    expect(screen.getAllByRole('menuitem', { name: en.permissions.actions.edit })).toHaveLength(1)
    expect(screen.getAllByRole('menuitem', { name: en.permissions.actions.delete })).toHaveLength(1)
  })

  it('clicking Delete opens AlertDialog with the permission name', async () => {
    render(withIntl(<PermissionsTable initial={initial} apps={apps} />))
    const deleteItems = screen.getAllByRole('menuitem', { name: en.permissions.actions.delete })
    fireEvent.click(deleteItems[0])
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent(/apps\.read/)
  })

  it('app filter triggers listPermissionsAction with appId', async () => {
    jest.useFakeTimers()
    ;(actions.listPermissionsAction as jest.Mock).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 })
    render(withIntl(<PermissionsTable initial={initial} apps={apps} />))
    fireEvent.change(screen.getByLabelText(en.permissions.filter.appLabel), { target: { value: 'sq_a1' } })
    jest.advanceTimersByTime(400)
    await waitFor(() => expect(actions.listPermissionsAction).toHaveBeenCalledWith({ appId: 'sq_a1', page: 1, pageSize: 25 }))
    jest.useRealTimers()
  })
})
```

- [ ] **Step 2: Write `permission-create-drawer.test.tsx`**

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PermissionCreateDrawer } from '../permission-create-drawer'
import type { App } from '@/lib/types'

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

jest.mock('@/app/(admin)/permissions/actions', () => ({
  createPermissionAction: jest.fn().mockResolvedValue({ permission: { publicId: 'sq_p1', name: 'apps.read', app: { publicId: 'sq_a1', name: 'Portal' }, roleCount: 0, userCount: 0 } }),
}))

const apps: App[] = [
  { publicId: 'sq_a1', name: 'Customer Portal', url: 'https://portal.example.com', isPlatform: false },
]

describe('PermissionCreateDrawer', () => {
  it('renders form fields when open', () => {
    render(<PermissionCreateDrawer apps={apps} open={true} onOpenChange={() => {}} />)
    expect(screen.getByLabelText('permissions.fields.app')).toBeInTheDocument()
    expect(screen.getByLabelText('permissions.fields.name')).toBeInTheDocument()
  })

  it('surfaces nameInvalid for a non-dotted name', async () => {
    const { createPermissionAction } = jest.requireMock('@/app/(admin)/permissions/actions')
    render(<PermissionCreateDrawer apps={apps} open={true} onOpenChange={() => {}} />)
    fireEvent.change(screen.getByLabelText('permissions.fields.app'), { target: { value: 'sq_a1' } })
    fireEvent.change(screen.getByLabelText('permissions.fields.name'), { target: { value: 'bogus' } })
    fireEvent.click(screen.getByRole('button', { name: 'permissions.drawer.createTitle' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('permissions.errors.nameInvalid'))
    expect(createPermissionAction).not.toHaveBeenCalled()
  })

  it('submits with valid input and closes drawer on success', async () => {
    const onOpenChange = jest.fn()
    render(<PermissionCreateDrawer apps={apps} open={true} onOpenChange={onOpenChange} />)
    fireEvent.change(screen.getByLabelText('permissions.fields.app'), { target: { value: 'sq_a1' } })
    fireEvent.change(screen.getByLabelText('permissions.fields.name'), { target: { value: 'apps.read' } })
    fireEvent.click(screen.getByRole('button', { name: 'permissions.drawer.createTitle' }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })
})
```

- [ ] **Step 3: Write `permission-edit-drawer.test.tsx`**

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PermissionEditDrawer } from '../permission-edit-drawer'
import type { PermissionRow } from '@/lib/types'

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

jest.mock('@/app/(admin)/permissions/actions', () => ({
  updatePermissionAction: jest.fn().mockResolvedValue({ permission: { publicId: 'sq_p1', name: 'apps.list', app: { publicId: 'sq_a1', name: 'Portal' }, roleCount: 0, userCount: 0 } }),
}))

const permission: PermissionRow = {
  publicId: 'sq_p1', name: 'apps.read',
  app: { publicId: 'sq_a1', name: 'Portal' },
  roleCount: 0, userCount: 0,
}

describe('PermissionEditDrawer', () => {
  it('renders name and read-only app', () => {
    render(<PermissionEditDrawer permission={permission} open={true} onOpenChange={() => {}} />)
    expect(screen.getByDisplayValue('apps.read')).toBeInTheDocument()
    expect(screen.getByText('Portal')).toBeInTheDocument()
    expect(screen.getByText('permissions.fields.appImmutable')).toBeInTheDocument()
  })

  it('Save is disabled until the name is edited', () => {
    render(<PermissionEditDrawer permission={permission} open={true} onOpenChange={() => {}} />)
    const save = screen.getByRole('button', { name: 'permissions.drawer.save' })
    expect(save).toBeDisabled()
    fireEvent.change(screen.getByDisplayValue('apps.read'), { target: { value: 'apps.list' } })
    expect(save).not.toBeDisabled()
  })

  it('submits with valid name and closes on success', async () => {
    const onOpenChange = jest.fn()
    render(<PermissionEditDrawer permission={permission} open={true} onOpenChange={onOpenChange} />)
    fireEvent.change(screen.getByDisplayValue('apps.read'), { target: { value: 'apps.list' } })
    fireEvent.click(screen.getByRole('button', { name: 'permissions.drawer.save' }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })
})
```

- [ ] **Step 4: Write `permission-view-drawer.test.tsx`**

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import { PermissionViewDrawer } from '../permission-view-drawer'
import type { PermissionRow } from '@/lib/types'

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) => {
    if (params) return `${key}(${JSON.stringify(params)})`
    return key
  },
}))

jest.mock('@/app/(admin)/permissions/actions', () => ({
  getPermissionAction: jest.fn().mockResolvedValue({
    publicId: 'sq_p1', name: 'apps.read',
    app: { publicId: 'sq_a1', name: 'Portal' },
    roleCount: 2, userCount: 1,
    roles: [
      { publicId: 'sq_r1', name: 'Editor', appName: 'Portal' },
      { publicId: 'sq_r2', name: 'Viewer', appName: 'Portal' },
    ],
    users: [
      { publicId: 'sq_u1', email: 'alice@example.com', firstName: 'Alice', lastName: 'Smith' },
    ],
  }),
}))

const permission: PermissionRow = {
  publicId: 'sq_p1', name: 'apps.read',
  app: { publicId: 'sq_a1', name: 'Portal' },
  roleCount: 2, userCount: 1,
}

describe('PermissionViewDrawer', () => {
  it('renders name + app and loads the role/user lists', async () => {
    render(<PermissionViewDrawer permission={permission} open={true} onOpenChange={() => {}} onEdit={() => {}} onDelete={() => {}} />)
    expect(screen.getByText('apps.read')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('Editor')).toBeInTheDocument())
    expect(screen.getByText('Viewer')).toBeInTheDocument()
    expect(screen.getByText('Alice Smith')).toBeInTheDocument()
    expect(screen.getByText('alice@example.com')).toBeInTheDocument()
  })

  it('shows the Platform badge for platform.* permissions', () => {
    const platformPerm: PermissionRow = { ...permission, name: 'platform.users.manage' }
    render(<PermissionViewDrawer permission={platformPerm} open={true} onOpenChange={() => {}} onEdit={() => {}} onDelete={() => {}} />)
    expect(screen.getByText('permissions.badges.platform')).toBeInTheDocument()
    // Edit/Delete buttons are absent for platform.*
    expect(screen.queryByRole('button', { name: 'permissions.actions.edit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'permissions.actions.delete' })).not.toBeInTheDocument()
  })

  it('disables Delete and surfaces tooltip when in-use', async () => {
    render(<PermissionViewDrawer permission={permission} open={true} onOpenChange={() => {}} onEdit={() => {}} onDelete={() => {}} />)
    await waitFor(() => expect(screen.getByText('Editor')).toBeInTheDocument())
    const del = screen.getByRole('button', { name: 'permissions.actions.delete' })
    expect(del).toBeDisabled()
    expect(del).toHaveAttribute('title', expect.stringContaining('inUseTooltip'))
  })
})
```

- [ ] **Step 5: Run admin tests**

Run: `pnpm --filter @sassy-auth/admin test 2>&1 | tail -10`
Expected: `Tests: 56 passed, 56 total` (baseline 43 + 4 new test files contributing ~13 cases). If the actual count differs by 1-2, that's a count discrepancy from edge cases — read which tests changed and reconcile.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/components/__tests__/permissions-table.test.tsx apps/admin/components/__tests__/permission-create-drawer.test.tsx apps/admin/components/__tests__/permission-edit-drawer.test.tsx apps/admin/components/__tests__/permission-view-drawer.test.tsx
git commit -m "$(cat <<'EOF'
test(admin): permissions UI suites

permissions-table: rows render, Platform badge, Edit/Delete hidden
for platform.*, Delete opens AlertDialog with the permission name,
app-filter triggers listPermissionsAction.

permission-create-drawer: client-side nameInvalid surfaces before any
action call; happy submit closes.

permission-edit-drawer: name editable, app shown read-only, Save
disabled-until-dirty.

permission-view-drawer: name + role/user lists load; Platform badge
appears + Edit/Delete absent for platform.*; Delete disabled with
inUseTooltip when roleCount+userCount > 0.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Full verification

**Files:** none.

- [ ] **Step 1: Full test suite**

Run: `pnpm test -r 2>&1 | grep -E "(Tests:|Test Suites:)" | tail -10`
Expected:
- `@sassy-auth/ui`: 15/15 pass.
- `@sassy-auth/admin`: 56/56 pass (43 baseline + 13 new).
- `@sassy-auth/auth-server`: 147/147 pass (136 baseline + 11 new).

- [ ] **Step 2: Build**

Run: `pnpm --filter @sassy-auth/admin build 2>&1 | tail -15`
Expected: build succeeds. Route table contains `ƒ /permissions` next to `/orgs` and `/users`.

- [ ] **Step 3: Visual smoke (manual)**

Boot admin + auth-server (see existing project docs for the dev command), log in as `s@sa.io`, navigate to `/permissions`:
- List shows the 6 seeded `platform.*` permissions, each with a `Platform` badge and only the `View` action.
- Create a fresh `apps.test` permission against a non-platform app (Customer Portal) → succeeds, appears at the top of the list, no Platform badge, Edit + Delete are visible.
- Click the row to open the View drawer → shows empty Roles + Users sections, counts 0/0.
- Open Edit drawer, change name to `apps.list` → succeeds.
- Try Delete on `apps.list` (in-use count is still 0) → AlertDialog appears, confirm → row disappears.
- Try Delete on a `platform.*` row → there's no Delete action in the dropdown. Manually `curl -X DELETE` it with auth → 403 with `permissions.errors.platformProtected` mapped.
- Toggle to dark mode via the sidebar footer → page reads correctly (semantic tokens).

- [ ] **Step 4: Push branch (only if user requests it — do not push by default)**

```bash
git push -u origin feat/permissions-admin-ui
gh pr create --title "feat: /permissions admin UI" --body "$(cat <<'EOF'
## Summary
- New NestJS module `permissions` at /api/permissions (5 routes, gated by platform.permissions.manage)
- New Next.js route `(admin)/permissions` with table + 3 drawers
- Platform-prefix lock: any permission with name `platform.*` is server-enforced read-only (UI mirrors with badge + hidden Edit/Delete)
- View drawer surfaces usage counts + top-50 roles + top-50 users
- i18n: full en + fr blocks under `permissions.*`

## Test plan
- [x] auth-server tests: 147/147
- [x] admin tests: 56/56
- [x] ui tests: 15/15
- [x] `pnpm --filter @sassy-auth/admin build` — clean
- [ ] Visual smoke: list, create, edit, delete, view drawer with usage; dark mode

Spec: docs/superpowers/specs/2026-05-31-permissions-admin-ui-design.md
Plan: docs/superpowers/plans/2026-05-31-permissions-admin-ui.md
EOF
)"
```

---

## Self-review notes

- **Spec coverage:** Every section in the spec is implemented by a task. DTOs (Task 2), service + spec (Task 3), controller + module + register (Task 4), admin types + api (Task 5), actions (Task 6), i18n (Task 7), three drawers (Tasks 8-10), table (Task 11), page (Task 12), tests (Task 13), verification (Task 14).
- **Type consistency:** `PermissionRow`/`PermissionDetail` defined in Task 5 are used unchanged in Tasks 6-13. `createPermissionAction` returns `{ permission: PermissionRow }` and the create-drawer test mocks that exact shape. The drawer prop type `permission: PermissionRow` is consistent across view/edit drawers.
- **Pre-existing tests stay green:** the design doc's "existing `Permission` interface stays untouched" is preserved in Task 5 step 1 (the explicit comment "DON'T modify the existing `Permission` interface").
- **Sidebar nav** already links to `/permissions` from the reskin — no change needed.
- **Platform protection** is enforced on both sides: server (`ForbiddenException`) AND client (badge + hidden actions). Defense in depth.
- **Risk: the i18n key `nav.accessControl`** — used in the page breadcrumb — was added in the reskin. If it ever gets removed, the breadcrumb shows the key literally. Acceptable since it's wired everywhere.
- **Test count claim** in Task 14: 13 new admin tests (4 in permissions-table + 3 in create-drawer + 3 in edit-drawer + 3 in view-drawer = 13). 43 + 13 = 56.
