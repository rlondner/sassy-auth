import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { OrgsService } from './orgs.service';
import { SqidService } from '../common/sqid/sqid.service';
import { LoggerService } from '../common/logger/logger.service';

jest.mock('@sassy-auth/db', () => ({
  prisma: {
    saOrg: {
      findMany: jest.fn(), count: jest.fn(), findUnique: jest.fn(),
      create: jest.fn(), update: jest.fn(), delete: jest.fn(),
    },
    saApp: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  },
  Prisma: {},
}));
jest.mock('../common/permissions/check-permission', () => ({
  checkPermission: jest.fn().mockResolvedValue(undefined),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockPrisma = require('@sassy-auth/db').prisma as {
  saOrg: { findMany: jest.Mock; count: jest.Mock; findUnique: jest.Mock; create: jest.Mock; update: jest.Mock; delete: jest.Mock };
  saApp: { findUnique: jest.Mock };
  $transaction: jest.Mock;
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { checkPermission } = require('../common/permissions/check-permission') as { checkPermission: jest.Mock };

const sqidFake: Pick<SqidService, 'encode' | 'decode'> = {
  encode: (n: number) => `sq_${n}`,
  decode: (s: string) => Number(s.replace('sq_', '')),
};
const loggerFake: Partial<LoggerService> = {
  getWinstonLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() } as never),
};

const orgRow = {
  id: 10, publicId: 'sq_10', name: 'Acme', isPlatform: false,
  app: { publicId: 'sq_1', name: 'Customer Portal' },
  _count: { users: 3 },
};
const platformOrgRow = {
  id: 20, publicId: 'sq_20', name: 'Platform', isPlatform: true,
  app: { publicId: 'sq_2', name: 'SassyAuth' },
  _count: { users: 1 },
};

describe('OrgsService', () => {
  let service: OrgsService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        OrgsService,
        { provide: SqidService, useValue: sqidFake },
        { provide: LoggerService, useValue: loggerFake },
      ],
    }).compile();
    service = module.get(OrgsService);
    jest.clearAllMocks();
    (checkPermission as jest.Mock).mockResolvedValue(undefined);
  });

  describe('listOrgs', () => {
    it('returns paginated items and total with userCount and parent app', async () => {
      mockPrisma.saOrg.findMany.mockResolvedValue([orgRow]);
      mockPrisma.saOrg.count.mockResolvedValue(1);
      const result = await service.listOrgs('ba-caller', { page: 1, pageSize: 25 });
      expect(result).toEqual({
        items: [{
          publicId: 'sq_10', name: 'Acme', isPlatform: false, userCount: 3,
          app: { publicId: 'sq_1', name: 'Customer Portal' },
        }],
        total: 1, page: 1, pageSize: 25,
      });
      expect(checkPermission).toHaveBeenCalledWith('ba-caller', ['platform.orgs.manage', 'org.users.manage']);
    });

    it('applies q filter to name (ILIKE)', async () => {
      mockPrisma.saOrg.findMany.mockResolvedValue([]);
      mockPrisma.saOrg.count.mockResolvedValue(0);
      await service.listOrgs('ba-caller', { page: 1, pageSize: 25, q: 'acm' });
      expect(mockPrisma.saOrg.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { name: { contains: 'acm', mode: 'insensitive' } },
        skip: 0, take: 25, orderBy: { id: 'desc' },
      }));
    });

    it('resolves appId sqid and filters by appId', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue({ id: 1, publicId: 'sq_1' });
      mockPrisma.saOrg.findMany.mockResolvedValue([]);
      mockPrisma.saOrg.count.mockResolvedValue(0);
      await service.listOrgs('ba-caller', { page: 1, pageSize: 25, appId: 'sq_1' });
      expect(mockPrisma.saApp.findUnique).toHaveBeenCalledWith({ where: { publicId: 'sq_1' } });
      expect(mockPrisma.saOrg.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { appId: 1 },
      }));
    });

    it('throws NotFoundException when appId sqid does not exist', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue(null);
      await expect(service.listOrgs('ba-caller', { appId: 'nope' })).rejects.toBeInstanceOf(NotFoundException);
    });

    it('combines q and appId in the where clause', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue({ id: 1, publicId: 'sq_1' });
      mockPrisma.saOrg.findMany.mockResolvedValue([]);
      mockPrisma.saOrg.count.mockResolvedValue(0);
      await service.listOrgs('ba-caller', { q: 'a', appId: 'sq_1' });
      expect(mockPrisma.saOrg.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { appId: 1, name: { contains: 'a', mode: 'insensitive' } },
      }));
    });
  });

  describe('getOrg', () => {
    it('returns formatted org when found', async () => {
      mockPrisma.saOrg.findUnique.mockResolvedValue(orgRow);
      const result = await service.getOrg('ba-caller', 'sq_10');
      expect(mockPrisma.saOrg.findUnique).toHaveBeenCalledWith({
        where: { publicId: 'sq_10' },
        include: { app: { select: { publicId: true, name: true } }, _count: { select: { users: true } } },
      });
      expect(result).toEqual({
        publicId: 'sq_10', name: 'Acme', isPlatform: false, userCount: 3,
        app: { publicId: 'sq_1', name: 'Customer Portal' },
      });
      expect(checkPermission).toHaveBeenCalledWith('ba-caller', ['platform.orgs.manage', 'org.users.manage']);
    });

    it('throws NotFoundException when org missing', async () => {
      mockPrisma.saOrg.findUnique.mockResolvedValue(null);
      await expect(service.getOrg('ba-caller', 'nope')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
