import * as Sentry from '@sentry/nestjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
  // task-15: opens the gate `@sentry/core`'s log-capture path checks
  // (`logs/internal.js`: `if (!enableLogs) return;`). That gate is entirely
  // separate from `tracesSampleRate` above — grep the same file for
  // "tracesSampleRate" and there is no reference — so federated-auth audit
  // events (emitted via telemetry-sentry-adapter.ts's `Sentry.logger.*`
  // calls) are never subject to trace sampling. See
  // apps/auth-server/src/social/telemetry-sentry-adapter.ts for the full
  // trail of why this route was chosen over an OTel LoggerProvider.
  enableLogs: true,
  integrations: [Sentry.prismaIntegration()],
});
