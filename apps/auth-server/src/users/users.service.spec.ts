import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { SqidService } from '../common/sqid/sqid.service';

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
  $transaction: jest.Mock;
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
  });
});
