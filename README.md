# SassyAuth

A multitenant authentication and authorization server with an admin console. Resource servers delegate all login, session, and token concerns to SassyAuth and verify the resulting RS256 JWTs independently.

Built as a Turborepo + pnpm monorepo. Two apps: `auth-server` (NestJS, port 3000) and `admin` (Next.js, port 3001). Three shared packages: `db` (Prisma), `types`, and `ui` (Tailwind + Radix design system).

---

## Table of Contents

- [SassyAuth](#sassyauth)
  - [Table of Contents](#table-of-contents)
  - [Prerequisites](#prerequisites)
  - [Project Structure](#project-structure)
  - [Getting Started](#getting-started)
    - [1. Clone and install dependencies](#1-clone-and-install-dependencies)
    - [2. Configure environment variables](#2-configure-environment-variables)
    - [3. Set up the database](#3-set-up-the-database)
    - [4. Generate the Prisma client](#4-generate-the-prisma-client)
    - [5. Seed platform data](#5-seed-platform-data)
    - [6. Start the development servers](#6-start-the-development-servers)
  - [RSA Key Pair Generation](#rsa-key-pair-generation)
  - [Environment Variables](#environment-variables)
    - [Required](#required)
    - [Admin console](#admin-console)
    - [Observability (optional)](#observability-optional)
    - [Social providers (optional)](#social-providers-optional)
  - [Auth Flows](#auth-flows)
    - [Flow A: OAuth2 Authorization Code](#flow-a-oauth2-authorization-code)
    - [Flow B: Direct Login](#flow-b-direct-login)
    - [Flow C: Invite + Accept](#flow-c-invite--accept)
  - [JWKS and Token Verification](#jwks-and-token-verification)
  - [API Reference](#api-reference)
  - [Admin Console](#admin-console-1)
  - [Observability](#observability)
  - [Running Tests](#running-tests)
    - [Unit tests](#unit-tests)
    - [E2E tests](#e2e-tests)
  - [Known Limitations](#known-limitations)

---

## Prerequisites

- Node.js >= 20
- pnpm >= 9
- PostgreSQL 14+

---

## Project Structure

```
sassy-auth/
  apps/
    auth-server/             # NestJS (Express adapter) — main API (port 3000)
      src/
        auth/                # BetterAuth integration and guard
        token/               # JWT issuance: OAuth2 and direct login flows
        users/               # Users CRUD + role assignment
        invitations/         # Invitation issue / validate / accept
        orgs/                # Org CRUD
        roles/               # Role CRUD + permission assignment
        common/
          permissions/       # checkPermission helper
          middleware/        # RequestIdMiddleware
          logger/            # Winston + RequestLoggingMiddleware
          filters/           # SentryExceptionFilter, HttpExceptionFilter
          sqid/              # Sqid encoder service
        seed/                # Platform bootstrap script
        instrument.ts        # Sentry init (loaded BEFORE Nest bootstrap)
      test/                  # E2E tests
    admin/                   # Next.js 15 admin console (port 3001)
      app/
        login/               # /login page + Server Action
        accept-invite/       # /accept-invite token landing
        (admin)/             # Authenticated route group: /users, ...
        global-error.tsx     # Top-level error boundary (Sentry)
      components/            # admin-shell, user-create-drawer, ...
      lib/                   # api.ts (session-forwarding fetch wrappers)
      messages/              # i18n: en.json, fr.json
      sentry.{client,server,edge}.config.ts
      instrumentation.ts
      middleware.ts          # Edge auth gate
  packages/
    db/                      # Prisma schema, PrismaClient singleton, migrations
    types/                   # Shared TypeScript types (JWT payload, error codes, identifier detection)
    ui/                      # Shared design system: Button, Select, DataTable, Sheet, ...
  docs/                      # Design specs and plans
  designs/                   # Mockups
```

**Database tables:**

| Owner       | Tables                                                                                      |
|-------------|---------------------------------------------------------------------------------------------|
| BetterAuth  | `user`, `session`, `account`, `verification`                                                |
| SassyAuth   | `sa_app`, `sa_org`, `sa_user`, `sa_invitation`, `sa_permission`, `sa_role`, `sa_role_permission`, `sa_user_role`, `sa_user_permission` |

`sa_user` links to BetterAuth's `user` table via the `betterAuthUserId` foreign key.

All external-facing IDs are Sqids (encoded from auto-increment integers). Database PKs are never exposed.

---

## Getting Started

### 1. Clone and install dependencies

```bash
git clone https://github.com/rlondner/sassy-auth.git
cd sassy-auth
pnpm install
```

### 2. Configure environment variables

The repo uses a **single `.env.local` at the repo root** (loaded by `dotenv-cli` for the Prisma scripts and by Next.js automatically). The `.env.example` file at the root is the source of truth.

```bash
cp .env.example .env.local
```

At minimum, set:

- `DATABASE_URL`
- `RSA_PRIVATE_KEY`, `RSA_PUBLIC_KEY` (see [RSA Key Pair Generation](#rsa-key-pair-generation))
- `BETTER_AUTH_SECRET` (32+ random chars)
- `BETTER_AUTH_URL` (e.g. `http://localhost:3000`)
- `ADMIN_URL` (e.g. `http://localhost:3001`) — used to build invitation URLs sent by the API
- `AUTH_SERVER_URL` (e.g. `http://localhost:3000`) — used by the admin Server Actions

See [Environment Variables](#environment-variables) for the full list.

### 3. Set up the database

Run migrations to create all tables:

```bash
pnpm --filter @sassy-auth/db db:migrate
```

### 4. Generate the Prisma client

```bash
pnpm --filter @sassy-auth/db db:generate
```

### 5. Seed platform data

The seed script is idempotent — safe to run multiple times. It creates:

- The platform app (`isPlatform: true`, name "SassyAuth")
- The platform org (`isPlatform: true`, name "Platform")
- Platform permissions: `platform.orgs.manage`, `platform.apps.manage`, `platform.users.manage`, `platform.permissions.manage`, `org.users.manage`, `org.permissions.manage`

```bash
pnpm --filter @sassy-auth/db db:seed
```

### 6. Start the development servers

**All apps in parallel (recommended):**

```bash
pnpm dev          # turbo runs auth-server (3000) and admin (3001) together
```

**Or each app individually:**

```bash
pnpm --filter @sassy-auth/auth-server dev      # port 3000
pnpm --filter @sassy-auth/admin dev            # port 3001
```

Open `http://localhost:3001/login` to access the admin console.

---

## RSA Key Pair Generation

SassyAuth signs JWTs with RS256. Generate a 2048-bit RSA key pair and base64-encode both keys for use in the environment variables:

```bash
node -e "const c=require('crypto');const {privateKey,publicKey}=c.generateKeyPairSync('rsa',{modulusLength:2048});console.log('RSA_PRIVATE_KEY='+Buffer.from(privateKey.export({type:'pkcs8',format:'pem'})).toString('base64'));console.log('RSA_PUBLIC_KEY='+Buffer.from(publicKey.export({type:'spki',format:'pem'})).toString('base64'))"
```

Copy the two output lines directly into your `.env.local` file.

---

## Environment Variables

### Required

| Variable              | Description                                                    |
|-----------------------|----------------------------------------------------------------|
| `DATABASE_URL`        | PostgreSQL connection string                                   |
| `RSA_PRIVATE_KEY`     | Base64-encoded PKCS8 PEM private key (for signing JWTs)        |
| `RSA_PUBLIC_KEY`      | Base64-encoded SPKI PEM public key (served via JWKS endpoint)  |
| `BETTER_AUTH_SECRET`  | Random string, 32+ characters                                  |
| `BETTER_AUTH_URL`     | Base URL of the auth server, e.g. `http://localhost:3000`      |
| `TRUSTED_ORIGINS`     | Comma-separated list of origins allowed by BetterAuth CSRF. Default: `http://localhost:3001` |

### Admin console

| Variable              | Description                                                                                |
|-----------------------|--------------------------------------------------------------------------------------------|
| `ADMIN_URL`           | Public URL of the admin console, used by the API to build invitation links. Default: `http://localhost:3001` |
| `AUTH_SERVER_URL`     | Internal URL the admin uses to reach the auth server. Default: `http://localhost:3000`      |

### Observability (optional)

Leave blank to disable. See [Observability](#observability) for behavior.

| Variable                    | Side  | Description                                                          |
|-----------------------------|-------|----------------------------------------------------------------------|
| `SENTRY_DSN`                | auth  | Sentry DSN for `auth-server` (server-side)                           |
| `SENTRY_ENVIRONMENT`        | both  | Override environment name (defaults to `NODE_ENV`)                   |
| `LOG_LEVEL`                 | auth  | `debug` \| `info` \| `warn` \| `error` (default: debug in dev, info in prod) |
| `NEXT_PUBLIC_SENTRY_DSN`    | admin | Sentry DSN for the admin browser bundle                              |
| `SENTRY_AUTH_TOKEN`         | admin | Build-time auth token for source-map upload                          |
| `SENTRY_ORG`                | admin | Sentry organization slug (build-time only)                           |
| `SENTRY_PROJECT`            | admin | Sentry project slug (build-time only)                                |

### Social providers (optional)

Omit the client ID and secret for any provider you do not want to enable.

| Variable                     | Description                |
|------------------------------|----------------------------|
| `GOOGLE_CLIENT_ID`           | Google OAuth client ID     |
| `GOOGLE_CLIENT_SECRET`       | Google OAuth client secret |
| `MICROSOFT_CLIENT_ID`        | Microsoft OAuth client ID  |
| `MICROSOFT_CLIENT_SECRET`    | Microsoft OAuth client secret |
| `APPLE_CLIENT_ID`            | Apple OAuth client ID      |
| `APPLE_CLIENT_SECRET`        | Apple OAuth client secret  |
| `GITHUB_CLIENT_ID`           | GitHub OAuth client ID     |
| `GITHUB_CLIENT_SECRET`       | GitHub OAuth client secret |
| `SQIDS_ALPHABET`             | Custom alphabet for Sqids encoding; leave blank for default |

---

## Auth Flows

### Flow A: OAuth2 Authorization Code

Use this flow for third-party or external resource servers that redirect users to SassyAuth for login.

**Step 1 — Redirect the user to the authorization endpoint**

```
GET /api/token/oauth/authorize?client_id=<appPublicId>&redirect_uri=<uri>&state=<state>
```

The user authenticates using any method BetterAuth supports: email/password, magic link, email OTP, or a configured social provider (Google, Microsoft, Apple, GitHub).

**Step 2 — Receive the authorization code**

After successful authentication, SassyAuth validates that the user's org is associated with the requested app, then redirects to:

```
<redirect_uri>?code=<code>&state=<state>
```

**Step 3 — Exchange the code for a JWT**

```bash
curl -X POST http://localhost:3000/api/token/oauth/token \
  -H "Content-Type: application/json" \
  -d '{
    "code": "<authorization-code>",
    "client_id": "<appPublicId>",
    "client_secret": "<clientSecret>",
    "redirect_uri": "<redirect_uri>"
  }'
```

Response:

```json
{
  "access_token": "<RS256 JWT>",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

### Flow B: Direct Login

Use this flow for first-party apps and management UIs that collect credentials directly without a browser redirect.

```bash
curl -X POST http://localhost:3000/api/token/direct/login \
  -H "Content-Type: application/json" \
  -d '{
    "identifier": "user@example.com",
    "password": "s3cr3t",
    "appId": "<appPublicId>"
  }'
```

The `identifier` field is auto-detected and accepts:

- Email address — `user@example.com`
- Phone number — `+15551234567`
- Username — `johndoe`

The password is validated against the bcrypt hash stored by BetterAuth. No BetterAuth session is created; only a JWT is returned.

Response:

```json
{
  "access_token": "<RS256 JWT>",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

### Flow C: Invite + Accept

An admin (or platform operator) creates a user and emails them an invitation URL. The user clicks through, sets a password, and is activated.

```text
POST /api/users                 → admin creates user; response includes inviteUrl
GET  /api/invitations/:token    → admin console reads invite to render the welcome screen
POST /api/invitations/:token    → user submits password; creates BetterAuth account, marks invitation used
POST /api/users/:id/resend-invitation  → admin reissues invitation for a pending user
```

Invitations expire after 7 days. See `apps/auth-server/src/invitations/` and `apps/admin/app/accept-invite/`.

---

## JWKS and Token Verification

Resource servers must never trust JWTs blindly. Verify the signature using the public key served from SassyAuth's JWKS endpoint.

**Fetch the JWKS document:**

```bash
curl http://localhost:3000/api/token/jwks
```

```json
{
  "keys": [
    {
      "kty": "RSA",
      "use": "sig",
      "alg": "RS256",
      "kid": "...",
      "n": "...",
      "e": "AQAB"
    }
  ]
}
```

**JWT payload structure:**

| Claim          | Description                                        |
|----------------|----------------------------------------------------|
| `sub`          | User public ID (Sqid)                              |
| `aud`          | App public ID (Sqid)                               |
| `org`          | Org public ID (Sqid)                               |
| `permissions`  | Flat array of effective permission names           |
| `iat`          | Issued at (Unix timestamp)                         |
| `exp`          | Expiry — 1 hour after issuance                     |

**Example verification in Node.js:**

```javascript
const jwksClient = require('jwks-rsa');
const jwt = require('jsonwebtoken');

const client = jwksClient({
  jwksUri: 'http://localhost:3000/api/token/jwks',
});

function getKey(header, callback) {
  client.getSigningKey(header.kid, (err, key) => {
    callback(err, key?.getPublicKey());
  });
}

jwt.verify(token, getKey, { algorithms: ['RS256'] }, (err, decoded) => {
  if (err) throw err;
  // decoded.sub        — user public ID
  // decoded.aud        — app public ID
  // decoded.org        — org public ID
  // decoded.permissions — string[]
});
```

Cache the JWKS document locally and refresh it only when you encounter a key ID you do not recognise. Do not fetch it on every request.

---

## API Reference

| Method | Path                                          | Description                                      |
|--------|-----------------------------------------------|--------------------------------------------------|
| GET    | `/api/token/jwks`                             | JWKS document with RS256 public key              |
| GET    | `/api/token/oauth/authorize`                  | OAuth2 authorization — initiates login flow      |
| POST   | `/api/token/oauth/token`                      | Exchange authorization code for JWT              |
| POST   | `/api/token/direct/login`                     | Direct credential login — returns JWT            |
| ALL    | `/api/auth/*`                                 | BetterAuth: sign-up, sign-in, magic link, OTP, social login |
| GET    | `/api/users`                                  | List users (filter by `orgId`, `appId`)          |
| GET    | `/api/users/:id`                              | Get user                                         |
| POST   | `/api/users`                                  | Create user + invitation                         |
| PATCH  | `/api/users/:id`                              | Update user                                      |
| DELETE | `/api/users/:id`                              | Delete user                                      |
| GET    | `/api/users/:id/roles`                        | List user's roles                                |
| PUT    | `/api/users/:id/roles`                        | Set-replace all roles (atomic swap)              |
| POST   | `/api/users/:id/roles`                        | Assign role                                      |
| DELETE | `/api/users/:id/roles/:roleId`                | Remove role                                      |
| GET    | `/api/users/:id/direct-permissions`           | List user's direct permission assignments        |
| PUT    | `/api/users/:id/direct-permissions`           | Set-replace all direct permissions (atomic swap) |
| GET    | `/api/users/:id/effective-permissions`        | Computed permissions (roles ∪ direct)            |
| POST   | `/api/users/:id/resend-invitation`            | Re-issue invitation for a pending user           |
| GET    | `/api/invitations/:token`                     | Validate an invitation (returns user info + `expired`) |
| POST   | `/api/invitations/:token`                     | Accept invitation (sets password, creates Account, activates user) |
| GET    | `/api/orgs`                                   | List orgs (filter by `appId`)                    |
| GET    | `/api/orgs/:id`                               | Get org                                          |
| POST   | `/api/orgs`                                   | Create org                                       |
| PATCH  | `/api/orgs/:id`                               | Update org                                       |
| DELETE | `/api/orgs/:id`                               | Delete org                                       |
| GET    | `/api/apps`                                   | List apps (filter by `orgId`)                    |
| GET    | `/api/apps/:id`                               | Get app                                          |
| POST   | `/api/apps`                                   | Create app                                       |
| PATCH  | `/api/apps/:id`                               | Update app                                       |
| DELETE | `/api/apps/:id`                               | Delete app                                       |
| GET    | `/api/roles`                                  | List roles (filter by `appId`)                   |
| GET    | `/api/roles/:id`                              | Get role (includes permissions, user count)       |
| POST   | `/api/roles`                                  | Create role with permission IDs                  |
| PATCH  | `/api/roles/:id`                              | Update role name/description/permissions         |
| DELETE | `/api/roles/:id`                              | Delete role (blocked if users assigned)          |
| GET    | `/api/permissions`                            | List permissions (filter by `appId`, search `q`) |
| GET    | `/api/permissions/:id`                        | Get permission (includes role/user detail)       |
| POST   | `/api/permissions`                            | Create permission                                |
| PATCH  | `/api/permissions/:id`                        | Update permission name/description               |
| DELETE | `/api/permissions/:id`                        | Delete permission (blocked if roles/users assigned) |

BetterAuth mounts on Express before NestJS and intercepts all `/api/auth/*` routes directly. NestJS handles all other routes.

Full OpenAPI spec is in `docs/`.

---

## Admin Console

The admin console is a Next.js 15 app at `apps/admin/` listening on **port 3001**.

```bash
pnpm --filter @sassy-auth/admin dev
```

Routes:
- `/login` — credential login (proxies BetterAuth via Server Action)
- `/accept-invite?token=...` — invitation landing
- `/users` — users management (TanStack Table, view/edit/create drawers)
- `/orgs` — org management
- `/apps` — app management
- `/roles` — role management with inline permission assignment
- `/permissions` — permission management with role/user detail view

i18n is wired with `next-intl` (locales: `en`, `fr`). Strings live in `apps/admin/messages/`. The active locale is detected from the `Accept-Language` header and can be overridden via the `LocaleSwitcher` in the shell.

The admin console talks to `auth-server` via `AUTH_SERVER_URL` (default `http://localhost:3000`). All API calls forward the BetterAuth session cookie via the helpers in `apps/admin/lib/api.ts`.

---

## Observability

Both apps integrate **Winston** (structured logging) and **Sentry** (error tracking).

**Auth server (`apps/auth-server`):**
- `instrument.ts` initializes Sentry **before** Nest bootstraps so OTel auto-instrumentation can attach.
- `LoggerService` wraps Winston with NestJS's `LoggerService` interface; console transport in all envs; dev adds a file transport.
- `RequestIdMiddleware` propagates or generates `X-Request-Id` per request.
- `RequestLoggingMiddleware` emits one structured line per request: method, URL, status, duration, request-id.
- `SentryExceptionFilter` forwards 5xx errors to Sentry; 4xx are logged but not reported.

**Admin (`apps/admin`):**
- `sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts` — runtime SDK setup.
- `instrumentation.ts` — Next.js instrumentation hook.
- `app/global-error.tsx` — top-level error boundary that calls `Sentry.captureException`.
- `app/(admin)/error.tsx` — admin route group error boundary.
- Breadcrumbs are added on login attempts (success/failure) and on critical admin actions.

To enable Sentry, set the four `SENTRY_*` env vars (see [Observability env vars](#observability-optional)). With `SENTRY_DSN` blank, both apps skip Sentry init and continue running.

> ⚠️ **Known issue (bug-0002):** invitation tokens currently appear verbatim in `RequestLoggingMiddleware` log lines (they are path segments). Do not point a production log shipper at this code until the request-URL scrubber is in place. See `BUGs.md`.

> ⚠️ **Known issue (bug-0004):** plaintext emails are sent to Sentry via `Sentry.setUser({ email })` and to Winston in the `User created` log. Strip / hash before any GDPR-bound deployment.

---

## Running Tests

### Unit tests

```bash
pnpm test                                       # all packages (turbo)
pnpm --filter @sassy-auth/auth-server test
pnpm --filter @sassy-auth/admin test
pnpm --filter @sassy-auth/ui test
```

Unit test files live alongside source files as `*.spec.ts` / `*.test.tsx` and run with Jest. The BetterAuth node adapter and `uuid` are mocked in `apps/auth-server/src/__mocks__/`.

### E2E tests

**Auth-server E2E (Jest + Supertest):**

```bash
pnpm --filter @sassy-auth/auth-server test:e2e
```

Tests are in `apps/auth-server/test/` using the Jest config at `test/jest-e2e.json`. They require a running database.

**Admin E2E (Playwright):**

```bash
# Requires both servers running (pnpm dev in another terminal)
pnpm --filter @sassy-auth/admin-e2e test:e2e

# Headed mode (see the browser)
pnpm --filter @sassy-auth/admin-e2e test:e2e:headed

# Interactive UI mode
pnpm --filter @sassy-auth/admin-e2e test:e2e:ui
```

Tests are in `apps/admin-e2e/tests/`. In CI, the Playwright config automatically starts both servers. Locally, start `pnpm dev` first. See `apps/admin-e2e/README.md` for details.

---

## Known Limitations

The following items are deferred to later sub-projects and are not yet production-ready. See `TODO.md` for the full follow-up list and `BUGs.md` for catalogued bugs.

**In-memory OAuth code store.**
Authorization codes from Flow A are stored in memory. They are lost on server restart and the server cannot run as multiple instances behind a load balancer. Replace with Redis or a database table before deploying to production.

**`redirect_uri` allowlist not enforced.**
Any `redirect_uri` is currently accepted during the code exchange. A per-app allowlist (stored in `SaApp`) needs to be added to prevent open redirect attacks.

**`client_secret` not validated.**
The `client_secret` field is accepted in `POST /api/token/oauth/token` but not checked against any stored value. Per-app secrets need to be generated, hashed, and stored in `SaApp`.

**RBAC not org-scoped.**
`checkPermission` only verifies that the caller holds the named permission — it does not constrain by `orgId`. A user with `org.users.manage` in org A can currently act on users in org B. Tracked as **bug-0001**.

**CI — E2E only, no typecheck/lint.**
A GitHub Actions E2E workflow (`.github/workflows/e2e.yml`) runs Playwright tests on PR and push to `master`. Typecheck and lint are not yet wired into CI.

**Set-replace DTOs lack array size limits.**
The `PUT /users/:id/roles` and `PUT /users/:id/direct-permissions` endpoints accept arrays of any size (including empty). No `@ArrayMaxSize` is enforced. Tracked as **bug-0034**.
