import { InMemoryMetricExporter, AggregationTemporality, MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { metrics } from '@opentelemetry/api';

describe('auth-metrics', () => {
  let exporter: InMemoryMetricExporter;
  let reader: PeriodicExportingMetricReader;

  beforeEach(async () => {
    jest.resetModules();
    exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    reader = new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 100000 });
    const provider = new MeterProvider({ readers: [reader] });
    metrics.setGlobalMeterProvider(provider);
  });

  it('records a sign-in outcome counter', async () => {
    const { recordSignInOutcome } = await import('./auth-metrics');
    recordSignInOutcome('invalid_credentials');

    // Force a collection via the reader's public API rather than reaching
    // into SDK internals (e.g. `_sharedState.metricCollectors`).
    await reader.forceFlush();
    const collected = exporter.getMetrics();
    const serialized = JSON.stringify(collected);
    expect(serialized).toContain('auth.signin.count');
    expect(serialized).toContain('invalid_credentials');
  });

  it('swallows a counter.add failure without throwing (telemetry must never break the app)', async () => {
    const { recordSignInOutcome } = await import('./auth-metrics');
    const counterProto = Object.getPrototypeOf(
      (metrics.getMeterProvider() as MeterProvider).getMeter('sassy-auth.auth-server').createCounter('tmp'),
    );
    const spy = jest.spyOn(counterProto, 'add').mockImplementation(() => {
      throw new Error('add exploded');
    });
    try {
      expect(() => recordSignInOutcome('ok')).not.toThrow();
    } finally {
      spy.mockRestore();
    }
  });

  it('records a federation outcome counter', async () => {
    const { recordFederationOutcome } = await import('./auth-metrics');
    expect(() =>
      recordFederationOutcome({ provider: 'google', type: 'social.signin.rejected', outcome: 'email_unverified' }),
    ).not.toThrow();
  });

  it('records a 2FA challenge outcome counter', async () => {
    const { record2faChallengeOutcome } = await import('./auth-metrics');
    expect(() => record2faChallengeOutcome('missing_or_invalid_code')).not.toThrow();
  });

  it('records a registration rate-limit counter', async () => {
    const { recordRegistrationRateLimited } = await import('./auth-metrics');
    expect(() => recordRegistrationRateLimited()).not.toThrow();
  });
});
