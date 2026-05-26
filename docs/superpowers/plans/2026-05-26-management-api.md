# Management API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the user management REST API in `auth-server` — including DB schema changes, user CRUD, role assignment, invitation flow, and minimal orgs/roles read endpoints needed by the admin UI.

**Architecture:** All management routes live under `apps/auth-server` as standard NestJS modules. Each module uses `BetterAuthGuard` for session auth and checks permissions inline in the service using a shared `checkPermission` helper. `prisma` is imported directly from `@sassy-auth/db` (not injected), following the existing pattern. The invitation flow creates BetterAuth `User` rows directly via Prisma (no password), then creates `Account` rows at accept time.

**Tech Stack:** NestJS 10 · Prisma 5 · PostgreSQL · `bcryptjs` · `crypto` (built-in) · Jest · `class-validator` · `class-transformer`

---

## File Map

| File | Purpose |
|---|---|
| `packages/db/schema.prisma` | Add `UserStatus` enum, `status` on `SaUser`, `SaInvitation` model |
| `apps/auth-server/src/common/permissions/check-permission.ts` | Shared helper — resolves caller permissions, throws `ForbiddenException` |
| `apps/auth-server/src/common/common.module.ts` | No change needed (SqidService already exported) |
| `apps/auth-server/src/users/users.module.ts` | NestJS module wiring |
| `apps/auth-server/src/users/users.service.ts` | All user business logic |
| `apps/auth-server/src/users/users.controller.ts` | HTTP route handlers |
| `apps/auth-server/src/users/dto/create-user.dto.ts` | Validated DTO (no password) |
| `apps/auth-server/src/users/dto/update-user.dto.ts` | Partial update DTO + status |
| `apps/auth-server/src/users/dto/assign-role.dto.ts` | `{ roleId: string }` |
| `apps/auth-server/src/users/users.service.spec.ts` | Unit tests |
| `apps/auth-server/src/users/users.controller.spec.ts` | Controller unit tests |
| `apps/auth-server/src/invitations/invitations.module.ts` | NestJS module |
| `apps/auth-server/src/invitations/invitations.service.ts` | Token validation + accept |
| `apps/auth-server/src/invitations/invitations.controller.ts` | GET + POST /api/invitations/:token |
| `apps/auth-server/src/invitations/dto/accept-invitation.dto.ts` | `{ password: string }` |
| `apps/auth-server/src/invitations/invitations.service.spec.ts` | Unit tests |
| `apps/auth-server/src/orgs/orgs.module.ts` | NestJS module |
| `apps/auth-server/src/orgs/orgs.service.ts` | List + get orgs |
| `apps/auth-server/src/orgs/orgs.controller.ts` | GET /api/orgs, GET /api/orgs/:id |
| `apps/auth-server/src/orgs/orgs.service.spec.ts` | Unit tests |
| `apps/auth-server/src/roles/roles.module.ts` | NestJS module |
| `apps/auth-server/src/roles/roles.service.ts` | List + get roles |
| `apps/auth-server/src/roles/roles.controller.ts` | GET /api/roles, GET /api/roles/:id |
| `apps/auth-server/src/roles/roles.service.spec.ts` | Unit tests |
| `apps/auth-server/src/app.module.ts` | Register all new modules |
| `docs/api/openapi.yaml` | Add status field, invitation endpoints, orgs, roles |

---

## Task 1: DB Schema — UserStatus + status field

**Files:**
- Modify: `packages/db/schema.prisma`

- [ ] **Step 1: Add `UserStatus` enum and `status` field to `SaUser`**

Open `packages/db/schema.prisma` and add the enum and field:

```prisma
enum UserStatus {
  active
  pending
  inactive
}

model SaUser {
  id                Int                @id @default(autoincrement())
  publicId          String             @unique
  betterAuthUserId  String             @unique
  betterAuthUser    User               @relation(fields: [betterAuthUserId], references: [id])
  orgId             Int
  org               SaOrg              @relation(fields: [orgId], references: [id])
  firstName         String
  lastName          String
  phoneNumber       String?
  username          String?
  status            UserStatus         @default(pending)
  roles             SaUserRole[]
  directPermissions SaUserPermission[]
  invitations       SaInvitation[]

  @@index([orgId])
  @@index([username])
  @@index([phoneNumber])
}
```

- [ ] **Step 2: Run migration**

```bash
cd C:/Users/rlond/Documents/GitHub/sassy-auth
pnpm --filter @sassy-auth/db exec prisma migrate dev --name add_user_status
```

Expected: Migration created and applied, Prisma client regenerated.

- [ ] **Step 3: Verify Prisma client exports the enum**

```bash
cd C:/Users/rlond/Documents/GitHub/sassy-auth
node -e "const { UserStatus } = require('./packages/db/node_modules/@prisma/client'); console.log(UserStatus)"
```

Expected: `{ active: 'active', pending: 'pending', inactive: 'inactive' }`

- [ ] **Step 4: Commit**

```bash
git add packages/db/schema.prisma packages/db/migrations/
git commit -m "feat(db): add UserStatus enum and status field to SaUser"
```

---

## Task 2: DB Schema — SaInvitation model

**Files:**
- Modify: `packages/db/schema.prisma`

- [ ] **Step 1: Add `SaInvitation` model**

Add to `packages/db/schema.prisma` (after the `SaUser` model):

```prisma
model SaInvitation {
  id        Int       @id @default(autoincrement())
  publicId  String    @unique
  token     String    @unique
  userId    Int
  user      SaUser    @relation(fields: [userId], references: [id], onDelete: Cascade)
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime  @default(now())

  @@index([token])
  @@index([userId])
}
```

- [ ] **Step 2: Run migration**

```bash
cd C:/Users/rlond/Documents/GitHub/sassy-auth
pnpm --filter @sassy-auth/db exec prisma migrate dev --name add_sa_invitation
```

Expected: Migration created and applied.

- [ ] **Step 3: Commit**

```bash
git add packages/db/schema.prisma packages/db/migrations/
git commit -m "feat(db): add SaInvitation model"
```

---

## Task 3: Permission Helper + UsersModule Scaffold

**Files:**
- Create: `apps/auth-server/src/common/permissions/check-permission.ts`
- Create: `apps/auth-server/src/users/users.module.ts`
- Create: `apps/auth-server/src/users/dto/create-user.dto.ts`
- Create: `apps/auth-server/src/users/dto/update-user.dto.ts`
- Create: `apps/auth-server/src/users/dto/assign-role.dto.ts`

- [ ] **Step 1: Write the failing test for `checkPermission`**

Create `apps/auth-server/src/common/permissions/check-permission.spec.ts`:

```typescript
import { ForbiddenException } from '@nestjs/common';
import { checkPermission } from './check-permission';

jest.mock('@sassy-auth/db', () => ({
  prisma: {
    saUser: { findUnique: jest.fn() },
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockPrisma = require('@sassy-auth/db').prisma as {
  saUser: { findUnique: jest.Mock };
};

const saUserWithPlatformManage = {
  roles: [
    {
      role: {
        permissions: [{ permission: { name: 'platform.users.manage' } }],
      },
    },
  ],
  directPermissions: [],
};

describe('checkPermission', () => {
  beforeEach(() => jest.clearAllMocks());

  it('resolves when the user has the required permission via role', async () => {
    mockPrisma.saUser.findUnique.mockResolvedValue(saUserWithPlatformManage);
    await expect(checkPermission('ba-1', 'platform.users.manage')).resolves.toBeUndefined();
  });

  it('resolves when the user has the required permission as a direct grant', async () => {
    mockPrisma.saUser.findUnique.mockResolvedValue({
      roles: [],
      directPermissions: [{ permission: { name: 'org.users.manage' } }],
    });
    await expect(checkPermission('ba-1', 'org.users.manage')).resolves.toBeUndefined();
  });

  it('throws ForbiddenException when user lacks the permission', async () => {
    mockPrisma.saUser.findUnique.mockResolvedValue({ roles: [], directPermissions: [] });
    await expect(checkPermission('ba-1', 'platform.users.manage')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('throws ForbiddenException when saUser not found', async () => {
    mockPrisma.saUser.findUnique.mockResolvedValue(null);
    await expect(checkPermission('ba-1', 'platform.users.manage')).rejects.toBeInstanceOf(ForbiddenException);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
cd C:/Users/rlond/Documents/GitHub/sassy-auth/apps/auth-server
npx jest src/common/permissions/check-permission.spec.ts --no-coverage
```

Expected: FAIL — `Cannot find module './check-permission'`

- [ ] **Step 3: Implement `checkPermission`**

Create `apps/auth-server/src/common/permissions/check-permission.ts`:

```typescript
import { ForbiddenException } from '@nestjs/common';
import { prisma } from '@sassy-auth/db';

export async function checkPermission(
  betterAuthUserId: string,
  required: string,
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

  if (!perms.has(required)) throw new ForbiddenException();
}
```

- [ ] **Step 4: Run the test and verify it passes**

```bash
cd C:/Users/rlond/Documents/GitHub/sassy-auth/apps/auth-server
npx jest src/common/permissions/check-permission.spec.ts --no-coverage
```

Expected: PASS — 4 tests

- [ ] **Step 5: Create DTOs**

Create `apps/auth-server/src/users/dto/create-user.dto.ts`:

```typescript
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateUserDto {
  @IsString() @MinLength(1) firstName: string;
  @IsString() @MinLength(1) lastName: string;
  @IsEmail() email: string;
  @IsString() orgId: string;           // public ID (Sqid)
  @IsString() @IsOptional() username?: string;
  @IsString() @IsOptional() phoneNumber?: string;
}
```

Create `apps/auth-server/src/users/dto/update-user.dto.ts`:

```typescript
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { UserStatus } from '@prisma/client';

export class UpdateUserDto {
  @IsString() @IsOptional() firstName?: string;
  @IsString() @IsOptional() lastName?: string;
  @IsString() @IsOptional() phoneNumber?: string;
  @IsString() @IsOptional() username?: string;
  @IsEnum(['active', 'inactive']) @IsOptional() status?: Extract<UserStatus, 'active' | 'inactive'>;
}
```

Create `apps/auth-server/src/users/dto/assign-role.dto.ts`:

```typescript
import { IsString } from 'class-validator';

export class AssignRoleDto {
  @IsString() roleId: string;
}
```

- [ ] **Step 6: Create UsersModule scaffold**

Create `apps/auth-server/src/users/users.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [CommonModule],
  providers: [UsersService],
  controllers: [UsersController],
})
export class UsersModule {}
```

- [ ] **Step 7: Commit scaffold**

```bash
git add apps/auth-server/src/common/permissions/ apps/auth-server/src/users/
git commit -m "feat(users): scaffold module, DTOs, permission helper"
```

---

## Task 4: GET /api/users + GET /api/users/:id

**Files:**
- Create: `apps/auth-server/src/users/users.service.ts`
- Create: `apps/auth-server/src/users/users.controller.ts`
- Create: `apps/auth-server/src/users/users.service.spec.ts`

- [ ] **Step 1: Write failing tests for list and get**

Create `apps/auth-server/src/users/users.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { SqidService } from '../common/sqid/sqid.service';

jest.mock('@sassy-auth/db', () => ({
  prisma: {
    saUser: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    saOrg: { findUnique: jest.fn() },
    saRole: { findUnique: jest.fn() },
    saUserRole: { create: jest.fn(), delete: jest.fn() },
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
  saUser: {
    findMany: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  saOrg: { findUnique: jest.Mock };
  saRole: { findUnique: jest.Mock };
  saUserRole: { create: jest.Mock; delete: jest.Mock };
  saInvitation: { create: jest.Mock; findFirst: jest.Mock; updateMany: jest.Mock };
  user: { create: jest.Mock };
  account: { create: jest.Mock };
};

const makeSaUser = (overrides = {}) => ({
  id: 1,
  publicId: 'usr1',
  betterAuthUserId: 'ba-1',
  orgId: 1,
  firstName: 'Alice',
  lastName: 'Smith',
  email: undefined,
  phoneNumber: null,
  username: null,
  status: 'active',
  org: { publicId: 'org1' },
  betterAuthUser: { email: 'alice@example.com' },
  ...overrides,
});

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [UsersService, SqidService],
    }).compile();
    service = module.get(UsersService);
    jest.clearAllMocks();
  });

  describe('listUsers', () => {
    it('returns all users when no filter is provided', async () => {
      mockPrisma.saUser.findMany.mockResolvedValue([makeSaUser()]);
      const result = await service.listUsers('ba-caller', {});
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('usr1');
      expect(result[0].email).toBe('alice@example.com');
      expect(result[0].status).toBe('active');
    });

    it('passes orgId filter to prisma when provided', async () => {
      mockPrisma.saUser.findMany.mockResolvedValue([]);
      await service.listUsers('ba-caller', { orgPublicId: 'org1' });
      expect(mockPrisma.saUser.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ org: expect.objectContaining({ publicId: 'org1' }) }) }),
      );
    });
  });

  describe('getUser', () => {
    it('returns the user when found', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue(makeSaUser());
      const result = await service.getUser('ba-caller', 'usr1');
      expect(result.id).toBe('usr1');
    });

    it('throws NotFoundException when user not found', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue(null);
      await expect(service.getUser('ba-caller', 'usr1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
```

- [ ] **Step 2: Run and verify it fails**

```bash
cd C:/Users/rlond/Documents/GitHub/sassy-auth/apps/auth-server
npx jest src/users/users.service.spec.ts --no-coverage
```

Expected: FAIL — `Cannot find module './users.service'`

- [ ] **Step 3: Implement `UsersService` (list + get only)**

Create `apps/auth-server/src/users/users.service.ts`:

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '@sassy-auth/db';
import { SqidService } from '../common/sqid/sqid.service';
import { checkPermission } from '../common/permissions/check-permission';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { AssignRoleDto } from './dto/assign-role.dto';
import * as crypto from 'crypto';
import * as bcrypt from 'bcryptjs';

const USER_INCLUDE = {
  betterAuthUser: { select: { email: true } },
  org: { select: { publicId: true } },
} as const;

function formatUser(u: {
  publicId: string;
  firstName: string;
  lastName: string;
  phoneNumber: string | null;
  username: string | null;
  status: string;
  org: { publicId: string };
  betterAuthUser: { email: string };
}) {
  return {
    id: u.publicId,
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.betterAuthUser.email,
    phoneNumber: u.phoneNumber,
    username: u.username,
    orgId: u.org.publicId,
    status: u.status,
  };
}

@Injectable()
export class UsersService {
  constructor(private readonly sqids: SqidService) {}

  async listUsers(
    callerBaId: string,
    filters: { orgPublicId?: string; appPublicId?: string },
  ) {
    await checkPermission(callerBaId, 'platform.users.manage').catch(async () => {
      await checkPermission(callerBaId, 'org.users.manage');
    });

    const where: Record<string, unknown> = {};
    if (filters.orgPublicId) where['org'] = { publicId: filters.orgPublicId };

    const users = await prisma.saUser.findMany({ where, include: USER_INCLUDE });
    return users.map(formatUser);
  }

  async getUser(callerBaId: string, publicId: string) {
    await checkPermission(callerBaId, 'platform.users.manage').catch(async () => {
      await checkPermission(callerBaId, 'org.users.manage');
    });

    const user = await prisma.saUser.findUnique({
      where: { publicId },
      include: USER_INCLUDE,
    });
    if (!user) throw new NotFoundException();
    return formatUser(user);
  }

  // Placeholder stubs — implemented in subsequent tasks
  async createUser(_callerBaId: string, _dto: CreateUserDto): Promise<never> { throw new Error('not implemented'); }
  async updateUser(_callerBaId: string, _publicId: string, _dto: UpdateUserDto): Promise<never> { throw new Error('not implemented'); }
  async deleteUser(_callerBaId: string, _publicId: string): Promise<void> { throw new Error('not implemented'); }
  async getUserRoles(_callerBaId: string, _publicId: string): Promise<never> { throw new Error('not implemented'); }
  async getEffectivePermissions(_callerBaId: string, _publicId: string): Promise<never> { throw new Error('not implemented'); }
  async assignRole(_callerBaId: string, _publicId: string, _dto: AssignRoleDto): Promise<void> { throw new Error('not implemented'); }
  async removeRole(_callerBaId: string, _publicId: string, _rolePublicId: string): Promise<void> { throw new Error('not implemented'); }
}
```

Create `apps/auth-server/src/users/users.controller.ts`:

```typescript
import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query, HttpCode, UseGuards, Req,
} from '@nestjs/common';
import { Request } from 'express';
import { BetterAuthGuard } from '../auth/better-auth.guard';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { AssignRoleDto } from './dto/assign-role.dto';

function callerBaId(req: Request): string {
  return (req as unknown as Record<string, { id: string }>)['betterAuthUser'].id;
}

@UseGuards(BetterAuthGuard)
@Controller('api/users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(@Req() req: Request, @Query('orgId') orgId?: string, @Query('appId') appId?: string) {
    return this.users.listUsers(callerBaId(req), { orgPublicId: orgId, appPublicId: appId });
  }

  @Get(':id')
  get(@Req() req: Request, @Param('id') id: string) {
    return this.users.getUser(callerBaId(req), id);
  }

  @Post()
  create(@Req() req: Request, @Body() dto: CreateUserDto) {
    return this.users.createUser(callerBaId(req), dto);
  }

  @Patch(':id')
  update(@Req() req: Request, @Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.users.updateUser(callerBaId(req), id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Req() req: Request, @Param('id') id: string) {
    return this.users.deleteUser(callerBaId(req), id);
  }

  @Get(':id/roles')
  getRoles(@Req() req: Request, @Param('id') id: string) {
    return this.users.getUserRoles(callerBaId(req), id);
  }

  @Get(':id/effective-permissions')
  effectivePermissions(@Req() req: Request, @Param('id') id: string) {
    return this.users.getEffectivePermissions(callerBaId(req), id);
  }

  @Post(':id/roles')
  @HttpCode(204)
  assignRole(@Req() req: Request, @Param('id') id: string, @Body() dto: AssignRoleDto) {
    return this.users.assignRole(callerBaId(req), id, dto);
  }

  @Delete(':id/roles/:roleId')
  @HttpCode(204)
  removeRole(@Req() req: Request, @Param('id') id: string, @Param('roleId') roleId: string) {
    return this.users.removeRole(callerBaId(req), id, roleId);
  }
}
```

- [ ] **Step 4: Run tests and verify they pass**

```bash
cd C:/Users/rlond/Documents/GitHub/sassy-auth/apps/auth-server
npx jest src/users/users.service.spec.ts --no-coverage
```

Expected: PASS — `listUsers` and `getUser` tests pass; stubs throw but aren't tested yet.

- [ ] **Step 5: Register UsersModule in app.module.ts**

Edit `apps/auth-server/src/app.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { TokenModule } from './token/token.module';
import { CommonModule } from './common/common.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [CommonModule, AuthModule, TokenModule, UsersModule],
})
export class AppModule {}
```

- [ ] **Step 6: Commit**

```bash
git add apps/auth-server/src/
git commit -m "feat(users): GET /api/users and GET /api/users/:id"
```

---

## Task 5: GET /api/users/:id/roles + effective-permissions

**Files:**
- Modify: `apps/auth-server/src/users/users.service.ts`
- Modify: `apps/auth-server/src/users/users.service.spec.ts`

- [ ] **Step 1: Add failing tests**

Append to the `describe('UsersService')` block in `users.service.spec.ts`:

```typescript
  describe('getUserRoles', () => {
    it('returns roles assigned to the user', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue({
        ...makeSaUser(),
        roles: [
          { role: { publicId: 'role1', name: 'Platform Admin', app: { publicId: 'app1' }, permissions: [] } },
        ],
      });
      const result = await service.getUserRoles('ba-caller', 'usr1');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('role1');
      expect(result[0].name).toBe('Platform Admin');
    });

    it('throws NotFoundException when user not found', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue(null);
      await expect(service.getUserRoles('ba-caller', 'usr1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getEffectivePermissions', () => {
    it('returns deduplicated union of role and direct permissions', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue({
        ...makeSaUser(),
        roles: [
          { role: { permissions: [{ permission: { name: 'users:read' } }, { permission: { name: 'users:write' } }] } },
        ],
        directPermissions: [
          { permission: { name: 'users:read' } },  // duplicate
          { permission: { name: 'billing:manage' } },
        ],
      });
      const result = await service.getEffectivePermissions('ba-caller', 'usr1');
      expect(result.permissions).toEqual(['billing:manage', 'users:read', 'users:write']);
    });

    it('throws NotFoundException when user not found', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue(null);
      await expect(service.getEffectivePermissions('ba-caller', 'usr1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
```

- [ ] **Step 2: Run and verify they fail**

```bash
cd C:/Users/rlond/Documents/GitHub/sassy-auth/apps/auth-server
npx jest src/users/users.service.spec.ts --no-coverage --testNamePattern="getUserRoles|getEffectivePermissions"
```

Expected: FAIL — `not implemented`

- [ ] **Step 3: Implement `getUserRoles` and `getEffectivePermissions`**

Replace the stub methods in `users.service.ts`:

```typescript
  async getUserRoles(callerBaId: string, publicId: string) {
    await checkPermission(callerBaId, 'platform.users.manage').catch(async () => {
      await checkPermission(callerBaId, 'org.users.manage');
    });

    const user = await prisma.saUser.findUnique({
      where: { publicId },
      include: {
        roles: {
          include: {
            role: { include: { app: { select: { publicId: true } }, permissions: { include: { permission: true } } } },
          },
        },
      },
    });
    if (!user) throw new NotFoundException();

    return user.roles.map((ur) => ({
      id: ur.role.publicId,
      name: ur.role.name,
      appId: ur.role.app.publicId,
      permissions: ur.role.permissions.map((rp) => ({
        id: rp.permission.publicId,
        name: rp.permission.name,
        appId: ur.role.app.publicId,
      })),
    }));
  }

  async getEffectivePermissions(callerBaId: string, publicId: string) {
    await checkPermission(callerBaId, 'platform.users.manage').catch(async () => {
      await checkPermission(callerBaId, 'org.users.manage');
    });

    const user = await prisma.saUser.findUnique({
      where: { publicId },
      include: {
        roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
        directPermissions: { include: { permission: true } },
      },
    });
    if (!user) throw new NotFoundException();

    const names = new Set<string>();
    user.roles.forEach((ur) => ur.role.permissions.forEach((rp) => names.add(rp.permission.name)));
    user.directPermissions.forEach((up) => names.add(up.permission.name));

    return { userId: publicId, permissions: Array.from(names).sort() };
  }
```

- [ ] **Step 4: Run and verify tests pass**

```bash
cd C:/Users/rlond/Documents/GitHub/sassy-auth/apps/auth-server
npx jest src/users/users.service.spec.ts --no-coverage
```

Expected: PASS — all tests so far.

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/users/
git commit -m "feat(users): GET /api/users/:id/roles and effective-permissions"
```

---

## Task 6: POST /api/users — Create + Generate Invitation

**Files:**
- Modify: `apps/auth-server/src/users/users.service.ts`
- Modify: `apps/auth-server/src/users/users.service.spec.ts`

- [ ] **Step 1: Add failing test**

Append to `users.service.spec.ts`:

```typescript
  describe('createUser', () => {
    const dto = {
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      orgId: 'org1',
      username: undefined,
      phoneNumber: undefined,
    };

    beforeEach(() => {
      mockPrisma.saOrg.findUnique.mockResolvedValue({ id: 2, publicId: 'org1' });
      mockPrisma.user.create.mockResolvedValue({ id: 'ba-jane' });
      mockPrisma.saUser.create.mockResolvedValue({
        ...makeSaUser({ publicId: 'usr2', firstName: 'Jane', lastName: 'Doe', status: 'pending' }),
        id: 2,
        betterAuthUser: { email: 'jane@example.com' },
      });
      mockPrisma.saInvitation.create.mockResolvedValue({
        token: 'abc123token',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });
    });

    it('creates a BetterAuth user, SaUser, and invitation token', async () => {
      const result = await service.createUser('ba-caller', dto);
      expect(mockPrisma.user.create).toHaveBeenCalledTimes(1);
      expect(mockPrisma.saUser.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ firstName: 'Jane', status: 'pending' }) }),
      );
      expect(mockPrisma.saInvitation.create).toHaveBeenCalledTimes(1);
      expect(result.user.id).toBe('usr2');
      expect(result.inviteUrl).toContain('abc123token');
    });

    it('throws NotFoundException when org not found', async () => {
      mockPrisma.saOrg.findUnique.mockResolvedValue(null);
      await expect(service.createUser('ba-caller', dto)).rejects.toBeInstanceOf(NotFoundException);
    });
  });
```

- [ ] **Step 2: Run and verify it fails**

```bash
cd C:/Users/rlond/Documents/GitHub/sassy-auth/apps/auth-server
npx jest src/users/users.service.spec.ts --no-coverage --testNamePattern="createUser"
```

Expected: FAIL — `not implemented`

- [ ] **Step 3: Implement `createUser`**

Replace the stub in `users.service.ts`. Also add the `crypto` and `bcrypt` imports at the top (they're already in the file stub above). Add the `INVITE_EXPIRY_MS` constant and implement:

```typescript
  async createUser(callerBaId: string, dto: CreateUserDto) {
    await checkPermission(callerBaId, 'platform.users.manage').catch(async () => {
      await checkPermission(callerBaId, 'org.users.manage');
    });

    const org = await prisma.saOrg.findUnique({ where: { publicId: dto.orgId } });
    if (!org) throw new NotFoundException('Org not found');

    const baUserId = crypto.randomUUID();
    const now = new Date();

    await prisma.user.create({
      data: {
        id: baUserId,
        name: `${dto.firstName} ${dto.lastName}`,
        email: dto.email,
        emailVerified: false,
        createdAt: now,
        updatedAt: now,
      },
    });

    const saUserPublicId = this.sqids.encode(Date.now() % 1_000_000);
    const saUser = await prisma.saUser.create({
      data: {
        publicId: saUserPublicId,
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

    const token = crypto.randomBytes(32).toString('hex');
    const invitePublicId = this.sqids.encode((Date.now() + 1) % 1_000_000);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await prisma.saInvitation.create({
      data: {
        publicId: invitePublicId,
        token,
        userId: saUser.id,
        expiresAt,
      },
    });

    const baseUrl = process.env.ADMIN_URL ?? 'http://localhost:3001';
    return {
      user: formatUser(saUser),
      inviteUrl: `${baseUrl}/accept-invite?token=${token}`,
    };
  }
```

- [ ] **Step 4: Run and verify tests pass**

```bash
cd C:/Users/rlond/Documents/GitHub/sassy-auth/apps/auth-server
npx jest src/users/users.service.spec.ts --no-coverage
```

Expected: PASS — all tests.

- [ ] **Step 5: Add `ADMIN_URL` to `.env.example`**

Append to `.env.example` (or create if not present at root):

```
# URL of the admin console — used to build invitation links
ADMIN_URL=http://localhost:3001
```

- [ ] **Step 6: Commit**

```bash
git add apps/auth-server/src/users/ .env.example
git commit -m "feat(users): POST /api/users — create user and generate invitation token"
```

---

## Task 7: PATCH /api/users/:id + DELETE /api/users/:id

**Files:**
- Modify: `apps/auth-server/src/users/users.service.ts`
- Modify: `apps/auth-server/src/users/users.service.spec.ts`

- [ ] **Step 1: Add failing tests**

Append to `users.service.spec.ts`:

```typescript
  describe('updateUser', () => {
    it('updates allowed fields and returns the updated user', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue(makeSaUser());
      mockPrisma.saUser.update.mockResolvedValue(
        makeSaUser({ firstName: 'Alicia', status: 'inactive' }),
      );
      const result = await service.updateUser('ba-caller', 'usr1', { firstName: 'Alicia', status: 'inactive' });
      expect(result.firstName).toBe('Alicia');
      expect(result.status).toBe('inactive');
    });

    it('throws NotFoundException when user not found', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue(null);
      await expect(service.updateUser('ba-caller', 'usr1', {})).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('deleteUser', () => {
    it('deletes the user', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue(makeSaUser());
      mockPrisma.saUser.delete.mockResolvedValue(undefined);
      await expect(service.deleteUser('ba-caller', 'usr1')).resolves.toBeUndefined();
      expect(mockPrisma.saUser.delete).toHaveBeenCalledWith({ where: { publicId: 'usr1' } });
    });

    it('throws NotFoundException when user not found', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue(null);
      await expect(service.deleteUser('ba-caller', 'usr1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
```

- [ ] **Step 2: Run and verify they fail**

```bash
cd C:/Users/rlond/Documents/GitHub/sassy-auth/apps/auth-server
npx jest src/users/users.service.spec.ts --no-coverage --testNamePattern="updateUser|deleteUser"
```

Expected: FAIL — `not implemented`

- [ ] **Step 3: Implement `updateUser` and `deleteUser`**

Replace stubs in `users.service.ts`:

```typescript
  async updateUser(callerBaId: string, publicId: string, dto: UpdateUserDto) {
    await checkPermission(callerBaId, 'platform.users.manage').catch(async () => {
      await checkPermission(callerBaId, 'org.users.manage');
    });

    const existing = await prisma.saUser.findUnique({ where: { publicId } });
    if (!existing) throw new NotFoundException();

    const updated = await prisma.saUser.update({
      where: { publicId },
      data: {
        ...(dto.firstName !== undefined && { firstName: dto.firstName }),
        ...(dto.lastName !== undefined && { lastName: dto.lastName }),
        ...(dto.phoneNumber !== undefined && { phoneNumber: dto.phoneNumber }),
        ...(dto.username !== undefined && { username: dto.username }),
        ...(dto.status !== undefined && { status: dto.status }),
      },
      include: USER_INCLUDE,
    });
    return formatUser(updated);
  }

  async deleteUser(callerBaId: string, publicId: string): Promise<void> {
    await checkPermission(callerBaId, 'platform.users.manage');

    const existing = await prisma.saUser.findUnique({ where: { publicId } });
    if (!existing) throw new NotFoundException();

    await prisma.saUser.delete({ where: { publicId } });
  }
```

- [ ] **Step 4: Run and verify tests pass**

```bash
cd C:/Users/rlond/Documents/GitHub/sassy-auth/apps/auth-server
npx jest src/users/users.service.spec.ts --no-coverage
```

Expected: PASS — all tests.

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/users/
git commit -m "feat(users): PATCH and DELETE /api/users/:id"
```

---

## Task 8: POST/DELETE /api/users/:id/roles

**Files:**
- Modify: `apps/auth-server/src/users/users.service.ts`
- Modify: `apps/auth-server/src/users/users.service.spec.ts`

- [ ] **Step 1: Add failing tests**

Append to `users.service.spec.ts`:

```typescript
  describe('assignRole', () => {
    it('creates a SaUserRole link', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue(makeSaUser());
      mockPrisma.saRole.findUnique.mockResolvedValue({ id: 5, publicId: 'role1' });
      mockPrisma.saUserRole.create.mockResolvedValue(undefined);
      await expect(service.assignRole('ba-caller', 'usr1', { roleId: 'role1' })).resolves.toBeUndefined();
      expect(mockPrisma.saUserRole.create).toHaveBeenCalledWith({
        data: { userId: 1, roleId: 5 },
      });
    });

    it('throws NotFoundException when user not found', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue(null);
      await expect(service.assignRole('ba-caller', 'usr1', { roleId: 'role1' })).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFoundException when role not found', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue(makeSaUser());
      mockPrisma.saRole.findUnique.mockResolvedValue(null);
      await expect(service.assignRole('ba-caller', 'usr1', { roleId: 'bad' })).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('removeRole', () => {
    it('deletes the SaUserRole link', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue(makeSaUser());
      mockPrisma.saRole.findUnique.mockResolvedValue({ id: 5, publicId: 'role1' });
      mockPrisma.saUserRole.delete.mockResolvedValue(undefined);
      await expect(service.removeRole('ba-caller', 'usr1', 'role1')).resolves.toBeUndefined();
      expect(mockPrisma.saUserRole.delete).toHaveBeenCalledWith({
        where: { userId_roleId: { userId: 1, roleId: 5 } },
      });
    });
  });
```

- [ ] **Step 2: Run and verify they fail**

```bash
cd C:/Users/rlond/Documents/GitHub/sassy-auth/apps/auth-server
npx jest src/users/users.service.spec.ts --no-coverage --testNamePattern="assignRole|removeRole"
```

Expected: FAIL — `not implemented`

- [ ] **Step 3: Implement `assignRole` and `removeRole`**

Replace stubs in `users.service.ts`:

```typescript
  async assignRole(callerBaId: string, userPublicId: string, dto: AssignRoleDto): Promise<void> {
    await checkPermission(callerBaId, 'platform.users.manage').catch(async () => {
      await checkPermission(callerBaId, 'org.users.manage');
    });

    const user = await prisma.saUser.findUnique({ where: { publicId: userPublicId } });
    if (!user) throw new NotFoundException('User not found');

    const role = await prisma.saRole.findUnique({ where: { publicId: dto.roleId } });
    if (!role) throw new NotFoundException('Role not found');

    await prisma.saUserRole.create({ data: { userId: user.id, roleId: role.id } });
  }

  async removeRole(callerBaId: string, userPublicId: string, rolePublicId: string): Promise<void> {
    await checkPermission(callerBaId, 'platform.users.manage').catch(async () => {
      await checkPermission(callerBaId, 'org.users.manage');
    });

    const user = await prisma.saUser.findUnique({ where: { publicId: userPublicId } });
    if (!user) throw new NotFoundException('User not found');

    const role = await prisma.saRole.findUnique({ where: { publicId: rolePublicId } });
    if (!role) throw new NotFoundException('Role not found');

    await prisma.saUserRole.delete({ where: { userId_roleId: { userId: user.id, roleId: role.id } } });
  }
```

- [ ] **Step 4: Run all tests**

```bash
cd C:/Users/rlond/Documents/GitHub/sassy-auth/apps/auth-server
npx jest src/users/users.service.spec.ts --no-coverage
```

Expected: PASS — all tests.

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/users/
git commit -m "feat(users): POST/DELETE /api/users/:id/roles"
```

---

## Task 9: InvitationsModule — validate + accept

**Files:**
- Create: `apps/auth-server/src/invitations/invitations.module.ts`
- Create: `apps/auth-server/src/invitations/invitations.service.ts`
- Create: `apps/auth-server/src/invitations/invitations.controller.ts`
- Create: `apps/auth-server/src/invitations/dto/accept-invitation.dto.ts`
- Create: `apps/auth-server/src/invitations/invitations.service.spec.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/auth-server/src/invitations/invitations.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { InvitationsService } from './invitations.service';

jest.mock('@sassy-auth/db', () => ({
  prisma: {
    saInvitation: { findUnique: jest.fn(), update: jest.fn() },
    saUser: { update: jest.fn() },
    user: { update: jest.fn() },
    account: { create: jest.fn() },
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockPrisma = require('@sassy-auth/db').prisma as {
  saInvitation: { findUnique: jest.Mock; update: jest.Mock };
  saUser: { update: jest.Mock };
  user: { update: jest.Mock };
  account: { create: jest.Mock };
};

const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
const pastDate = new Date(Date.now() - 1000);

const validInvitation = {
  id: 1,
  token: 'abc123',
  usedAt: null,
  expiresAt: futureDate,
  user: {
    id: 1,
    publicId: 'usr1',
    firstName: 'Jane',
    status: 'pending',
    betterAuthUserId: 'ba-jane',
    betterAuthUser: { id: 'ba-jane', email: 'jane@example.com' },
  },
};

describe('InvitationsService', () => {
  let service: InvitationsService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [InvitationsService],
    }).compile();
    service = module.get(InvitationsService);
    jest.clearAllMocks();
  });

  describe('validateToken', () => {
    it('returns user info for a valid, unexpired token', async () => {
      mockPrisma.saInvitation.findUnique.mockResolvedValue(validInvitation);
      const result = await service.validateToken('abc123');
      expect(result.firstName).toBe('Jane');
      expect(result.email).toBe('jane@example.com');
      expect(result.expired).toBe(false);
    });

    it('returns expired:true for an expired token', async () => {
      mockPrisma.saInvitation.findUnique.mockResolvedValue({ ...validInvitation, expiresAt: pastDate });
      const result = await service.validateToken('abc123');
      expect(result.expired).toBe(true);
    });

    it('throws NotFoundException for unknown token', async () => {
      mockPrisma.saInvitation.findUnique.mockResolvedValue(null);
      await expect(service.validateToken('unknown')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('acceptInvitation', () => {
    it('creates Account, activates SaUser, marks invitation used', async () => {
      mockPrisma.saInvitation.findUnique.mockResolvedValue(validInvitation);
      mockPrisma.account.create.mockResolvedValue(undefined);
      mockPrisma.saUser.update.mockResolvedValue(undefined);
      mockPrisma.user.update.mockResolvedValue(undefined);
      mockPrisma.saInvitation.update.mockResolvedValue(undefined);

      await expect(service.acceptInvitation('abc123', 'NewP@ss1')).resolves.toBeUndefined();

      expect(mockPrisma.account.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ providerId: 'credential', userId: 'ba-jane' }),
        }),
      );
      expect(mockPrisma.saUser.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'active' } }),
      );
      expect(mockPrisma.saInvitation.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ usedAt: expect.any(Date) }) }),
      );
    });

    it('throws BadRequestException for expired token', async () => {
      mockPrisma.saInvitation.findUnique.mockResolvedValue({ ...validInvitation, expiresAt: pastDate });
      await expect(service.acceptInvitation('abc123', 'NewP@ss1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws BadRequestException for already-used token', async () => {
      mockPrisma.saInvitation.findUnique.mockResolvedValue({ ...validInvitation, usedAt: new Date() });
      await expect(service.acceptInvitation('abc123', 'NewP@ss1')).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
```

- [ ] **Step 2: Run and verify it fails**

```bash
cd C:/Users/rlond/Documents/GitHub/sassy-auth/apps/auth-server
npx jest src/invitations/invitations.service.spec.ts --no-coverage
```

Expected: FAIL — `Cannot find module './invitations.service'`

- [ ] **Step 3: Implement InvitationsService**

Create `apps/auth-server/src/invitations/dto/accept-invitation.dto.ts`:

```typescript
import { IsString, MinLength } from 'class-validator';

export class AcceptInvitationDto {
  @IsString() @MinLength(8) password: string;
}
```

Create `apps/auth-server/src/invitations/invitations.service.ts`:

```typescript
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { prisma } from '@sassy-auth/db';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

const INVITATION_INCLUDE = {
  user: {
    include: { betterAuthUser: { select: { id: true, email: true } } },
  },
} as const;

@Injectable()
export class InvitationsService {
  async validateToken(token: string) {
    const inv = await prisma.saInvitation.findUnique({
      where: { token },
      include: INVITATION_INCLUDE,
    });
    if (!inv) throw new NotFoundException('Invitation not found');

    const expired = inv.expiresAt < new Date();
    return {
      firstName: inv.user.firstName,
      email: inv.user.betterAuthUser.email,
      expired,
    };
  }

  async acceptInvitation(token: string, password: string): Promise<void> {
    const inv = await prisma.saInvitation.findUnique({
      where: { token },
      include: INVITATION_INCLUDE,
    });
    if (!inv) throw new NotFoundException('Invitation not found');
    if (inv.usedAt) throw new BadRequestException('Invitation already used');
    if (inv.expiresAt < new Date()) throw new BadRequestException('Invitation expired');

    const hashed = await bcrypt.hash(password, 10);
    const now = new Date();
    const baUserId = inv.user.betterAuthUser.id;

    await prisma.account.create({
      data: {
        id: crypto.randomUUID(),
        accountId: baUserId,
        providerId: 'credential',
        userId: baUserId,
        password: hashed,
        createdAt: now,
        updatedAt: now,
      },
    });

    await prisma.saUser.update({
      where: { id: inv.user.id },
      data: { status: 'active' },
    });

    await prisma.user.update({
      where: { id: baUserId },
      data: { emailVerified: true, updatedAt: now },
    });

    await prisma.saInvitation.update({
      where: { id: inv.id },
      data: { usedAt: now },
    });
  }
}
```

Create `apps/auth-server/src/invitations/invitations.controller.ts`:

```typescript
import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { InvitationsService } from './invitations.service';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';

@Controller('api/invitations')
export class InvitationsController {
  constructor(private readonly service: InvitationsService) {}

  @Get(':token')
  validate(@Param('token') token: string) {
    return this.service.validateToken(token);
  }

  @Post(':token/accept')
  @HttpCode(204)
  accept(@Param('token') token: string, @Body() dto: AcceptInvitationDto) {
    return this.service.acceptInvitation(token, dto.password);
  }
}
```

Create `apps/auth-server/src/invitations/invitations.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { InvitationsService } from './invitations.service';
import { InvitationsController } from './invitations.controller';

@Module({
  providers: [InvitationsService],
  controllers: [InvitationsController],
})
export class InvitationsModule {}
```

- [ ] **Step 4: Run and verify tests pass**

```bash
cd C:/Users/rlond/Documents/GitHub/sassy-auth/apps/auth-server
npx jest src/invitations/invitations.service.spec.ts --no-coverage
```

Expected: PASS — all 6 tests.

- [ ] **Step 5: Register InvitationsModule**

Edit `apps/auth-server/src/app.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { TokenModule } from './token/token.module';
import { CommonModule } from './common/common.module';
import { UsersModule } from './users/users.module';
import { InvitationsModule } from './invitations/invitations.module';

@Module({
  imports: [CommonModule, AuthModule, TokenModule, UsersModule, InvitationsModule],
})
export class AppModule {}
```

- [ ] **Step 6: Commit**

```bash
git add apps/auth-server/src/invitations/ apps/auth-server/src/app.module.ts
git commit -m "feat(invitations): GET/POST /api/invitations/:token"
```

---

## Task 10: POST /api/users/:id/resend-invitation

**Files:**
- Modify: `apps/auth-server/src/users/users.service.ts`
- Modify: `apps/auth-server/src/users/users.controller.ts`
- Modify: `apps/auth-server/src/users/users.service.spec.ts`

- [ ] **Step 1: Add failing test**

Append to `users.service.spec.ts`:

```typescript
  describe('resendInvitation', () => {
    it('invalidates old tokens and creates a new invitation', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue(makeSaUser({ status: 'pending' }));
      mockPrisma.saInvitation.updateMany = jest.fn().mockResolvedValue(undefined);
      mockPrisma.saInvitation.create.mockResolvedValue({ token: 'newtoken123', expiresAt: new Date() });

      const result = await service.resendInvitation('ba-caller', 'usr1');
      expect(mockPrisma.saInvitation.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ userId: 1, usedAt: null }) }),
      );
      expect(result.inviteUrl).toContain('newtoken123');
    });

    it('throws BadRequestException when user is already active', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue(makeSaUser({ status: 'active' }));
      await expect(service.resendInvitation('ba-caller', 'usr1')).rejects.toBeInstanceOf(
        require('@nestjs/common').BadRequestException,
      );
    });
  });
```

- [ ] **Step 2: Run and verify it fails**

```bash
cd C:/Users/rlond/Documents/GitHub/sassy-auth/apps/auth-server
npx jest src/users/users.service.spec.ts --no-coverage --testNamePattern="resendInvitation"
```

Expected: FAIL — `service.resendInvitation is not a function`

- [ ] **Step 3: Implement `resendInvitation`**

Add to `users.service.ts` (import `BadRequestException` at top if not already):

```typescript
  async resendInvitation(callerBaId: string, userPublicId: string) {
    await checkPermission(callerBaId, 'platform.users.manage').catch(async () => {
      await checkPermission(callerBaId, 'org.users.manage');
    });

    const user = await prisma.saUser.findUnique({ where: { publicId: userPublicId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.status !== 'pending') throw new BadRequestException('User is not pending — invitation cannot be resent');

    await prisma.saInvitation.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { expiresAt: new Date(0) }, // immediately expire all existing tokens
    });

    const token = crypto.randomBytes(32).toString('hex');
    const publicId = this.sqids.encode((Date.now() + 2) % 1_000_000);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await prisma.saInvitation.create({
      data: { publicId, token, userId: user.id, expiresAt },
    });

    const baseUrl = process.env.ADMIN_URL ?? 'http://localhost:3001';
    return { inviteUrl: `${baseUrl}/accept-invite?token=${token}` };
  }
```

Add the route to `users.controller.ts` inside the class:

```typescript
  @Post(':id/resend-invitation')
  resendInvitation(@Req() req: Request, @Param('id') id: string) {
    return this.users.resendInvitation(callerBaId(req), id);
  }
```

- [ ] **Step 4: Run all users tests**

```bash
cd C:/Users/rlond/Documents/GitHub/sassy-auth/apps/auth-server
npx jest src/users/ --no-coverage
```

Expected: PASS — all tests.

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/users/
git commit -m "feat(users): POST /api/users/:id/resend-invitation"
```

---

## Task 11: OrgsModule + RolesModule (read-only)

**Files:**
- Create: `apps/auth-server/src/orgs/` (module, service, controller, spec)
- Create: `apps/auth-server/src/roles/` (module, service, controller, spec)
- Modify: `apps/auth-server/src/app.module.ts`

- [ ] **Step 1: Write failing tests for OrgsService**

Create `apps/auth-server/src/orgs/orgs.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { OrgsService } from './orgs.service';
import { SqidService } from '../common/sqid/sqid.service';

jest.mock('@sassy-auth/db', () => ({
  prisma: { saOrg: { findMany: jest.fn(), findUnique: jest.fn() } },
}));
jest.mock('../common/permissions/check-permission', () => ({
  checkPermission: jest.fn().mockResolvedValue(undefined),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockPrisma = require('@sassy-auth/db').prisma as {
  saOrg: { findMany: jest.Mock; findUnique: jest.Mock };
};

const org = { publicId: 'org1', name: 'Acme', app: { publicId: 'app1' }, isPlatform: false };

describe('OrgsService', () => {
  let service: OrgsService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({ providers: [OrgsService, SqidService] }).compile();
    service = module.get(OrgsService);
    jest.clearAllMocks();
  });

  it('listOrgs returns mapped orgs', async () => {
    mockPrisma.saOrg.findMany.mockResolvedValue([org]);
    const result = await service.listOrgs('ba-caller');
    expect(result[0].id).toBe('org1');
    expect(result[0].name).toBe('Acme');
  });

  it('getOrg throws NotFoundException when not found', async () => {
    mockPrisma.saOrg.findUnique.mockResolvedValue(null);
    await expect(service.getOrg('ba-caller', 'org1')).rejects.toBeInstanceOf(NotFoundException);
  });
});
```

- [ ] **Step 2: Run and verify it fails**

```bash
cd C:/Users/rlond/Documents/GitHub/sassy-auth/apps/auth-server
npx jest src/orgs/orgs.service.spec.ts --no-coverage
```

Expected: FAIL — `Cannot find module './orgs.service'`

- [ ] **Step 3: Implement OrgsModule**

Create `apps/auth-server/src/orgs/orgs.service.ts`:

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '@sassy-auth/db';
import { checkPermission } from '../common/permissions/check-permission';

const ORG_INCLUDE = { app: { select: { publicId: true } } } as const;

function formatOrg(o: { publicId: string; name: string; isPlatform: boolean; app: { publicId: string } }) {
  return { id: o.publicId, name: o.name, appId: o.app.publicId, isPlatform: o.isPlatform };
}

@Injectable()
export class OrgsService {
  async listOrgs(callerBaId: string) {
    await checkPermission(callerBaId, 'platform.orgs.manage').catch(async () => {
      await checkPermission(callerBaId, 'org.users.manage');
    });
    const orgs = await prisma.saOrg.findMany({ include: ORG_INCLUDE });
    return orgs.map(formatOrg);
  }

  async getOrg(callerBaId: string, publicId: string) {
    await checkPermission(callerBaId, 'platform.orgs.manage').catch(async () => {
      await checkPermission(callerBaId, 'org.users.manage');
    });
    const org = await prisma.saOrg.findUnique({ where: { publicId }, include: ORG_INCLUDE });
    if (!org) throw new NotFoundException();
    return formatOrg(org);
  }
}
```

Create `apps/auth-server/src/orgs/orgs.controller.ts`:

```typescript
import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { BetterAuthGuard } from '../auth/better-auth.guard';
import { OrgsService } from './orgs.service';

@UseGuards(BetterAuthGuard)
@Controller('api/orgs')
export class OrgsController {
  constructor(private readonly orgs: OrgsService) {}

  @Get()
  list(@Req() req: Request) {
    return this.orgs.listOrgs((req as any).betterAuthUser.id);
  }

  @Get(':id')
  get(@Req() req: Request, @Param('id') id: string) {
    return this.orgs.getOrg((req as any).betterAuthUser.id, id);
  }
}
```

Create `apps/auth-server/src/orgs/orgs.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { OrgsService } from './orgs.service';
import { OrgsController } from './orgs.controller';
import { CommonModule } from '../common/common.module';

@Module({ imports: [CommonModule], providers: [OrgsService], controllers: [OrgsController] })
export class OrgsModule {}
```

- [ ] **Step 4: Write failing tests for RolesService**

Create `apps/auth-server/src/roles/roles.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { RolesService } from './roles.service';
import { SqidService } from '../common/sqid/sqid.service';

jest.mock('@sassy-auth/db', () => ({
  prisma: { saRole: { findMany: jest.fn(), findUnique: jest.fn() } },
}));
jest.mock('../common/permissions/check-permission', () => ({
  checkPermission: jest.fn().mockResolvedValue(undefined),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockPrisma = require('@sassy-auth/db').prisma as {
  saRole: { findMany: jest.Mock; findUnique: jest.Mock };
};

const role = {
  publicId: 'role1',
  name: 'Admin',
  app: { publicId: 'app1' },
  permissions: [{ permission: { publicId: 'perm1', name: 'users:read', app: { publicId: 'app1' } } }],
};

describe('RolesService', () => {
  let service: RolesService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({ providers: [RolesService, SqidService] }).compile();
    service = module.get(RolesService);
    jest.clearAllMocks();
  });

  it('listRoles returns mapped roles', async () => {
    mockPrisma.saRole.findMany.mockResolvedValue([role]);
    const result = await service.listRoles('ba-caller', undefined);
    expect(result[0].id).toBe('role1');
    expect(result[0].permissions).toHaveLength(1);
  });

  it('getRole throws NotFoundException when not found', async () => {
    mockPrisma.saRole.findUnique.mockResolvedValue(null);
    await expect(service.getRole('ba-caller', 'role1')).rejects.toBeInstanceOf(NotFoundException);
  });
});
```

- [ ] **Step 5: Run and verify it fails**

```bash
cd C:/Users/rlond/Documents/GitHub/sassy-auth/apps/auth-server
npx jest src/roles/roles.service.spec.ts --no-coverage
```

Expected: FAIL — `Cannot find module './roles.service'`

- [ ] **Step 6: Implement RolesModule**

Create `apps/auth-server/src/roles/roles.service.ts`:

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '@sassy-auth/db';
import { checkPermission } from '../common/permissions/check-permission';

const ROLE_INCLUDE = {
  app: { select: { publicId: true } },
  permissions: { include: { permission: { include: { app: { select: { publicId: true } } } } } },
} as const;

function formatRole(r: {
  publicId: string; name: string; app: { publicId: string };
  permissions: { permission: { publicId: string; name: string; app: { publicId: string } } }[];
}) {
  return {
    id: r.publicId,
    name: r.name,
    appId: r.app.publicId,
    permissions: r.permissions.map((rp) => ({
      id: rp.permission.publicId,
      name: rp.permission.name,
      appId: rp.permission.app.publicId,
    })),
  };
}

@Injectable()
export class RolesService {
  async listRoles(callerBaId: string, appPublicId?: string) {
    await checkPermission(callerBaId, 'platform.permissions.manage').catch(async () => {
      await checkPermission(callerBaId, 'org.permissions.manage');
    });
    const where = appPublicId ? { app: { publicId: appPublicId } } : {};
    const roles = await prisma.saRole.findMany({ where, include: ROLE_INCLUDE });
    return roles.map(formatRole);
  }

  async getRole(callerBaId: string, publicId: string) {
    await checkPermission(callerBaId, 'platform.permissions.manage').catch(async () => {
      await checkPermission(callerBaId, 'org.permissions.manage');
    });
    const role = await prisma.saRole.findUnique({ where: { publicId }, include: ROLE_INCLUDE });
    if (!role) throw new NotFoundException();
    return formatRole(role);
  }
}
```

Create `apps/auth-server/src/roles/roles.controller.ts`:

```typescript
import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { BetterAuthGuard } from '../auth/better-auth.guard';
import { RolesService } from './roles.service';

@UseGuards(BetterAuthGuard)
@Controller('api/roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  list(@Req() req: Request, @Query('appId') appId?: string) {
    return this.roles.listRoles((req as any).betterAuthUser.id, appId);
  }

  @Get(':id')
  get(@Req() req: Request, @Param('id') id: string) {
    return this.roles.getRole((req as any).betterAuthUser.id, id);
  }
}
```

Create `apps/auth-server/src/roles/roles.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { RolesService } from './roles.service';
import { RolesController } from './roles.controller';
import { CommonModule } from '../common/common.module';

@Module({ imports: [CommonModule], providers: [RolesService], controllers: [RolesController] })
export class RolesModule {}
```

- [ ] **Step 7: Run both new service specs**

```bash
cd C:/Users/rlond/Documents/GitHub/sassy-auth/apps/auth-server
npx jest src/orgs/orgs.service.spec.ts src/roles/roles.service.spec.ts --no-coverage
```

Expected: PASS — all 4 tests.

- [ ] **Step 8: Register both modules in app.module.ts**

```typescript
import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { TokenModule } from './token/token.module';
import { CommonModule } from './common/common.module';
import { UsersModule } from './users/users.module';
import { InvitationsModule } from './invitations/invitations.module';
import { OrgsModule } from './orgs/orgs.module';
import { RolesModule } from './roles/roles.module';

@Module({
  imports: [CommonModule, AuthModule, TokenModule, UsersModule, InvitationsModule, OrgsModule, RolesModule],
})
export class AppModule {}
```

- [ ] **Step 9: Run the full test suite**

```bash
cd C:/Users/rlond/Documents/GitHub/sassy-auth/apps/auth-server
npx jest --no-coverage
```

Expected: PASS — all tests (no failures, no warnings).

- [ ] **Step 10: Commit**

```bash
git add apps/auth-server/src/orgs/ apps/auth-server/src/roles/ apps/auth-server/src/app.module.ts
git commit -m "feat(orgs,roles): GET /api/orgs and GET /api/roles (read-only)"
```

---

## Task 12: Update openapi.yaml

**Files:**
- Modify: `docs/api/openapi.yaml`

- [ ] **Step 1: Add `UserStatus` enum and `status` field to `User` schema**

In `docs/api/openapi.yaml`, find the `User` schema under `components/schemas` and add `status`:

```yaml
User:
  type: object
  properties:
    id:
      type: string
      example: "qR7sT1"
    firstName:
      type: string
      example: "Alice"
    lastName:
      type: string
      example: "Smith"
    email:
      type: string
      format: email
      example: "alice@example.com"
    phoneNumber:
      type: string
      nullable: true
      example: "+15551234567"
    username:
      type: string
      nullable: true
      example: "alice_s"
    orgId:
      type: string
      description: Public ID of the user's organization
      example: "xK2pLn"
    status:
      type: string
      enum: [active, pending, inactive]
      description: >
        active — signed up and enabled;
        pending — invited, not yet accepted;
        inactive — disabled by admin
      example: "active"
  required: [id, firstName, lastName, email, orgId, status]
```

- [ ] **Step 2: Update `CreateUserRequest` — remove password**

Replace `CreateUserRequest`:

```yaml
CreateUserRequest:
  type: object
  properties:
    firstName:   { type: string, example: "Alice" }
    lastName:    { type: string, example: "Smith" }
    email:       { type: string, format: email, example: "alice@example.com" }
    orgId:       { type: string, example: "xK2pLn" }
    phoneNumber: { type: string, nullable: true, example: "+15551234567" }
    username:    { type: string, nullable: true, example: "alice_s" }
  required: [firstName, lastName, email, orgId]
```

- [ ] **Step 3: Update `UpdateUserRequest` — add status**

Replace `UpdateUserRequest`:

```yaml
UpdateUserRequest:
  type: object
  properties:
    firstName:   { type: string }
    lastName:    { type: string }
    phoneNumber: { type: string, nullable: true }
    username:    { type: string, nullable: true }
    status:
      type: string
      enum: [active, inactive]
      description: Activate or deactivate. Cannot be set to pending via this endpoint.
```

- [ ] **Step 4: Add `Invitation` schema and new endpoints**

Add to `components/schemas`:

```yaml
Invitation:
  type: object
  properties:
    inviteUrl:
      type: string
      description: Full URL for the accept-invite page including token
      example: "http://localhost:3001/accept-invite?token=abc123..."
    expiresAt:
      type: string
      format: date-time
  required: [inviteUrl, expiresAt]

CreateUserResponse:
  type: object
  properties:
    user:
      $ref: '#/components/schemas/User'
    inviteUrl:
      type: string
      example: "http://localhost:3001/accept-invite?token=abc123..."
  required: [user, inviteUrl]

InvitationInfo:
  type: object
  properties:
    firstName: { type: string, example: "Jane" }
    email:     { type: string, format: email }
    expired:   { type: boolean }
  required: [firstName, email, expired]

AcceptInvitationRequest:
  type: object
  properties:
    password: { type: string, format: password, minLength: 8 }
  required: [password]
```

Add to `paths`:

```yaml
  /api/users/{id}/resend-invitation:
    parameters:
      - $ref: '#/components/parameters/UserId'
    post:
      tags: [Users]
      summary: Resend invitation to a pending user
      description: Expires all existing tokens and generates a new one. Returns 400 if user is not pending.
      responses:
        '200':
          description: New invitation URL
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Invitation' }
        '400':
          description: User is not in pending status
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Error' }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '404': { $ref: '#/components/responses/NotFound' }

  /api/invitations/{token}:
    parameters:
      - name: token
        in: path
        required: true
        schema: { type: string }
    get:
      tags: [Users]
      summary: Validate an invitation token
      security: []
      responses:
        '200':
          description: Token info
          content:
            application/json:
              schema: { $ref: '#/components/schemas/InvitationInfo' }
        '404':
          description: Token not found
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Error' }

  /api/invitations/{token}/accept:
    parameters:
      - name: token
        in: path
        required: true
        schema: { type: string }
    post:
      tags: [Users]
      summary: Accept invitation and set password
      security: []
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/AcceptInvitationRequest' }
      responses:
        '204':
          description: Password set, user activated
        '400':
          description: Token expired or already used
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Error' }
        '404': { $ref: '#/components/responses/NotFound' }
```

Also update `POST /api/users` response to return `CreateUserResponse` instead of just `User`.

- [ ] **Step 5: Commit**

```bash
git add docs/api/openapi.yaml
git commit -m "docs(api): update openapi — status field, invitation endpoints, orgs, roles"
```

---

## Final Verification

- [ ] **Run the complete test suite**

```bash
cd C:/Users/rlond/Documents/GitHub/sassy-auth/apps/auth-server
npx jest --no-coverage
```

Expected: All tests PASS. Zero failures.

- [ ] **Start the dev server and smoke-test manually**

```bash
cd C:/Users/rlond/Documents/GitHub/sassy-auth
pnpm --filter @sassy-auth/auth-server dev
```

Then verify with curl (replace `<cookie>` with a valid BetterAuth session from the seed user):

```bash
curl -s -H "Cookie: better-auth.session_token=<cookie>" http://localhost:3000/api/users | jq .
curl -s http://localhost:3000/api/invitations/nonexistent-token
```

Expected: `GET /api/users` returns array; `GET /api/invitations/nonexistent-token` returns 404.
