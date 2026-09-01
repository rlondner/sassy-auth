import * as Sentry from '@sentry/nextjs';
import { BatchSpanProcessor, type SpanProcessor } from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

function buildDatadogSpanProcessors(): SpanProcessor[] {
  if (process.env.OTEL_SDK_DISABLED === 'true') return [];
  const ddApiKey = process.env.DD_API_KEY;
  if (!ddApiKey) return [];
  const site = process.env.DD_SITE ?? 'datadoghq.com';
  return [
    new BatchSpanProcessor(
      new OTLPTraceExporter({
        url: `https://otlp-http-intake.logs.${site}/v1/traces`,
        headers: { 'dd-api-key': ddApiKey },
      }),
    ),
  ];
}

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
  openTelemetrySpanProcessors: buildDatadogSpanProcessors(),
});
