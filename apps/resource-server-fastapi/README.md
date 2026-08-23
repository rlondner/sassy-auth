# resource-server-fastapi

A minimal Python/FastAPI OAuth 2.0 resource server that demonstrates how a non-Node consumer integrates with SassyAuth's authorization-code flow with PKCE (S256) and verifies the resulting RS256 JWT against the JWKS endpoint.

What it shows end-to-end:

- Starting an authorize redirect with a `code_verifier` / `code_challenge` pair.
- Round-tripping through the SassyAuth admin's `/login` page.
- Exchanging the authorization code for a JWT.
- Verifying the JWT signature using `PyJWKClient` against `GET /api/token/jwks`.
- Scope-gating a protected endpoint (`GET /api/properties` requires the `rs.properties.create` scope).

## Contents

- [Prerequisites](#prerequisites)
- [Environment Variables](#environment-variables)
- [Setup Path A — Use the demo seed (recommended)](#setup-path-a--use-the-demo-seed-recommended)
- [Setup Path B — Provision everything manually in the admin UI](#setup-path-b--provision-everything-manually-in-the-admin-ui)
- [Run the resource server](#run-the-resource-server)
- [Test authorized and unauthorized access](#test-authorized-and-unauthorized-access)
- [Tests](#tests)
- [Troubleshooting](#troubleshooting)

## Prerequisites

- Python 3.11 or newer.
- [`uv`](https://docs.astral.sh/uv/) for dependency management (the lockfile is checked in).
- A running SassyAuth stack:
  - `auth-server` on `http://localhost:3000`
  - `admin` console on `http://localhost:3001`
  - PostgreSQL with the migrations applied
- A browser-facing URL for this FastAPI app whose **origin** (scheme + host + port) matches the `url` field of the `resourceserver01` app row in the SassyAuth database. The auth-server enforces an origin match between the `redirect_uri` you send and the app's registered `url` — if they differ, the authorize call returns `400 invalid_redirect_uri`. Either:
  - Run a tunnel such as `ngrok http 8010` and use the tunnel URL, or
  - Use `http://localhost:8010` directly and make sure the `sa_app.url` row matches (see the setup paths below).

## Environment Variables

The app reads its configuration from `apps/resource-server-fastapi/.env`. Copy the example and fill in the values that match your stack:

```bash
cp apps/resource-server-fastapi/.env.example apps/resource-server-fastapi/.env
```

| Variable                  | Required | Description                                                                                                                                                |
|---------------------------|----------|------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `AUTH_SERVER_URL`         | yes      | Where this app reaches the SassyAuth API (JWKS fetch, token exchange). Same value as the auth-server's own `BETTER_AUTH_URL`. Default: `http://localhost:3000`. |
| `ADMIN_URL`               | yes      | Where this app sends the browser to authenticate. Default: `http://localhost:3001`.                                                                        |
| `SASSY_CLIENT_ID`         | yes      | The `publicId` (Sqid) of the `resourceserver01` row in `sa_app`. Look it up in the admin console at `http://localhost:3001/apps` after seeding. There is no fixed value — it depends on the row's auto-increment id and the `SQIDS_ALPHABET` setting in your SassyAuth `.env.local`. |
| `RS_BASE_URL`             | yes      | The browser-facing base URL of this app. Must match the `url` registered on the `resourceserver01` `sa_app` row.                                            |
| `REDIRECT_URI`            | yes      | The OAuth `redirect_uri` this app sends to SassyAuth on the authorize call. Must be `<RS_BASE_URL>/auth/callback` and share an origin with `RS_BASE_URL`.   |
| `EXPECTED_ISSUER`         | no       | Override for the JWT `iss` check. Defaults to `AUTH_SERVER_URL`. Set this if the auth-server's `BETTER_AUTH_URL` differs from what the verifier should expect (e.g. you run the auth-server behind its own proxy). |
| `EXPECTED_AUDIENCE`       | no       | Override for the JWT `aud` check. Defaults to `SASSY_CLIENT_ID`. Rarely needed.                                                                            |
| `PKCE_STATE_TTL_SECONDS`  | no       | How long a PKCE `state` is held in process memory before it's purged. Default: `600`.                                                                      |
| `LOG_LEVEL`               | no       | Standard Python log level. Default: `info`.                                                                                                                |

Note on the JWKS `kid`: SassyAuth signs JWTs with the `kid` set by its `JWT_KEY_ID` env var (default `sassy-auth-1`). `PyJWKClient` looks the key up by `kid` against the JWKS document — this app does not need to know the `kid` value itself; if the auth-server's signing `kid` ever changes, the JWKS is refreshed on the next mismatch.

## Setup Path A — Use the demo seed (recommended)

The auth-server ships an idempotent demo seed that provisions everything this sample needs in one command.

### 1. Run the demo seed

From the repo root:

```bash
SEED_DEMO=1 pnpm --filter @sassy-auth/auth-server seed
```

The seed creates:

- App **`resourceserver01`** (`isPlatform: false`). Its `url` field is currently hardcoded to a sample ngrok URL — see the next step.
- Org **`Citadel`** scoped to that app.
- Permissions: `rs.properties.{create,read,update,delete}` and `rs.inspections.{create,read,update,delete}` (8 total).
- Two roles:
  - **`Citadel Property Managers`** — granted all 8 permissions.
  - **`Citadel Inspectors`** — granted `rs.inspections.{create,read,update}` and `rs.properties.{read,update}` (no `create` / `delete`).
- Three BetterAuth users (all with password `Pass@word1234`), each linked to a `sa_user` in the `Citadel` org:
  - **`m@cpm.io`** ("Citadel Manager") — assigned the **Property Managers** role → JWT scope includes `rs.properties.create`.
  - **`i@cpm.io`** ("Citadel Inspector") — assigned the **Inspectors** role → JWT scope does **not** include `rs.properties.create`.
  - **`tfa@cpm.io`** ("Citadel TwoFactor") — same role as `m@cpm.io`, reserved for the end-to-end suite's two-factor tests. It exists so those tests can enrol an account in TOTP without leaving one of the two accounts above enrolled for every subsequent test. Ignore it when working through this walkthrough by hand.

The seed is idempotent: re-running it after the rows exist is a no-op.

### 2. Align the `sa_app.url` with where you will run this sample

The seed currently writes a fixed sample URL to `sa_app.url` for `resourceserver01`. If you are running this app at a different URL (for example `http://localhost:8010` or your own ngrok tunnel), update the row so the origin matches:

1. Sign in to the admin console at `http://localhost:3001/login` as a platform admin who can manage apps. The seed creates `a@sa.io` for that purpose (password `Pass@word1234`), or use `s@sa.io` (super admin).
2. Open **`/apps`**, click `resourceserver01`, set **URL** to your RS base URL (e.g. `http://localhost:8010`), and save.

The auth-server compares only the origin (scheme + host + port), so trailing paths on either side do not matter.

### 3. Copy the `publicId` into `SASSY_CLIENT_ID`

On the same `/apps` page, copy the `resourceserver01` row's **publicId** (a short Sqid like `84LRa`) and set it as `SASSY_CLIENT_ID` in `apps/resource-server-fastapi/.env`.

### 4. Fill in the remaining env vars

```dotenv
AUTH_SERVER_URL=http://localhost:3000
ADMIN_URL=http://localhost:3001
SASSY_CLIENT_ID=<the publicId you copied>
RS_BASE_URL=http://localhost:8010
REDIRECT_URI=http://localhost:8010/auth/callback
```

## Setup Path B — Provision everything manually in the admin UI

Use this path if you do not want to run the demo seed (for example, you want a different org / role / user shape). All steps are doable through the admin console after running the regular non-demo seed (`pnpm --filter @sassy-auth/db db:seed`).

Sign in to `http://localhost:3001/login` as `s@sa.io` / `Pass@word1234` (super admin from the platform seed).

1. **Create the app.** Open `/apps` → **New app**. Name it whatever you want (e.g. `resourceserver01`), set **URL** to your RS base URL (e.g. `http://localhost:8010`), and save. Copy the resulting **publicId** — that is your `SASSY_CLIENT_ID`.
2. **Create the permissions.** Open `/permissions`, filter by your new app, and create the 8 permissions the sample uses:
   - `rs.properties.create`, `rs.properties.read`, `rs.properties.update`, `rs.properties.delete`
   - `rs.inspections.create`, `rs.inspections.read`, `rs.inspections.update`, `rs.inspections.delete`

   You can use other names — just remember that this sample's protected endpoint requires `rs.properties.create`, so at least one role must include it.
3. **Create the org.** Open `/orgs` → **New org**, name it (e.g. `Citadel`), and scope it to the app you just created.
4. **Create two roles.** Open `/roles` → **New role**, scoped to your app:
   - One role that **includes** `rs.properties.create` (the authorized role). Assign the rest of the `rs.*` permissions too if you want full access.
   - One role that **excludes** `rs.properties.create` (the unauthorized role). Useful contents: `rs.inspections.{create,read,update}` and `rs.properties.{read,update}`.
5. **Create two users.** Open `/users` → **New user** twice, each in your new org:
   - A user assigned the authorized role (e.g. `m@cpm.io`).
   - A user assigned the unauthorized role (e.g. `i@cpm.io`).

   Creating a user issues an invitation URL. Open the URL printed in the admin console, set a password, and the account is activated. Both users in this sample are expected to use password `Pass@word1234` if you want the rest of the docs to apply unchanged.
6. **Fill in the env vars** (same as Setup Path A, step 4) using the `publicId` you copied in step 1.

## Run the resource server

From the repo root:

```bash
cd apps/resource-server-fastapi
uv sync
uv run uvicorn app.main:app --port 8010 --reload
```

`uv sync` installs the dependencies from `uv.lock` into a local `.venv/`. `uv run` activates that environment for the command.

If you set `RS_BASE_URL` to a tunnel URL (ngrok, Cloudflare Tunnel, etc.), point the tunnel at `localhost:8010` and open the tunnel URL in a browser.

## Test authorized and unauthorized access

1. Open the resource server's root page (`RS_BASE_URL/`) and click **Sign in**.
2. You are redirected to `http://localhost:3001/login?next=...` with a SassyAuth authorize URL pre-encoded in `next`.
3. Sign in as one of the two demo users and observe the result:

| User           | Password         | Role                        | `/api/properties` response |
|----------------|------------------|-----------------------------|----------------------------|
| `m@cpm.io`     | `Pass@word1234`  | `Citadel Property Managers` | `200` with `{ "result": "Authorized", "sub": "...", "org": "..." }` — the user's JWT carries `rs.properties.create` in `scope`. |
| `i@cpm.io`     | `Pass@word1234`  | `Citadel Inspectors`        | `403` with `{ "result": "Unauthorized", "reason": "insufficient_scope" }` — the role intentionally omits `rs.properties.create`. |

Other failure modes you can verify:

| Scenario                                              | Expected response                                                                 |
|-------------------------------------------------------|-----------------------------------------------------------------------------------|
| No `Authorization` header, or scheme other than `Bearer` | `401` with `{ "result": "Unauthorized", "reason": "invalid_token" }`              |
| Token signed by a different key (signature fails)     | `401 invalid_token`                                                               |
| Token whose `kid` is not in the auth-server's JWKS    | `401 invalid_token` (`PyJWKClient` cannot resolve the signing key)                |
| Token whose `iss` does not match `EXPECTED_ISSUER`    | `401 invalid_token`                                                               |
| Token whose `aud` does not match `EXPECTED_AUDIENCE`  | `401 invalid_token`                                                               |
| Expired token (`exp` in the past)                     | `401 invalid_token`                                                               |

The token endpoint (`GET /api/properties`) returns the verified JWT's `sub` and `org` claims on success, so you can confirm the right user/org pair was authenticated.

## Social sign-in

This sample requires **no code change** to support federated sign-in. `auth_login`
redirects to `/api/token/oauth/authorize`, which — for an unauthenticated caller —
bounces to the admin console's `/login` page. That page now renders the social
buttons (Google, Microsoft, Apple, plus a test-only `stub` provider) whenever the
app has one or more providers enabled, so this RS inherits federated sign-in for
free by driving the same authorize redirect it always has.

The demo seed provisions `social@cpm.io` as a dedicated link target in the
`Citadel` org (`Citadel Property Managers` role, same as `m@cpm.io`). It is kept
separate from `m@cpm.io` deliberately: linking a provider account to `m@cpm.io`
would persist across test runs and change what the password round-trip exercises
in the platform's e2e suite. Use `social@cpm.io` when you want to link/sign in
with a federated identity by hand instead.

The seed also enables the `stub` provider for `resourceserver01`, but only when
`E2E_STUB_IDP_URL` is set in the environment running the seed — the `stub`
provider is itself only ever offered to a browser when `E2E_STUB_IDP_URL` is set
and `NODE_ENV` is `test` or `development`, so this row is inert (and harmless to
leave seeded) everywhere else.

### Telling password and federated sign-in apart

The authorized page (`/auth/callback` on success) renders two additional claims
from the access token, decoded for display only (the auth-server already
verified the token during the code exchange):

| Claim | `data-testid`  | Password sign-in | Federated sign-in |
|-------|----------------|-------------------|--------------------|
| `amr` | `claim-amr`    | `pwd`             | `ext`              |
| `idp` | `claim-idp`    | `—` (absent claim)| the provider name, e.g. `stub` |

A token without an `idp` claim (every password sign-in) renders the `—`
placeholder rather than the literal string `None` or a blank cell.

## Tests

```bash
uv run pytest
```

The test suite is in `tests/`. It exercises the verifier behavior (kid resolution, signature, claim checks, scope gating) against a locally generated keypair, with no network calls to the real auth-server.

## Troubleshooting

- **`401` immediately after sign-in, before any role check.** The most common cause is a `kid` mismatch between the JWT header and the JWKS. Check that the auth-server has `JWT_KEY_ID` set consistently (defaults to `sassy-auth-1`) and that `GET <AUTH_SERVER_URL>/api/token/jwks` returns a key with that same `kid`.
- **`400 invalid_redirect_uri` from the authorize call.** The origin of your `REDIRECT_URI` does not match the `url` field on the `sa_app` row. Update the app's URL in the admin console under `/apps`.
- **`401 invalid_token` with an obviously valid-looking token.** Decode the token (e.g. <https://jwt.io>) and compare `iss` and `aud` against `EXPECTED_ISSUER` (defaults to `AUTH_SERVER_URL`) and `EXPECTED_AUDIENCE` (defaults to `SASSY_CLIENT_ID`). Common cause: the auth-server's `BETTER_AUTH_URL` is a different host than the URL this app uses for `AUTH_SERVER_URL`.
- **`Pending` user status in the admin UI.** Created users land in `status: pending` until they accept the invite. If you provisioned users via Setup Path B, follow the printed invitation URL and set a password before testing.
