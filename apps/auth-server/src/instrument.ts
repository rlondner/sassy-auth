import * as Sentry from '@sentry/nestjs';
import { setupOtel, buildDatadogSpanProcessors, setupLogging } from './telemetry/otel';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
  // Kept for Sentry's own log capture (breadcrumbs, SDK-internal logging).
  // Federated-auth audit events now flow through the real OTel LoggerProvider
  // set up by setupLogging() below, which fans out to both Datadog and Sentry
  // via SentryLogRecordExporter — see that file for why a dedicated exporter
  // replaced the old one-off telemetry-sentry-adapter.ts.
  enableLogs: true,
  integrations: [Sentry.prismaIntegration()],
  openTelemetrySpanProcessors: buildDatadogSpanProcessors(),
});

setupLogging();
export const otel = setupOtel();
