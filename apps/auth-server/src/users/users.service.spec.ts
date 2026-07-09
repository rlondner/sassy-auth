import { Test } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { SqidService } from '../common/sqid/sqid.service';
import { LoggerService } from '../common/logger/logger.service';
import { EmailService } from '../email/email.service';

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
    account: { create: jest.fn(), findFirst: jest.fn() },
    session: { deleteMany: jest.fn() },
  },
}));

jest.mock('../common/permissions/check-permission', () => ({
  checkPermission: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../common/permissions/assert-caller-can-grant-system-perms', () => ({
  assertCallerCanGrantSystemPerms: jest.fn().mockResolvedValue(undefined),
}));

const mockSend = jest.fn().mockResolvedValue({ sent: true });

jest.mock('../auth/auth.config', () => ({
  auth: { api: { requestPasswordReset: jest.fn().mockResolvedValue({ status: true }) } },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockAssertGrant = require('../common/permissions/assert-caller-can-grant-system-perms')
  .assertCallerCanGrantSystemPerms as jest.Mock;

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
  account: { create: jest.Mock; findFirst: jest.Mock };
  session: { deleteMany: jest.Mock };
};

// bug-0186: fixed timestamps so assertions on the ISO-serialized
// output stay stable. `lastLoginAt` defaults to null (never signed
// in); tests that exercise the login-tracking path override it.
const FIXTURE_CREATED_AT = new Date('2026-01-15T12:00:00.000Z');

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
  createdAt: FIXTURE_CREATED_AT,
  lastLoginAt: null,
  org: { publicId: 'org1' },
  betterAuthUser: { email: 'alice@example.com' },
  ...overrides,
});

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        SqidService,
        { provide: LoggerService, useValue: { log: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(), getWinstonLogger: () => ({ info: jest.fn(), warn: jest.fn(), child: jest.fn() }) } },
        { provide: EmailService, useValue: { send: mockSend } },
      ],
    }).compile();
    service = module.get(UsersService);
    jest.clearAllMocks();
    mockSend.mockClear();
    mockPrisma.$transaction.mockImplementation((fn: (tx: typeof mockPrisma) => Promise<unknown>) => fn(mockPrisma));
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

    // bug-0186: previously the admin `User` type declared `createdAt`
    // and `lastLoginAt` fields that the API never returned. Both are
    // now real: `createdAt` is a NOT-NULL column with a
    // CURRENT_TIMESTAMP default; `lastLoginAt` is nullable and
    // populated by (a) `token.controller.ts::directLogin` on success
    // and (b) the BetterAuth `databaseHooks.session.create.after`
    // hook in `auth.config.ts`.
    it('includes createdAt (ISO string) and lastLoginAt (ISO string | null) in list output', async () => {
      const loginTime = new Date('2026-05-01T09:30:00.000Z');
      mockPrisma.saUser.findMany.mockResolvedValue([
        makeSaUser({ lastLoginAt: loginTime }),
        makeSaUser({ publicId: 'usr2', lastLoginAt: null }),
      ]);
      const result = await service.listUsers('ba-caller', {});
      expect(result[0]).toMatchObject({
        createdAt: FIXTURE_CREATED_AT.toISOString(),
        lastLoginAt: loginTime.toISOString(),
      });
      expect(result[1]).toMatchObject({
        createdAt: FIXTURE_CREATED_AT.toISOString(),
        lastLoginAt: null,
      });
    });

    it('passes orgId filter to prisma when provided', async () => {
      mockPrisma.saOrg.findUnique.mockResolvedValue({ id: 1, publicId: 'org1' });
      mockPrisma.saUser.findMany.mockResolvedValue([]);
      await service.listUsers('ba-caller', { orgPublicId: 'org1' });
      expect(mockPrisma.saUser.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ org: expect.objectContaining({ publicId: 'org1' }) }) }),
      );
    });

    it('throws NotFoundException when orgPublicId does not match any org', async () => {
      mockPrisma.saOrg.findUnique.mockResolvedValue(null);
      await expect(service.listUsers('ba-caller', { orgPublicId: 'missing-org' })).rejects.toBeInstanceOf(NotFoundException);
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
      expect(result[0].publicId).toBe('role1');
      expect(result[0].name).toBe('Platform Admin');
    });

    it('maps permissions within roles (non-empty permissions list)', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue({
        ...makeSaUser(),
        roles: [
          {
            role: {
              publicId: 'role1', name: 'Editor', app: { publicId: 'app1' },
              permissions: [
                { permission: { publicId: 'sq_p1', name: 'apps.read' } },
                { permission: { publicId: 'sq_p2', name: 'apps.write' } },
              ],
            },
          },
        ],
      });
      const result = await service.getUserRoles('ba-caller', 'usr1');
      expect(result[0].permissions).toEqual([
        { publicId: 'sq_p1', name: 'apps.read', appId: 'app1' },
        { publicId: 'sq_p2', name: 'apps.write', appId: 'app1' },
      ]);
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

    it('throws ConflictException when Prisma reports a unique-violation (P2002)', async () => {
      const { ConflictException } = await import('@nestjs/common');
      mockPrisma.$transaction.mockImplementationOnce(() => {
        const err = new Error('Unique constraint failed');
        (err as Error & { code?: string }).code = 'P2002';
        return Promise.reject(err);
      });
      await expect(service.createUser('ba-caller', dto)).rejects.toBeInstanceOf(ConflictException);
    });

    it('atomically wires roleIds and directPermissionIds inside the create transaction', async () => {
      // Org lookup for app-scope validation
      mockPrisma.saOrg.findUnique.mockResolvedValue({ id: 9, publicId: 'org1', appId: 4, name: 'Plat', isPlatform: false });
      // saPermission.findMany / saRole.findMany are each called twice:
      // once for the escalation-guard pre-resolve and once for the app-scope
      // resolver. Stub each call shape separately with mockResolvedValueOnce.
      mockPrisma.saPermission.findMany
        .mockResolvedValueOnce([{ name: 'apps.read', isSystem: false }])
        .mockResolvedValueOnce([{ id: 30, publicId: 'pA', appId: 4, isSystem: false }]);
      mockPrisma.saRole.findMany
        .mockResolvedValueOnce([{ permissions: [] }])
        .mockResolvedValueOnce([{ id: 20, publicId: 'rA', appId: 4 }]);

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

    it('sends an invitation email to the new user', async () => {
      await service.createUser('ba-caller', dto);
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'jane@example.com', subject: expect.stringMatching(/invit/i) }),
      );
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
  });

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

    it('updates all optional fields (lastName, phoneNumber, username)', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue(makeSaUser());
      mockPrisma.saUser.update.mockResolvedValue(
        makeSaUser({ lastName: 'Jones', phoneNumber: '+1555000', username: 'alice_j' }),
      );
      const result = await service.updateUser('ba-caller', 'usr1', {
        lastName: 'Jones', phoneNumber: '+1555000', username: 'alice_j',
      });
      expect(mockPrisma.saUser.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ lastName: 'Jones', phoneNumber: '+1555000', username: 'alice_j' }),
        }),
      );
      expect(result.lastName).toBe('Jones');
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

  describe('assignRole', () => {
    it('creates a SaUserRole link', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue(makeSaUser());
      mockPrisma.saRole.findUnique.mockResolvedValue({ id: 5, publicId: 'role1', permissions: [] });
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

    it('is idempotent when the role is already assigned (Prisma P2002)', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue(makeSaUser());
      mockPrisma.saRole.findUnique.mockResolvedValue({ id: 5, publicId: 'role1', permissions: [] });
      mockPrisma.saUserRole.create.mockImplementationOnce(() => {
        const err = new Error('Unique constraint failed');
        (err as Error & { code?: string }).code = 'P2002';
        return Promise.reject(err);
      });
      await expect(service.assignRole('ba-caller', 'usr1', { roleId: 'role1' })).resolves.toBeUndefined();
    });
  });

  describe('removeRole', () => {
    it('deletes the SaUserRole link', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue(makeSaUser());
      mockPrisma.saRole.findUnique.mockResolvedValue({ id: 5, publicId: 'role1', permissions: [] });
      mockPrisma.saUserRole.delete.mockResolvedValue(undefined);
      await expect(service.removeRole('ba-caller', 'usr1', 'role1')).resolves.toBeUndefined();
      expect(mockPrisma.saUserRole.delete).toHaveBeenCalledWith({
        where: { userId_roleId: { userId: 1, roleId: 5 } },
      });
    });
  });

  describe('resendInvitation', () => {
    it('invalidates old tokens and creates a new invitation', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue(makeSaUser({ status: 'pending' }));
      mockPrisma.saInvitation.updateMany.mockResolvedValue(undefined);
      mockPrisma.saInvitation.create.mockResolvedValue({ token: 'newtoken123', expiresAt: new Date() });

      const result = await service.resendInvitation('ba-caller', 'usr1');
      expect(mockPrisma.saInvitation.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ userId: 1, usedAt: null }) }),
      );
      expect(result.inviteUrl).toContain('newtoken123');
    });

    it('sends the invitation email on resend', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue(makeSaUser({ status: 'pending', betterAuthUser: { email: 'alice@example.com' } }));
      mockPrisma.saInvitation.updateMany.mockResolvedValue(undefined);
      mockPrisma.saInvitation.create.mockResolvedValue({ token: 'newtoken123', expiresAt: new Date() });
      await service.resendInvitation('ba-caller', 'usr1');
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'alice@example.com', subject: expect.stringMatching(/invit/i) }),
      );
    });

    it('throws BadRequestException when user is already active', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue(makeSaUser({ status: 'active' }));
      const { BadRequestException } = await import('@nestjs/common');
      await expect(service.resendInvitation('ba-caller', 'usr1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFoundException when user not found', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue(null);
      await expect(service.resendInvitation('ba-caller', 'missing-usr')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('deleteUser self-delete guard', () => {
    it('throws ForbiddenException when caller targets their own SaUser', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue({
        publicId: 'me-public',
        orgId: 1,
        betterAuthUserId: 'ba-caller',
      });
      await expect(service.deleteUser('ba-caller', 'me-public')).rejects.toThrow(/own account/);
      expect(mockPrisma.saUser.delete).not.toHaveBeenCalled();
    });
  });

  describe('createUser re-throw non-P2002 error', () => {
    it('re-throws unexpected errors from the transaction', async () => {
      mockPrisma.saOrg.findUnique.mockResolvedValue({ id: 2, publicId: 'org1' });
      mockPrisma.$transaction.mockImplementationOnce(() => {
        return Promise.reject(new Error('Connection timeout'));
      });
      await expect(service.createUser('ba-caller', {
        firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com', orgId: 'org1',
      })).rejects.toThrow('Connection timeout');
    });
  });

  describe('assignRole re-throw non-P2002 error', () => {
    it('re-throws unexpected errors from prisma.saUserRole.create', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue(makeSaUser());
      mockPrisma.saRole.findUnique.mockResolvedValue({ id: 5, publicId: 'role1', permissions: [] });
      const unexpected = new Error('DB timeout');
      mockPrisma.saUserRole.create.mockImplementationOnce(() => Promise.reject(unexpected));
      await expect(service.assignRole('ba-caller', 'usr1', { roleId: 'role1' })).rejects.toThrow('DB timeout');
    });
  });

  describe('removeRole NotFoundException for missing role', () => {
    it('throws NotFoundException when role not found', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue(makeSaUser());
      mockPrisma.saRole.findUnique.mockResolvedValue(null);
      await expect(service.removeRole('ba-caller', 'usr1', 'missing-role')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFoundException when user not found', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue(null);
      await expect(service.removeRole('ba-caller', 'missing-user', 'role1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

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
      // saRole.findMany is called twice: once by the escalation guard,
      // once by resolveRoleIdsForApp. Use mockResolvedValueOnce twice.
      mockPrisma.saRole.findMany
        .mockResolvedValueOnce([
          { permissions: [] },
          { permissions: [] },
        ])
        .mockResolvedValueOnce([
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
      mockPrisma.saRole.findMany
        .mockResolvedValueOnce([
          { permissions: [] },
          { permissions: [] },
        ])
        .mockResolvedValueOnce([
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

  describe('setUserDirectPermissions escalation guard', () => {
    const callerBaId = 'ba-caller';
    const userPublicId = 'usrPub';
    const orgWithApp = { id: 7, appId: 4 };

    function primeFindUnique() {
      mockPrisma.saUser.findUnique.mockResolvedValueOnce({
        id: 1, publicId: userPublicId, betterAuthUserId: 'ba-target', orgId: orgWithApp.id,
      });
      mockPrisma.saOrg.findUnique.mockResolvedValueOnce({ id: orgWithApp.id, appId: orgWithApp.appId });
    }

    it('allows an org.users.manage holder to grant org.users.manage to a peer in their own org', async () => {
      primeFindUnique();
      // saPermission.findMany is called twice: once by the escalation guard
      // pre-resolve query (selecting name+isSystem) and once by
      // resolvePermissionIdsForApp (selecting id+publicId+appId+isSystem).
      mockPrisma.saPermission.findMany
        .mockResolvedValueOnce([{ name: 'org.users.manage', isSystem: true }])
        .mockResolvedValueOnce([
          { id: 30, publicId: 'pUM', appId: orgWithApp.appId, isSystem: true },
        ]);
      mockAssertGrant.mockResolvedValueOnce(undefined);

      await expect(
        service.setUserDirectPermissions(callerBaId, userPublicId, ['pUM']),
      ).resolves.toBeUndefined();

      expect(mockAssertGrant).toHaveBeenCalledWith(callerBaId, ['org.users.manage']);
      expect(mockPrisma.saUserPermission.createMany).toHaveBeenCalledWith({
        data: [{ userId: 1, permissionId: 30 }],
      });
    });

    it('rejects an org.users.manage holder trying to grant org.roles.manage', async () => {
      primeFindUnique();
      mockPrisma.saPermission.findMany.mockResolvedValueOnce([
        { name: 'org.roles.manage', isSystem: true },
      ]);
      mockAssertGrant.mockRejectedValueOnce(
        new ForbiddenException('Cannot grant system permission(s) you do not hold: org.roles.manage'),
      );

      await expect(
        service.setUserDirectPermissions(callerBaId, userPublicId, ['pRM']),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(mockAssertGrant).toHaveBeenCalledWith(callerBaId, ['org.roles.manage']);
      expect(mockPrisma.saUserPermission.deleteMany).not.toHaveBeenCalled();
      expect(mockPrisma.saUserPermission.createMany).not.toHaveBeenCalled();
    });

    it('rejects an org.users.manage holder trying to grant platform.users.manage', async () => {
      primeFindUnique();
      // Guard pre-resolve sees the perm as non-system (isSystem=false), so it
      // does NOT add it to the guard list — the actual rejection comes from
      // resolvePermissionIdsForApp, which sees appId mismatch on a non-system
      // perm and throws BadRequestException.
      mockPrisma.saPermission.findMany
        .mockResolvedValueOnce([{ name: 'platform.users.manage', isSystem: false }])
        .mockResolvedValueOnce([
          { id: 99, publicId: 'pPUM', appId: 1, isSystem: false },
        ]);
      mockAssertGrant.mockResolvedValueOnce(undefined);

      await expect(
        service.setUserDirectPermissions(callerBaId, userPublicId, ['pPUM']),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mockPrisma.saUserPermission.createMany).not.toHaveBeenCalled();
    });

    it('allows platform.users.manage holder to grant any org.* to any tenant user', async () => {
      primeFindUnique();
      mockPrisma.saPermission.findMany
        .mockResolvedValueOnce([
          { name: 'org.users.manage', isSystem: true },
          { name: 'org.roles.manage', isSystem: true },
        ])
        .mockResolvedValueOnce([
          { id: 30, publicId: 'pUM', appId: orgWithApp.appId, isSystem: true },
          { id: 31, publicId: 'pRM', appId: orgWithApp.appId, isSystem: true },
        ]);
      // Platform-tier holders pass the guard unconditionally — stub success.
      mockAssertGrant.mockResolvedValueOnce(undefined);

      await expect(
        service.setUserDirectPermissions(callerBaId, userPublicId, ['pUM', 'pRM']),
      ).resolves.toBeUndefined();

      expect(mockAssertGrant).toHaveBeenCalledWith(
        callerBaId,
        ['org.users.manage', 'org.roles.manage'],
      );
      expect(mockPrisma.saUserPermission.createMany).toHaveBeenCalledWith({
        data: [
          { userId: 1, permissionId: 30 },
          { userId: 1, permissionId: 31 },
        ],
      });
    });
  });

  describe('setUserRoles escalation guard', () => {
    const callerBaId = 'ba-caller';
    const userPublicId = 'usrPub';
    const orgWithApp = { id: 7, appId: 4 };

    function primeFindUnique() {
      mockPrisma.saUser.findUnique.mockResolvedValueOnce({
        id: 1, publicId: userPublicId, betterAuthUserId: 'ba-target', orgId: orgWithApp.id,
      });
      mockPrisma.saOrg.findUnique.mockResolvedValueOnce({ id: orgWithApp.id, appId: orgWithApp.appId });
    }

    it('rejects assigning a role containing org.roles.manage when caller lacks it', async () => {
      primeFindUnique();
      // saRole.findMany is called twice: once for the escalation guard
      // (selecting permissions.permission.name+isSystem) and once by
      // resolveRoleIdsForApp (selecting id+publicId+appId).
      mockPrisma.saRole.findMany.mockResolvedValueOnce([
        {
          permissions: [
            { permission: { name: 'org.roles.manage', isSystem: true } },
          ],
        },
      ]);
      mockAssertGrant.mockRejectedValueOnce(
        new ForbiddenException('Cannot grant system permission(s) you do not hold: org.roles.manage'),
      );

      await expect(
        service.setUserRoles(callerBaId, userPublicId, ['rRM']),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(mockAssertGrant).toHaveBeenCalledWith(callerBaId, ['org.roles.manage']);
      expect(mockPrisma.saUserRole.deleteMany).not.toHaveBeenCalled();
      expect(mockPrisma.saUserRole.createMany).not.toHaveBeenCalled();
    });

    it('allows assigning a role containing only non-system perms', async () => {
      primeFindUnique();
      mockPrisma.saRole.findMany
        .mockResolvedValueOnce([
          {
            permissions: [
              { permission: { name: 'apps.read', isSystem: false } },
              { permission: { name: 'apps.write', isSystem: false } },
            ],
          },
        ])
        .mockResolvedValueOnce([
          { id: 20, publicId: 'rA', appId: orgWithApp.appId },
        ]);
      mockAssertGrant.mockResolvedValueOnce(undefined);

      await expect(
        service.setUserRoles(callerBaId, userPublicId, ['rA']),
      ).resolves.toBeUndefined();

      // No system perms => the guard is invoked with an empty list (it
      // short-circuits internally, but the call still happens).
      expect(mockAssertGrant).toHaveBeenCalledWith(callerBaId, []);
      expect(mockPrisma.saUserRole.createMany).toHaveBeenCalledWith({
        data: [{ userId: 1, roleId: 20 }],
      });
    });
  });

  describe('assignRole escalation guard', () => {
    it('rejects assigning a role whose perms include a system perm the caller lacks', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValueOnce(makeSaUser());
      mockPrisma.saRole.findUnique.mockResolvedValueOnce({
        id: 5,
        publicId: 'role1',
        permissions: [
          { permission: { name: 'org.roles.manage', isSystem: true } },
        ],
      });
      mockAssertGrant.mockRejectedValueOnce(
        new ForbiddenException('Cannot grant system permission(s) you do not hold: org.roles.manage'),
      );

      await expect(
        service.assignRole('ba-caller', 'usr1', { roleId: 'role1' }),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(mockAssertGrant).toHaveBeenCalledWith('ba-caller', ['org.roles.manage']);
      expect(mockPrisma.saUserRole.create).not.toHaveBeenCalled();
    });

    it('allows assigning a role with only non-system perms', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValueOnce(makeSaUser());
      mockPrisma.saRole.findUnique.mockResolvedValueOnce({
        id: 5,
        publicId: 'role1',
        permissions: [
          { permission: { name: 'apps.read', isSystem: false } },
        ],
      });
      mockPrisma.saUserRole.create.mockResolvedValueOnce(undefined);
      mockAssertGrant.mockResolvedValueOnce(undefined);

      await expect(
        service.assignRole('ba-caller', 'usr1', { roleId: 'role1' }),
      ).resolves.toBeUndefined();

      expect(mockAssertGrant).toHaveBeenCalledWith('ba-caller', []);
      expect(mockPrisma.saUserRole.create).toHaveBeenCalled();
    });
  });

  // bug-0097 — the escalation guard was previously only applied to
  // assignRole and setUserRoles. removeRole was the asymmetric outlier:
  // a caller could strip a role from a user even if they weren't
  // themselves authorized to grant its system perms. Revoke-then-
  // re-grant is the same escalation surface in reverse.
  describe('removeRole escalation guard (bug-0097)', () => {
    it('rejects removing a role whose perms include a system perm the caller lacks', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValueOnce(makeSaUser());
      mockPrisma.saRole.findUnique.mockResolvedValueOnce({
        id: 5,
        publicId: 'role1',
        permissions: [
          { permission: { name: 'org.roles.manage', isSystem: true } },
        ],
      });
      mockAssertGrant.mockRejectedValueOnce(
        new ForbiddenException('Cannot grant system permission(s) you do not hold: org.roles.manage'),
      );

      await expect(
        service.removeRole('ba-caller', 'usr1', 'role1'),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(mockAssertGrant).toHaveBeenCalledWith('ba-caller', ['org.roles.manage']);
      expect(mockPrisma.saUserRole.delete).not.toHaveBeenCalled();
    });

    it('allows removing a role with only non-system perms', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValueOnce(makeSaUser());
      mockPrisma.saRole.findUnique.mockResolvedValueOnce({
        id: 5,
        publicId: 'role1',
        permissions: [
          { permission: { name: 'apps.read', isSystem: false } },
        ],
      });
      mockPrisma.saUserRole.delete.mockResolvedValueOnce(undefined);
      mockAssertGrant.mockResolvedValueOnce(undefined);

      await expect(
        service.removeRole('ba-caller', 'usr1', 'role1'),
      ).resolves.toBeUndefined();

      expect(mockAssertGrant).toHaveBeenCalledWith('ba-caller', []);
      expect(mockPrisma.saUserRole.delete).toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    const mockAuth = require('../auth/auth.config').auth.api.requestPasswordReset as jest.Mock;

    beforeEach(() => {
      mockPrisma.saUser.findUnique.mockResolvedValue(
        makeSaUser({ status: 'active', betterAuthUserId: 'ba-1', orgId: 1, betterAuthUser: { email: 'a@b.co' } }),
      );
      mockPrisma.account.findFirst.mockResolvedValue({ id: 'acc1', providerId: 'credential' });
      mockAuth.mockResolvedValue({ status: true });
    });

    it('triggers a reset and returns the captured resetUrl', async () => {
      // Simulate the hook writing a URL during requestPasswordReset.
      mockAuth.mockImplementation(async () => {
        const { captureResetUrl } = require('../auth/reset-url-context');
        captureResetUrl('http://localhost:3001/reset-password?token=xyz');
        return { status: true };
      });
      const res = await service.resetPassword('ba-caller', 'usr1');
      expect(mockAuth).toHaveBeenCalledWith(
        expect.objectContaining({ body: expect.objectContaining({ email: 'a@b.co' }) }),
      );
      expect(res.resetUrl).toContain('token=xyz');
    });

    it('throws NotFoundException when the user does not exist', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue(null);
      await expect(service.resetPassword('ba-caller', 'nope')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws BadRequestException when the user has no credential account', async () => {
      mockPrisma.account.findFirst.mockResolvedValue(null);
      await expect(service.resetPassword('ba-caller', 'usr1')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('updateUser status kill-switch', () => {
    beforeEach(() => {
      mockPrisma.saUser.findUnique.mockResolvedValue(makeSaUser({ betterAuthUserId: 'ba-target', orgId: 1 }));
      mockPrisma.saUser.update.mockResolvedValue(makeSaUser({ status: 'inactive' }));
      mockPrisma.session.deleteMany.mockResolvedValue({ count: 2 });
    });

    it('deletes the user sessions when status becomes inactive', async () => {
      await service.updateUser('ba-caller', 'usr1', { status: 'inactive' });
      expect(mockPrisma.session.deleteMany).toHaveBeenCalledWith({ where: { userId: 'ba-target' } });
    });

    it('does not delete sessions for a non-inactive update', async () => {
      mockPrisma.saUser.update.mockResolvedValue(makeSaUser({ status: 'active' }));
      await service.updateUser('ba-caller', 'usr1', { firstName: 'New' });
      expect(mockPrisma.session.deleteMany).not.toHaveBeenCalled();
    });

    it('forbids deactivating your own account', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue(makeSaUser({ betterAuthUserId: 'ba-self', orgId: 1 }));
      await expect(service.updateUser('ba-self', 'usr1', { status: 'inactive' })).rejects.toBeInstanceOf(ForbiddenException);
      expect(mockPrisma.session.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('createUser escalation guard', () => {
    const dto = {
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      orgId: 'org1',
    };

    it('aggregates system perms from initial direct perms and roles into a single guard call', async () => {
      mockPrisma.saOrg.findUnique.mockResolvedValueOnce({ id: 9, publicId: 'org1', appId: 4 });
      // saPermission.findMany called for guard pre-resolve, then by
      // resolvePermissionIdsForApp.
      mockPrisma.saPermission.findMany
        .mockResolvedValueOnce([{ name: 'org.users.manage', isSystem: true }])
        .mockResolvedValueOnce([
          { id: 30, publicId: 'pUM', appId: 4, isSystem: true },
        ]);
      // saRole.findMany called for guard pre-resolve, then by
      // resolveRoleIdsForApp.
      mockPrisma.saRole.findMany
        .mockResolvedValueOnce([
          {
            permissions: [
              { permission: { name: 'org.roles.manage', isSystem: true } },
              // duplicate of the direct perm should be deduped in the guard call
              { permission: { name: 'org.users.manage', isSystem: true } },
              { permission: { name: 'apps.read', isSystem: false } },
            ],
          },
        ])
        .mockResolvedValueOnce([{ id: 20, publicId: 'rA', appId: 4 }]);
      mockPrisma.user.create.mockResolvedValue(undefined);
      mockPrisma.saUser.create.mockResolvedValue(
        makeSaUser({ id: 7, publicId: 'newPub' }),
      );
      mockPrisma.saInvitation.create.mockResolvedValue({ token: 'tok-1' });
      mockAssertGrant.mockResolvedValueOnce(undefined);

      await service.createUser('ba-caller', {
        ...dto,
        roleIds: ['rA'],
        directPermissionIds: ['pUM'],
      });

      // The guard receives the deduped union of system perm names.
      expect(mockAssertGrant).toHaveBeenCalledTimes(1);
      const [, names] = mockAssertGrant.mock.calls[0];
      expect(new Set(names)).toEqual(new Set(['org.users.manage', 'org.roles.manage']));
    });

    it('rejects createUser when the caller cannot grant a requested system perm', async () => {
      mockPrisma.saOrg.findUnique.mockResolvedValueOnce({ id: 9, publicId: 'org1', appId: 4 });
      mockPrisma.saPermission.findMany.mockResolvedValueOnce([
        { name: 'org.roles.manage', isSystem: true },
      ]);
      mockAssertGrant.mockRejectedValueOnce(
        new ForbiddenException('Cannot grant system permission(s) you do not hold: org.roles.manage'),
      );

      await expect(
        service.createUser('ba-caller', {
          ...dto,
          directPermissionIds: ['pRM'],
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(mockPrisma.saUser.create).not.toHaveBeenCalled();
    });
  });
});
