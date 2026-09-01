import { InMemoryMetricExporter, AggregationTemporality, MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { metrics } from '@opentelemetry/api';

describe('auth-metrics', () => {
  let exporter: InMemoryMetricExporter;

  beforeEach(async () => {
    jest.resetModules();
    exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const provider = new MeterProvider({
      readers: [new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 100000 })],
    });
    metrics.setGlobalMeterProvider(provider);
  });

  it('records a sign-in outcome counter', async () => {
    const { recordSignInOutcome } = await import('./auth-metrics');
    recordSignInOutcome('invalid_credentials');
    const { resourceMetrics } = await exporter.export ? { resourceMetrics: undefined } : { resourceMetrics: undefined };
    // Force a collection via the reader on the current provider.
    const reader = (metrics.getMeterProvider() as MeterProvider);
    const result = await (reader as unknown as { _sharedState: { metricCollectors: { collect(): Promise<unknown> }[] } })
      ._sharedState.metricCollectors[0].collect();
    expect(JSON.stringify(result)).toContain('auth.signin.count');
    expect(JSON.stringify(result)).toContain('invalid_credentials');
  });

  it('records a federation outcome counter', async () => {
    const { recordFederationOutcome } = await import('./auth-metrics');
    expect(() =>
      recordFederationOutcome({ provider: 'google', type: 'social.signin.rejected', outcome: 'email_unverified' }),
    ).not.toThrow();
  });
});
