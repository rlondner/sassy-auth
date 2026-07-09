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
  orgId: 1,
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

  it('resolves when the user has the required permission as a direct grant (with matching targetOrgId)', async () => {
    mockPrisma.saUser.findUnique.mockResolvedValue({
      orgId: 1,
      roles: [],
      directPermissions: [{ permission: { name: 'org.users.manage' } }],
    });
    // bug-0001 — non-platform perms require an explicit `targetOrgId`.
    // Previously this test passed without one (silent grant).
    await expect(
      checkPermission('ba-1', 'org.users.manage', { targetOrgId: 1 }),
    ).resolves.toBeUndefined();
  });

  // bug-0001 regression — a non-platform perm without `targetOrgId`
  // must fall through to ForbiddenException. Symmetric to the
  // check-permission-for-app fix in bug-0094. The two helpers now share
  // a "fail closed on undefined scope" contract.
  it('REJECTS org.users.manage when targetOrgId is undefined (bug-0001)', async () => {
    mockPrisma.saUser.findUnique.mockResolvedValue({
      orgId: 1,
      roles: [],
      directPermissions: [{ permission: { name: 'org.users.manage' } }],
    });
    await expect(
      checkPermission('ba-1', 'org.users.manage'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      checkPermission('ba-1', ['platform.users.manage', 'org.users.manage']),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('throws ForbiddenException when user lacks the permission', async () => {
    mockPrisma.saUser.findUnique.mockResolvedValue({ orgId: 1, roles: [], directPermissions: [] });
    await expect(checkPermission('ba-1', 'platform.users.manage')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('throws ForbiddenException when saUser not found', async () => {
    mockPrisma.saUser.findUnique.mockResolvedValue(null);
    await expect(checkPermission('ba-1', 'platform.users.manage')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('grants platform.* across orgs regardless of targetOrgId', async () => {
    mockPrisma.saUser.findUnique.mockResolvedValue({
      orgId: 1,
      roles: [{ role: { permissions: [{ permission: { name: 'platform.users.manage' } }] } }],
      directPermissions: [],
    });
    await expect(
      checkPermission('ba-1', ['platform.users.manage', 'org.users.manage'], { targetOrgId: 99 }),
    ).resolves.toBeUndefined();
  });

  it('grants org.users.manage when caller and target org match', async () => {
    mockPrisma.saUser.findUnique.mockResolvedValue({
      orgId: 7,
      roles: [{ role: { permissions: [{ permission: { name: 'org.users.manage' } }] } }],
      directPermissions: [],
    });
    await expect(
      checkPermission('ba-1', ['platform.users.manage', 'org.users.manage'], { targetOrgId: 7 }),
    ).resolves.toBeUndefined();
  });

  it('REJECTS org.users.manage when caller org differs from target org (tenant isolation)', async () => {
    mockPrisma.saUser.findUnique.mockResolvedValue({
      orgId: 7,
      roles: [{ role: { permissions: [{ permission: { name: 'org.users.manage' } }] } }],
      directPermissions: [],
    });
    await expect(
      checkPermission('ba-1', ['platform.users.manage', 'org.users.manage'], { targetOrgId: 8 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('REJECTS when targetOrgId is the cross-tenant sentinel (-1) and caller lacks platform.*', async () => {
    mockPrisma.saUser.findUnique.mockResolvedValue({
      orgId: 7,
      roles: [{ role: { permissions: [{ permission: { name: 'org.users.manage' } }] } }],
      directPermissions: [],
    });
    await expect(
      checkPermission('ba-1', ['platform.users.manage', 'org.users.manage'], { targetOrgId: -1 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
