# OIDC/OAuth2 spec-correctness audit findings

Audit of discovery document, `nonce`, `scope`, and redirect-URI-set matching against
OIDC Core 1.0 / OIDC Discovery 1.0 / RFC 6749, on `origin/dev` (e56110c) and
`feat/oidc-compatibility` (worktree `.worktrees/oidc`, 142 commits ahead of its
remote). Static code review plus live authorization-code + PKCE flows against a
running instance of each. See `docs/superpowers/specs/2026-09-04-oidc-spec-audit-design.md`
for the audit design and checklists.

## Headline result

**One real, currently-live spec violation on `dev`, already fixed on
`feat/oidc-compatibility`:** `/.well-known/openid-configuration` 404s on `dev`.
The document is actually only served at `/api/.well-known/openid-configuration`,
because `configure-nest-app.ts` excludes the RFC 8414 alias path
(`/.well-known/oauth-authorization-server`) from the global `/api` prefix but not
the real OIDC discovery path. A unit test masks the regression by excluding both
paths, so CI is green while a standard OIDC relying party doing auto-discovery
against this issuer would fail outright. `feat/oidc-compatibility` fixes this
(commit references "Task 12's e2e proof" of the same bug) — confirm this fix is
merged to `dev` before or alongside anything else in this list.

Everything else checked came back PASS or an already-known, deliberate,
minor deviation (see below) on both branches.

## 1. Discovery document

| Check | dev | feat/oidc-compatibility |
|---|---|---|
| Reachable at `{issuer}/.well-known/openid-configuration` | **FAIL** — 404, only at `/api/...` | PASS — fixed |
| Required fields present | PASS | PASS |
| Recommended fields present | PASS | PASS |
| `issuer` == `iss` claim, absolute URL | PASS (http on localhost is the accepted dev exception; no prod HTTPS enforcement on either branch — static concern, not new) | PASS (same caveat) |
| No advertised-but-unimplemented / no implemented-but-unadvertised capability | PARTIAL — `grant_types_supported` claims `authorization_code` but `/oauth/token` never validates a `grant_type` param at all | PASS — `grant_type` is now validated (`@IsIn(['authorization_code'])` + `forbidNonWhitelisted`), closing the dev gap. `token_endpoint_auth_methods_supported` now correctly lists `client_secret_basic`/`client_secret_post` alongside the confidential-client support added on this branch |

`end_session_endpoint`: resolved on `dev` via a two-stage fix (an earlier commit
hid the field when no logout endpoint existed; a later one added a real,
validating `/oauth/logout` and restored the field) — confirmed fully working live
on `dev`. Present and consistent on `feat/oidc-compatibility` too.

## 2. `nonce`

All PASS on both branches, live-verified on both:
- Present in the request → carried unmodified into the `id_token` `nonce` claim,
  survives the authorization-code exchange.
- Absent from the request → absent from the `id_token` entirely (not `null`, not
  an empty string).
- No length/charset validation narrower than the spec allows (spec imposes none).

## 3. `scope`

All PASS on both branches, live-verified:
- `openid` gates `id_token` issuance.
- Granted scope is echoed back narrowed in the token response when it's less
  than what was requested (unsupported scopes silently dropped) — satisfies
  RFC 6749 §5.1.
- `profile`/`email` claims scopes correctly gate the corresponding claims in
  both the `id_token` and `/userinfo`, via one shared claim-building function.

One incompleteness, present on both branches and not a spec violation (both
scopes are OPTIONAL per OIDC Core): `address` and `phone` standard scopes are
not implemented at all — `SUPPORTED_SCOPES` only knows `openid`, `profile`,
`email`. Discovery's `scopes_supported` correctly reflects this by omission, so
it isn't a correctness bug, just missing feature coverage if those claims are
ever needed.

## 4. Redirect-URI-set matching

| Check | dev | feat/oidc-compatibility |
|---|---|---|
| Exact match only, no unregistered prefix/suffix/host | PASS | PASS |
| Trailing-slash tolerance vs. registered URI | **Deliberate deviation** — `/callback` and `/callback/` are treated as equal against the registered set | Same deviation, unchanged |
| `/authorize` redirect_uri must equal `/oauth/token` redirect_uri for the same code | PASS — byte-exact comparison here, no slash tolerance at this layer | PASS, same |
| Omitted/ambiguous redirect_uri with multiple registered → rejected, not defaulted | PASS | PASS (only one URI was registered on the feat-branch test app, so the "multiple registered" case wasn't live-exercised there, but the same code path applies regardless of set size per static review) |
| Multi-redirect-URI admin writes (feat branch only): race or validation gap? | n/a | PASS — the update path wraps the delete+recreate of redirect URIs in one DB transaction and rejects duplicate `{uri, kind}` pairs before writing, so a partial write can't silently widen the accepted set |

The trailing-slash tolerance is a real, intentional divergence from RFC 6749
§3.1.2.3's exact-string-comparison requirement, present on both branches. It's
narrow (single trailing slash only, not general normalization) and doesn't by
itself enable an open redirect, but it is worth a conscious decision: keep it as
a UX nicety, or tighten to byte-exact matching for strict spec conformance.

## New in feat/oidc-compatibility, checked as part of this audit

- **Confidential-client auth** (`client_secret_basic` and `client_secret_post`):
  live-verified correct token issuance with a valid secret, and `401
  {"message":"invalid_client"}` with a wrong or missing secret, including the
  RFC 6749 §5.2 `WWW-Authenticate: Basic` challenge header.
- **RP-initiated logout** (`/oauth/logout`): reviewed statically; unlike the
  login-redirect path, `post_logout_redirect_uri` validation has no same-origin
  fallback and always rejects an unregistered URI — stricter than login
  redirects, not a gap.

## Not verified live (static-only)

- Production HTTPS-issuer enforcement (only localhost/http tested on both
  branches).
- `prompt=none` / `max_age` behavior on `feat/oidc-compatibility` (code
  reviewed, live pass cut short by an environment resource issue unrelated to
  the code under test).
- Ambiguous-redirect-uri rejection with more than one registered URI, on
  `feat/oidc-compatibility` specifically (dev branch confirmed this live with
  two registered URIs; feat branch confirmed only via static review of the same
  code path).
- Adversarial/oversized `nonce` values on either branch (only short
  alphanumeric values were exercised).

## Suggested next actions (not done as part of this audit)

1. Confirm the `.well-known/openid-configuration` path fix from
   `feat/oidc-compatibility` lands on `dev` — this is the one live, currently
   broken spec requirement.
2. Decide whether to keep or remove the trailing-slash tolerance in redirect-URI
   matching; it's a deliberate choice today, not an oversight, but worth an
   explicit call.
3. No other action required from this audit's four checklist areas — the
   remaining `feat/oidc-compatibility` items in `docs/oidc-gaps-todo.md`
   (confidential client, `prompt`/`max_age`, RP logout, admin UI) all came back
   spec-correct on the parts this audit exercised.
