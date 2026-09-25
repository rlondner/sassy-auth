import * as Sentry from '@sentry/nestjs';
import { logger as sentryLogger } from '@sentry/nestjs';
import { setupOtelMetrics, setupOtelLogging, buildDatadogSpanProcessors } from '@sassy-auth/telemetry/server';

const SERVICE_NAME = process.env.OTEL_SERVICE_NAME ?? 'sassy-auth-auth-server';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
  // Kept for Sentry's own log capture (breadcrumbs, SDK-internal logging).
  // Federated-auth audit events flow through the real OTel LoggerProvider
  // set up by setupOtelLogging() below, which fans out to both Datadog and
  // Sentry via SentryLogRecordExporter (packages/telemetry).
  enableLogs: true,
  integrations: [Sentry.prismaIntegration()],
  openTelemetrySpanProcessors: buildDatadogSpanProcessors(),
});

setupOtelLogging(SERVICE_NAME, sentryLogger);
export const otel = setupOtelMetrics(SERVICE_NAME, 'sassy-auth.auth-server');
