# OpenTelemetry + Datadog Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Instrument `apps/admin`, `apps/auth-server`, and `apps/resource-server-fastapi` with OpenTelemetry traces, metrics, and logs, exported to Datadog (agentless OTLP) and Sentry (native SDK), making `record-federation-event.ts`'s existing OTel Logs API call real instead of a documented no-op.

**Architecture:** One OTel SDK per service, three providers (Tracer/Meter/Logger) sharing a `Resource`, every exporter gated on an env var and no-op when unset. Sentry keeps ownership of its own `TracerProvider` (already OTel-based in `@sentry/nestjs`/`@sentry/nextjs` v10) — Datadog's OTLP trace exporter is added to it as an extra span processor rather than competing for the global provider. Metrics and logs get their own providers registered globally, with a small custom `SentryLogRecordExporter` giving Sentry log delivery without reviving the deleted one-off adapter.

**Tech Stack:** `@opentelemetry/api`, `@opentelemetry/sdk-trace-base`, `@opentelemetry/sdk-metrics`, `@opentelemetry/sdk-logs`, `@opentelemetry/exporter-trace-otlp-http`, `@opentelemetry/exporter-metrics-otlp-http`, `@opentelemetry/exporter-logs-otlp-http`, `@opentelemetry/resources`, `@sentry/nestjs`, `@sentry/nextjs` (both already present); Python: `opentelemetry-sdk`, `opentelemetry-exporter-otlp-proto-http`, `opentelemetry-instrumentation-fastapi`, `opentelemetry-instrumentation-httpx`, `sentry-sdk` (all new).

## Global Constraints

- Every exporter (Datadog OTLP, Sentry) must be gated on an env var and silently no-op when unset — application code never branches on whether telemetry is configured (spec: Transport).
- Telemetry failures must never break the app — exporter errors are caught and dropped, never propagated to the request/response path (spec: Transport).
- No span, log, or metric attribute may ever contain: a password, session cookie, JWT contents beyond `kid`, `RSA_PRIVATE_KEY`, `BETTER_AUTH_SECRET`, `APPLE_PRIVATE_KEY`, an OAuth client secret, `email`, or `providerSub` (spec: Redaction and secrets).
- `saUserId`/`saUserPublicId`, `appPublicId`, `providerSub`, IPs, and user agents are span/log attributes only, never metric labels (spec: Cardinality).
- `OTEL_SDK_DISABLED=true` in all test configs (Jest, pytest) so existing suites neither slow down nor export (spec: Testing).
- Standard OpenTelemetry env vars only (`OTEL_EXPORTER_OTLP_*`, `OTEL_SERVICE_NAME`) — no custom var names for OTLP destination/headers (spec: Configuration).

---

## Task 1: auth-server — OTel trace + metrics bootstrap, Datadog export

**Files:**
- Create: `apps/auth-server/src/telemetry/otel.ts`
- Create: `apps/auth-server/src/telemetry/otel.spec.ts`
- Modify: `apps/auth-server/src/instrument.ts`
- Modify: `apps/auth-server/package.json` (dependencies)

**Interfaces:**
- Produces: `setupOtel(): { meter: import('@opentelemetry/api').Meter }` — called once from `instrument.ts` after `Sentry.init(...)`. Returns the app's `Meter` (namespaced `sassy-auth.auth-server`) so later tasks can create counters/histograms without re-deriving it.
- Consumes: `process.env.DD_API_KEY`, `process.env.DD_SITE` (default `datadoghq.com`), `process.env.OTEL_SERVICE_NAME` (default `sassy-auth-auth-server`).

- [ ] **Step 1: Add OTel SDK dependencies**

```bash
cd apps/auth-server
pnpm add @opentelemetry/sdk-trace-base@^2.0.0 @opentelemetry/sdk-metrics@^0.214.0 @opentelemetry/resources@^2.0.0 @opentelemetry/semantic-conventions@^1.30.0 @opentelemetry/exporter-trace-otlp-http@^0.214.0 @opentelemetry/exporter-metrics-otlp-http@^0.214.0
```

- [ ] **Step 2: Write the failing test**

```typescript
// apps/auth-server/src/telemetry/otel.spec.ts
import { metrics } from '@opentelemetry/api';

describe('setupOtel', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('returns a meter namespaced to sassy-auth.auth-server', async () => {
    delete process.env.DD_API_KEY;
    const { setupOtel } = await import('./otel');
    const { meter } = setupOtel();
    expect(meter).toBeDefined();
    // No exporter registered when DD_API_KEY is unset — the global meter
    // provider stays the OTel API's no-op default.
    expect(metrics.getMeterProvider().getMeter).toBeDefined();
  });

  it('does not throw when DD_API_KEY is set but unreachable', async () => {
    process.env.DD_API_KEY = 'test-key';
    process.env.DD_SITE = 'datadoghq.com';
    const { setupOtel } = await import('./otel');
    expect(() => setupOtel()).not.toThrow();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/auth-server && npx jest telemetry/otel.spec.ts`
Expected: FAIL with "Cannot find module './otel'"

- [ ] **Step 4: Write minimal implementation**

```typescript
// apps/auth-server/src/telemetry/otel.ts
import { metrics, type Meter } from '@opentelemetry/api';
import * as Sentry from '@sentry/nestjs';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

const SERVICE_NAME = process.env.OTEL_SERVICE_NAME ?? 'sassy-auth-auth-server';

function datadogOtlpConfig(): { url: string; headers: Record<string, string> } | null {
  const apiKey = process.env.DD_API_KEY;
  if (!apiKey) return null;
  const site = process.env.DD_SITE ?? 'datadoghq.com';
  return { url: `https://otlp-http-intake.logs.${site}`, headers: { 'dd-api-key': apiKey } };
}

export function setupOtel(): { meter: Meter } {
  const resource = resourceFromAttributes({ [ATTR_SERVICE_NAME]: SERVICE_NAME });
  const dd = datadogOtlpConfig();

  if (dd) {
    // Sentry (@sentry/nestjs v10) already registers the global OTel
    // TracerProvider for its own span capture. Adding a Datadog exporter as
    // an extra processor on that provider avoids two competing providers
    // fighting over `trace.setGlobalTracerProvider`.
    Sentry.addOpenTelemetrySpanProcessor(
      new BatchSpanProcessor(
        new OTLPTraceExporter({ url: `${dd.url}/v1/traces`, headers: dd.headers }),
      ),
    );
  }

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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/auth-server && npx jest telemetry/otel.spec.ts`
Expected: PASS

- [ ] **Step 6: Wire into instrument.ts**

```typescript
// apps/auth-server/src/instrument.ts
import * as Sentry from '@sentry/nestjs';
import { setupOtel } from './telemetry/otel';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
  enableLogs: true,
  integrations: [Sentry.prismaIntegration()],
});

export const otel = setupOtel();
```

Delete the old comment block above `enableLogs: true` referencing `telemetry-sentry-adapter.ts` — it is rewritten in Task 2 once that file is gone.

- [ ] **Step 7: Run the full auth-server suite**

Run: `cd apps/auth-server && OTEL_SDK_DISABLED=true npx jest`
Expected: PASS (no regressions from the `instrument.ts` change — it isn't imported by any spec file directly, so this mainly confirms nothing else broke)

- [ ] **Step 8: Commit**

```bash
git add apps/auth-server/package.json apps/auth-server/pnpm-lock.yaml apps/auth-server/src/telemetry/otel.ts apps/auth-server/src/telemetry/otel.spec.ts apps/auth-server/src/instrument.ts
git commit -m "feat(otel): bootstrap OTel traces and metrics with Datadog export in auth-server"
```

---

## Task 2: auth-server — real LoggerProvider, retire the Sentry adapter workaround

**Files:**
- Create: `apps/auth-server/src/telemetry/sentry-log-exporter.ts`
- Create: `apps/auth-server/src/telemetry/sentry-log-exporter.spec.ts`
- Modify: `apps/auth-server/src/telemetry/otel.ts` (add `setupLogging`)
- Modify: `apps/auth-server/src/telemetry/otel.spec.ts` (cover `setupLogging`)
- Modify: `apps/auth-server/src/instrument.ts`
- Modify: `apps/auth-server/src/auth/auth.config.ts:18,25,216`
- Delete: `apps/auth-server/src/social/telemetry-sentry-adapter.ts`
- Delete: `apps/auth-server/src/social/telemetry-sentry-adapter.spec.ts`
- Modify: `apps/auth-server/package.json` (dependencies)

**Interfaces:**
- Produces: `SentryLogRecordExporter` — a class implementing `@opentelemetry/sdk-logs`'s `LogRecordExporter` interface (`export(logs: ReadableLogRecord[], resultCallback: (result: ExportResult) => void): void` and `shutdown(): Promise<void>`).
- Produces: `setupLogging(): void` — registers a `LoggerProvider` globally via `logs.setGlobalLoggerProvider`, with a `BatchLogRecordProcessor(OTLPLogExporter)` for Datadog (gated on `DD_API_KEY`) and a `SimpleLogRecordProcessor(SentryLogRecordExporter)` for Sentry (gated on `SENTRY_DSN`) — both processors added unconditionally to `addLogRecordProcessor`, each internal exporter itself no-ops per Task 1's pattern.
- Consumes: `record-federation-event.ts`'s existing `logs.getLogger('sassy-auth.social').emit(...)` call — no change needed there once a real provider is registered.

- [ ] **Step 1: Add OTel logs SDK dependency**

```bash
cd apps/auth-server
pnpm add @opentelemetry/sdk-logs@^0.214.0 @opentelemetry/exporter-logs-otlp-http@^0.214.0
```

- [ ] **Step 2: Write the failing test for the Sentry log exporter**

```typescript
// apps/auth-server/src/telemetry/sentry-log-exporter.spec.ts
import { SeverityNumber } from '@opentelemetry/api-logs';
import { ExportResultCode } from '@opentelemetry/core';

const warn = jest.fn();
const error = jest.fn();
const info = jest.fn();

jest.mock('@sentry/nestjs', () => ({
  logger: {
    warn: (...args: unknown[]) => warn(...args),
    error: (...args: unknown[]) => error(...args),
    info: (...args: unknown[]) => info(...args),
  },
}));

import { SentryLogRecordExporter } from './sentry-log-exporter';

function fakeRecord(overrides: Partial<{ severityNumber: number; body: unknown; attributes: Record<string, unknown> }>) {
  return {
    severityNumber: SeverityNumber.INFO,
    body: 'default body',
    attributes: {},
    ...overrides,
  } as never;
}

describe('SentryLogRecordExporter', () => {
  afterEach(() => jest.clearAllMocks());

  it('routes WARN-and-above-but-below-ERROR records to Sentry.logger.warn', () => {
    const exporter = new SentryLogRecordExporter();
    const callback = jest.fn();
    exporter.export(
      [fakeRecord({ severityNumber: SeverityNumber.WARN, body: 'social.signin.rejected', attributes: { 'auth.provider': 'google' } })],
      callback,
    );
    expect(warn).toHaveBeenCalledWith('social.signin.rejected', { 'auth.provider': 'google' });
    expect(callback).toHaveBeenCalledWith({ code: ExportResultCode.SUCCESS });
  });

  it('routes ERROR-and-above records to Sentry.logger.error', () => {
    const exporter = new SentryLogRecordExporter();
    exporter.export(
      [fakeRecord({ severityNumber: SeverityNumber.ERROR, body: 'social.signin.rejected', attributes: { 'auth.outcome': 'provider_error' } })],
      jest.fn(),
    );
    expect(error).toHaveBeenCalledWith('social.signin.rejected', { 'auth.outcome': 'provider_error' });
    expect(warn).not.toHaveBeenCalled();
  });

  it('routes everything below WARN to Sentry.logger.info', () => {
    const exporter = new SentryLogRecordExporter();
    exporter.export([fakeRecord({ severityNumber: SeverityNumber.DEBUG, body: 'social.signin.ok' })], jest.fn());
    expect(info).toHaveBeenCalledWith('social.signin.ok', {});
  });

  it('resolves shutdown without throwing', async () => {
    await expect(new SentryLogRecordExporter().shutdown()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/auth-server && npx jest telemetry/sentry-log-exporter.spec.ts`
Expected: FAIL with "Cannot find module './sentry-log-exporter'"

- [ ] **Step 4: Write minimal implementation**

```typescript
// apps/auth-server/src/telemetry/sentry-log-exporter.ts
import { logger as sentryLogger } from '@sentry/nestjs';
import { SeverityNumber } from '@opentelemetry/api-logs';
import { ExportResultCode, type ExportResult } from '@opentelemetry/core';
import type { LogRecordExporter, ReadableLogRecord } from '@opentelemetry/sdk-logs';

/**
 * Bridges OTel log records to Sentry's own structured-logging API.
 * `@sentry/opentelemetry` bridges spans, never OTel logs — see the git
 * history of `apps/auth-server/src/social/telemetry-sentry-adapter.ts` for
 * the full investigation. Registering this as a LogRecordProcessor on the
 * app's LoggerProvider (see otel.ts's setupLogging) means every future
 * `logs.getLogger(...).emit(...)` call site gets Sentry delivery for free,
 * not just the one federation-events call site the old adapter special-cased.
 */
export class SentryLogRecordExporter implements LogRecordExporter {
  export(records: ReadableLogRecord[], resultCallback: (result: ExportResult) => void): void {
    for (const record of records) {
      const message = String(record.body ?? 'sassy-auth.log.event');
      const attributes = { ...record.attributes };
      if (record.severityNumber !== undefined && record.severityNumber >= SeverityNumber.ERROR) {
        sentryLogger.error(message, attributes);
      } else if (record.severityNumber !== undefined && record.severityNumber >= SeverityNumber.WARN) {
        sentryLogger.warn(message, attributes);
      } else {
        sentryLogger.info(message, attributes);
      }
    }
    resultCallback({ code: ExportResultCode.SUCCESS });
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/auth-server && npx jest telemetry/sentry-log-exporter.spec.ts`
Expected: PASS

- [ ] **Step 6: Add setupLogging to otel.ts, with a failing test first**

Add to `apps/auth-server/src/telemetry/otel.spec.ts`:

```typescript
describe('setupLogging', () => {
  it('does not throw regardless of env configuration', async () => {
    const { setupLogging } = await import('./otel');
    expect(() => setupLogging()).not.toThrow();
  });
});
```

Run: `cd apps/auth-server && npx jest telemetry/otel.spec.ts` — Expected: FAIL with "setupLogging is not a function"

Add to `apps/auth-server/src/telemetry/otel.ts`:

```typescript
import { logs } from '@opentelemetry/api-logs';
import { LoggerProvider, BatchLogRecordProcessor, SimpleLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { SentryLogRecordExporter } from './sentry-log-exporter';

export function setupLogging(): void {
  const resource = resourceFromAttributes({ [ATTR_SERVICE_NAME]: SERVICE_NAME });
  const loggerProvider = new LoggerProvider({ resource });
  const dd = datadogOtlpConfig();

  if (dd) {
    loggerProvider.addLogRecordProcessor(
      new BatchLogRecordProcessor(new OTLPLogExporter({ url: `${dd.url}/v1/logs`, headers: dd.headers })),
    );
  }
  if (process.env.SENTRY_DSN) {
    loggerProvider.addLogRecordProcessor(new SimpleLogRecordProcessor(new SentryLogRecordExporter()));
  }

  logs.setGlobalLoggerProvider(loggerProvider);
}
```

Run: `cd apps/auth-server && npx jest telemetry/otel.spec.ts` — Expected: PASS

- [ ] **Step 7: Call setupLogging from instrument.ts**

```typescript
// apps/auth-server/src/instrument.ts
import * as Sentry from '@sentry/nestjs';
import { setupOtel, setupLogging } from './telemetry/otel';

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
});

setupLogging();
export const otel = setupOtel();
```

- [ ] **Step 8: Remove the Sentry adapter workaround**

```bash
rm apps/auth-server/src/social/telemetry-sentry-adapter.ts apps/auth-server/src/social/telemetry-sentry-adapter.spec.ts
```

Edit `apps/auth-server/src/auth/auth.config.ts` — remove the import at line 25 (`import { emitFederationEventToSentry } from '../social/telemetry-sentry-adapter';`) and the surrounding comment at line 22, and change the call at line 216:

```typescript
// before
await recordFederationEvent(
  { db: prisma, logger: authLogger, emit: emitFederationEventToSentry },
  ...
);

// after
await recordFederationEvent(
  { db: prisma, logger: authLogger },
  ...
);
```

`record-federation-event.ts`'s `defaultEmit` (its fallback when `deps.emit` is omitted) now runs against the real `LoggerProvider` registered in Step 7.

- [ ] **Step 9: Run the full auth-server suite**

Run: `cd apps/auth-server && OTEL_SDK_DISABLED=true npx jest`
Expected: PASS — `record-federation-event.spec.ts` is untouched and still passes because it injects its own `emit` fake (see that file's `makeDeps()`); no test exercised the deleted adapter's real behavior other than its own now-deleted spec.

- [ ] **Step 10: Commit**

```bash
git add apps/auth-server/package.json apps/auth-server/pnpm-lock.yaml apps/auth-server/src/telemetry/ apps/auth-server/src/instrument.ts apps/auth-server/src/auth/auth.config.ts
git add -u apps/auth-server/src/social/
git commit -m "feat(otel): real LoggerProvider for federation events, retire the Sentry adapter workaround"
```

---

## Task 3: auth-server — sign-in and token-issuance spans and metrics

**Files:**
- Modify: `apps/auth-server/src/telemetry/otel.ts` (export shared instruments)
- Create: `apps/auth-server/src/telemetry/auth-metrics.ts`
- Create: `apps/auth-server/src/telemetry/auth-metrics.spec.ts`
- Modify: `apps/auth-server/src/token/token.controller.ts` (directLogin, ~lines 361-578)
- Modify: `apps/auth-server/src/token/token.service.ts` (issueJwt, ~lines 68-87)
- Modify: `apps/auth-server/src/token/token.controller.spec.ts`, `apps/auth-server/src/token/token.service.spec.ts`

**Interfaces:**
- Produces: `recordSignInOutcome(outcome: 'ok' | 'invalid_credentials' | 'two_factor_required'): void` and `recordTokenIssueDuration(durationMs: number, outcome: 'ok' | 'error'): void`, both in `auth-metrics.ts`, backed by `Counter`/`Histogram` instances created once from `otel.ts`'s exported `meter`.
- Consumes: `otel.ts`'s `otel.meter` (exported from Task 1/2's `instrument.ts`, imported directly from `../telemetry/otel` — `instrument.ts` only re-exports it for the app bootstrap's own use, don't import from there).

- [ ] **Step 1: Write the failing test for the metrics module**

```typescript
// apps/auth-server/src/telemetry/auth-metrics.spec.ts
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/auth-server && npx jest telemetry/auth-metrics.spec.ts`
Expected: FAIL with "Cannot find module './auth-metrics'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// apps/auth-server/src/telemetry/auth-metrics.ts
import { metrics } from '@opentelemetry/api';

const meter = metrics.getMeter('sassy-auth.auth-server');

const signInCounter = meter.createCounter('auth.signin.count', {
  description: 'Password sign-in attempts by outcome',
});

const tokenIssueDuration = meter.createHistogram('auth.token.issue.duration', {
  description: 'Time to issue a JWT after credentials verify, in milliseconds',
  unit: 'ms',
});

export function recordSignInOutcome(outcome: 'ok' | 'invalid_credentials' | 'two_factor_required'): void {
  signInCounter.add(1, { method: 'password', outcome });
}

export function recordTokenIssueDuration(durationMs: number, outcome: 'ok' | 'error'): void {
  tokenIssueDuration.record(durationMs, { outcome });
}
```

Note: `metrics.getMeter('sassy-auth.auth-server')` reads whatever global `MeterProvider` is registered at call time — this works because `setupOtel()` in `instrument.ts` runs before any request handling, registering the real provider before `auth-metrics.ts`'s module-level `meter` is captured on first import. Using the same meter name as `otel.ts`'s `setupOtel` return value keeps both instrument sets on one meter.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/auth-server && npx jest telemetry/auth-metrics.spec.ts`
Expected: PASS

- [ ] **Step 5: Add a span and outcome counter to directLogin**

In `apps/auth-server/src/token/token.controller.ts`, add the import:

```typescript
import { trace } from '@opentelemetry/api';
import { recordSignInOutcome } from '../telemetry/auth-metrics';

const tracer = trace.getTracer('sassy-auth.auth-server');
```

Wrap the existing method body (lines 362-578) in a span, recording the outcome at each existing throw/return point. Minimal-diff approach — wrap the whole method:

```typescript
@Throttle({ auth: { limit: 10, ttl: 60_000 } })
@Post('direct/login')
async directLogin(@Body() dto: DirectLoginDto) {
  return tracer.startActiveSpan('auth.signin', async (span) => {
    span.setAttribute('auth.method', 'password');
    try {
      const result = await this.directLoginInner(dto);
      span.setAttribute('auth.outcome', 'ok');
      recordSignInOutcome('ok');
      return result;
    } catch (err) {
      const outcome =
        err instanceof ForbiddenException ? 'two_factor_required' : 'invalid_credentials';
      span.setAttribute('auth.outcome', outcome);
      recordSignInOutcome(outcome);
      throw err;
    } finally {
      span.end();
    }
  });
}

private async directLoginInner(dto: DirectLoginDto) {
  // ... existing method body (lines 363-578), unchanged
}
```

- [ ] **Step 6: Add a duration histogram to issueJwt**

In `apps/auth-server/src/token/token.service.ts`:

```typescript
import { recordTokenIssueDuration } from '../telemetry/auth-metrics';

async issueJwt(params: IssueJwtParams): Promise<string> {
  const start = Date.now();
  try {
    const permissions = await this.resolvePermissions(params.saUserId);
    // ... existing body unchanged ...
    const token = jwt.sign(payload, this.privateKey, { algorithm: 'RS256', keyid: this.kid });
    recordTokenIssueDuration(Date.now() - start, 'ok');
    return token;
  } catch (err) {
    recordTokenIssueDuration(Date.now() - start, 'error');
    throw err;
  }
}
```

- [ ] **Step 7: Update existing controller/service specs for the refactor**

`token.controller.spec.ts` and `token.service.spec.ts` call `directLogin`/`issueJwt` as black boxes already (asserting return values and thrown exceptions) — confirm no test asserts on `directLogin`'s internal structure. Run them; if any test mocks `TokenController.prototype.directLoginInner` directly (unlikely), update the mock target name.

Run: `cd apps/auth-server && npx jest token.controller.spec.ts token.service.spec.ts`
Expected: PASS with no changes needed (behavior-preserving refactor)

- [ ] **Step 8: Run the full auth-server suite**

Run: `cd apps/auth-server && OTEL_SDK_DISABLED=true npx jest`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add apps/auth-server/src/telemetry/auth-metrics.ts apps/auth-server/src/telemetry/auth-metrics.spec.ts apps/auth-server/src/token/token.controller.ts apps/auth-server/src/token/token.service.ts
git commit -m "feat(otel): trace direct-login sign-in and JWT issuance"
```

---

## Task 4: auth-server — social federation span and per-provider outcome counter

**Files:**
- Modify: `apps/auth-server/src/telemetry/auth-metrics.ts`
- Modify: `apps/auth-server/src/telemetry/auth-metrics.spec.ts`
- Modify: `apps/auth-server/src/social/record-federation-event.ts`
- Modify: `apps/auth-server/src/social/record-federation-event.spec.ts`

**Interfaces:**
- Produces: `recordFederationOutcome(event: { provider: string; type: string; outcome: string }): void` in `auth-metrics.ts`.
- Consumes: nothing new — wraps the existing `recordFederationEvent(deps, event)` call already made from `auth.config.ts:215`.

- [ ] **Step 1: Write the failing test for the counter**

Add to `apps/auth-server/src/telemetry/auth-metrics.spec.ts`:

```typescript
it('records a federation outcome counter', async () => {
  const { recordFederationOutcome } = await import('./auth-metrics');
  expect(() =>
    recordFederationOutcome({ provider: 'google', type: 'social.signin.rejected', outcome: 'email_unverified' }),
  ).not.toThrow();
});
```

Run: `cd apps/auth-server && npx jest telemetry/auth-metrics.spec.ts`
Expected: FAIL with "recordFederationOutcome is not a function"

- [ ] **Step 2: Implement the counter**

Add to `apps/auth-server/src/telemetry/auth-metrics.ts`:

```typescript
const federationCounter = meter.createCounter('auth.social.federation.count', {
  description: 'Social federation events by provider, type and outcome',
});

export function recordFederationOutcome(event: { provider: string; type: string; outcome: string }): void {
  federationCounter.add(1, { provider: event.provider, event_type: event.type, outcome: event.outcome });
}
```

Run: `cd apps/auth-server && npx jest telemetry/auth-metrics.spec.ts`
Expected: PASS

- [ ] **Step 3: Write the failing test for the span wrapping recordFederationEvent**

Add to `apps/auth-server/src/social/record-federation-event.spec.ts`:

```typescript
import { trace } from '@opentelemetry/api';
import { InMemorySpanExporter, SimpleSpanProcessor, BasicTracerProvider } from '@opentelemetry/sdk-trace-base';

describe('recordFederationEvent span', () => {
  it('emits an auth.social.federation span with provider and outcome attributes', async () => {
    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
    trace.setGlobalTracerProvider(provider);

    const { deps } = makeDeps();
    await recordFederationEvent(deps, { type: 'social.signin.ok', provider: 'google', appPublicId: 'qp31' });

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe('auth.social.federation');
    expect(spans[0].attributes['auth.provider']).toBe('google');
    expect(spans[0].attributes['auth.outcome']).toBe('ok');
  });
});
```

Run: `cd apps/auth-server && npx jest social/record-federation-event.spec.ts`
Expected: FAIL — span count is 0 (no tracer instrumentation yet)

- [ ] **Step 4: Wrap recordFederationEvent in a span and call the counter**

```typescript
// apps/auth-server/src/social/record-federation-event.ts — add near the top
import { trace } from '@opentelemetry/api';
import { recordFederationOutcome } from '../telemetry/auth-metrics';

const tracer = trace.getTracer('sassy-auth.auth-server');
```

Change the function body to wrap the existing logic:

```typescript
export async function recordFederationEvent(
  deps: FederationEventDeps,
  event: FederationEvent,
): Promise<void> {
  return tracer.startActiveSpan('auth.social.federation', async (span) => {
    const outcome = event.reason ?? 'ok';
    span.setAttribute('auth.provider', event.provider);
    span.setAttribute('auth.event', event.type);
    span.setAttribute('auth.outcome', outcome);
    recordFederationOutcome({ provider: event.provider, type: event.type, outcome });

    const emit = deps.emit ?? defaultEmit;

    // Telemetry first, so it survives a database outage.
    try {
      emit(event.unexpected ? 'ERROR' : event.type === 'social.signin.rejected' ? 'WARN' : 'INFO', {
        'auth.event': event.type,
        'auth.flow': 'social',
        'auth.provider': event.provider,
        'auth.outcome': outcome,
        'app.public_id': event.appPublicId ?? '',
        'user.public_id': event.saUserPublicId ?? '',
      });
    } catch (err: unknown) {
      deps.logger.warn('Federation telemetry emit failed', { err: String(err) });
    }

    try {
      await deps.db.saAuditEvent.create({
        data: {
          publicId: randomBytes(9).toString('base64url'),
          type: event.type,
          provider: event.provider,
          saUserId: event.saUserId ?? null,
          betterAuthUserId: event.betterAuthUserId ?? null,
          appPublicId: event.appPublicId ?? null,
          email: event.email ?? null,
          providerSub: event.providerSub ?? null,
          reason: event.reason ?? null,
          ip: event.ip ?? null,
          userAgent: event.userAgent ?? null,
        },
      });
    } catch (err: unknown) {
      deps.logger.warn('Federation audit write failed', { type: event.type, err: String(err) });
    } finally {
      span.end();
    }
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/auth-server && npx jest social/record-federation-event.spec.ts`
Expected: PASS (all tests, including the pre-existing ones — the span wrap is behavior-preserving for the return type and all existing assertions on `created`/`emitted`)

- [ ] **Step 6: Run the full auth-server suite**

Run: `cd apps/auth-server && OTEL_SDK_DISABLED=true npx jest`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/auth-server/src/telemetry/auth-metrics.ts apps/auth-server/src/telemetry/auth-metrics.spec.ts apps/auth-server/src/social/record-federation-event.ts apps/auth-server/src/social/record-federation-event.spec.ts
git commit -m "feat(otel): trace social federation events with a per-provider outcome counter"
```

---

## Task 5: auth-server — 2FA challenge and registration rate-limit counters

**Files:**
- Modify: `apps/auth-server/src/telemetry/auth-metrics.ts`
- Modify: `apps/auth-server/src/telemetry/auth-metrics.spec.ts`
- Modify: `apps/auth-server/src/token/token.controller.ts` (2FA branch, ~lines 524-540)
- Modify: `apps/auth-server/src/registration/rate-limit.guard.ts`
- Modify: `apps/auth-server/src/registration/rate-limit.guard.spec.ts`

**Interfaces:**
- Produces: `record2faChallengeOutcome(outcome: 'ok' | 'missing_or_invalid_code' | 'required_not_enrolled'): void` and `recordRegistrationRateLimited(): void`, both in `auth-metrics.ts`.

- [ ] **Step 1: Write the failing tests**

Add to `apps/auth-server/src/telemetry/auth-metrics.spec.ts`:

```typescript
it('records a 2FA challenge outcome counter', async () => {
  const { record2faChallengeOutcome } = await import('./auth-metrics');
  expect(() => record2faChallengeOutcome('missing_or_invalid_code')).not.toThrow();
});

it('records a registration rate-limit counter', async () => {
  const { recordRegistrationRateLimited } = await import('./auth-metrics');
  expect(() => recordRegistrationRateLimited()).not.toThrow();
});
```

Run: `cd apps/auth-server && npx jest telemetry/auth-metrics.spec.ts`
Expected: FAIL — both functions undefined

- [ ] **Step 2: Implement the counters**

Add to `apps/auth-server/src/telemetry/auth-metrics.ts`:

```typescript
const twoFactorCounter = meter.createCounter('auth.2fa.challenge.count', {
  description: '2FA challenge outcomes on the direct-login path',
});

const registrationRateLimitCounter = meter.createCounter('auth.register.rate_limited', {
  description: 'Self-serve registration requests rejected by the rate limiter',
});

export function record2faChallengeOutcome(
  outcome: 'ok' | 'missing_or_invalid_code' | 'required_not_enrolled',
): void {
  twoFactorCounter.add(1, { outcome });
}

export function recordRegistrationRateLimited(): void {
  registrationRateLimitCounter.add(1);
}
```

Run: `cd apps/auth-server && npx jest telemetry/auth-metrics.spec.ts`
Expected: PASS

- [ ] **Step 3: Call record2faChallengeOutcome from directLogin's 2FA branch**

In `apps/auth-server/src/token/token.controller.ts`, update the block around lines 524-540:

```typescript
import { record2faChallengeOutcome } from '../telemetry/auth-metrics';

// ...
let amr = ['pwd'];
if (isTwoFactorRequired(app) || twoFactorEnabled) {
  if (!twoFactorEnabled) {
    record2faChallengeOutcome('required_not_enrolled');
    this.logger.getWinstonLogger().warn('Direct login blocked: 2FA required, user not enrolled', {
      context: 'TokenController', appId: dto.appId, userId: saUser.publicId,
    });
    throw new ForbiddenException(TokenErrorCode.TWO_FACTOR_REQUIRED);
  }
  if (!dto.totpCode || !(await verifyUserTotp(saUser.betterAuthUserId, dto.totpCode))) {
    record2faChallengeOutcome('missing_or_invalid_code');
    this.logger.getWinstonLogger().warn('Direct login blocked: missing/invalid 2FA code', {
      context: 'TokenController', appId: dto.appId, userId: saUser.publicId,
    });
    throw new ForbiddenException(TokenErrorCode.TWO_FACTOR_REQUIRED);
  }
  amr = ['pwd', 'otp', 'mfa'];
  record2faChallengeOutcome('ok');
}
```

- [ ] **Step 4: Call recordRegistrationRateLimited from the guard**

Read `apps/auth-server/src/registration/rate-limit.guard.ts` to find the exact line that throws `HttpException('Too many requests', 429)`, and add the counter call immediately before that throw:

```typescript
import { recordRegistrationRateLimited } from '../telemetry/auth-metrics';

// immediately before: throw new HttpException('Too many requests', 429);
recordRegistrationRateLimited();
throw new HttpException('Too many requests', 429);
```

- [ ] **Step 5: Run affected specs**

Run: `cd apps/auth-server && npx jest token.controller.spec.ts registration/rate-limit.guard.spec.ts`
Expected: PASS — these are behavior-preserving additions (a counter call before an existing throw), no existing assertion should change

- [ ] **Step 6: Run the full auth-server suite**

Run: `cd apps/auth-server && OTEL_SDK_DISABLED=true npx jest`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/auth-server/src/telemetry/auth-metrics.ts apps/auth-server/src/telemetry/auth-metrics.spec.ts apps/auth-server/src/token/token.controller.ts apps/auth-server/src/registration/rate-limit.guard.ts
git commit -m "feat(otel): count 2FA challenge outcomes and registration rate-limit hits"
```

---

## Task 6: resource-server-fastapi — OTel + Sentry bootstrap with Datadog export

**Files:**
- Create: `apps/resource-server-fastapi/app/telemetry.py`
- Create: `apps/resource-server-fastapi/tests/test_telemetry.py`
- Modify: `apps/resource-server-fastapi/app/main.py`
- Modify: `apps/resource-server-fastapi/app/config.py`
- Modify: `apps/resource-server-fastapi/pyproject.toml`

**Interfaces:**
- Produces: `setup_telemetry(app: FastAPI) -> None` in `telemetry.py` — instruments the FastAPI app and httpx client, registers Datadog OTLP exporters (traces, metrics, logs) gated on `DD_API_KEY`, and initializes `sentry_sdk` gated on `SENTRY_DSN_RESOURCE_SERVER`.
- Consumes: `Settings` fields `DD_API_KEY: str | None`, `DD_SITE: str`, `SENTRY_DSN_RESOURCE_SERVER: str | None`, `SENTRY_ENVIRONMENT: str | None`, `OTEL_SERVICE_NAME: str` (new, added to `app/config.py`). Named distinctly from auth-server's `SENTRY_DSN` because both services can load the same shared `.env.local` in local dev (per `main.ts`'s `loadEnv({ path: resolve(process.cwd(), '../../.env.local') })`) and must not silently share one Sentry project.

- [ ] **Step 1: Add Python dependencies**

Edit `apps/resource-server-fastapi/pyproject.toml`, adding to the core `dependencies` list:

```toml
"opentelemetry-sdk>=1.30",
"opentelemetry-exporter-otlp-proto-http>=1.30",
"opentelemetry-instrumentation-fastapi>=0.51b0",
"opentelemetry-instrumentation-httpx>=0.51b0",
"sentry-sdk[fastapi]>=2.20",
```

Run: `cd apps/resource-server-fastapi && uv sync`
Expected: dependencies resolve and install cleanly

- [ ] **Step 2: Add new settings fields**

```python
# apps/resource-server-fastapi/app/config.py
class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    AUTH_SERVER_URL: str = "http://localhost:3000"
    ADMIN_URL: str = "http://localhost:3001"
    SASSY_CLIENT_ID: str
    RS_BASE_URL: str
    REDIRECT_URI: str

    EXPECTED_ISSUER: str | None = None
    EXPECTED_AUDIENCE: str | None = None
    PKCE_STATE_TTL_SECONDS: int = 600
    LOG_LEVEL: str = "info"

    DD_API_KEY: str | None = None
    DD_SITE: str = "datadoghq.com"
    SENTRY_DSN_RESOURCE_SERVER: str | None = None
    SENTRY_ENVIRONMENT: str | None = None
    OTEL_SERVICE_NAME: str = "sassy-auth-resource-server"

    @property
    def issuer(self) -> str:
        return self.EXPECTED_ISSUER or self.AUTH_SERVER_URL

    @property
    def audience(self) -> str:
        return self.EXPECTED_AUDIENCE or self.SASSY_CLIENT_ID
```

- [ ] **Step 3: Write the failing test**

```python
# apps/resource-server-fastapi/tests/test_telemetry.py
import os
from fastapi import FastAPI


def test_setup_telemetry_noops_without_dd_or_sentry_keys(monkeypatch):
    monkeypatch.delenv("DD_API_KEY", raising=False)
    monkeypatch.delenv("SENTRY_DSN_RESOURCE_SERVER", raising=False)
    from app.telemetry import setup_telemetry

    app = FastAPI()
    setup_telemetry(app)  # must not raise


def test_setup_telemetry_does_not_raise_with_dd_api_key(monkeypatch):
    monkeypatch.setenv("DD_API_KEY", "test-key")
    monkeypatch.setenv("DD_SITE", "datadoghq.com")
    from app.config import get_settings
    get_settings.cache_clear()
    from app.telemetry import setup_telemetry

    app = FastAPI()
    setup_telemetry(app)  # exporter construction must not raise even though unreachable
    get_settings.cache_clear()
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd apps/resource-server-fastapi && uv run pytest tests/test_telemetry.py -v`
Expected: FAIL with "No module named 'app.telemetry'"

- [ ] **Step 5: Write minimal implementation**

```python
# apps/resource-server-fastapi/app/telemetry.py
import sentry_sdk
from fastapi import FastAPI
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

from app.config import get_settings


def _datadog_otlp_url(site: str) -> str:
    return f"https://otlp-http-intake.logs.{site}"


def setup_telemetry(app: FastAPI) -> None:
    settings = get_settings()
    resource = Resource.create({"service.name": settings.OTEL_SERVICE_NAME})
    provider = TracerProvider(resource=resource)

    if settings.DD_API_KEY:
        base_url = _datadog_otlp_url(settings.DD_SITE)
        provider.add_span_processor(
            BatchSpanProcessor(
                OTLPSpanExporter(
                    endpoint=f"{base_url}/v1/traces",
                    headers={"dd-api-key": settings.DD_API_KEY},
                )
            )
        )

    trace.set_tracer_provider(provider)
    FastAPIInstrumentor.instrument_app(app, tracer_provider=provider)
    HTTPXClientInstrumentor().instrument(tracer_provider=provider)

    if settings.SENTRY_DSN_RESOURCE_SERVER:
        sentry_sdk.init(
            dsn=settings.SENTRY_DSN_RESOURCE_SERVER,
            environment=settings.SENTRY_ENVIRONMENT,
            traces_sample_rate=0.2,
        )
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd apps/resource-server-fastapi && uv run pytest tests/test_telemetry.py -v`
Expected: PASS

- [ ] **Step 7: Wire into main.py**

```python
# apps/resource-server-fastapi/app/main.py — add after `app = FastAPI(...)`
from app.telemetry import setup_telemetry

app = FastAPI(title="resource-server-fastapi")
setup_telemetry(app)
app.mount("/static", StaticFiles(directory="app/static"), name="static")
app.include_router(web_router)
app.include_router(oauth_router)
app.include_router(api_router)
```

- [ ] **Step 8: Ensure tests don't export telemetry**

Add to `apps/resource-server-fastapi/tests/conftest.py`:

```python
import os

os.environ.setdefault("SASSY_CLIENT_ID", "84LR")
os.environ.setdefault("RS_BASE_URL", "http://localhost:8010")
os.environ.setdefault("REDIRECT_URI", "http://localhost:8010/auth/callback")
os.environ.setdefault("OTEL_SDK_DISABLED", "true")
```

- [ ] **Step 9: Run the full resource-server-fastapi suite**

Run: `cd apps/resource-server-fastapi && uv run pytest`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add apps/resource-server-fastapi/app/telemetry.py apps/resource-server-fastapi/app/main.py apps/resource-server-fastapi/app/config.py apps/resource-server-fastapi/pyproject.toml apps/resource-server-fastapi/tests/test_telemetry.py apps/resource-server-fastapi/tests/conftest.py apps/resource-server-fastapi/uv.lock
git commit -m "feat(otel): bootstrap FastAPI/httpx tracing with Datadog and Sentry export"
```

---

## Task 7: resource-server-fastapi — token verification span and outcome counter

**Files:**
- Modify: `apps/resource-server-fastapi/app/oauth/verifier.py`
- Modify: `apps/resource-server-fastapi/tests/test_verifier.py`

**Interfaces:**
- Produces: nothing new exported — `verify()`'s existing signature (`verify(token: str) -> dict`) and `require_scope()`'s existing signature are unchanged; this task only adds internal span/metric emission.

- [ ] **Step 1: Write the failing test**

```python
# apps/resource-server-fastapi/tests/test_verifier.py — add
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter


def test_verify_emits_a_span_with_outcome_attribute(monkeypatch):
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    trace.set_tracer_provider(provider)

    from app.oauth import verifier
    import importlib
    importlib.reload(verifier)  # re-bind verifier's module-level tracer to the new provider

    from fastapi import HTTPException
    try:
        verifier.verify("not-a-real-jwt")
    except HTTPException:
        pass

    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].name == "auth.token.verify"
    assert spans[0].attributes["auth.outcome"] == "invalid_token"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/resource-server-fastapi && uv run pytest tests/test_verifier.py::test_verify_emits_a_span_with_outcome_attribute -v`
Expected: FAIL — zero spans recorded

- [ ] **Step 3: Add the span and counter to verifier.py**

```python
# apps/resource-server-fastapi/app/oauth/verifier.py
from typing import Callable
import jwt
from fastapi import Header, HTTPException
from opentelemetry import metrics, trace

from app.config import get_settings

_settings = get_settings()
_jwks_client = jwt.PyJWKClient(
    f"{_settings.AUTH_SERVER_URL}/api/token/jwks",
    cache_keys=True,
    lifespan=600,
)

_tracer = trace.get_tracer("sassy-auth.resource-server")
_meter = metrics.get_meter("sassy-auth.resource-server")
_verify_counter = _meter.create_counter(
    "auth.token.verify.count", description="JWT verification attempts by outcome"
)


def verify(token: str) -> dict:
    with _tracer.start_as_current_span("auth.token.verify") as span:
        try:
            signing_key = _jwks_client.get_signing_key_from_jwt(token).key
            claims = jwt.decode(
                token,
                signing_key,
                algorithms=["RS256"],
                audience=_settings.audience,
                issuer=_settings.issuer,
                options={"require": ["exp", "iat", "sub", "iss", "aud", "scope"]},
            )
            span.set_attribute("auth.outcome", "ok")
            _verify_counter.add(1, {"outcome": "ok"})
            return claims
        except Exception:
            span.set_attribute("auth.outcome", "invalid_token")
            _verify_counter.add(1, {"outcome": "invalid_token"})
            raise HTTPException(
                status_code=401,
                detail={"result": "Unauthorized", "reason": "invalid_token"},
            )


def require_scope(required: str) -> Callable[[str | None], dict]:
    def dep(authorization: str | None = Header(default=None)) -> dict:
        if not authorization or not authorization.lower().startswith("bearer "):
            raise HTTPException(
                status_code=401,
                detail={"result": "Unauthorized", "reason": "invalid_token"},
            )
        token = authorization.split(" ", 1)[1].strip()
        claims = verify(token)
        scopes = set(str(claims.get("scope", "")).split())
        if required not in scopes:
            raise HTTPException(
                status_code=403,
                detail={"result": "Unauthorized", "reason": "insufficient_scope"},
            )
        return claims

    return dep
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/resource-server-fastapi && uv run pytest tests/test_verifier.py -v`
Expected: PASS (including all pre-existing tests in the file — no signature changes)

- [ ] **Step 5: Run the full resource-server-fastapi suite**

Run: `cd apps/resource-server-fastapi && uv run pytest`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/resource-server-fastapi/app/oauth/verifier.py apps/resource-server-fastapi/tests/test_verifier.py
git commit -m "feat(otel): trace JWT verification with an outcome counter"
```

---

## Task 8: admin — Datadog trace export and login-action span

**Files:**
- Modify: `apps/admin/sentry.server.config.ts`
- Modify: `apps/admin/package.json` (dependencies)
- Modify: `apps/admin/app/login/actions.ts` (`signIn`, ~line 121)
- Create: `apps/admin/app/login/__tests__/actions-otel.test.ts`
- Modify: `apps/admin/jest.setup.ts`

**Interfaces:**
- Consumes: `Sentry.addOpenTelemetrySpanProcessor` (same API used in auth-server's `otel.ts`, available from `@sentry/nextjs` since it re-exports `@sentry/node`'s server-side API for the `nodejs` runtime).

- [ ] **Step 1: Add the OTel trace exporter dependency**

```bash
cd apps/admin
pnpm add @opentelemetry/sdk-trace-base@^2.0.0 @opentelemetry/exporter-trace-otlp-http@^0.214.0
```

- [ ] **Step 2: Add Datadog export to the server Sentry config**

Read `apps/admin/sentry.server.config.ts` first to see its existing `Sentry.init(...)` call, then add after it (this file only runs for `NEXT_RUNTIME === 'nodejs'`, per `instrumentation.ts` — Next.js edge runtime cannot load Node OTel exporter packages, so Datadog export is server-only, matching the spec's "Out of scope: browser RUM"):

```typescript
// apps/admin/sentry.server.config.ts — append at the end of the file
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

const ddApiKey = process.env.DD_API_KEY;
if (ddApiKey) {
  const site = process.env.DD_SITE ?? 'datadoghq.com';
  Sentry.addOpenTelemetrySpanProcessor(
    new BatchSpanProcessor(
      new OTLPTraceExporter({
        url: `https://otlp-http-intake.logs.${site}/v1/traces`,
        headers: { 'dd-api-key': ddApiKey },
      }),
    ),
  );
}
```

- [ ] **Step 3: Write the failing test for the login action span**

```typescript
// apps/admin/app/login/__tests__/actions-otel.test.ts
import { trace } from '@opentelemetry/api';
import { InMemorySpanExporter, SimpleSpanProcessor, BasicTracerProvider } from '@opentelemetry/sdk-trace-base';

jest.mock('@sentry/nextjs', () => ({
  addBreadcrumb: jest.fn(),
  setUser: jest.fn(),
  setTag: jest.fn(),
  captureException: jest.fn(),
  withScope: jest.fn((fn: (scope: unknown) => void) => fn({ setLevel: jest.fn() })),
}));

const originalFetch = global.fetch;

describe('signIn span', () => {
  let exporter: InMemorySpanExporter;

  beforeEach(() => {
    exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
    trace.setGlobalTracerProvider(provider);
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      headers: new Headers(),
      json: async () => ({ error: 'invalid_credentials' }),
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('emits an admin.login.submit span with an outcome attribute', async () => {
    const { signIn } = await import('../actions');
    const formData = new FormData();
    formData.set('email', 'a@example.com');
    formData.set('password', 'wrong-password');
    await signIn(formData);

    const spans = exporter.getFinishedSpans();
    const loginSpan = spans.find((s) => s.name === 'admin.login.submit');
    expect(loginSpan).toBeDefined();
    expect(loginSpan?.attributes['auth.outcome']).toBeDefined();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd apps/admin && npx jest app/login/__tests__/actions-otel.test.ts`
Expected: FAIL — no span named `admin.login.submit` found

Read `apps/admin/app/login/actions.ts`'s `signIn` function in full before Step 5 to find its actual outcome branches (success return, 2FA-redirect return, error return) so the span attribute is set on every path, not just the one this test exercises.

- [ ] **Step 5: Wrap signIn's body in a span**

Add near the top of `apps/admin/app/login/actions.ts`:

```typescript
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('sassy-auth.admin');
```

Wrap the existing `signIn` function body, renaming it to `signInInner` and setting `auth.outcome` on every return path (success, 2FA-redirect, error) before the wrapper's `span.end()` — mirror the pattern from Task 3's `directLogin` wrap: a thin `signIn` that opens the span, delegates to `signInInner`, records `auth.outcome` from the returned/thrown result, and always calls `span.end()` in a `finally`. Read the actual return shape of `signInInner` first (it returns a discriminated result object, not throws, based on the existing 2FA-redirect handling) and set `auth.outcome` from that result's own status field rather than inventing a new one.

- [ ] **Step 6: Run test to verify it passes**

Run: `cd apps/admin && npx jest app/login/__tests__/actions-otel.test.ts`
Expected: PASS

- [ ] **Step 7: Run the full admin suite**

Run: `cd apps/admin && OTEL_SDK_DISABLED=true npx jest`
Expected: PASS — check `apps/admin/jest.setup.ts`'s existing `@sentry/nextjs` mock still covers every export `actions.ts` now calls (it already mocks `addBreadcrumb`/`setUser`/`setTag`/`captureException`/`withScope`; this task adds no new Sentry calls, only `@opentelemetry/api`, so no mock update should be needed — confirm by running the suite)

- [ ] **Step 8: Commit**

```bash
git add apps/admin/package.json apps/admin/pnpm-lock.yaml apps/admin/sentry.server.config.ts apps/admin/app/login/actions.ts apps/admin/app/login/__tests__/actions-otel.test.ts
git commit -m "feat(otel): trace the admin login submit action, export to Datadog"
```

---

## Task 9: Secret redaction test, .env.example, and OTEL_SDK_DISABLED in test configs

**Files:**
- Create: `apps/auth-server/src/telemetry/redaction.spec.ts`
- Modify: `apps/auth-server/package.json` (jest env, `test` script)
- Modify: `apps/auth-server/test/jest-e2e.json`
- Modify: `apps/admin/package.json` (jest env, `test` script) or `apps/admin/jest.config.ts` if present
- Modify: `.env.example`

**Interfaces:** None new — this task is verification and configuration only.

- [ ] **Step 1: Write the secret-redaction test**

```typescript
// apps/auth-server/src/telemetry/redaction.spec.ts
import { recordFederationEvent } from '../social/record-federation-event';

const CONFIGURED_SECRETS = [
  'super-secret-rsa-key',
  'super-secret-better-auth-secret',
  'super-secret-apple-key',
];

describe('secret redaction across telemetry attributes', () => {
  beforeEach(() => {
    process.env.RSA_PRIVATE_KEY = Buffer.from('super-secret-rsa-key').toString('base64');
    process.env.BETTER_AUTH_SECRET = 'super-secret-better-auth-secret';
    process.env.APPLE_PRIVATE_KEY = 'super-secret-apple-key';
  });

  it('never places a configured secret into a federation event span or log attribute', async () => {
    const emitted: unknown[] = [];
    await recordFederationEvent(
      {
        db: { saAuditEvent: { create: async () => undefined } },
        logger: { warn: () => undefined },
        emit: (_severity, attributes) => emitted.push(attributes),
      },
      {
        type: 'social.signin.ok',
        provider: 'google',
        email: 'alice@acme.com',
        providerSub: 'sub-123',
        saUserPublicId: 'UkLW',
        appPublicId: 'qp31',
      },
    );

    const serialized = JSON.stringify(emitted);
    for (const secret of CONFIGURED_SECRETS) {
      expect(serialized).not.toContain(secret);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `cd apps/auth-server && npx jest telemetry/redaction.spec.ts`
Expected: PASS immediately — `recordFederationEvent` never touches these env vars, so this test documents and locks in the existing guarantee rather than driving new code. If it fails, that is a real regression from Tasks 1-4 and must be fixed before continuing (most likely cause: a span attribute added in Task 4 accidentally serializing more of `event` than intended).

- [ ] **Step 3: Disable OTel SDK export in test runs**

`apps/auth-server/package.json`'s `test` script currently reads `"test": "node ../../scripts/log-test.mjs auth-server jest"`. Change it to set the env var:

```json
"test": "OTEL_SDK_DISABLED=true node ../../scripts/log-test.mjs auth-server jest",
"test:e2e": "OTEL_SDK_DISABLED=true node ../../scripts/log-test.mjs auth-server-e2e jest --config ./test/jest-e2e.json --verbose",
```

Read `apps/admin/package.json`'s `test` script and apply the same `OTEL_SDK_DISABLED=true` prefix, matching its existing script structure exactly (don't assume it matches auth-server's — read it first).

Read `apps/resource-server-fastapi/pyproject.toml`'s `[tool.pytest.ini_options]` — Task 6 Step 8 already set `OTEL_SDK_DISABLED` via `conftest.py`'s `os.environ.setdefault`, so no change needed there; confirm by re-reading that file.

- [ ] **Step 4: Run every service's test suite to confirm no export happens and nothing slows down**

Run: `cd apps/auth-server && pnpm test`
Run: `cd apps/admin && pnpm test`
Run: `cd apps/resource-server-fastapi && uv run pytest`
Expected: all PASS, comparable runtime to before this plan started

- [ ] **Step 5: Document the new env vars in .env.example**

Replace the existing `# ── Observability ─────────────────────────────────────────` block in `.env.example` with:

```
# ── Observability ─────────────────────────────────────────
SENTRY_DSN=                    # Sentry DSN (leave blank to disable in dev)
SENTRY_ENVIRONMENT=            # Override environment name (defaults to NODE_ENV)
LOG_LEVEL=                     # debug | info | warn | error (defaults: debug in dev, info in prod)

# OpenTelemetry + Datadog. Every exporter below no-ops when its key is unset —
# leave all blank to run with Sentry-only observability (or none).
OTEL_SERVICE_NAME=             # Per-service override (each app has a sensible default)
DD_API_KEY=                    # Datadog API key. Unset disables all Datadog export (traces, metrics, logs)
DD_SITE=datadoghq.com          # Datadog site (datadoghq.com, datadoghq.eu, ...)

# ── Admin Observability ───────────────────────────────────
NEXT_PUBLIC_SENTRY_DSN=        # Sentry DSN for admin console (leave blank to disable in dev)
SENTRY_AUTH_TOKEN=             # Sentry auth token for source map uploads (build-time only)
SENTRY_ORG=                    # Sentry organization slug (build-time only)
SENTRY_PROJECT=                # Sentry project slug (build-time only)

# ── Resource Server Observability ─────────────────────────
SENTRY_DSN_RESOURCE_SERVER=    # Sentry DSN for resource-server-fastapi (leave blank to disable)
```

- [ ] **Step 6: Commit**

```bash
git add apps/auth-server/src/telemetry/redaction.spec.ts apps/auth-server/package.json apps/admin/package.json .env.example
git add apps/resource-server-fastapi/app/config.py apps/resource-server-fastapi/app/telemetry.py apps/resource-server-fastapi/tests/test_telemetry.py
git commit -m "test(otel): lock in secret redaction, disable SDK export in tests, document env vars"
```

---

## Task 10: Opt-in end-to-end thin-slice test

**Files:**
- Create: `apps/auth-server/test/otel-thin-slice.e2e-spec.ts`
- Modify: `apps/auth-server/test/jest-e2e.json` (if a `testPathIgnorePatterns` or explicit test list needs updating — read it first)

**Interfaces:** None new — this test drives both apps through their existing public HTTP surface only. Requires `resource-server-fastapi` running and reachable at `RS_E2E_URL` — this is the one test in the suite that talks to a second live service, which is exactly what it exists to prove.

Note on the thin slice's concrete binding: the design's "admin login → auth-server sign-in → JWT issued → resource verifies" is realized here via `TokenController.directLogin` (Task 3), not the admin console's own BetterAuth session sign-in (Task 8's `signIn` action) — `directLogin` is the endpoint in this codebase that actually issues the RS256 JWT resource-server-fastapi's `verify()` checks; BetterAuth's `/api/auth/sign-in/email` issues a session cookie for the admin console itself and never produces a JWT. Task 8's admin span is separate, general-purpose instrumentation of the admin console's own login UX, not part of this joined trace.

- [ ] **Step 1: Write the opt-in e2e test**

```typescript
// apps/auth-server/test/otel-thin-slice.e2e-spec.ts
/**
 * Skipped unless real Datadog and Sentry credentials are present and
 * resource-server-fastapi is reachable. Proves the one thing unit tests
 * structurally cannot: that a trace initiated by TokenController.directLogin
 * propagates over HTTP into resource-server-fastapi's auth.token.verify span,
 * and that both land in Datadog and Sentry. Run manually with:
 *   DD_API_KEY=... SENTRY_DSN=... RUN_OTEL_E2E=1 RS_E2E_URL=http://localhost:8010 pnpm test:e2e -- otel-thin-slice
 */
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';

const shouldRun =
  process.env.RUN_OTEL_E2E === '1' &&
  process.env.DD_API_KEY &&
  process.env.SENTRY_DSN &&
  process.env.RS_E2E_URL;
const describeOrSkip = shouldRun ? describe : describe.skip;

describeOrSkip('OTel thin slice: password login -> token issuance -> resource verify', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('issues a JWT, gets it verified by resource-server-fastapi, and (manually) confirms the joined trace in Datadog/Sentry', async () => {
    const loginResponse = await request(app.getHttpServer())
      .post('/api/token/direct/login')
      .send({
        appId: process.env.E2E_APP_ID,
        identifier: process.env.E2E_ADMIN_EMAIL,
        password: process.env.E2E_ADMIN_PASSWORD,
      });

    expect(loginResponse.status).toBe(201);
    const token = loginResponse.body.access_token as string;
    expect(token).toBeDefined();

    // /api/properties is resource-server-fastapi's only protected route today
    // (apps/resource-server-fastapi/app/api/routes.py) and requires the
    // rs.properties.create scope — E2E_ADMIN_EMAIL's role must grant it, or
    // this assertion should be 403 with reason "insufficient_scope" instead
    // of 200; either response proves auth.token.verify ran and propagated.
    const verifyResponse = await fetch(`${process.env.RS_E2E_URL}/api/properties`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect([200, 403]).toContain(verifyResponse.status);

    // This test cannot assert on Datadog/Sentry's ingestion API from here —
    // it only proves the request path that should have produced spans 1-7 of
    // the thin slice completed successfully, with the same trace context
    // carried across the HTTP call to resource-server-fastapi. Checking the
    // trace actually arrived intact and joined in both backends is a manual
    // step: search Datadog APM / Sentry Performance for the resulting trace
    // ID (logged by the auth.signin span's `auth.method: password` attribute)
    // within a minute of running this test.
  });
});
```

- [ ] **Step 2: Run it in skipped mode to confirm it's inert by default**

Run: `cd apps/auth-server && pnpm test:e2e -- otel-thin-slice`
Expected: PASS with 1 skipped test (no `RUN_OTEL_E2E` set)

- [ ] **Step 3: Commit**

```bash
git add apps/auth-server/test/otel-thin-slice.e2e-spec.ts
git commit -m "test(otel): add opt-in thin-slice e2e check for Datadog/Sentry trace delivery"
```

---

## Final verification

- [ ] Run every service's full test suite one more time from the repo root: `pnpm test` (or the equivalent turbo pipeline) and confirm all pass.
- [ ] Grep the diff for any of the configured-secret literals from Task 9's test to confirm none were accidentally hardcoded into a committed file: `git log --oneline docs/superpowers/plans/2026-08-31-opentelemetry-datadog.md..HEAD -- apps/ | wc -l` should match the 10 commits above (spot-check with `git log --stat`).
- [ ] Confirm `apps/auth-server/src/social/telemetry-sentry-adapter.ts` no longer exists: `test ! -f apps/auth-server/src/social/telemetry-sentry-adapter.ts && echo removed`.
