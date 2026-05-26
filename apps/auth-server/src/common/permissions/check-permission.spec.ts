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
