# SassyAuth

A multitenant authentication and authorization server. Resource servers delegate all login, session, and token concerns to SassyAuth and verify the resulting RS256 JWTs independently.

Built as a Turborepo pnpm monorepo.

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
    - [6. Start the development server](#6-start-the-development-server)
  - [RSA Key Pair Generation](#rsa-key-pair-generation)
  - [Environment Variables](#environment-variables)
  - [Auth Flows](#auth-flows)
    - [Flow A: OAuth2 Authorization Code](#flow-a-oauth2-authorization-code)
    - [Flow B: Direct Login](#flow-b-direct-login)
  - [JWKS and Token Verification](#jwks-and-token-verification)
  - [API Reference](#api-reference)
  - [Running Tests](#running-tests)
    - [Unit tests](#unit-tests)
    - [E2E tests](#e2e-tests)
  - [Known Limitations](#known-limitations)

---

## Prerequisites

- Node.js >= 20
- pnpm 9
- PostgreSQL 14+

---

## Project Structure

```
sassy-auth/
  apps/
    auth-server/          # NestJS (Express adapter) — main deliverable
      src/
        auth/             # BetterAuth integration and guard
        token/            # JWT issuance: OAuth2 and direct login flows
        seed/             # Platform bootstrap script
      test/               # E2E tests
  packages/
    db/                   # Shared Prisma schema and PrismaClient singleton
    types/                # Shared TypeScript types (JWT payload, error codes, identifier detection)
```

**Database tables:**

| Owner       | Tables                                                                                      |
|-------------|---------------------------------------------------------------------------------------------|
| BetterAuth  | `user`, `session`, `account`, `verification`                                                |
| SassyAuth   | `sa_app`, `sa_org`, `sa_user`, `sa_permission`, `sa_role`, `sa_role_permission`, `sa_user_role`, `sa_user_permission` |

`sa_user` links to BetterAuth's `user` table via the `betterAuthUserId` foreign key.

All external-facing IDs are Sqids (encoded from auto-increment integers). Database PKs are never exposed.

---

## Getting Started

### 1. Clone and install dependencies

```bash
git clone <repo-url>
cd sassy-auth
pnpm install
```

### 2. Configure environment variables

```bash
cp apps/auth-server/.env.example apps/auth-server/.env
```

Edit `apps/auth-server/.env`. At minimum, set `DATABASE_URL`, `RSA_PRIVATE_KEY`, `RSA_PUBLIC_KEY`, and `BETTER_AUTH_SECRET`. See [Environment Variables](#environment-variables) for all options and [RSA Key Pair Generation](#rsa-key-pair-generation) for how to generate the key pair.

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
- Six platform permissions: `platform.orgs.manage`, `platform.apps.manage`, `platform.users.manage`, `platform.permissions.manage`, `org.users.manage`, `org.permissions.manage`

```bash
pnpm --filter @sassy-auth/db db:seed
```

### 6. Start the development server

```bash
pnpm dev
```

The auth server listens on `http://localhost:3000` by default.

---

## RSA Key Pair Generation

SassyAuth signs JWTs with RS256. Generate a 2048-bit RSA key pair and base64-encode both keys for use in the environment variables:

```bash
node -e "const c=require('crypto');const {privateKey,publicKey}=c.generateKeyPairSync('rsa',{modulusLength:2048});console.log('RSA_PRIVATE_KEY='+Buffer.from(privateKey.export({type:'pkcs8',format:'pem'})).toString('base64'));console.log('RSA_PUBLIC_KEY='+Buffer.from(publicKey.export({type:'spki',format:'pem'})).toString('base64'))"
```

Copy the two output lines directly into your `.env` file.

---

## Environment Variables

| Variable              | Required | Description                                                    |
|-----------------------|----------|----------------------------------------------------------------|
| `DATABASE_URL`        | Yes      | PostgreSQL connection string                                   |
| `RSA_PRIVATE_KEY`     | Yes      | Base64-encoded PKCS8 PEM private key (for signing JWTs)        |
| `RSA_PUBLIC_KEY`      | Yes      | Base64-encoded SPKI PEM public key (served via JWKS endpoint)  |
| `BETTER_AUTH_SECRET`  | Yes      | Random string, 32+ characters                                  |
| `BETTER_AUTH_URL`     | Yes      | Base URL of this server, e.g. `http://localhost:3000`          |
| `GOOGLE_CLIENT_ID`    | No       | Google OAuth client ID                                         |
| `GOOGLE_CLIENT_SECRET`| No       | Google OAuth client secret                                     |
| `MICROSOFT_CLIENT_ID` | No       | Microsoft OAuth client ID                                      |
| `MICROSOFT_CLIENT_SECRET` | No   | Microsoft OAuth client secret                                  |
| `APPLE_CLIENT_ID`     | No       | Apple OAuth client ID                                          |
| `APPLE_CLIENT_SECRET` | No       | Apple OAuth client secret                                      |
| `GITHUB_CLIENT_ID`    | No       | GitHub OAuth client ID                                         |
| `GITHUB_CLIENT_SECRET`| No       | GitHub OAuth client secret                                     |
| `SQIDS_ALPHABET`      | No       | Custom alphabet for Sqids encoding; leave blank for default    |

Social providers are opt-in. Omit the client ID and secret for any provider you do not want to enable.

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

---

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
  // decoded.sub      — user public ID
  // decoded.aud      — app public ID
  // decoded.org      — org public ID
  // decoded.permissions — string[]
});
```

Cache the JWKS document locally and refresh it only when you encounter a key ID you do not recognise. Do not fetch it on every request.

---

## API Reference

| Method | Path                          | Handler      | Description                                      |
|--------|-------------------------------|--------------|--------------------------------------------------|
| GET    | `/api/token/jwks`             | NestJS       | JWKS document with RS256 public key              |
| GET    | `/api/token/oauth/authorize`  | NestJS       | OAuth2 authorization — initiates login flow      |
| POST   | `/api/token/oauth/token`      | NestJS       | Exchange authorization code for JWT              |
| POST   | `/api/token/direct/login`     | NestJS       | Direct credential login — returns JWT            |
| ALL    | `/api/auth/*`                 | BetterAuth   | Sign-up, sign-in, magic link, OTP, social login  |

BetterAuth mounts on Express before NestJS and intercepts all `/api/auth/*` routes directly. NestJS handles all other routes.

---

## Running Tests

### Unit tests

```bash
pnpm test
```

Or scoped to the auth server:

```bash
pnpm --filter @sassy-auth/auth-server test
```

Unit test files live alongside source files as `*.spec.ts` and run with Jest. The BetterAuth node adapter is mocked in `src/__mocks__/better-auth-node.ts`.

### E2E tests

```bash
pnpm --filter @sassy-auth/auth-server test:e2e
```

E2E tests are in `apps/auth-server/test/` and use the Jest config at `test/jest-e2e.json`. They require a running database.

---

## Known Limitations

The following items are deferred to later sub-projects and are not yet production-ready:

**In-memory OAuth code store**
Authorization codes from Flow A are stored in memory. They are lost on server restart and the server cannot run as multiple instances behind a load balancer. Replace with Redis or a database table before deploying to production.

**`redirect_uri` allowlist not enforced**
Any `redirect_uri` is currently accepted during the code exchange. A per-app allowlist (stored in `SaApp`) needs to be added to prevent open redirect attacks.

**`client_secret` not validated**
The `client_secret` field is accepted in `POST /api/token/oauth/token` but not checked against any stored value. Per-app secrets need to be generated, hashed, and stored in `SaApp`.

**No management UI**
Apps, orgs, users, roles, and permissions can only be managed directly through the database or API. A management UI is planned for sub-project 2.
