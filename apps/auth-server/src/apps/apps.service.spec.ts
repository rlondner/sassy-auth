import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AppsService } from './apps.service';
import { SqidService } from '../common/sqid/sqid.service';
import { LoggerService } from '../common/logger/logger.service';

jest.mock('@sassy-auth/db', () => ({
  prisma: {
    saApp: {
      findMany: jest.fn(), count: jest.fn(), findUnique: jest.fn(),
      create: jest.fn(), update: jest.fn(), delete: jest.fn(),
    },
    $transaction: jest.fn(),
  },
  Prisma: {},
}));
jest.mock('../common/permissions/check-permission', () => ({
  checkPermission: jest.fn().mockResolvedValue(undefined),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockPrisma = require('@sassy-auth/db').prisma as {
  saApp: { findMany: jest.Mock; count: jest.Mock; findUnique: jest.Mock; create: jest.Mock; update: jest.Mock; delete: jest.Mock };
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

const appRow = { id: 1, publicId: 'sq_1', name: 'Customer Portal', url: 'https://portal.example.com', isPlatform: false };
const platformRow = { id: 2, publicId: 'sq_2', name: 'SassyAuth', url: 'https://auth', isPlatform: true };

describe('AppsService', () => {
  let service: AppsService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        AppsService,
        { provide: SqidService, useValue: sqidFake },
        { provide: LoggerService, useValue: loggerFake },
      ],
    }).compile();
    service = module.get(AppsService);
    jest.clearAllMocks();
    (checkPermission as jest.Mock).mockResolvedValue(undefined);
  });

  it('listApps returns paginated items and total', async () => {
    mockPrisma.saApp.findMany.mockResolvedValue([appRow]);
    mockPrisma.saApp.count.mockResolvedValue(1);
    const result = await service.listApps('ba-caller', { page: 1, pageSize: 25 });
    expect(result).toEqual({
      items: [{ publicId: 'sq_1', name: 'Customer Portal', url: 'https://portal.example.com', isPlatform: false }],
      total: 1, page: 1, pageSize: 25,
    });
    expect(checkPermission).toHaveBeenCalledWith('ba-caller', 'platform.apps.manage');
  });

  it('listApps applies q filter to name and url (ILIKE)', async () => {
    mockPrisma.saApp.findMany.mockResolvedValue([]);
    mockPrisma.saApp.count.mockResolvedValue(0);
    await service.listApps('ba-caller', { page: 1, pageSize: 25, q: 'portal' });
    expect(mockPrisma.saApp.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { OR: [{ name: { contains: 'portal', mode: 'insensitive' } }, { url: { contains: 'portal', mode: 'insensitive' } }] },
      skip: 0, take: 25, orderBy: { id: 'desc' },
    }));
  });

  it('createApp generates publicId via two-step transaction', async () => {
    mockPrisma.$transaction.mockImplementation(async (cb: (tx: typeof mockPrisma) => unknown) => cb(mockPrisma));
    mockPrisma.saApp.create.mockResolvedValue({ ...appRow, publicId: 'placeholder' });
    mockPrisma.saApp.update.mockResolvedValue(appRow);
    const result = await service.createApp('ba-caller', { name: 'Customer Portal', url: 'https://portal.example.com' });
    expect(mockPrisma.saApp.create).toHaveBeenCalledWith({ data: { publicId: 'placeholder', name: 'Customer Portal', url: 'https://portal.example.com', isPlatform: false } });
    expect(mockPrisma.saApp.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { publicId: 'sq_1' } });
    expect(result).toEqual({ publicId: 'sq_1', name: 'Customer Portal', url: 'https://portal.example.com', isPlatform: false });
  });

  it('createApp throws ConflictException on P2002', async () => {
    mockPrisma.$transaction.mockRejectedValue({ code: 'P2002' });
    await expect(service.createApp('ba-caller', { name: 'x', url: 'https://x' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('updateApp throws BadRequestException when both name and url are absent', async () => {
    await expect(service.updateApp('ba-caller', 'sq_1', {})).rejects.toBeInstanceOf(BadRequestException);
    expect(mockPrisma.saApp.findUnique).not.toHaveBeenCalled();
  });

  it('updateApp rejects platform apps with ForbiddenException', async () => {
    mockPrisma.saApp.findUnique.mockResolvedValue(platformRow);
    await expect(service.updateApp('ba-caller', 'sq_2', { name: 'x' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(mockPrisma.saApp.update).not.toHaveBeenCalled();
  });

  it('updateApp throws NotFoundException when missing', async () => {
    mockPrisma.saApp.findUnique.mockResolvedValue(null);
    await expect(service.updateApp('ba-caller', 'nope', { name: 'x' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('updateApp succeeds with partial patch', async () => {
    mockPrisma.saApp.findUnique.mockResolvedValue(appRow);
    mockPrisma.saApp.update.mockResolvedValue({ ...appRow, name: 'Renamed' });
    const result = await service.updateApp('ba-caller', 'sq_1', { name: 'Renamed' });
    expect(mockPrisma.saApp.update).toHaveBeenCalledWith({ where: { publicId: 'sq_1' }, data: { name: 'Renamed' } });
    expect(result.name).toBe('Renamed');
  });

  it('updateApp throws ConflictException on P2002', async () => {
    mockPrisma.saApp.findUnique.mockResolvedValue(appRow);
    mockPrisma.saApp.update.mockRejectedValue({ code: 'P2002' });
    await expect(service.updateApp('ba-caller', 'sq_1', { name: 'dup' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('deleteApp rejects platform apps with ForbiddenException', async () => {
    mockPrisma.saApp.findUnique.mockResolvedValue(platformRow);
    await expect(service.deleteApp('ba-caller', 'sq_2')).rejects.toBeInstanceOf(ForbiddenException);
    expect(mockPrisma.saApp.delete).not.toHaveBeenCalled();
  });

  it('deleteApp throws NotFoundException when missing', async () => {
    mockPrisma.saApp.findUnique.mockResolvedValue(null);
    await expect(service.deleteApp('ba-caller', 'nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('deleteApp throws ConflictException on P2003 (dependent FK)', async () => {
    mockPrisma.saApp.findUnique.mockResolvedValue(appRow);
    mockPrisma.saApp.delete.mockRejectedValue({ code: 'P2003' });
    await expect(service.deleteApp('ba-caller', 'sq_1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('deleteApp succeeds for ordinary apps', async () => {
    mockPrisma.saApp.findUnique.mockResolvedValue(appRow);
    mockPrisma.saApp.delete.mockResolvedValue(appRow);
    await service.deleteApp('ba-caller', 'sq_1');
    expect(mockPrisma.saApp.delete).toHaveBeenCalledWith({ where: { publicId: 'sq_1' } });
  });

  describe('createApp re-throw non-P2002 error', () => {
    it('re-throws unexpected errors from the transaction', async () => {
      const unexpected = new Error('DB connection lost');
      mockPrisma.$transaction.mockRejectedValueOnce(unexpected);
      await expect(service.createApp('ba-caller', { name: 'x', url: 'https://x' })).rejects.toThrow('DB connection lost');
    });
  });

  describe('updateApp re-throw non-P2002 error', () => {
    it('re-throws unexpected errors from prisma.update', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue(appRow);
      const unexpected = new Error('DB timeout');
      mockPrisma.saApp.update.mockRejectedValueOnce(unexpected);
      await expect(service.updateApp('ba-caller', 'sq_1', { name: 'y' })).rejects.toThrow('DB timeout');
    });
  });

  describe('deleteApp re-throw non-P2003 error', () => {
    it('re-throws unexpected errors from prisma.delete', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue(appRow);
      const unexpected = new Error('Network failure');
      mockPrisma.saApp.delete.mockRejectedValueOnce(unexpected);
      await expect(service.deleteApp('ba-caller', 'sq_1')).rejects.toThrow('Network failure');
    });
  });
});
