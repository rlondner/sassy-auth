import { ForbiddenException } from '@nestjs/common';
import { checkPermissionForApp } from './check-permission-for-app';

jest.mock('@sassy-auth/db', () => ({
  prisma: {
    saUser: { findUnique: jest.fn() },
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockPrisma = require('@sassy-auth/db').prisma as {
  saUser: { findUnique: jest.Mock };
};

const saUserWith = (permNames: string[]) => ({
  orgId: 1,
  roles: [],
  directPermissions: permNames.map((name) => ({ permission: { name } })),
});

describe('checkPermissionForApp', () => {
  beforeEach(() => jest.clearAllMocks());

  it('throws Forbidden when saUser not found', async () => {
    mockPrisma.saUser.findUnique.mockResolvedValue(null);
    await expect(
      checkPermissionForApp('ba-1', 'platform.roles.manage'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('throws Forbidden when caller has neither required perm', async () => {
    mockPrisma.saUser.findUnique.mockResolvedValue(saUserWith([]));
    await expect(
      checkPermissionForApp('ba-1', ['platform.roles.manage', 'org.roles.manage']),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('platform.* bypasses the app-scope check', async () => {
    mockPrisma.saUser.findUnique.mockResolvedValue(saUserWith(['platform.roles.manage']));
    await expect(
      checkPermissionForApp(
        'ba-1',
        ['platform.roles.manage', 'org.roles.manage'],
        { targetAppId: 99, callerAppId: 1 },
      ),
    ).resolves.toBeUndefined();
  });

  it('org.* allowed when callerAppId === targetAppId', async () => {
    mockPrisma.saUser.findUnique.mockResolvedValue(saUserWith(['org.roles.manage']));
    await expect(
      checkPermissionForApp(
        'ba-1',
        ['platform.roles.manage', 'org.roles.manage'],
        { targetAppId: 7, callerAppId: 7 },
      ),
    ).resolves.toBeUndefined();
  });

  it('org.* rejected when callerAppId !== targetAppId', async () => {
    mockPrisma.saUser.findUnique.mockResolvedValue(saUserWith(['org.roles.manage']));
    await expect(
      checkPermissionForApp(
        'ba-1',
        ['platform.roles.manage', 'org.roles.manage'],
        { targetAppId: 7, callerAppId: 8 },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('org.* rejected with the cross-app sentinel (-1)', async () => {
    mockPrisma.saUser.findUnique.mockResolvedValue(saUserWith(['org.roles.manage']));
    await expect(
      checkPermissionForApp(
        'ba-1',
        ['platform.roles.manage', 'org.roles.manage'],
        { targetAppId: -1, callerAppId: 7 },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('org.* with no targetAppId is allowed (unscoped read)', async () => {
    mockPrisma.saUser.findUnique.mockResolvedValue(saUserWith(['org.roles.manage']));
    await expect(
      checkPermissionForApp('ba-1', ['platform.roles.manage', 'org.roles.manage']),
    ).resolves.toBeUndefined();
  });
});
