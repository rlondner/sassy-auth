# Social authentication (Google, Microsoft, Apple) — design

**Date:** 2026-08-22
**Status:** approved design, no implementation plan yet
**Scope:** federated sign-in for end users of downstream apps, via the existing
`/api/token/oauth/authorize` flow.

---

## 1. Problem and stance

SassyAuth already registers `google`, `microsoft`, `apple` and `github` as
BetterAuth `socialProviders` (`apps/auth-server/src/auth/auth.config.ts:177-202`),
gated on env-var pairs. Nothing else exists: no buttons, no provisioning, no
per-app control, no audit trail. A first-time social sign-in today would create a
BetterAuth `User`, then be refused by the session-create gate
(`auth.config.ts:106` → `session-gate.ts`), because that gate requires an active
`SaUser`.

So the OAuth handshake is the part we get for free. The work is the identity
model around it.

**Audience decision:** social login is for **end users of downstream apps**, not
just admin-console operators. A user clicking "Sign in with Google" on their way
into app `qp31` must end up with a normal SassyAuth JWT scoped to their org.

**Provisioning decision — invite-only federation.** Social sign-in is a *login
method*, never a signup method. An unknown identity is refused. Users are still
provisioned by an admin or an invitation; the first social sign-in *links* to the
existing `SaUser`. Just-in-time org creation and domain-claimed orgs are
explicitly out of scope (§10), and the design keeps identity resolution in one
place so they can be added later without rework.

## 2. Verified facts about BetterAuth 1.6.11

These were read from the installed package, not from documentation, and they
shape the design:

- `socialProviders.<p>.disableSignUp: true` makes the callback return **before**
  creating a `User` row when no match exists
  (`dist/api/routes/callback.mjs:157` → `dist/oauth2/link-account.mjs:74`).
  That *is* invite-only, and it means a refused sign-in leaves no orphan row.
- Implicit linking already requires a verified provider email
  (`link-account.mjs:20-22`): `isTrustedProvider || userInfo.emailVerified`.
  **Therefore Google/Microsoft/Apple must NOT be added to `trustedProviders`.**
  This is a deliberate non-action and must be commented as such, because it
  looks like an omission.
- All three providers map `emailVerified` honestly (see §5).
- BetterAuth is mounted at `/api/auth/*` (`apps/auth-server/src/main.ts:82`), so
  callbacks are `{BETTER_AUTH_URL}/api/auth/callback/{provider}`.
- `@opentelemetry/api` 1.9.1 is already in the dependency tree as a BetterAuth
  peer. `@sentry/nestjs` is 10.54.0, whose Node SDK is OpenTelemetry-native.
- `genericOAuth` ships in 1.6.11 (`dist/plugins/generic-oauth/`), which is what
  the e2e stub IdP (§8) uses.

Checks `/authorize` **already** performs, which the federated path inherits with
no new code (`apps/auth-server/src/token/token.controller.ts:150-192`): SaUser
exists, status is `active`, `saUser.org.appId` matches the requested app
(`USER_ORG_MISMATCH`), and forced 2FA enrollment.

## 3. Linking rule

1. Match on `(providerId, accountId)` — the provider's `sub` — first. An
   existing link always wins, so a provider later changing a user's email
   address cannot silently re-point it.
2. Otherwise match on email **only when the provider asserts the email is
   verified**. This is BetterAuth's default behaviour and is preserved by not
   trusting the providers.
3. Otherwise refuse (`disableSignUp`). No user is created.

Every outcome — link created, sign-in succeeded, sign-in refused — is recorded
(§7).

## 4. Data model and config resolution

**No new table for links.** BetterAuth's `Account` model already stores
`(providerId, accountId, userId)`; that is the link.

**One new table:**

```prisma
model SaSocialProvider {
  id        Int      @id @default(autoincrement())
  appId     Int?     // null = deployment-global row
  app       SaApp?   @relation(fields: [appId], references: [id], onDelete: Cascade)
  provider  String   // 'google' | 'microsoft' | 'apple' | 'stub' (non-prod only)
  enabled   Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([appId, provider])
}
```

A **global row** (`appId: null`) declares the deployment has credentials for a
provider and supplies the default enablement. An **app row** is that app's
explicit opt-in/opt-out.

**Credentials stay in env vars.** No `clientSecret` column in v1: per-app
credentials would require encryption at rest, key management and rotation, for a
capability nothing can use yet. The table is *shaped* to accept `clientId` and
encrypted secret columns later; adding them is one migration plus the resolver.

**One resolver**, `resolveEnabledProviders(appId): Provider[]`:

- a provider is *available* if its env credential pair is set (the existing
  guard at `auth.config.ts:177-202`) **and** a global row exists;
- it is *shown for app X* if X's row says `enabled`, or X has no row and the
  global row is enabled.

This resolver is the only consumer of the table, and backs both the discovery
endpoint (§6) and the admin console checkboxes. It is testable with no HTTP and
no BetterAuth.

**Migration** seeds one global row per env-configured provider, so an existing
deployment that already set `GOOGLE_CLIENT_ID` keeps working untouched.

**Second schema change:** `Session.signInMethod String?` — see §5.

## 5. Sign-in flow, and the `amr` / `idp` claims

### Flow

1. `/authorize` with no session → redirect to admin `/login?next=<authorize-url>`
   (existing behaviour, `token.controller.ts:237`).
2. `/login` extracts `client_id` from `next`, calls the discovery endpoint, and
   renders the enabled provider buttons.
3. Button → `POST /api/auth/sign-in/social` with `callbackURL` = the original
   authorize URL and `errorCallbackURL` = `/oauth-error`.
4. Provider → `/api/auth/callback/{provider}` → BetterAuth applies the §3 rule.
5. The existing session-create gate runs (active `SaUser` required) and records
   the sign-in method.
6. Redirect back to `/authorize`, which re-runs its existing checks and issues
   the code.

The federated path adds **no new authorization logic**; it feeds the same funnel.

### Carrying the method into the token

`amr` is currently hardcoded (`token.controller.ts:195`): `['pwd']`, or
`['pwd','otp','mfa']` when TOTP is enrolled. A federated sign-in emitting `pwd`
would assert to every resource server that a password was verified when none
was — a correctness bug, not a cosmetic one.

A BetterAuth session records nothing about how it was created, and deriving the
method from `Account` rows is unreliable (a user with both a password and a
linked Google account is indistinguishable either way). So the session carries
it: **`Session.signInMethod String?`**, written at creation by matching the
request path in the session-create hook (`/callback/{provider}` → `ext:google`)
— the same hook that already runs `evaluateSessionGate`. If 1.6.11's hook
context does not expose the path, the fallback is a BetterAuth `hooks.after`
matcher on the callback route; this is a plan task to confirm, not a guess to
make now.

The inline ternary becomes a pure function:

```
deriveAuthMethods({ signInMethod, twoFactorEnabled }) -> { amr, idp? }
```

- password → `amr: ['pwd']` (and `['pwd','otp','mfa']` with TOTP), no `idp`
- federated → `amr: ['ext']`, `idp: 'google' | 'microsoft' | 'apple'`
- federated + TOTP → `amr: ['ext','otp','mfa']`, plus `idp`
- `signInMethod` null (sessions predating the migration) → today's behaviour

`ext` is a convention, not an RFC 8176 registered value; the registry has no
value for "federated". The provider name goes in a dedicated `idp` claim rather
than into `amr`, so resource servers keep a bounded set of `amr` values to match
against. `directLogin` (`token.controller.ts:516`) stays `pwd` by construction.

**Token contract change** — the README's token example and the OpenAPI document
(`docs/api/openapi.yaml`) must be updated, since "what's in the token" is the
project's headline promise.

### 2FA

Social sign-in is **not** a second-factor bypass and does not satisfy one.

- When an app has `requireTwoFactor` (`two-factor-required.ts`), a federated user
  must still enroll and complete SassyAuth's own TOTP. The enrollment
  interception at `token.controller.ts:186` must fire on the federated path.
- Provider-asserted MFA is **not** trusted. Entra returns `amr: ["mfa"]`; Google
  generally does not — a control that works for one provider and silently fails
  open for the others is worse than no control.

## 6. Provider specifics

Verified against `@better-auth/core@1.6.11/dist/social-providers/`.

**Google** (`google.mjs:92`) — `emailVerified` comes straight from
`email_verified`. Works as designed, no special handling.

**Microsoft** (`microsoft-entra-id.mjs:97`) — `emailVerified` is true only if
the token carries `email_verified`, or the address appears in
`verified_primary_email` / `verified_secondary_email`. Entra does **not** emit
these by default, so many work accounts arrive unverified and the §3 rule
refuses to link. Decision:

- document the required Entra optional-claim configuration as a prerequisite; and
- treat a **pinned `MICROSOFT_TENANT_ID`** (not `common`) as the supported
  escape hatch — "the operator owns this directory" is a far narrower trust
  statement than "always trust Microsoft's email claim".

A `trustEmailVerified` per-provider override is explicitly rejected: it is
`trustedProviders` by another name and weakens the one rule the design rests on.

**Apple** (`apple.mjs`) —

- `clientSecret` is required (`apple.mjs:16`) and Apple's is an ES256 JWT
  (`iss` = team ID, `sub` = Services ID, `aud` = `https://appleid.apple.com`,
  `exp` ≤ 6 months, `kid` header = key ID). A static env var expires silently, so
  it is derived at use time from `APPLE_TEAM_ID` / `APPLE_KEY_ID` /
  `APPLE_PRIVATE_KEY` by a cached generator exposed as a property getter.
- `responseMode: "form_post"` (`apple.mjs:30`) makes the callback a **cross-site
  POST**, and `sameSite: 'lax'` cookies (`auth.config.ts:76`) are not sent on
  those. How 1.6.11 scopes the OAuth state cookie must be confirmed during
  implementation; this is the highest-risk unknown in the design.
- Apple rejects `localhost` return URLs, so Apple is not testable locally or in
  CI (§9).
- `apple.mjs:55` exposes `is_private_email`, so Hide My Email addresses are
  detected precisely rather than by matching `@privaterelay.appleid.com`.

## 7. UI, error surface, and observability

### Discovery endpoint

`GET /api/social-providers?client_id=<appPublicId>` → `{ providers: [...] }`.
Unauthenticated and cacheable; exposes only which buttons an app renders, never
credentials. An unknown `client_id` returns an empty list rather than 404, so it
cannot be used to enumerate apps.

### Login page

`/login` (already a server component that parses `next`) gains `client_id`
extraction and calls the endpoint. A `SocialButtons` client component renders the
providers above the email/password form behind a divider. An empty list renders
exactly today's page, so deployments with no providers configured see no change.

### Error surface

`apps/admin/app/oauth-error/page.tsx` is already a `code` →
`{heading, body, hint}` i18n lookup with a `KNOWN_CODES` set and a graceful
fallback, so this is mostly new message keys — added to **both**
`messages/en.json` and `messages/fr.json`.

Messages are specific where the user already proved control of the identity
(nothing is disclosed) and generic where they have not, matching `directLogin`'s
existing collapse of distinct failures into one `INVALID_CREDENTIALS`:

| Case | Code | Disclosure |
|---|---|---|
| No `SaUser`, or user not active | `social_no_account` | Generic — avoids account enumeration |
| Provider email unverified | `social_email_unverified` | Specific — reveals nothing |
| Apple private relay (`is_private_email`) | `social_private_relay` | Specific — user is stuck otherwise; tells them to choose "Share My Email" |
| Org/app mismatch | existing `USER_ORG_MISMATCH` | Unchanged |

BetterAuth collapses the first three into its own generic failure, so a callback
hook must inspect `is_private_email` / `emailVerified` and redirect with our code
before the generic error is emitted. This is the only non-trivial UI-side code.

### Audit trail and telemetry

One emitter, `recordFederationEvent(...)`, is the sole call site in the sign-in
path; it fans out to two sinks.

**`SaAuditEvent` table — the record of truth.** Fields: `id`, `publicId`, `type`
(`social.link.created` | `social.signin.ok` | `social.signin.rejected` |
`social.link.removed`), `provider`, `saUserId?`, `betterAuthUserId?`, `appId?`,
`reason?` (the *real* cause, including where the user saw a generic message),
`ip?`, `userAgent?`, `createdAt`. Unsampled and retained with the data. Writes
are try/catch-logged: an audit failure must never break sign-in, matching the
`lastLoginAt` stance at `auth.config.ts:128-139`.

**OpenTelemetry — everything else.** `record-federation-event.ts` imports only
`@opentelemetry/api-logs`, with **no direct `@sentry/*` imports** in the feature
code proper. Both severities (expected rejections → `WARN`, unexpected failures
→ `ERROR`) go through the OTel Logs API as log records, not span attributes, so
`tracesSampleRate: 0.2` cannot discard four in five audit events. Attributes:
`auth.flow=social`, `auth.provider`, `auth.outcome`, `app.public_id`. (The
earlier draft of this section described errors as `span.recordException()` +
`ERROR` status; that was never implemented — the code has always routed both
severities through the Logs API only, and task-15 confirmed that was the right
call, see below.)

**Task-15 finding (2026-08-23): the OTel Logs API alone is a no-op on this
stack, and an adapter was required.** Read against the installed
`@sentry/nestjs` / `@sentry/node` / `@sentry/opentelemetry` / `@opentelemetry/*`
10.54.0 / 0.214.0 packages (see
`.superpowers/sdd/2026-08-22-social-authentication/task-15-report.md` for the
full file:line trail):

1. **OTel-recorded span exceptions surfacing as Sentry issues** —
   `@sentry/opentelemetry`'s span processor (the package that bridges OTel
   spans into Sentry) contains no handling of OTel's `exception` span-event
   convention anywhere in its build output. `span.recordException()` is not
   translated into a Sentry issue by this integration, and the feature never
   calls it (see the correction above), so this is moot for the audit
   pipeline. Whether NestJS's own uncaught-exception capture (a different,
   non-OTel mechanism) reaches Sentry could not be verified live — no DSN, no
   running server, Docker down in this environment.
2. **OTel Logs API reaching Sentry** — it does not, on this version.
   `logs.getLogger(...).emit(...)` (`@opentelemetry/api-logs`) is a documented
   no-op until something calls `logs.setGlobalLoggerProvider(...)`; nothing in
   this dependency tree does — `@opentelemetry/sdk-logs` isn't even installed,
   and `@sentry/opentelemetry` never references `LoggerProvider` or
   `api-logs`. Sentry 10.54 does have structured logging, but it is **its
   own** capture path — `Sentry.logger.{warn,error,info,...}` — gated by the
   client's `enableLogs` option, and it is a completely separate mechanism
   from the vendor-neutral OTel Logs API. There is no bridge between the two
   on this stack.

Gap #2 is real, so the fallback described below was implemented: a single
adapter, `apps/auth-server/src/social/telemetry-sentry-adapter.ts`, is the only
file in the feature that imports `@sentry/*`. It implements the `emit` seam
`FederationEventDeps` already accepted and is injected at the sign-in path's
one call site (`auth.config.ts`). `instrument.ts` now sets `enableLogs: true`
to open Sentry's log-capture gate; that gate is independent of
`tracesSampleRate` (confirmed by reading `@sentry/core`'s
`logs/internal.js`, which never references sampling), so audit events are
still not subject to trace sampling — the property this design relies on.
Unit tests assert `telemetry-sentry-adapter.ts` routes WARN/ERROR/INFO to the
matching `Sentry.logger.*` call with the record intact. A live Sentry round
trip (real DSN, running server) was not possible in this environment and
remains unverified; a human with a test Sentry project should confirm the
end-to-end path once Docker/DB access is available.

Severity: unexpected failures (provider HTTP errors, secret generation failure,
DB errors, malformed callbacks) → `ERROR` log record. Expected
rejections (no invitation, unverified email, private relay, inactive user, org
mismatch) → `WARN` log record. Both now reach Sentry's log-capture path (via
the adapter) and are searchable, but a scripted run of unknown accounts reads
as a warning spike rather than burying a real outage in alerts.

**PII rule:** email addresses and provider `sub` values go only to the
`SaAuditEvent` row — never to OTel or Sentry, which get `saUser.publicId` and the
provider name. This matches the bug-0163 discipline of keeping credentials and
identifiers out of shared log streams.

## 8. The `resourceserver01` sample

The FastAPI sample already drives the entire round-trip through the admin
`/login` page (`apps/admin-e2e/tests/rs-round-trip.spec.ts`), so it inherits the
social buttons with **no protocol change**. Changes are about seeding, visibility
and assertion:

- `apps/auth-server/src/seed/demo-resource-server.ts` seeds a `SaSocialProvider`
  app row for `resourceserver01` and one **link-target user**, `social@cpm.io`
  (Citadel org, active, no prior link) — mirroring the existing `m@cpm.io` and
  `tfa@cpm.io` fixtures.
- `app/templates/authorized.html` renders the decoded `amr` and `idp` claims.
  This is what makes federation *provable*: the password round-trip shows `pwd`,
  the federated one shows `ext` + `idp`.
- The sample's `README.md` documents the social path.
- `app/oauth/verifier.py` is untouched — token verification does not change.

### Stub IdP

Real providers cannot authenticate a headless bot, and browser-level network
mocking cannot help because BetterAuth's token exchange happens **server-side in
Node**. CI therefore needs an OIDC provider it owns: a small fixture serving
discovery, authorize, token and JWKS, wired through BetterAuth's `genericOAuth`
plugin as provider `stub`.

**Safety rule:** the stub registers only when `NODE_ENV !== 'production'` **and**
`E2E_STUB_IDP_URL` is set. A stub IdP reachable in production is a total
authentication bypass, so a unit test asserts it stays absent under production
env.

## 9. Testing

**Unit (Jest, colocated as in this repo):** `resolveEnabledProviders` (global
row, app opt-out, missing credentials); `deriveAuthMethods` (all four cases
including the null-`signInMethod` fallback); the Apple secret generator (claims,
`kid` header, cache expiry, regeneration); the rejection-reason → error-code
mapper; `recordFederationEvent` with a failing DB write (must not throw); the
stub-provider production guard.

**Auth-server e2e:** discovery endpoint shapes; and that a callback for an
unknown identity creates **no `User` row** — the security-critical assertion of
the whole design.

**Admin e2e (Playwright), `rs-social-round-trip.spec.ts`:**

1. RS `/auth/login` → `/authorize` → `/login` renders the enabled buttons.
2. Stub sign-in as `social@cpm.io` → link created → RS `/auth/callback` shows
   "Signed in", `amr: ext`, `idp: stub`.
3. Second sign-in matches on `(providerId, sub)` — no duplicate `Account`.
4. Unknown identity → `/oauth-error?code=social_no_account`, and no new `User`.
5. Unverified email → `social_email_unverified`.
6. Provider disabled for the app → button absent.
7. 2FA-required app → federated sign-in still bounces to enrollment.

**Apple is not testable in CI** (form_post plus no `localhost` return URL) and is
documented as manual-verification-only against a public HTTPS deployment, rather
than pretended-covered.

The repo's e2e suite is currently red, so "tests pass" for this work means the
new suites pass and no *existing* failures are added.

## 10. Credentials for manual validation

CI needs **no real credentials** — the stub IdP covers linking, refusal and claim
assertions. Real credentials are needed only to validate the three live
integrations, and this list is a prerequisite for sign-off, not for the tests to
run. Full steps go in a new `docs/social-auth-setup.md`.

Every redirect URI is `{BETTER_AUTH_URL}/api/auth/callback/{provider}`.

**Google** — free. Cloud Console → new project → *APIs & Services → Credentials →
OAuth client ID → Web application*; consent screen External with your address as
a test user (no verification review needed while in Testing). Redirect URI
`http://localhost:3000/api/auth/callback/google` (plain-HTTP localhost is
permitted).

| Console value | Env var |
|---|---|
| Client ID | `GOOGLE_CLIENT_ID` |
| Client secret | `GOOGLE_CLIENT_SECRET` |

**Microsoft** — free. Entra admin center → *App registrations → New
registration*; platform **Web**, redirect
`http://localhost:3000/api/auth/callback/microsoft`; then *Certificates & secrets
→ New client secret* (max 24-month expiry — record the date, it will expire).

| Portal value | Env var |
|---|---|
| Application (client) ID | `MICROSOFT_CLIENT_ID` |
| Client secret **Value** (not the Secret ID; shown once) | `MICROSOFT_CLIENT_SECRET` |
| Directory (tenant) ID | `MICROSOFT_TENANT_ID` |

**Open item — still unverified after task-15 (2026-08-23):** which Entra
optional claim actually populates the fields BetterAuth reads
(`microsoft-entra-id.mjs:97`) has still not been confirmed against a real
tenant — this environment has no Entra tenant to test against, and task-15's
brief was explicit that inventing portal steps is worse than leaving this
open. `docs/social-auth-setup.md`'s Microsoft section states the same thing
and intentionally stops short of describing the optional-claim configuration.
This remains a plan task for whoever next has access to a real tenant; the
setup doc gets the real steps once known, rather than plausible-looking
invented ones.

**Apple** — requires a paid Apple Developer Program membership (~$99/year); there
is no free path. Needed: an **App ID** with Sign in with Apple enabled; a
**Services ID** (this is the `client_id`, not the App ID); a **Sign in with Apple
key** (`.p8`, downloadable exactly once); and **domain verification** by hosting
`apple-developer-domain-association.txt` on the return-URL domain.

| Apple value | Env var |
|---|---|
| Services ID | `APPLE_CLIENT_ID` |
| Team ID | `APPLE_TEAM_ID` |
| Key ID of the `.p8` | `APPLE_KEY_ID` |
| Contents of the `.p8` | `APPLE_PRIVATE_KEY` |

There is no `APPLE_CLIENT_SECRET` — §6 generates it. Apple cannot be validated on
localhost: return URLs must be HTTPS on a verified domain, so validation needs a
public tunnel or a deployed instance whose hostname is both registered as the
return URL and set as `BETTER_AUTH_URL`.

## 11. Out of scope

Deliberately excluded, with the design shaped so each can be added without
rework:

- **Just-in-time org provisioning** — social sign-in creating an org + user the
  way `/api/register` does.
- **Domain-claimed orgs** — an org declaring verified email domains that route
  matching users into it. Requires a domain-verification subsystem; without one
  it is a vulnerability, not a feature.
- **Per-app provider credentials** and their encryption at rest (§4 keeps the
  schema ready).
- **GitHub**, already present in `auth.config.ts` but not part of this work.
- **Account unlinking UI** and the "user must retain at least one credential"
  rule. `social.link.removed` exists in the audit event type set so the trail is
  ready when unlinking ships.
- **Trusting provider-asserted MFA** (§5).
