import * as Sentry from '@sentry/nextjs';
import { logger as sentryLogger } from '@sentry/nextjs';
import { buildDatadogSpanProcessors, setupOtelLogging } from '@sassy-auth/telemetry/server';

const SERVICE_NAME = process.env.OTEL_SERVICE_NAME ?? 'sassy-auth-admin';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
  openTelemetrySpanProcessors: buildDatadogSpanProcessors(),
});

setupOtelLogging(SERVICE_NAME, sentryLogger);
