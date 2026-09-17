# Shared OTel/Datadog Telemetry Package

**Date:** 2026-09-16
**Apps:** `apps/auth-server` (NestJS), `apps/admin` (Next.js), new `packages/telemetry`
**Status:** Approved for implementation

---

## Goal

Replace the hand-rolled, duplicated Datadog OTLP wiring in `auth-server` and `admin`
(`DD_API_KEY`/`DD_SITE` + a manually-built `otlp-http-intake.logs.<site>` URL, copy-pasted
between the two apps) with:

1. The standard `OTEL_EXPORTER_OTLP_*` env-var convention, which the OpenTelemetry JS SDK
   reads natively — no more hand-built exporter URLs, and delta-temporality metrics (required
   by Datadog's OTLP intake for Sums/Histograms) come from an env var instead of custom code.
2. A new shared `packages/telemetry` workspace package so the exporter-building logic exists
   once instead of three times (auth-server, admin server, admin browser).
3. Browser-side OpenTelemetry for `admin`, which has none today: a same-origin proxy route
   (so the Datadog API key never reaches the browser bundle, following the pattern established
   in content-social-automation's `apps/landing`) plus a client-side error-capture helper.

---

## Architecture Overview

```
packages/telemetry/                    (new workspace package, @sassy-auth/telemetry)
  src/
    server.ts        — isDatadogOtlpEnabled(), buildDatadogSpanProcessors(),
                        setupOtelMetrics(), setupOtelLogging()
    sentry-log-exporter.ts — moved from apps/auth-server (Sentry log bridge)
    proxy.ts          — createOtelProxyHandler(): Next.js Route Handler factory
    client.ts         — initOtelClient(), captureClientError()

apps/auth-server/      — imports server.ts (traces, metrics, logs)
apps/admin/
  sentry.server.config.ts   — imports server.ts (traces, logs)
  app/api/otel/[...path]/route.ts — imports proxy.ts
  instrumentation-client.ts (or root layout) — imports client.ts
```

```
Browser (admin)
  │  captureClientError() on thrown/boundary errors
  │  OTLP/HTTP traces (no auth header from browser)
  ▼
/api/otel/v1/traces  (Next.js Route Handler, apps/admin)
  │  injects OTEL_EXPORTER_OTLP_HEADERS (dd-api-key) server-side
  ▼
OTEL_EXPORTER_OTLP_ENDPOINT (https://otlp.datadoghq.com)
  │
  ├─ auth-server ──────────► traces, metrics (delta), logs
  └─ admin (server) ───────► traces, logs
```

The proxy route is the only place in `admin`'s browser-reachable code path where the Datadog
API key exists server-side to inject; the client bundle never sees it.

---

## Components

### 1. `packages/telemetry/src/server.ts`

```ts
export function isDatadogOtlpEnabled(): boolean {
  return process.env.OTEL_SDK_DISABLED !== 'true' && !!process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
}

export function buildDatadogSpanProcessors(): SpanProcessor[] {
  if (!isDatadogOtlpEnabled()) return [];
  return [new BatchSpanProcessor(new OTLPTraceExporter())]; // reads OTEL_EXPORTER_OTLP_* itself
}

export function setupOtelMetrics(serviceName: string): { meter: Meter } {
  const resource = resourceFromAttributes({ [ATTR_SERVICE_NAME]: serviceName });
  const readers = isDatadogOtlpEnabled()
    ? [new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter() })]
    : [];
  const meterProvider = new MeterProvider({ resource, readers });
  metrics.setGlobalMeterProvider(meterProvider);
  return { meter: meterProvider.getMeter(serviceName) };
}

export function setupOtelLogging(serviceName: string): void {
  const resource = resourceFromAttributes({ [ATTR_SERVICE_NAME]: serviceName });
  const processors: LogRecordProcessor[] = [];
  if (isDatadogOtlpEnabled()) {
    processors.push(new BatchLogRecordProcessor({ exporter: new OTLPLogExporter() }));
  }
  if (process.env.SENTRY_DSN) {
    processors.push(new SimpleLogRecordProcessor({ exporter: new SentryLogRecordExporter() }));
  }
  logs.setGlobalLoggerProvider(new LoggerProvider({ resource, processors }));
}
```

`OTLPTraceExporter`, `OTLPMetricExporter`, and `OTLPLogExporter` are constructed with **no
explicit `url`/`headers`** — the installed SDK versions (`^0.222.0`, already in
`auth-server`'s `package.json`) read `OTEL_EXPORTER_OTLP_ENDPOINT` + `OTEL_EXPORTER_OTLP_HEADERS`
(with per-signal `OTEL_EXPORTER_OTLP_{TRACES,METRICS,LOGS}_ENDPOINT` overrides available but
unused here) and append `/v1/traces`, `/v1/metrics`, `/v1/logs` automatically. The metrics
exporter also reads `OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=delta` on its own — no
custom temporality selector code needed.

`SentryLogRecordExporter` moves from `apps/auth-server/src/telemetry/sentry-log-exporter.ts`
into `packages/telemetry/src/sentry-log-exporter.ts` unchanged, so `admin` (which also has a
`SENTRY_DSN`) gets the same log correlation for free by calling `setupOtelLogging`.

### 2. `packages/telemetry/src/proxy.ts` — Next.js proxy route factory

```ts
export function createOtelProxyHandler() {
  return async function POST(request: Request, { params }: { params: { path: string[] } }) {
    const signalPath = params.path.join('/'); // e.g. "v1/traces"
    if (signalPath !== 'v1/traces') return new Response(null, { status: 404 });

    const origin = request.headers.get('origin');
    const url = new URL(request.url);
    if (origin !== null && origin !== url.origin) return new Response(null, { status: 403 });

    const contentLength = Number(request.headers.get('content-length') ?? '0');
    if (contentLength > MAX_BODY_BYTES) return new Response(null, { status: 413 });

    if (!isDatadogOtlpEnabled()) return new Response(null, { status: 500 });

    const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const headers = parseOtlpHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS); // "k=v,k2=v2" -> object
    const body = await request.arrayBuffer();

    const upstream = await fetch(`${endpoint}/${signalPath}`, {
      method: 'POST',
      headers: { 'content-type': request.headers.get('content-type') ?? 'application/x-protobuf', ...headers },
      body,
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
    });
  };
}
```

Adapted from content-social-automation's `apps/landing/src/lib/otel-proxy.server.ts` (same
signal allowlist, same-origin check, body-size cap) to Next.js's Route Handler signature. Only
`v1/traces` is allowlisted, since this round only wires up client-side error spans (no browser
metrics/logs).

Dropped in at `apps/admin/app/api/otel/[...path]/route.ts`:
```ts
export const POST = createOtelProxyHandler();
```

### 3. `packages/telemetry/src/client.ts` — browser bootstrap + error capture

```ts
let initialized = false;
let tracer: Tracer | undefined;

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
      spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter({ url: '/api/otel/v1/traces' }))],
    });
    provider.register();
    tracer = trace.getTracer(serviceName);
  } catch (error) {
    console.error('[otel] Failed to initialize OpenTelemetry Web SDK:', error);
  }
}

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

Wiring in `apps/admin`:
- `instrumentation-client.ts` calls `initOtelClient('sassy-auth-admin')` once on module load.
- `app/global-error.tsx` (and any route-level `error.tsx` boundaries) call
  `captureClientError(error, { route: usePathname() })` alongside existing Sentry reporting —
  this is additive to Sentry, not a replacement; Sentry stays the alerting/triage surface, OTel
  spans give Datadog-side trace correlation with the originating server request.
- Failed-`fetch` catch blocks in admin's client actions (e.g. around the existing manual API
  calls) also call `captureClientError` so network failures aren't only surfaced as a toast.

Automatic `fetch`/XHR instrumentation (auto-propagating `traceparent` on every request) is
explicitly **out of scope** for this round — only the explicit `captureClientError` call sites
are covered.

---

## Environment Variables

Applies to both `apps/auth-server/.env.example` and `apps/admin/.env.example`, replacing
`DD_API_KEY` / `DD_SITE`:

| Variable | Purpose | Notes |
|---|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Base Datadog OTLP URL | `https://otlp.datadoghq.com`; presence gates whether telemetry is enabled at all (`isDatadogOtlpEnabled()`) |
| `OTEL_EXPORTER_OTLP_HEADERS` | Auth | `dd-api-key=...` — server-only; for `admin` this must be a server-side env var, never `NEXT_PUBLIC_*` |
| `OTEL_EXPORTER_OTLP_LOGS_PROTOCOL` | Log export protocol | `http/protobuf` |
| `OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE` | Metrics temporality | `delta` — Datadog's OTLP intake silently drops cumulative Sums/Histograms; Gauges are accepted either way |
| `OTEL_SERVICE_NAME` | Per-app override | `sassy-auth-auth-server` / `sassy-auth-admin` (existing pattern, kept) |
| `OTEL_SDK_DISABLED` | Kill switch | Existing, kept as-is |

---

## Error Handling

| Failure | Behavior |
|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` unset | `isDatadogOtlpEnabled()` returns false; all processors/exporters/metrics readers are empty arrays — zero overhead, zero network calls |
| Datadog OTLP endpoint unreachable | Batch exporters drop silently (fire-and-forget); no impact to request handling |
| Proxy route: `OTEL_EXPORTER_OTLP_ENDPOINT`/`HEADERS` missing server-side | Returns `500`; browser SDK retries per its own backoff then drops |
| Proxy route: cross-origin POST | `403` |
| Proxy route: oversized body (`content-length` > `MAX_BODY_BYTES`) | `413` |
| Proxy route: unknown signal path | `404` (only `v1/traces` allowlisted) |
| `captureClientError` called before `initOtelClient` | No-ops (`if (!tracer) return`) |

---

## Testing Strategy

- **`packages/telemetry` unit tests:**
  - `isDatadogOtlpEnabled` across the env-var presence matrix (unset endpoint, `OTEL_SDK_DISABLED=true`, both set)
  - `buildDatadogSpanProcessors` / `setupOtelMetrics` / `setupOtelLogging` — empty-array/no-op path vs. enabled path (mock exporter constructors), and the `SENTRY_DSN` branch for the log bridge
  - `createOtelProxyHandler` — mock global `fetch`; assert header injection, `403`/`413`/`404`/`500` paths (ported from content-social-automation's `otel-proxy.server.test.ts`)
  - `captureClientError` — mock tracer; assert span name, `error.type`/`error.message` attributes, `recordException` call, and the pre-init no-op
- **`apps/auth-server`, `apps/admin` unit tests:** update existing `otel.spec.ts` / `actions-otel.test.ts` to assert each app's thin wrapper calls into `@sassy-auth/telemetry` with the correct service name, rather than re-testing exporter internals locally.
- **Manual:** DevTools Network tab shows an OTLP POST to `/api/otel/v1/traces` when a client error is thrown in admin; Datadog APM shows the resulting trace linked by trace ID to the corresponding server-side span (verify manually once, since automatic fetch instrumentation — which would make this automatic — is out of scope).

---

## Implementation Notes

- `packages/telemetry` needs both Node-only (`server.ts`, `proxy.ts`) and browser-only
  (`client.ts`) entry points; split as separate package exports (e.g.
  `@sassy-auth/telemetry/server`, `@sassy-auth/telemetry/client`) so `admin`'s client bundle
  doesn't accidentally pull in Node-only OTel SDK packages (`sdk-metrics`, `sdk-logs`,
  `exporter-metrics-otlp-http`, `exporter-logs-otlp-http`) it doesn't need.
- `admin` needs new dependencies it doesn't currently have: `@opentelemetry/sdk-trace-web`,
  `@opentelemetry/resources`, `@opentelemetry/semantic-conventions` (it already has
  `@opentelemetry/api`, `@opentelemetry/exporter-trace-otlp-http`, `@opentelemetry/sdk-trace-base`).
- `OTEL_EXPORTER_OTLP_HEADERS` parsing (`"k1=v1,k2=v2"` → object) is not built into the OTLP
  exporter constructors when used from a hand-rolled proxy body — `proxy.ts` needs its own small
  parser (the exporters parse this format internally for their own use, but the proxy route
  needs the header object explicitly to attach to its outbound `fetch`).
- `apps/resource-server-fastapi` (Python, also on `DD_API_KEY`/`DD_SITE` today) is **out of
  scope** for this round per explicit scoping decision — only `auth-server` and `admin` are
  covered.
- Verify `@opentelemetry/exporter-metrics-otlp-http@^0.222.0` actually auto-reads
  `OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE` before removing the old manual config —
  expected based on SDK version, but confirm against the installed exporter's behavior (e.g. a
  quick integration test asserting delta vs. cumulative `AggregationTemporality` on exported
  metrics) during implementation.
