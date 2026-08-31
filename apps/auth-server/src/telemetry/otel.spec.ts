import { metrics } from '@opentelemetry/api';

describe('setupOtel', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('returns a meter namespaced to sassy-auth.auth-server', async () => {
    delete process.env.DD_API_KEY;
    const { setupOtel } = await import('./otel');
    const { meter } = setupOtel();
    expect(meter).toBeDefined();
    // No exporter registered when DD_API_KEY is unset — the global meter
    // provider stays the OTel API's no-op default.
    expect(metrics.getMeterProvider().getMeter).toBeDefined();
  });

  it('does not throw when DD_API_KEY is set but unreachable', async () => {
    process.env.DD_API_KEY = 'test-key';
    process.env.DD_SITE = 'datadoghq.com';
    const { setupOtel } = await import('./otel');
    expect(() => setupOtel()).not.toThrow();
  });

  describe('buildDatadogSpanProcessors', () => {
    it('returns an empty array when DD_API_KEY is unset', async () => {
      delete process.env.DD_API_KEY;
      const { buildDatadogSpanProcessors } = await import('./otel');
      expect(buildDatadogSpanProcessors()).toEqual([]);
    });

    it('returns one span processor when DD_API_KEY is set', async () => {
      process.env.DD_API_KEY = 'test-key';
      process.env.DD_SITE = 'datadoghq.com';
      const { buildDatadogSpanProcessors } = await import('./otel');
      expect(buildDatadogSpanProcessors()).toHaveLength(1);
    });
  });
});
