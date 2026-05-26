import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { OrgsService } from './orgs.service';

jest.mock('@sassy-auth/db', () => ({
  prisma: { saOrg: { findMany: jest.fn(), findUnique: jest.fn() } },
}));
jest.mock('../common/permissions/check-permission', () => ({
  checkPermission: jest.fn().mockResolvedValue(undefined),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockPrisma = require('@sassy-auth/db').prisma as {
  saOrg: { findMany: jest.Mock; findUnique: jest.Mock };
};

const org = { publicId: 'org1', name: 'Acme', app: { publicId: 'app1' }, isPlatform: false };

describe('OrgsService', () => {
  let service: OrgsService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({ providers: [OrgsService] }).compile();
    service = module.get(OrgsService);
    jest.clearAllMocks();
  });

  it('listOrgs returns mapped orgs', async () => {
    mockPrisma.saOrg.findMany.mockResolvedValue([org]);
    const result = await service.listOrgs('ba-caller');
    expect(result[0].id).toBe('org1');
    expect(result[0].name).toBe('Acme');
  });

  it('getOrg throws NotFoundException when not found', async () => {
    mockPrisma.saOrg.findUnique.mockResolvedValue(null);
    await expect(service.getOrg('ba-caller', 'org1')).rejects.toBeInstanceOf(NotFoundException);
  });
});
