# Resource Server (FastAPI) — OAuth2 + PKCE against SassyAuth

Date: 2026-06-02
Status: Approved
Author: Claude + Raphael Londner

## Summary

Add a Python/FastAPI resource server to the monorepo at `apps/resource-server-fastapi/`, listening on port 8010 and exposed via the already-registered ngrok URL `https://cheryl-crescentlike-monte.ngrok-free.dev`. The RS authenticates users against SassyAuth (auth-server on 3000, admin UI on 3001) using OAuth 2.0 authorization-code flow with PKCE (S256). It receives an RS256 JWT whose `scope` claim carries the user's effective SassyAuth permissions, verifies the token via the auth-server's JWKS, and gates a dummy `/api/properties` endpoint on the `rs.properties.create` scope.

The two demo users behave as follows:

- `m@cpm.io` ("Citadel Manager", role `Citadel Property Managers`) — has `rs.properties.create` → "Authorized".
- `i@cpm.io` ("Citadel Inspector", role `Citadel Inspectors`) — lacks `rs.properties.create` → "Unauthorized".

## Scope

In scope:

- New Python/FastAPI app at `apps/resource-server-fastapi/` with PKCE-driven OAuth2 client, JWT verification via JWKS, one protected endpoint, and minimal HTML pages.
- Auth-server PKCE support (S256), JWT claim shape change (`permissions: string[]` → `scope: string`), and exact-origin redirect-uri validation against the registered app URL.
- Admin login page support for a validated `next` URL.
- An idempotent `SEED_DEMO=1` seed that reproduces the live `resourceserver01` / `Citadel` / users / roles / permissions structure on fresh databases.

Out of scope (deferred):

- Refresh tokens, token revocation.
- Multi-instance PKCE state storage (currently in-process maps).
- Sentry instrumentation for the FastAPI app.
- Migrating any other consumers of the previous `permissions` JWT claim — confirmed there are none outside the auth-server's own tests.
- Replacing the admin `/login?next=` pattern with a dedicated admin `/oauth/authorize` proxy page.

## Architecture

Three apps participate, all reached through the user's browser:

```
Browser (cheryl-...ngrok-free.dev)
  │
  │ 1. GET /
  ├──────────────────────────────────────────────────────────────►  FastAPI RS (8010)
  │◄── index.html with Sign In button ─────────────────────────────
  │
  │ 2. click Sign In  →  /auth/login on RS
  │ RS generates PKCE verifier + state, stores PENDING[state],
  │ redirects browser to:
  │   http://localhost:3001/login
  │     ?next=http://localhost:3000/api/token/oauth/authorize
  │           ?client_id=<app.publicId>
  │           &redirect_uri=https://cheryl-...ngrok-free.dev/auth/callback
  │           &state=<random>
  │           &code_challenge=<S256>&code_challenge_method=S256
  │
  │ 3. POST /login with credentials  →  admin (3001)
  │ admin calls POST /api/auth/sign-in/email on auth-server (3000),
  │ receives BetterAuth session cookie, forwards Set-Cookie to browser,
  │ validates `next` against AUTH_SERVER_URL allowlist, redirects to <next>.
  │
  │ 4. GET <next> on auth-server (cookie sent — same host "localhost")
  │ auth-server validates session, validates redirect_uri origin,
  │ stores PKCE challenge with code, redirects browser to redirect_uri with ?code=…
  │
  │ 5. GET /auth/callback?code=…&state=…  →  RS
  │ RS pops PENDING[state], POSTs /api/token/oauth/token with
  │   { code, code_verifier, client_id, redirect_uri }
  │ auth-server verifies sha256(verifier) == stored challenge, mints RS256 JWT.
  │ RS renders authorized.html with JWT embedded in <script type="application/json">.
  │
  │ 6. Browser stashes JWT in sessionStorage, fetches /api/properties
  │ with Authorization: Bearer <jwt>.
  │ RS verifies JWT via cached JWKS, checks "rs.properties.create" in scope,
  │ returns 200 Authorized | 403 Unauthorized.
```

### Cookie scope assumption (load-bearing)

BetterAuth's session cookie is set by the admin signIn server action on host `localhost` without a `Domain` attribute → host-only cookie. Browsers do not include the port in cookie host matching (RFC 6265 §4.1.2.4), so a cookie set on `localhost:3001` is sent to `localhost:3000`. This is what makes the chosen "RS builds admin URL with `next=`" Sign-In flow viable without cookie-domain changes.

## Live state replicated by the demo seed

Verified against the live DB on 2026-06-02:

- `SaApp resourceserver01` — `publicId=84LR`, `url=https://cheryl-crescentlike-monte.ngrok-free.dev/`, `isPlatform=false`.
- `SaOrg Citadel` — `publicId=PwVN`, `appId=resourceserver01`.
- 8 permissions on resourceserver01: `rs.properties.{create,read,update,delete}`, `rs.inspections.{create,read,update,delete}`.
- 2 roles:
  - `Citadel Property Managers` (`icxD`) — all 8.
  - `Citadel Inspectors` (`6bRg`) — `rs.inspections.{create,read,update}`, `rs.properties.{read,update}`.
- 2 users (both `active`, in Citadel):
  - `m@cpm.io` "Citadel Manager" — role `Citadel Property Managers`, no direct perms.
  - `i@cpm.io` "Citadel Inspector" — role `Citadel Inspectors`, no direct perms.

Note: the existing `SaUser.publicId` values for these two are UUID-style (created via admin UI), not Sqids. The seed leaves existing rows untouched and uses Sqid PIDs only when creating new ones on a fresh DB.

App `url` has a trailing slash. Origin-only matching (`new URL(url).origin`) makes this irrelevant; left as-is.

## Auth-server changes

### A. PKCE on the OAuth endpoints

Files: `apps/auth-server/src/token/oauth.service.ts`, `token.controller.ts`, `dto/oauth-token-exchange.dto.ts`.

- `OauthService` stores `{ userId, appPublicId, codeChallenge, codeChallengeMethod, expiresAt }` per code (was: just `userId/appPublicId/expiresAt`).
- `generateCode(userId, appPublicId, codeChallenge, codeChallengeMethod)` — method is fixed to `S256`; we reject `plain`.
- `exchangeCode(code, clientId, codeVerifier)` — computes `base64url(sha256(codeVerifier))` and uses `crypto.timingSafeEqual` against the stored challenge. PKCE mismatch, unknown code, expired code, and double-consume all now throw `UnauthorizedException(invalid_grant)` — the previous `INVALID_CODE` and `CODE_EXPIRED` codes are collapsed into `invalid_grant` to match RFC 6749 §5.2. Client/code mismatch (wrong `client_id` for the code) → `unauthorized_client`.
- `TokenController.oauthAuthorize` requires `code_challenge` (string, IsNotEmpty) and `code_challenge_method=S256` (string, equals `S256`). Missing/invalid → `BadRequestException(invalid_request)`.
- `TokenController.oauthToken`:
  - DTO change: replace `client_secret` with `code_verifier` (string, IsNotEmpty). Keep `code`, `client_id`, `redirect_uri`.
  - Body's `redirect_uri` must still origin-match the registered `app.url` (cross-validation; see B).

### B. Redirect URI origin match

New helper `apps/auth-server/src/token/redirect-uri.ts`:

```ts
export function assertRedirectUriMatchesApp(redirectUri: string, appUrl: string): void
```

- Parse both with `new URL(...)`. If either fails → `BadRequestException(invalid_redirect_uri)`.
- Compare `.origin` (scheme + host + port). Mismatch → `BadRequestException(invalid_redirect_uri)`.
- Used by both `oauthAuthorize` and `oauthToken`.

### C. JWT claim change

File: `apps/auth-server/src/token/token.service.ts`.

- `issueJwt(...)` resolves permissions as today, then writes `scope: permissions.join(' ')` (sorted, deduped — `resolvePermissions` already returns sorted unique) instead of `permissions: string[]`.
- Update assertions:
  - `apps/auth-server/src/token/token.service.spec.ts`
  - `apps/auth-server/test/app.e2e-spec.ts`

Confirmed via grep that the `permissions` JWT claim has no other readers in the codebase outside these two test files.

### D. Demo seed

New file: `apps/auth-server/src/seed/demo-resource-server.ts`. Invoked from existing `seed.ts` when `process.env.SEED_DEMO === '1'`.

Idempotent (`findFirst → create`). Produces the live state described above. For BetterAuth users, uses `auth.api.signUpEmail` (same as platform seed) with password `Pass@word1234`, then sets `emailVerified=true`. Assigns roles via `SaUserRole`.

Existing rows are not modified (no PID rewriting). On fresh DBs, new PIDs are Sqid-encoded using the existing pattern.

### E. New error codes

Added to `packages/types/src/index.ts` (or wherever `TokenErrorCode` lives — same module as today):

- `INVALID_REQUEST = 'invalid_request'`
- `INVALID_REDIRECT_URI = 'invalid_redirect_uri'`
- `INVALID_GRANT = 'invalid_grant'`
- `UNAUTHORIZED_CLIENT = 'unauthorized_client'`

`APP_NOT_FOUND`, `USER_NOT_FOUND`, `USER_ORG_MISMATCH` stay. `INVALID_CODE` and `CODE_EXPIRED` are removed (collapsed into `INVALID_GRANT` per RFC 6749 §5.2). Update references in tests and `@sassy-auth/types`.

## Admin app changes

### A. `/login` honors a `next` URL

Files: `apps/admin/app/login/page.tsx`, `apps/admin/app/login/actions.ts`.

- `page.tsx`: read `next` from `useSearchParams()`; render as `<input type="hidden" name="next" value={next ?? ''} />` inside the form.
- `actions.ts` `signIn(formData)`:
  - Read `next` from `formData`.
  - On successful cookie-set, call `validateNextUrl(next)`.
  - If result is non-null → `redirect(result)`; else → `redirect('/users')`.

### B. Origin allowlist

New file `apps/admin/lib/safe-next.ts`:

```ts
export function validateNextUrl(next: string | null | undefined): string | null
```

Rules:

- Empty/missing → `null`.
- If `next` starts with `/` and contains no `\\` or `//` → return as-is (same-origin path).
- Try `new URL(next)`. Parse fail → `null`.
- If `url.username` or `url.password` non-empty → `null` (no userinfo).
- If `url.origin` ∈ allowlist (always `process.env.AUTH_SERVER_URL`, plus split-and-trim of `process.env.LOGIN_NEXT_ALLOWED_ORIGINS`) → return `url.toString()`.
- Else → `null`.

### C. Unit test

`apps/admin/lib/safe-next.spec.ts` — same-origin path accepted, allowed absolute URL accepted, disallowed origin rejected, malformed URL rejected, userinfo rejected, `null` input returns `null`.

## FastAPI resource server

### Layout

```
apps/resource-server-fastapi/
  pyproject.toml
  uv.lock
  .env.example
  README.md
  app/
    __init__.py
    main.py
    config.py
    oauth/
      __init__.py
      pkce.py
      verifier.py
      routes.py
    api/
      __init__.py
      routes.py
    web/
      __init__.py
      routes.py
    templates/
      index.html
      authorized.html
      error.html
    static/
      app.js
      app.css
  tests/
    __init__.py
    test_pkce.py
    test_verifier.py
    test_api_properties.py
```

Dependencies (in `pyproject.toml`):

- `fastapi>=0.115`
- `uvicorn[standard]>=0.32`
- `httpx>=0.27`
- `pyjwt[crypto]>=2.9`
- `python-dotenv>=1.0`
- `pydantic-settings>=2.5`
- `jinja2>=3.1`
- `itsdangerous>=2.2` — optional, only included if we later switch `state` to a signed token instead of an in-process map. Not used in v1; listed here for visibility but omitted from `pyproject.toml`.

Dev deps:

- `pytest>=8`
- `pytest-asyncio>=0.24`
- `cryptography>=43` (for generating local RSA keys in tests)

### Configuration

`app/config.py` (`pydantic-settings.BaseSettings`):

- `AUTH_SERVER_URL` — default `http://localhost:3000`.
- `ADMIN_URL` — default `http://localhost:3001`.
- `SASSY_CLIENT_ID` — required (e.g. `84LR`).
- `REDIRECT_URI` — required (e.g. `https://cheryl-crescentlike-monte.ngrok-free.dev/auth/callback`).
- `RS_BASE_URL` — required (e.g. `https://cheryl-crescentlike-monte.ngrok-free.dev`).
- `EXPECTED_ISSUER` — default = `AUTH_SERVER_URL`.
- `EXPECTED_AUDIENCE` — default = `SASSY_CLIENT_ID`.
- `PKCE_STATE_TTL_SECONDS` — default `600`.
- `LOG_LEVEL` — default `info`.

### PKCE

`app/oauth/pkce.py`:

- `generate_verifier() -> str` — 64 random bytes from `secrets.token_bytes(64)`, base64url-encoded without padding (96 chars).
- `challenge_s256(verifier: str) -> str` — `base64url(sha256(verifier.encode('ascii')))` without padding.

In-process pending-state map in `app/oauth/routes.py`:

```py
PENDING: dict[str, tuple[str, float]] = {}  # state -> (verifier, created_at)
```

- Insertion lazily evicts entries older than `PKCE_STATE_TTL_SECONDS`.
- Lookup is `pop()` (single-use).
- Single-instance only; documented in module docstring.

### Routes

`app/oauth/routes.py`:

- `GET /auth/login` — builds PKCE state, stores PENDING, redirects to `${ADMIN_URL}/login?next=${urlencode(authorize_url)}`.
- `GET /auth/callback?code=&state=` — pops PENDING, POSTs token endpoint, renders `authorized.html` or `error.html`.

`app/api/routes.py`:

- `GET /api/properties` — depends on `require_scope("rs.properties.create")`; returns `{"result": "Authorized", "sub", "org"}` on success.

`app/web/routes.py`:

- `GET /` — renders `index.html`.

`app/main.py` — `FastAPI()`, mounts static + templates, includes the three routers, configures JSON logging, and exposes a `if __name__ == "__main__":` uvicorn entry as a convenience.

### JWT verifier

`app/oauth/verifier.py`:

- Module-level `_jwks_client = jwt.PyJWKClient(f"{settings.AUTH_SERVER_URL}/api/token/jwks", cache_keys=True, lifespan=600)`.
- `verify(token: str) -> dict`:
  - `signing_key = _jwks_client.get_signing_key_from_jwt(token).key`.
  - `claims = jwt.decode(token, signing_key, algorithms=['RS256'], audience=settings.EXPECTED_AUDIENCE, issuer=settings.EXPECTED_ISSUER, options={'require': ['exp','iat','sub','iss','aud','scope']})`.
  - On any failure: `raise HTTPException(status_code=401, detail={'result':'Unauthorized','reason':'invalid_token'})`.
- `require_scope(required: str)` returns a FastAPI dependency that:
  - Reads `Authorization: Bearer <jwt>` (missing → 401).
  - Calls `verify`.
  - Splits `claims['scope']` on space; if `required` not in set → `HTTPException(403, {'result':'Unauthorized','reason':'insufficient_scope'})`.
  - Returns `claims`.

### Templates

`templates/index.html`:

- Branding, title, a single button: `<a href="/auth/login">Sign In with SassyAuth</a>`.
- If a previous session left a JWT in sessionStorage, also show a "Test /api/properties" button that triggers the fetch (so a user can re-test without re-logging in).

`templates/authorized.html`:

- Server-renders the token in a `<script type="application/json" id="token-data">{{ token_json|safe }}</script>` block, where `token_json` is built with `json.dumps` (escapes already correctly).
- `static/app.js` reads `#token-data`, sets `sessionStorage.sa_access_token`, calls `fetch('/api/properties', { headers: { Authorization: 'Bearer ' + token }})`, and writes `Authorized` or `Unauthorized` into `<div id="result">` based on response status. Also displays decoded `sub`, `org`, and the space-separated scopes for inspection.
- Sign Out link clears sessionStorage and links back to `/`.

`templates/error.html`:

- Renders a human-readable error message with optional `reason` code from the auth-server.

### Run + dev story

```
cd apps/resource-server-fastapi
uv sync
cp .env.example .env  # then edit SASSY_CLIENT_ID etc.
uv run uvicorn app.main:app --port 8010 --reload
```

The top-level `README.md` gets a one-paragraph pointer to this app.

## Error surface

### Auth-server

| HTTP | Code | Endpoint | Trigger |
|---|---|---|---|
| 400 | `invalid_request` | `/oauth/authorize` | Missing `code_challenge` or `code_challenge_method ≠ S256` |
| 400 | `invalid_redirect_uri` | both | `redirect_uri` origin ≠ `app.url` origin |
| 401 | `invalid_grant` | `/oauth/token` | PKCE mismatch, code expired, code already consumed |
| 401 | `unauthorized_client` | `/oauth/token` | `client_id` ≠ code's `appPublicId` |
| 401 | (unchanged) | `/oauth/authorize` | No BetterAuth session |
| 403 | `USER_ORG_MISMATCH` | `/oauth/authorize` | session user not in app's org |

### FastAPI

| HTTP | Body | Trigger |
|---|---|---|
| 200 | `{"result":"Authorized","sub","org"}` | `/api/properties` scope check passes |
| 401 | `{"result":"Unauthorized","reason":"invalid_token"}` | Missing/bad bearer, expired, wrong iss/aud |
| 403 | `{"result":"Unauthorized","reason":"insufficient_scope"}` | Scope check fails |
| 400 | HTML error page | callback with unknown/expired `state` |
| 400 | HTML error page (with auth-server reason) | token exchange non-2xx |

## Observability

- Auth-server (winston):
  - `OAuth authorization code issued` — add `pkceMethod`, `redirectUriOrigin`.
  - `OAuth code exchanged, JWT issued` — add `pkceMethod`.
  - New `oauth.pkce.verify_failed` warn with `appId`, `userId` (from the code record). Never log the verifier or challenge.
  - Add `oauth.redirect_uri.rejected` warn with `appId`, attempted origin.
- FastAPI: stdlib logging with JSON formatter (one-screen helper in `app/main.py`). Event types:
  - `auth.login.start` — `state` only.
  - `auth.callback.success` — `sub`, `org`, `scope_count`.
  - `auth.callback.error` — `state`, `reason`.
  - `api.properties.granted` / `api.properties.denied` — `sub`, `reason`.

## Security checks codified by the plan

- PKCE challenge stored only in-memory on the auth-server, alongside the code; removed on consumption or expiry. No DB write.
- FastAPI `PENDING[state]` is single-use and lazily purged.
- Constant-time PKCE comparison (`crypto.timingSafeEqual` server side).
- JWKS cached 10 min; on `kid` miss, force refresh once.
- HTML embed of JWT uses `<script type="application/json">` + escaped `json.dumps`; JS reads from DOM, never from inlined source.
- Admin `next` URL strictly validated: same-origin paths, or absolute URLs whose origin is in `AUTH_SERVER_URL` (+ optional `LOGIN_NEXT_ALLOWED_ORIGINS`). Userinfo rejected.

## Validation plan

### Manual

1. `SEED_DEMO=1 pnpm --filter @sassy-auth/auth-server seed` — completes cleanly against the live DB (idempotency).
2. Start auth-server (3000), admin (3001), FastAPI (8010), and ngrok tunnel.
3. Open `https://cheryl-crescentlike-monte.ngrok-free.dev/` in a clean browser.
4. Click Sign In → confirm browser lands on `http://localhost:3001/login?next=<authorize_url>`.
5. Sign in as `m@cpm.io` / `Pass@word1234`. Confirm: bounced through authorize → callback → page shows **Authorized**.
6. Devtools: `sessionStorage.sa_access_token` set; `/api/properties` request has `Authorization: Bearer …`; response 200.
7. Decoded JWT: `aud=84LR`, `org=PwVN`, `scope` includes `rs.properties.create`, no `permissions` claim.
8. Sign out, sign in as `i@cpm.io`. Page shows **Unauthorized**, request 403, JWT lacks `rs.properties.create` in `scope`.
9. Tamper: edit `sessionStorage.sa_access_token` (one char flip), reload → 401, Unauthorized.
10. PKCE tamper: at callback, mutate `code` → token endpoint returns `invalid_grant`; FastAPI renders error page.
11. Redirect-uri tamper: hit `/api/token/oauth/authorize?...&redirect_uri=https://evil.example.com/cb` → 400 `invalid_redirect_uri`.
12. Cookie reuse: after step 5, navigate directly to `http://localhost:3001/users` → logged in (proves localhost cross-port cookie sharing).

### Automated

- Auth-server unit (`apps/auth-server/`):
  - `src/token/oauth.service.spec.ts` — PKCE happy/mismatch/expired/double-consume.
  - `src/token/token.service.spec.ts` — JWT has `scope` (string), not `permissions` (array).
  - `src/token/redirect-uri.spec.ts` — origin match cases incl. trailing slash on `app.url`.
- Auth-server e2e: `test/app.e2e-spec.ts` — full PKCE authorize→token round-trip; assert `scope` claim shape.
- Admin unit: `apps/admin/lib/safe-next.spec.ts`.
- FastAPI: `tests/test_pkce.py`, `tests/test_verifier.py`, `tests/test_api_properties.py` (described in app/FastAPI section).

## Open questions

None outstanding. All architecture decisions have been resolved through brainstorming:

- App placement: `apps/resource-server-fastapi/`.
- Sign-in flow: RS builds `${ADMIN_URL}/login?next=<authorize_url>`.
- JWT claim: `scope` (space-separated) replaces `permissions: string[]`.
- Client auth: PKCE S256 (no client secret).
- Seed: idempotent demo-seed gated on `SEED_DEMO=1`, replicating the live `resourceserver01` / `Citadel` structure.
- Browser session storage: JWT in `sessionStorage`, sent as `Authorization: Bearer`.
- Redirect URI: exact origin match against `sa_app.url`.
