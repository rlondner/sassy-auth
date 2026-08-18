# Dev-environment insecure URLs + per-app callback URL enforcement

**Date:** 2026-06-29
**Status:** Approved (design)
**Branch:** `feat/dev-insecure-urls-callback`

## Problem

Two related gaps in how apps (resource servers) are registered and how their
OAuth/PKCE redirects are validated:

1. **No way to register non-https / localhost apps for local development.** App
   URL validation is static. In practice this blocks registering a `http://localhost`
   resource server while developing, yet today the validation also silently accepts
   `http` URLs in production (no environment gating at all).
2. **No per-app callback URL enforcement.** During the PKCE authorize/token flow,
   the `redirect_uri` is only checked to share the same **origin** as the app's
   `url`. There is no way for an app to pin an exact callback URL.

## Goals

- Permit `http` and localhost/loopback app URLs **only** when sassy-auth is
  explicitly configured as a dev environment; enforce https + public host otherwise.
- Add an optional per-app `callbackUrl`. When set, the PKCE `redirect_uri` must
  match it exactly (trailing-slash tolerant). When left as "default" (unset),
  preserve today's origin-match behavior.

## Non-goals

- Multiple registered redirect URIs per app (single optional callback URL only).
- Changing the Sqid `client_id` scheme, PKCE method (`S256`), or code TTLs.
- Open-redirect "accept any redirect_uri" mode — default still enforces origin match.

## Current state (as of this branch)

- `SaApp` columns: `id`, `publicId`, `name`, `url`, `isPlatform`. No callback field.
- `apps/auth-server/src/apps/dto/create-app.dto.ts` &
  `update-app.dto.ts`: `@IsUrl({ require_protocol: true, protocols: ['https','http'] })`
  on `url`. class-validator's default `require_tld: true` rejects `localhost`.
- `apps/auth-server/src/token/redirect-uri.ts`:
  `assertRedirectUriMatchesApp(redirectUri, appUrl)` compares `new URL(x).origin`.
- Called from `apps/auth-server/src/token/token.controller.ts` in both the
  `oauth/authorize` and `oauth/token` handlers.
- Dev vs prod is only distinguished today via `NODE_ENV` (logging, Sentry).
- Admin UI: `app-create-drawer.tsx`, `app-edit-drawer.tsx`, `app-view-drawer.tsx`;
  types in `apps/admin/lib/types.ts`; server actions in
  `apps/admin/app/(admin)/apps/actions.ts`; copy in `apps/admin/messages/en.json`.

## Design

### 1. Configuration & environment gating

New env var:

- **`SASSY_AUTH_ALLOW_INSECURE_APP_URLS`** — boolean, default `false`.

A small config helper, e.g. `isInsecureAppUrlsAllowed(): boolean`, reads this var
and is the single source of truth consulted by both DTO validation and the auth
flow. Defaulting to `false` means production stays secure unless insecure URLs are
deliberately enabled (independent of `NODE_ENV`).

- `false` (default / production): app `url` and `callbackUrl` must be **https**
  and must **not** be localhost / loopback / bare-host (no-TLD).
- `true` (dev): allow `http`/`https`; allow `localhost` / `127.0.0.1` / `::1` /
  no-TLD hosts.

Documented in `.env.example`.

### 2. Data model & validation

**Schema** (`packages/db/schema.prisma`, `SaApp`): add

- `callbackUrl String?` — `NULL`/empty = "default" (origin-match against `url`).
  A non-empty value triggers exact-match enforcement.

Prisma migration adds the nullable column; existing apps get `NULL` and keep
current behavior.

**Validation** — replace the static `@IsUrl(...)` on `url` and the new optional
`callbackUrl` with a **custom class-validator constraint** that consults
`isInsecureAppUrlsAllowed()`:

- Secure mode: require `https`; reject localhost/loopback/no-TLD hosts.
- Insecure mode: allow `http`/`https`; allow localhost/loopback/no-TLD.
- `callbackUrl` is optional; empty/omitted is valid (= default). When present it
  must be a full, well-formed URL including path (matching is exact).
- Applied in `CreateAppDto` and `UpdateAppDto`.

This **tightens** production (today `http` is silently accepted). Verify seeds and
test fixtures do not rely on `http`/localhost URLs while in secure mode.

### 3. PKCE redirect_uri enforcement

Rework `redirect-uri.ts` to validate against the app (e.g.
`assertRedirectUriAllowed(redirectUri, app)`):

- **`app.callbackUrl` set (non-empty):** require `redirect_uri` to **exactly equal**
  `callbackUrl`, with **trailing-slash tolerance**. Normalization: parse both URLs;
  compare scheme, host, port, and query exactly; for the path, trim a single
  trailing `/` on both sides before comparing (so `/cb` == `/cb/`). Mismatch →
  `INVALID_REDIRECT_URI`.
- **`app.callbackUrl` empty (default):** fall back to today's **origin match**
  against `app.url`.
- Preserve the existing audit log line for rejected redirect URIs (attempted origin).
- Called from both the `oauth/authorize` and `oauth/token` handlers in
  `token.controller.ts` (token endpoint re-validates with the same rule).

### 4. Admin UI

- Add optional **Callback URL** field (`callbackUrl`) to `App`, `CreateAppPayload`,
  `UpdateAppPayload` (`apps/admin/lib/types.ts`), the create drawer, and the edit
  drawer. Empty input = "default".
- Field helper text: *"Leave blank to accept any callback under the app's URL. Set
  a full URL to require an exact redirect_uri match."*
- View drawer shows the callback URL, or a **"Default (any path under app URL)"**
  badge when unset.
- Update error copy: the existing `apps.errors.urlInvalid` no longer hard-codes
  "including https://". Add a distinct `apps.errors.urlInsecure` ("In production,
  app URLs must use https and a public host.") mapped from the 400 path in
  `actions.ts`. Add a callback-url-specific validation message.

### 5. Testing

- **Unit — URL validation constraint:** secure mode rejects http/localhost/no-TLD,
  accepts https public; insecure mode accepts http/localhost. Toggle via mocked
  config helper / env.
- **Unit — `assertRedirectUriAllowed`** (extends `redirect-uri.spec.ts`):
  callbackUrl set → exact match passes, trailing-slash variant passes, differing
  path/query/host/scheme/port fails; callbackUrl empty → origin-match behavior
  preserved.
- **Integration — apps DTO:** create/update rejects insecure URLs in secure mode
  (400), accepts in insecure mode; optional callbackUrl accepted when valid,
  rejected when malformed.
- **E2E/admin (light):** create app with a callback URL persists and renders;
  default shows the "any path" badge.
- Confirm seeds/fixtures pass under the now-stricter prod validation.

## Risks & mitigations

- **Tightening prod URL validation could reject existing http apps.** Mitigation:
  audit seeds/fixtures; the insecure flag provides an escape hatch; document in
  CHANGELOG.
- **Exact-match callback could break apps using dynamic callback paths.** Mitigation:
  feature is opt-in per app; default behavior unchanged.

## Affected files (anticipated)

- `packages/db/schema.prisma` + new migration
- `apps/auth-server/src/apps/dto/create-app.dto.ts`, `update-app.dto.ts`
- new config helper (auth-server common/config) + custom validator
- `apps/auth-server/src/token/redirect-uri.ts` (+ `.spec.ts`)
- `apps/auth-server/src/token/token.controller.ts`
- `apps/admin/lib/types.ts`, `app-create-drawer.tsx`, `app-edit-drawer.tsx`,
  `app-view-drawer.tsx`, `app/(admin)/apps/actions.ts`, `messages/en.json`
- `.env.example`, `CHANGELOG.md`
