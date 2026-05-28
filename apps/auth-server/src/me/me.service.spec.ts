import { Test } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { MeService } from './me.service';

jest.mock('@sassy-auth/db', () => ({
  prisma: { saUser: { findUnique: jest.fn() } },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockPrisma = require('@sassy-auth/db').prisma as {
  saUser: { findUnique: jest.Mock };
};

describe('MeService', () => {
  let service: MeService;
  beforeEach(async () => {
    const module = await Test.createTestingModule({ providers: [MeService] }).compile();
    service = module.get(MeService);
    jest.clearAllMocks();
  });

  it('returns union of role-derived and direct permissions, deduplicated and sorted', async () => {
    mockPrisma.saUser.findUnique.mockResolvedValue({
      roles: [
        { role: { permissions: [{ permission: { name: 'platform.apps.manage' } }, { permission: { name: 'org.users.manage' } }] } },
      ],
      directPermissions: [
        { permission: { name: 'platform.orgs.manage' } },
        { permission: { name: 'org.users.manage' } },
      ],
    });
    const result = await service.getMyPermissions('ba-caller');
    expect(result).toEqual({ permissions: ['org.users.manage', 'platform.apps.manage', 'platform.orgs.manage'] });
  });

  it('returns empty list when caller has no SaUser permissions', async () => {
    mockPrisma.saUser.findUnique.mockResolvedValue({ roles: [], directPermissions: [] });
    const result = await service.getMyPermissions('ba-caller');
    expect(result).toEqual({ permissions: [] });
  });

  it('throws ForbiddenException when caller has no SaUser', async () => {
    mockPrisma.saUser.findUnique.mockResolvedValue(null);
    await expect(service.getMyPermissions('ba-caller')).rejects.toBeInstanceOf(ForbiddenException);
  });
});
