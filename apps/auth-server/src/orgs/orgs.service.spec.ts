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

const ORG_INCLUDE_FOR_TEST = {
  app: { select: { publicId: true, name: true } },
  _count: { select: { users: true } },
} as const;

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

  describe('createOrg', () => {
    const appRow = { id: 1, publicId: 'sq_1', name: 'Customer Portal', isPlatform: false };
    const platformAppRow = { id: 2, publicId: 'sq_2', name: 'SassyAuth', isPlatform: true };
    const createdRow = { ...orgRow, name: 'Acme', appId: 1 };

    it('generates publicId via two-step transaction and returns formatted org', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue(appRow);
      mockPrisma.$transaction.mockImplementation(async (cb: (tx: typeof mockPrisma) => unknown) => cb(mockPrisma));
      mockPrisma.saOrg.create.mockResolvedValue({ ...createdRow, publicId: 'placeholder' });
      mockPrisma.saOrg.update.mockResolvedValue(createdRow);

      const result = await service.createOrg('ba-caller', { name: 'Acme', appId: 'sq_1' });

      expect(mockPrisma.saOrg.create).toHaveBeenCalledWith({
        data: { publicId: 'placeholder', name: 'Acme', appId: 1, isPlatform: false },
      });
      expect(mockPrisma.saOrg.update).toHaveBeenCalledWith({
        where: { id: 10 }, data: { publicId: 'sq_10' },
        include: { app: { select: { publicId: true, name: true } }, _count: { select: { users: true } } },
      });
      expect(result).toEqual({
        publicId: 'sq_10', name: 'Acme', isPlatform: false, userCount: 3,
        app: { publicId: 'sq_1', name: 'Customer Portal' },
      });
      expect(checkPermission).toHaveBeenCalledWith('ba-caller', 'platform.orgs.manage');
    });

    it('throws NotFoundException when appId sqid does not exist', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue(null);
      await expect(service.createOrg('ba-caller', { name: 'Acme', appId: 'nope' }))
        .rejects.toBeInstanceOf(NotFoundException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when parent app is isPlatform', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue(platformAppRow);
      await expect(service.createOrg('ba-caller', { name: 'X', appId: 'sq_2' }))
        .rejects.toBeInstanceOf(ForbiddenException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws ConflictException on P2002 (duplicate name in app)', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue(appRow);
      mockPrisma.$transaction.mockRejectedValue({ code: 'P2002' });
      await expect(service.createOrg('ba-caller', { name: 'Acme', appId: 'sq_1' }))
        .rejects.toBeInstanceOf(ConflictException);
    });

    it('re-throws unexpected errors from the transaction', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue(appRow);
      mockPrisma.$transaction.mockRejectedValueOnce(new Error('DB timeout'));
      await expect(service.createOrg('ba-caller', { name: 'Acme', appId: 'sq_1' })).rejects.toThrow('DB timeout');
    });
  });

  describe('updateOrg', () => {
    const existing = { id: 10, publicId: 'sq_10', name: 'Acme', isPlatform: false, appId: 1 };
    const platformExisting = { id: 20, publicId: 'sq_20', name: 'Platform', isPlatform: true, appId: 2 };

    it('throws BadRequestException when no fields provided', async () => {
      await expect(service.updateOrg('ba-caller', 'sq_10', {}))
        .rejects.toBeInstanceOf(BadRequestException);
      expect(mockPrisma.saOrg.findUnique).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when org missing', async () => {
      mockPrisma.saOrg.findUnique.mockResolvedValue(null);
      await expect(service.updateOrg('ba-caller', 'nope', { name: 'X' }))
        .rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects platform orgs with ForbiddenException', async () => {
      mockPrisma.saOrg.findUnique.mockResolvedValue(platformExisting);
      await expect(service.updateOrg('ba-caller', 'sq_20', { name: 'X' }))
        .rejects.toBeInstanceOf(ForbiddenException);
      expect(mockPrisma.saOrg.update).not.toHaveBeenCalled();
    });

    it('succeeds with partial name patch', async () => {
      mockPrisma.saOrg.findUnique.mockResolvedValue(existing);
      mockPrisma.saOrg.update.mockResolvedValue({ ...orgRow, name: 'Renamed' });
      const result = await service.updateOrg('ba-caller', 'sq_10', { name: 'Renamed' });
      expect(mockPrisma.saOrg.update).toHaveBeenCalledWith({
        where: { publicId: 'sq_10' }, data: { name: 'Renamed' }, include: ORG_INCLUDE_FOR_TEST,
      });
      expect(result.name).toBe('Renamed');
    });

    it('throws ConflictException on P2002', async () => {
      mockPrisma.saOrg.findUnique.mockResolvedValue(existing);
      mockPrisma.saOrg.update.mockRejectedValue({ code: 'P2002' });
      await expect(service.updateOrg('ba-caller', 'sq_10', { name: 'dup' }))
        .rejects.toBeInstanceOf(ConflictException);
    });

    it('re-throws unexpected errors from prisma.update', async () => {
      mockPrisma.saOrg.findUnique.mockResolvedValue(existing);
      mockPrisma.saOrg.update.mockRejectedValueOnce(new Error('Network failure'));
      await expect(service.updateOrg('ba-caller', 'sq_10', { name: 'X' })).rejects.toThrow('Network failure');
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

  describe('deleteOrg', () => {
    const existing = { id: 10, publicId: 'sq_10', name: 'Acme', isPlatform: false, appId: 1 };
    const platformExisting = { id: 20, publicId: 'sq_20', name: 'Platform', isPlatform: true, appId: 2 };

    it('rejects platform orgs with ForbiddenException', async () => {
      mockPrisma.saOrg.findUnique.mockResolvedValue(platformExisting);
      await expect(service.deleteOrg('ba-caller', 'sq_20'))
        .rejects.toBeInstanceOf(ForbiddenException);
      expect(mockPrisma.saOrg.delete).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when missing', async () => {
      mockPrisma.saOrg.findUnique.mockResolvedValue(null);
      await expect(service.deleteOrg('ba-caller', 'nope'))
        .rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws ConflictException on P2003 (dependent users)', async () => {
      mockPrisma.saOrg.findUnique.mockResolvedValue(existing);
      mockPrisma.saOrg.delete.mockRejectedValue({ code: 'P2003' });
      await expect(service.deleteOrg('ba-caller', 'sq_10'))
        .rejects.toBeInstanceOf(ConflictException);
    });

    it('succeeds for ordinary orgs', async () => {
      mockPrisma.saOrg.findUnique.mockResolvedValue(existing);
      mockPrisma.saOrg.delete.mockResolvedValue(existing);
      await service.deleteOrg('ba-caller', 'sq_10');
      expect(mockPrisma.saOrg.delete).toHaveBeenCalledWith({ where: { publicId: 'sq_10' } });
    });

    it('re-throws unexpected errors from prisma.delete', async () => {
      mockPrisma.saOrg.findUnique.mockResolvedValue(existing);
      mockPrisma.saOrg.delete.mockRejectedValueOnce(new Error('Unexpected DB error'));
      await expect(service.deleteOrg('ba-caller', 'sq_10')).rejects.toThrow('Unexpected DB error');
    });
  });
});
