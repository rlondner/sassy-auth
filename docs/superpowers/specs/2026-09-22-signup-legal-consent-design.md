# Optional Privacy Policy / Terms / GDPR consent on signup and login

Date: 2026-09-22

## Problem

There is no way for an app owner to require a user to read and accept a
Privacy Policy, Terms and Conditions, or a GDPR-specific disclosure before
using their app. Some apps need this (legal requirement, insurance
against disputes); many don't. It needs to be opt-in per app, not a
platform-wide requirement, and it needs to reach every way a user ends up
authenticated against an app — not just the self-serve signup form.

## Goals

- An app owner can optionally configure a Privacy Policy URL, a Terms and
  Conditions URL, and a GDPR disclosure URL for their app, independently
  of one another (none, one, two, or all three).
- Self-serve signup (`/signup`) shows a mandatory, separate checkbox for
  each configured document the app requires, before the form can submit.
- The GDPR checkbox is additionally conditional on the signup being
  geo-detected as originating from the EU/EEA, UK, or Switzerland.
- **Every other way a user becomes authenticated against an app —
  existing accounts that predate this feature, accounts provisioned by
  an admin invite, and social sign-in — must also be gated.** A user who
  owes acceptance of a currently-required document is blocked, at login
  time, from reaching the app until they accept it.
- Acceptance is durably recorded per user, per app, per document: when it
  happened and exactly which URL was accepted, so the app can later
  prove a specific user agreed to a specific document. It is not
  recorded as columns on `SaUser`, because a user's consent is a fact
  about their relationship to a *specific app*, not about the user row
  itself — even though every `SaUser` today belongs to exactly one app
  (via its org), scoping consent by `(user, app, document)` rather than
  by user alone avoids a schema change if that ever stops being true.

## Non-goals

- No re-consent flow triggered by a document's URL changing. If an app
  changes a document's URL after a user has already accepted it, that
  acceptance stands as-is — nothing prompts a re-accept. The login-time
  gate only fires for a document that has genuinely never been accepted.
- No admin-configurable GDPR country list in this iteration — the list is
  a fixed constant in code (see below).
- No gate on an already-active session. The consent gate fires at the
  moment credentials are verified (sign-in) — it does not re-check on
  every subsequent app-authorization request. A user who already holds a
  session from before a document became required is not interrupted
  until that session ends and they sign in again. Accepted as a known,
  deliberate boundary rather than closed in this iteration: closing it
  would mean moving the check into the OAuth `/authorize` endpoint
  itself, a materially different (and riskier) change to an existing,
  working redirect flow, out of scope here.
- No gate on `POST /api/token/direct/login` (the first-party password
  grant used by resource-server API clients, not the admin console UI).
  This is a non-browser, programmatic endpoint — the consent mechanism
  built here is a redirect-to-an-HTML-page flow, which has no browser to
  redirect and no page to show a checkbox in. Gating a machine-to-machine
  token endpoint would need a different mechanism entirely (e.g. a
  structured "consent required" error the calling application handles
  out-of-band), which is undesigned, separate scope.
- No change to how social sign-in decides whether an identity is allowed
  to authenticate at all (still invite-only, still never creates a new
  `SaUser` — see `classify-callback-outcome.ts`). This feature only adds
  a consent checkpoint *after* that decision, for identities that were
  already allowed through.

## Data model

Three new nullable columns on `SaApp` (`packages/db/schema.prisma`),
following the existing pattern of `webhookUrl` / `logo`:

```prisma
model SaApp {
  // ...existing fields...
  privacyPolicyUrl String?
  termsUrl         String?
  gdprUrl          String?
}
```

A new join table recording proof of consent, scoped per `(user, app,
document)`:

```prisma
model SaUserConsent {
  id           Int      @id @default(autoincrement())
  saUserId     Int
  saUser       SaUser   @relation(fields: [saUserId], references: [id], onDelete: Cascade)
  appId        Int
  app          SaApp    @relation(fields: [appId], references: [id], onDelete: Cascade)
  /// 'privacy_policy' | 'terms' | 'gdpr'
  documentType String
  /// Snapshot of the URL as it existed at the moment of acceptance — a
  /// later change to SaApp's URL must not retroactively change what an
  /// already-accepted record claims the user agreed to.
  url          String
  acceptedAt   DateTime @default(now())

  @@unique([saUserId, appId, documentType])
}
```

A row's mere existence for `(saUserId, appId, documentType)` means "this
user has accepted this document for this app" — permanently, regardless
of later URL changes (see Non-goals). Absence of a row, when the app
currently requires that document, is exactly the condition that trips
the login-time gate below.

## Admin configuration

`UpdateAppDto` (`apps/auth-server/src/apps/dto/update-app.dto.ts`) gains
three optional fields, validated identically to `webhookUrl`:

```ts
@IsOptional() @IsAppUrl() @MaxLength(2048) privacyPolicyUrl?: string | null;
@IsOptional() @IsAppUrl() @MaxLength(2048) termsUrl?: string | null;
@IsOptional() @IsAppUrl() @MaxLength(2048) gdprUrl?: string | null;
```

`null` clears the field, same convention as `webhookUrl`. Exposed in the
admin console's existing "edit app" drawer (`apps/(admin)/apps`) as three
more optional URL inputs, alongside the existing per-app settings.

## GDPR applicability detection

A document requirement is "outstanding" for GDPR specifically only when
**both**:

1. `app.gdprUrl` is set, and
2. the current request's IP resolves to a country in the GDPR-applicable
   list.

(Privacy Policy and Terms have no geo condition — outstanding whenever
their URL is set and unaccepted.)

### Country list

A fixed constant (not admin-configurable in this iteration): the 27 EU
member states, plus Iceland, Liechtenstein, and Norway (EEA), plus the
United Kingdom (UK GDPR), plus Switzerland (FADP, commonly bundled with
GDPR handling in practice).

### Mechanism: local MaxMind GeoLite2-Country

This deployment runs on Render, behind one proxy hop (see
`main-trust-proxy.spec.ts`) — there is no Cloudflare edge providing a free
`CF-IPCountry` header. Consistent with this project's self-hosted, "nothing
leaves your infra" stance (see README), country resolution uses a local
**MaxMind GeoLite2-Country** `.mmdb` file looked up in-process via the
`maxmind` npm package, rather than a per-request call to an external geo-IP
API.

- The client IP is resolved the same way `auth-rate-limit.ts` already
  does: `req.ips[0] ?? req.ip`.
- The `.mmdb` file path is read from a new `GEOIP_DB_PATH` env var,
  optional. No database ships with the repo — MaxMind requires a free
  account to download GeoLite2 — so this is a deploy-time opt-in,
  documented in `DEPLOYMENT.md`.
- **Fail closed.** If `GEOIP_DB_PATH` is unset, the file is missing, the
  lookup errors, or the IP has no match (private/unresolvable), the
  request is treated as GDPR-applicable. This means the feature is
  correct-by-default with zero GeoIP setup (it always requires GDPR
  consent when `gdprUrl` is set), and becomes more precise — only
  actually-EU/EEA/UK/CH requests — once an operator configures the
  database.
- Used both at signup time (against the `POST /api/register` request's
  IP) and at every login-time gate check (against that sign-in attempt's
  IP) — resolved fresh each time, never cached or trusted from an
  earlier request.

## Self-serve signup flow (`/signup`)

### `GET /api/register/app?appPublicId=`

Already called by the `/signup` page on load (`RegistrationService.getAppName`).
Response gains:

```ts
{
  // ...existing fields...
  privacyPolicyUrl: string | null;
  termsUrl: string | null;
  gdprUrl: string | null;
  gdprRequired: boolean; // computed server-side from the caller's IP now
}
```

`gdprRequired` is advisory — it decides what the form renders. It is
never trusted as the source of truth for whether GDPR consent is
actually required at submit time.

### `POST /api/register`

`RegisterDto` (`apps/auth-server/src/registration/register.dto.ts`) gains
three optional booleans: `acceptedPrivacyPolicy?`, `acceptedTerms?`,
`acceptedGdpr?`.

`RegistrationService.register()`, after resolving the app (step 1,
existing code) and before creating any account, re-resolves each
document's applicability against **this** request (not whatever the
earlier GET call computed) and throws `BadRequestException` if any
applicable one wasn't sent as `true`. This mirrors the existing
`validatePasswordOrThrow` gate: reject before any BetterAuth call or
database write, so a rejected signup creates nothing.

On success, inside the existing `prisma.$transaction` that creates the
`SaUser`, insert one `SaUserConsent` row per document that was required
and accepted, each carrying `documentType`, the current `app.<x>Url` as
the `url` snapshot, and `acceptedAt: new Date()`.

### Frontend (`signup-form.tsx`)

Up to three checkboxes render below the password fields, each
conditional on its URL being present in the `GET` response (GDPR
additionally conditional on `gdprRequired`):

- Each has its own label and a link to the document, opening in a new
  tab (`target="_blank" rel="noopener noreferrer"`).
- Presented and required **separately** — no combined "I agree to
  everything" checkbox.
- The submit button's existing `disabled` condition gains a clause:
  every *rendered* checkbox must be checked.
- `registerAction` passes the three accepted-booleans through to
  `POST /api/register`, only for checkboxes that were actually shown.

## Login-time consent gate

Self-serve signup is only one way a user ends up with a session against
an app. Every other path — an existing account that predates this
feature, an account provisioned by an admin invite, or a social sign-in —
must also be blocked from reaching the app until any currently-required,
never-accepted document is accepted.

### Why this needs one shared check, not per-flow patches

Every sign-in path in this codebase — password, email OTP, TOTP verify,
backup-code verify (all in `apps/admin/app/login/actions.ts`), and social
(`/api/auth/sign-in/social`, handled entirely on the auth-server) —
converges on the same shape: establish a session, then redirect the
browser to a `next` URL that, when the sign-in is happening on behalf of
a specific app, carries that app's `client_id` as a query param (already
relied on today for per-app 2FA-trust-days resolution — see
`applyPerAppTrustCookie`). That convergence point is where the gate
lives, but it has two different mechanical homes because of one asymmetry:
social sign-in's success redirect is issued directly by the auth-server
(BetterAuth's own `/callback/:id` handler redirecting straight to
`callbackURL`) and never passes back through the admin console's server
actions at all.

### Where the check lives

A single shared function, `resolveOutstandingConsent(saUserId, appId,
requestIp)`, returns the list of documents (among `privacy_policy`,
`terms`, `gdpr`) that are currently required by the app and have no
matching `SaUserConsent` row for that user. Two call sites:

1. **Password / OTP / TOTP / backup-code** (`apps/admin/app/login/actions.ts`):
   after the session is established (existing `forwardSessionCookie` /
   `redirect(nextSafe ?? '/users')` calls) and a `client_id` can be parsed
   out of `next`, resolve the app and call
   `resolveOutstandingConsent`. If it's non-empty, redirect to
   `/login/consent?next=<original next>` instead of `next` directly.
   No `client_id` in `next` (a bare admin-console login) is never gated —
   these fields describe end-user-facing apps, not the platform console.

2. **Social** (`auth.config.ts`'s existing `hooks.after` on `/callback/:id`,
   where `classifyCallbackOutcome` and the header-rewrite for rejected
   sign-ins already live): on a successful callback (no `error` query
   param), parse `client_id` out of the resolved `location`'s query
   string, resolve the app, and call the same
   `resolveOutstandingConsent`. If non-empty, rewrite `location` to
   `/login/consent?next=<original location>` using the exact
   `ctx.context.responseHeaders` rewrite technique already used there —
   full session has already been established by BetterAuth at this
   point, same as the password/OTP paths.

In both cases the session is already fully established (as it is today)
— only the final redirect to the target app is withheld. This is
deliberately **not** a "no session at all" gate like BetterAuth's own 2FA
temp-cookie challenge: building an equivalent pending-auth mechanism from
scratch for consent was considered and rejected as unnecessary
complexity (see design discussion) — the existing skippable 2FA-setup
prompt already establishes the precedent that a session can exist while
a post-login step is still outstanding.

### `/login/consent` page

New page, structurally similar to the existing
`/login/two-factor-prompt` (`TwoFactorPromptClient.tsx`) but **mandatory
— no skip button**. On load, it calls a new session-authenticated
endpoint, `GET /api/me/consent?appPublicId=`, which returns the specific
outstanding documents (type + URL) for the current session's `SaUser`
against that app. It renders exactly those as separate checkboxes (same
link-opens-new-tab, separately-required pattern as the signup form), with
a single "Continue" button disabled until all are checked.

Submitting calls a new endpoint, `POST /api/me/consent`, which
re-validates the outstanding set server-side (never trusts the checkbox
state alone), inserts the corresponding `SaUserConsent` rows, and returns
success. The page then redirects the browser to the original `next`.

## Error handling

A 400 from the signup-time checks surfaces through the existing
`KNOWN_ERRORS` / `validationError` fallback already used by
`signup-form.tsx`. A 400 from `POST /api/me/consent` (e.g. a stale
outstanding set re-checked mid-submit) surfaces as an inline error on the
`/login/consent` page with the "Continue" button re-enabled once the
checkboxes are re-checked.

## Testing

- Unit: `RegistrationService.register()` rejects when a configured
  document isn't accepted; accepts and writes the expected
  `SaUserConsent` rows when it is; GDPR check consults the geo-IP result
  and fails closed when country can't be resolved.
- Unit: `resolveOutstandingConsent` — given a mix of configured app
  documents and existing `SaUserConsent` rows, returns exactly the
  missing/required set; GDPR entry respects geo-applicability and
  fail-closed behavior independently of the other two documents.
- Unit: the GDPR country-list check itself (given a resolved country
  code, applicable vs. not).
- Component: `signup-form.tsx` renders 0–3 checkboxes based on the
  `GET /api/register/app` response, submit stays disabled until all
  rendered checkboxes are checked.
- Component: `/login/consent` page renders exactly the outstanding
  documents returned by `GET /api/me/consent`, "Continue" gated the same
  way, and redirects to `next` after a successful `POST`.
- E2E: (a) full signup through an app configured with all three
  documents, confirming the created `SaUser` has the expected
  `SaUserConsent` rows; (b) an admin-invited user (never went through
  `/signup`) logging in via password against an app that requires
  Privacy Policy, hitting `/login/consent`, accepting, and landing on the
  original `next`; (c) same for a social sign-in, confirming the
  location-header rewrite in the `/callback/:id` after-hook actually
  redirects to `/login/consent` before reaching the app.
