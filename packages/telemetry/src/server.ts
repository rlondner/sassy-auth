import { metrics, type Meter } from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';
import type { SpanProcessor } from '@opentelemetry/sdk-trace-base';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { LoggerProvider, BatchLogRecordProcessor, SimpleLogRecordProcessor } from '@opentelemetry/sdk-logs';
import type { LogRecordProcessor } from '@opentelemetry/sdk-logs';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { SentryLogRecordExporter, type SentryLoggerLike } from './sentry-log-exporter';

/**
 * Gates every exporter below. `OTLPTraceExporter`/`OTLPMetricExporter`/
 * `OTLPLogExporter` are constructed with no explicit url/headers — the
 * installed SDK versions read OTEL_EXPORTER_OTLP_ENDPOINT,
 * OTEL_EXPORTER_OTLP_HEADERS, and (for metrics)
 * OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE themselves, appending
 * /v1/traces, /v1/metrics, /v1/logs automatically.
 */
export function isDatadogOtlpEnabled(): boolean {
  return process.env.OTEL_SDK_DISABLED !== 'true' && !!process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
}

/**
 * Built and passed into `Sentry.init({ openTelemetrySpanProcessors: ... })`
 * BEFORE init runs — `@sentry/node`-family SDKs only stand up a real OTel
 * span-processor pipeline (vs. their default minimal SentryTracerProvider)
 * when this option is non-empty at init time.
 */
export function buildDatadogSpanProcessors(): SpanProcessor[] {
  if (!isDatadogOtlpEnabled()) return [];
  return [new BatchSpanProcessor(new OTLPTraceExporter())];
}

export function setupOtelMetrics(resourceServiceName: string, meterName: string): { meter: Meter } {
  const resource = resourceFromAttributes({ [ATTR_SERVICE_NAME]: resourceServiceName });
  const readers = isDatadogOtlpEnabled()
    ? [new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter() })]
    : [];

  const meterProvider = new MeterProvider({ resource, readers });
  metrics.setGlobalMeterProvider(meterProvider);

  return { meter: meterProvider.getMeter(meterName) };
}

export function setupOtelLogging(resourceServiceName: string, sentryLogger?: SentryLoggerLike): void {
  const resource = resourceFromAttributes({ [ATTR_SERVICE_NAME]: resourceServiceName });

  const processors: LogRecordProcessor[] = [];
  if (isDatadogOtlpEnabled()) {
    processors.push(new BatchLogRecordProcessor({ exporter: new OTLPLogExporter() }));
  }
  if (process.env.SENTRY_DSN && sentryLogger) {
    processors.push(new SimpleLogRecordProcessor({ exporter: new SentryLogRecordExporter(sentryLogger) }));
  }

  const loggerProvider = new LoggerProvider({ resource, processors });
  logs.setGlobalLoggerProvider(loggerProvider);
}
