import { ExecutionContext, HttpException } from '@nestjs/common';
import { RateLimitGuard } from './rate-limit.guard';

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
    process.env.REGISTER_RATE_WINDOW_MS = '1'; // 1ms window — expires immediately
    const guard = new RateLimitGuard();
    const ctx = makeCtx('10.0.0.3');

    expect(guard.canActivate(ctx)).toBe(true);
    // Window of 1ms has passed — should reset
    // Small delay to let the window pass
    const past = Date.now() - 10;
    // Simulate by manipulating the internal state
    // We'll just create a fresh guard with a very small window
    const guard2 = new RateLimitGuard();
    // Access the internal map to backdate the window start
    const internalMap = (guard2 as unknown as { store: Map<string, { count: number; windowStart: number }> }).store;
    internalMap.set('10.0.0.3', { count: 1, windowStart: past });
    // Now the window should have expired (1ms ago, window is 1ms)
    expect(guard2.canActivate(ctx)).toBe(true); // window expired, reset to 1
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
});
