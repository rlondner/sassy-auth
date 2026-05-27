# Observability Design: Structured Logging & Error Tracking

**Date**: 2026-05-27
**Status**: Approved
**Scope**: NestJS auth server + Next.js admin console

## Goals

1. **Structured logging** — JSON logs to stdout for PaaS collection, with trace/request ID correlation
2. **Error tracking** — Sentry captures unhandled exceptions with full context in both backend and frontend
3. **Vendor flexibility** — Sentry's built-in OpenTelemetry foundation allows provider swaps without rewriting instrumentation

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Logging library | Winston | Feature-rich, widely used, JSON-native output |
| Error tracking | Sentry | Best JS/Node/React SDKs, generous free tier, OTel built-in |
| OTel strategy | Via Sentry SDK | Sentry Node SDK auto-instruments via OTel — no separate collector needed |
| Log transport | stdout (prod), stdout + files (dev) | PaaS collects stdout natively; local files enable offline review |
| Frontend observability | Errors + breadcrumbs | No performance monitoring — just error capture and admin action breadcrumbs |

## Architecture Overview

```
                         PaaS Log Collector
                               ^
                               | stdout (JSON)
                               |
  +----------------------------+----------------------------+
  |                    Auth Server (NestJS)                  |
  |                                                         |
  |  instrument.ts (Sentry.init + OTel)                     |
  |       |                                                 |
  |  main.ts                                                |
  |       |                                                 |
  |  RequestId Middleware --> Winston Logger --> stdout      |
  |       |                                                 |
  |  SentryGlobalFilter --> Sentry (errors + traces)        |
  |       |                                                 |
  |  Controllers/Services (auth events logged)              |
  +----------------------------+----------------------------+
                               |
                         sentry-trace header
                               |
  +----------------------------+----------------------------+
  |                 Admin Console (Next.js)                  |
  |                                                         |
  |  sentry.client.config.ts   sentry.server.config.ts      |
  |       |                         |                       |
  |  React Error Boundaries    Server Action errors         |
  |       |                         |                       |
  |  Breadcrumbs (admin actions)    |                       |
  |       +-------------------------+                       |
  |                    |                                    |
  |               Sentry (errors)                           |
  +--------------------------------------------------------+
```

## Backend: Winston Logging

### Configuration

- **Location**: `src/common/logger/`
- **Files**:
  - `winston.config.ts` — Winston transport and format config
  - `logger.service.ts` — NestJS `LoggerService` adapter wrapping Winston
  - `request-logging.middleware.ts` — HTTP request/response logger

### Log Format

**Production** (JSON to stdout):
```json
{
  "timestamp": "2026-05-27T12:00:00.000Z",
  "level": "info",
  "context": "TokenService",
  "message": "JWT issued",
  "traceId": "abc123",
  "requestId": "req-uuid-456",
  "userId": "sqid-user",
  "appId": "sqid-app"
}
```

**Development** (pretty-print to console + file):
```
[12:00:00] INFO [TokenService] JWT issued | traceId=abc123 requestId=req-uuid-456
```

### Development File Transports

In development (`NODE_ENV !== 'production'`), Winston additionally writes logs to local files for offline review and search:

- `logs/combined.log` — All log entries (JSON format, same schema as production)
- `logs/error.log` — Error-level entries only (JSON format)

The `logs/` directory is `.gitignore`d. Files are rotated or truncated on app restart to avoid unbounded growth. Console pretty-print output remains active alongside file transports.

Sentry traces in dev are also written to local files when `SENTRY_DSN` is not set:
- `logs/traces.log` — OTel span data exported via a file exporter, one JSON object per span

This allows developers to inspect full request traces without needing a Sentry account during local development.

### Log Levels

Controlled by `LOG_LEVEL` env var:
- `error` — Exceptions, unrecoverable failures
- `warn` — Degraded behavior, deprecated usage
- `info` — Key business events (default in prod)
- `debug` — Detailed flow tracing (default in dev)

### Request Logging Middleware

Applied globally. Logs at `info` level:
- Method, path, status code, response time (ms)
- User ID (if authenticated)
- Errors promoted to `error` level with stack trace

### Auth Events to Log

| Event | Level | Key Fields |
|---|---|---|
| Login attempt (success) | `info` | identifier type, appId, userId |
| Login attempt (failure) | `warn` | identifier type, appId, reason |
| OAuth code issued | `info` | appId, userId |
| OAuth code exchanged | `info` | appId, userId |
| JWT generated | `info` | appId, userId, org |
| Token validation failure | `warn` | reason, token hint |
| User created | `info` | userId, orgId, invitedBy |
| User updated | `info` | userId, changed fields |
| User deleted | `info` | userId, deletedBy |
| Role assigned/removed | `info` | userId, roleId, action |
| Permission granted/revoked | `info` | userId, permissionId, action |
| Invitation sent | `info` | email, orgId, invitedBy |
| Invitation accepted | `info` | userId, token |
| Permission check denied | `warn` | userId, permission, resource |

### Sensitive Data Policy

Never log:
- Passwords or password hashes
- Full JWT tokens (log last 8 chars only)
- RSA private keys
- Session tokens or authorization codes
- Full email addresses in debug logs (mask as `r***@example.com` at debug level; full email at info level for auth events is acceptable)

## Backend: Sentry + OpenTelemetry

### Initialization

`instrument.ts` — loaded before anything else via `--require` or top-of-file import in `main.ts`:

```typescript
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
  integrations: [
    Sentry.prismaIntegration(),
  ],
});
```

When `SENTRY_DSN` is not set, Sentry SDK is inert — no errors, no overhead.

### Error Handling

`SentryGlobalFilter` replaces the existing `HttpExceptionFilter`:
- Catches all unhandled exceptions
- Reports to Sentry with request context
- Returns the same standardized JSON response format (statusCode, message, error, path, timestamp)
- `HttpException` with 4xx status: captured but not sent to Sentry (expected client errors)
- `HttpException` with 5xx status + all non-HttpException errors: sent to Sentry

### Auto-Instrumented Spans (via OTel)

- Incoming HTTP requests
- Prisma database queries
- Outgoing HTTP requests (if any)

### Custom Context

- `Sentry.setUser({ id, email })` after authentication resolves
- `Sentry.setTag('appId', appId)` on token/OAuth flows
- `Sentry.setTag('authFlow', 'oauth' | 'direct')` on login paths
- `Sentry.setTag('orgId', orgId)` when org context is known

### Winston-Sentry Correlation

Winston error-level logs include `sentryEventId: Sentry.lastEventId()` when available, enabling cross-reference between PaaS logs and Sentry dashboard.

## Frontend: Sentry (Next.js Admin Console)

### Setup Files

Per Sentry Next.js SDK convention:
- `sentry.client.config.ts` — Browser SDK initialization
- `sentry.server.config.ts` — Server-side SDK initialization (Server Components, Server Actions)
- `sentry.edge.config.ts` — Edge runtime initialization (middleware)
- `next.config.js` — Wrapped with `withSentryConfig()` for automatic source map uploads
- `instrumentation.ts` — Next.js instrumentation hook to load Sentry server config

### Error Boundaries

- `app/global-error.tsx` — Root layout error boundary, reports to Sentry
- `app/(admin)/error.tsx` — Admin route group error boundary

Both display a user-friendly error message with a "Try again" button.

### Admin Action Breadcrumbs

Key admin actions recorded as Sentry breadcrumbs (appear in error event timeline):

| Action | Category | Where |
|---|---|---|
| User created | `admin.action` | `createUserAction` Server Action |
| User updated | `admin.action` | User edit handlers |
| User deleted | `admin.action` | Delete confirmation handler |
| Role assigned/removed | `admin.action` | Role management handlers |
| Invitation sent/resent | `admin.action` | Invitation handlers |
| Login | `auth` | Login Server Action |
| Logout | `auth` | Logout handler |
| Locale switched | `ui` | Locale switcher |

Implementation: `Sentry.addBreadcrumb({ category, message, level: 'info' })` calls in existing Server Actions and event handlers.

### Context Enrichment

- `Sentry.setUser({ id, email })` after session validation
- `Sentry.setTag('locale', currentLocale)` on page load

### Configuration

```typescript
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
});
```

## Trace Correlation

### Frontend-to-Backend

Sentry auto-injects `sentry-trace` and `baggage` headers on fetch requests. The admin console's `lib/api.ts` wrapper uses `fetch()` which Sentry's browser SDK patches — trace propagation is automatic.

### Request ID

- `RequestIdMiddleware` in the auth server generates a UUID per request (or reads `X-Request-Id` from incoming headers)
- Attached to Winston log context and Sentry scope
- Returned in API response as `X-Request-Id` header
- Enables: "user reports issue -> grab request ID from response -> search logs"

### Cross-Reference Flow

1. Error occurs in auth server
2. Sentry captures it with `traceId` and `requestId`
3. Winston logs the same `traceId` and `requestId` to stdout
4. PaaS log viewer: search by either ID to find full request story
5. Sentry dashboard: see the trace timeline with Prisma spans, HTTP spans

## Environment Variables

| Variable | App | Required | Default |
|---|---|---|---|
| `SENTRY_DSN` | auth-server | Prod only | — (SDK inert if missing) |
| `SENTRY_ENVIRONMENT` | auth-server | No | `NODE_ENV` |
| `LOG_LEVEL` | auth-server | No | `info` (prod) / `debug` (dev) |
| `NEXT_PUBLIC_SENTRY_DSN` | admin | Prod only | — (SDK inert if missing) |
| `SENTRY_AUTH_TOKEN` | admin (build) | Prod only | — (no source maps if missing) |

## New Dependencies

### auth-server
- `winston` — Structured logging
- `@sentry/nestjs` — Sentry SDK with NestJS + OTel integration
- `@sentry/profiling-node` — Optional, for Sentry profiling (not required)

### admin
- `@sentry/nextjs` — Sentry SDK with Next.js App Router support

## File Structure (New Files)

### auth-server
```
src/
  instrument.ts                          # Sentry init (imported first)
  common/
    logger/
      winston.config.ts                  # Winston transports + formats
      logger.service.ts                  # NestJS LoggerService adapter
      request-logging.middleware.ts      # HTTP request/response logger
    filters/
      sentry-exception.filter.ts        # Replaces http-exception.filter.ts
    middleware/
      request-id.middleware.ts           # X-Request-Id generation
logs/                                    # Dev only, .gitignore'd
  combined.log                           # All log entries (JSON)
  error.log                              # Error-level only (JSON)
  traces.log                             # OTel spans (JSON, when no SENTRY_DSN)
```

### admin
```
sentry.client.config.ts
sentry.server.config.ts
sentry.edge.config.ts
instrumentation.ts
app/
  global-error.tsx
  (admin)/
    error.tsx
```

## Out of Scope

- **Metrics / dashboards** — No Prometheus/Grafana. Sentry's built-in performance views suffice for now.
- **Log aggregation service** — PaaS stdout collection is sufficient. No ELK/Loki.
- **Frontend performance monitoring** — No Web Vitals tracking. Error tracking + breadcrumbs only.
- **Alerting rules** — Configured in Sentry UI, not in code.
- **Uptime monitoring** — Separate concern.
