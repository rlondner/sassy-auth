import { ExecutionContext, HttpException } from '@nestjs/common';
import { RateLimitGuard, AppLookupRateLimitGuard } from './rate-limit.guard';

function makeCtx(ip: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        ip,
        headers: {},
        socket: { remoteAddress: ip },
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('RateLimitGuard', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.clearAllMocks();
  });

  it('allows N requests from one IP within the window', () => {
    process.env.REGISTER_RATE_LIMIT = '3';
    process.env.REGISTER_RATE_WINDOW_MS = '3600000';
    const guard = new RateLimitGuard();
    const ctx = makeCtx('10.0.0.1');

    expect(guard.canActivate(ctx)).toBe(true);
    expect(guard.canActivate(ctx)).toBe(true);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('blocks the N+1th request from the same IP with 429', () => {
    process.env.REGISTER_RATE_LIMIT = '3';
    process.env.REGISTER_RATE_WINDOW_MS = '3600000';
    const guard = new RateLimitGuard();
    const ctx = makeCtx('10.0.0.2');

    guard.canActivate(ctx);
    guard.canActivate(ctx);
    guard.canActivate(ctx);

    expect(() => guard.canActivate(ctx)).toThrow(HttpException);
    try {
      guard.canActivate(ctx);
    } catch (e) {
      expect((e as HttpException).getStatus()).toBe(429);
    }
  });

  it('does not affect a different IP', () => {
    process.env.REGISTER_RATE_LIMIT = '2';
    process.env.REGISTER_RATE_WINDOW_MS = '3600000';
    const guard = new RateLimitGuard();
    const ctxA = makeCtx('192.168.1.1');
    const ctxB = makeCtx('192.168.1.2');

    guard.canActivate(ctxA);
    guard.canActivate(ctxA);
    // ctxA is now at limit
    expect(() => guard.canActivate(ctxA)).toThrow(HttpException);

    // ctxB should still be allowed
    expect(guard.canActivate(ctxB)).toBe(true);
  });

  it('resets the counter after the window expires', () => {
    process.env.REGISTER_RATE_LIMIT = '1';
    process.env.REGISTER_RATE_WINDOW_MS = '1000'; // 1000ms window
    const guard = new RateLimitGuard();
    const ctx = makeCtx('10.0.0.3');
    const ip = '10.0.0.3';

    // First request from this IP passes and creates an entry
    expect(guard.canActivate(ctx)).toBe(true);

    // Access the internal store to backdate the window start so it appears expired
    const store = (guard as unknown as { store: Map<string, { count: number; windowStart: number }> }).store;
    const windowMs = 1000;
    const now = Date.now();
    // Backdate: make windowStart strictly older than the window
    store.set(ip, { count: 1, windowStart: now - (windowMs + 1) });

    // Next request from the same IP should be allowed because the old window expired
    expect(guard.canActivate(ctx)).toBe(true); // Should NOT throw 429
    // Verify the counter was reset (should be 1, not 2)
    const entry = store.get(ip);
    expect(entry?.count).toBe(1);
  });

  it('allows all requests when REGISTER_RATE_LIMIT is 0 (dev mode)', () => {
    process.env.REGISTER_RATE_LIMIT = '0';
    const guard = new RateLimitGuard();
    const ctx = makeCtx('10.0.0.4');

    for (let i = 0; i < 50; i++) {
      expect(guard.canActivate(ctx)).toBe(true);
    }
  });

  it('allows all requests when REGISTER_RATE_LIMIT is unset (dev mode)', () => {
    delete process.env.REGISTER_RATE_LIMIT;
    const guard = new RateLimitGuard();
    const ctx = makeCtx('10.0.0.5');

    for (let i = 0; i < 50; i++) {
      expect(guard.canActivate(ctx)).toBe(true);
    }
  });

  // Regression test for the review finding this fixes: RateLimitGuard (used
  // by POST /api/register) and AppLookupRateLimitGuard (used by GET
  // /api/register/app) must be separate DI singletons with independent
  // in-memory stores, so exhausting one's budget does not affect the other's.
  it('does not share its rate-limit budget with AppLookupRateLimitGuard', () => {
    process.env.REGISTER_RATE_LIMIT = '2';
    process.env.REGISTER_RATE_WINDOW_MS = '3600000';
    const postGuard = new RateLimitGuard();
    const appLookupGuard = new AppLookupRateLimitGuard();
    const ctx = makeCtx('10.0.0.6');

    // Exhaust the POST /api/register guard's budget for this IP.
    expect(postGuard.canActivate(ctx)).toBe(true);
    expect(postGuard.canActivate(ctx)).toBe(true);
    expect(() => postGuard.canActivate(ctx)).toThrow(HttpException);

    // The GET /api/register/app guard, for the same IP, should still have
    // its own full budget since it does not share state with postGuard.
    expect(appLookupGuard.canActivate(ctx)).toBe(true);
    expect(appLookupGuard.canActivate(ctx)).toBe(true);
    expect(() => appLookupGuard.canActivate(ctx)).toThrow(HttpException);
  });
});
