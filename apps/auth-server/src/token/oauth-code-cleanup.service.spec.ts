jest.mock('@sassy-auth/db', () => ({
  prisma: { saOauthCode: { deleteMany: jest.fn() } },
}));

import { prisma } from '@sassy-auth/db';
import { OauthCodeCleanupService, OAUTH_CODE_SWEEP_INTERVAL_MS } from './oauth-code-cleanup.service';

const mockPrisma = prisma as unknown as { saOauthCode: { deleteMany: jest.Mock } };

const winston = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() };
const mockLogger = {
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  getWinstonLogger: () => winston,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

function makeService(): OauthCodeCleanupService {
  return new OauthCodeCleanupService(mockLogger);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.saOauthCode.deleteMany.mockResolvedValue({ count: 0 });
});

describe('OauthCodeCleanupService.sweep', () => {
  it('deletes only rows whose expiresAt is already in the past', async () => {
    const before = Date.now();
    await makeService().sweep();
    const after = Date.now();

    expect(mockPrisma.saOauthCode.deleteMany).toHaveBeenCalledTimes(1);
    const arg = mockPrisma.saOauthCode.deleteMany.mock.calls[0][0];
    const cutoff = arg.where.expiresAt.lt as Date;
    expect(cutoff.getTime()).toBeGreaterThanOrEqual(before);
    expect(cutoff.getTime()).toBeLessThanOrEqual(after);
  });

  it('returns the number of rows removed', async () => {
    mockPrisma.saOauthCode.deleteMany.mockResolvedValue({ count: 42 });

    await expect(makeService().sweep()).resolves.toBe(42);
  });

  it('logs a sweep that removed rows', async () => {
    mockPrisma.saOauthCode.deleteMany.mockResolvedValue({ count: 7 });

    await makeService().sweep();

    expect(winston.info).toHaveBeenCalledWith(
      expect.stringContaining('expired OAuth code'),
      expect.objectContaining({ removed: 7 }),
    );
  });

  it('stays quiet when there was nothing to remove', async () => {
    mockPrisma.saOauthCode.deleteMany.mockResolvedValue({ count: 0 });

    await makeService().sweep();

    expect(winston.info).not.toHaveBeenCalled();
  });

  it('swallows a database failure and reports 0 rather than rejecting', async () => {
    // The sweep runs from a timer with no caller to catch it — an unhandled
    // rejection here would take the process down.
    mockPrisma.saOauthCode.deleteMany.mockRejectedValue(new Error('connection reset'));

    await expect(makeService().sweep()).resolves.toBe(0);
    expect(winston.warn).toHaveBeenCalledWith(
      expect.stringContaining('cleanup failed'),
      expect.objectContaining({ error: 'connection reset' }),
    );
  });
});

describe('OauthCodeCleanupService scheduling', () => {
  // Jest sets NODE_ENV=test, which the service deliberately treats as "do not
  // schedule". These cases exercise the real runtime path, so pose as dev.
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

    expect(mockPrisma.saOauthCode.deleteMany).toHaveBeenCalledTimes(1);
    service.onModuleDestroy();
  });

  it('sweeps again on every interval tick', () => {
    const service = makeService();
    service.onModuleInit();

    jest.advanceTimersByTime(OAUTH_CODE_SWEEP_INTERVAL_MS);
    expect(mockPrisma.saOauthCode.deleteMany).toHaveBeenCalledTimes(2);

    jest.advanceTimersByTime(OAUTH_CODE_SWEEP_INTERVAL_MS);
    expect(mockPrisma.saOauthCode.deleteMany).toHaveBeenCalledTimes(3);

    service.onModuleDestroy();
  });

  it('stops sweeping once the module is destroyed', () => {
    const service = makeService();
    service.onModuleInit();
    service.onModuleDestroy();

    jest.advanceTimersByTime(OAUTH_CODE_SWEEP_INTERVAL_MS * 5);

    expect(mockPrisma.saOauthCode.deleteMany).toHaveBeenCalledTimes(1);
  });

  it('does not hold the process open on its own', () => {
    const service = makeService();
    service.onModuleInit();

    // An active handle here would stop the auth-server from exiting on SIGTERM.
    expect(service.timerHasRef()).toBe(false);

    service.onModuleDestroy();
  });

  it('is inert under NODE_ENV=test so suites do not inherit a stray timer', () => {
    process.env.NODE_ENV = 'test';
    const service = makeService();
    service.onModuleInit();

    expect(mockPrisma.saOauthCode.deleteMany).not.toHaveBeenCalled();
    jest.advanceTimersByTime(OAUTH_CODE_SWEEP_INTERVAL_MS * 3);
    expect(mockPrisma.saOauthCode.deleteMany).not.toHaveBeenCalled();

    service.onModuleDestroy();
  });

  it('tolerates onModuleDestroy without a prior onModuleInit', () => {
    expect(() => makeService().onModuleDestroy()).not.toThrow();
  });
});
