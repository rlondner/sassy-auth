jest.mock('@sassy-auth/db', () => ({
  prisma: { user: { deleteMany: jest.fn() } },
}));

import { prisma } from '@sassy-auth/db';
import {
  AbandonedSignupCleanupService,
  ABANDONED_SIGNUP_SWEEP_INTERVAL_MS,
  ABANDONED_SIGNUP_TTL_MS,
} from './abandoned-signup-cleanup.service';

const mockPrisma = prisma as unknown as { user: { deleteMany: jest.Mock } };

const winston = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() };
const mockLogger = {
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  getWinstonLogger: () => winston,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

function makeService(): AbandonedSignupCleanupService {
  return new AbandonedSignupCleanupService(mockLogger);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.user.deleteMany.mockResolvedValue({ count: 0 });
});

describe('AbandonedSignupCleanupService.sweep', () => {
  it('deletes only unverified, SaUser-less accounts older than the TTL', async () => {
    const before = Date.now();
    await makeService().sweep();
    const after = Date.now();

    expect(mockPrisma.user.deleteMany).toHaveBeenCalledTimes(1);
    const arg = mockPrisma.user.deleteMany.mock.calls[0][0];
    expect(arg.where.emailVerified).toBe(false);
    expect(arg.where.saUser).toBeNull();
    const cutoff = arg.where.createdAt.lt as Date;
    expect(cutoff.getTime()).toBeGreaterThanOrEqual(before - ABANDONED_SIGNUP_TTL_MS);
    expect(cutoff.getTime()).toBeLessThanOrEqual(after - ABANDONED_SIGNUP_TTL_MS);
  });

  it('returns the number of rows removed', async () => {
    mockPrisma.user.deleteMany.mockResolvedValue({ count: 3 });
    await expect(makeService().sweep()).resolves.toBe(3);
  });

  it('logs a sweep that removed rows', async () => {
    mockPrisma.user.deleteMany.mockResolvedValue({ count: 2 });
    await makeService().sweep();
    expect(winston.info).toHaveBeenCalledWith(
      expect.stringContaining('abandoned signup'),
      expect.objectContaining({ removed: 2 }),
    );
  });

  it('stays quiet when there was nothing to remove', async () => {
    await makeService().sweep();
    expect(winston.info).not.toHaveBeenCalled();
  });

  it('swallows a database failure and reports 0 rather than rejecting', async () => {
    mockPrisma.user.deleteMany.mockRejectedValue(new Error('connection reset'));
    await expect(makeService().sweep()).resolves.toBe(0);
    expect(winston.warn).toHaveBeenCalledWith(
      expect.stringContaining('cleanup failed'),
      expect.objectContaining({ error: 'connection reset' }),
    );
  });
});

describe('AbandonedSignupCleanupService scheduling', () => {
  const realNodeEnv = process.env.NODE_ENV;
  beforeEach(() => {
    process.env.NODE_ENV = 'development';
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
    process.env.NODE_ENV = realNodeEnv;
  });

  it('sweeps once immediately on startup', () => {
    const service = makeService();
    service.onModuleInit();
    expect(mockPrisma.user.deleteMany).toHaveBeenCalledTimes(1);
    service.onModuleDestroy();
  });

  it('sweeps again on every interval tick', () => {
    const service = makeService();
    service.onModuleInit();
    jest.advanceTimersByTime(ABANDONED_SIGNUP_SWEEP_INTERVAL_MS);
    expect(mockPrisma.user.deleteMany).toHaveBeenCalledTimes(2);
    service.onModuleDestroy();
  });

  it('stops sweeping once the module is destroyed', () => {
    const service = makeService();
    service.onModuleInit();
    service.onModuleDestroy();
    jest.advanceTimersByTime(ABANDONED_SIGNUP_SWEEP_INTERVAL_MS * 5);
    expect(mockPrisma.user.deleteMany).toHaveBeenCalledTimes(1);
  });

  it('does not hold the process open on its own', () => {
    const service = makeService();
    service.onModuleInit();
    expect(service.timerHasRef()).toBe(false);
    service.onModuleDestroy();
  });

  it('is inert under NODE_ENV=test', () => {
    process.env.NODE_ENV = 'test';
    const service = makeService();
    service.onModuleInit();
    expect(mockPrisma.user.deleteMany).not.toHaveBeenCalled();
    service.onModuleDestroy();
  });
});
