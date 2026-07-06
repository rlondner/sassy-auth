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
    - [Flow A: OAuth2 Authorization Code with PKCE (S256)](#flow-a-oauth2-authorization-code-with-pkce-s256)
    - [Flow B: Direct Login](#flow-b-direct-login)
    - [Flow C: Invite + Accept](#flow-c-invite--accept)
  - [JWKS and Token Verification](#jwks-and-token-verification)
  - [API Reference](#api-reference)
  - [Sample Resource Server (FastAPI)](#sample-resource-server-fastapi)
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

**Alternative: Flox (zero-config).** If you have [Flox](https://flox.dev) installed, run `flox activate` in the project root. It provisions Node.js, pnpm, PostgreSQL, Python, and uv automatically, generates `.env.local` with RSA keys and all required variables, runs database migrations, and seeds platform data. Skip to [step 6](#6-start-the-development-servers) after activation.

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
    resource-server-fastapi/  # Python/FastAPI reference resource server (port 8010)
      app/
        oauth/               # PKCE login flow + JWKS token verification
        api/                 # Protected API routes (/api/properties)
        web/                 # Public web routes
        templates/           # Jinja2 HTML templates
        static/              # CSS + JS
      tests/                 # pytest test suite
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
- Platform permissions: `platform.orgs.manage`, `platform.apps.manage`, `platform.users.manage`, `platform.permissions.manage`, `platform.roles.manage`, `org.users.manage`, `org.roles.manage`
- System permissions (`isSystem: true`): `org.users.manage`, `org.roles.manage` — these bypass app-scope checks

```bash
pnpm --filter @sassy-auth/db db:seed
```

The seed also creates 5 platform admin users (`u@sa.io`, `o@sa.io`, `a@sa.io`, `p@sa.io`, `s@sa.io`), each with password `Pass@word1234`. `s@sa.io` is the super admin and is the recommended account for first sign-in.

**Optional — demo resource server data.** Set `SEED_DEMO=1` to additionally create a sample app (`resourceserver01`), an org (`Citadel`), 8 `rs.*` permissions, 2 roles, and 2 demo users (`m@cpm.io`, `i@cpm.io`) used by the [FastAPI sample resource server](apps/resource-server-fastapi/README.md).

**Optional — multi-tenant demo data.** Set `SEED_DEMO_MULTITENANT=1` to create a second sample app (`app01`) with two orgs (Acme, Globex), 3 users each, and org-scoped permissions (`contracts.read`, `contracts.create`, `org.users.manage`, `org.roles.manage`). Useful for testing the org-scoped admin experience.



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
| `JWT_KEY_ID`          | `kid` written into every issued JWT header and the JWKS document. Resource servers use it to pick the right key from the JWKS. Rotate together with the RSA key pair. Default: `sassy-auth-1` |
| `BETTER_AUTH_SECRET`  | Random string, 32+ characters                                  |
| `BETTER_AUTH_URL`     | Base URL of the auth server, e.g. `http://localhost:3000`. Also used as the JWT `iss` claim. |
| `TRUSTED_ORIGINS`     | Comma-separated list of origins allowed by BetterAuth CSRF. Default: `http://localhost:3001` |

### Admin console

| Variable              | Description                                                                                |
|-----------------------|--------------------------------------------------------------------------------------------|
| `ADMIN_URL`           | Public URL of the admin console, used by the API to build invitation links. Default: `http://localhost:3001` |
| `AUTH_SERVER_URL`     | Internal URL the admin uses to reach the auth server. Default: `http://localhost:3000`      |
| `LOGIN_NEXT_ALLOWED_ORIGINS` | Comma-separated origins allowed by `/login?next=` redirect validation (in addition to `AUTH_SERVER_URL`). Default: empty |
| `SEED_DEMO`          | Set to `1` to seed demo data for the FastAPI resource server during `db:seed`. Default: unset |
| `SEED_DEMO_MULTITENANT` | Set to `1` to seed multi-tenant demo data (app01 + Acme/Globex orgs) during `db:seed`. Default: unset |
| `NEXT_PUBLIC_ADMIN_CONTACT_EMAIL` | Optional. Email address shown on the admin `/oauth-error` page's "Contact administrator" mailto. Leave unset to hide the link. The `NEXT_PUBLIC_` prefix is required so Next.js inlines it into the client bundle. |

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

### Flow A: OAuth2 Authorization Code with PKCE (S256)

Use this flow for third-party or external resource servers that redirect users to SassyAuth for login. PKCE is **required** — only the `S256` method is accepted and the server rejects authorize requests without a code chal

**Step 0 — Generate a PKCE pair (client-side)**

```javascript
const crypto = require('crypto');
const code_verifier = crypto.randomBytes(64).toString('base64url');
const code_challenge = crypto
  .createHash('sha256').update(code_verifier).digest('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
// Keep `code_verifier` server-side. Send `code_challenge` on the authorize call.
```

**Step 1 — Generate PKCE verifier and challenge**

```javascript
const verifier = crypto.randomBytes(64).toString('base64url'); // 43-128 chars
const challenge = crypto
  .createHash('sha256')
  .update(verifier)
  .digest('base64url');
```

**Step 2 — Redirect the user to the authorization endpoint**

```
GET /api/token/oauth/authorize
  ?client_id=<appPublicId>
  &redirect_uri=<uri>
  &code_challenge=<S256 challenge>
  &code_challenge_method=S256
  &state=<state>
```

The user authenticates using any method BetterAuth supports: email/password, magic link, email OTP, or a configured social provider (Google, Microsoft, Apple, GitHub).

**Step 3 — Receive the authorization code**

After successful authentication, SassyAuth validates that the user's org is associated with the requested app, that the `redirect_uri` origin matches the app's registered URL, then redirects to:

```
<redirect_uri>?code=<code>&state=<state>
```

The `redirect_uri` must share an origin (scheme + host + port) with the `url` registered on the `sa_app` row. If it doesn't, the authorize call returns `400 invalid_redirect_uri`. `localhost` URIs are allowed for development.


**Step 4 — Exchange the code + verifier for a JWT**

```bash
curl -X POST http://localhost:3000/api/token/oauth/token \
  -H "Content-Type: application/json" \
  -d '{
    "code": "<authorization-code>",
    "client_id": "<appPublicId>",
    "code_verifier": "<verifier>",
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

> **Note:** The `redirect_uri` must use the same origin (scheme + host + port) as the app's registered URL. `localhost` URIs are allowed for development.
Authorization codes are single-use and stored in-process (see [Known Limitations](#known-limitations)). The verifier must match the challenge sent on Step 1 byte-for-byte after S256 hashing.

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

The password is validated against the scrypt hash stored by BetterAuth (format `<saltHex>:<hashHex>`). No BetterAuth session is created; only a JWT is returned.

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

**JWT header:**

| Field          | Description                                        |
|----------------|----------------------------------------------------|
| `alg`          | `RS256`                                            |
| `typ`          | `JWT`                                              |
| `kid`          | Matches the `kid` of the key in the JWKS document. Controlled by `JWT_KEY_ID`. |

**JWT payload structure:**

| Claim          | Description                                                                   |
|----------------|-------------------------------------------------------------------------------|
| `sub`          | User public ID (Sqid)                                                         |
| `aud`          | App public ID (Sqid)                                                          |
| `org`          | Org public ID (Sqid)                                                          |
| `iss`          | Value of `BETTER_AUTH_URL` at issuance time                                   |
| `scope`        | Space-separated list of effective permission names (OAuth 2.0 `scope` claim)  |
| `iat`          | Issued at (Unix timestamp)                                                    |
| `exp`          | Expiry — 1 hour after issuance                                                |

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

jwt.verify(
  token,
  getKey,
  {
    algorithms: ['RS256'],
    issuer: process.env.BETTER_AUTH_URL,
    audience: '<your-app-publicId>',
  },
  (err, decoded) => {
    if (err) throw err;
    // decoded.sub   — user public ID
    // decoded.aud   — app public ID
    // decoded.org   — org public ID
    // decoded.scope — space-separated permission names, e.g. "rs.properties.read rs.inspections.read"
    const scopes = new Set(String(decoded.scope ?? '').split(' '));
    if (!scopes.has('rs.properties.read')) throw new Error('insufficient_scope');
  },
);
```

A Python/FastAPI example using `pyjwt[crypto]` and `PyJWKClient` is in [`apps/resource-server-fastapi/`](apps/resource-server-fastapi/README.md).

Cache the JWKS document locally and refresh it only when you encounter a `kid` you do not recognise. Do not fetch it on every request.

---

## API Reference

| Method | Path                                          | Description                                      |
|--------|-----------------------------------------------|--------------------------------------------------|
| GET    | `/.well-known/oauth-authorization-server`     | RFC 8414 OAuth AS metadata (issuer, endpoints, supported methods) |
| GET    | `/api/token/jwks`                             | JWKS document with RS256 public key              |
| GET    | `/api/token/oauth/authorize`                  | OAuth2 authorization — initiates login flow      |
| POST   | `/api/token/oauth/token`                      | Exchange authorization code for JWT              |
| POST   | `/api/token/direct/login`                     | Direct credential login — returns JWT            |
| GET    | `/api/me`                                     | Caller's profile: org, app context, effective permissions |
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

## Sample Resource Server (FastAPI)

A runnable Python/FastAPI sample lives at [`apps/resource-server-fastapi/`](apps/resource-server-fastapi/README.md). It demonstrates the full Flow A (PKCE) round-trip from a non-Node consumer: starting the authorize redirect, exchanging the code, verifying the JWT against the JWKS endpoint, and scope-gating a protected endpoint.

The sample relies on the `SEED_DEMO=1` data (`resourceserver01` app, `Citadel` org, demo users `m@cpm.io` / `i@cpm.io`). The RS app's own README walks through both the seed-driven setup and a manual admin-UI alternative for users who want to provision everything from scratch.

---

## Admin Console

The admin console is a Next.js 15 app at `apps/admin/` listening on **port 3001**.

```bash
pnpm --filter @sassy-auth/admin dev
```

Routes:
- `/login` — credential login (proxies BetterAuth via Server Action)
- `/accept-invite?token=...` — invitation landing
- `/oauth-error` — OAuth error page (shown when the authorize flow fails; optionally links to `NEXT_PUBLIC_ADMIN_CONTACT_EMAIL`)
- `/users` — users management (TanStack Table, view/edit/create drawers)
- `/orgs` — org management
- `/apps` — app management
- `/roles` — role management with inline permission assignment
- `/permissions` — permission management with role/user detail view

All CRUD operations (create, update, delete) show success toast notifications via [Sonner](https://sonner.emilkowal.dev/). The `<Toaster />` is mounted in the root layout and respects the user's light/dark theme preference.

i18n is wired with `next-intl` (locales: `en`, `fr`). Strings live in `apps/admin/messages/`. The active locale is detected from the `Accept-Language` header and can be overridden via the `LocaleSwitcher` in the shell.

The admin console talks to `auth-server` via `AUTH_SERVER_URL` (default `http://localhost:3000`). All API calls forward the BetterAuth session cookie via the helpers in `apps/admin/lib/api.ts`.

The login page supports a `next=<url>` query parameter for post-login redirect (e.g., from a resource server's OAuth flow). URLs are validated against an allowlist (`AUTH_SERVER_URL` + `LOGIN_NEXT_ALLOWED_ORIGINS` env var) to prevent open redirects.

---

## Resource Server (FastAPI)

A reference resource server is at `apps/resource-server-fastapi/`. It demonstrates how a third-party application integrates with SassyAuth using OAuth2 PKCE.

**Prerequisites:** Python 3.11+, pip or uv.

```bash
cd apps/resource-server-fastapi
python -m venv .venv && source .venv/bin/activate  # or .venv\Scripts\activate on Windows
pip install -e ".[dev]"
```

**Configure:**

```bash
cp .env.example .env
# Edit .env — set SASSY_CLIENT_ID to the app's publicId from the seed
```

| Variable              | Description                                                   |
|-----------------------|---------------------------------------------------------------|
| `AUTH_SERVER_URL`     | SassyAuth base URL (default `http://localhost:3000`)          |
| `ADMIN_URL`           | Admin console URL for login redirect (default `http://localhost:3001`) |
| `SASSY_CLIENT_ID`    | `sa_app.publicId` for this resource server (from seed output) |
| `RS_BASE_URL`        | Public URL of this server (e.g. `http://localhost:8010`)      |
| `REDIRECT_URI`       | OAuth callback URL (e.g. `http://localhost:8010/auth/callback`) |

**Run:**

```bash
uvicorn app.main:app --port 8010 --reload
```

**Test:**

```bash
pytest
```

Routes:
- `/` — landing page with login button
- `/auth/login` — initiates PKCE flow → redirects to SassyAuth
- `/auth/callback` — receives authorization code, exchanges for JWT
- `/api/properties` — protected endpoint; requires Bearer token with `rs.properties.read` scope

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

The following items are deferred to later sub-projects and are not yet production-ready. See `todo/TODO_*.md` for daily follow-up lists and `bugs/BUGS_*.md` for the full bug catalog.

**In-memory OAuth code store.**
Authorization codes from Flow A are stored in memory. They are lost on server restart and the server cannot run as multiple instances behind a load balancer. Replace with Redis or a database table before deploying to production. Tracked as **bug-0039**.

**`redirect_uri` origin-only validation.**
`redirect_uri` is validated against the app's registered URL origin (scheme + host + port). Any path under that origin is accepted. A per-app allowlist of specific redirect paths (stored in `SaApp`) should be added for tighter control. Tracked as **bug-0047**.

**PKCE `code_verifier` format not validated.**
The `code_verifier` field is checked for presence but not for RFC 7636 format (43-128 chars of unreserved characters). Tracked as **bug-0041**.

**JWT payload breaking change (`scope` replaces `permissions`).**
The JWT `permissions` claim (string array) was replaced with `scope` (space-separated string) on the `docs/pkce-resource-server-design` branch. No migration path or version marker exists. Tracked as **bug-0038**.

**RBAC not org-scoped.**
`checkPermission` only verifies that the caller holds the named permission — it does not constrain by `orgId`. A user with `org.users.manage` in org A can currently act on users in org B. Tracked as **bug-0001**.

**Inactive users can still authenticate.**
Neither the OAuth authorize flow nor the direct login flow checks `saUser.status` before issuing a JWT. Setting a user to `inactive` via the API has no effect on their ability to log in and receive tokens. Tracked as **bug-0074**.

**No rate limiting on authentication endpoints.**
The `/api/token/direct/login` and `/api/invitations/:token` endpoints accept unlimited requests. Brute-force password attacks are unthrottled. Tracked as **bug-0080**.

**Escalation guard coverage is incomplete.**
The `assertCallerCanGrantSystemPerms` guard is applied to `assignRole` and `setUserRoles` but not to `removeRole`. `checkPermissionForApp` has a silent bypass when `targetAppId` is undefined. Tracked as **bug-0094** and **bug-0097**.

**CI — E2E only, no typecheck/lint.**
A GitHub Actions E2E workflow (`.github/workflows/e2e.yml`) runs Playwright tests on PR and push to `master`. Typecheck and lint are not yet wired into CI. Note: the e2e workflow excludes `@sassy-auth/auth-server` from `turbo build` due to pre-existing build errors (tracked as **bug-0092**).

**Set-replace DTOs lack array size limits.**
The `PUT /users/:id/roles` and `PUT /users/:id/direct-permissions` endpoints accept arrays of any size (including empty). No `@ArrayMaxSize` is enforced. Tracked as **bug-0034**.

**`BETTER_AUTH_URL` not validated at startup.**
`resolveIssuer()` accepts any string — empty, whitespace, or non-URL values produce a malformed `issuer` in the OAuth AS discovery document and in every JWT's `iss` claim. A warning is logged when the variable is unset, but not when it is set to an invalid value. Tracked as **bug-0115**.

**Username/phone direct-login collision across tenants.**
`username` and `phoneNumber` on `SaUser` have no uniqueness constraint (not even per-org). The `directLogin` endpoint uses `findFirst` — if two users in different orgs share a username, the wrong user may be authenticated or a valid login may be rejected. Tracked as **bug-0147**.

**Concurrent entity creation races on `publicId: 'placeholder'`.**
All create flows (apps, orgs, roles, permissions) insert a shared literal `'placeholder'` as `publicId` before updating it to the real Sqid. Two concurrent creates hit the unique constraint, producing a misleading "name already exists" error. Tracked as **bug-0148**.

**`deleteUser` does not remove BetterAuth identity.**
Deleting a user only removes the `SaUser` row — the BetterAuth `User`, `Account`, and `Session` rows persist. The user's email remains permanently consumed and active sessions continue working. Tracked as **bug-0151**.

**Swagger/OpenAPI docs exposed in all environments.**
`/api/docs` and `/api/docs-json` are mounted unconditionally — no `NODE_ENV` gate. The full API surface is publicly discoverable in production. Tracked as **bug-0153**.

**No security headers (Helmet).**
The auth-server sets no `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security`, or `Content-Security-Policy` headers. Tracked as **bug-0154**.

**`GET /api/apps/:id` endpoint missing.**
The API Reference table documents `GET /api/apps/:id` but no such route exists in `AppsController`. All other entity controllers (orgs, roles, permissions, users) have a get-by-id handler. Tracked as **bug-0164**.

**Admin middleware session validation not cached.**
The Next.js Edge middleware calls the auth-server's `get-session` endpoint on every authenticated request with `cache: 'no-store'`. No session caching is applied, so each page load incurs a full round-trip to the auth-server. Tracked as **bug-0165**.

**`createPermission` allows `platform.*` names (privilege escalation).**
The `createPermission` endpoint does not block names starting with `platform.`. An admin with `platform.permissions.manage` can create a permission named `platform.anything.new` and assign it to themselves, effectively minting arbitrary platform privileges. Tracked as **bug-0183**.

**Missing database indexes on BetterAuth tables.**
The `Session`, `Account`, and `Verification` tables lack indexes on their most-queried foreign key and lookup columns (`Session.userId`, `Account.userId`, `Verification.identifier`). Authentication performance degrades linearly with table size. Tracked as **bug-0179**.
