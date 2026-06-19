import { ForbiddenException } from '@nestjs/common';
import { assertCallerCanGrantSystemPerms } from './assert-caller-can-grant-system-perms';

jest.mock('@sassy-auth/db', () => ({
  prisma: {
    saUser: { findUnique: jest.fn() },
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockPrisma = require('@sassy-auth/db').prisma as {
  saUser: { findUnique: jest.Mock };
};

const callerWith = (names: string[]) => ({
  roles: [],
  directPermissions: names.map((name) => ({ permission: { name } })),
});

const callerWithViaRole = (names: string[]) => ({
  roles: [
    { role: { permissions: names.map((name) => ({ permission: { name } })) } },
  ],
  directPermissions: [],
});

describe('assertCallerCanGrantSystemPerms', () => {
  beforeEach(() => jest.clearAllMocks());

  it('is a no-op when the system-perm list is empty', async () => {
    await expect(assertCallerCanGrantSystemPerms('ba-1', [])).resolves.toBeUndefined();
    expect(mockPrisma.saUser.findUnique).not.toHaveBeenCalled();
  });

  it('allows when caller holds platform.users.manage (platform-tier bypass)', async () => {
    mockPrisma.saUser.findUnique.mockResolvedValue(callerWith(['platform.users.manage']));
    await expect(
      assertCallerCanGrantSystemPerms('ba-1', ['org.users.manage', 'org.roles.manage']),
    ).resolves.toBeUndefined();
  });

  it('allows when caller holds every requested system perm directly', async () => {
    mockPrisma.saUser.findUnique.mockResolvedValue(callerWith(['org.users.manage']));
    await expect(
      assertCallerCanGrantSystemPerms('ba-1', ['org.users.manage']),
    ).resolves.toBeUndefined();
  });

  it('rejects when caller is missing one of the requested system perms', async () => {
    mockPrisma.saUser.findUnique.mockResolvedValue(callerWith(['org.users.manage']));
    await expect(
      assertCallerCanGrantSystemPerms('ba-1', ['org.users.manage', 'org.roles.manage']),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('error message names the missing perms', async () => {
    mockPrisma.saUser.findUnique.mockResolvedValue(callerWith([]));
    await expect(
      assertCallerCanGrantSystemPerms('ba-1', ['org.roles.manage']),
    ).rejects.toThrow(/org\.roles\.manage/);
  });

  it('rejects when saUser not found', async () => {
    mockPrisma.saUser.findUnique.mockResolvedValue(null);
    await expect(
      assertCallerCanGrantSystemPerms('ba-1', ['org.users.manage']),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('aggregates the caller perms held via a role (not only direct grants)', async () => {
    mockPrisma.saUser.findUnique.mockResolvedValue(callerWithViaRole(['org.users.manage']));
    await expect(
      assertCallerCanGrantSystemPerms('ba-1', ['org.users.manage']),
    ).resolves.toBeUndefined();
  });

  it('honors the platform.users.manage bypass when held via a role', async () => {
    mockPrisma.saUser.findUnique.mockResolvedValue(callerWithViaRole(['platform.users.manage']));
    await expect(
      assertCallerCanGrantSystemPerms('ba-1', ['org.users.manage', 'org.roles.manage']),
    ).resolves.toBeUndefined();
  });
});
