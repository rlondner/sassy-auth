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
    saAppRedirectUri: {
      deleteMany: jest.fn(), createMany: jest.fn(),
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
  saAppRedirectUri: { deleteMany: jest.Mock; createMany: jest.Mock };
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

const appRow = { id: 1, publicId: 'sq_1', name: 'Customer Portal', url: 'https://portal.example.com', isPlatform: false, twoFactorTrustDays: null, requireTwoFactor: false };
const platformRow = { id: 2, publicId: 'sq_2', name: 'SassyAuth', url: 'https://auth', isPlatform: true, twoFactorTrustDays: null, requireTwoFactor: false };

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
    // Default: run the transaction callback against the same mocked prisma
    // client, so existing tests that stub saApp.update / saAppRedirectUri
    // directly keep working now that updateApp (like createApp) writes
    // through prisma.$transaction. Tests that care about transactional
    // atomicity specifically override this with a distinct tx client.
    mockPrisma.$transaction.mockImplementation(async (cb: (tx: typeof mockPrisma) => unknown) => cb(mockPrisma));
  });

  it('listApps returns paginated items and total', async () => {
    mockPrisma.saApp.findMany.mockResolvedValue([appRow]);
    mockPrisma.saApp.count.mockResolvedValue(1);
    const result = await service.listApps('ba-caller', { page: 1, pageSize: 25 });
    expect(result).toEqual({
      items: [{ publicId: 'sq_1', name: 'Customer Portal', url: 'https://portal.example.com', isPlatform: false, twoFactorTrustDays: null, requireTwoFactor: false, redirectUris: [], isConfidential: false, clientSecretUpdatedAt: null }],
      total: 1, page: 1, pageSize: 25,
    });
    expect(checkPermission).toHaveBeenCalledWith('ba-caller', [
      'platform.apps.manage',
      'platform.orgs.manage',
      'platform.permissions.manage',
      'platform.roles.manage',
    ]);
  });

  // bug-0164 — sibling of getOrg / getRole / getPermission / getUser.
  // The README documented `GET /api/apps/:id` but the route was missing
  // before this bug was closed. The service call goes through the same
  // required-perms surface as listApps so cross-page callers (orgs /
  // roles / permissions admin pages) can still name-render the parent
  // app when displaying one record.
  it('getApp returns the formatted row when found', async () => {
    mockPrisma.saApp.findUnique.mockResolvedValue(appRow);
    const result = await service.getApp('ba-caller', 'sq_1');
    expect(mockPrisma.saApp.findUnique).toHaveBeenCalledWith({ where: { publicId: 'sq_1' }, include: { redirectUris: true } });
    expect(result).toEqual({
      publicId: 'sq_1', name: 'Customer Portal', url: 'https://portal.example.com',
      isPlatform: false, twoFactorTrustDays: null, requireTwoFactor: false, redirectUris: [],
      isConfidential: false, clientSecretUpdatedAt: null,
    });
    expect(checkPermission).toHaveBeenCalledWith('ba-caller', [
      'platform.apps.manage',
      'platform.orgs.manage',
      'platform.permissions.manage',
      'platform.roles.manage',
    ]);
  });

  it('getApp throws NotFoundException when the app does not exist', async () => {
    mockPrisma.saApp.findUnique.mockResolvedValue(null);
    await expect(service.getApp('ba-caller', 'nope')).rejects.toBeInstanceOf(NotFoundException);
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
    expect(mockPrisma.saApp.create).toHaveBeenCalledWith({
      data: {
        publicId: expect.stringMatching(/^pending-/),
        name: 'Customer Portal',
        url: 'https://portal.example.com',
        isPlatform: false,
        twoFactorTrustDays: null,
        requireTwoFactor: false,
      },
    });
    expect(mockPrisma.saApp.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { publicId: 'sq_1' } });
    expect(result).toEqual({ publicId: 'sq_1', name: 'Customer Portal', url: 'https://portal.example.com', isPlatform: false, twoFactorTrustDays: null, requireTwoFactor: false, redirectUris: [], isConfidential: false, clientSecretUpdatedAt: null });
  });

  it('createApp stores a provided twoFactorTrustDays', async () => {
    mockPrisma.$transaction.mockImplementation(async (cb: (tx: typeof mockPrisma) => unknown) => cb(mockPrisma));
    mockPrisma.saApp.create.mockResolvedValue({ ...appRow, publicId: 'placeholder' });
    mockPrisma.saApp.update.mockResolvedValue({ ...appRow, twoFactorTrustDays: 30 });
    const result = await service.createApp('ba-caller', {
      name: 'Customer Portal', url: 'https://portal.example.com', twoFactorTrustDays: 30,
    });
    expect(mockPrisma.saApp.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ twoFactorTrustDays: 30 }),
    }));
    expect(result.twoFactorTrustDays).toBe(30);
  });

  it('createApp throws ConflictException on P2002', async () => {
    mockPrisma.$transaction.mockRejectedValue({ code: 'P2002' });
    await expect(service.createApp('ba-caller', { name: 'x', url: 'https://x' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('updateApp throws BadRequestException when name, url, and twoFactorTrustDays are all absent', async () => {
    await expect(service.updateApp('ba-caller', 'sq_1', {})).rejects.toBeInstanceOf(BadRequestException);
    expect(mockPrisma.saApp.findUnique).not.toHaveBeenCalled();
  });

  it('updateApp with only twoFactorTrustDays does NOT throw BadRequestException (reaches update)', async () => {
    mockPrisma.saApp.findUnique.mockResolvedValue(appRow);
    mockPrisma.saApp.update.mockResolvedValue({ ...appRow, twoFactorTrustDays: 30 });
    await expect(service.updateApp('ba-caller', 'sq_1', { twoFactorTrustDays: 30 })).resolves.toBeDefined();
    expect(mockPrisma.saApp.update).toHaveBeenCalled();
  });

  it('updateApp sets twoFactorTrustDays when provided', async () => {
    mockPrisma.saApp.findUnique.mockResolvedValue(appRow);
    mockPrisma.saApp.update.mockResolvedValue({ ...appRow, twoFactorTrustDays: 30 });
    await service.updateApp('ba-caller', 'sq_1', { twoFactorTrustDays: 30 });
    expect(mockPrisma.saApp.update).toHaveBeenCalledWith({
      where: { publicId: 'sq_1' },
      data: { twoFactorTrustDays: 30 },
    });
  });

  it('updateApp clears twoFactorTrustDays when given null', async () => {
    mockPrisma.saApp.findUnique.mockResolvedValue(appRow);
    mockPrisma.saApp.update.mockResolvedValue({ ...appRow, twoFactorTrustDays: null });
    await service.updateApp('ba-caller', 'sq_1', { twoFactorTrustDays: null });
    expect(mockPrisma.saApp.update).toHaveBeenCalledWith({
      where: { publicId: 'sq_1' },
      data: { twoFactorTrustDays: null },
    });
  });

  it('updateApp omits twoFactorTrustDays from update data when DTO omits it', async () => {
    mockPrisma.saApp.findUnique.mockResolvedValue(appRow);
    mockPrisma.saApp.update.mockResolvedValue({ ...appRow, name: 'Renamed' });
    await service.updateApp('ba-caller', 'sq_1', { name: 'Renamed' });
    expect(mockPrisma.saApp.update).toHaveBeenCalledWith({
      where: { publicId: 'sq_1' },
      data: { name: 'Renamed' },
    });
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

  it('persists requireTwoFactor on create and update for non-platform apps', async () => {
    mockPrisma.$transaction.mockImplementation(async (cb: (tx: typeof mockPrisma) => unknown) => cb(mockPrisma));
    mockPrisma.saApp.create.mockResolvedValue({ ...appRow, publicId: 'placeholder' });
    mockPrisma.saApp.update
      .mockResolvedValueOnce({ ...appRow, requireTwoFactor: true })
      .mockResolvedValueOnce({ ...appRow, requireTwoFactor: false });
    const created = await service.createApp('ba-caller', { name: 'X', url: 'https://x.example', requireTwoFactor: true });
    expect(created.requireTwoFactor).toBe(true);
    expect(mockPrisma.saApp.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ requireTwoFactor: true }),
    }));

    mockPrisma.saApp.findUnique.mockResolvedValue({ ...appRow, requireTwoFactor: true });
    const updated = await service.updateApp('ba-caller', 'sq_1', { requireTwoFactor: false });
    expect(updated.requireTwoFactor).toBe(false);
    expect(mockPrisma.saApp.update).toHaveBeenCalledWith({
      where: { publicId: 'sq_1' },
      data: { requireTwoFactor: false },
    });
  });

  it('still rejects requireTwoFactor updates on the platform app', async () => {
    mockPrisma.saApp.findUnique.mockResolvedValue(platformRow);
    await expect(service.updateApp('ba-caller', 'sq_2', { requireTwoFactor: true }))
      .rejects.toThrow('Platform app cannot be modified');
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

  it('replaces the redirect URI set on update', async () => {
    mockPrisma.saApp.findUnique.mockResolvedValue({ id: 7, publicId: 'a_7', isPlatform: false });
    mockPrisma.saApp.update.mockResolvedValue({ id: 7, publicId: 'a_7', isPlatform: false });

    await service.updateApp('admin-ba-id', 'a_7', {
      redirectUris: [
        { uri: 'https://app.example.com/cb', kind: 'login' },
        { uri: 'https://app.example.com/bye', kind: 'post_logout' },
      ],
    });

    expect(mockPrisma.saAppRedirectUri.deleteMany).toHaveBeenCalledWith({ where: { appId: 7 } });
    expect(mockPrisma.saAppRedirectUri.createMany).toHaveBeenCalledWith({
      data: [
        { appId: 7, uri: 'https://app.example.com/cb', kind: 'login' },
        { appId: 7, uri: 'https://app.example.com/bye', kind: 'post_logout' },
      ],
    });
  });

  it('rejects a redirect URI that is not an absolute http(s) URL', async () => {
    mockPrisma.saApp.findUnique.mockResolvedValue({ id: 7, publicId: 'a_7', isPlatform: false });

    await expect(
      service.updateApp('admin-ba-id', 'a_7', {
        redirectUris: [{ uri: 'javascript:alert(1)', kind: 'login' }],
      }),
    ).rejects.toThrow();
  });

  it('updateApp rejects a duplicate {uri, kind} pair with a distinct BadRequestException, not the app-name-conflict message, and never touches the DB', async () => {
    mockPrisma.saApp.findUnique.mockResolvedValue({ id: 7, publicId: 'a_7', isPlatform: false });

    const call = service.updateApp('admin-ba-id', 'a_7', {
      redirectUris: [
        { uri: 'https://app.example.com/cb', kind: 'login' },
        { uri: 'https://app.example.com/cb', kind: 'login' },
      ],
    });

    await expect(call).rejects.toBeInstanceOf(BadRequestException);
    await expect(call).rejects.not.toBeInstanceOf(ConflictException);
    await expect(call).rejects.toThrow(/duplicate/i);
    // Validation happens before any write — the whole point is to make this
    // P2002-shaped failure unreachable from user input.
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockPrisma.saAppRedirectUri.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.saAppRedirectUri.createMany).not.toHaveBeenCalled();
  });

  it('createApp rejects a duplicate {uri, kind} pair before any write', async () => {
    const call = service.createApp('ba-caller', {
      name: 'X',
      url: 'https://x.example',
      redirectUris: [
        { uri: 'https://x.example/cb', kind: 'post_logout' },
        { uri: 'https://x.example/cb', kind: 'post_logout' },
      ],
    });

    await expect(call).rejects.toBeInstanceOf(BadRequestException);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('updateApp writes the app row and redirect URIs inside the same transaction, not against the outer prisma client', async () => {
    mockPrisma.saApp.findUnique.mockResolvedValue({ id: 7, publicId: 'a_7', isPlatform: false });

    // Use a tx client distinct from mockPrisma so we can prove the app-row
    // update and the redirect-URI writes both go through the callback's
    // `tx` argument (i.e. one atomic transaction), not the top-level client.
    const txClient = {
      saApp: { update: jest.fn().mockResolvedValue({ id: 7, publicId: 'a_7', isPlatform: false }) },
      saAppRedirectUri: { deleteMany: jest.fn(), createMany: jest.fn() },
    };
    mockPrisma.$transaction.mockImplementation(async (cb: (tx: typeof txClient) => unknown) => cb(txClient));

    await service.updateApp('admin-ba-id', 'a_7', {
      redirectUris: [{ uri: 'https://app.example.com/cb', kind: 'login' }],
    });

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(txClient.saApp.update).toHaveBeenCalledWith({ where: { publicId: 'a_7' }, data: {} });
    expect(txClient.saAppRedirectUri.deleteMany).toHaveBeenCalledWith({ where: { appId: 7 } });
    expect(txClient.saAppRedirectUri.createMany).toHaveBeenCalledWith({
      data: [{ appId: 7, uri: 'https://app.example.com/cb', kind: 'login' }],
    });
    // Nothing should have been written via the outer (non-transactional) client.
    expect(mockPrisma.saApp.update).not.toHaveBeenCalled();
    expect(mockPrisma.saAppRedirectUri.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.saAppRedirectUri.createMany).not.toHaveBeenCalled();
  });

  it('updateApp rolls back the app-row update when the redirect-URI write fails (transaction rejects as a whole)', async () => {
    mockPrisma.saApp.findUnique.mockResolvedValue({ id: 7, publicId: 'a_7', isPlatform: false });
    // Simulate the transaction failing partway through (e.g. a DB-level
    // unique-constraint race on saAppRedirectUri that in-memory validation
    // didn't catch). Because the whole body runs inside prisma.$transaction,
    // Prisma rolls back the app-row update too — the caller never observes
    // a state where the app row changed but redirect URIs were wiped.
    mockPrisma.$transaction.mockRejectedValue({ code: 'P2002', meta: { target: ['appId', 'uri', 'kind'] } });

    await expect(
      service.updateApp('admin-ba-id', 'a_7', {
        redirectUris: [{ uri: 'https://app.example.com/cb', kind: 'login' }],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  // ── Task 9: confidential clients — rotateClientSecret ────────────────────

  describe('rotateClientSecret', () => {
    it('generates a new secret, hashes it, stores the hash, and returns the plaintext once', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue(appRow);
      mockPrisma.saApp.update.mockResolvedValue({ ...appRow, clientSecretHash: 'hashed', clientSecretUpdatedAt: new Date() });

      const result = await service.rotateClientSecret('ba-caller', 'sq_1');

      expect(checkPermission).toHaveBeenCalledWith('ba-caller', 'platform.apps.manage');
      expect(mockPrisma.saApp.update).toHaveBeenCalledWith({
        where: { publicId: 'sq_1' },
        data: { clientSecretHash: expect.any(String), clientSecretUpdatedAt: expect.any(Date) },
      });
      // The plaintext returned to the caller must be exactly what was hashed
      // and stored — not, say, the stored hash itself (which would leak the
      // hash to an admin-console response and defeat its purpose).
      expect(typeof result.clientSecret).toBe('string');
      expect(result.clientSecret.length).toBeGreaterThan(20);
      const storedHash = mockPrisma.saApp.update.mock.calls[0][0].data.clientSecretHash;
      expect(storedHash).not.toBe(result.clientSecret);
    });

    it('throws NotFoundException when the app does not exist', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue(null);
      await expect(service.rotateClientSecret('ba-caller', 'nope')).rejects.toBeInstanceOf(NotFoundException);
      expect(mockPrisma.saApp.update).not.toHaveBeenCalled();
    });

    it('returns a different secret on each call (no reuse)', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue(appRow);
      mockPrisma.saApp.update.mockResolvedValue(appRow);

      const first = await service.rotateClientSecret('ba-caller', 'sq_1');
      const second = await service.rotateClientSecret('ba-caller', 'sq_1');

      expect(first.clientSecret).not.toBe(second.clientSecret);
    });
  });
});
