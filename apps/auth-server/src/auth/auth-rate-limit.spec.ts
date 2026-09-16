import { createAuthRateLimiter, isSensitiveAuthPath } from './auth-rate-limit';

const ENV_KEYS = ['NODE_ENV', 'AUTH_RATE_LIMIT', 'AUTH_RATE_WINDOW_MS'] as const;

type FakeRes = {
  statusCode?: number;
  body?: unknown;
  headers: Record<string, string>;
  status: (code: number) => FakeRes;
  json: (body: unknown) => FakeRes;
  setHeader: (name: string, value: string | number) => void;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeRes(): any {
  const res: FakeRes = {
    headers: {},
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(body) {
      res.body = body;
      return res;
    },
    setHeader(name, value) {
      res.headers[name.toLowerCase()] = String(value);
    },
  };
  return res;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeReq(path: string, ip = '10.0.0.1'): any {
  return { path, originalUrl: path, ip, ips: [] };
}

describe('isSensitiveAuthPath', () => {
  it.each([
    '/api/auth/sign-in/email',
    '/api/auth/sign-up/email',
    '/api/auth/forget-password',
    '/api/auth/reset-password',
    '/api/auth/sign-in/magic-link',
    '/api/auth/email-otp/send-verification-otp',
    '/api/auth/two-factor/verify-totp',
  ])('treats %s as sensitive', (path) => {
    expect(isSensitiveAuthPath(path)).toBe(true);
  });

  it.each(['/api/auth/get-session', '/api/auth/sign-out', '/api/auth/ok', '/api/users'])(
    'treats %s as not sensitive',
    (path) => {
      expect(isSensitiveAuthPath(path)).toBe(false);
    },
  );

  it('matches when the path is mounted without the /api/auth prefix', () => {
    expect(isSensitiveAuthPath('/sign-in/email')).toBe(true);
  });

  it('ignores a query string', () => {
    expect(isSensitiveAuthPath('/api/auth/sign-in/email?redirect=%2F')).toBe(true);
  });
});

describe('createAuthRateLimiter', () => {
  it('lets non-sensitive paths through regardless of volume', () => {
    const limiter = createAuthRateLimiter({ windowMs: 60_000, max: 2, now: () => 0 });
    const next = jest.fn();

    for (let i = 0; i < 50; i++) {
      limiter(makeReq('/api/auth/get-session'), makeRes(), next);
    }

    expect(next).toHaveBeenCalledTimes(50);
  });

  it('allows up to max requests on a sensitive path', () => {
    const limiter = createAuthRateLimiter({ windowMs: 60_000, max: 3, now: () => 0 });
    const next = jest.fn();

    for (let i = 0; i < 3; i++) {
      limiter(makeReq('/api/auth/sign-in/email'), makeRes(), next);
    }

    expect(next).toHaveBeenCalledTimes(3);
  });

  it('rejects the request after max is exceeded with 429 and does not call next', () => {
    const limiter = createAuthRateLimiter({ windowMs: 60_000, max: 3, now: () => 0 });
    const next = jest.fn();
    for (let i = 0; i < 3; i++) {
      limiter(makeReq('/api/auth/sign-in/email'), makeRes(), next);
    }

    const res = makeRes();
    limiter(makeReq('/api/auth/sign-in/email'), res, next);

    expect(next).toHaveBeenCalledTimes(3);
    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toBe('60');
  });

  it('never includes the credential or path detail in the 429 body', () => {
    const limiter = createAuthRateLimiter({ windowMs: 60_000, max: 1, now: () => 0 });
    limiter(makeReq('/api/auth/sign-in/email'), makeRes(), jest.fn());

    const res = makeRes();
    limiter(makeReq('/api/auth/sign-in/email'), res, jest.fn());

    expect(res.body).toEqual({
      statusCode: 429,
      message: 'Too many requests. Please try again later.',
      error: 'Too Many Requests',
    });
  });

  it('counts each client IP separately', () => {
    const limiter = createAuthRateLimiter({ windowMs: 60_000, max: 1, now: () => 0 });
    const next = jest.fn();

    limiter(makeReq('/api/auth/sign-in/email', '10.0.0.1'), makeRes(), next);
    limiter(makeReq('/api/auth/sign-in/email', '10.0.0.2'), makeRes(), next);

    expect(next).toHaveBeenCalledTimes(2);
  });

  it('counts all sensitive paths against one shared bucket per IP', () => {
    // A brute-forcer must not be able to double their budget by alternating
    // between sign-in and sign-up.
    const limiter = createAuthRateLimiter({ windowMs: 60_000, max: 2, now: () => 0 });
    const next = jest.fn();

    limiter(makeReq('/api/auth/sign-in/email'), makeRes(), next);
    limiter(makeReq('/api/auth/sign-up/email'), makeRes(), next);

    const res = makeRes();
    limiter(makeReq('/api/auth/forget-password'), res, next);

    expect(next).toHaveBeenCalledTimes(2);
    expect(res.statusCode).toBe(429);
  });

  it('resets the counter once the window elapses', () => {
    let clock = 0;
    const limiter = createAuthRateLimiter({ windowMs: 60_000, max: 1, now: () => clock });
    const next = jest.fn();

    limiter(makeReq('/api/auth/sign-in/email'), makeRes(), next);
    const blocked = makeRes();
    limiter(makeReq('/api/auth/sign-in/email'), blocked, next);
    expect(blocked.statusCode).toBe(429);

    clock = 60_001;
    limiter(makeReq('/api/auth/sign-in/email'), makeRes(), next);

    expect(next).toHaveBeenCalledTimes(2);
  });

  it('reports a Retry-After that shrinks as the window elapses', () => {
    let clock = 0;
    const limiter = createAuthRateLimiter({ windowMs: 60_000, max: 1, now: () => clock });
    limiter(makeReq('/api/auth/sign-in/email'), makeRes(), jest.fn());

    clock = 45_000;
    const res = makeRes();
    limiter(makeReq('/api/auth/sign-in/email'), res, jest.fn());

    expect(res.headers['retry-after']).toBe('15');
  });

  it('prefers the left-most X-Forwarded-For entry when express resolves ips', () => {
    const limiter = createAuthRateLimiter({ windowMs: 60_000, max: 1, now: () => 0 });
    const next = jest.fn();

    const a = makeReq('/api/auth/sign-in/email', '172.16.0.9');
    a.ips = ['203.0.113.7', '172.16.0.9'];
    const b = makeReq('/api/auth/sign-in/email', '172.16.0.9');
    b.ips = ['203.0.113.8', '172.16.0.9'];

    limiter(a, makeRes(), next);
    limiter(b, makeRes(), next);

    expect(next).toHaveBeenCalledTimes(2);
  });

  it('evicts expired buckets so the store does not grow without bound', () => {
    let clock = 0;
    const limiter = createAuthRateLimiter({ windowMs: 60_000, max: 5, now: () => clock });

    for (let i = 0; i < 200; i++) {
      limiter(makeReq('/api/auth/sign-in/email', `10.1.${Math.floor(i / 256)}.${i % 256}`), makeRes(), jest.fn());
    }
    expect(limiter.size()).toBe(200);

    clock = 120_001;
    limiter(makeReq('/api/auth/sign-in/email', '10.9.9.9'), makeRes(), jest.fn());

    expect(limiter.size()).toBe(1);
  });
});

describe('createDefaultAuthRateLimiter', () => {
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) original[key] = process.env[key];
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
    jest.resetModules();
  });

  function load() {
    // Re-import so this module and its rate-limit-config dependency
    // re-evaluate against the env vars set for this test.
    return jest.requireActual('./auth-rate-limit') as typeof import('./auth-rate-limit');
  }

  // This middleware sits in front of BetterAuth and previously hardcoded its
  // own bucket size, so raising AUTH_RATE_LIMIT (e.g. for local e2e runs
  // that sign in as several seeded admins back-to-back) had no effect on it
  // even though it did affect the Nest `auth` throttler bucket.
  it('honors AUTH_RATE_LIMIT / AUTH_RATE_WINDOW_MS instead of a hardcoded bucket', () => {
    process.env.NODE_ENV = 'production';
    process.env.AUTH_RATE_LIMIT = '2';
    process.env.AUTH_RATE_WINDOW_MS = '5000';
    jest.resetModules();

    const { createDefaultAuthRateLimiter } = load();
    const limiter = createDefaultAuthRateLimiter();
    const next = jest.fn();

    limiter(makeReq('/api/auth/sign-in/email'), makeRes(), next);
    limiter(makeReq('/api/auth/sign-in/email'), makeRes(), next);
    const blocked = makeRes();
    limiter(makeReq('/api/auth/sign-in/email'), blocked, next);

    expect(next).toHaveBeenCalledTimes(2);
    expect(blocked.statusCode).toBe(429);
  });

  it('stays effectively disabled under NODE_ENV=test regardless of env overrides', () => {
    process.env.NODE_ENV = 'test';
    process.env.AUTH_RATE_LIMIT = '1';
    process.env.AUTH_RATE_WINDOW_MS = '1';
    jest.resetModules();

    const { createDefaultAuthRateLimiter } = load();
    const limiter = createDefaultAuthRateLimiter();
    const next = jest.fn();

    for (let i = 0; i < 50; i++) {
      limiter(makeReq('/api/auth/sign-in/email'), makeRes(), next);
    }

    expect(next).toHaveBeenCalledTimes(50);
  });
});
