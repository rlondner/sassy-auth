import * as Sentry from '@sentry/nestjs';
import { setupOtel, buildDatadogSpanProcessors } from './telemetry/otel';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
  enableLogs: true,
  integrations: [Sentry.prismaIntegration()],
  openTelemetrySpanProcessors: buildDatadogSpanProcessors(),
});

export const otel = setupOtel();
