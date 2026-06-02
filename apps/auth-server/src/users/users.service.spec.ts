import { Test } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { SqidService } from '../common/sqid/sqid.service';
import { LoggerService } from '../common/logger/logger.service';

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
      providers: [
        UsersService,
        SqidService,
        { provide: LoggerService, useValue: { log: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(), getWinstonLogger: () => ({ info: jest.fn(), warn: jest.fn(), child: jest.fn() }) } },
      ],
    }).compile();
    service = module.get(UsersService);
    jest.clearAllMocks();
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

    it('is idempotent when the role is already assigned (Prisma P2002)', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue(makeSaUser());
      mockPrisma.saRole.findUnique.mockResolvedValue({ id: 5, publicId: 'role1' });
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
      mockPrisma.saRole.findUnique.mockResolvedValue({ id: 5, publicId: 'role1' });
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
      mockPrisma.saRole.findUnique.mockResolvedValue({ id: 5, publicId: 'role1' });
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
});
