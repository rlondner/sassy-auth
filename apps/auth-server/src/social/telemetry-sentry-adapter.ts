import { logger as sentryLogger } from '@sentry/nestjs';

/**
 * The ONLY file in the social feature permitted to import `@sentry/*`
 * (task-15 fallback route — see docs/superpowers/specs/2026-08-22-social-authentication-design.md
 * §7 and .superpowers/sdd/2026-08-22-social-authentication/task-15-report.md for the full trail).
 *
 * Why a fallback, and not the "register a real OTel LoggerProvider" preferred
 * route: `record-federation-event.ts` emits through `@opentelemetry/api-logs`
 * (`logs.getLogger(...).emit(...)`), which is a documented no-op until
 * something calls `logs.setGlobalLoggerProvider(...)`. Nothing in this
 * dependency tree does. Established by reading the installed packages
 * (all paths below are under this worktree's `node_modules/.pnpm/`,
 * version 10.54.0 / 0.214.0 as pinned in apps/auth-server/package.json):
 *
 * - `@opentelemetry/sdk-logs` is not installed anywhere in the tree (only
 *   `@opentelemetry/sdk-trace-base` is, pulled in transitively by
 *   `@sentry/opentelemetry`) — there is no LoggerProvider implementation to
 *   register even if we wanted to.
 * - `@sentry+opentelemetry@10.54.0/node_modules/@sentry/opentelemetry/build/cjs/index.js`
 *   (the whole package — index.js, index.browser.js, resource-*.js,
 *   tracingChannel.js) contains zero references to `LoggerProvider`,
 *   `setGlobalLoggerProvider`, or `@opentelemetry/api-logs`. It bridges OTel
 *   *spans* (context manager, span processor) into Sentry; it does not touch
 *   OTel logs at all.
 * - The same package also never mentions "exception" — an OTel
 *   `span.recordException()` call is not translated into a Sentry issue by
 *   this integration either (checked separately for the design doc's other
 *   open question; record-federation-event.ts does not call it today).
 * - `@sentry/node` (and therefore `@sentry/nestjs`, which re-exports it —
 *   see `@sentry+nestjs@10.54.0/node_modules/@sentry/nestjs/build/types/index.d.ts:1`,
 *   `export * from '@sentry/node'`) exposes its OWN structured-logging API:
 *   `Sentry.logger.{trace,debug,info,warn,error,fatal}`
 *   (`@sentry+core@10.54.0/node_modules/@sentry/core/build/cjs/logs/public-api.js`).
 *   That calls `_INTERNAL_captureLog` in
 *   `@sentry/core/build/cjs/logs/internal.js`, which is gated ONLY by the
 *   client's `enableLogs` option:
 *     `const { release, environment, enableLogs = false, beforeSendLog } = client.getOptions();`
 *     `if (!enableLogs) { ...; return; }`
 *   — grep that file for "tracesSampleRate" or any span/sampling reference:
 *   there is none. This capture path is independent of trace sampling,
 *   which is exactly the guarantee `record-federation-event.ts` requires
 *   (see its own "Sink 2" comment). `instrument.ts` sets `enableLogs: true`
 *   to open this gate; `tracesSampleRate` is untouched.
 *
 * So the vendor-neutral OTel Logs API has no consumer on this stack, and
 * Sentry's real log ingestion path is its own `logger` namespace, not OTel's.
 * That makes the "register a LoggerProvider" route genuinely impossible
 * without adding a net-new package (`@opentelemetry/sdk-logs`) and writing a
 * custom OTLP-to-Sentry log exporter that does not exist upstream — out of
 * proportion for one audit sink. Hence this adapter: it satisfies the `emit`
 * seam `record-federation-event.ts` already accepts
 * (`FederationEventDeps['emit']`) and is the sole Sentry-import boundary.
 */
export function emitFederationEventToSentry(
  severity: string,
  attributes: Record<string, unknown>,
): void {
  const message = String(attributes['auth.event'] ?? 'social.federation.event');
  if (severity === 'ERROR') {
    sentryLogger.error(message, attributes);
  } else if (severity === 'WARN') {
    sentryLogger.warn(message, attributes);
  } else {
    sentryLogger.info(message, attributes);
  }
}
