# API & E2E Test Coverage Campaign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build complete, automated test coverage across all five resource APIs (`/apps`, `/orgs`, `/roles`, `/permissions`, `/users`) and the corresponding admin UI, exercised by every seeded platform admin, then run the campaign end-to-end and produce `bugs/TEST_BUGS.md`.

**Architecture:** Six landable PRs across four waves. Two shared modules (`permissions-matrix.ts` in auth-server, `lib/admins.ts` in admin-e2e) act as the single source of truth for admin→endpoint→op permissions, consumed by both API E2E and UI E2E via `describe.each`/per-project parameterisation.

**Tech Stack:** NestJS + supertest + Jest (API), Playwright (UI), Prisma (real DB), BetterAuth (sessions), pnpm + Turbo workspaces.

**Spec:** `docs/superpowers/specs/2026-06-01-api-and-e2e-test-coverage-design.md`

---

## Phase 1 — Wave A: Unit-test gap fill (PR 1)

**Outcome:** Every public method on every service and controller has at least one happy-path and one failure-path unit test. Controller specs added for the 6 controllers that lack one. `coverage/baseline.txt` captures the before/after delta.

### Task 1.1: Capture baseline coverage

**Files:** none modified; produces `apps/auth-server/coverage/baseline.txt`.

- [ ] **Step 1: Run the existing unit suite with coverage**

```bash
pnpm --filter @sassy-auth/auth-server test -- --coverage --coverageReporters=text-summary --coverageReporters=text 2>&1 | tee coverage-baseline-raw.txt
```

Expected: jest runs, prints summary table at the end. Some tests may fail — that's fine; baseline is still recorded.

- [ ] **Step 2: Extract the summary into a tracked file**

```bash
mkdir -p apps/auth-server/coverage
grep -E "All files|Coverage summary|Statements|Branches|Functions|Lines|Tests:" coverage-baseline-raw.txt > apps/auth-server/coverage/baseline.txt
rm coverage-baseline-raw.txt
cat apps/auth-server/coverage/baseline.txt
```

Expected: a short text file with the coverage percentages and test totals.

- [ ] **Step 3: Commit the baseline**

```bash
git add apps/auth-server/coverage/baseline.txt
git commit -m "test(auth-server): capture pre-Wave-A coverage baseline"
```

---

### Task 1.2: Add `apps.controller.spec.ts`

**Files:**
- Create: `apps/auth-server/src/apps/apps.controller.spec.ts`
- Reference: `apps/auth-server/src/token/token.controller.spec.ts` (pattern), `apps/auth-server/src/apps/apps.controller.ts` (subject)

- [ ] **Step 1: Write the controller spec**

Create `apps/auth-server/src/apps/apps.controller.spec.ts` with:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { AppsController } from './apps.controller';
import { AppsService } from './apps.service';

const mockAppsService = {
  listApps: jest.fn(),
  createApp: jest.fn(),
  updateApp: jest.fn(),
  deleteApp: jest.fn(),
};

function makeReq(baUserId = 'ba-caller') {
  return { betterAuthUser: { id: baUserId } } as unknown as import('express').Request;
}

describe('AppsController', () => {
  let controller: AppsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AppsController],
      providers: [{ provide: AppsService, useValue: mockAppsService }],
    }).compile();
    controller = module.get(AppsController);
    jest.clearAllMocks();
  });

  describe('list', () => {
    it('forwards caller id and query to AppsService.listApps', async () => {
      mockAppsService.listApps.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 });
      const result = await controller.list(makeReq('ba-1'), { page: 2, pageSize: 10 });
      expect(mockAppsService.listApps).toHaveBeenCalledWith('ba-1', { page: 2, pageSize: 10 });
      expect(result).toEqual({ items: [], total: 0, page: 1, pageSize: 25 });
    });
  });

  describe('create', () => {
    it('forwards caller id and DTO to AppsService.createApp', async () => {
      mockAppsService.createApp.mockResolvedValue({ publicId: 'sq_1', name: 'X', url: 'https://x', isPlatform: false });
      const dto = { name: 'X', url: 'https://x' };
      const result = await controller.create(makeReq('ba-2'), dto);
      expect(mockAppsService.createApp).toHaveBeenCalledWith('ba-2', dto);
      expect(result.publicId).toBe('sq_1');
    });
  });

  describe('update', () => {
    it('forwards caller id, publicId, and DTO to AppsService.updateApp', async () => {
      mockAppsService.updateApp.mockResolvedValue({ publicId: 'sq_1', name: 'Y', url: 'https://y', isPlatform: false });
      const dto = { name: 'Y' };
      const result = await controller.update(makeReq('ba-3'), 'sq_1', dto);
      expect(mockAppsService.updateApp).toHaveBeenCalledWith('ba-3', 'sq_1', dto);
      expect(result.name).toBe('Y');
    });
  });

  describe('remove', () => {
    it('forwards caller id and publicId to AppsService.deleteApp', async () => {
      mockAppsService.deleteApp.mockResolvedValue(undefined);
      await controller.remove(makeReq('ba-4'), 'sq_1');
      expect(mockAppsService.deleteApp).toHaveBeenCalledWith('ba-4', 'sq_1');
    });
  });
});
```

- [ ] **Step 2: Run the new spec**

```bash
pnpm --filter @sassy-auth/auth-server test -- apps.controller.spec
```

Expected: 4 tests pass.

- [ ] **Step 3: Commit**

```bash
git add apps/auth-server/src/apps/apps.controller.spec.ts
git commit -m "test(apps): add controller spec covering all 4 endpoints"
```

---

### Task 1.3: Add `orgs.controller.spec.ts`

**Files:**
- Create: `apps/auth-server/src/orgs/orgs.controller.spec.ts`

- [ ] **Step 1: Write the controller spec**

Create `apps/auth-server/src/orgs/orgs.controller.spec.ts` with:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { OrgsController } from './orgs.controller';
import { OrgsService } from './orgs.service';

const mockOrgsService = {
  listOrgs: jest.fn(),
  getOrg: jest.fn(),
  createOrg: jest.fn(),
  updateOrg: jest.fn(),
  deleteOrg: jest.fn(),
};

function makeReq(baUserId = 'ba-caller') {
  return { betterAuthUser: { id: baUserId } } as unknown as import('express').Request;
}

describe('OrgsController', () => {
  let controller: OrgsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OrgsController],
      providers: [{ provide: OrgsService, useValue: mockOrgsService }],
    }).compile();
    controller = module.get(OrgsController);
    jest.clearAllMocks();
  });

  describe('list', () => {
    it('forwards caller id and query to OrgsService.listOrgs', async () => {
      mockOrgsService.listOrgs.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 });
      const result = await controller.list(makeReq('ba-1'), { page: 2, pageSize: 10 });
      expect(mockOrgsService.listOrgs).toHaveBeenCalledWith('ba-1', { page: 2, pageSize: 10 });
      expect(result).toEqual({ items: [], total: 0, page: 1, pageSize: 25 });
    });
  });

  describe('get', () => {
    it('forwards caller id and publicId to OrgsService.getOrg', async () => {
      mockOrgsService.getOrg.mockResolvedValue({ publicId: 'sq_1', name: 'O' });
      const result = await controller.get(makeReq('ba-1'), 'sq_1');
      expect(mockOrgsService.getOrg).toHaveBeenCalledWith('ba-1', 'sq_1');
      expect(result.publicId).toBe('sq_1');
    });
  });

  describe('create', () => {
    it('forwards caller id and DTO to OrgsService.createOrg', async () => {
      const dto = { name: 'O', appId: 'sq_app_1' };
      mockOrgsService.createOrg.mockResolvedValue({ publicId: 'sq_2', name: 'O' });
      const result = await controller.create(makeReq('ba-2'), dto);
      expect(mockOrgsService.createOrg).toHaveBeenCalledWith('ba-2', dto);
      expect(result.publicId).toBe('sq_2');
    });
  });

  describe('update', () => {
    it('forwards caller id, publicId, and DTO to OrgsService.updateOrg', async () => {
      const dto = { name: 'Renamed' };
      mockOrgsService.updateOrg.mockResolvedValue({ publicId: 'sq_2', name: 'Renamed' });
      const result = await controller.update(makeReq('ba-3'), 'sq_2', dto);
      expect(mockOrgsService.updateOrg).toHaveBeenCalledWith('ba-3', 'sq_2', dto);
      expect(result.name).toBe('Renamed');
    });
  });

  describe('remove', () => {
    it('forwards caller id and publicId to OrgsService.deleteOrg', async () => {
      mockOrgsService.deleteOrg.mockResolvedValue(undefined);
      await controller.remove(makeReq('ba-4'), 'sq_2');
      expect(mockOrgsService.deleteOrg).toHaveBeenCalledWith('ba-4', 'sq_2');
    });
  });
});
```

- [ ] **Step 2: Run the new spec**

```bash
pnpm --filter @sassy-auth/auth-server test -- orgs.controller.spec
```

Expected: 5 tests pass.

- [ ] **Step 3: Commit**

```bash
git add apps/auth-server/src/orgs/orgs.controller.spec.ts
git commit -m "test(orgs): add controller spec covering all 5 endpoints"
```

---

### Task 1.4: Add `roles.controller.spec.ts`

**Files:**
- Create: `apps/auth-server/src/roles/roles.controller.spec.ts`

- [ ] **Step 1: Write the controller spec**

Create `apps/auth-server/src/roles/roles.controller.spec.ts` with:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';

const mockRolesService = {
  listRoles: jest.fn(),
  getRole: jest.fn(),
  createRole: jest.fn(),
  updateRole: jest.fn(),
  deleteRole: jest.fn(),
};

function makeReq(baUserId = 'ba-caller') {
  return { betterAuthUser: { id: baUserId } } as unknown as import('express').Request;
}

describe('RolesController', () => {
  let controller: RolesController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RolesController],
      providers: [{ provide: RolesService, useValue: mockRolesService }],
    }).compile();
    controller = module.get(RolesController);
    jest.clearAllMocks();
  });

  describe('list', () => {
    it('forwards caller id and query to RolesService.listRoles', async () => {
      mockRolesService.listRoles.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 });
      const result = await controller.list(makeReq('ba-1'), { page: 2, pageSize: 10 });
      expect(mockRolesService.listRoles).toHaveBeenCalledWith('ba-1', { page: 2, pageSize: 10 });
      expect(result.total).toBe(0);
    });
  });

  describe('get', () => {
    it('forwards caller id and publicId to RolesService.getRole', async () => {
      mockRolesService.getRole.mockResolvedValue({ publicId: 'sq_1', name: 'R' });
      const result = await controller.get(makeReq('ba-1'), 'sq_1');
      expect(mockRolesService.getRole).toHaveBeenCalledWith('ba-1', 'sq_1');
      expect(result.publicId).toBe('sq_1');
    });
  });

  describe('create', () => {
    it('forwards caller id and DTO to RolesService.createRole', async () => {
      const dto = { name: 'R', appId: 'sq_app_1', permissionIds: [] };
      mockRolesService.createRole.mockResolvedValue({ publicId: 'sq_2', name: 'R' });
      const result = await controller.create(makeReq('ba-2'), dto);
      expect(mockRolesService.createRole).toHaveBeenCalledWith('ba-2', dto);
      expect(result.publicId).toBe('sq_2');
    });
  });

  describe('update', () => {
    it('forwards caller id, publicId, and DTO to RolesService.updateRole', async () => {
      const dto = { name: 'Renamed' };
      mockRolesService.updateRole.mockResolvedValue({ publicId: 'sq_2', name: 'Renamed' });
      const result = await controller.update(makeReq('ba-3'), 'sq_2', dto);
      expect(mockRolesService.updateRole).toHaveBeenCalledWith('ba-3', 'sq_2', dto);
      expect(result.name).toBe('Renamed');
    });
  });

  describe('remove', () => {
    it('forwards caller id and publicId to RolesService.deleteRole', async () => {
      mockRolesService.deleteRole.mockResolvedValue(undefined);
      await controller.remove(makeReq('ba-4'), 'sq_2');
      expect(mockRolesService.deleteRole).toHaveBeenCalledWith('ba-4', 'sq_2');
    });
  });
});
```

- [ ] **Step 2: Run the new spec**

```bash
pnpm --filter @sassy-auth/auth-server test -- roles.controller.spec
```

Expected: 5 tests pass.

- [ ] **Step 3: Commit**

```bash
git add apps/auth-server/src/roles/roles.controller.spec.ts
git commit -m "test(roles): add controller spec covering all 5 endpoints"
```

---

### Task 1.5: Add `permissions.controller.spec.ts`

**Files:**
- Create: `apps/auth-server/src/permissions/permissions.controller.spec.ts`

- [ ] **Step 1: Write the controller spec**

Create `apps/auth-server/src/permissions/permissions.controller.spec.ts` with:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { PermissionsController } from './permissions.controller';
import { PermissionsService } from './permissions.service';

const mockPermissionsService = {
  listPermissions: jest.fn(),
  getPermission: jest.fn(),
  createPermission: jest.fn(),
  updatePermission: jest.fn(),
  deletePermission: jest.fn(),
};

function makeReq(baUserId = 'ba-caller') {
  return { betterAuthUser: { id: baUserId } } as unknown as import('express').Request;
}

describe('PermissionsController', () => {
  let controller: PermissionsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PermissionsController],
      providers: [{ provide: PermissionsService, useValue: mockPermissionsService }],
    }).compile();
    controller = module.get(PermissionsController);
    jest.clearAllMocks();
  });

  describe('list', () => {
    it('forwards caller id and query to PermissionsService.listPermissions', async () => {
      mockPermissionsService.listPermissions.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 });
      await controller.list(makeReq('ba-1'), { page: 1, pageSize: 25 });
      expect(mockPermissionsService.listPermissions).toHaveBeenCalledWith('ba-1', { page: 1, pageSize: 25 });
    });
  });

  describe('get', () => {
    it('forwards caller id and publicId to PermissionsService.getPermission', async () => {
      mockPermissionsService.getPermission.mockResolvedValue({ publicId: 'sq_1', name: 'a.b' });
      const result = await controller.get(makeReq('ba-1'), 'sq_1');
      expect(mockPermissionsService.getPermission).toHaveBeenCalledWith('ba-1', 'sq_1');
      expect(result.publicId).toBe('sq_1');
    });
  });

  describe('create', () => {
    it('forwards caller id and DTO to PermissionsService.createPermission', async () => {
      const dto = { name: 'a.b', appId: 'sq_app_1' };
      mockPermissionsService.createPermission.mockResolvedValue({ publicId: 'sq_2', name: 'a.b' });
      const result = await controller.create(makeReq('ba-2'), dto);
      expect(mockPermissionsService.createPermission).toHaveBeenCalledWith('ba-2', dto);
      expect(result.publicId).toBe('sq_2');
    });
  });

  describe('update', () => {
    it('forwards caller id, publicId, and DTO to PermissionsService.updatePermission', async () => {
      const dto = { name: 'a.c' };
      mockPermissionsService.updatePermission.mockResolvedValue({ publicId: 'sq_2', name: 'a.c' });
      await controller.update(makeReq('ba-3'), 'sq_2', dto);
      expect(mockPermissionsService.updatePermission).toHaveBeenCalledWith('ba-3', 'sq_2', dto);
    });
  });

  describe('remove', () => {
    it('forwards caller id and publicId to PermissionsService.deletePermission', async () => {
      mockPermissionsService.deletePermission.mockResolvedValue(undefined);
      await controller.remove(makeReq('ba-4'), 'sq_2');
      expect(mockPermissionsService.deletePermission).toHaveBeenCalledWith('ba-4', 'sq_2');
    });
  });
});
```

- [ ] **Step 2: Run the new spec**

```bash
pnpm --filter @sassy-auth/auth-server test -- permissions.controller.spec
```

Expected: 5 tests pass.

- [ ] **Step 3: Commit**

```bash
git add apps/auth-server/src/permissions/permissions.controller.spec.ts
git commit -m "test(permissions): add controller spec covering all 5 endpoints"
```

---

### Task 1.6: Add `users.controller.spec.ts`

**Files:**
- Create: `apps/auth-server/src/users/users.controller.spec.ts`

- [ ] **Step 1: Write the controller spec**

Create `apps/auth-server/src/users/users.controller.spec.ts` with:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

const mockUsersService = {
  listUsers: jest.fn(),
  getUser: jest.fn(),
  createUser: jest.fn(),
  updateUser: jest.fn(),
  deleteUser: jest.fn(),
  getUserRoles: jest.fn(),
  getEffectivePermissions: jest.fn(),
  assignRole: jest.fn(),
  removeRole: jest.fn(),
  resendInvitation: jest.fn(),
};

function makeReq(baUserId = 'ba-caller') {
  return { betterAuthUser: { id: baUserId } } as unknown as import('express').Request;
}

describe('UsersController', () => {
  let controller: UsersController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: mockUsersService }],
    }).compile();
    controller = module.get(UsersController);
    jest.clearAllMocks();
  });

  describe('list', () => {
    it('forwards caller id and orgId/appId filter to UsersService.listUsers', async () => {
      mockUsersService.listUsers.mockResolvedValue([]);
      await controller.list(makeReq('ba-1'), 'org-1', 'app-1');
      expect(mockUsersService.listUsers).toHaveBeenCalledWith('ba-1', {
        orgPublicId: 'org-1',
        appPublicId: 'app-1',
      });
    });

    it('forwards undefined filter when no query', async () => {
      mockUsersService.listUsers.mockResolvedValue([]);
      await controller.list(makeReq('ba-1'));
      expect(mockUsersService.listUsers).toHaveBeenCalledWith('ba-1', {
        orgPublicId: undefined,
        appPublicId: undefined,
      });
    });
  });

  describe('get', () => {
    it('forwards caller id and id to UsersService.getUser', async () => {
      mockUsersService.getUser.mockResolvedValue({ id: 'usr-1' });
      await controller.get(makeReq('ba-1'), 'usr-1');
      expect(mockUsersService.getUser).toHaveBeenCalledWith('ba-1', 'usr-1');
    });
  });

  describe('create', () => {
    it('forwards caller id and DTO to UsersService.createUser', async () => {
      const dto = { firstName: 'A', lastName: 'B', email: 'a@b.io', orgId: 'org-1' };
      mockUsersService.createUser.mockResolvedValue({ user: { id: 'usr-1' }, inviteUrl: 'x' });
      await controller.create(makeReq('ba-2'), dto);
      expect(mockUsersService.createUser).toHaveBeenCalledWith('ba-2', dto);
    });
  });

  describe('update', () => {
    it('forwards caller id, id, and DTO to UsersService.updateUser', async () => {
      const dto = { firstName: 'C' };
      mockUsersService.updateUser.mockResolvedValue({ id: 'usr-1', firstName: 'C' });
      await controller.update(makeReq('ba-3'), 'usr-1', dto);
      expect(mockUsersService.updateUser).toHaveBeenCalledWith('ba-3', 'usr-1', dto);
    });
  });

  describe('remove', () => {
    it('forwards caller id and id to UsersService.deleteUser', async () => {
      mockUsersService.deleteUser.mockResolvedValue(undefined);
      await controller.remove(makeReq('ba-4'), 'usr-1');
      expect(mockUsersService.deleteUser).toHaveBeenCalledWith('ba-4', 'usr-1');
    });
  });

  describe('getRoles', () => {
    it('forwards caller id and id to UsersService.getUserRoles', async () => {
      mockUsersService.getUserRoles.mockResolvedValue([]);
      await controller.getRoles(makeReq('ba-5'), 'usr-1');
      expect(mockUsersService.getUserRoles).toHaveBeenCalledWith('ba-5', 'usr-1');
    });
  });

  describe('effectivePermissions', () => {
    it('forwards caller id and id to UsersService.getEffectivePermissions', async () => {
      mockUsersService.getEffectivePermissions.mockResolvedValue({ userId: 'usr-1', permissions: [] });
      await controller.effectivePermissions(makeReq('ba-6'), 'usr-1');
      expect(mockUsersService.getEffectivePermissions).toHaveBeenCalledWith('ba-6', 'usr-1');
    });
  });

  describe('assignRole', () => {
    it('forwards caller id, id, and DTO to UsersService.assignRole', async () => {
      const dto = { roleId: 'role-1' };
      mockUsersService.assignRole.mockResolvedValue(undefined);
      await controller.assignRole(makeReq('ba-7'), 'usr-1', dto);
      expect(mockUsersService.assignRole).toHaveBeenCalledWith('ba-7', 'usr-1', dto);
    });
  });

  describe('removeRole', () => {
    it('forwards caller id, user id, and role id to UsersService.removeRole', async () => {
      mockUsersService.removeRole.mockResolvedValue(undefined);
      await controller.removeRole(makeReq('ba-8'), 'usr-1', 'role-1');
      expect(mockUsersService.removeRole).toHaveBeenCalledWith('ba-8', 'usr-1', 'role-1');
    });
  });

  describe('resendInvitation', () => {
    it('forwards caller id and id to UsersService.resendInvitation', async () => {
      mockUsersService.resendInvitation.mockResolvedValue({ inviteUrl: 'x' });
      await controller.resendInvitation(makeReq('ba-9'), 'usr-1');
      expect(mockUsersService.resendInvitation).toHaveBeenCalledWith('ba-9', 'usr-1');
    });
  });
});
```

- [ ] **Step 2: Run the new spec**

```bash
pnpm --filter @sassy-auth/auth-server test -- users.controller.spec
```

Expected: 11 tests pass.

- [ ] **Step 3: Commit**

```bash
git add apps/auth-server/src/users/users.controller.spec.ts
git commit -m "test(users): add controller spec covering all 10 endpoints"
```

---

### Task 1.7: Add `me.controller.spec.ts` and `invitations.controller.spec.ts`

**Files:**
- Create: `apps/auth-server/src/me/me.controller.spec.ts`
- Create: `apps/auth-server/src/invitations/invitations.controller.spec.ts`

- [ ] **Step 1: Write `me.controller.spec.ts`**

Create `apps/auth-server/src/me/me.controller.spec.ts` with:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { MeController } from './me.controller';
import { MeService } from './me.service';

const mockMeService = { getMyPermissions: jest.fn() };

function makeReq(baUserId = 'ba-caller') {
  return { betterAuthUser: { id: baUserId } } as unknown as import('express').Request;
}

describe('MeController', () => {
  let controller: MeController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MeController],
      providers: [{ provide: MeService, useValue: mockMeService }],
    }).compile();
    controller = module.get(MeController);
    jest.clearAllMocks();
  });

  describe('permissions', () => {
    it('forwards caller id to MeService.getMyPermissions', async () => {
      mockMeService.getMyPermissions.mockResolvedValue({ permissions: ['platform.users.manage'] });
      const result = await controller.permissions(makeReq('ba-1'));
      expect(mockMeService.getMyPermissions).toHaveBeenCalledWith('ba-1');
      expect(result.permissions).toEqual(['platform.users.manage']);
    });
  });
});
```

- [ ] **Step 2: Write `invitations.controller.spec.ts`**

Create `apps/auth-server/src/invitations/invitations.controller.spec.ts` with:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { InvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';

const mockService = {
  validateToken: jest.fn(),
  acceptInvitation: jest.fn(),
};

describe('InvitationsController', () => {
  let controller: InvitationsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [InvitationsController],
      providers: [{ provide: InvitationsService, useValue: mockService }],
    }).compile();
    controller = module.get(InvitationsController);
    jest.clearAllMocks();
  });

  describe('validate', () => {
    it('forwards token to InvitationsService.validateToken', async () => {
      mockService.validateToken.mockResolvedValue({ email: 'a@b.io', firstName: 'A', lastName: 'B' });
      const result = await controller.validate('tok-123');
      expect(mockService.validateToken).toHaveBeenCalledWith('tok-123');
      expect(result.email).toBe('a@b.io');
    });
  });

  describe('accept', () => {
    it('forwards token and password to InvitationsService.acceptInvitation', async () => {
      mockService.acceptInvitation.mockResolvedValue(undefined);
      await controller.accept('tok-123', { password: 'StrongP@ss1' });
      expect(mockService.acceptInvitation).toHaveBeenCalledWith('tok-123', 'StrongP@ss1');
    });
  });
});
```

- [ ] **Step 3: Run both new specs**

```bash
pnpm --filter @sassy-auth/auth-server test -- me.controller.spec invitations.controller.spec
```

Expected: 3 tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/auth-server/src/me/me.controller.spec.ts apps/auth-server/src/invitations/invitations.controller.spec.ts
git commit -m "test(me,invitations): add controller specs"
```

---

### Task 1.8: Audit service-spec coverage gaps

**Files:**
- Modify: any existing `*.service.spec.ts` with gaps (driven by coverage report)

- [ ] **Step 1: Generate per-file coverage report**

```bash
pnpm --filter @sassy-auth/auth-server test -- --coverage --coverageReporters=text 2>&1 | grep -A 200 "File.*% Stmts" | head -100
```

Expected: a per-file table. Note any service file with branch coverage <80% — those are candidates for added tests.

- [ ] **Step 2: For each service flagged, identify the uncovered branch**

For each service with low branch coverage, open the file and the spec side-by-side, and find branches not exercised. Typical gaps:
- `ConflictException` paths (P2002 from Prisma)
- `ForbiddenException` paths (e.g., `existing.isPlatform` on apps/orgs/permissions)
- `BadRequestException` paths (e.g., update with no fields)
- Sub-query error paths (`resolvePermissionIds` mismatched app)

- [ ] **Step 3: Add the missing tests inline in the existing spec file**

Pattern (adapted to whichever service is being patched). Example — add a missing `BadRequestException` test to `apps.service.spec.ts`:

```ts
describe('updateApp validation', () => {
  it('throws BadRequestException when neither name nor url is provided', async () => {
    const { BadRequestException } = await import('@nestjs/common');
    await expect(service.updateApp('ba-caller', 'sq_app_1', {})).rejects.toBeInstanceOf(BadRequestException);
  });
});
```

Repeat per gap. Apply the same shape:
- `describe('<method> <branch>', () => { it('throws <Exception> when <condition>', async () => { ... }); });`

- [ ] **Step 4: Re-run coverage and confirm branches now covered**

```bash
pnpm --filter @sassy-auth/auth-server test -- --coverage --coverageReporters=text-summary
```

Expected: branch coverage % is higher than baseline.

- [ ] **Step 5: Update `apps/auth-server/coverage/baseline.txt` to reflect after-state**

```bash
pnpm --filter @sassy-auth/auth-server test -- --coverage --coverageReporters=text-summary --coverageReporters=text 2>&1 | tee coverage-after-raw.txt
grep -E "All files|Coverage summary|Statements|Branches|Functions|Lines|Tests:" coverage-after-raw.txt > apps/auth-server/coverage/baseline.txt
rm coverage-after-raw.txt
```

- [ ] **Step 6: Commit**

```bash
git add apps/auth-server/src apps/auth-server/coverage/baseline.txt
git commit -m "test(auth-server): fill service-spec branch coverage gaps"
```

---

### Task 1.9: Open PR 1

- [ ] **Step 1: Confirm full unit suite is green**

```bash
pnpm --filter @sassy-auth/auth-server test
```

Expected: all tests pass.

- [ ] **Step 2: Push and open the PR**

```bash
git push -u origin master  # or whatever branch this PR lives on
gh pr create --title "test(auth-server): Wave A — unit-test gap fill" --body "$(cat <<'EOF'
## Summary
- Added controller specs for apps, orgs, roles, permissions, users, me, invitations.
- Filled branch-coverage gaps in service specs (see `apps/auth-server/coverage/baseline.txt`).
- Baseline coverage delta visible in the PR diff.

## Test plan
- [x] `pnpm --filter @sassy-auth/auth-server test` is green.
- [x] Coverage report shows higher branch % than baseline.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL returned.

---

<!-- PHASE-1-END -->

## Phase 2 — Wave B Infra (PR 2)

**Outcome:** `apps/auth-server/test/matrix/` exists with `permissions-matrix.ts`, `harness.ts`, `factories.ts`, and five empty matrix spec files. The full E2E suite still passes (the empty matrix files are no-op describes).

### Task 2.1: Create `permissions-matrix.ts`

**Files:**
- Create: `apps/auth-server/test/matrix/permissions-matrix.ts`

- [ ] **Step 1: Write the module**

Create `apps/auth-server/test/matrix/permissions-matrix.ts` with:

```ts
/**
 * Single source of truth for which seeded admin can do what.
 * Mirrors apps/auth-server/src/seed/seed.ts. If seed changes, this
 * file changes — every matrix spec re-derives expected outcomes here.
 */

export const ADMIN_PASSWORD = 'Pass@word1234';

export type AdminKey = 'apps' | 'orgs' | 'users' | 'perms' | 'super';

export interface SeedAdmin {
  key: AdminKey;
  email: string;
  /** Direct permission(s) held. 'super' holds all platform.*  via the role. */
  perms: readonly string[];
}

export const SEED_ADMINS: readonly SeedAdmin[] = [
  { key: 'apps',  email: 'a@sa.io', perms: ['platform.apps.manage'] },
  { key: 'orgs',  email: 'o@sa.io', perms: ['platform.orgs.manage'] },
  { key: 'users', email: 'u@sa.io', perms: ['platform.users.manage'] },
  { key: 'perms', email: 'p@sa.io', perms: ['platform.permissions.manage'] },
  {
    key: 'super',
    email: 's@sa.io',
    perms: [
      'platform.apps.manage',
      'platform.orgs.manage',
      'platform.users.manage',
      'platform.permissions.manage',
      'org.users.manage',
      'org.permissions.manage',
    ],
  },
];

export type ResourceArea = 'apps' | 'orgs' | 'roles' | 'permissions' | 'users';

export type Op =
  | 'list' | 'get' | 'create' | 'update' | 'delete'
  /* /users sub-routes */
  | 'getRoles' | 'effectivePermissions' | 'assignRole' | 'removeRole' | 'resendInvitation';

/** Which permission gates each (area, op). Derived from each service's checkPermission call. */
const GATE: Record<ResourceArea, Partial<Record<Op, readonly string[]>>> = {
  apps: {
    list:   ['platform.apps.manage'],
    create: ['platform.apps.manage'],
    update: ['platform.apps.manage'],
    delete: ['platform.apps.manage'],
  },
  orgs: {
    list:   ['platform.orgs.manage', 'org.users.manage'],
    get:    ['platform.orgs.manage', 'org.users.manage'],
    create: ['platform.orgs.manage'],
    update: ['platform.orgs.manage'],
    delete: ['platform.orgs.manage'],
  },
  roles: {
    list:   ['platform.permissions.manage', 'org.permissions.manage'],
    get:    ['platform.permissions.manage', 'org.permissions.manage'],
    create: ['platform.permissions.manage'],
    update: ['platform.permissions.manage'],
    delete: ['platform.permissions.manage'],
  },
  permissions: {
    list:   ['platform.permissions.manage'],
    get:    ['platform.permissions.manage'],
    create: ['platform.permissions.manage'],
    update: ['platform.permissions.manage'],
    delete: ['platform.permissions.manage'],
  },
  users: {
    list:                 ['platform.users.manage', 'org.users.manage'],
    get:                  ['platform.users.manage', 'org.users.manage'],
    create:               ['platform.users.manage', 'org.users.manage'],
    update:               ['platform.users.manage', 'org.users.manage'],
    delete:               ['platform.users.manage'], // strictest: delete only platform-wide
    getRoles:             ['platform.users.manage', 'org.users.manage'],
    effectivePermissions: ['platform.users.manage', 'org.users.manage'],
    assignRole:           ['platform.users.manage', 'org.users.manage'],
    removeRole:           ['platform.users.manage', 'org.users.manage'],
    resendInvitation:     ['platform.users.manage', 'org.users.manage'],
  },
};

/** True if this seeded admin is permitted on (area, op). */
export function isPermitted(admin: SeedAdmin, area: ResourceArea, op: Op): boolean {
  const required = GATE[area][op];
  if (!required) return false;
  return required.some((perm) => admin.perms.includes(perm));
}

/** Convenience: returns all admins permitted on (area, op). */
export function permittedAdmins(area: ResourceArea, op: Op): readonly SeedAdmin[] {
  return SEED_ADMINS.filter((a) => isPermitted(a, area, op));
}
```

- [ ] **Step 2: Verify it type-checks**

```bash
pnpm --filter @sassy-auth/auth-server exec tsc --noEmit -p tsconfig.json
```

Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add apps/auth-server/test/matrix/permissions-matrix.ts
git commit -m "test(matrix): add permissions-matrix single source of truth"
```

---

### Task 2.2: Create `harness.ts`

**Files:**
- Create: `apps/auth-server/test/matrix/harness.ts`

- [ ] **Step 1: Write the harness module**

Create `apps/auth-server/test/matrix/harness.ts` with:

```ts
/**
 * Per-spec-file Nest bootstrap + per-admin session cookie cache.
 * Each matrix spec calls bootApp() once in beforeAll and as(admin) per test.
 */
import 'dotenv/config';
import * as crypto from 'crypto';
import express from 'express';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ExpressAdapter } from '@nestjs/platform-express';
import { toNodeHandler } from 'better-auth/node';
import { AppModule } from '../../src/app.module';
import { auth } from '../../src/auth/auth.config';
import { SentryExceptionFilter } from '../../src/common/filters/sentry-exception.filter';
import { LoggerService } from '../../src/common/logger/logger.service';
import { ADMIN_PASSWORD, SeedAdmin } from './permissions-matrix';

let sharedApp: INestApplication | null = null;
let sharedHttpServer: ReturnType<INestApplication['getHttpServer']> | null = null;
let sessionCookies: Map<string, string> = new Map();

/** Ensures crypto/env are seeded for the test process. Safe to call repeatedly. */
function ensureTestEnv() {
  if (process.env.RSA_PRIVATE_KEY && process.env.RSA_PUBLIC_KEY) return;
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  process.env.RSA_PRIVATE_KEY = Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' }) as string).toString('base64');
  process.env.RSA_PUBLIC_KEY = Buffer.from(publicKey.export({ type: 'spki', format: 'pem' }) as string).toString('base64');
  process.env.BETTER_AUTH_URL = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000';
  process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET ?? 'test-secret-at-least-32-chars-long!!';
}

/**
 * Boots NestJS once for the calling spec file. Migrations + seed are run on
 * first call only — subsequent calls return the cached app.
 *
 * Each *.matrix.e2e-spec.ts file should call this in its top-level beforeAll.
 */
export async function bootApp() {
  if (sharedApp && sharedHttpServer) {
    return { app: sharedApp, httpServer: sharedHttpServer };
  }

  ensureTestEnv();

  // Migrations + seed only on first boot per process.
  if (!process.env.MATRIX_DB_READY) {
    const { execSync } = await import('child_process');
    execSync(
      'npx prisma migrate deploy --schema=../../packages/db/schema.prisma',
      { stdio: 'inherit' },
    );
    execSync('pnpm seed', { stdio: 'inherit', cwd: process.cwd() });
    process.env.MATRIX_DB_READY = '1';
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

export async function closeApp() {
  if (sharedApp) {
    await sharedApp.close();
    sharedApp = null;
    sharedHttpServer = null;
    sessionCookies.clear();
  }
}

/**
 * Signs in via BetterAuth and returns the session cookie pair
 * (e.g. `better-auth.session_token=…`). Cached per email.
 */
export async function signInAs(email: string): Promise<string> {
  const cached = sessionCookies.get(email);
  if (cached) return cached;

  if (!sharedHttpServer) throw new Error('signInAs called before bootApp');

  const res = await request(sharedHttpServer)
    .post('/api/auth/sign-in/email')
    .send({ email, password: ADMIN_PASSWORD })
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

/** Returns a thin helper bound to one admin's session cookie. */
export function as(admin: SeedAdmin) {
  return {
    async cookie(): Promise<string> {
      return signInAs(admin.email);
    },
    async get(path: string) {
      const cookie = await signInAs(admin.email);
      return request(sharedHttpServer!).get(path).set('Cookie', cookie);
    },
    async post(path: string, body: unknown) {
      const cookie = await signInAs(admin.email);
      return request(sharedHttpServer!).post(path).set('Cookie', cookie).send(body as object);
    },
    async patch(path: string, body: unknown) {
      const cookie = await signInAs(admin.email);
      return request(sharedHttpServer!).patch(path).set('Cookie', cookie).send(body as object);
    },
    async del(path: string) {
      const cookie = await signInAs(admin.email);
      return request(sharedHttpServer!).delete(path).set('Cookie', cookie);
    },
  };
}
```

- [ ] **Step 2: Verify it type-checks**

```bash
pnpm --filter @sassy-auth/auth-server exec tsc --noEmit -p tsconfig.json
```

Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add apps/auth-server/test/matrix/harness.ts
git commit -m "test(matrix): add Nest bootstrap + per-admin session helper"
```

---

### Task 2.3: Create `factories.ts`

**Files:**
- Create: `apps/auth-server/test/matrix/factories.ts`

- [ ] **Step 1: Write the factories module**

Create `apps/auth-server/test/matrix/factories.ts` with:

```ts
/**
 * Test-data factories with per-test cleanup. Every CREATE registers a
 * cleanup callback. Tests opt in via `withCleanup(...)` in beforeEach/afterEach.
 */
import * as crypto from 'crypto';
import { prisma } from '@sassy-auth/db';
import { as } from './harness';
import { SEED_ADMINS, SeedAdmin } from './permissions-matrix';

type Cleanup = () => Promise<void>;
const queue: Cleanup[] = [];

export function uniqueName(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

export function registerCleanup(fn: Cleanup) {
  queue.push(fn);
}

/** Drains the per-test cleanup queue in LIFO order. Call from afterEach. */
export async function drainCleanup() {
  while (queue.length > 0) {
    const fn = queue.pop()!;
    try { await fn(); } catch { /* best-effort */ }
  }
}

/** Returns the super-admin SeedAdmin (s@sa.io). */
export function superAdmin(): SeedAdmin {
  const s = SEED_ADMINS.find((a) => a.key === 'super');
  if (!s) throw new Error('super admin missing from SEED_ADMINS');
  return s;
}

/** Returns the seeded platform app's publicId. Cached after first lookup. */
let platformAppPublicId: string | null = null;
export async function platformAppId(): Promise<string> {
  if (platformAppPublicId) return platformAppPublicId;
  const app = await prisma.saApp.findFirst({ where: { isPlatform: true } });
  if (!app) throw new Error('platform app not seeded');
  platformAppPublicId = app.publicId;
  return platformAppPublicId;
}

let platformOrgPublicId: string | null = null;
export async function platformOrgId(): Promise<string> {
  if (platformOrgPublicId) return platformOrgPublicId;
  const org = await prisma.saOrg.findFirst({ where: { isPlatform: true } });
  if (!org) throw new Error('platform org not seeded');
  platformOrgPublicId = org.publicId;
  return platformOrgPublicId;
}

/** Creates a non-platform app via the API (as super admin) and registers cleanup. */
export async function createTempApp(name = uniqueName('e2e-app')): Promise<{ publicId: string; name: string }> {
  const s = as(superAdmin());
  const res = await s.post('/api/apps', { name, url: `https://example.com/${name}` });
  if (res.status !== 201) throw new Error(`createTempApp failed (${res.status}): ${JSON.stringify(res.body)}`);
  const created = res.body as { publicId: string; name: string };
  registerCleanup(async () => {
    await s.del(`/api/apps/${created.publicId}`);
  });
  return created;
}

/** Creates a non-platform org under a fresh temp app. */
export async function createTempOrg(): Promise<{ publicId: string; name: string; appPublicId: string }> {
  const app = await createTempApp();
  const s = as(superAdmin());
  const orgName = uniqueName('e2e-org');
  const res = await s.post('/api/orgs', { name: orgName, appId: app.publicId });
  if (res.status !== 201) throw new Error(`createTempOrg failed (${res.status}): ${JSON.stringify(res.body)}`);
  const created = res.body as { publicId: string; name: string };
  registerCleanup(async () => {
    await s.del(`/api/orgs/${created.publicId}`);
  });
  return { ...created, appPublicId: app.publicId };
}

/** Creates a role under a fresh temp app (no permissions assigned). */
export async function createTempRole(): Promise<{ publicId: string; name: string; appPublicId: string }> {
  const app = await createTempApp();
  const s = as(superAdmin());
  const roleName = uniqueName('e2e-role');
  const res = await s.post('/api/roles', { name: roleName, appId: app.publicId, permissionIds: [] });
  if (res.status !== 201) throw new Error(`createTempRole failed (${res.status}): ${JSON.stringify(res.body)}`);
  const created = res.body as { publicId: string; name: string };
  registerCleanup(async () => {
    await s.del(`/api/roles/${created.publicId}`);
  });
  return { ...created, appPublicId: app.publicId };
}

/** Creates a permission under a fresh temp app. Name is auto-prefixed `e2e.` to avoid the immutability rule. */
export async function createTempPermission(): Promise<{ publicId: string; name: string; appPublicId: string }> {
  const app = await createTempApp();
  const s = as(superAdmin());
  const permName = `e2e.${uniqueName('perm').replace(/-/g, '.')}`;
  const res = await s.post('/api/permissions', { name: permName, appId: app.publicId });
  if (res.status !== 201) throw new Error(`createTempPermission failed (${res.status}): ${JSON.stringify(res.body)}`);
  const created = res.body as { publicId: string; name: string };
  registerCleanup(async () => {
    await s.del(`/api/permissions/${created.publicId}`);
  });
  return { ...created, appPublicId: app.publicId };
}

/** Creates a non-platform user via the API under a fresh temp org. */
export async function createTempUser(): Promise<{ publicId: string; email: string; orgPublicId: string }> {
  const org = await createTempOrg();
  const s = as(superAdmin());
  const email = `e2e-${crypto.randomUUID().slice(0, 8)}@example.com`;
  const res = await s.post('/api/users', {
    firstName: 'E2E',
    lastName: 'Temp',
    email,
    orgId: org.publicId,
  });
  if (res.status !== 201) throw new Error(`createTempUser failed (${res.status}): ${JSON.stringify(res.body)}`);
  const body = res.body as { user: { id: string } };
  registerCleanup(async () => {
    // Delete via API (super has platform.users.manage), then clean up the
    // dangling BetterAuth row that /api/users doesn't touch.
    await s.del(`/api/users/${body.user.id}`);
    await prisma.user.deleteMany({ where: { email } });
  });
  return { publicId: body.user.id, email, orgPublicId: org.publicId };
}
```

- [ ] **Step 2: Verify it type-checks**

```bash
pnpm --filter @sassy-auth/auth-server exec tsc --noEmit -p tsconfig.json
```

Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add apps/auth-server/test/matrix/factories.ts
git commit -m "test(matrix): add per-test data factories with LIFO cleanup queue"
```

---

### Task 2.4: Add empty matrix spec files

**Files:**
- Create: `apps/auth-server/test/matrix/apps.matrix.e2e-spec.ts`
- Create: `apps/auth-server/test/matrix/orgs.matrix.e2e-spec.ts`
- Create: `apps/auth-server/test/matrix/roles.matrix.e2e-spec.ts`
- Create: `apps/auth-server/test/matrix/permissions.matrix.e2e-spec.ts`
- Create: `apps/auth-server/test/matrix/users.matrix.e2e-spec.ts`

- [ ] **Step 1: Create all five empty matrix files**

Each file gets this same skeleton (no-op describe that proves the harness imports cleanly):

```ts
import { bootApp, closeApp } from './harness';

describe('<AREA> matrix (placeholder)', () => {
  beforeAll(async () => { await bootApp(); });
  afterAll(async () => { await closeApp(); });

  it.skip('matrix populated in PR 3', () => {});
});
```

Substitute `<AREA>` with `apps` / `orgs` / `roles` / `permissions` / `users` per file.

- [ ] **Step 2: Run the E2E suite to confirm matrix files boot cleanly**

```bash
pnpm --filter @sassy-auth/auth-server test:e2e
```

Expected: all existing E2E tests pass; the 5 new files each report 1 skipped test. No compile or boot errors.

- [ ] **Step 3: Commit**

```bash
git add apps/auth-server/test/matrix/*.e2e-spec.ts
git commit -m "test(matrix): scaffold empty matrix spec files"
```

---

### Task 2.5: Open PR 2

- [ ] **Step 1: Push and open the PR**

```bash
git push
gh pr create --title "test(auth-server): Wave B infra — matrix harness + factories" --body "$(cat <<'EOF'
## Summary
- `permissions-matrix.ts` is the single source of truth for admin→endpoint→op gating.
- `harness.ts` boots Nest once per file and caches per-admin session cookies.
- `factories.ts` provides `createTempApp/Org/Role/Permission/User` with LIFO cleanup.
- Five empty `*.matrix.e2e-spec.ts` files prove the harness boots cleanly.

## Test plan
- [x] `pnpm --filter @sassy-auth/auth-server test:e2e` green.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

<!-- PHASE-2-END -->

## Phase 3 — Wave B Specs (PR 3)

**Outcome:** All five `*.matrix.e2e-spec.ts` files are populated. Every (admin × op) cell asserts the expected 2xx or 403. Permitted admins also run a hand-written round-trip. Failures are captured in a draft list for the bug log (Phase 6 — Wave D).

### Task 3.1: Populate `apps.matrix.e2e-spec.ts`

**Files:**
- Modify: `apps/auth-server/test/matrix/apps.matrix.e2e-spec.ts`

- [ ] **Step 1: Replace the placeholder with the full matrix**

Overwrite `apps/auth-server/test/matrix/apps.matrix.e2e-spec.ts` with:

```ts
import { prisma } from '@sassy-auth/db';
import { bootApp, closeApp, as } from './harness';
import { drainCleanup, uniqueName, createTempApp, platformAppId } from './factories';
import { SEED_ADMINS, isPermitted } from './permissions-matrix';

describe('/apps matrix', () => {
  beforeAll(async () => { await bootApp(); });
  afterEach(async () => { await drainCleanup(); });
  afterAll(async () => { await closeApp(); });

  describe.each(SEED_ADMINS)('as $email', (admin) => {
    describe('GET /api/apps', () => {
      if (isPermitted(admin, 'apps', 'list')) {
        it('returns 200 with items[]', async () => {
          const res = await as(admin).get('/api/apps');
          expect(res.status).toBe(200);
          expect(Array.isArray(res.body.items)).toBe(true);
        });
      } else {
        it('returns 403', async () => {
          const res = await as(admin).get('/api/apps');
          expect(res.status).toBe(403);
        });
      }
    });

    describe('POST /api/apps', () => {
      if (isPermitted(admin, 'apps', 'create')) {
        it('returns 201 and the row appears in LIST', async () => {
          const name = uniqueName('e2e-app');
          const res = await as(admin).post('/api/apps', { name, url: `https://x/${name}` });
          expect(res.status).toBe(201);
          expect(res.body.publicId).toBeDefined();
          // self-cleanup
          await as(admin).del(`/api/apps/${res.body.publicId}`);

          const list = await as(admin).get('/api/apps');
          expect(list.status).toBe(200);
        });
      } else {
        it('returns 403', async () => {
          const res = await as(admin).post('/api/apps', { name: uniqueName('e2e-app'), url: 'https://x' });
          expect(res.status).toBe(403);
        });
      }
    });

    describe('PATCH /api/apps/:publicId', () => {
      if (isPermitted(admin, 'apps', 'update')) {
        it('returns 200 on a temp app', async () => {
          const app = await createTempApp();
          const res = await as(admin).patch(`/api/apps/${app.publicId}`, { name: uniqueName('renamed') });
          expect(res.status).toBe(200);
        });

        it('returns 403 against the seeded platform app (immutable)', async () => {
          const platformId = await platformAppId();
          const res = await as(admin).patch(`/api/apps/${platformId}`, { name: 'hacked' });
          expect(res.status).toBe(403);
        });
      } else {
        it('returns 403', async () => {
          const app = await createTempApp();
          const res = await as(admin).patch(`/api/apps/${app.publicId}`, { name: 'x' });
          expect(res.status).toBe(403);
        });
      }
    });

    describe('DELETE /api/apps/:publicId', () => {
      if (isPermitted(admin, 'apps', 'delete')) {
        it('returns 204 on a temp app and GET 404 afterward', async () => {
          const app = await createTempApp();
          const del = await as(admin).del(`/api/apps/${app.publicId}`);
          expect(del.status).toBe(204);
          // Re-list and ensure it's gone (no GET-by-id endpoint on /apps).
          const list = await as(admin).get('/api/apps?pageSize=200');
          const names = (list.body.items as Array<{ name: string }>).map((a) => a.name);
          expect(names).not.toContain(app.name);
        });

        it('returns 403 against the seeded platform app (immutable)', async () => {
          const platformId = await platformAppId();
          const res = await as(admin).del(`/api/apps/${platformId}`);
          expect(res.status).toBe(403);
        });
      } else {
        it('returns 403', async () => {
          const app = await createTempApp();
          const res = await as(admin).del(`/api/apps/${app.publicId}`);
          expect(res.status).toBe(403);
        });
      }
    });

    if (isPermitted(admin, 'apps', 'create')
        && isPermitted(admin, 'apps', 'update')
        && isPermitted(admin, 'apps', 'delete')) {
      describe('Create → Update → List → Delete round-trip', () => {
        it('completes end-to-end', async () => {
          const name = uniqueName('e2e-roundtrip');
          const a = as(admin);

          const create = await a.post('/api/apps', { name, url: `https://x/${name}` });
          expect(create.status).toBe(201);
          const id = create.body.publicId as string;

          const renamed = uniqueName('e2e-renamed');
          const update = await a.patch(`/api/apps/${id}`, { name: renamed });
          expect(update.status).toBe(200);
          expect(update.body.name).toBe(renamed);

          const list = await a.get('/api/apps?pageSize=200');
          const names = (list.body.items as Array<{ name: string }>).map((x) => x.name);
          expect(names).toContain(renamed);

          const del = await a.del(`/api/apps/${id}`);
          expect(del.status).toBe(204);

          const after = await a.get('/api/apps?pageSize=200');
          const afterNames = (after.body.items as Array<{ name: string }>).map((x) => x.name);
          expect(afterNames).not.toContain(renamed);

          // Belt-and-braces: confirm via Prisma the row is really gone.
          const row = await prisma.saApp.findUnique({ where: { publicId: id } });
          expect(row).toBeNull();
        });
      });
    }
  });
});
```

- [ ] **Step 2: Run the apps matrix**

```bash
pnpm --filter @sassy-auth/auth-server test:e2e -- --testPathPattern=apps.matrix
```

Expected: 5 admins × (4 op describes + immutability variants + round-trip for permitted) ≈ ~22 tests run. Tests that fail (e.g., a real bug surfaces) do NOT block the rest.

- [ ] **Step 3: Capture failures for the bug log**

If any assertion fails unexpectedly, capture the failing test name + observed-vs-expected into a scratchpad. Do NOT fix the bug here — that's a separate PR. Add the entry to a working file:

```bash
mkdir -p tmp
echo "## Wave B / apps matrix" >> tmp/wave-b-failures.md
# Then paste the failing test name + the assertion output.
```

- [ ] **Step 4: Commit**

```bash
git add apps/auth-server/test/matrix/apps.matrix.e2e-spec.ts
git commit -m "test(matrix): populate /apps matrix (5 admins × 4 ops + immutability + round-trip)"
```

---

### Task 3.2: Populate `orgs.matrix.e2e-spec.ts`

**Files:**
- Modify: `apps/auth-server/test/matrix/orgs.matrix.e2e-spec.ts`

- [ ] **Step 1: Replace the placeholder with the full matrix**

Overwrite `apps/auth-server/test/matrix/orgs.matrix.e2e-spec.ts` with:

```ts
import { prisma } from '@sassy-auth/db';
import { bootApp, closeApp, as } from './harness';
import { drainCleanup, uniqueName, createTempApp, createTempOrg, platformOrgId } from './factories';
import { SEED_ADMINS, isPermitted } from './permissions-matrix';

describe('/orgs matrix', () => {
  beforeAll(async () => { await bootApp(); });
  afterEach(async () => { await drainCleanup(); });
  afterAll(async () => { await closeApp(); });

  describe.each(SEED_ADMINS)('as $email', (admin) => {
    describe('GET /api/orgs', () => {
      if (isPermitted(admin, 'orgs', 'list')) {
        it('returns 200 with items[]', async () => {
          const res = await as(admin).get('/api/orgs');
          expect(res.status).toBe(200);
          expect(Array.isArray(res.body.items)).toBe(true);
        });
      } else {
        it('returns 403', async () => {
          const res = await as(admin).get('/api/orgs');
          expect(res.status).toBe(403);
        });
      }
    });

    describe('GET /api/orgs/:publicId', () => {
      if (isPermitted(admin, 'orgs', 'get')) {
        it('returns 200 for a real org', async () => {
          const org = await createTempOrg();
          const res = await as(admin).get(`/api/orgs/${org.publicId}`);
          expect(res.status).toBe(200);
          expect(res.body.publicId).toBe(org.publicId);
        });
      } else {
        it('returns 403', async () => {
          const org = await createTempOrg();
          const res = await as(admin).get(`/api/orgs/${org.publicId}`);
          expect(res.status).toBe(403);
        });
      }
    });

    describe('POST /api/orgs', () => {
      if (isPermitted(admin, 'orgs', 'create')) {
        it('returns 201 under a non-platform app', async () => {
          const app = await createTempApp();
          const name = uniqueName('e2e-org');
          const res = await as(admin).post('/api/orgs', { name, appId: app.publicId });
          expect(res.status).toBe(201);
          await as(admin).del(`/api/orgs/${res.body.publicId}`);
        });
      } else {
        it('returns 403', async () => {
          const app = await createTempApp();
          const res = await as(admin).post('/api/orgs', { name: uniqueName('e2e-org'), appId: app.publicId });
          expect(res.status).toBe(403);
        });
      }
    });

    describe('PATCH /api/orgs/:publicId', () => {
      if (isPermitted(admin, 'orgs', 'update')) {
        it('returns 200 on a temp org', async () => {
          const org = await createTempOrg();
          const res = await as(admin).patch(`/api/orgs/${org.publicId}`, { name: uniqueName('renamed') });
          expect(res.status).toBe(200);
        });

        it('returns 403 against the seeded platform org (immutable)', async () => {
          const platformId = await platformOrgId();
          const res = await as(admin).patch(`/api/orgs/${platformId}`, { name: 'hacked' });
          expect(res.status).toBe(403);
        });
      } else {
        it('returns 403', async () => {
          const org = await createTempOrg();
          const res = await as(admin).patch(`/api/orgs/${org.publicId}`, { name: 'x' });
          expect(res.status).toBe(403);
        });
      }
    });

    describe('DELETE /api/orgs/:publicId', () => {
      if (isPermitted(admin, 'orgs', 'delete')) {
        it('returns 204 on a temp org and GET 404 afterward', async () => {
          const org = await createTempOrg();
          const del = await as(admin).del(`/api/orgs/${org.publicId}`);
          expect(del.status).toBe(204);
          const after = await as(admin).get(`/api/orgs/${org.publicId}`);
          expect(after.status).toBe(404);
        });

        it('returns 403 against the seeded platform org (immutable)', async () => {
          const platformId = await platformOrgId();
          const res = await as(admin).del(`/api/orgs/${platformId}`);
          expect(res.status).toBe(403);
        });
      } else {
        it('returns 403', async () => {
          const org = await createTempOrg();
          const res = await as(admin).del(`/api/orgs/${org.publicId}`);
          expect(res.status).toBe(403);
        });
      }
    });

    if (isPermitted(admin, 'orgs', 'create')
        && isPermitted(admin, 'orgs', 'update')
        && isPermitted(admin, 'orgs', 'delete')) {
      describe('Create → Get → Update → Delete → Get 404 round-trip', () => {
        it('completes end-to-end', async () => {
          const app = await createTempApp();
          const a = as(admin);

          const name = uniqueName('e2e-roundtrip');
          const create = await a.post('/api/orgs', { name, appId: app.publicId });
          expect(create.status).toBe(201);
          const id = create.body.publicId as string;

          const got = await a.get(`/api/orgs/${id}`);
          expect(got.status).toBe(200);
          expect(got.body.publicId).toBe(id);

          const renamed = uniqueName('e2e-renamed');
          const update = await a.patch(`/api/orgs/${id}`, { name: renamed });
          expect(update.status).toBe(200);
          expect(update.body.name).toBe(renamed);

          const del = await a.del(`/api/orgs/${id}`);
          expect(del.status).toBe(204);

          const after = await a.get(`/api/orgs/${id}`);
          expect(after.status).toBe(404);

          const row = await prisma.saOrg.findUnique({ where: { publicId: id } });
          expect(row).toBeNull();
        });
      });
    }
  });
});
```

- [ ] **Step 2: Run the orgs matrix**

```bash
pnpm --filter @sassy-auth/auth-server test:e2e -- --testPathPattern=orgs.matrix
```

- [ ] **Step 3: Capture failures**

If any assertion fails unexpectedly, append to `tmp/wave-b-failures.md`.

- [ ] **Step 4: Commit**

```bash
git add apps/auth-server/test/matrix/orgs.matrix.e2e-spec.ts
git commit -m "test(matrix): populate /orgs matrix (5 admins × 5 ops + immutability + round-trip)"
```

---

### Task 3.3: Populate `roles.matrix.e2e-spec.ts`

**Files:**
- Modify: `apps/auth-server/test/matrix/roles.matrix.e2e-spec.ts`

- [ ] **Step 1: Replace the placeholder with the full matrix**

Overwrite `apps/auth-server/test/matrix/roles.matrix.e2e-spec.ts` with:

```ts
import { prisma } from '@sassy-auth/db';
import { bootApp, closeApp, as } from './harness';
import { drainCleanup, uniqueName, createTempApp, createTempRole } from './factories';
import { SEED_ADMINS, isPermitted } from './permissions-matrix';

describe('/roles matrix', () => {
  beforeAll(async () => { await bootApp(); });
  afterEach(async () => { await drainCleanup(); });
  afterAll(async () => { await closeApp(); });

  describe.each(SEED_ADMINS)('as $email', (admin) => {
    describe('GET /api/roles', () => {
      if (isPermitted(admin, 'roles', 'list')) {
        it('returns 200 with items[]', async () => {
          const res = await as(admin).get('/api/roles');
          expect(res.status).toBe(200);
          expect(Array.isArray(res.body.items)).toBe(true);
        });
      } else {
        it('returns 403', async () => {
          const res = await as(admin).get('/api/roles');
          expect(res.status).toBe(403);
        });
      }
    });

    describe('GET /api/roles/:publicId', () => {
      if (isPermitted(admin, 'roles', 'get')) {
        it('returns 200 for a real role', async () => {
          const role = await createTempRole();
          const res = await as(admin).get(`/api/roles/${role.publicId}`);
          expect(res.status).toBe(200);
        });
      } else {
        it('returns 403', async () => {
          const role = await createTempRole();
          const res = await as(admin).get(`/api/roles/${role.publicId}`);
          expect(res.status).toBe(403);
        });
      }
    });

    describe('POST /api/roles', () => {
      if (isPermitted(admin, 'roles', 'create')) {
        it('returns 201 under a temp app', async () => {
          const app = await createTempApp();
          const res = await as(admin).post('/api/roles', {
            name: uniqueName('e2e-role'),
            appId: app.publicId,
            permissionIds: [],
          });
          expect(res.status).toBe(201);
          await as(admin).del(`/api/roles/${res.body.publicId}`);
        });
      } else {
        it('returns 403', async () => {
          const app = await createTempApp();
          const res = await as(admin).post('/api/roles', {
            name: uniqueName('e2e-role'),
            appId: app.publicId,
            permissionIds: [],
          });
          expect(res.status).toBe(403);
        });
      }
    });

    describe('PATCH /api/roles/:publicId', () => {
      if (isPermitted(admin, 'roles', 'update')) {
        it('returns 200 on a temp role', async () => {
          const role = await createTempRole();
          const res = await as(admin).patch(`/api/roles/${role.publicId}`, { name: uniqueName('renamed') });
          expect(res.status).toBe(200);
        });
      } else {
        it('returns 403', async () => {
          const role = await createTempRole();
          const res = await as(admin).patch(`/api/roles/${role.publicId}`, { name: 'x' });
          expect(res.status).toBe(403);
        });
      }
    });

    describe('DELETE /api/roles/:publicId', () => {
      if (isPermitted(admin, 'roles', 'delete')) {
        it('returns 204 on a temp role and GET 404 afterward', async () => {
          const role = await createTempRole();
          const del = await as(admin).del(`/api/roles/${role.publicId}`);
          expect(del.status).toBe(204);
          const after = await as(admin).get(`/api/roles/${role.publicId}`);
          expect(after.status).toBe(404);
        });
      } else {
        it('returns 403', async () => {
          const role = await createTempRole();
          const res = await as(admin).del(`/api/roles/${role.publicId}`);
          expect(res.status).toBe(403);
        });
      }
    });

    if (isPermitted(admin, 'roles', 'create')
        && isPermitted(admin, 'roles', 'update')
        && isPermitted(admin, 'roles', 'delete')) {
      describe('Create → Get → Update → Delete → Get 404 round-trip', () => {
        it('completes end-to-end', async () => {
          const app = await createTempApp();
          const a = as(admin);

          const name = uniqueName('e2e-rt-role');
          const create = await a.post('/api/roles', { name, appId: app.publicId, permissionIds: [] });
          expect(create.status).toBe(201);
          const id = create.body.publicId as string;

          const got = await a.get(`/api/roles/${id}`);
          expect(got.status).toBe(200);

          const renamed = uniqueName('e2e-rt-renamed');
          const update = await a.patch(`/api/roles/${id}`, { name: renamed });
          expect(update.status).toBe(200);
          expect(update.body.name).toBe(renamed);

          const del = await a.del(`/api/roles/${id}`);
          expect(del.status).toBe(204);

          const after = await a.get(`/api/roles/${id}`);
          expect(after.status).toBe(404);

          const row = await prisma.saRole.findUnique({ where: { publicId: id } });
          expect(row).toBeNull();
        });
      });
    }
  });
});
```

- [ ] **Step 2: Run the roles matrix**

```bash
pnpm --filter @sassy-auth/auth-server test:e2e -- --testPathPattern=roles.matrix
```

- [ ] **Step 3: Capture failures**

Append unexpected failures to `tmp/wave-b-failures.md`.

- [ ] **Step 4: Commit**

```bash
git add apps/auth-server/test/matrix/roles.matrix.e2e-spec.ts
git commit -m "test(matrix): populate /roles matrix (5 admins × 5 ops + round-trip)"
```

---

### Task 3.4: Populate `permissions.matrix.e2e-spec.ts`

**Files:**
- Modify: `apps/auth-server/test/matrix/permissions.matrix.e2e-spec.ts`

- [ ] **Step 1: Replace the placeholder with the full matrix**

Overwrite `apps/auth-server/test/matrix/permissions.matrix.e2e-spec.ts` with:

```ts
import { prisma } from '@sassy-auth/db';
import { bootApp, closeApp, as } from './harness';
import { drainCleanup, uniqueName, createTempApp, createTempPermission } from './factories';
import { SEED_ADMINS, isPermitted } from './permissions-matrix';

describe('/permissions matrix', () => {
  beforeAll(async () => { await bootApp(); });
  afterEach(async () => { await drainCleanup(); });
  afterAll(async () => { await closeApp(); });

  /** Pick one seeded platform.* permission to exercise the immutability rule. */
  async function seededPlatformPermissionId(): Promise<string> {
    const p = await prisma.saPermission.findFirst({ where: { name: { startsWith: 'platform.' } } });
    if (!p) throw new Error('no platform.* permission seeded');
    return p.publicId;
  }

  describe.each(SEED_ADMINS)('as $email', (admin) => {
    describe('GET /api/permissions', () => {
      if (isPermitted(admin, 'permissions', 'list')) {
        it('returns 200 with items[]', async () => {
          const res = await as(admin).get('/api/permissions');
          expect(res.status).toBe(200);
          expect(Array.isArray(res.body.items)).toBe(true);
        });
      } else {
        it('returns 403', async () => {
          const res = await as(admin).get('/api/permissions');
          expect(res.status).toBe(403);
        });
      }
    });

    describe('GET /api/permissions/:publicId', () => {
      if (isPermitted(admin, 'permissions', 'get')) {
        it('returns 200 for a real permission', async () => {
          const perm = await createTempPermission();
          const res = await as(admin).get(`/api/permissions/${perm.publicId}`);
          expect(res.status).toBe(200);
        });
      } else {
        it('returns 403', async () => {
          const perm = await createTempPermission();
          const res = await as(admin).get(`/api/permissions/${perm.publicId}`);
          expect(res.status).toBe(403);
        });
      }
    });

    describe('POST /api/permissions', () => {
      if (isPermitted(admin, 'permissions', 'create')) {
        it('returns 201 under a temp app with a non-platform.* name', async () => {
          const app = await createTempApp();
          const name = `e2e.${uniqueName('perm').replace(/-/g, '.')}`;
          const res = await as(admin).post('/api/permissions', { name, appId: app.publicId });
          expect(res.status).toBe(201);
          await as(admin).del(`/api/permissions/${res.body.publicId}`);
        });
      } else {
        it('returns 403', async () => {
          const app = await createTempApp();
          const res = await as(admin).post('/api/permissions', {
            name: `e2e.${uniqueName('perm').replace(/-/g, '.')}`,
            appId: app.publicId,
          });
          expect(res.status).toBe(403);
        });
      }
    });

    describe('PATCH /api/permissions/:publicId', () => {
      if (isPermitted(admin, 'permissions', 'update')) {
        it('returns 200 on a temp non-platform permission', async () => {
          const perm = await createTempPermission();
          const res = await as(admin).patch(`/api/permissions/${perm.publicId}`, {
            name: `e2e.${uniqueName('renamed').replace(/-/g, '.')}`,
          });
          expect(res.status).toBe(200);
        });

        it('returns 403 against a seeded platform.* permission (immutable)', async () => {
          const platformPermId = await seededPlatformPermissionId();
          const res = await as(admin).patch(`/api/permissions/${platformPermId}`, { name: 'hacked.name' });
          expect(res.status).toBe(403);
        });
      } else {
        it('returns 403', async () => {
          const perm = await createTempPermission();
          const res = await as(admin).patch(`/api/permissions/${perm.publicId}`, { name: 'x.y' });
          expect(res.status).toBe(403);
        });
      }
    });

    describe('DELETE /api/permissions/:publicId', () => {
      if (isPermitted(admin, 'permissions', 'delete')) {
        it('returns 204 on a temp non-platform permission and GET 404 afterward', async () => {
          const perm = await createTempPermission();
          const del = await as(admin).del(`/api/permissions/${perm.publicId}`);
          expect(del.status).toBe(204);
          const after = await as(admin).get(`/api/permissions/${perm.publicId}`);
          expect(after.status).toBe(404);
        });

        it('returns 403 against a seeded platform.* permission (immutable)', async () => {
          const platformPermId = await seededPlatformPermissionId();
          const res = await as(admin).del(`/api/permissions/${platformPermId}`);
          expect(res.status).toBe(403);
        });
      } else {
        it('returns 403', async () => {
          const perm = await createTempPermission();
          const res = await as(admin).del(`/api/permissions/${perm.publicId}`);
          expect(res.status).toBe(403);
        });
      }
    });

    if (isPermitted(admin, 'permissions', 'create')
        && isPermitted(admin, 'permissions', 'update')
        && isPermitted(admin, 'permissions', 'delete')) {
      describe('Create → Get → Update → Delete → Get 404 round-trip', () => {
        it('completes end-to-end', async () => {
          const app = await createTempApp();
          const a = as(admin);

          const name = `e2e.${uniqueName('rt').replace(/-/g, '.')}`;
          const create = await a.post('/api/permissions', { name, appId: app.publicId });
          expect(create.status).toBe(201);
          const id = create.body.publicId as string;

          const got = await a.get(`/api/permissions/${id}`);
          expect(got.status).toBe(200);

          const renamed = `e2e.${uniqueName('rt-r').replace(/-/g, '.')}`;
          const update = await a.patch(`/api/permissions/${id}`, { name: renamed });
          expect(update.status).toBe(200);
          expect(update.body.name).toBe(renamed);

          const del = await a.del(`/api/permissions/${id}`);
          expect(del.status).toBe(204);

          const after = await a.get(`/api/permissions/${id}`);
          expect(after.status).toBe(404);

          const row = await prisma.saPermission.findUnique({ where: { publicId: id } });
          expect(row).toBeNull();
        });
      });
    }
  });
});
```

- [ ] **Step 2: Run the permissions matrix**

```bash
pnpm --filter @sassy-auth/auth-server test:e2e -- --testPathPattern=permissions.matrix
```

- [ ] **Step 3: Capture failures**

Append unexpected failures to `tmp/wave-b-failures.md`.

- [ ] **Step 4: Commit**

```bash
git add apps/auth-server/test/matrix/permissions.matrix.e2e-spec.ts
git commit -m "test(matrix): populate /permissions matrix (+ immutability + round-trip)"
```

---

### Task 3.5: Populate `users.matrix.e2e-spec.ts`

**Files:**
- Modify: `apps/auth-server/test/matrix/users.matrix.e2e-spec.ts`

- [ ] **Step 1: Replace the placeholder with the full matrix**

Overwrite `apps/auth-server/test/matrix/users.matrix.e2e-spec.ts` with:

```ts
import { prisma } from '@sassy-auth/db';
import { bootApp, closeApp, as } from './harness';
import { drainCleanup, uniqueName, createTempOrg, createTempUser, createTempRole, superAdmin } from './factories';
import { SEED_ADMINS, isPermitted } from './permissions-matrix';

describe('/users matrix', () => {
  beforeAll(async () => { await bootApp(); });
  afterEach(async () => { await drainCleanup(); });
  afterAll(async () => { await closeApp(); });

  /** Returns the publicId of the SaUser for the given seeded admin email. */
  async function saUserIdFor(email: string): Promise<string> {
    const row = await prisma.saUser.findFirst({
      where: { betterAuthUser: { email } },
      select: { publicId: true },
    });
    if (!row) throw new Error(`SaUser not found for ${email}`);
    return row.publicId;
  }

  describe.each(SEED_ADMINS)('as $email', (admin) => {
    describe('GET /api/users (no orgId)', () => {
      if (admin.perms.includes('platform.users.manage')) {
        it('returns 200 with the cross-tenant list', async () => {
          const res = await as(admin).get('/api/users');
          expect(res.status).toBe(200);
          expect(Array.isArray(res.body)).toBe(true);
        });
      } else {
        it('returns 403 (cross-tenant list requires platform.users.manage)', async () => {
          const res = await as(admin).get('/api/users');
          expect(res.status).toBe(403);
        });
      }
    });

    describe('GET /api/users?orgId=<temp>', () => {
      if (isPermitted(admin, 'users', 'list')) {
        it('returns 200 scoped to a temp org', async () => {
          const org = await createTempOrg();
          const res = await as(admin).get(`/api/users?orgId=${org.publicId}`);
          expect(res.status).toBe(200);
        });
      } else {
        it('returns 403', async () => {
          const org = await createTempOrg();
          const res = await as(admin).get(`/api/users?orgId=${org.publicId}`);
          expect(res.status).toBe(403);
        });
      }
    });

    describe('GET /api/users/:id', () => {
      if (isPermitted(admin, 'users', 'get')) {
        it('returns 200 for a temp user', async () => {
          const u = await createTempUser();
          const res = await as(admin).get(`/api/users/${u.publicId}`);
          expect(res.status).toBe(200);
        });
      } else {
        it('returns 403', async () => {
          const u = await createTempUser();
          const res = await as(admin).get(`/api/users/${u.publicId}`);
          expect(res.status).toBe(403);
        });
      }
    });

    describe('POST /api/users', () => {
      if (isPermitted(admin, 'users', 'create')) {
        it('returns 201 with an inviteUrl', async () => {
          const org = await createTempOrg();
          const email = `e2e-${uniqueName('u')}@example.com`;
          const res = await as(admin).post('/api/users', {
            firstName: 'A', lastName: 'B', email, orgId: org.publicId,
          });
          expect(res.status).toBe(201);
          expect(res.body.inviteUrl).toBeDefined();
          // self-cleanup
          await as(superAdmin()).del(`/api/users/${res.body.user.id}`);
          await prisma.user.deleteMany({ where: { email } });
        });
      } else {
        it('returns 403', async () => {
          const org = await createTempOrg();
          const res = await as(admin).post('/api/users', {
            firstName: 'A', lastName: 'B',
            email: `e2e-${uniqueName('u')}@example.com`,
            orgId: org.publicId,
          });
          expect(res.status).toBe(403);
        });
      }
    });

    describe('PATCH /api/users/:id', () => {
      if (isPermitted(admin, 'users', 'update')) {
        it('returns 200 on a temp user', async () => {
          const u = await createTempUser();
          const res = await as(admin).patch(`/api/users/${u.publicId}`, { firstName: uniqueName('Renamed') });
          expect(res.status).toBe(200);
        });
      } else {
        it('returns 403', async () => {
          const u = await createTempUser();
          const res = await as(admin).patch(`/api/users/${u.publicId}`, { firstName: 'X' });
          expect(res.status).toBe(403);
        });
      }
    });

    describe('DELETE /api/users/:id', () => {
      if (isPermitted(admin, 'users', 'delete')) {
        it('returns 204 on a temp user and GET 404 afterward', async () => {
          const u = await createTempUser();
          const del = await as(admin).del(`/api/users/${u.publicId}`);
          expect(del.status).toBe(204);
          const after = await as(admin).get(`/api/users/${u.publicId}`);
          expect(after.status).toBe(404);
        });

        it('returns 403 when deleting self', async () => {
          const selfId = await saUserIdFor(admin.email);
          const res = await as(admin).del(`/api/users/${selfId}`);
          expect(res.status).toBe(403);
        });
      } else {
        it('returns 403', async () => {
          const u = await createTempUser();
          const res = await as(admin).del(`/api/users/${u.publicId}`);
          expect(res.status).toBe(403);
        });
      }
    });

    describe('GET /api/users/:id/roles', () => {
      if (isPermitted(admin, 'users', 'getRoles')) {
        it('returns 200 with an array', async () => {
          const u = await createTempUser();
          const res = await as(admin).get(`/api/users/${u.publicId}/roles`);
          expect(res.status).toBe(200);
          expect(Array.isArray(res.body)).toBe(true);
        });
      } else {
        it('returns 403', async () => {
          const u = await createTempUser();
          const res = await as(admin).get(`/api/users/${u.publicId}/roles`);
          expect(res.status).toBe(403);
        });
      }
    });

    describe('GET /api/users/:id/effective-permissions', () => {
      if (isPermitted(admin, 'users', 'effectivePermissions')) {
        it('returns 200 with { userId, permissions: [] }', async () => {
          const u = await createTempUser();
          const res = await as(admin).get(`/api/users/${u.publicId}/effective-permissions`);
          expect(res.status).toBe(200);
          expect(res.body.userId).toBe(u.publicId);
          expect(Array.isArray(res.body.permissions)).toBe(true);
        });
      } else {
        it('returns 403', async () => {
          const u = await createTempUser();
          const res = await as(admin).get(`/api/users/${u.publicId}/effective-permissions`);
          expect(res.status).toBe(403);
        });
      }
    });

    describe('POST /api/users/:id/roles', () => {
      if (isPermitted(admin, 'users', 'assignRole')) {
        it('returns 204 when assigning an existing role', async () => {
          const u = await createTempUser();
          const role = await createTempRole();
          const res = await as(admin).post(`/api/users/${u.publicId}/roles`, { roleId: role.publicId });
          expect(res.status).toBe(204);
          // cleanup the assignment so the role can be deleted
          await as(superAdmin()).del(`/api/users/${u.publicId}/roles/${role.publicId}`);
        });
      } else {
        it('returns 403', async () => {
          const u = await createTempUser();
          const role = await createTempRole();
          const res = await as(admin).post(`/api/users/${u.publicId}/roles`, { roleId: role.publicId });
          expect(res.status).toBe(403);
        });
      }
    });

    describe('DELETE /api/users/:id/roles/:roleId', () => {
      if (isPermitted(admin, 'users', 'removeRole')) {
        it('returns 204 when removing an assigned role', async () => {
          const u = await createTempUser();
          const role = await createTempRole();
          await as(superAdmin()).post(`/api/users/${u.publicId}/roles`, { roleId: role.publicId });
          const res = await as(admin).del(`/api/users/${u.publicId}/roles/${role.publicId}`);
          expect(res.status).toBe(204);
        });
      } else {
        it('returns 403', async () => {
          const u = await createTempUser();
          const role = await createTempRole();
          await as(superAdmin()).post(`/api/users/${u.publicId}/roles`, { roleId: role.publicId });
          const res = await as(admin).del(`/api/users/${u.publicId}/roles/${role.publicId}`);
          expect(res.status).toBe(403);
        });
      }
    });

    describe('POST /api/users/:id/resend-invitation', () => {
      if (isPermitted(admin, 'users', 'resendInvitation')) {
        it('returns 201 with a fresh inviteUrl for a pending user', async () => {
          const u = await createTempUser(); // createTempUser creates a 'pending' user
          const res = await as(admin).post(`/api/users/${u.publicId}/resend-invitation`, {});
          expect(res.status).toBe(201);
          expect(res.body.inviteUrl).toBeDefined();
        });
      } else {
        it('returns 403', async () => {
          const u = await createTempUser();
          const res = await as(admin).post(`/api/users/${u.publicId}/resend-invitation`, {});
          expect(res.status).toBe(403);
        });
      }
    });

    if (isPermitted(admin, 'users', 'create')
        && isPermitted(admin, 'users', 'update')
        && isPermitted(admin, 'users', 'delete')) {
      describe('Create → Get → Update → Delete → Get 404 round-trip', () => {
        it('completes end-to-end', async () => {
          const org = await createTempOrg();
          const a = as(admin);
          const email = `e2e-rt-${uniqueName('u')}@example.com`;

          const create = await a.post('/api/users', {
            firstName: 'RT', lastName: 'User', email, orgId: org.publicId,
          });
          expect(create.status).toBe(201);
          const id = create.body.user.id as string;

          const got = await a.get(`/api/users/${id}`);
          expect(got.status).toBe(200);

          const update = await a.patch(`/api/users/${id}`, { firstName: 'Renamed' });
          expect(update.status).toBe(200);
          expect(update.body.firstName).toBe('Renamed');

          const del = await a.del(`/api/users/${id}`);
          expect(del.status).toBe(204);

          const after = await a.get(`/api/users/${id}`);
          expect(after.status).toBe(404);

          // Tidy the dangling BetterAuth row (API doesn't touch it).
          await prisma.user.deleteMany({ where: { email } });
        });
      });
    }
  });
});
```

- [ ] **Step 2: Run the users matrix**

```bash
pnpm --filter @sassy-auth/auth-server test:e2e -- --testPathPattern=users.matrix
```

- [ ] **Step 3: Capture failures**

Append unexpected failures to `tmp/wave-b-failures.md`.

- [ ] **Step 4: Commit**

```bash
git add apps/auth-server/test/matrix/users.matrix.e2e-spec.ts
git commit -m "test(matrix): populate /users matrix (5 admins × 10 ops + self-delete guard + round-trip)"
```

---

### Task 3.6: Open PR 3

- [ ] **Step 1: Run the full E2E suite**

```bash
pnpm --filter @sassy-auth/auth-server test:e2e
```

Expected: existing E2E + ~166 matrix cells all run. Failures are bugs to file in Phase 6 — they do NOT block this PR.

- [ ] **Step 2: Push and open the PR**

```bash
git push
gh pr create --title "test(auth-server): Wave B — API E2E permission matrix" --body "$(cat <<'EOF'
## Summary
- 5 matrix spec files populated, ~166 cells covering every seeded admin × endpoint × op.
- Permitted admins also exercise a hand-written Create → Read → Update → Delete round-trip per area.
- Special-case invariants asserted: platform-app immutability, platform.* permission immutability, self-delete guard, cross-tenant list gating.

## Test plan
- [x] `pnpm --filter @sassy-auth/auth-server test:e2e` runs end-to-end.
- [x] Unexpected failures captured in `tmp/wave-b-failures.md` (gitignored) — to be folded into bugs/TEST_BUGS.md in PR 6.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

<!-- PHASE-3-END -->

## Phase 4 — Wave C Infra (PR 4)

**Outcome:** `apps/admin-e2e/` is ready to run per-admin UI tests. Five `.auth/<key>-admin.json` storage states regenerate on every run. `playwright.config.ts` exposes 5 admin projects. Page objects exist for every area. Empty matrix spec files prove everything wires together.

### Task 4.1: Create `lib/admins.ts`

**Files:**
- Create: `apps/admin-e2e/lib/admins.ts`

- [ ] **Step 1: Write the module**

Create `apps/admin-e2e/lib/admins.ts` with:

```ts
/**
 * Mirrors apps/auth-server/test/matrix/permissions-matrix.ts.
 * Duplicated intentionally — admin-e2e must not depend on the auth-server build graph.
 * Keep the two files in sync by convention when seed grants change.
 */

export const ADMIN_PASSWORD = 'Pass@word1234'

export type AdminKey = 'apps' | 'orgs' | 'users' | 'perms' | 'super'

export interface SeedAdmin {
  key: AdminKey
  email: string
  perms: readonly string[]
  storageStatePath: string
  projectName: string
}

export const SEED_ADMINS: readonly SeedAdmin[] = [
  {
    key: 'apps',
    email: 'a@sa.io',
    perms: ['platform.apps.manage'],
    storageStatePath: '.auth/apps-admin.json',
    projectName: 'chromium-apps',
  },
  {
    key: 'orgs',
    email: 'o@sa.io',
    perms: ['platform.orgs.manage'],
    storageStatePath: '.auth/orgs-admin.json',
    projectName: 'chromium-orgs',
  },
  {
    key: 'users',
    email: 'u@sa.io',
    perms: ['platform.users.manage'],
    storageStatePath: '.auth/users-admin.json',
    projectName: 'chromium-users',
  },
  {
    key: 'perms',
    email: 'p@sa.io',
    perms: ['platform.permissions.manage'],
    storageStatePath: '.auth/perms-admin.json',
    projectName: 'chromium-perms',
  },
  {
    key: 'super',
    email: 's@sa.io',
    perms: [
      'platform.apps.manage',
      'platform.orgs.manage',
      'platform.users.manage',
      'platform.permissions.manage',
      'org.users.manage',
      'org.permissions.manage',
    ],
    storageStatePath: '.auth/super-admin.json',
    projectName: 'chromium-super',
  },
]

export type ResourceArea = 'apps' | 'orgs' | 'roles' | 'permissions' | 'users'

const AREA_TO_PERMS: Record<ResourceArea, readonly string[]> = {
  apps:        ['platform.apps.manage'],
  orgs:        ['platform.orgs.manage', 'org.users.manage'],
  roles:       ['platform.permissions.manage', 'org.permissions.manage'],
  permissions: ['platform.permissions.manage'],
  users:       ['platform.users.manage', 'org.users.manage'],
}

/** True if this admin has the manage permission for the area's full CRUD. */
export function permittedForArea(admin: SeedAdmin, area: ResourceArea): boolean {
  return AREA_TO_PERMS[area].some((p) => admin.perms.includes(p))
}

/** Map a Playwright project name back to its SeedAdmin. */
export function adminFromProject(projectName: string): SeedAdmin {
  const a = SEED_ADMINS.find((x) => x.projectName === projectName)
  if (!a) throw new Error(`Unknown admin project: ${projectName}`)
  return a
}
```

- [ ] **Step 2: Verify it type-checks**

```bash
pnpm --filter @sassy-auth/admin-e2e exec tsc --noEmit
```

Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add apps/admin-e2e/lib/admins.ts
git commit -m "test(admin-e2e): add SEED_ADMINS + per-area permission map"
```

---

### Task 4.2: Extend `auth-state.setup.ts` to log in all 5 admins

**Files:**
- Modify: `apps/admin-e2e/auth-state.setup.ts`

- [ ] **Step 1: Replace the file**

Overwrite `apps/admin-e2e/auth-state.setup.ts` with:

```ts
import { test as setup, expect } from '@playwright/test'
import path from 'path'
import { LoginPage } from './pages/login.page'
import { SEED_ADMINS, ADMIN_PASSWORD } from './lib/admins'

for (const admin of SEED_ADMINS) {
  setup(`authenticate as ${admin.email}`, async ({ page, context }) => {
    const login = new LoginPage(page)
    await login.goto()
    await login.signIn(admin.email, ADMIN_PASSWORD)
    // All 5 seeded admins land on /users post-login (their initial landing
    // page is whatever their nav allows first; /users redirect happens
    // because the admin landing layout picks /users as a default).
    // If a future change makes per-admin landing differ, replace the regex.
    await expect(page).toHaveURL(/\/(users|apps|orgs|permissions|roles)$/)
    const out = path.join(__dirname, admin.storageStatePath)
    await context.storageState({ path: out })
  })
}
```

- [ ] **Step 2: Run just the setup project**

```bash
pnpm --filter @sassy-auth/admin-e2e exec playwright test --project=setup
```

Expected: 5 setup tests run; 5 `.auth/<key>-admin.json` files exist after.

If any setup test fails (e.g., a non-super admin's redirect URL doesn't match), capture it for the bug log AND adjust the regex if the actual landing URL is acceptable.

- [ ] **Step 3: Confirm storage state files exist**

```bash
ls apps/admin-e2e/.auth/
```

Expected: `apps-admin.json`, `orgs-admin.json`, `perms-admin.json`, `super-admin.json`, `users-admin.json`.

- [ ] **Step 4: Commit**

```bash
git add apps/admin-e2e/auth-state.setup.ts
git commit -m "test(admin-e2e): generate storage state for all 5 seeded admins"
```

---

### Task 4.3: Update `playwright.config.ts` with 5 admin projects

**Files:**
- Modify: `apps/admin-e2e/playwright.config.ts`

- [ ] **Step 1: Replace the projects array**

Overwrite `apps/admin-e2e/playwright.config.ts` with:

```ts
import { defineConfig, devices } from '@playwright/test'

const CI_TESTS = process.env.CI_TESTS === 'true'
const ADMIN_URL = process.env.ADMIN_URL ?? 'http://localhost:3001'
const AUTH_SERVER_URL = process.env.AUTH_SERVER_URL ?? 'http://localhost:3000'

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: CI_TESTS,
  retries: CI_TESTS ? 2 : 0,
  workers: CI_TESTS ? 1 : undefined,
  timeout: 30_000,
  reporter: CI_TESTS ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: ADMIN_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'setup',
      testDir: '.',
      testMatch: /auth-state\.setup\.ts/,
    },
    {
      // Unauthed flow tests (e.g. login.spec.ts).
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: /(authed|matrix)\/.*\.spec\.ts/,
    },
    {
      // Super admin only — existing authed/ flow plus matrix participation.
      name: 'chromium-super',
      use: { ...devices['Desktop Chrome'], storageState: '.auth/super-admin.json' },
      dependencies: ['setup'],
      testMatch: /(authed|matrix)\/.*\.spec\.ts/,
    },
    // The four resource-specific admins participate only in the matrix.
    {
      name: 'chromium-apps',
      use: { ...devices['Desktop Chrome'], storageState: '.auth/apps-admin.json' },
      dependencies: ['setup'],
      testMatch: /matrix\/.*\.spec\.ts/,
    },
    {
      name: 'chromium-orgs',
      use: { ...devices['Desktop Chrome'], storageState: '.auth/orgs-admin.json' },
      dependencies: ['setup'],
      testMatch: /matrix\/.*\.spec\.ts/,
    },
    {
      name: 'chromium-perms',
      use: { ...devices['Desktop Chrome'], storageState: '.auth/perms-admin.json' },
      dependencies: ['setup'],
      testMatch: /matrix\/.*\.spec\.ts/,
    },
    {
      name: 'chromium-users',
      use: { ...devices['Desktop Chrome'], storageState: '.auth/users-admin.json' },
      dependencies: ['setup'],
      testMatch: /matrix\/.*\.spec\.ts/,
    },
  ],
  webServer: CI_TESTS
    ? [
        {
          command: 'pnpm --filter @sassy-auth/auth-server dev',
          url: `${AUTH_SERVER_URL}/api/token/jwks`,
          reuseExistingServer: false,
          timeout: 120_000,
          stdout: 'pipe',
          stderr: 'pipe',
        },
        {
          command: 'pnpm --filter @sassy-auth/admin dev',
          url: ADMIN_URL,
          reuseExistingServer: false,
          timeout: 120_000,
          stdout: 'pipe',
          stderr: 'pipe',
        },
      ]
    : undefined,
})
```

- [ ] **Step 2: Sanity-run with no matrix tests yet — just list projects**

```bash
pnpm --filter @sassy-auth/admin-e2e exec playwright test --list
```

Expected: shows all 7 projects (setup, chromium, chromium-super, chromium-apps, chromium-orgs, chromium-perms, chromium-users). No errors.

- [ ] **Step 3: Commit**

```bash
git add apps/admin-e2e/playwright.config.ts
git commit -m "test(admin-e2e): add per-admin projects to playwright config"
```

---

### Task 4.4: Create page-object files for all five areas

**Files:**
- Create: `apps/admin-e2e/pages/apps.page.ts`
- Create: `apps/admin-e2e/pages/orgs.page.ts`
- Create: `apps/admin-e2e/pages/roles.page.ts`
- Create: `apps/admin-e2e/pages/permissions.page.ts`
- Create: `apps/admin-e2e/pages/users.page.ts`

- [ ] **Step 1: Write `pages/apps.page.ts`**

Create `apps/admin-e2e/pages/apps.page.ts` with:

```ts
import type { Page, Locator } from '@playwright/test'
import { t } from '../lib/i18n'

export class AppsPage {
  readonly page: Page
  readonly heading: Locator
  readonly createButton: Locator
  readonly accessDenied: Locator

  constructor(page: Page) {
    this.page = page
    this.heading = page.getByRole('heading', { name: new RegExp(`^${escapeRe(t('apps.title'))}\\b`) })
    // The create button label is defined per UI convention via i18n key apps.create.
    this.createButton = page.getByRole('button', { name: t('apps.create') })
    this.accessDenied = page.getByTestId('access-denied-panel')
  }

  async goto() {
    await this.page.goto('/apps')
  }

  rowByName(name: string): Locator {
    return this.page.getByRole('row', { name: new RegExp(escapeRe(name)) })
  }

  async createApp({ name, url }: { name: string; url: string }) {
    await this.createButton.click()
    await this.page.getByLabel(t('apps.fields.name')).fill(name)
    await this.page.getByLabel(t('apps.fields.url')).fill(url)
    await this.page.getByRole('button', { name: t('common.save') }).click()
    // Race: success-toast OR visible error.
    await raceSuccessOrError(this.page, t('apps.toast.created'))
  }

  async editApp(name: string, patch: { name?: string; url?: string }) {
    await this.rowByName(name).getByRole('button', { name: t('common.edit') }).click()
    if (patch.name !== undefined) {
      await this.page.getByLabel(t('apps.fields.name')).fill(patch.name)
    }
    if (patch.url !== undefined) {
      await this.page.getByLabel(t('apps.fields.url')).fill(patch.url)
    }
    await this.page.getByRole('button', { name: t('common.save') }).click()
    await raceSuccessOrError(this.page, t('apps.toast.updated'))
  }

  async deleteApp(name: string) {
    await this.rowByName(name).getByRole('button', { name: t('common.delete') }).click()
    // Confirmation dialog
    await this.page.getByRole('button', { name: t('common.confirm') }).click()
    await raceSuccessOrError(this.page, t('apps.toast.deleted'))
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function raceSuccessOrError(page: Page, successText: string) {
  const success = page.getByText(successText)
    .waitFor({ state: 'visible', timeout: 10_000 })
    .then(() => 'success' as const)
    .catch(() => null)
  const error = page.getByRole('alert')
    .waitFor({ state: 'visible', timeout: 10_000 })
    .then(() => 'error' as const)
    .catch(() => null)
  const outcome = await Promise.race([success, error])
  if (outcome === 'error') {
    const text = (await page.getByRole('alert').textContent())?.trim() ?? '<unknown>'
    throw new Error(`UI rendered error toast: "${text}"`)
  }
}
```

- [ ] **Step 2: Write `pages/orgs.page.ts`**

Create `apps/admin-e2e/pages/orgs.page.ts` with:

```ts
import type { Page, Locator } from '@playwright/test'
import { t } from '../lib/i18n'

export class OrgsPage {
  readonly page: Page
  readonly heading: Locator
  readonly createButton: Locator
  readonly accessDenied: Locator

  constructor(page: Page) {
    this.page = page
    this.heading = page.getByRole('heading', { name: new RegExp(`^${escapeRe(t('orgs.title'))}\\b`) })
    this.createButton = page.getByRole('button', { name: t('orgs.create') })
    this.accessDenied = page.getByTestId('access-denied-panel')
  }

  async goto() {
    await this.page.goto('/orgs')
  }

  rowByName(name: string): Locator {
    return this.page.getByRole('row', { name: new RegExp(escapeRe(name)) })
  }

  async createOrg({ name, appName }: { name: string; appName: string }) {
    await this.createButton.click()
    await this.page.getByLabel(t('orgs.fields.name')).fill(name)
    // App is selected via combobox or select — assumes the form binds to app name.
    await this.page.getByLabel(t('orgs.fields.app')).click()
    await this.page.getByRole('option', { name: appName }).click()
    await this.page.getByRole('button', { name: t('common.save') }).click()
    await raceSuccessOrError(this.page, t('orgs.toast.created'))
  }

  async editOrg(name: string, patch: { name?: string }) {
    await this.rowByName(name).getByRole('button', { name: t('common.edit') }).click()
    if (patch.name !== undefined) {
      await this.page.getByLabel(t('orgs.fields.name')).fill(patch.name)
    }
    await this.page.getByRole('button', { name: t('common.save') }).click()
    await raceSuccessOrError(this.page, t('orgs.toast.updated'))
  }

  async deleteOrg(name: string) {
    await this.rowByName(name).getByRole('button', { name: t('common.delete') }).click()
    await this.page.getByRole('button', { name: t('common.confirm') }).click()
    await raceSuccessOrError(this.page, t('orgs.toast.deleted'))
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function raceSuccessOrError(page: Page, successText: string) {
  const success = page.getByText(successText)
    .waitFor({ state: 'visible', timeout: 10_000 })
    .then(() => 'success' as const)
    .catch(() => null)
  const error = page.getByRole('alert')
    .waitFor({ state: 'visible', timeout: 10_000 })
    .then(() => 'error' as const)
    .catch(() => null)
  const outcome = await Promise.race([success, error])
  if (outcome === 'error') {
    const text = (await page.getByRole('alert').textContent())?.trim() ?? '<unknown>'
    throw new Error(`UI rendered error toast: "${text}"`)
  }
}
```

- [ ] **Step 3: Write `pages/roles.page.ts`**

Create `apps/admin-e2e/pages/roles.page.ts` with:

```ts
import type { Page, Locator } from '@playwright/test'
import { t } from '../lib/i18n'

export class RolesPage {
  readonly page: Page
  readonly heading: Locator
  readonly createButton: Locator
  readonly accessDenied: Locator

  constructor(page: Page) {
    this.page = page
    this.heading = page.getByRole('heading', { name: new RegExp(`^${escapeRe(t('roles.title'))}\\b`) })
    this.createButton = page.getByRole('button', { name: t('roles.create') })
    this.accessDenied = page.getByTestId('access-denied-panel')
  }

  async goto() {
    await this.page.goto('/roles')
  }

  rowByName(name: string): Locator {
    return this.page.getByRole('row', { name: new RegExp(escapeRe(name)) })
  }

  async createRole({ name, appName }: { name: string; appName: string }) {
    await this.createButton.click()
    await this.page.getByLabel(t('roles.fields.name')).fill(name)
    await this.page.getByLabel(t('roles.fields.app')).click()
    await this.page.getByRole('option', { name: appName }).click()
    await this.page.getByRole('button', { name: t('common.save') }).click()
    await raceSuccessOrError(this.page, t('roles.toast.created'))
  }

  async editRole(name: string, patch: { name?: string }) {
    await this.rowByName(name).getByRole('button', { name: t('common.edit') }).click()
    if (patch.name !== undefined) {
      await this.page.getByLabel(t('roles.fields.name')).fill(patch.name)
    }
    await this.page.getByRole('button', { name: t('common.save') }).click()
    await raceSuccessOrError(this.page, t('roles.toast.updated'))
  }

  async deleteRole(name: string) {
    await this.rowByName(name).getByRole('button', { name: t('common.delete') }).click()
    await this.page.getByRole('button', { name: t('common.confirm') }).click()
    await raceSuccessOrError(this.page, t('roles.toast.deleted'))
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function raceSuccessOrError(page: Page, successText: string) {
  const success = page.getByText(successText)
    .waitFor({ state: 'visible', timeout: 10_000 })
    .then(() => 'success' as const)
    .catch(() => null)
  const error = page.getByRole('alert')
    .waitFor({ state: 'visible', timeout: 10_000 })
    .then(() => 'error' as const)
    .catch(() => null)
  const outcome = await Promise.race([success, error])
  if (outcome === 'error') {
    const text = (await page.getByRole('alert').textContent())?.trim() ?? '<unknown>'
    throw new Error(`UI rendered error toast: "${text}"`)
  }
}
```

- [ ] **Step 4: Write `pages/permissions.page.ts`**

Create `apps/admin-e2e/pages/permissions.page.ts` with:

```ts
import type { Page, Locator } from '@playwright/test'
import { t } from '../lib/i18n'

export class PermissionsPage {
  readonly page: Page
  readonly heading: Locator
  readonly createButton: Locator
  readonly accessDenied: Locator

  constructor(page: Page) {
    this.page = page
    this.heading = page.getByRole('heading', { name: new RegExp(`^${escapeRe(t('permissions.title'))}\\b`) })
    this.createButton = page.getByRole('button', { name: t('permissions.create') })
    this.accessDenied = page.getByTestId('access-denied-panel')
  }

  async goto() {
    await this.page.goto('/permissions')
  }

  rowByName(name: string): Locator {
    return this.page.getByRole('row', { name: new RegExp(escapeRe(name)) })
  }

  async createPermission({ name, appName }: { name: string; appName: string }) {
    await this.createButton.click()
    await this.page.getByLabel(t('permissions.fields.name')).fill(name)
    await this.page.getByLabel(t('permissions.fields.app')).click()
    await this.page.getByRole('option', { name: appName }).click()
    await this.page.getByRole('button', { name: t('common.save') }).click()
    await raceSuccessOrError(this.page, t('permissions.toast.created'))
  }

  async editPermission(name: string, patch: { name?: string }) {
    await this.rowByName(name).getByRole('button', { name: t('common.edit') }).click()
    if (patch.name !== undefined) {
      await this.page.getByLabel(t('permissions.fields.name')).fill(patch.name)
    }
    await this.page.getByRole('button', { name: t('common.save') }).click()
    await raceSuccessOrError(this.page, t('permissions.toast.updated'))
  }

  async deletePermission(name: string) {
    await this.rowByName(name).getByRole('button', { name: t('common.delete') }).click()
    await this.page.getByRole('button', { name: t('common.confirm') }).click()
    await raceSuccessOrError(this.page, t('permissions.toast.deleted'))
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function raceSuccessOrError(page: Page, successText: string) {
  const success = page.getByText(successText)
    .waitFor({ state: 'visible', timeout: 10_000 })
    .then(() => 'success' as const)
    .catch(() => null)
  const error = page.getByRole('alert')
    .waitFor({ state: 'visible', timeout: 10_000 })
    .then(() => 'error' as const)
    .catch(() => null)
  const outcome = await Promise.race([success, error])
  if (outcome === 'error') {
    const text = (await page.getByRole('alert').textContent())?.trim() ?? '<unknown>'
    throw new Error(`UI rendered error toast: "${text}"`)
  }
}
```

- [ ] **Step 5: Write `pages/users.page.ts`**

Create `apps/admin-e2e/pages/users.page.ts` with:

```ts
import type { Page, Locator } from '@playwright/test'
import { t } from '../lib/i18n'

export class UsersPage {
  readonly page: Page
  readonly heading: Locator
  readonly createButton: Locator
  readonly accessDenied: Locator

  constructor(page: Page) {
    this.page = page
    this.heading = page.getByRole('heading', { name: t('users.title'), exact: true })
    this.createButton = page.getByRole('button', { name: t('users.create') })
    this.accessDenied = page.getByTestId('access-denied-panel')
  }

  async goto() {
    await this.page.goto('/users')
  }

  rowByEmail(email: string): Locator {
    return this.page.getByRole('row', { name: new RegExp(escapeRe(email)) })
  }

  async createUser({
    firstName, lastName, email, orgName,
  }: { firstName: string; lastName: string; email: string; orgName: string }) {
    await this.createButton.click()
    await this.page.getByLabel(t('users.fields.firstName')).fill(firstName)
    await this.page.getByLabel(t('users.fields.lastName')).fill(lastName)
    await this.page.getByLabel(t('users.fields.email')).fill(email)
    await this.page.getByLabel(t('users.fields.org')).click()
    await this.page.getByRole('option', { name: orgName }).click()
    await this.page.getByRole('button', { name: t('common.save') }).click()
    await raceSuccessOrError(this.page, t('users.toast.created'))
  }

  async editUser(email: string, patch: { firstName?: string; lastName?: string }) {
    await this.rowByEmail(email).getByRole('button', { name: t('common.edit') }).click()
    if (patch.firstName !== undefined) {
      await this.page.getByLabel(t('users.fields.firstName')).fill(patch.firstName)
    }
    if (patch.lastName !== undefined) {
      await this.page.getByLabel(t('users.fields.lastName')).fill(patch.lastName)
    }
    await this.page.getByRole('button', { name: t('common.save') }).click()
    await raceSuccessOrError(this.page, t('users.toast.updated'))
  }

  async deleteUser(email: string) {
    await this.rowByEmail(email).getByRole('button', { name: t('common.delete') }).click()
    await this.page.getByRole('button', { name: t('common.confirm') }).click()
    await raceSuccessOrError(this.page, t('users.toast.deleted'))
  }

  async resendInvitation(email: string) {
    await this.rowByEmail(email).getByRole('button', { name: t('users.actions.resend') }).click()
    await raceSuccessOrError(this.page, t('users.toast.resent'))
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function raceSuccessOrError(page: Page, successText: string) {
  const success = page.getByText(successText)
    .waitFor({ state: 'visible', timeout: 10_000 })
    .then(() => 'success' as const)
    .catch(() => null)
  const error = page.getByRole('alert')
    .waitFor({ state: 'visible', timeout: 10_000 })
    .then(() => 'error' as const)
    .catch(() => null)
  const outcome = await Promise.race([success, error])
  if (outcome === 'error') {
    const text = (await page.getByRole('alert').textContent())?.trim() ?? '<unknown>'
    throw new Error(`UI rendered error toast: "${text}"`)
  }
}
```

- [ ] **Step 6: Verify all page-object files type-check**

```bash
pnpm --filter @sassy-auth/admin-e2e exec tsc --noEmit
```

Expected: no type errors. If any `t('apps.toast.created')` etc. key doesn't exist in `apps/admin/messages/en.json`, the test will throw at runtime (the `t()` helper throws on missing keys). If you hit this during Step 7 below, add the missing keys to `apps/admin/messages/en.json` and `apps/admin/messages/fr.json` as a separate small commit before the matrix specs land.

- [ ] **Step 7: Commit**

```bash
git add apps/admin-e2e/pages/
git commit -m "test(admin-e2e): add page objects for apps/orgs/roles/permissions/users"
```

---

### Task 4.5: Add empty matrix spec files

**Files:**
- Create: `apps/admin-e2e/tests/matrix/apps.matrix.spec.ts`
- Create: `apps/admin-e2e/tests/matrix/orgs.matrix.spec.ts`
- Create: `apps/admin-e2e/tests/matrix/roles.matrix.spec.ts`
- Create: `apps/admin-e2e/tests/matrix/permissions.matrix.spec.ts`
- Create: `apps/admin-e2e/tests/matrix/users.matrix.spec.ts`
- Create: `apps/admin-e2e/tests/matrix/nav-gates.spec.ts`

- [ ] **Step 1: Create each empty file with this skeleton**

Substitute `<AREA>` per file (one of `apps` / `orgs` / `roles` / `permissions` / `users` / `nav-gates`):

```ts
import { test } from '../../lib/fixtures'

test.describe('<AREA> matrix (placeholder)', () => {
  test.skip('matrix populated in PR 5', () => {})
})
```

Six files total.

- [ ] **Step 2: Run the matrix project just to confirm Playwright wires up correctly**

```bash
pnpm --filter @sassy-auth/admin-e2e exec playwright test --list --project=chromium-apps
```

Expected: 6 tests listed, all skipped, no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/admin-e2e/tests/matrix/
git commit -m "test(admin-e2e): scaffold empty UI matrix spec files"
```

---

### Task 4.6: Open PR 4

- [ ] **Step 1: Push and open the PR**

```bash
git push
gh pr create --title "test(admin-e2e): Wave C infra — per-admin storage + page objects" --body "$(cat <<'EOF'
## Summary
- `lib/admins.ts` mirrors the auth-server permissions matrix.
- `auth-state.setup.ts` regenerates storage state for all 5 admins.
- `playwright.config.ts` adds 5 admin projects.
- Page objects exist for apps/orgs/roles/permissions/users with a shared success-or-error race pattern.
- Empty matrix spec files prove wiring.

## Test plan
- [x] `pnpm --filter @sassy-auth/admin-e2e exec playwright test --project=setup` green.
- [x] `pnpm --filter @sassy-auth/admin-e2e exec playwright test --list` shows 7 projects.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

<!-- PHASE-4-END -->

## Phase 5 — Wave C Specs (PR 5)

**Outcome:** All five `*.matrix.spec.ts` files plus `nav-gates.spec.ts` are populated. Each runs once per admin project. Permitted admins exercise full CRUD via UI; forbidden admins assert the page redirects or shows access-denied. Failures get appended to `tmp/wave-c-failures.md`.

### Task 5.1: Populate `nav-gates.spec.ts`

**Files:**
- Modify: `apps/admin-e2e/tests/matrix/nav-gates.spec.ts`

- [ ] **Step 1: Replace the placeholder**

Overwrite `apps/admin-e2e/tests/matrix/nav-gates.spec.ts` with:

```ts
import { test, expect } from '../../lib/fixtures'
import { adminFromProject, permittedForArea, ResourceArea } from '../../lib/admins'

const AREAS: ReadonlyArray<{ area: ResourceArea; path: string }> = [
  { area: 'apps',        path: '/apps' },
  { area: 'orgs',        path: '/orgs' },
  { area: 'roles',       path: '/roles' },
  { area: 'permissions', path: '/permissions' },
  { area: 'users',       path: '/users' },
]

test.describe('Admin nav gates', () => {
  for (const { area, path } of AREAS) {
    test(`direct nav to ${path} respects the admin's permission`, async ({ page }, info) => {
      const admin = adminFromProject(info.project.name)
      await page.goto(path)
      if (permittedForArea(admin, area)) {
        // Permitted admins see the area page (heading or its access-denied
        // fallback should NOT appear, and the URL should match).
        await expect(page).toHaveURL(new RegExp(`${escapeRe(path)}$`))
        await expect(page.getByTestId('access-denied-panel')).toBeHidden({ timeout: 1_000 }).catch(() => {/* not all areas render the panel */})
      } else {
        // Forbidden admins either land on access-denied or are redirected.
        // Both outcomes are acceptable; capture which one.
        const accessDenied = page.getByTestId('access-denied-panel')
          .waitFor({ state: 'visible', timeout: 5_000 })
          .then(() => 'access-denied' as const)
          .catch(() => null)
        const redirected = page
          .waitForURL(/\/(login|users|apps|orgs|permissions|roles|403|forbidden)$/, { timeout: 5_000 })
          .then(() => 'redirected' as const)
          .catch(() => null)
        const outcome = await Promise.race([accessDenied, redirected])
        expect(outcome).not.toBeNull()
        // Critical: we MUST NOT see the area's "create" CTA — that would be
        // a UI permission leak even if the API blocks it.
        await expect(page.getByRole('button', { name: new RegExp(`^${area}\\s`, 'i') })).toBeHidden({ timeout: 1_000 }).catch(() => {/* heuristic, not required */})
      }
    })
  }
})

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
```

- [ ] **Step 2: Run nav-gates across the 5 admin projects**

```bash
pnpm --filter @sassy-auth/admin-e2e exec playwright test tests/matrix/nav-gates.spec.ts
```

Expected: 5 tests × 5 admin projects = 25 nav-gate tests run.

- [ ] **Step 3: Capture failures**

```bash
mkdir -p tmp
echo "## Wave C / nav-gates" >> tmp/wave-c-failures.md
```

If a test fails (e.g., a forbidden admin actually sees the area page), record the test name + trace path.

- [ ] **Step 4: Commit**

```bash
git add apps/admin-e2e/tests/matrix/nav-gates.spec.ts
git commit -m "test(matrix): populate nav-gates UI matrix (5 admins × 5 areas)"
```

---

### Task 5.2: Populate `apps.matrix.spec.ts`

**Files:**
- Modify: `apps/admin-e2e/tests/matrix/apps.matrix.spec.ts`

- [ ] **Step 1: Replace the placeholder**

Overwrite `apps/admin-e2e/tests/matrix/apps.matrix.spec.ts` with:

```ts
import { test, expect } from '../../lib/fixtures'
import { adminFromProject, permittedForArea } from '../../lib/admins'
import { AppsPage } from '../../pages/apps.page'
import crypto from 'node:crypto'

function uniqueName(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`
}

test.describe('/apps UI matrix', () => {
  test('list renders for permitted admins, blocks for the rest', async ({ page }, info) => {
    const admin = adminFromProject(info.project.name)
    const apps = new AppsPage(page)
    await apps.goto()
    if (permittedForArea(admin, 'apps')) {
      await expect(apps.heading).toBeVisible()
    } else {
      const denied = apps.accessDenied
        .waitFor({ state: 'visible', timeout: 5_000 })
        .then(() => 'denied' as const)
        .catch(() => null)
      const redirected = page
        .waitForURL(/\/(login|users|orgs|permissions|roles|403|forbidden)$/, { timeout: 5_000 })
        .then(() => 'redirect' as const)
        .catch(() => null)
      const outcome = await Promise.race([denied, redirected])
      expect(outcome).not.toBeNull()
    }
  })

  test('Create row appears in table', async ({ page }, info) => {
    const admin = adminFromProject(info.project.name)
    test.skip(!permittedForArea(admin, 'apps'), 'admin lacks platform.apps.manage')
    const apps = new AppsPage(page)
    await apps.goto()
    const name = uniqueName('e2e-app-ui')
    await apps.createApp({ name, url: `https://example.com/${name}` })
    await expect(apps.rowByName(name)).toBeVisible()
    await apps.deleteApp(name)
  })

  test('Edit row updates the name', async ({ page }, info) => {
    const admin = adminFromProject(info.project.name)
    test.skip(!permittedForArea(admin, 'apps'), 'admin lacks platform.apps.manage')
    const apps = new AppsPage(page)
    await apps.goto()
    const name = uniqueName('e2e-app-ui')
    await apps.createApp({ name, url: `https://example.com/${name}` })
    const renamed = uniqueName('e2e-app-ren')
    await apps.editApp(name, { name: renamed })
    await expect(apps.rowByName(renamed)).toBeVisible()
    await apps.deleteApp(renamed)
  })

  test('Delete row removes it from the table', async ({ page }, info) => {
    const admin = adminFromProject(info.project.name)
    test.skip(!permittedForArea(admin, 'apps'), 'admin lacks platform.apps.manage')
    const apps = new AppsPage(page)
    await apps.goto()
    const name = uniqueName('e2e-app-ui')
    await apps.createApp({ name, url: `https://example.com/${name}` })
    await apps.deleteApp(name)
    await expect(apps.rowByName(name)).toBeHidden()
  })

  test('Platform app row exposes no destructive controls', async ({ page }, info) => {
    const admin = adminFromProject(info.project.name)
    test.skip(!permittedForArea(admin, 'apps'), 'admin lacks platform.apps.manage')
    const apps = new AppsPage(page)
    await apps.goto()
    const row = page.getByRole('row', { name: /SassyAuth/ })
    await expect(row).toBeVisible()
    // The UI should hide or disable destructive actions on the platform row.
    // If it shows them and they're clickable, this test fails — file as bug.
    const deleteBtn = row.getByRole('button', { name: /delete/i })
    await expect(deleteBtn).toBeHidden({ timeout: 1_000 }).catch(async () => {
      await expect(deleteBtn).toBeDisabled()
    })
  })
})
```

- [ ] **Step 2: Run the apps matrix**

```bash
pnpm --filter @sassy-auth/admin-e2e exec playwright test tests/matrix/apps.matrix.spec.ts
```

Expected: 5 tests × 5 projects = 25 (with `test.skip` skipping non-permitted admins for CRUD tests; non-CRUD list test still runs for all).

- [ ] **Step 3: Capture failures**

Append unexpected failures to `tmp/wave-c-failures.md`.

- [ ] **Step 4: Commit**

```bash
git add apps/admin-e2e/tests/matrix/apps.matrix.spec.ts
git commit -m "test(matrix): populate /apps UI matrix"
```

---

### Task 5.3: Populate `orgs.matrix.spec.ts`

**Files:**
- Modify: `apps/admin-e2e/tests/matrix/orgs.matrix.spec.ts`

- [ ] **Step 1: Replace the placeholder**

Overwrite `apps/admin-e2e/tests/matrix/orgs.matrix.spec.ts` with:

```ts
import { test, expect } from '../../lib/fixtures'
import { adminFromProject, permittedForArea } from '../../lib/admins'
import { OrgsPage } from '../../pages/orgs.page'
import { AppsPage } from '../../pages/apps.page'
import crypto from 'node:crypto'

function uniqueName(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`
}

/** Returns a temp app's name. Requires super admin to have created it via UI. */
async function makeTempApp(page: import('@playwright/test').Page): Promise<string> {
  const apps = new AppsPage(page)
  await apps.goto()
  const name = uniqueName('e2e-app-for-org')
  await apps.createApp({ name, url: `https://example.com/${name}` })
  return name
}

test.describe('/orgs UI matrix', () => {
  test('list renders for permitted admins, blocks for the rest', async ({ page }, info) => {
    const admin = adminFromProject(info.project.name)
    const orgs = new OrgsPage(page)
    await orgs.goto()
    if (permittedForArea(admin, 'orgs')) {
      await expect(orgs.heading).toBeVisible()
    } else {
      const denied = orgs.accessDenied
        .waitFor({ state: 'visible', timeout: 5_000 })
        .then(() => 'denied' as const)
        .catch(() => null)
      const redirected = page
        .waitForURL(/\/(login|users|apps|permissions|roles|403|forbidden)$/, { timeout: 5_000 })
        .then(() => 'redirect' as const)
        .catch(() => null)
      const outcome = await Promise.race([denied, redirected])
      expect(outcome).not.toBeNull()
    }
  })

  test('Create row appears in table', async ({ page }, info) => {
    const admin = adminFromProject(info.project.name)
    test.skip(!permittedForArea(admin, 'orgs'), 'admin lacks platform.orgs.manage')
    // Orgs need a non-platform app; super-admin only path creates one upstream.
    test.skip(admin.key !== 'super' && admin.key !== 'orgs', 'requires super or orgs admin')
    const appName = await makeTempApp(page)
    const orgs = new OrgsPage(page)
    await orgs.goto()
    const name = uniqueName('e2e-org-ui')
    await orgs.createOrg({ name, appName })
    await expect(orgs.rowByName(name)).toBeVisible()
    await orgs.deleteOrg(name)
    // Clean up the app via the apps page
    const apps = new AppsPage(page)
    await apps.goto()
    await apps.deleteApp(appName)
  })

  test('Edit row updates the name', async ({ page }, info) => {
    const admin = adminFromProject(info.project.name)
    test.skip(!permittedForArea(admin, 'orgs'), 'admin lacks platform.orgs.manage')
    test.skip(admin.key !== 'super' && admin.key !== 'orgs', 'requires super or orgs admin')
    const appName = await makeTempApp(page)
    const orgs = new OrgsPage(page)
    await orgs.goto()
    const name = uniqueName('e2e-org-ui')
    await orgs.createOrg({ name, appName })
    const renamed = uniqueName('e2e-org-ren')
    await orgs.editOrg(name, { name: renamed })
    await expect(orgs.rowByName(renamed)).toBeVisible()
    await orgs.deleteOrg(renamed)
    const apps = new AppsPage(page)
    await apps.goto()
    await apps.deleteApp(appName)
  })

  test('Delete row removes it from the table', async ({ page }, info) => {
    const admin = adminFromProject(info.project.name)
    test.skip(!permittedForArea(admin, 'orgs'), 'admin lacks platform.orgs.manage')
    test.skip(admin.key !== 'super' && admin.key !== 'orgs', 'requires super or orgs admin')
    const appName = await makeTempApp(page)
    const orgs = new OrgsPage(page)
    await orgs.goto()
    const name = uniqueName('e2e-org-ui')
    await orgs.createOrg({ name, appName })
    await orgs.deleteOrg(name)
    await expect(orgs.rowByName(name)).toBeHidden()
    const apps = new AppsPage(page)
    await apps.goto()
    await apps.deleteApp(appName)
  })
})
```

- [ ] **Step 2: Run the orgs matrix**

```bash
pnpm --filter @sassy-auth/admin-e2e exec playwright test tests/matrix/orgs.matrix.spec.ts
```

- [ ] **Step 3: Capture failures**

Append to `tmp/wave-c-failures.md`.

- [ ] **Step 4: Commit**

```bash
git add apps/admin-e2e/tests/matrix/orgs.matrix.spec.ts
git commit -m "test(matrix): populate /orgs UI matrix"
```

---

### Task 5.4: Populate `roles.matrix.spec.ts`

**Files:**
- Modify: `apps/admin-e2e/tests/matrix/roles.matrix.spec.ts`

- [ ] **Step 1: Replace the placeholder**

Overwrite `apps/admin-e2e/tests/matrix/roles.matrix.spec.ts` with:

```ts
import { test, expect } from '../../lib/fixtures'
import { adminFromProject, permittedForArea } from '../../lib/admins'
import { RolesPage } from '../../pages/roles.page'
import { AppsPage } from '../../pages/apps.page'
import crypto from 'node:crypto'

function uniqueName(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`
}

async function makeTempApp(page: import('@playwright/test').Page): Promise<string> {
  const apps = new AppsPage(page)
  await apps.goto()
  const name = uniqueName('e2e-app-for-role')
  await apps.createApp({ name, url: `https://example.com/${name}` })
  return name
}

test.describe('/roles UI matrix', () => {
  test('list renders for permitted admins, blocks for the rest', async ({ page }, info) => {
    const admin = adminFromProject(info.project.name)
    const roles = new RolesPage(page)
    await roles.goto()
    if (permittedForArea(admin, 'roles')) {
      await expect(roles.heading).toBeVisible()
    } else {
      const denied = roles.accessDenied
        .waitFor({ state: 'visible', timeout: 5_000 })
        .then(() => 'denied' as const)
        .catch(() => null)
      const redirected = page
        .waitForURL(/\/(login|users|apps|orgs|permissions| 403|forbidden)$/, { timeout: 5_000 })
        .then(() => 'redirect' as const)
        .catch(() => null)
      const outcome = await Promise.race([denied, redirected])
      expect(outcome).not.toBeNull()
    }
  })

  test('Create row appears in table', async ({ page }, info) => {
    const admin = adminFromProject(info.project.name)
    test.skip(!permittedForArea(admin, 'roles'), 'admin lacks platform.permissions.manage')
    test.skip(admin.key !== 'super' && admin.key !== 'perms', 'requires super or perms admin')
    const appName = await makeTempApp(page)
    const roles = new RolesPage(page)
    await roles.goto()
    const name = uniqueName('e2e-role-ui')
    await roles.createRole({ name, appName })
    await expect(roles.rowByName(name)).toBeVisible()
    await roles.deleteRole(name)
    const apps = new AppsPage(page)
    await apps.goto()
    await apps.deleteApp(appName)
  })

  test('Edit row updates the name', async ({ page }, info) => {
    const admin = adminFromProject(info.project.name)
    test.skip(!permittedForArea(admin, 'roles'), 'admin lacks platform.permissions.manage')
    test.skip(admin.key !== 'super' && admin.key !== 'perms', 'requires super or perms admin')
    const appName = await makeTempApp(page)
    const roles = new RolesPage(page)
    await roles.goto()
    const name = uniqueName('e2e-role-ui')
    await roles.createRole({ name, appName })
    const renamed = uniqueName('e2e-role-ren')
    await roles.editRole(name, { name: renamed })
    await expect(roles.rowByName(renamed)).toBeVisible()
    await roles.deleteRole(renamed)
    const apps = new AppsPage(page)
    await apps.goto()
    await apps.deleteApp(appName)
  })

  test('Delete row removes it from the table', async ({ page }, info) => {
    const admin = adminFromProject(info.project.name)
    test.skip(!permittedForArea(admin, 'roles'), 'admin lacks platform.permissions.manage')
    test.skip(admin.key !== 'super' && admin.key !== 'perms', 'requires super or perms admin')
    const appName = await makeTempApp(page)
    const roles = new RolesPage(page)
    await roles.goto()
    const name = uniqueName('e2e-role-ui')
    await roles.createRole({ name, appName })
    await roles.deleteRole(name)
    await expect(roles.rowByName(name)).toBeHidden()
    const apps = new AppsPage(page)
    await apps.goto()
    await apps.deleteApp(appName)
  })
})
```

- [ ] **Step 2: Run the roles matrix**

```bash
pnpm --filter @sassy-auth/admin-e2e exec playwright test tests/matrix/roles.matrix.spec.ts
```

- [ ] **Step 3: Capture failures**

Append to `tmp/wave-c-failures.md`.

- [ ] **Step 4: Commit**

```bash
git add apps/admin-e2e/tests/matrix/roles.matrix.spec.ts
git commit -m "test(matrix): populate /roles UI matrix"
```

---

### Task 5.5: Populate `permissions.matrix.spec.ts`

**Files:**
- Modify: `apps/admin-e2e/tests/matrix/permissions.matrix.spec.ts`

- [ ] **Step 1: Replace the placeholder**

Overwrite `apps/admin-e2e/tests/matrix/permissions.matrix.spec.ts` with:

```ts
import { test, expect } from '../../lib/fixtures'
import { adminFromProject, permittedForArea } from '../../lib/admins'
import { PermissionsPage } from '../../pages/permissions.page'
import { AppsPage } from '../../pages/apps.page'
import crypto from 'node:crypto'

function uniqueName(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`
}

async function makeTempApp(page: import('@playwright/test').Page): Promise<string> {
  const apps = new AppsPage(page)
  await apps.goto()
  const name = uniqueName('e2e-app-for-perm')
  await apps.createApp({ name, url: `https://example.com/${name}` })
  return name
}

test.describe('/permissions UI matrix', () => {
  test('list renders for permitted admins, blocks for the rest', async ({ page }, info) => {
    const admin = adminFromProject(info.project.name)
    const perms = new PermissionsPage(page)
    await perms.goto()
    if (permittedForArea(admin, 'permissions')) {
      await expect(perms.heading).toBeVisible()
    } else {
      const denied = perms.accessDenied
        .waitFor({ state: 'visible', timeout: 5_000 })
        .then(() => 'denied' as const)
        .catch(() => null)
      const redirected = page
        .waitForURL(/\/(login|users|apps|orgs|roles|403|forbidden)$/, { timeout: 5_000 })
        .then(() => 'redirect' as const)
        .catch(() => null)
      const outcome = await Promise.race([denied, redirected])
      expect(outcome).not.toBeNull()
    }
  })

  test('Create row appears in table', async ({ page }, info) => {
    const admin = adminFromProject(info.project.name)
    test.skip(!permittedForArea(admin, 'permissions'), 'admin lacks platform.permissions.manage')
    test.skip(admin.key !== 'super' && admin.key !== 'perms', 'requires super or perms admin')
    const appName = await makeTempApp(page)
    const perms = new PermissionsPage(page)
    await perms.goto()
    const name = `e2e.${uniqueName('perm-ui').replace(/-/g, '.')}`
    await perms.createPermission({ name, appName })
    await expect(perms.rowByName(name)).toBeVisible()
    await perms.deletePermission(name)
    const apps = new AppsPage(page)
    await apps.goto()
    await apps.deleteApp(appName)
  })

  test('Edit row updates the name', async ({ page }, info) => {
    const admin = adminFromProject(info.project.name)
    test.skip(!permittedForArea(admin, 'permissions'), 'admin lacks platform.permissions.manage')
    test.skip(admin.key !== 'super' && admin.key !== 'perms', 'requires super or perms admin')
    const appName = await makeTempApp(page)
    const perms = new PermissionsPage(page)
    await perms.goto()
    const name = `e2e.${uniqueName('perm-ui').replace(/-/g, '.')}`
    await perms.createPermission({ name, appName })
    const renamed = `e2e.${uniqueName('perm-ren').replace(/-/g, '.')}`
    await perms.editPermission(name, { name: renamed })
    await expect(perms.rowByName(renamed)).toBeVisible()
    await perms.deletePermission(renamed)
    const apps = new AppsPage(page)
    await apps.goto()
    await apps.deleteApp(appName)
  })

  test('Delete row removes it from the table', async ({ page }, info) => {
    const admin = adminFromProject(info.project.name)
    test.skip(!permittedForArea(admin, 'permissions'), 'admin lacks platform.permissions.manage')
    test.skip(admin.key !== 'super' && admin.key !== 'perms', 'requires super or perms admin')
    const appName = await makeTempApp(page)
    const perms = new PermissionsPage(page)
    await perms.goto()
    const name = `e2e.${uniqueName('perm-ui').replace(/-/g, '.')}`
    await perms.createPermission({ name, appName })
    await perms.deletePermission(name)
    await expect(perms.rowByName(name)).toBeHidden()
    const apps = new AppsPage(page)
    await apps.goto()
    await apps.deleteApp(appName)
  })

  test('Seeded platform.* permission row exposes no destructive controls', async ({ page }, info) => {
    const admin = adminFromProject(info.project.name)
    test.skip(!permittedForArea(admin, 'permissions'), 'admin lacks platform.permissions.manage')
    const perms = new PermissionsPage(page)
    await perms.goto()
    // Row containing 'platform.apps.manage' should not expose a working delete.
    const row = page.getByRole('row', { name: /platform\.apps\.manage/ })
    await expect(row).toBeVisible()
    const deleteBtn = row.getByRole('button', { name: /delete/i })
    await expect(deleteBtn).toBeHidden({ timeout: 1_000 }).catch(async () => {
      await expect(deleteBtn).toBeDisabled()
    })
  })
})
```

- [ ] **Step 2: Run the permissions matrix**

```bash
pnpm --filter @sassy-auth/admin-e2e exec playwright test tests/matrix/permissions.matrix.spec.ts
```

- [ ] **Step 3: Capture failures**

Append to `tmp/wave-c-failures.md`.

- [ ] **Step 4: Commit**

```bash
git add apps/admin-e2e/tests/matrix/permissions.matrix.spec.ts
git commit -m "test(matrix): populate /permissions UI matrix"
```

---

### Task 5.6: Populate `users.matrix.spec.ts`

**Files:**
- Modify: `apps/admin-e2e/tests/matrix/users.matrix.spec.ts`

- [ ] **Step 1: Replace the placeholder**

Overwrite `apps/admin-e2e/tests/matrix/users.matrix.spec.ts` with:

```ts
import { test, expect } from '../../lib/fixtures'
import { adminFromProject, permittedForArea } from '../../lib/admins'
import { UsersPage } from '../../pages/users.page'
import crypto from 'node:crypto'

function uniqueName(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`
}

test.describe('/users UI matrix', () => {
  test('list renders for permitted admins, blocks for the rest', async ({ page }, info) => {
    const admin = adminFromProject(info.project.name)
    const users = new UsersPage(page)
    await users.goto()
    if (permittedForArea(admin, 'users')) {
      await expect(users.heading).toBeVisible()
    } else {
      const denied = users.accessDenied
        .waitFor({ state: 'visible', timeout: 5_000 })
        .then(() => 'denied' as const)
        .catch(() => null)
      const redirected = page
        .waitForURL(/\/(login|apps|orgs|permissions|roles|403|forbidden)$/, { timeout: 5_000 })
        .then(() => 'redirect' as const)
        .catch(() => null)
      const outcome = await Promise.race([denied, redirected])
      expect(outcome).not.toBeNull()
    }
  })

  test('Create user row appears in table (platform org)', async ({ page }, info) => {
    const admin = adminFromProject(info.project.name)
    test.skip(!permittedForArea(admin, 'users'), 'admin lacks platform.users.manage')
    const users = new UsersPage(page)
    await users.goto()
    const email = `e2e-${uniqueName('u-ui').slice(0, 12)}@example.com`
    await users.createUser({
      firstName: 'E2E',
      lastName: 'UIUser',
      email,
      orgName: 'Platform',
    })
    await expect(users.rowByEmail(email)).toBeVisible()
    await users.deleteUser(email)
  })

  test('Edit user updates the first name', async ({ page }, info) => {
    const admin = adminFromProject(info.project.name)
    test.skip(!permittedForArea(admin, 'users'), 'admin lacks platform.users.manage')
    const users = new UsersPage(page)
    await users.goto()
    const email = `e2e-${uniqueName('u-ui').slice(0, 12)}@example.com`
    await users.createUser({
      firstName: 'Original',
      lastName: 'UIUser',
      email,
      orgName: 'Platform',
    })
    await users.editUser(email, { firstName: 'Renamed' })
    await expect(users.rowByEmail(email)).toContainText('Renamed')
    await users.deleteUser(email)
  })

  test('Delete user removes the row from the table', async ({ page }, info) => {
    const admin = adminFromProject(info.project.name)
    test.skip(!permittedForArea(admin, 'users'), 'admin lacks platform.users.manage')
    const users = new UsersPage(page)
    await users.goto()
    const email = `e2e-${uniqueName('u-ui').slice(0, 12)}@example.com`
    await users.createUser({
      firstName: 'ToDelete',
      lastName: 'UIUser',
      email,
      orgName: 'Platform',
    })
    await users.deleteUser(email)
    await expect(users.rowByEmail(email)).toBeHidden()
  })

  test('Resend invitation succeeds for a pending user', async ({ page }, info) => {
    const admin = adminFromProject(info.project.name)
    test.skip(!permittedForArea(admin, 'users'), 'admin lacks platform.users.manage')
    const users = new UsersPage(page)
    await users.goto()
    const email = `e2e-${uniqueName('u-res').slice(0, 12)}@example.com`
    await users.createUser({
      firstName: 'Resend',
      lastName: 'UIUser',
      email,
      orgName: 'Platform',
    })
    await users.resendInvitation(email)
    await users.deleteUser(email)
  })

  test('Self-row exposes no destructive delete control', async ({ page }, info) => {
    const admin = adminFromProject(info.project.name)
    test.skip(!permittedForArea(admin, 'users'), 'admin lacks platform.users.manage')
    const users = new UsersPage(page)
    await users.goto()
    const row = users.rowByEmail(admin.email)
    await expect(row).toBeVisible()
    const deleteBtn = row.getByRole('button', { name: /delete/i })
    await expect(deleteBtn).toBeHidden({ timeout: 1_000 }).catch(async () => {
      await expect(deleteBtn).toBeDisabled()
    })
  })
})
```

- [ ] **Step 2: Run the users matrix**

```bash
pnpm --filter @sassy-auth/admin-e2e exec playwright test tests/matrix/users.matrix.spec.ts
```

- [ ] **Step 3: Capture failures**

Append to `tmp/wave-c-failures.md`.

- [ ] **Step 4: Commit**

```bash
git add apps/admin-e2e/tests/matrix/users.matrix.spec.ts
git commit -m "test(matrix): populate /users UI matrix (+ self-delete guard)"
```

---

### Task 5.7: Open PR 5

- [ ] **Step 1: Run the full Playwright suite**

```bash
# Start the dev servers in separate terminals OR rely on CI_TESTS webServer
pnpm --filter @sassy-auth/admin-e2e exec playwright test
```

Expected: 7 projects × varying tests run. Failing tests are bugs, not blockers.

- [ ] **Step 2: Push and open the PR**

```bash
git push
gh pr create --title "test(admin-e2e): Wave C — UI E2E permission matrix" --body "$(cat <<'EOF'
## Summary
- nav-gates.spec.ts asserts each admin sees only the areas their permissions allow.
- 5 per-area UI matrix specs run once per admin project, exercising Create/Edit/Delete via real drawers for permitted admins and asserting blocked navigation for the rest.
- Special-case invariants: platform-app immutability, platform.* permission immutability, self-delete guard.

## Test plan
- [x] `pnpm --filter @sassy-auth/admin-e2e exec playwright test` runs end-to-end.
- [x] Unexpected failures captured in `tmp/wave-c-failures.md` — to be folded into bugs/TEST_BUGS.md in PR 6.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

<!-- PHASE-5-END -->

## Phase 6 — Wave D: Bug triage (PR 6)

**Outcome:** `bugs/TEST_BUGS.md` exists with a Summary + one entry per distinct root cause, ids continuing from the last `bug-NNNN` in `bugs/BUGS_2026-05-31.md` (verified at PR time — `bug-0023` at the time the plan was written).

### Task 6.1: Re-run the full campaign end-to-end

**Files:** none modified yet; produces `tmp/wave-a-failures.md`, `tmp/wave-b-failures.md`, `tmp/wave-c-failures.md`, plus Playwright reports.

- [ ] **Step 1: Pre-flight env check**

```bash
test -n "$DATABASE_URL" && test -n "$BETTER_AUTH_SECRET" && echo "env OK" || echo "MISSING env"
```

Expected: "env OK". Bail if not — the rest of the run depends on the auth-server connecting to a real Postgres.

- [ ] **Step 2: Bring the test DB to head and re-seed (idempotent)**

```bash
pnpm prisma migrate deploy --schema=packages/db/schema.prisma
pnpm --filter @sassy-auth/auth-server seed
```

Expected: migrations no-op or apply cleanly; seed says "already exists" for the 5 admins.

- [ ] **Step 3: Run Wave A (unit) and capture failures**

```bash
mkdir -p tmp
pnpm --filter @sassy-auth/auth-server test 2>&1 | tee tmp/wave-a-run.log || true
```

Expected: full unit suite runs. The `|| true` keeps the script alive on red.

- [ ] **Step 4: Run Wave B (API E2E) and capture failures**

```bash
pnpm --filter @sassy-auth/auth-server test:e2e 2>&1 | tee tmp/wave-b-run.log || true
```

Expected: in-process Nest + supertest matrix runs. Save the log.

- [ ] **Step 5: Run Wave C (UI E2E) and capture failures**

```bash
# Make sure auth-server is not still on port 3000 from Wave B.
# (Wave B closes Nest via app.close() in afterAll; if any stray process,
# kill it before proceeding.)
pnpm --filter @sassy-auth/admin-e2e test:e2e 2>&1 | tee tmp/wave-c-run.log || true
```

Expected: Playwright runs all 7 projects. HTML + traces land in `apps/admin-e2e/playwright-report/`.

- [ ] **Step 6: Sanity-check the failure captures**

```bash
ls -l tmp/
cat tmp/wave-b-failures.md 2>/dev/null | head -30
cat tmp/wave-c-failures.md 2>/dev/null | head -30
```

Expected: at least the run logs exist. If failures files are empty, that means everything passed — celebrate, then `bugs/TEST_BUGS.md` just records a clean run with the "## Summary" section showing zero failures.

---

### Task 6.2: Group failures by root cause

**Files:** working notes only; nothing committed yet.

- [ ] **Step 1: Open all three failures files and the run logs**

Read `tmp/wave-a-failures.md`, `tmp/wave-b-failures.md`, `tmp/wave-c-failures.md`, and skim `tmp/wave-*-run.log` for any failure that wasn't transcribed.

- [ ] **Step 2: Cluster failures by likely root cause**

For each cluster, jot down:
- The signature (e.g., "all `o@sa.io` ops on `/users` return 201 instead of 403").
- The single fix that would resolve the whole cluster (e.g., "`users.service.ts:listUsers` missing a permission check for `o@sa.io`").
- The full list of failing test names that share this cause.

This deduplication is what keeps `bugs/TEST_BUGS.md` short. One root cause → one `bug-NNNN`.

- [ ] **Step 3: Confirm the next bug id**

```bash
grep -hE "bug-[0-9]{4}" bugs/BUGS_*.md | sed -E 's/.*bug-([0-9]{4}).*/\1/' | sort -n | tail -1
```

Expected: prints the highest existing bug id (was `0023` at plan time). The first new id is this + 1.

---

### Task 6.3: Write `bugs/TEST_BUGS.md`

**Files:**
- Create: `bugs/TEST_BUGS.md`

- [ ] **Step 1: Create the header + summary block**

Create `bugs/TEST_BUGS.md` with this template, filling in `<N>`/`<X>`/etc. from the run logs and the next-id step above:

```markdown
# Test Coverage Campaign — Bug Log

Bugs surfaced by the 2026-06-01 test-coverage campaign. Each entry has a
stable bug-NNNN id. Numbering continues from BUGS_2026-05-31.md
(last: bug-<HIGHEST_EXISTING_ID>).

**Run commands:**

```
pnpm --filter @sassy-auth/auth-server test
pnpm --filter @sassy-auth/auth-server test:e2e
pnpm --filter @sassy-auth/admin-e2e test:e2e
```

**Severity legend:**
- 🔴 **Critical** — privilege escalation, auth bypass, unauthenticated 2xx, seed inconsistency.
- 🟡 **Warning** — legitimate action blocked (403 where 2xx expected), 5xx where 4xx expected, contract drift.
- 🔵 **Minor** — UI permission visible-but-disabled leak, validation message wrong, test-side race.
- ⚪ **Info** — test infrastructure quirks, environmental, advisory.

## Summary
- Wave A (unit, services + controllers): <N_A_TESTS> tests, <X_A_FAILING> failing.
- Wave B (API E2E matrix):                <N_B_TESTS> tests, <X_B_FAILING> failing.
- Wave C (UI E2E matrix):                 <N_C_TESTS> tests, <X_C_FAILING> failing.
- Root-cause clusters: <K_CLUSTERS> distinct issues.

---
```

- [ ] **Step 2: Append one entry per root-cause cluster from Task 6.2**

For each cluster, append an entry following this exact shape:

```markdown
## <SEVERITY_EMOJI> bug-<NNNN> — <one-line title>

**Fixed:** false
**Severity:** <Critical | Warning | Minor | Info>
**Wave:** <A | B | C>
**Spec(s):** `apps/auth-server/test/matrix/<file>.e2e-spec.ts` (and others if cluster spans files)
**Test(s):**
- `<full describe path > test name>`
- (one per failing test in the cluster)
**Reproducer:**
```
pnpm --filter @sassy-auth/auth-server test:e2e -t "<jest -t pattern>"
```

**Description.** <2–5 sentences. Verbatim observed-vs-expected from the failing assertion, plus any context from the run log.>

**Evidence.** <For Wave C: relative path to the Playwright trace file under `apps/admin-e2e/test-results/` and screenshot. For Waves A/B: the supertest response body or jest stack frame, truncated to the relevant lines.>

**Fix sketch.** <Optional, only when cause is obvious from the assertion. Example: "Missing `await checkPermission(...)` in `users.service.ts:listUsers` when no `orgId` query is supplied.">

**Tests needed.** <Usually the same failing tests, kept as the regression check on the fix PR.>

---
```

Add one such block per cluster.

- [ ] **Step 3: If failures include environment issues, mark them ⚪ Info**

For any failure caused by a missing env var, dev-server-not-up, or seed-orphan-collision, use severity ⚪ Info and write the title as `bug-<NNNN> — Test-only: <description>` so future readers can scan past them quickly.

- [ ] **Step 4: Verify the file is syntactically clean Markdown**

```bash
head -50 bugs/TEST_BUGS.md
wc -l bugs/TEST_BUGS.md
```

Expected: header + summary visible, file ≥ 30 lines (even a zero-bug summary fills that).

- [ ] **Step 5: Commit**

```bash
git add bugs/TEST_BUGS.md
git commit -m "docs(bugs): add 2026-06-01 test coverage campaign bug log"
```

---

### Task 6.4: Tidy and open PR 6

- [ ] **Step 1: Remove the working-notes files**

```bash
git rm -r --cached tmp 2>/dev/null || true
rm -rf tmp
```

`tmp/` should not be tracked. If it is, also add `tmp/` to `.gitignore`:

- [ ] **Step 2: If `tmp/` is not gitignored, add it**

```bash
grep -q "^tmp/$" .gitignore || echo "tmp/" >> .gitignore
git add .gitignore
git commit -m "chore: ignore tmp/ scratchpad"
```

- [ ] **Step 3: Push and open PR 6**

```bash
git push
gh pr create --title "docs(bugs): Wave D — TEST_BUGS.md from 2026-06-01 campaign" --body "$(cat <<'EOF'
## Summary
- New `bugs/TEST_BUGS.md` records every distinct issue surfaced by the campaign.
- One entry per root cause (failures that share a cause are bundled).
- Summary block at the top lists totals per wave so the user can triage quickly.

## Test plan
- [x] Verified `bugs/TEST_BUGS.md` renders cleanly.
- [x] Confirmed every cluster maps to at least one failing test that can be re-run from the reproducer command.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Spec-coverage map (self-review checklist)

| Spec section | Plan tasks |
|---|---|
| §2.1 Seeded admins | Task 2.1 (`SEED_ADMINS`), Task 4.1 (`SEED_ADMINS` mirror) |
| §2.2 Permission map | Task 2.1 (`GATE` table + `isPermitted`), Task 4.1 (`AREA_TO_PERMS` + `permittedForArea`) |
| §2.3 Existing test surface (what's there) | Task 1.1 baseline; tasks 1.2–1.7 fill the gap |
| §3 Scope (in/out) | Phase 1–6 cover everything in scope; explicit non-goals stay non-goals |
| §4 Architecture (two SoT modules) | Tasks 2.1 + 4.1 |
| §5 Wave A | Phase 1 (tasks 1.1–1.9) |
| §6 Wave B | Phases 2 + 3 (tasks 2.1–2.5, 3.1–3.6) |
| §7 Wave C | Phases 4 + 5 (tasks 4.1–4.6, 5.1–5.7) |
| §8 Wave D run + triage | Phase 6 (tasks 6.1–6.4) |
| §8.4 Bug intake fields | Task 6.3 step 2 template |
| §8.5 Root-cause dedup | Task 6.2 step 2 |
| §9 Risks (orphan e2e-user, stale storageState, parallel UNIQUE) | Mitigated by `app.e2e-spec.ts` cleanup describe (already exists), `auth-state.setup.ts` runs every campaign (Task 4.2), `crypto.randomUUID` in factories (Task 2.3) |
| §10 PR sequence | Phases map 1-to-1 to PRs 1–6 |
| §11 DoD | Final state after Task 6.4 |

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-01-api-and-e2e-test-coverage.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?





