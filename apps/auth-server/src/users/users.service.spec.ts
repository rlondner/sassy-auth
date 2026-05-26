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
});
