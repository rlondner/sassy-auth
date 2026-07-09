import { ForbiddenException } from '@nestjs/common';
import { resolveListScope } from './resolve-list-scope';

jest.mock('@sassy-auth/db', () => ({
  prisma: {
    saUser: { findUnique: jest.fn() },
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockPrisma = require('@sassy-auth/db').prisma as {
  saUser: { findUnique: jest.Mock };
};

const saUserWith = (permNames: string[], overrides: { orgId?: number } = {}) => ({
  orgId: overrides.orgId ?? 7,
  roles: [],
  directPermissions: permNames.map((name) => ({ permission: { name } })),
});

describe('resolveListScope', () => {
  beforeEach(() => jest.clearAllMocks());

  it('throws Forbidden when saUser not found', async () => {
    mockPrisma.saUser.findUnique.mockResolvedValue(null);
    await expect(
      resolveListScope('ba-1', ['platform.orgs.manage', 'org.users.manage']),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('throws Forbidden when caller holds none of the required perms', async () => {
    mockPrisma.saUser.findUnique.mockResolvedValue(saUserWith([]));
    await expect(
      resolveListScope('ba-1', ['platform.orgs.manage', 'org.users.manage']),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns scope=platform when caller holds a platform.* perm', async () => {
    mockPrisma.saUser.findUnique.mockResolvedValue(saUserWith(['platform.orgs.manage']));
    await expect(
      resolveListScope('ba-1', ['platform.orgs.manage', 'org.users.manage']),
    ).resolves.toEqual({ scope: 'platform' });
  });

  it('returns scope=org with caller.orgId when caller holds only a non-platform perm', async () => {
    mockPrisma.saUser.findUnique.mockResolvedValue(saUserWith(['org.users.manage'], { orgId: 42 }));
    await expect(
      resolveListScope('ba-1', ['platform.orgs.manage', 'org.users.manage']),
    ).resolves.toEqual({ scope: 'org', orgId: 42 });
  });

  it('prefers scope=platform when caller holds both platform and non-platform perms', async () => {
    mockPrisma.saUser.findUnique.mockResolvedValue(
      saUserWith(['platform.orgs.manage', 'org.users.manage'], { orgId: 42 }),
    );
    await expect(
      resolveListScope('ba-1', ['platform.orgs.manage', 'org.users.manage']),
    ).resolves.toEqual({ scope: 'platform' });
  });

  it('aggregates permissions held via a role (not just direct grants)', async () => {
    mockPrisma.saUser.findUnique.mockResolvedValue({
      orgId: 7,
      roles: [
        { role: { permissions: [{ permission: { name: 'org.users.manage' } }] } },
      ],
      directPermissions: [],
    });
    await expect(
      resolveListScope('ba-1', ['platform.orgs.manage', 'org.users.manage']),
    ).resolves.toEqual({ scope: 'org', orgId: 7 });
  });

  // `platform.users.manage` is documented as an implicit read-alias for
  // resource endpoints that need to populate cross-page dropdowns
  // (see the listOrgs / listRoles comments in the corresponding
  // services). If it is in the required list, it must grant platform
  // scope on its own — a caller who holds only that perm does not need
  // to also hold `platform.orgs.manage`.
  it('returns scope=platform for the users.manage read-alias case', async () => {
    mockPrisma.saUser.findUnique.mockResolvedValue(saUserWith(['platform.users.manage']));
    await expect(
      resolveListScope('ba-1', ['platform.orgs.manage', 'platform.users.manage', 'org.users.manage']),
    ).resolves.toEqual({ scope: 'platform' });
  });
});
