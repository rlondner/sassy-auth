# OIDC compatibility

**Date:** 2026-08-21
**Status:** Approved design, not yet implemented

## Goal

Make standard OpenID Connect client libraries — Auth.js/next-auth, `openid-client`,
Spring Security, `oidc-client-ts` — work against SassyAuth with no
SassyAuth-specific configuration.

This is compatibility, not certification. We do not run the OpenID Foundation
conformance suite and do not submit self-certification paperwork. Both remain
open as later decisions, and this work is a prerequisite for either.

### Acceptance criterion

A stock `openid-client` completes discovery → authorize → code exchange →
`id_token` validation → `/userinfo` → logout without a workaround. If the
library needs special-casing to pass, this project has not met its goal even if
every test is green.

### Non-goals

- **Certification.** No conformance suite, no OIDF submission.
- **Refresh tokens and `offline_access`.** Deferred to its own spec. Access
  tokens remain one hour with no refresh grant. `offline_access` is not
  advertised.
- **Back-channel and front-channel logout.** RP-initiated logout only.
- **Token introspection and revocation endpoints.**
- **Hybrid and implicit flows.** `response_type=code` only.

## Current state

SassyAuth is an OAuth 2.0 authorization server:

- `GET /api/token/oauth/authorize` and `POST /api/token/oauth/token`
- `authorization_code` with mandatory PKCE (`S256`), public clients only
- RS256 access tokens verified against `GET /api/token/jwks`
- RFC 8414 metadata at `/.well-known/oauth-authorization-server`

Gaps: no `id_token`, no `openid` scope handling, no `nonce`, no `/userinfo`, no
`/.well-known/openid-configuration`, no confidential clients, no logout
endpoint, and a `scope` claim whose meaning collides with OAuth's.

`SaApp.publicId` is `sqids.encode(app.id)` and is the value clients send as
`client_id`. The access token's `aud` is already that same value, so
`aud === client_id` validation passes unchanged. No migration needed here.

## Positioning

The discovery document will make SassyAuth look like a certified OP to tooling.
The README gains an explicit line — implements OpenID Connect Core, not
certified, not audited — and the experimental banner stays. Advertising
conformance we have not proven is the one part of this work that could mislead
an evaluator.

## Section 1 — Protocol surface

### New

| Endpoint | Purpose |
|---|---|
| `GET /.well-known/openid-configuration` | OIDC discovery, at host root beside the RFC 8414 doc |
| `GET /api/token/oauth/userinfo` | Bearer-authenticated claims for the token's subject |
| `GET /api/token/oauth/logout` | RP-initiated logout (`end_session_endpoint`) |

### Changed

- `GET /api/token/oauth/authorize` — accepts and validates `scope`, `nonce`,
  `prompt`, `max_age`; validates `redirect_uri` against a list.
- `POST /api/token/oauth/token` — accepts `client_secret_basic` and
  `client_secret_post`; response gains `id_token` when `openid` was granted, and
  `scope` reflecting what was granted.

### Discovery

Both documents share one builder, extending the existing `oauth-metadata.ts`
pattern: `buildOAuthAuthorizationServerMetadata()` and a new
`buildOpenIdConfiguration()` derive from the same route constants, so renaming a
route updates both by construction. That invariant is why `oauth-metadata.ts`
exists; hand-writing a second document would break it.

`token_endpoint_auth_methods_supported` becomes
`["none", "client_secret_basic", "client_secret_post"]`.

### PKCE

PKCE stays mandatory for public clients and becomes optional-but-honoured for
confidential clients. A client authenticating with a secret already has the
protection PKCE provides, and requiring a challenge would break libraries that
do not send one — which defeats the goal. `code_challenge_methods_supported`
remains `["S256"]`.

## Section 2 — Data model

### `SaAppRedirectUri` (new)

`(id, appId, uri, kind)` where `kind` is `login | post_logout`. Unique on
`(appId, uri, kind)`. Replaces `SaApp.callbackUrl`.

Migration, behaviour-preserving by rule rather than by special case:

1. Backfill one `kind='login'` row for every app with a non-null `callbackUrl`.
2. Drop `SaApp.callbackUrl`.

Matching in `assertRedirectUriAllowed` keeps both branches it has today; only
the configured branch becomes set-valued:

- **Zero registered `login` URIs** → same-origin as `SaApp.url`, any path.
  Unchanged from today.
- **One or more registered** → exact match against any member of the set,
  reusing `isExactMatch` (protocol + host + port + path + query, tolerant of a
  single trailing slash).

Apps that never configured a `callbackUrl` behave identically after migration.

The admin console flags the zero-URI fallback as legacy and nudges toward
explicit registration. It does not force it: origin-wide matching is loose for
an OIDC provider, but removing a documented convenience is a breaking change
this project does not need to make.

### `SaApp` (extended)

Adds `clientSecretHash String?` and `clientSecretUpdatedAt DateTime?`.

Client type is derived, not stored: a secret present means confidential (secret
required at `/token`); absent means public (PKCE required). One less field that
can contradict reality.

Secrets are hashed with the same scrypt primitive BetterAuth already uses,
generated in the admin console, and revealed exactly once. Rotation replaces the
hash; there is no dual-secret grace window.

### `SaOauthCode` (extended)

Adds `nonce String?`, `scope String`, `authTime DateTime`. `codeChallenge` and
`codeChallengeMethod` become nullable.

That nullability is the one security-relevant loosening in this design, so it
carries an explicit invariant:

> **A code issued without a PKCE challenge may only be exchanged by a request
> that authenticates with a client secret.**

Enforced at both ends. `/authorize` refuses to omit the challenge unless
`clientSecretHash` is set; `/token` refuses a challenge-less code unless the
client authenticated. Neither check alone is sufficient, and each is tested
independently.

## Section 3 — Claims

### `id_token`

RS256, same key and `kid` as the access token, so existing JWKS consumers need
no change.

Always present: `iss`, `sub` (`SaUser.publicId`), `aud` (`client_id`), `exp`,
`iat`, `auth_time`, `amr`, `at_hash`, and `nonce` when supplied.

`org` is always present. In SassyAuth's model a user is org-scoped; an identity
token omitting it would describe a user who does not exist.

`azp` is omitted — there is only ever one audience.

Scope-gated:

| Scope | Claims |
|---|---|
| `profile` | `name`, `given_name`, `family_name` (from `SaUser.firstName` / `lastName`) |
| `email` | `email`, `email_verified` (from the BetterAuth `User` record) |

Unrecognised scopes are dropped silently, per OAuth. The token response echoes
only granted scopes.

### Access token

Keeps `sub`, `aud`, `org`, `iss`, `iat`, `exp`, `amr`. Two changes:

- **`scope`** becomes the granted OIDC scopes (`"openid profile email"`).
- **`permissions`** is a new array claim carrying effective permission names,
  **filtered to the token's audience app**. This is the bug-0157 fix.

An array rather than the current space-delimited string: consumers must change
their parsing regardless, and a space-delimited list of identifiers that may
contain dots is a format worth leaving behind while doing so is free.

### `/userinfo`

Returns `sub` plus the same scope-gated claims, derived from the presented
access token's own `scope` claim. It cannot return more than the token was
granted, and there is no second source of truth to drift.

### `/api/token/direct/login`

Not an OIDC flow. Issues no `id_token` and gets `scope: ""`. It does get the
audience-filtered `permissions` array, so the bug-0157 fix applies uniformly and
there is only one token claim shape to document.

### Breaking-change surface

- `apps/resource-server-fastapi` scope gate
- README §524 (claim table), §558-569 (verification example)
- The bug-0157 known-limitation entry becomes a changelog entry

## Section 4 — Flows and error handling

### `/authorize`

Existing checks keep their order; new steps insert around them.

1. Resolve `client_id` → app *(unchanged)*
2. Validate `redirect_uri` against the registered set *(now set-valued)*
3. Parse `scope`; `openid` puts the request in OIDC mode
4. PKCE required unless the app is confidential *(§2 invariant)*
5. No session, or `prompt=login`, or `auth_time` older than `max_age` → bounce
   to the admin login carrying the full authorize URL as `next`
6. `prompt=none` → never bounce; return `login_required` or
   `interaction_required` to the client
7. Active-user, org-match, and forced-2FA checks *(unchanged)*
8. Persist `nonce`, granted `scope`, and `auth_time` on the code

Step 5 reuses the `next=` bounce the controller already performs for forced 2FA
enrollment, so `prompt` and `max_age` cost a condition rather than a mechanism.

### Error handling

Today every authorize failure lands on the admin console error page via
`buildOauthErrorRedirectUrl()`. OIDC libraries never see it: they wait on a
callback that never fires while the user is stranded on a page belonging to a
product they may not recognise. The rule becomes:

- **`redirect_uri` validated** → redirect to the client with `error`,
  `error_description`, `state`. This covers `invalid_scope`, `login_required`,
  `interaction_required`, `access_denied`.
- **`client_id` or `redirect_uri` invalid** → admin error page, as today.

The second branch must not change. Redirecting to an unvalidated URI is the open
redirect that validation exists to prevent.

### `/token` client authentication

Confidential clients present `client_secret_basic` or `client_secret_post`; the
secret is compared against `clientSecretHash` in constant time. Failure is `401
invalid_client` with a `WWW-Authenticate` header. Public clients authenticate
with PKCE alone. A request presenting both a secret and a verifier is valid;
both are checked.

### `/logout`

Validate `id_token_hint` (signature, `iss`, `aud`, and that the client exists),
terminate the BetterAuth session, then redirect to `post_logout_redirect_uri`
**only if it is registered for that client**, echoing `state`.

Without a valid hint or a registered URI, terminate the session and render a
logged-out page. An unvalidated post-logout redirect is the same open-redirect
hazard by another name.

## Section 5 — Testing

Co-located specs, extending the existing pattern (`oauth-metadata.spec.ts`,
`redirect-uri.spec.ts`, `discovery.controller.spec.ts`, `token.service.spec.ts`)
rather than introducing a new layer.

### Unit

New specs for the `openid-configuration` builder (including that both discovery
documents derive from the same route constants), `id_token` claim assembly per
scope, scope-gated `/userinfo`, client-secret verification, set-valued
redirect-URI matching, and logout.

### Security invariants

Named tests, not incidental coverage. Each is a rule where a passing happy path
proves nothing:

- A challenge-less code is rejected at `/token` without client authentication —
  tested at `/authorize` and `/token` independently, since either check alone is
  insufficient.
- `/userinfo` cannot return a claim the presented token's `scope` did not grant.
- Errors redirect to the client only after `redirect_uri` validation succeeds;
  an invalid `redirect_uri` never produces a redirect.
- `post_logout_redirect_uri` is honoured only when registered for the hinted
  client.
- `permissions` excludes permissions belonging to apps other than `aud`
  (bug-0157 regression).

### Migration

A spec asserting the two-branch rule from §2: zero registered URIs matches by
origin as before, one or more matches exactly against the set. This is the test
proving the migration neither tightened nor loosened anyone's configuration.

### End-to-end

A Playwright spec driving a stock `openid-client` through discovery →
authorize → exchange → `id_token` validation → `/userinfo` → logout, with no
SassyAuth-specific configuration.

Hand-rolled tests prove the code does what we wrote. A third-party library
refusing to special-case us proves the goal. If `openid-client` needs a
workaround, this spec has failed even when green.

The FastAPI sample is updated to the new claim shape as part of the breaking
change but stays a PKCE/permissions demo. It is not overloaded into a
conformance harness.

## Follow-on work

- **Refresh tokens and `offline_access`** — own spec, sequenced after this one.
  A security-sensitive subsystem (storage, rotation, reuse detection, cleanup,
  admin visibility) that would roughly double this spec and blur what is under
  review.
- **Conformance and certification** — reconsider once this ships and the
  protocol surface is stable.
