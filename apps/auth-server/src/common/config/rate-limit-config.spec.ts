describe('rate-limit-config', () => {
  const ENV_KEYS = [
    'NODE_ENV',
    'DEFAULT_RATE_LIMIT',
    'DEFAULT_RATE_WINDOW_MS',
    'AUTH_RATE_LIMIT',
    'AUTH_RATE_WINDOW_MS',
  ] as const;
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
    // Re-import so the module-level `const`s re-evaluate against the env
    // vars set for this test.
    return jest.requireActual('./rate-limit-config') as typeof import('./rate-limit-config');
  }

  it('falls back to documented defaults when unset (non-test NODE_ENV)', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.DEFAULT_RATE_LIMIT;
    delete process.env.DEFAULT_RATE_WINDOW_MS;
    delete process.env.AUTH_RATE_LIMIT;
    delete process.env.AUTH_RATE_WINDOW_MS;
    jest.resetModules();

    const { DEFAULT_THROTTLE, AUTH_THROTTLE } = load();

    expect(DEFAULT_THROTTLE).toEqual({ ttl: 60_000, limit: 120 });
    expect(AUTH_THROTTLE).toEqual({ ttl: 60_000, limit: 10 });
  });

  it('reads configured values from env', () => {
    process.env.NODE_ENV = 'production';
    process.env.DEFAULT_RATE_LIMIT = '250';
    process.env.DEFAULT_RATE_WINDOW_MS = '30000';
    process.env.AUTH_RATE_LIMIT = '3';
    process.env.AUTH_RATE_WINDOW_MS = '15000';
    jest.resetModules();

    const { DEFAULT_THROTTLE, AUTH_THROTTLE } = load();

    expect(DEFAULT_THROTTLE).toEqual({ ttl: 30_000, limit: 250 });
    expect(AUTH_THROTTLE).toEqual({ ttl: 15_000, limit: 3 });
  });

  it('ignores zero, negative, and non-numeric overrides and falls back', () => {
    process.env.NODE_ENV = 'production';
    process.env.AUTH_RATE_LIMIT = '0';
    process.env.AUTH_RATE_WINDOW_MS = 'not-a-number';
    jest.resetModules();

    const { AUTH_THROTTLE } = load();

    expect(AUTH_THROTTLE).toEqual({ ttl: 60_000, limit: 10 });
  });

  it('forces both buckets to a high limit under NODE_ENV=test regardless of env overrides', () => {
    process.env.NODE_ENV = 'test';
    process.env.AUTH_RATE_LIMIT = '1';
    process.env.AUTH_RATE_WINDOW_MS = '1';
    jest.resetModules();

    const { DEFAULT_THROTTLE, AUTH_THROTTLE } = load();

    expect(DEFAULT_THROTTLE).toEqual({ ttl: 60_000, limit: 10_000 });
    expect(AUTH_THROTTLE).toEqual({ ttl: 60_000, limit: 10_000 });
  });
});
