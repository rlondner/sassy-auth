# SassyAuth Deployment Guide

This document describes how to deploy SassyAuth to [Render](https://render.com) with:

| Service | Public URL | Render service name |
|---------|------------|---------------------|
| Admin console (`apps/admin`) | https://auth.milissai.com | `sassy-auth-admin` |
| Auth server (`apps/auth-server`) | https://auth-api.milissai.com | `sassy-auth-server` |
| Sample resource server (`apps/resource-server-fastapi`) | https://testapp.milissai.com | `sassy-resource-server` |
| PostgreSQL | — | [Neon](https://neon.tech) (external) |

The repository ships a [`render.yaml`](render.yaml) Blueprint that provisions all three Render web services. The database lives on Neon, not Render.

> **Status:** SassyAuth is experimental and not security-audited. Treat this deployment as a staging environment until you have reviewed [Known Limitations](README.md#known-limitations) and [SECURITY.md](SECURITY.md).

---

## Architecture

```mermaid
flowchart LR
  subgraph browsers [Browser clients]
    AdminOp[Admin operators]
    RSUser[Resource-server users]
  end

  subgraph render [Render.com]
    Admin["sassy-auth-admin<br/>auth.milissai.com"]
    Auth["sassy-auth-server<br/>auth-api.milissai.com"]
    RS["sassy-resource-server<br/>testapp.milissai.com"]
  end

  subgraph neon [Neon.tech]
    PG[(PostgreSQL)]
  end

  AdminOp --> Admin
  RSUser --> RS
  Admin -->|Server Actions / session cookie| Auth
  RS -->|PKCE OAuth + JWT verify| Auth
  Auth --> PG
```

**Request paths:**

- Operators sign in at **auth.milissai.com**. The admin app calls **auth-api.milissai.com** server-side with the BetterAuth session cookie.
- End users of the sample app hit **testapp.milissai.com**, which redirects to **auth-api.milissai.com** for OAuth2 + PKCE, then verifies RS256 JWTs against the JWKS endpoint at `https://auth-api.milissai.com/api/token/jwks`.

---

## Prerequisites

- A [Render](https://render.com) account (Starter plan or above recommended — see [Database migrations](#database-migrations))
- A [Neon](https://neon.tech) project with PostgreSQL 14+
- DNS control for `milissai.com` (or substitute your own domains in `render.yaml`)
- Node.js ≥ 24 and pnpm ≥ 9 locally (for key generation and optional local mock deploy)
- Python ≥ 3.11 locally (optional, for local resource-server mock)

---

## 1. Neon database

1. Create a project at [console.neon.tech](https://console.neon.tech).
2. Create a database (e.g. `sassyauth`).
3. Copy the **pooled** connection string (`?sslmode=require`). Example shape:

   ```
   postgresql://user:password@ep-xxx-pooler.us-east-1.aws.neon.tech/sassyauth?sslmode=require
   ```

4. Keep this value for the `DATABASE_URL` secret in Render.

Neon is the only database in this layout. Do not provision Render Postgres unless you intentionally want to migrate off Neon.

---

## 2. Generate secrets (one time)

Run locally from the repository root.

**RSA key pair** (JWT signing):

```bash
node -e "const c=require('crypto');const {privateKey,publicKey}=c.generateKeyPairSync('rsa',{modulusLength:2048});console.log('RSA_PRIVATE_KEY='+Buffer.from(privateKey.export({type:'pkcs8',format:'pem'})).toString('base64'));console.log('RSA_PUBLIC_KEY='+Buffer.from(publicKey.export({type:'spki',format:'pem'})).toString('base64'))"
```

**BetterAuth secret** (32+ random characters):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Admin seed password** (required in production — the seed script refuses the published dev default when `NODE_ENV=production`):

Choose a strong password and store it as `SEED_ADMIN_PASSWORD`. You will use it for the first platform admin account created by the seed.

Store all generated values in a password manager. Rotating `RSA_PRIVATE_KEY` / `RSA_PUBLIC_KEY` invalidates every issued JWT; rotating `BETTER_AUTH_SECRET` signs out every admin session.

---

## 3. Deploy to Render

### 3.1 Apply the Blueprint

1. Push this repository to GitHub (if not already).
2. In Render: **New → Blueprint**.
3. Connect the repository and select the default `render.yaml`.
4. Render prompts for every `sync: false` variable. At minimum provide:

   | Variable | Service / group | Notes |
   |----------|-----------------|-------|
   | `DATABASE_URL` | `sassy-auth-production` | Neon pooled connection string |
   | `RSA_PRIVATE_KEY` | `sassy-auth-production` | Base64 PKCS8 PEM |
   | `RSA_PUBLIC_KEY` | `sassy-auth-production` | Base64 SPKI PEM |
   | `BETTER_AUTH_SECRET` | `sassy-auth-production` | 32+ char random string |
   | `SEED_ADMIN_PASSWORD` | `sassy-auth-server` | Strong password for seeded admins |
   | `SASSY_CLIENT_ID` | `sassy-resource-server` | Set after [§5 Register the resource-server app](#5-register-the-resource-server-app) |
   | `RESEND_API_KEY` | `sassy-auth-server` | Recommended for invitation/reset email |

5. Click **Apply**. Render builds and deploys all three services.

### 3.2 Custom domains and DNS

For each service, Render shows a CNAME target after you add a custom domain. Create DNS records:

| Hostname | Type | Target |
|----------|------|--------|
| `auth-api.milissai.com` | CNAME | Render target for `sassy-auth-server` |
| `auth.milissai.com` | CNAME | Render target for `sassy-auth-admin` |
| `testapp.milissai.com` | CNAME | Render target for `sassy-resource-server` |

Render provisions TLS certificates automatically once DNS propagates.

### 3.3 Database migrations

The Blueprint runs migrations on the auth-server via `preDeployCommand`:

```yaml
preDeployCommand: cd packages/db && npx prisma migrate deploy
```

This requires a **paid** Render instance type (Starter or above). It runs after each build, before traffic switches to the new version.

**Free tier alternative:** Remove `preDeployCommand` from `render.yaml` and append the migration to `buildCommand` on `sassy-auth-server`:

```yaml
buildCommand: >-
  ...existing build steps... &&
  cd packages/db && npx prisma migrate deploy
```

Running migrations in both places executes them twice per deploy — pick one location only.

### 3.4 First-time seed

Migrations run automatically; **seed does not**. Run the idempotent platform seed once from a Render shell on `sassy-auth-server` (**Shell** tab in the service dashboard):

```bash
corepack enable && corepack prepare pnpm@9.0.0 --activate
pnpm --filter @sassy-auth/db db:seed
```

The shell inherits environment variables from the service, including `DATABASE_URL` and `SEED_ADMIN_PASSWORD`.

This creates the platform app, org, permissions, and five platform admin users (`s@sa.io`, `u@sa.io`, …). Sign in at https://auth.milissai.com/login as `s@sa.io` with your `SEED_ADMIN_PASSWORD`.

**Optional demo data** for the FastAPI sample (creates app `resourceserver01`, org `Citadel`, demo users):

```bash
SEED_DEMO=1 pnpm --filter @sassy-auth/db db:seed
```

After seeding with `SEED_DEMO=1`, read the app's public ID:

```bash
pnpm --filter @sassy-auth/db exec node scripts/print-app-public-id.cjs
cat /tmp/sassy-e2e-rs-client-id.txt
```

Set that value as `SASSY_CLIENT_ID` on `sassy-resource-server` and redeploy.

---

## 4. Environment variable reference (production)

### Shared group (`sassy-auth-production`)

| Variable | Production value |
|----------|------------------|
| `DATABASE_URL` | Neon connection string |
| `RSA_PRIVATE_KEY` / `RSA_PUBLIC_KEY` | Generated once |
| `JWT_KEY_ID` | `sassy-auth-1` (rotate with key pair) |
| `BETTER_AUTH_SECRET` | Generated once |
| `BETTER_AUTH_URL` | `https://auth-api.milissai.com` |
| `AUTH_SERVER_URL` | `https://auth-api.milissai.com` |
| `ADMIN_URL` | `https://auth.milissai.com` |
| `TRUSTED_ORIGINS` | `https://auth.milissai.com,https://testapp.milissai.com` |
| `NODE_ENV` | `production` |

`BETTER_AUTH_URL` is also the JWT `iss` claim and the OAuth authorization-server metadata issuer. It must exactly match what resource servers expect.

### Auth server only

| Variable | Notes |
|----------|-------|
| `SEED_ADMIN_PASSWORD` | Required for seed in production |
| `RESEND_API_KEY` | Recommended email transport |
| `REGISTER_RATE_LIMIT` | Default `10` — in-process; see [Known Limitations](README.md#known-limitations) |
| `GOOGLE_*`, `MICROSOFT_*`, … | Optional social sign-in — redirect URIs use `https://auth-api.milissai.com/api/auth/callback/{provider}` |

Do **not** set `SASSY_AUTH_ALLOW_INSECURE_APP_URLS` in production.

### Admin console only

| Variable | Production value |
|----------|------------------|
| `PUBLIC_AUTH_SERVER_URL` | `https://auth-api.milissai.com` |
| `LOGIN_NEXT_ALLOWED_ORIGINS` | `https://testapp.milissai.com` |

### Resource server only

| Variable | Production value |
|----------|------------------|
| `AUTH_SERVER_URL` | `https://auth-api.milissai.com` |
| `ADMIN_URL` | `https://auth.milissai.com` |
| `RS_BASE_URL` | `https://testapp.milissai.com` |
| `REDIRECT_URI` | `https://testapp.milissai.com/auth/callback` |
| `SASSY_CLIENT_ID` | `sa_app.publicId` for the registered app |

---

## 5. Register the resource-server app

The FastAPI sample needs a `SaApp` row whose URL and callback match **testapp.milissai.com**.

### Option A — seed demo data (fastest)

```bash
SEED_DEMO=1 pnpm --filter @sassy-auth/db db:seed
pnpm --filter @sassy-auth/db exec node scripts/print-app-public-id.cjs
cat /tmp/sassy-e2e-rs-client-id.txt
```

Update `SASSY_CLIENT_ID` on `sassy-resource-server` with the printed public ID.

The seed registers the app with URLs suitable for local dev. **Update the app in the admin console** (`/apps`) so:

- **URL:** `https://testapp.milissai.com`
- **Callback URL:** `https://testapp.milissai.com/auth/callback`

Production requires HTTPS with a public host (default behavior when `SASSY_AUTH_ALLOW_INSECURE_APP_URLS` is unset).

### Option B — manual registration

1. Sign in to https://auth.milissai.com as a platform admin.
2. Create an org and associate it with a new app.
3. Set **URL** to `https://testapp.milissai.com` and **Callback URL** to `https://testapp.milissai.com/auth/callback`.
4. Copy the app's public ID into `SASSY_CLIENT_ID` on Render.

### Verify the OAuth round-trip

1. Open https://testapp.milissai.com
2. Click login → redirects to auth-api → after sign-in, returns to `/auth/callback`
3. Call the protected endpoint:

   ```bash
   curl -H "Authorization: Bearer <token>" https://testapp.milissai.com/api/properties
   ```

---

## 6. Social sign-in (optional)

If enabling Google, Microsoft, or Apple, register redirect URIs with each provider:

```
https://auth-api.milissai.com/api/auth/callback/google
https://auth-api.milissai.com/api/auth/callback/microsoft
https://auth-api.milissai.com/api/auth/callback/apple
```

Full setup steps: [`docs/social-auth-setup.md`](docs/social-auth-setup.md).

Apple sign-in requires a publicly reachable HTTPS deployment and cannot be tested against `localhost`.

---

## 7. Operational notes

### Email

Production should use `RESEND_API_KEY` (or SMTP vars). Without either, the auth-server logs mail to stdout instead of sending it — invitations and password resets will not reach users.

Set `EMAIL_FROM` to an address your provider allows (e.g. `no-reply@milissai.com`).

### Observability

Optional Sentry and Datadog variables are documented in [README → Environment Variables](README.md#environment-variables). Leave blank to disable.

### Scaling

The auth-server and admin are independent web services and can be scaled separately on Render. Rate limiting is in-process today — see [Known Limitations](README.md#known-limitations) before running multiple auth-server instances.

### Key rotation

1. Generate a new RSA pair and a new `JWT_KEY_ID`.
2. Update env vars on `sassy-auth-server`.
3. Redeploy. Resource servers refresh JWKS when they encounter an unknown `kid`.

---

## 8. Local mock deployment (custom ports)

Use this layout to rehearse the production topology on one machine without occupying the default dev ports (`3000` / `3001`). It mirrors the three public URLs above but maps them to localhost with distinct ports.

| Role | Local URL | Port |
|------|-----------|------|
| Auth server | `http://localhost:3100` | 3100 |
| Admin console | `http://localhost:3101` | 3101 |
| Resource server | `http://localhost:8100` | 8100 |
| PostgreSQL | `localhost:5432` | 5432 |

You can point `DATABASE_URL` at a local Postgres instance or at Neon — both work.

### 8.1 PostgreSQL

**Local Postgres via Docker** (from the repo's main compose file — postgres is not published to the host by default; add `ports: ["5432:5432"]` under the `postgres` service in `docker-compose.yml`, or use your own Postgres 14+ install):

```bash
docker compose up -d postgres
createdb sassyauth   # if using a host-installed Postgres instead
```

**Neon:** use the same pooled connection string as production (simplest way to share schema state).

### 8.2 Root `.env.local`

Copy the example and set production-like URLs on custom ports:

```bash
cp .env.example .env.local
```

Edit `.env.local`:

```bash
# Database — local or Neon
DATABASE_URL="postgresql://sassy:sassy@localhost:5432/sassyauth"

# Generate RSA keys and BETTER_AUTH_SECRET (see §2)
RSA_PRIVATE_KEY="<base64-pkcs8>"
RSA_PUBLIC_KEY="<base64-spki>"
JWT_KEY_ID="sassy-auth-1"
BETTER_AUTH_SECRET="<random-32+-chars>"

# Mock "production" URLs on custom ports
BETTER_AUTH_URL="http://localhost:3100"
AUTH_SERVER_URL="http://localhost:3100"
PUBLIC_AUTH_SERVER_URL="http://localhost:3100"
ADMIN_URL="http://localhost:3101"
TRUSTED_ORIGINS="http://localhost:3101,http://localhost:8100"
LOGIN_NEXT_ALLOWED_ORIGINS="http://localhost:8100"

# Required when NODE_ENV=production; optional in development
SEED_ADMIN_PASSWORD="your-local-mock-password"

# Allow http://localhost app URLs in the admin console
SASSY_AUTH_ALLOW_INSECURE_APP_URLS="true"

# Optional — route mail to Mailpit (docker-compose.dev.yml)
EMAIL_SMTP_HOST=localhost
EMAIL_SMTP_PORT=1025
```

### 8.3 Install, migrate, seed

```bash
pnpm install
pnpm --filter @sassy-auth/db db:migrate
pnpm --filter @sassy-auth/db db:generate
SEED_DEMO=1 pnpm --filter @sassy-auth/db db:seed
pnpm --filter @sassy-auth/db exec node scripts/print-app-public-id.cjs
cat /tmp/sassy-e2e-rs-client-id.txt
```

Note the printed public ID for `SASSY_CLIENT_ID` in the next step.

### 8.4 Start the auth server (port 3100)

```bash
NODE_ENV=production PORT=3100 pnpm --filter @sassy-auth/auth-server build
NODE_ENV=production PORT=3100 pnpm --filter @sassy-auth/auth-server start
```

In a second terminal, start the admin console (port 3101):

```bash
NODE_ENV=production PORT=3101 pnpm --filter @sassy-auth/admin build
NODE_ENV=production PORT=3101 pnpm --filter @sassy-auth/admin exec next start -p 3101
```

> **Why `NODE_ENV=production`?** The session cookie's `Secure` flag is tied to production mode. On plain `http://localhost`, production mode prevents the cookie from being stored. For this mock over HTTP, either run with `NODE_ENV=development` (accepting dev cookie behavior) or terminate TLS locally (e.g. mkcert + Caddy). The Render deployment uses HTTPS, so production mode is correct there.

For a quick HTTP-only smoke test, use development mode:

```bash
PORT=3100 pnpm --filter @sassy-auth/auth-server dev
PORT=3101 pnpm --filter @sassy-auth/admin dev
```

### 8.5 Start the resource server (port 8100)

Create `apps/resource-server-fastapi/.env`:

```bash
AUTH_SERVER_URL=http://localhost:3100
ADMIN_URL=http://localhost:3101
SASSY_CLIENT_ID=<publicId-from-seed>
RS_BASE_URL=http://localhost:8100
REDIRECT_URI=http://localhost:8100/auth/callback
LOG_LEVEL=info
```

Register or update the app in the admin console (`http://localhost:3101/apps`) so **URL** is `http://localhost:8100` and **Callback URL** is `http://localhost:8100/auth/callback`.

Start the server:

```bash
cd apps/resource-server-fastapi
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -e ".[dev]"
uvicorn app.main:app --host 0.0.0.0 --port 8100 --reload
```

Or from the repo root:

```bash
pnpm setup:resource-server-fastapi
uv run --directory apps/resource-server-fastapi uvicorn app.main:app --host 0.0.0.0 --port 8100 --reload
```

### 8.6 Mock deployment checklist

| Step | URL / command |
|------|---------------|
| JWKS reachable | `curl http://localhost:3100/api/token/jwks` |
| OAuth metadata | `curl http://localhost:3100/.well-known/oauth-authorization-server` |
| Admin login | http://localhost:3101/login (`s@sa.io` / your seed password) |
| Resource server landing | http://localhost:8100 |
| PKCE login flow | Click **Login** on the landing page |
| Protected API | `curl -H "Authorization: Bearer <token>" http://localhost:8100/api/properties` |

### 8.7 Mapping mock ports → production URLs

When promoting from mock to Render, update every URL-shaped variable consistently:

| Mock (local) | Production (Render) |
|--------------|---------------------|
| `http://localhost:3100` | `https://auth-api.milissai.com` |
| `http://localhost:3101` | `https://auth.milissai.com` |
| `http://localhost:8100` | `https://testapp.milissai.com` |
| `SASSY_AUTH_ALLOW_INSECURE_APP_URLS=true` | unset |
| `NODE_ENV=development` (HTTP dev) | `NODE_ENV=production` |

---

## 9. Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Admin login succeeds then immediately logs out | `NODE_ENV=production` over plain HTTP | Use HTTPS (Render) or dev mode locally |
| OAuth `invalid_redirect_uri` | App URL / callback mismatch | Match `RS_BASE_URL` / `REDIRECT_URI` to the app row in admin |
| JWT `iss` verification fails | `BETTER_AUTH_URL` ≠ token issuer | Set `BETTER_AUTH_URL` to the public auth-api URL |
| CSRF / CORS errors from admin | Missing origin in `TRUSTED_ORIGINS` | Include `https://auth.milissai.com` |
| Seed throws on production deploy | Missing `SEED_ADMIN_PASSWORD` | Set a strong password in Render env |
| Migrations fail on deploy | Neon unreachable or wrong `DATABASE_URL` | Verify pooled URL, `sslmode=require` |
| Invitation emails not sent | No mail transport configured | Set `RESEND_API_KEY` or SMTP vars |

---

## 10. Files in this deployment

| File | Purpose |
|------|---------|
| [`render.yaml`](render.yaml) | Render Blueprint — three web services + shared env group |
| [`DEPLOYMENT.md`](DEPLOYMENT.md) | This guide |
| [`docker/Dockerfile.auth-server`](docker/Dockerfile.auth-server) | Production auth-server image |
| [`docker/Dockerfile.admin`](docker/Dockerfile.admin) | Production admin console image |
| [`apps/resource-server-fastapi/Dockerfile`](apps/resource-server-fastapi/Dockerfile) | Production resource-server image |
| [`.env.example`](.env.example) | Full environment variable catalog |
| [`docs/social-auth-setup.md`](docs/social-auth-setup.md) | Federated sign-in provider setup |

The existing [`Dockerfile`](Dockerfile) and [`docker-compose.yml`](docker-compose.yml) remain a **developer preview** (dev servers, single container). They are not used by the Render Blueprint, which builds compiled Node output and a native Python service instead.

Production-ready multi-stage images live under [`docker/`](docker/) and [`apps/resource-server-fastapi/Dockerfile`](apps/resource-server-fastapi/Dockerfile) — see [§11 Production Docker images](#11-production-docker-images).

---

## 11. Production Docker images

Multi-stage Dockerfiles build compiled artifacts (not dev servers). Each app is a separate image, matching the Render layout.

| Image | Dockerfile | Default port |
|-------|------------|--------------|
| Auth server | [`docker/Dockerfile.auth-server`](docker/Dockerfile.auth-server) | 3000 |
| Admin console | [`docker/Dockerfile.admin`](docker/Dockerfile.admin) | 3001 |
| Resource server | [`apps/resource-server-fastapi/Dockerfile`](apps/resource-server-fastapi/Dockerfile) | 8010 |

### Build

From the repository root:

```bash
docker build -f docker/Dockerfile.auth-server -t sassy-auth-server .
docker build -f docker/Dockerfile.admin -t sassy-auth-admin .
docker build -f apps/resource-server-fastapi/Dockerfile -t sassy-resource-server .
```

Pass build args to the admin image when you need client-inlined values at build time:

```bash
docker build -f docker/Dockerfile.admin \
  --build-arg NEXT_PUBLIC_ADMIN_CONTACT_EMAIL=ops@milissai.com \
  -t sassy-auth-admin .
```

### Run (example)

Set the same environment variables documented in [§4](#4-environment-variable-reference-production). Example with production URLs:

```bash
# Auth server — migrations run automatically on container start
docker run --rm -p 3000:3000 \
  -e DATABASE_URL="$DATABASE_URL" \
  -e RSA_PRIVATE_KEY="$RSA_PRIVATE_KEY" \
  -e RSA_PUBLIC_KEY="$RSA_PUBLIC_KEY" \
  -e BETTER_AUTH_SECRET="$BETTER_AUTH_SECRET" \
  -e BETTER_AUTH_URL="https://auth-api.milissai.com" \
  -e ADMIN_URL="https://auth.milissai.com" \
  -e TRUSTED_ORIGINS="https://auth.milissai.com,https://testapp.milissai.com" \
  -e SEED_ADMIN_PASSWORD="$SEED_ADMIN_PASSWORD" \
  sassy-auth-server

# Admin console
docker run --rm -p 3001:3001 \
  -e AUTH_SERVER_URL="https://auth-api.milissai.com" \
  -e PUBLIC_AUTH_SERVER_URL="https://auth-api.milissai.com" \
  -e ADMIN_URL="https://auth.milissai.com" \
  -e LOGIN_NEXT_ALLOWED_ORIGINS="https://testapp.milissai.com" \
  sassy-auth-admin

# Resource server
docker run --rm -p 8010:8010 \
  -e AUTH_SERVER_URL="https://auth-api.milissai.com" \
  -e ADMIN_URL="https://auth.milissai.com" \
  -e RS_BASE_URL="https://testapp.milissai.com" \
  -e REDIRECT_URI="https://testapp.milissai.com/auth/callback" \
  -e SASSY_CLIENT_ID="$SASSY_CLIENT_ID" \
  sassy-resource-server
```

Terminate TLS in front of these containers (load balancer, reverse proxy, or a platform like Render). Do not expose them on plain HTTP in production — admin session cookies require HTTPS when `NODE_ENV=production`.

The auth-server entrypoint ([`docker/entrypoint-auth-server-prod.sh`](docker/entrypoint-auth-server-prod.sh)) runs `prisma migrate deploy` before startup when `DATABASE_URL` is set. **Seeding is not automatic** — run [§3.4 First-time seed](#34-first-time-seed) manually.

### Use on Render instead of native buildpacks

To deploy via Docker on Render, change the service `runtime` in `render.yaml`:

```yaml
  - type: web
    name: sassy-auth-server
    runtime: docker
    dockerfilePath: ./docker/Dockerfile.auth-server
    dockerContext: .
    # remove buildCommand / startCommand — the Dockerfile defines them
```

Apply the same pattern for `sassy-auth-admin` and `sassy-resource-server` (using `apps/resource-server-fastapi/Dockerfile` with `dockerContext: .`).

### Local mock with Docker

To rehearse the [§8 local mock](#8-local-mock-deployment-custom-ports) using these images instead of `pnpm` directly, map the same custom ports and pass `http://localhost:…` URLs:

```bash
docker run --rm -p 3100:3000 -e PORT=3000 ... sassy-auth-server
docker run --rm -p 3101:3001 -e PORT=3001 ... sassy-auth-admin
docker run --rm -p 8100:8010 -e PORT=8010 ... sassy-resource-server
```

For HTTP-only local smoke tests, run with `NODE_ENV=development` omitted from the auth-server/admin images only if you rebuild without `ENV NODE_ENV=production` — the Dockerfiles set production mode by design. Prefer the `pnpm dev` flow in [§8.4](#84-start-the-auth-server-port-3100) for plain-HTTP development.

