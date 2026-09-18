# OIDC/OAuth2 spec-correctness audit: discovery doc, nonce, scope, redirect-URI matching

## Purpose

`docs/oidc-gaps-todo.md` marks four items as resolved on `dev` (and unmerged
`feat/oidc-compatibility` may touch them further): the discovery document, `nonce`
handling, `scope` handling, and redirect-URI-set matching. "Resolved" there means
"exists and does something reasonable" — it wasn't checked against the OIDC
Core / OIDC Discovery / RFC 6749 spec text in detail. This audit does that check,
clean-slate, and produces a findings report. No code changes are made as part of
this work; findings feed a future decision on what (if anything) to fix.

## Scope

Two branches, checked independently:

- `dev` (current merged state, what's actually live)
- `feat/oidc-compatibility`, via the existing `.worktrees/oidc` worktree — check
  whether unmerged work changes behavior in any of the four areas (e.g.
  confidential-client auth interacting with redirect-URI matching, or
  `end_session_endpoint` appearing in discovery)

For each branch: static code review against the checklist below, **plus** live
requests against a running instance of the app to confirm actual behavior (not
just inferred from reading code).

## Checklists

### 1. Discovery document (`/.well-known/openid-configuration`)
- All OIDC Discovery 1.0 REQUIRED fields present: `issuer`, `authorization_endpoint`,
  `token_endpoint`, `jwks_uri`, `response_types_supported`,
  `subject_types_supported`, `id_token_signing_alg_values_supported`
- RECOMMENDED fields present where the corresponding feature exists:
  `scopes_supported`, `claims_supported`, `grant_types_supported`,
  `token_endpoint_auth_methods_supported`, `end_session_endpoint` (feat branch only)
- `issuer` exactly matches the `iss` claim minted into tokens (including trailing
  slash) and is an absolute HTTPS URL
- No field advertises a capability that isn't actually implemented, and no
  implemented capability is missing from the document (e.g. `grant_types_supported`
  must reflect what `/oauth/token` actually accepts)

### 2. `nonce`
- Present in the auth request → carried unmodified into the `nonce` claim of the
  issued `id_token`
- Absent from the auth request → absent from the `id_token` (not defaulted to
  empty string or omitted-but-present-as-null)
- Survives the authorization-code exchange step unchanged (set at `/authorize`,
  still correct at `/oauth/token`)
- No server-side length/charset restriction narrower than what the spec allows
  (spec places no format requirement on it)

### 3. `scope`
- `openid` scope gates `id_token` issuance (already believed true — reconfirm)
- Granted scope is echoed back as `scope` in the token response whenever it's
  narrower than the requested scope (RFC 6749 §5.1 — omission implies granted ==
  requested, which must actually be true when omitted)
- Standard claims scopes (`profile`, `email`, `address`, `phone`) correctly gate
  which claims appear in the `id_token` and `/userinfo` response

### 4. Redirect-URI-set matching
- Exact string match only against the registered set — no prefix, suffix, or
  wildcard matching (RFC 6749 §3.1.2.3)
- The `redirect_uri` used at `/authorize` must equal the one presented at
  `/oauth/token` for the same authorization code
- When multiple URIs are registered and `redirect_uri` is omitted or ambiguous,
  the request is rejected rather than defaulted to the first registered URI

## Method

1. For each branch, start the app (or reuse the existing worktree setup for
   `feat/oidc-compatibility`).
2. Static pass: read the relevant source (auth/OIDC module, discovery controller,
   token service, redirect-URI validation) against each checklist item.
3. Live pass: `curl` the discovery document; drive an actual authorization-code +
   PKCE flow (reusing the e2e stub OIDC provider or a manual flow) to inspect the
   real `id_token` payload, token response `scope` field, and redirect-URI
   rejection behavior with a tampered/omitted `redirect_uri`.
4. Record a PASS/FAIL/PARTIAL verdict with evidence (code location + request/response
   snippet) per checklist item, per branch.

## Deliverable

A single findings report, `docs/oidc-spec-audit-findings.md`, structured as one
section per area (discovery doc, nonce, scope, redirect-URI matching), each with
a per-branch verdict table and supporting evidence. No fixes are applied in this
pass — the report is the artifact requested.

## Execution plan (not a code implementation plan)

This is a research/audit task, not a feature build — there is no code to write a
staged implementation plan for. Execution is two agents running in parallel, one
per branch, each performing the static + live checks above and reporting back;
findings are then synthesized by hand into the deliverable report. This replaces
the usual writing-plans handoff.
