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
import { SentryLogRecordExporter } from './sentry-log-exporter';

const SERVICE_NAME = process.env.OTEL_SERVICE_NAME ?? 'sassy-auth-auth-server';

function datadogOtlpConfig(): { url: string; headers: Record<string, string> } | null {
  if (process.env.OTEL_SDK_DISABLED === 'true') return null;
  const apiKey = process.env.DD_API_KEY;
  if (!apiKey) return null;
  const site = process.env.DD_SITE ?? 'datadoghq.com';
  return { url: `https://otlp-http-intake.logs.${site}`, headers: { 'dd-api-key': apiKey } };
}

/**
 * Built and passed into `Sentry.init({ openTelemetrySpanProcessors: ... })`
 * BEFORE init runs — `@sentry/node` only stands up a real OTel span-processor
 * pipeline (vs. its default minimal SentryTracerProvider) when this option is
 * non-empty at init time. See this file's header note for the source trail.
 */
export function buildDatadogSpanProcessors(): SpanProcessor[] {
  const dd = datadogOtlpConfig();
  if (!dd) return [];
  return [
    new BatchSpanProcessor(
      new OTLPTraceExporter({ url: `${dd.url}/v1/traces`, headers: dd.headers }),
    ),
  ];
}

export function setupOtel(): { meter: Meter } {
  const resource = resourceFromAttributes({ [ATTR_SERVICE_NAME]: SERVICE_NAME });
  const dd = datadogOtlpConfig();

  const readers = dd
    ? [
        new PeriodicExportingMetricReader({
          exporter: new OTLPMetricExporter({ url: `${dd.url}/v1/metrics`, headers: dd.headers }),
        }),
      ]
    : [];

  const meterProvider = new MeterProvider({ resource, readers });
  metrics.setGlobalMeterProvider(meterProvider);

  return { meter: meterProvider.getMeter('sassy-auth.auth-server') };
}

export function setupLogging(): void {
  const resource = resourceFromAttributes({ [ATTR_SERVICE_NAME]: SERVICE_NAME });
  const dd = datadogOtlpConfig();

  // Installed @opentelemetry/sdk-logs (0.222.0 — see package.json comment)
  // takes processors via LoggerProviderOptions.processors and constructs
  // both processor kinds with an `{ exporter, ... }` options object, unlike
  // the addLogRecordProcessor()/positional-exporter API of 0.214.0.
  const processors: LogRecordProcessor[] = [];
  if (dd) {
    processors.push(
      new BatchLogRecordProcessor({ exporter: new OTLPLogExporter({ url: `${dd.url}/v1/logs`, headers: dd.headers }) }),
    );
  }
  if (process.env.SENTRY_DSN) {
    processors.push(new SimpleLogRecordProcessor({ exporter: new SentryLogRecordExporter() }));
  }

  const loggerProvider = new LoggerProvider({ resource, processors });
  logs.setGlobalLoggerProvider(loggerProvider);
}
