import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { RolesService } from './roles.service';

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
    const module = await Test.createTestingModule({ providers: [RolesService] }).compile();
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
