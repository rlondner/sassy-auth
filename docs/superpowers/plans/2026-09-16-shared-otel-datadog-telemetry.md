# Shared OTel/Datadog Telemetry Package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the duplicated `DD_API_KEY`/`DD_SITE` Datadog OTLP wiring in `auth-server` and `admin` with the standard `OTEL_EXPORTER_OTLP_*` env-var convention, centralized in a new `packages/telemetry` workspace package, and add browser-side OpenTelemetry error capture to `admin`.

**Architecture:** A new `@sassy-auth/telemetry` package exposes three subpath entry points — `/server` (traces/metrics/logs setup, env-var driven, no more hand-built Datadog URLs), `/proxy` (a Next.js Route Handler factory that keeps the Datadog API key server-side), and `/client` (browser tracer bootstrap + error-span capture). It's built with `tsc` to `dist/`, following the same prebuilt-package pattern as `packages/db` and `packages/types` (not `packages/ui`'s raw-source pattern, since telemetry has no JSX and needs to run cleanly under NestJS's ts-jest, Next's webpack, and Next's jest, all without extra per-app config).

**Tech Stack:** TypeScript, `@opentelemetry/*` (api, sdk-trace-base, sdk-trace-web, sdk-metrics, sdk-logs, exporter-*-otlp-http, resources, semantic-conventions), Jest/ts-jest, Next.js 15 App Router Route Handlers, `@sentry/nestjs` / `@sentry/nextjs`.

Reference spec: `docs/superpowers/specs/2026-09-16-shared-otel-datadog-telemetry-design.md`

---

## Pre-existing code this plan touches

- `apps/auth-server/src/telemetry/otel.ts` — deleted (logic moves to the package)
- `apps/auth-server/src/telemetry/otel.spec.ts` — deleted (superseded by `packages/telemetry/src/server.spec.ts`)
- `apps/auth-server/src/telemetry/sentry-log-exporter.ts` — deleted (moves to the package, generalized)
- `apps/auth-server/src/telemetry/sentry-log-exporter.spec.ts` — deleted (superseded by `packages/telemetry/src/sentry-log-exporter.spec.ts`)
- `apps/auth-server/src/telemetry/auth-metrics.ts` — **not modified**. It calls `metrics.getMeter('sassy-auth.auth-server')` directly via the global OTel API, independent of anything in `otel.ts`. It keeps working unchanged as long as `setupOtelMetrics` still registers a global meter provider — verify with `apps/auth-server/src/telemetry/auth-metrics.spec.ts` in Task 6.
- `apps/auth-server/src/instrument.ts` — modified to import from `@sassy-auth/telemetry/server`
- `apps/auth-server/test/otel-thin-slice.e2e-spec.ts` — modified (env var name in its `shouldRun` gate and header comment)
- `apps/admin/sentry.server.config.ts` — modified to import from `@sassy-auth/telemetry/server`
- `apps/admin/app/global-error.tsx` — modified to add OTel error-span capture alongside existing `Sentry.captureException`
- `README.md` — modified (env var table)

**Explicitly out of scope** (per the approved spec): `apps/resource-server-fastapi` (Python, still on `DD_API_KEY`/`DD_SITE`), automatic `fetch`/XHR trace propagation, and instrumenting the deliberately-silent `.catch()` in `apps/admin/app/reset-password/reset-password-form.tsx` (that swallow is intentional — the comment there explains the server-side gate is the real enforcement regardless of this fetch's outcome; wiring telemetry to it would just be noise, not signal).

---

### Task 1: Scaffold `packages/telemetry` + header-parsing helper

**Files:**
- Create: `packages/telemetry/package.json`
- Create: `packages/telemetry/tsconfig.json`
- Create: `packages/telemetry/src/headers.ts`
- Test: `packages/telemetry/src/headers.spec.ts`

- [ ] **Step 1: Create the package manifest**

`packages/telemetry/package.json`:
```json
{
  "name": "@sassy-auth/telemetry",
  "version": "0.0.1",
  "private": true,
  "main": "./dist/server.js",
  "types": "./dist/server.d.ts",
  "exports": {
    "./server": {
      "types": "./dist/server.d.ts",
      "default": "./dist/server.js"
    },
    "./proxy": {
      "types": "./dist/proxy.d.ts",
      "default": "./dist/proxy.js"
    },
    "./client": {
      "types": "./dist/client.d.ts",
      "default": "./dist/client.js"
    }
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch --preserveWatchOutput",
    "test": "node ../../scripts/log-test.mjs telemetry jest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@opentelemetry/api": "^1.9.0",
    "@opentelemetry/api-logs": "0.214.0",
    "@opentelemetry/core": "^2.11.0",
    "@opentelemetry/exporter-logs-otlp-http": "^0.222.0",
    "@opentelemetry/exporter-metrics-otlp-http": "^0.222.0",
    "@opentelemetry/exporter-trace-otlp-http": "^0.222.0",
    "@opentelemetry/resources": "^2.0.0",
    "@opentelemetry/sdk-logs": "^0.222.0",
    "@opentelemetry/sdk-metrics": "^2.11.0",
    "@opentelemetry/sdk-trace-base": "^2.11.0",
    "@opentelemetry/sdk-trace-web": "^2.11.0",
    "@opentelemetry/semantic-conventions": "^1.30.0"
  },
  "devDependencies": {
    "@types/jest": "^29.5.12",
    "@types/node": "^20.0.0",
    "jest": "^29.7.0",
    "jest-environment-jsdom": "^29.7.0",
    "ts-jest": "^29.1.4",
    "typescript": "^5.4.0"
  },
  "jest": {
    "moduleFileExtensions": ["js", "json", "ts"],
    "rootDir": "src",
    "testRegex": ".*\\.spec\\.ts$",
    "transform": {
      "^.+\\.ts$": "ts-jest"
    },
    "coverageDirectory": "../coverage",
    "testEnvironment": "node"
  }
}
```

- [ ] **Step 2: Create the TypeScript config**

`packages/telemetry/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "declaration": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true
  },
  "include": ["src"],
  "exclude": ["src/**/*.spec.ts"]
}
```

- [ ] **Step 3: Install dependencies**

Run: `pnpm install`
Expected: pnpm links `packages/telemetry` into the workspace with no errors.

- [ ] **Step 4: Write the failing test for the OTLP header parser**

`packages/telemetry/src/headers.spec.ts`:
```ts
import { parseOtlpHeaders } from './headers';

describe('parseOtlpHeaders', () => {
  it('returns an empty object for undefined input', () => {
    expect(parseOtlpHeaders(undefined)).toEqual({});
  });

  it('returns an empty object for an empty string', () => {
    expect(parseOtlpHeaders('')).toEqual({});
  });

  it('parses a single key=value pair', () => {
    expect(parseOtlpHeaders('dd-api-key=abc123')).toEqual({ 'dd-api-key': 'abc123' });
  });

  it('parses multiple comma-separated pairs', () => {
    expect(parseOtlpHeaders('k1=v1,k2=v2')).toEqual({ k1: 'v1', k2: 'v2' });
  });

  it('trims whitespace around keys and values', () => {
    expect(parseOtlpHeaders(' k1 = v1 , k2 = v2 ')).toEqual({ k1: 'v1', k2: 'v2' });
  });

  it('percent-decodes values', () => {
    expect(parseOtlpHeaders('k1=hello%20world')).toEqual({ k1: 'hello world' });
  });

  it('skips malformed pairs with no "="', () => {
    expect(parseOtlpHeaders('k1=v1,garbage,k2=v2')).toEqual({ k1: 'v1', k2: 'v2' });
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `cd packages/telemetry && npx jest headers.spec.ts`
Expected: FAIL with `Cannot find module './headers'`

- [ ] **Step 6: Implement the parser**

`packages/telemetry/src/headers.ts`:
```ts
export function parseOtlpHeaders(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  const headers: Record<string, string> = {};
  for (const pair of raw.split(',')) {
    const eqIndex = pair.indexOf('=');
    if (eqIndex === -1) continue;
    const key = pair.slice(0, eqIndex).trim();
    const value = pair.slice(eqIndex + 1).trim();
    if (key) headers[key] = decodeURIComponent(value);
  }
  return headers;
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `cd packages/telemetry && npx jest headers.spec.ts`
Expected: PASS (7 tests)

- [ ] **Step 8: Commit**

```bash
git add packages/telemetry/package.json packages/telemetry/tsconfig.json packages/telemetry/src/headers.ts packages/telemetry/src/headers.spec.ts
git commit -m "feat(telemetry): scaffold packages/telemetry with OTLP header parser"
```

---

### Task 2: Move and generalize `SentryLogRecordExporter`

**Files:**
- Create: `packages/telemetry/src/sentry-log-exporter.ts`
- Test: `packages/telemetry/src/sentry-log-exporter.spec.ts`
- Delete (later, in Task 6): `apps/auth-server/src/telemetry/sentry-log-exporter.ts`, `apps/auth-server/src/telemetry/sentry-log-exporter.spec.ts`

The original (`apps/auth-server/src/telemetry/sentry-log-exporter.ts`) hardcodes `import { logger as sentryLogger } from '@sentry/nestjs'`. Since `admin` uses `@sentry/nextjs` (a different package with the same `logger.info/warn/error` shape), the shared version takes the Sentry logger as a constructor argument instead of importing a specific Sentry flavor — this is the one deliberate deviation from the design doc's sketch, needed so the package has no hard dependency on either `@sentry/nestjs` or `@sentry/nextjs`.

- [ ] **Step 1: Write the failing test**

`packages/telemetry/src/sentry-log-exporter.spec.ts`:
```ts
import { SeverityNumber } from '@opentelemetry/api-logs';
import { ExportResultCode } from '@opentelemetry/core';
import { SentryLogRecordExporter, type SentryLoggerLike } from './sentry-log-exporter';

function fakeRecord(overrides: Partial<{ severityNumber: number; body: unknown; attributes: Record<string, unknown> }>) {
  return {
    severityNumber: SeverityNumber.INFO,
    body: 'default body',
    attributes: {},
    ...overrides,
  } as never;
}

function fakeSentryLogger(): SentryLoggerLike & { info: jest.Mock; warn: jest.Mock; error: jest.Mock } {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

describe('SentryLogRecordExporter', () => {
  it('routes WARN-and-above-but-below-ERROR records to logger.warn', () => {
    const logger = fakeSentryLogger();
    const exporter = new SentryLogRecordExporter(logger);
    const callback = jest.fn();
    exporter.export(
      [fakeRecord({ severityNumber: SeverityNumber.WARN, body: 'social.signin.rejected', attributes: { 'auth.provider': 'google' } })],
      callback,
    );
    expect(logger.warn).toHaveBeenCalledWith('social.signin.rejected', { 'auth.provider': 'google' });
    expect(callback).toHaveBeenCalledWith({ code: ExportResultCode.SUCCESS });
  });

  it('routes ERROR-and-above records to logger.error', () => {
    const logger = fakeSentryLogger();
    const exporter = new SentryLogRecordExporter(logger);
    exporter.export(
      [fakeRecord({ severityNumber: SeverityNumber.ERROR, body: 'social.signin.rejected', attributes: { 'auth.outcome': 'provider_error' } })],
      jest.fn(),
    );
    expect(logger.error).toHaveBeenCalledWith('social.signin.rejected', { 'auth.outcome': 'provider_error' });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('routes everything below WARN to logger.info', () => {
    const logger = fakeSentryLogger();
    const exporter = new SentryLogRecordExporter(logger);
    exporter.export([fakeRecord({ severityNumber: SeverityNumber.DEBUG, body: 'social.signin.ok' })], jest.fn());
    expect(logger.info).toHaveBeenCalledWith('social.signin.ok', {});
  });

  it('resolves shutdown without throwing', async () => {
    await expect(new SentryLogRecordExporter(fakeSentryLogger()).shutdown()).resolves.toBeUndefined();
  });

  it('resolves forceFlush without throwing', async () => {
    await expect(new SentryLogRecordExporter(fakeSentryLogger()).forceFlush()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/telemetry && npx jest sentry-log-exporter.spec.ts`
Expected: FAIL with `Cannot find module './sentry-log-exporter'`

- [ ] **Step 3: Implement the exporter**

`packages/telemetry/src/sentry-log-exporter.ts`:
```ts
import { SeverityNumber } from '@opentelemetry/api-logs';
import { ExportResultCode, type ExportResult } from '@opentelemetry/core';
import type { LogRecordExporter, ReadableLogRecord } from '@opentelemetry/sdk-logs';

/**
 * Bridges OTel log records to Sentry's structured-logging API. Takes the
 * Sentry `logger` object as a constructor argument (rather than importing
 * `@sentry/nestjs` or `@sentry/nextjs` directly) so this package has no hard
 * dependency on either Sentry SDK flavor — each app passes its own `logger`.
 */
export interface SentryLoggerLike {
  info(message: string, attributes?: Record<string, unknown>): void;
  warn(message: string, attributes?: Record<string, unknown>): void;
  error(message: string, attributes?: Record<string, unknown>): void;
}

export class SentryLogRecordExporter implements LogRecordExporter {
  constructor(private readonly sentryLogger: SentryLoggerLike) {}

  export(records: ReadableLogRecord[], resultCallback: (result: ExportResult) => void): void {
    for (const record of records) {
      const message = String(record.body ?? 'sassy-auth.log.event');
      const attributes = { ...record.attributes };
      if (record.severityNumber !== undefined && record.severityNumber >= SeverityNumber.ERROR) {
        this.sentryLogger.error(message, attributes);
      } else if (record.severityNumber !== undefined && record.severityNumber >= SeverityNumber.WARN) {
        this.sentryLogger.warn(message, attributes);
      } else {
        this.sentryLogger.info(message, attributes);
      }
    }
    resultCallback({ code: ExportResultCode.SUCCESS });
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/telemetry && npx jest sentry-log-exporter.spec.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/telemetry/src/sentry-log-exporter.ts packages/telemetry/src/sentry-log-exporter.spec.ts
git commit -m "feat(telemetry): move SentryLogRecordExporter into shared package, generalize logger injection"
```

---

### Task 3: `server.ts` — env-var-driven traces/metrics/logs setup

**Files:**
- Create: `packages/telemetry/src/server.ts`
- Test: `packages/telemetry/src/server.spec.ts`

- [ ] **Step 1: Write the failing test**

`packages/telemetry/src/server.spec.ts`:
```ts
import { metrics } from '@opentelemetry/api';
import type { SentryLoggerLike } from './sentry-log-exporter';

describe('isDatadogOtlpEnabled', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('is false when OTEL_EXPORTER_OTLP_ENDPOINT is unset', async () => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const { isDatadogOtlpEnabled } = await import('./server');
    expect(isDatadogOtlpEnabled()).toBe(false);
  });

  it('is true when OTEL_EXPORTER_OTLP_ENDPOINT is set', async () => {
    delete process.env.OTEL_SDK_DISABLED;
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'https://otlp.datadoghq.com';
    const { isDatadogOtlpEnabled } = await import('./server');
    expect(isDatadogOtlpEnabled()).toBe(true);
  });

  it('is false when OTEL_SDK_DISABLED is true, even if the endpoint is set', async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'https://otlp.datadoghq.com';
    process.env.OTEL_SDK_DISABLED = 'true';
    const { isDatadogOtlpEnabled } = await import('./server');
    expect(isDatadogOtlpEnabled()).toBe(false);
  });
});

describe('buildDatadogSpanProcessors', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('returns an empty array when the endpoint is unset', async () => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const { buildDatadogSpanProcessors } = await import('./server');
    expect(buildDatadogSpanProcessors()).toEqual([]);
  });

  it('returns one span processor when the endpoint is set', async () => {
    delete process.env.OTEL_SDK_DISABLED;
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'https://otlp.datadoghq.com';
    process.env.OTEL_EXPORTER_OTLP_HEADERS = 'dd-api-key=test-key';
    const { buildDatadogSpanProcessors } = await import('./server');
    expect(buildDatadogSpanProcessors()).toHaveLength(1);
  });
});

describe('setupOtelMetrics', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('returns a meter namespaced to the given meter name', async () => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const { setupOtelMetrics } = await import('./server');
    const { meter } = setupOtelMetrics('sassy-auth-auth-server', 'sassy-auth.auth-server');
    expect(meter).toBeDefined();
    expect(metrics.getMeterProvider().getMeter).toBeDefined();
  });

  it('does not throw when the endpoint is set but unreachable', async () => {
    delete process.env.OTEL_SDK_DISABLED;
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'https://otlp.datadoghq.com';
    process.env.OTEL_EXPORTER_OTLP_HEADERS = 'dd-api-key=test-key';
    process.env.OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE = 'delta';
    const { setupOtelMetrics } = await import('./server');
    expect(() => setupOtelMetrics('sassy-auth-auth-server', 'sassy-auth.auth-server')).not.toThrow();
  });

  // Confirms the installed @opentelemetry/exporter-metrics-otlp-http version
  // actually auto-reads OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE —
  // this is what lets server.ts construct `new OTLPMetricExporter()` with no
  // explicit temporality selector and still get delta temporality, which
  // Datadog's OTLP intake requires for Sums/Histograms.
  it('the metric exporter honors OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=delta', async () => {
    process.env.OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE = 'delta';
    const { OTLPMetricExporter } = await import('@opentelemetry/exporter-metrics-otlp-http');
    const { AggregationTemporality, InstrumentType } = await import('@opentelemetry/sdk-metrics');
    const exporter = new OTLPMetricExporter();
    expect(exporter.selectAggregationTemporality?.(InstrumentType.COUNTER)).toBe(AggregationTemporality.DELTA);
  });
});

describe('setupOtelLogging', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('does not throw regardless of env configuration', async () => {
    const { setupOtelLogging } = await import('./server');
    expect(() => setupOtelLogging('sassy-auth-auth-server')).not.toThrow();
  });

  it('does not throw when a Sentry DSN and logger are both provided', async () => {
    process.env.SENTRY_DSN = 'https://example.invalid/1';
    const { setupOtelLogging } = await import('./server');
    const fakeLogger: SentryLoggerLike = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    expect(() => setupOtelLogging('sassy-auth-auth-server', fakeLogger)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/telemetry && npx jest server.spec.ts`
Expected: FAIL with `Cannot find module './server'`

- [ ] **Step 3: Implement `server.ts`**

`packages/telemetry/src/server.ts`:
```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/telemetry && npx jest server.spec.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Build the package and verify the TypeScript compiles**

Run: `cd packages/telemetry && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add packages/telemetry/src/server.ts packages/telemetry/src/server.spec.ts
git commit -m "feat(telemetry): add env-var-driven server.ts (traces, metrics, logs)"
```

---

### Task 4: `proxy.ts` — Next.js OTel proxy route factory

**Files:**
- Create: `packages/telemetry/src/proxy.ts`
- Test: `packages/telemetry/src/proxy.spec.ts`

- [ ] **Step 1: Write the failing test**

`packages/telemetry/src/proxy.spec.ts`:
```ts
import { createOtelProxyHandler } from './proxy';

function makeRequest(overrides: { method?: string; origin?: string | null; contentLength?: string | null } = {}): Request {
  const headers = new Headers();
  if (overrides.origin !== null) headers.set('origin', overrides.origin ?? 'https://admin.example.com');
  if (overrides.contentLength !== null) headers.set('content-length', overrides.contentLength ?? '10');
  headers.set('content-type', 'application/x-protobuf');
  return new Request('https://admin.example.com/api/otel/v1/traces', {
    method: overrides.method ?? 'POST',
    headers,
    body: overrides.method === 'GET' ? undefined : new Uint8Array([1, 2, 3]),
  });
}

describe('createOtelProxyHandler', () => {
  const ORIGINAL_ENV = process.env;
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'https://otlp.datadoghq.com';
    process.env.OTEL_EXPORTER_OTLP_HEADERS = 'dd-api-key=test-key';
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    global.fetch = originalFetch;
  });

  it('forwards a valid POST to the OTLP endpoint with the dd-api-key header injected', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const handler = createOtelProxyHandler();
    const response = await handler(makeRequest(), { params: Promise.resolve({ path: ['v1', 'traces'] }) });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://otlp.datadoghq.com/v1/traces');
    expect((init.headers as Record<string, string>)['dd-api-key']).toBe('test-key');
  });

  it('returns 405 for a non-POST method', async () => {
    const handler = createOtelProxyHandler();
    const response = await handler(makeRequest({ method: 'GET' }), { params: Promise.resolve({ path: ['v1', 'traces'] }) });
    expect(response.status).toBe(405);
  });

  it('returns 404 for an unknown signal path', async () => {
    const handler = createOtelProxyHandler();
    const response = await handler(makeRequest(), { params: Promise.resolve({ path: ['v1', 'metrics'] }) });
    expect(response.status).toBe(404);
  });

  it('returns 403 for a cross-origin request', async () => {
    const handler = createOtelProxyHandler();
    const response = await handler(
      makeRequest({ origin: 'https://evil.example.com' }),
      { params: Promise.resolve({ path: ['v1', 'traces'] }) },
    );
    expect(response.status).toBe(403);
  });

  it('returns 413 for an oversized body', async () => {
    const handler = createOtelProxyHandler();
    const response = await handler(
      makeRequest({ contentLength: String(2_000_000) }),
      { params: Promise.resolve({ path: ['v1', 'traces'] }) },
    );
    expect(response.status).toBe(413);
  });

  it('returns 500 when OTEL_EXPORTER_OTLP_ENDPOINT is unset', async () => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const handler = createOtelProxyHandler();
    const response = await handler(makeRequest(), { params: Promise.resolve({ path: ['v1', 'traces'] }) });
    expect(response.status).toBe(500);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/telemetry && npx jest proxy.spec.ts`
Expected: FAIL with `Cannot find module './proxy'`

- [ ] **Step 3: Implement `proxy.ts`**

`packages/telemetry/src/proxy.ts`:
```ts
import { isDatadogOtlpEnabled } from './server';
import { parseOtlpHeaders } from './headers';

const MAX_BODY_BYTES = 1_000_000;
const ALLOWED_SIGNAL_PATHS = new Set(['v1/traces']);

type RouteContext = { params: Promise<{ path: string[] }> };

/**
 * Next.js Route Handler factory. Drop the result into
 * `apps/admin/app/api/otel/[...path]/route.ts` as `export const POST = createOtelProxyHandler()`.
 * Keeps OTEL_EXPORTER_OTLP_HEADERS (the Datadog API key) server-side — the
 * browser bundle never sees it. Only `v1/traces` is allowlisted today, since
 * only client-side error spans are wired up (no browser metrics/logs).
 */
export function createOtelProxyHandler() {
  return async function POST(request: Request, context: RouteContext): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response(null, { status: 405 });
    }

    const { path } = await context.params;
    const signalPath = path.join('/');
    if (!ALLOWED_SIGNAL_PATHS.has(signalPath)) {
      return new Response(null, { status: 404 });
    }

    const url = new URL(request.url);
    const origin = request.headers.get('origin');
    if (origin !== null && origin !== url.origin) {
      return new Response(null, { status: 403 });
    }

    const contentLengthHeader = request.headers.get('content-length');
    if (contentLengthHeader !== null && Number(contentLengthHeader) > MAX_BODY_BYTES) {
      return new Response(null, { status: 413 });
    }

    if (!isDatadogOtlpEnabled()) {
      console.error('[otel-proxy] OTEL_EXPORTER_OTLP_ENDPOINT is not set; dropping telemetry');
      return new Response(null, { status: 500 });
    }

    const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const ddHeaders = parseOtlpHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS);

    try {
      const contentType = request.headers.get('content-type') ?? 'application/x-protobuf';
      const body = await request.arrayBuffer();

      const upstreamResponse = await fetch(`${endpoint}/${signalPath}`, {
        method: 'POST',
        headers: { 'content-type': contentType, ...ddHeaders },
        body,
      });

      return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        headers: { 'content-type': upstreamResponse.headers.get('content-type') ?? 'application/json' },
      });
    } catch (error) {
      console.error('[otel-proxy] Failed to reach the Datadog OTLP endpoint:', error);
      return new Response(null, { status: 502 });
    }
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/telemetry && npx jest proxy.spec.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/telemetry/src/proxy.ts packages/telemetry/src/proxy.spec.ts
git commit -m "feat(telemetry): add Next.js OTel proxy route factory"
```

---

### Task 5: `client.ts` — browser bootstrap + error capture

**Files:**
- Create: `packages/telemetry/src/client.ts`
- Test: `packages/telemetry/src/client.spec.ts`

- [ ] **Step 1: Write the failing test**

`packages/telemetry/src/client.spec.ts`:
```ts
/**
 * @jest-environment jsdom
 */
jest.mock('@opentelemetry/api', () => {
  const actual = jest.requireActual('@opentelemetry/api');
  return {
    ...actual,
    trace: { ...actual.trace, getTracer: jest.fn() },
  };
});

import { trace } from '@opentelemetry/api';
import { initOtelClient, captureClientError } from './client';

const getTracerMock = trace.getTracer as jest.Mock;

describe('client', () => {
  let startSpanMock: jest.Mock;
  let spanEndMock: jest.Mock;
  let recordExceptionMock: jest.Mock;

  beforeEach(() => {
    spanEndMock = jest.fn();
    recordExceptionMock = jest.fn();
    startSpanMock = jest.fn().mockReturnValue({ end: spanEndMock, recordException: recordExceptionMock });
    getTracerMock.mockReset().mockReturnValue({ startSpan: startSpanMock });
  });

  describe('captureClientError before initOtelClient has run', () => {
    it('is a no-op', () => {
      jest.resetModules();
      // re-require a fresh, uninitialized module instance
      const fresh = jest.requireActual('./client') as typeof import('./client');
      fresh.captureClientError(new Error('boom'));
      expect(startSpanMock).not.toHaveBeenCalled();
    });
  });

  describe('after initOtelClient has run', () => {
    beforeAll(() => {
      initOtelClient('sassy-auth-admin');
    });

    it('records an Error with error.type, error.message and any extra context', () => {
      captureClientError(new TypeError('network failed'), { boundary: 'global-error' });

      expect(startSpanMock).toHaveBeenCalledTimes(1);
      const [spanName, spanOptions] = startSpanMock.mock.calls[0] as [string, { attributes: Record<string, string> }];
      expect(spanName).toBe('client.error');
      expect(spanOptions.attributes).toEqual({
        'error.type': 'TypeError',
        'error.message': 'network failed',
        boundary: 'global-error',
      });
      expect(recordExceptionMock).toHaveBeenCalledTimes(1);
      expect(spanEndMock).toHaveBeenCalledTimes(1);
    });

    it('wraps a non-Error thrown value in an Error before recording', () => {
      captureClientError('a plain string throw');

      const [, spanOptions] = startSpanMock.mock.calls.at(-1) as [string, { attributes: Record<string, string> }];
      expect(spanOptions.attributes['error.message']).toBe('a plain string throw');
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/telemetry && npx jest client.spec.ts`
Expected: FAIL with `Cannot find module './client'`

- [ ] **Step 3: Implement `client.ts`**

`packages/telemetry/src/client.ts`:
```ts
import { trace, type Tracer } from '@opentelemetry/api';
import { WebTracerProvider, BatchSpanProcessor } from '@opentelemetry/sdk-trace-web';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_DEPLOYMENT_ENVIRONMENT_NAME } from '@opentelemetry/semantic-conventions';

const OTEL_PROXY_TRACES_PATH = '/api/otel/v1/traces';

let initialized = false;
let tracer: Tracer | undefined;

/**
 * Call once, client-side only, before any captureClientError call site can
 * do anything useful. Posts spans through the same-origin OTel proxy route
 * (see proxy.ts) rather than directly to Datadog, so the API key never
 * reaches the browser bundle.
 */
export function initOtelClient(serviceName: string): void {
  if (typeof window === 'undefined' || initialized) return;
  initialized = true;

  try {
    const resource = resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName,
      [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: process.env.NODE_ENV,
    });

    const provider = new WebTracerProvider({
      resource,
      spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter({ url: OTEL_PROXY_TRACES_PATH }))],
    });
    provider.register();

    tracer = trace.getTracer(serviceName);
  } catch (error) {
    console.error('[otel] Failed to initialize OpenTelemetry Web SDK:', error);
  }
}

/**
 * Records a "client.error" span for an error caught in the browser (an error
 * boundary, a failed fetch, etc.). No-ops if initOtelClient hasn't run yet.
 */
export function captureClientError(error: unknown, context?: Record<string, string>): void {
  if (!tracer) return;

  const err = error instanceof Error ? error : new Error(String(error));
  const span = tracer.startSpan('client.error', {
    attributes: {
      'error.type': err.name,
      'error.message': err.message,
      ...(context ?? {}),
    },
  });
  span.recordException(err);
  span.end();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/telemetry && npx jest client.spec.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Run the full package test suite and build**

Run: `cd packages/telemetry && npx jest && npx tsc`
Expected: all tests PASS; `tsc` produces `packages/telemetry/dist/{server,proxy,client,headers,sentry-log-exporter}.js` and matching `.d.ts` files with no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/telemetry/src/client.ts packages/telemetry/src/client.spec.ts
git commit -m "feat(telemetry): add browser bootstrap and client.error span capture"
```

---

### Task 6: Wire `auth-server` to the shared package

**Files:**
- Modify: `apps/auth-server/package.json`
- Modify: `apps/auth-server/src/instrument.ts`
- Modify: `apps/auth-server/test/otel-thin-slice.e2e-spec.ts`
- Delete: `apps/auth-server/src/telemetry/otel.ts`
- Delete: `apps/auth-server/src/telemetry/otel.spec.ts`
- Delete: `apps/auth-server/src/telemetry/sentry-log-exporter.ts`
- Delete: `apps/auth-server/src/telemetry/sentry-log-exporter.spec.ts`

- [ ] **Step 1: Add the package dependency and remove now-unused OTel SDK deps**

In `apps/auth-server/package.json`, add to `"dependencies"`:
```json
    "@sassy-auth/telemetry": "workspace:*",
```

Remove these lines from `"dependencies"` (their only use was inside the files being deleted in Step 4 — `auth-metrics.ts` and `record-federation-event.ts` only use `@opentelemetry/api`, which stays):
```json
    "@opentelemetry/api-logs": "0.214.0",
    "@opentelemetry/core": "^2.11.0",
    "@opentelemetry/exporter-logs-otlp-http": "^0.222.0",
    "@opentelemetry/exporter-metrics-otlp-http": "^0.222.0",
    "@opentelemetry/exporter-trace-otlp-http": "^0.222.0",
    "@opentelemetry/resources": "^2.0.0",
    "@opentelemetry/sdk-logs": "^0.222.0",
    "@opentelemetry/sdk-metrics": "^2.11.0",
    "@opentelemetry/sdk-trace-base": "^2.11.0",
    "@opentelemetry/semantic-conventions": "^1.30.0",
```

Keep `"@opentelemetry/api": "^1.9.0"` — it's used directly by `auth-metrics.ts`, `record-federation-event.ts`, `token.controller.ts`, and `token.service.ts`.

- [ ] **Step 2: Install**

Run: `pnpm install`
Expected: no errors; `node_modules/@sassy-auth/telemetry` is linked.

- [ ] **Step 3: Rewrite `instrument.ts`**

`apps/auth-server/src/instrument.ts`:
```ts
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
```

- [ ] **Step 4: Delete the superseded local telemetry files**

Run:
```bash
rm apps/auth-server/src/telemetry/otel.ts
rm apps/auth-server/src/telemetry/otel.spec.ts
rm apps/auth-server/src/telemetry/sentry-log-exporter.ts
rm apps/auth-server/src/telemetry/sentry-log-exporter.spec.ts
```
`apps/auth-server/src/telemetry/auth-metrics.ts` and `auth-metrics.spec.ts` are NOT deleted — they're independent of `otel.ts`.

- [ ] **Step 5: Update the e2e test's env var gate and comment**

In `apps/auth-server/test/otel-thin-slice.e2e-spec.ts`:

Replace:
```ts
 * reasons: (a) `package.json`'s `test:e2e` script sets
 * `OTEL_SDK_DISABLED=true`, which disables the exporter regardless of
 * `DD_API_KEY`; (b) this test imports `AppModule` directly rather than going
```
with:
```ts
 * reasons: (a) `package.json`'s `test:e2e` script sets
 * `OTEL_SDK_DISABLED=true`, which disables the exporter regardless of
 * `OTEL_EXPORTER_OTLP_ENDPOINT`; (b) this test imports `AppModule` directly rather than going
```

Replace:
```ts
 * Run manually with:
 *   DD_API_KEY=... SENTRY_DSN=... RUN_OTEL_E2E=1 RS_E2E_URL=http://localhost:8010 pnpm test:e2e -- otel-thin-slice
 */
```
with:
```ts
 * Run manually with:
 *   OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp.datadoghq.com OTEL_EXPORTER_OTLP_HEADERS=dd-api-key=... SENTRY_DSN=... RUN_OTEL_E2E=1 RS_E2E_URL=http://localhost:8010 pnpm test:e2e -- otel-thin-slice
 */
```

Replace:
```ts
const shouldRun =
  process.env.RUN_OTEL_E2E === '1' &&
  process.env.DD_API_KEY &&
  process.env.SENTRY_DSN &&
  process.env.RS_E2E_URL;
```
with:
```ts
const shouldRun =
  process.env.RUN_OTEL_E2E === '1' &&
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT &&
  process.env.SENTRY_DSN &&
  process.env.RS_E2E_URL;
```

- [ ] **Step 6: Run the auth-server test suite**

Run: `cd apps/auth-server && OTEL_SDK_DISABLED=true npx jest`
Expected: all tests PASS, including `src/telemetry/auth-metrics.spec.ts` and `src/social/record-federation-event.spec.ts` (unaffected, but confirm the global meter/tracer wiring change didn't break them).

- [ ] **Step 7: Build auth-server**

Run: `cd apps/auth-server && npx nest build`
Expected: builds with no TypeScript errors (confirms `@sassy-auth/telemetry/server` resolves correctly through the compiled `dist/` exports).

- [ ] **Step 8: Commit**

```bash
git add apps/auth-server/package.json apps/auth-server/src/instrument.ts apps/auth-server/test/otel-thin-slice.e2e-spec.ts
git rm apps/auth-server/src/telemetry/otel.ts apps/auth-server/src/telemetry/otel.spec.ts apps/auth-server/src/telemetry/sentry-log-exporter.ts apps/auth-server/src/telemetry/sentry-log-exporter.spec.ts
git commit -m "refactor(auth-server): use @sassy-auth/telemetry instead of local otel.ts"
```

---

### Task 7: Wire `admin` server-side telemetry to the shared package

**Files:**
- Modify: `apps/admin/package.json`
- Modify: `apps/admin/sentry.server.config.ts`

- [ ] **Step 1: Add the package dependency**

In `apps/admin/package.json`, add to `"dependencies"`:
```json
    "@sassy-auth/telemetry": "workspace:*",
```

- [ ] **Step 2: Install**

Run: `pnpm install`
Expected: no errors.

- [ ] **Step 3: Rewrite `sentry.server.config.ts`**

`apps/admin/sentry.server.config.ts`:
```ts
import * as Sentry from '@sentry/nextjs';
import { logger as sentryLogger } from '@sentry/nextjs';
import { buildDatadogSpanProcessors, setupOtelLogging } from '@sassy-auth/telemetry/server';

const SERVICE_NAME = process.env.OTEL_SERVICE_NAME ?? 'sassy-auth-admin';

setupOtelLogging(SERVICE_NAME, sentryLogger);

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
  openTelemetrySpanProcessors: buildDatadogSpanProcessors(),
});
```

- [ ] **Step 4: Typecheck admin**

Run: `cd apps/admin && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/package.json apps/admin/sentry.server.config.ts
git commit -m "refactor(admin): use @sassy-auth/telemetry for server-side Datadog traces + logs"
```

---

### Task 8: Add the OTel proxy route to `admin`

**Files:**
- Create: `apps/admin/app/api/otel/[...path]/route.ts`

- [ ] **Step 1: Create the route file**

`apps/admin/app/api/otel/[...path]/route.ts`:
```ts
import { createOtelProxyHandler } from '@sassy-auth/telemetry/proxy'

export const POST = createOtelProxyHandler()
```

- [ ] **Step 2: Typecheck admin**

Run: `cd apps/admin && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manually verify the route locally**

Run: `cd apps/admin && OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp.datadoghq.com OTEL_EXPORTER_OTLP_HEADERS=dd-api-key=fake-key-for-local-check pnpm dev`

In another terminal:
```bash
curl -i -X POST https://localhost:3001/api/otel/v1/traces \
  -H "Content-Type: application/x-protobuf" \
  -H "Origin: https://localhost:3001" \
  --data-binary $'\x00\x01\x02' \
  --insecure
```
Expected: a non-`404`/`403`/`405` status (the request reaches Datadog's endpoint and gets whatever status Datadog returns for a garbage payload with a fake key — typically `401` or `400` — which proves the proxy forwarded it rather than rejecting locally). Stop the dev server after checking.

- [ ] **Step 4: Commit**

```bash
git add "apps/admin/app/api/otel/[...path]/route.ts"
git commit -m "feat(admin): add same-origin OTel proxy route"
```

---

### Task 9: Wire browser error capture into `admin`'s global error boundary

**Files:**
- Modify: `apps/admin/app/global-error.tsx`
- Modify: `apps/admin/package.json`
- Test: `apps/admin/app/__tests__/global-error.test.tsx`

- [ ] **Step 1: Add the new browser-side dependencies**

In `apps/admin/package.json`, add to `"dependencies"`:
```json
    "@opentelemetry/resources": "^2.0.0",
    "@opentelemetry/sdk-trace-web": "^2.11.0",
    "@opentelemetry/semantic-conventions": "^1.30.0",
```
(`@opentelemetry/api`, `@opentelemetry/exporter-trace-otlp-http`, and `@opentelemetry/sdk-trace-base` are already present.)

- [ ] **Step 2: Install**

Run: `pnpm install`
Expected: no errors.

- [ ] **Step 3: Write the failing test**

`apps/admin/app/__tests__/global-error.test.tsx`:
```tsx
import { render } from '@testing-library/react'
import GlobalError from '../global-error'

const captureExceptionMock = jest.fn()
jest.mock('@sentry/nextjs', () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
}))

const initOtelClientMock = jest.fn()
const captureClientErrorMock = jest.fn()
jest.mock('@sassy-auth/telemetry/client', () => ({
  initOtelClient: (...args: unknown[]) => initOtelClientMock(...args),
  captureClientError: (...args: unknown[]) => captureClientErrorMock(...args),
}))

describe('GlobalError', () => {
  afterEach(() => jest.clearAllMocks())

  it('reports the error to both Sentry and the OTel client.error span', () => {
    const error = Object.assign(new Error('boom'), { digest: 'abc123' })
    render(<GlobalError error={error} reset={jest.fn()} />)

    expect(captureExceptionMock).toHaveBeenCalledWith(error)
    expect(initOtelClientMock).toHaveBeenCalledWith('sassy-auth-admin')
    expect(captureClientErrorMock).toHaveBeenCalledWith(error, { boundary: 'global-error' })
  })
})
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd apps/admin && npx jest global-error.test.tsx`
Expected: FAIL — `initOtelClientMock`/`captureClientErrorMock` not called (the source file doesn't call them yet).

- [ ] **Step 5: Update `global-error.tsx`**

`apps/admin/app/global-error.tsx`:
```tsx
'use client'

import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'
import { captureClientError, initOtelClient } from '@sassy-auth/telemetry/client'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error)
    initOtelClient('sassy-auth-admin')
    captureClientError(error, { boundary: 'global-error' })
  }, [error])

  return (
    <html>
      <body>
        <div style={{ padding: '2rem', textAlign: 'center', fontFamily: 'sans-serif' }}>
          <h2>Something went wrong</h2>
          <p>An unexpected error occurred. The issue has been reported.</p>
          <button
            onClick={reset}
            style={{
              marginTop: '1rem',
              padding: '0.5rem 1rem',
              borderRadius: '0.375rem',
              border: '1px solid #d1d5db',
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  )
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd apps/admin && npx jest global-error.test.tsx`
Expected: PASS (1 test)

- [ ] **Step 7: Run the full admin test suite**

Run: `cd apps/admin && OTEL_SDK_DISABLED=true npx jest`
Expected: all tests PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/admin/package.json apps/admin/app/global-error.tsx apps/admin/app/__tests__/global-error.test.tsx
git commit -m "feat(admin): capture client.error OTel spans in the global error boundary"
```

---

### Task 10: Update README env var documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace the Datadog env var rows**

In `README.md`, find:
```
| `OTEL_SERVICE_NAME`         | auth  | Per-service override for the OpenTelemetry service name (each app has a sensible default) |
| `DD_API_KEY`                | auth  | Datadog API key. Unset disables all Datadog export (traces, metrics, logs) |
| `DD_SITE`                   | auth  | Datadog site — `datadoghq.com`, `datadoghq.eu`, etc. (default: `datadoghq.com`) |
```

Replace with:
```
| `OTEL_SERVICE_NAME`         | auth, admin | Per-service override for the OpenTelemetry service name (each app has a sensible default) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | auth, admin | Base Datadog OTLP URL (e.g. `https://otlp.datadoghq.com`). Unset disables all Datadog export (traces, metrics, logs) |
| `OTEL_EXPORTER_OTLP_HEADERS` | auth, admin | Datadog auth header, e.g. `dd-api-key=...` |
| `OTEL_EXPORTER_OTLP_LOGS_PROTOCOL` | auth, admin | Log export protocol, e.g. `http/protobuf` |
| `OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE` | auth | Set to `delta` — Datadog's OTLP intake silently drops cumulative Sums/Histograms |
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: update env var table for OTEL_EXPORTER_OTLP_* Datadog config"
```

---

### Task 11: Full-repo verification

**Files:** none (verification only)

- [ ] **Step 1: Confirm no remaining source references to the old env vars**

Run: `grep -rn "DD_API_KEY\|DD_SITE" apps/auth-server/src apps/admin --include="*.ts" --include="*.tsx"`
Expected: no matches. (`apps/resource-server-fastapi` still uses them — out of scope, expected to still match if included, so don't grep that path.)

- [ ] **Step 2: Run the full workspace build and test pipeline**

Run: `pnpm build && pnpm test`
Expected: `packages/telemetry` builds and its tests pass; `auth-server` and `admin` build and their tests pass; no other package is affected.

- [ ] **Step 3: Manually verify Render/production env vars are updated**

This step is a **deployment action, not a code change** — flag it to the user rather than doing it. Render's `DD_API_KEY`/`DD_SITE` values for the `auth-server` and `admin` services (set as dashboard secrets, not in `render.yaml`) need to be replaced with `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_EXPORTER_OTLP_LOGS_PROTOCOL`, and (for auth-server) `OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE` before or at deploy time. Per this plan's error-handling design, deploying without doing this first just silently disables telemetry (`isDatadogOtlpEnabled()` returns false) — it does not break the app.

---

## Summary of new/changed files

| File | Change |
|---|---|
| `packages/telemetry/package.json`, `tsconfig.json` | new |
| `packages/telemetry/src/{headers,sentry-log-exporter,server,proxy,client}.ts` + `.spec.ts` | new |
| `apps/auth-server/src/telemetry/{otel,sentry-log-exporter}.ts` + specs | deleted |
| `apps/auth-server/src/instrument.ts` | rewritten |
| `apps/auth-server/test/otel-thin-slice.e2e-spec.ts` | env var references updated |
| `apps/auth-server/package.json` | deps updated |
| `apps/admin/sentry.server.config.ts` | rewritten |
| `apps/admin/app/api/otel/[...path]/route.ts` | new |
| `apps/admin/app/global-error.tsx` | OTel capture added |
| `apps/admin/app/__tests__/global-error.test.tsx` | new |
| `apps/admin/package.json` | deps updated |
| `README.md` | env var table updated |
