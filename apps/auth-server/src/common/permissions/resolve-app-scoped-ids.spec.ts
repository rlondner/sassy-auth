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
