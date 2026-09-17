import { metrics } from '@opentelemetry/api';
import type { SentryLoggerLike } from './sentry-log-exporter';

describe('isDatadogOtlpEnabled', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('is false when OTEL_EXPORTER_OTLP_ENDPOINT is unset', async () => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const { isDatadogOtlpEnabled } = await import('./server');
    expect(isDatadogOtlpEnabled()).toBe(false);
  });

  it('is true when OTEL_EXPORTER_OTLP_ENDPOINT is set', async () => {
    delete process.env.OTEL_SDK_DISABLED;
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'https://otlp.datadoghq.com';
    const { isDatadogOtlpEnabled } = await import('./server');
    expect(isDatadogOtlpEnabled()).toBe(true);
  });

  it('is false when OTEL_SDK_DISABLED is true, even if the endpoint is set', async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'https://otlp.datadoghq.com';
    process.env.OTEL_SDK_DISABLED = 'true';
    const { isDatadogOtlpEnabled } = await import('./server');
    expect(isDatadogOtlpEnabled()).toBe(false);
  });
});

describe('buildDatadogSpanProcessors', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('returns an empty array when the endpoint is unset', async () => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const { buildDatadogSpanProcessors } = await import('./server');
    expect(buildDatadogSpanProcessors()).toEqual([]);
  });

  it('returns one span processor when the endpoint is set', async () => {
    delete process.env.OTEL_SDK_DISABLED;
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'https://otlp.datadoghq.com';
    process.env.OTEL_EXPORTER_OTLP_HEADERS = 'dd-api-key=test-key';
    const { buildDatadogSpanProcessors } = await import('./server');
    expect(buildDatadogSpanProcessors()).toHaveLength(1);
  });
});

describe('setupOtelMetrics', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('returns a meter namespaced to the given meter name', async () => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const { setupOtelMetrics } = await import('./server');
    const { meter } = setupOtelMetrics('sassy-auth-auth-server', 'sassy-auth.auth-server');
    expect(meter).toBeDefined();
    expect(metrics.getMeterProvider().getMeter).toBeDefined();
  });

  it('does not throw when the endpoint is set but unreachable', async () => {
    delete process.env.OTEL_SDK_DISABLED;
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'https://otlp.datadoghq.com';
    process.env.OTEL_EXPORTER_OTLP_HEADERS = 'dd-api-key=test-key';
    process.env.OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE = 'delta';
    const { setupOtelMetrics } = await import('./server');
    expect(() => setupOtelMetrics('sassy-auth-auth-server', 'sassy-auth.auth-server')).not.toThrow();
  });

  // Confirms the installed @opentelemetry/exporter-metrics-otlp-http version
  // actually auto-reads OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE —
  // this is what lets server.ts construct `new OTLPMetricExporter()` with no
  // explicit temporality selector and still get delta temporality, which
  // Datadog's OTLP intake requires for Sums/Histograms.
  it('the metric exporter honors OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=delta', async () => {
    process.env.OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE = 'delta';
    const { OTLPMetricExporter } = await import('@opentelemetry/exporter-metrics-otlp-http');
    const { AggregationTemporality, InstrumentType } = await import('@opentelemetry/sdk-metrics');
    const exporter = new OTLPMetricExporter();
    expect(exporter.selectAggregationTemporality?.(InstrumentType.COUNTER)).toBe(AggregationTemporality.DELTA);
  });
});

describe('setupOtelLogging', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('does not throw regardless of env configuration', async () => {
    const { setupOtelLogging } = await import('./server');
    expect(() => setupOtelLogging('sassy-auth-auth-server')).not.toThrow();
  });

  it('does not throw when a Sentry DSN and logger are both provided', async () => {
    process.env.SENTRY_DSN = 'https://example.invalid/1';
    const { setupOtelLogging } = await import('./server');
    const fakeLogger: SentryLoggerLike = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    expect(() => setupOtelLogging('sassy-auth-auth-server', fakeLogger)).not.toThrow();
  });

  it('does not throw when SENTRY_DSN is set but no logger is provided', async () => {
    process.env.SENTRY_DSN = 'https://example.invalid/1';
    const { setupOtelLogging } = await import('./server');
    expect(() => setupOtelLogging('sassy-auth-auth-server')).not.toThrow();
  });
});
