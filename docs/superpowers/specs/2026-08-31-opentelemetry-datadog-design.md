# OpenTelemetry + Datadog Observability — Design

**Date:** 2026-08-31
**Status:** Approved for planning
**Precedent:** `~/github/content-social-automation`'s
`docs/superpowers/specs/2026-08-08-observability-opentelemetry-design.md` — same
two-backend transport shape (direct OTLP to Datadog, Sentry native SDK, no
Collector), adapted to sassy-auth's three services and existing partial OTel
wiring.

---

## Goal

Instrument `admin`, `auth-server`, and `resource-server-fastapi` with OpenTelemetry
traces, metrics, and logs, exporting to Datadog and Sentry, so that in production we
can answer both "is auth broken right now" and "is social sign-in healthy" —
neither goal takes priority over the other.

## Starting position

`auth-server` already carries `@opentelemetry/api` and `@opentelemetry/api-logs` as
dependencies, and one call site — `apps/auth-server/src/social/record-federation-event.ts`
— emits federation events (`social.link.created`, `social.signin.ok`,
`social.signin.rejected`, `social.link.removed`) through the OTel Logs API:
`logs.getLogger('sassy-auth.social').emit(...)`.

This is a **documented no-op today**. `@opentelemetry/sdk-logs` is not installed
anywhere in the tree and nothing calls `logs.setGlobalLoggerProvider(...)`, so per
the OTel spec these emissions currently go nowhere. The workaround that was shipped
instead — `apps/auth-server/src/social/telemetry-sentry-adapter.ts` — bypasses OTel
logs entirely and calls `Sentry.logger.*` directly, gated by `enableLogs: true` in
`apps/auth-server/src/instrument.ts`. Its own comment block documents exactly why:
`@sentry/opentelemetry` bridges OTel *spans* into Sentry, never OTel *logs*.

This design makes `record-federation-event.ts`'s existing `defaultEmit()` real,
rather than adding a second parallel logging path next to it.

`admin` already depends on `@sentry/nextjs`. `resource-server-fastapi` has no
telemetry today — `sentry-sdk` and the OTel Python packages are new dependencies
there.

---

## Transport

One OTel SDK per service, three providers (`TracerProvider`, `MeterProvider`,
`LoggerProvider`) sharing one `Resource`. Two destinations:

- **Datadog — agentless OTLP.** `/v1/traces`, `/v1/metrics`, `/v1/logs` with a
  `dd-api-key` header. No local Datadog Agent, no Collector.
- **Sentry — native SDK.** `@sentry/nestjs` (auth-server), `@sentry/nextjs` (admin),
  `sentry-sdk` (resource-server-fastapi) — giving trace-connected errors natively.

Every exporter is **gated on an env var and silently no-ops when unset**. Set
`DD_API_KEY`, `SENTRY_DSN*`, both, or neither — application code never changes.

Configuration uses the standard OpenTelemetry variables, including per-signal
overrides (`OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`, `..._METRICS_ENDPOINT`,
`..._LOGS_ENDPOINT`), so an OTel Collector or any other OTLP-speaking backend
remains a config-only addition later, not a rewrite.

**Telemetry must never break the app.** Exporter failures are caught and dropped. A
Datadog or Sentry outage must not fail a sign-in or a token check.

### Why not a Collector, why not `dd-trace`

Considered and rejected, same reasoning content-social-automation already worked
through:

- **OTel Collector as the hub** — solves "the backend might change," which doesn't
  apply once Datadog and Sentry are both chosen. Extra deployed component for no
  present benefit; the standard env vars keep this reversible without one.
- **`dd-trace` (Datadog's own SDK) instead of OTel** — simpler for Datadog alone,
  but throws away vendor neutrality, which is the explicit point of this design.
  Re-instrumenting later to add a second backend is exactly the trap
  `telemetry-sentry-adapter.ts`'s comment block describes almost happening once
  already.

---

## The Sentry-logs gap, resolved

Deleting `telemetry-sentry-adapter.ts` outright, with nothing in its place, would
silently stop federation events from reaching Sentry — its diagnosis that
`@sentry/opentelemetry` never touches OTel logs is correct and remains true after
this design lands.

The resolution: write one small, reusable **`SentryLogRecordExporter`** — a
standard OTel `LogRecordExporter` (the same interface the Datadog OTLP log exporter
implements) — and register it as a processor on every service's `LoggerProvider`
alongside the Datadog exporter. This is infrastructure, not a one-off shim: any
future call site that emits through `logs.getLogger(...).emit(...)` gets Sentry
delivery for free, the same way it gets Datadog delivery for free.

`record-federation-event.ts` requires **no code change** — its `defaultEmit()` path
starts working the moment a real `LoggerProvider` exists. The single-purpose,
single-call-site `telemetry-sentry-adapter.ts` and its import in `instrument.ts` are
deleted.

---

## Services & the thin slice

| `service.name` | Runtime |
|---|---|
| `sassy-auth-admin` | Next.js |
| `sassy-auth-auth-server` | NestJS |
| `sassy-auth-resource-server` | FastAPI |

All three are long-lived HTTP services — unlike content-social-automation's
short-lived worker subprocess, there is no process-boundary/env-var trace
propagation to design here, only standard HTTP `traceparent` propagation at each
hop via auto-instrumentation.

**First trace that must appear intact and joined in both Datadog and Sentry before
anything else is built:**

| # | Span | Service | Source |
|---|---|---|---|
| 1 | admin login form submit → outbound fetch | admin | auto |
| 2 | `POST /api/auth/sign-in` HTTP server span | auth-server | auto |
| 3 | `auth.signin` — outcome, method=password | auth-server | manual |
| 4 | `auth.token.issue` — kid, ttl | auth-server | manual |
| 5 | outbound call to resource server | admin or auth-server (whichever issues it) | auto |
| 6 | HTTP server span | resource-server-fastapi | auto |
| 7 | `auth.token.verify` — outcome, kid | resource-server-fastapi | manual |

The password sign-in path is chosen over the social sign-in path deliberately: no
external OAuth provider dependency, so it is reliable to exercise repeatedly while
proving propagation. Social federation gets its own manual span
(`auth.social.federation`, wrapping the existing `recordFederationEvent` fan-out)
covered by the general instrumentation below, but is not the thin slice.

---

## Where instrumentation goes

| Location | Emits |
|---|---|
| Auto-instrumentation (HTTP, Express/Nest, Prisma, FastAPI, httpx) | Standard `http.*`, DB spans — not hand-written |
| `auth-server` sign-in handler | `auth.signin` span, sign-in outcome counter |
| `auth-server` token issuance | `auth.token.issue` span |
| `resource-server-fastapi` JWT verification middleware | `auth.token.verify` span, verification outcome counter |
| `record-federation-event.ts` | Already emits through the OTel Logs API — becomes live, no code change |
| Social federation call sites | `auth.social.federation` span wrapping `recordFederationEvent`, outcome counter by provider (reusing `social.link.created` / `social.signin.ok` / `social.signin.rejected` / `social.link.removed`) |
| 2FA challenge handling | Challenge outcome counter |
| Self-serve registration (`POST /api/register`) | Rate-limit-hit counter |

**Deliberately not instrumented:** sqid encoding/decoding, JWKS key selection —
fast, deterministic, already unit-tested; spans there are noise.

---

## Metrics

| Instrument | Type | Attributes |
|---|---|---|
| `auth.signin.count` | counter | `method` (password/social), `outcome` |
| `auth.token.issue.duration` | histogram | `outcome` |
| `auth.token.verify.count` | counter | `outcome` |
| `auth.social.federation.count` | counter | `provider`, `event_type`, `outcome` |
| `auth.2fa.challenge.count` | counter | `outcome` |
| `auth.register.rate_limited` | counter | (no attributes beyond service) |

HTTP request rate, duration, and error rate come from auto-instrumentation under
standard `http.*` semconv and are not hand-rolled.

### Cardinality

`saUserId`/`saUserPublicId`, `appPublicId`, `providerSub`, IPs, and user agents are
**span and log attributes only, never metric labels** — unbounded, and Datadog
bills custom metrics by tag combination. Every metric label above is bounded:
provider name (4-5 values), outcome (small enum), sign-in method (2 values).

---

## Redaction and secrets

`FederationEvent`'s existing discipline — `email` and `providerSub` marked
"persisted only, never emitted to telemetry" — is kept and extended. No span, log,
or metric attribute may ever carry: a password, session cookie, JWT contents beyond
`kid`, `RSA_PRIVATE_KEY`, `BETTER_AUTH_SECRET`, `APPLE_PRIVATE_KEY`, or any OAuth
client secret. HTTP header capture stays off in auto-instrumentation config.

A test asserts no span attribute value contains any configured secret — same
pattern as content-social-automation's design.

---

## Configuration

Standard variables, all optional:

| Variable | Purpose |
|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` + per-signal overrides | OTLP destination |
| `OTEL_EXPORTER_OTLP_HEADERS` | `dd-api-key=…` for agentless Datadog |
| `OTEL_SERVICE_NAME` | Per service |
| `OTEL_SDK_DISABLED` | Kill switch; `true` in tests |
| `DD_API_KEY`, `DD_SITE` | Enables the Datadog path |
| `SENTRY_DSN` (auth-server), `NEXT_PUBLIC_SENTRY_DSN` (admin), new `SENTRY_DSN_RESOURCE_SERVER` | Per-service Sentry projects — extends the existing `.env.example` observability block |

Unset means that exporter no-ops. All documented in `.env.example`.

---

## Testing

Using `InMemorySpanExporter` and an in-memory metric reader:

- the resource-server-fastapi span (`auth.token.verify`) is a **child of**
  auth-server's span when `traceparent` propagates over HTTP — the central claim
  of the whole design
- `SentryLogRecordExporter` correctly forwards a log record's severity, body, and
  attributes
- `record-federation-event.ts`'s existing tests still pass with `defaultEmit()`
  live instead of no-op
- no span, log, or metric attribute value contains any configured secret
- exporters no-op cleanly when `DD_API_KEY` and `SENTRY_DSN*` are unset, and a
  failing exporter does not fail a sign-in or a verification
- `OTEL_SDK_DISABLED=true` in Jest and pytest config, so existing suites neither
  slow down nor export

**One opt-in end-to-end check**, skipped unless real credentials are present: run
the thin slice and assert the trace arrives in Sentry and Datadog with all seven
spans joined.

---

## Out of scope

- Dashboards, monitors, alert rules, SLO definitions
- Browser RUM and web vitals in admin — only trace context propagation from `fetch`
- Running an OTel Collector — standard env vars keep it a config-only addition later
- Changing admin's existing Sentry error-reporting setup beyond adding OTel
  alongside it
- Instrumenting the seed scripts or migration tooling
