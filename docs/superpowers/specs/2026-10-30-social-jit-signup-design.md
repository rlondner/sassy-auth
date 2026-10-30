# Just-in-time social signup — design

**Date:** 2026-10-30
**Status:** approved design, no implementation plan yet
**Scope:** let a first-time social sign-in (Google, Microsoft, Apple) auto-provision
an `SaUser` for apps that opt in, instead of always refusing an unrecognized
identity.

---

## 1. Problem and stance

The existing social-authentication design
([`2026-08-22-social-authentication-design.md`](2026-08-22-social-authentication-design.md))
deliberately made social sign-in invite-only: `disableSignUp: true` on every
provider means an unrecognized identity is refused before BetterAuth ever
creates a `User` row, and Just-in-time org provisioning was explicitly listed
as out of scope (§10/§11), "shaped so it can be added later without rework."

This is that rework. Some apps want social sign-in to behave like self-serve
email signup already does: a first-time identity should become a working
account, not a refusal.

**Scope decision — reuse `defaultOrgId`/`defaultRoleId`, not a new flag.**
`registration.service.ts` already uses `SaApp.defaultOrgId`/`defaultRoleId` to
decide whether self-serve email signup drops a new user into an existing org
with a default role, versus requiring a `companyName` to found one. JIT social
signup reuses that exact signal: **any app — platform or not — with both
fields set becomes eligible for JIT social signup the moment this ships**, no
new schema, no new admin-console checkbox, no separate opt-in. An app without
both fields stays invite-only exactly as today, because there is no
`companyName`-style capture step in the social flow to found a brand-new org
for it.

**This is a deliberate security posture change, not a side effect.** Because
eligibility is keyed only on `defaultOrgId`/`defaultRoleId` with no carve-out
for `SaApp.isPlatform`, an operator who sets those two fields on the platform
app (the admin console's own app) enables anyone with a Google/Microsoft/Apple
account to self-provision a console user the moment they complete that
provider's consent screen. Today, `SocialService.setForApp` and
`AppsService.updateApp`/`deleteApp` already refuse to let the platform app's
settings be mutated through those specific endpoints — this is unrelated: it
does not add a new control, it only means an *existing* `defaultOrgId`/
`defaultRoleId` on the platform app (however it was set) now also unlocks
unauthenticated social signup for it. Operators must understand that setting
a default org/role on the platform app is the actual control surface here.

## 2. Why this requires touching `disableSignUp`

`disableSignUp: true` works by returning an error from inside BetterAuth's own
`handleOAuthUserInfo` **before** a `User` row is created
(`link-account.mjs:74`, confirmed in the original design doc). By the time our
`/callback/:id` `hooks.after` runs on that refusal, the verified provider
profile (`emailVerified`, `name`, etc.) has already been discarded — there is
no hook point that sees both "this identity is unrecognized" and "here is its
verified profile data" under `disableSignUp: true`. So provisioning from a
refusal is not possible with the current switch; the only way to get a hook
that sees created-user data is to let BetterAuth actually create the user.

Also load-bearing: `disableSignUp` is a single value per provider in
`buildSocialProviders()`, evaluated once at process start from env vars. It is
**not** request-scoped and cannot vary per app — a provider's config has no
visibility into which app's `/authorize` flow kicked off the sign-in. This
rules out any design where `disableSignUp` itself is conditioned on
"non-platform" or "has defaultOrg" per request.

**Resolution:** flip `disableSignUp: false` for every provider in
`build-social-providers.ts`, so BetterAuth always creates a `User`/`Account`
row for a first-time identity, and move the actual eligibility decision into a
new `databaseHooks.user.create.after` hook that runs immediately afterward —
early enough to still compensate before the browser sees anything.

## 3. Flow

1. `/authorize` → `/login?next=<authorize-url>` → social button → BetterAuth
   provider round-trip → `/api/auth/callback/{provider}` — unchanged from the
   existing design.
2. BetterAuth's own account-linking rule runs first, unchanged: match on
   `(providerId, accountId)`, then on a provider-verified email. If either
   matches an **existing** `SaUser`-linked identity, nothing in this design
   applies — that is today's returning-user path.
3. **New:** if neither matches, `disableSignUp: false` now lets BetterAuth
   create a `User` + `Account` row (instead of refusing). The new
   `databaseHooks.user.create.after(user, context)` hook fires immediately:
   a. Recovers the target app's `client_id` — **verified mechanism**, not an
      open item: a new `hooks.before` branch (in the same `createAuthMiddleware`
      matcher `auth.config.ts` already has) matches `/callback/:id`, reads
      the `state` query/body param, and calls
      `ctx.context.internalAdapter.findVerificationValue(state)` — a
      **read-only** lookup of the same `Verification` row BetterAuth's own
      `parseState` will consume moments later. This must be read-only: this
      deployment's `storeStateStrategy` resolves to `"database"` (BetterAuth
      defaults to `"database"` whenever `options.database` is set and
      `options.account.storeStateStrategy` isn't overridden, which is this
      config's situation — confirmed in `@better-auth/core`'s
      `create-context.mjs`), and that strategy's `parseGenericState` calls
      `internalAdapter.deleteVerificationByIdentifier(state)` — calling
      BetterAuth's own `parseState` ourselves a second time, instead of
      reading the row directly, would delete it before BetterAuth's real
      callback handler gets to, breaking every social sign-in. The found
      row's `value` is `JSON.stringify({ callbackURL, ... })`
      (`oauth2/state.mjs`'s `generateGenericState`); `JSON.parse` it, read
      `callbackURL`, and extract `client_id` via
      `new URL(callbackURL).searchParams.get('client_id')` — the same shape
      `recoverAuthorizeParams` (`registration.service.ts`) already parses
      for email signup. The result is captured into a new AsyncLocalStorage
      module (e.g. `social-signup-app-context.ts`, mirroring the existing
      `apple-private-relay-context.ts`/`social-consent-context.ts` pattern)
      so the later `databaseHooks.user.create.after` hook — which runs
      within the same request's async context but has no direct access to
      `ctx.query`/`ctx.body` itself — can read it back. A missing/unparsable
      state, row, or `client_id` captures `null`, which §3's step (b)
      already treats as "unresolvable `client_id`" → the ineligible path.
   b. Resolves the `SaApp` row for that `client_id` and checks
      `defaultOrgId !== null && defaultRoleId !== null`.
   c. **Eligible:** creates the `SaUser` synchronously (see §4).
   d. **Ineligible** (unresolvable `client_id`, or app missing either
      default field): deletes the just-created `User` row (cascades to its
      `Account` row) — a compensating delete, see §3a for why this must be an
      explicit delete rather than a transaction rollback — then throws, which
      §3a describes producing a dedicated, friendly redirect rather than
      today's generic `social_no_account` refusal. **No orphan `User`/
      `Account` row is left behind for any app that doesn't opt in** — the
      one property the original design cared most about is preserved for
      everyone except the apps that explicitly opted in via `defaultOrgId`/
      `defaultRoleId`.
4. BetterAuth's normal post-callback flow continues for an eligible app:
   `databaseHooks.session.create.before` re-runs `evaluateSessionGate` (now
   finds the freshly-created, active `SaUser` and allows the session), the
   existing social consent gate (§5) fires, and `/authorize` re-runs its
   existing checks and issues the code. No new authorization logic is added
   downstream of session creation — a JIT-provisioned user is, from that
   point on, indistinguishable from an invited one. For an ineligible app,
   the thrown error in step 3d short-circuits this entirely — see §3a.

### 3a. The ineligible-app redirect — verified against the installed BetterAuth source

The ineligible-app case needs its own error page ("you can't sign up for this
app this way"), distinct from the existing generic `social_no_account` —
that code means "you personally have no account," this means "this app
doesn't support signup at all," which is true for every visitor, not a
property of who's asking.

Producing a real `FOUND` redirect (not a raw error status) for a failure
originating in *our own* hook — rather than BetterAuth's own account-linking
refusal — looked uncertain at design time. Reading the installed
`better-auth@1.6.11` / `@better-auth/core@1.6.11` source resolved it:

- `databaseHooks.<model>.create.after` hooks are not awaited inline by
  `createWithHooks` (`db/with-hooks.mjs`) — they're registered via
  `queueAfterTransactionHook(...)` (`@better-auth/core`'s
  `context/transaction.mjs`), which **defers them until after the enclosing
  DB transaction commits**, then runs them **synchronously, awaited, still
  inside `runWithTransaction`'s own call frame**, before that frame returns
  to its caller.
- `oauth2/link-account.mjs`'s signup branch calls
  `c.context.internalAdapter.createOAuthUser(...)` (which wraps both the
  `User` and `Account` inserts in one `runWithTransaction`) inside a
  `try { ... } catch (e) { if (isAPIError(e)) return { error: e.message, ... }; ... }`.
  Because our `user.create.after` hook runs *inside* that same await chain
  (per the point above), **anything it throws propagates straight into this
  catch block** — not lost, not swallowed, not an unhandled rejection.
- `isAPIError` accepts any `better-auth/api` `APIError` instance — exactly
  the class `auth.config.ts` already imports and already throws from another
  hook (the `/reset-password` policy check). So our hook can
  `throw new APIError('BAD_REQUEST', { message: 'social_signup_unavailable' })`
  and `link-account.mjs` turns that into `{ error: 'social_signup_unavailable' }`.
- `api/routes/callback.mjs` then does
  `return redirectOnError(result.error.split(' ').join('_'))` — the **exact
  same mechanism** `signup_disabled` and `account_not_linked` already ride
  today — producing a native `FOUND` redirect to
  `<errorCallbackURL>?error=social_signup_unavailable`. `classify-callback-
  outcome.ts` already reads this `error` query param; it needs one new,
  unconditional mapping entry for this code (no `classifyRejection`
  matchedUser/emailVerified nuance applies here — every visitor to an
  ineligible app gets the same message).

Because the transaction has already committed by the time our hook runs, the
compensating delete (§2d) is still required — this mechanism gets us a clean
redirect, not a free rollback. Delete the rows, *then* throw.

A new `/oauth-error` code, `social_signup_unavailable`, is added alongside
the existing ones in `apps/admin/app/oauth-error`'s `KNOWN_CODES` set and
`messages/en.json`/`messages/fr.json`, with copy that reads as an app-level
fact ("Sign-up isn't available for this app"), not a personal rejection.

## 4. Provisioning a new `SaUser`

Mirrors `registration.service.ts`'s `finishRegistration`, with the differences
a social sign-in implies:

- `status: 'active'` immediately — unlike email signup's `'unverified'`
  start, the provider has already verified the email (BetterAuth's own
  account-linking rule, preserved from the original social-auth design,
  already requires this before reaching here), so there is no
  verification-email step to wait on. Mirrors `completeRegistration`'s
  `saUserStatus: 'active'` path, not `register()`'s `'unverified'` one.
- `orgId` = `app.defaultOrgId`, and one `SaUserRole` row is created for
  `app.defaultRoleId` — identical to `finishRegistration`'s existing
  `if (app.defaultRoleId) { tx.saUserRole.create(...) }` branch.
- `firstName`/`lastName`: use the provider's `given_name`/`family_name`
  claims when present (Google reliably supplies these); otherwise split the
  profile's single `name` field on the first space, everything after the
  first space becoming `lastName` (a lone single-word name yields an empty
  `lastName`). Applied uniformly regardless of provider — this is a
  best-effort fallback for Microsoft/Apple, not provider-specific branching
  beyond "did this provider give us given_name/family_name."
- `publicId`: same convention as `finishRegistration`
  (`baUserId.slice(0, 12)`).
- No `SaUserConsent` rows are written here — see §5, the existing consent
  gate handles this for free precisely because none exist yet.
- A new `SaAuditEvent` type, `social.signup.created`, is recorded alongside
  the provisioning write (fire-and-forget, try/catch-logged, same discipline
  as `recordFederationEvent`'s other call sites — an audit failure must never
  block the sign-in). Fields mirror the existing social audit events:
  `provider`, `saUserId`, `betterAuthUserId`, `appId`.

## 5. Consent — reusing the existing social consent gate, no new UI

No new interstitial is needed. `auth.config.ts`'s `hooks.after` on
`/callback/:id` already runs `resolveOutstandingConsent` +
`appendConsentRedirect` for **every** successful social sign-in (new or
returning) and redirects to `/login/consent?appPublicId=...&next=...` when
the target app has required docs (`privacyPolicyUrl`/`termsUrl`/`gdprUrl`)
the signed-in `SaUser` has not yet accepted.

A JIT-provisioned user has zero `SaUserConsent` rows at the moment this gate
runs (provisioning in §4 deliberately writes none), so
`resolveOutstandingConsent` naturally returns every required document as
outstanding, and the existing redirect fires exactly as if an existing linked
user were missing consent for a newly-added policy. This is pure reuse of an
already-shipped mechanism — no new page, no new route, no new consent-record
logic.

## 5a. Showing the button on `/signup`, gated on eligibility

Today, `/login`'s `SocialButtons` are shown whenever an app has any enabled
providers, regardless of this feature — they serve **returning** users
(account-linking sign-in, which works via BetterAuth's own linking rule on
any app, invite-only or not) as much as first-time ones. Hiding them there
based on `defaultOrgId`/`defaultRoleId` would wrongly block already-invited
users from using Google/Microsoft/Apple to sign in to an invite-only app —
unrelated to this feature, and a real regression. `/login` is unchanged.

Instead, the dedicated `/signup` page (`apps/admin/app/signup/signup-form.tsx`
and its code-verification sibling `signup-wizard-card.tsx`) — today
email/password only, with no social option at all — gains the same
`SocialButtons` component (extracted to a shared location rather than
duplicated), rendered **only** when the app is JIT-signup-eligible
(`defaultOrgId !== null && defaultRoleId !== null`). This is a new capability
on `/signup`, not a conditional hide of something that exists there today.

`RegistrationService.getAppName` (the `/signup` page's existing data source,
exposing `hasDefaultOrg`) is extended to also select `defaultRoleId` and
return the combined eligibility boolean (e.g. `canSocialSignup`). The enabled
provider list itself comes from the same discovery call `/login` already
makes (`fetchSocialProviders` → `GET /api/social-providers?client_id=...`) —
no new endpoint. `/signup` renders the buttons only when both
`canSocialSignup` is true and that list is non-empty; everything else about
the page (companyName capture when there's no default org, consent
checkboxes, password form) is unchanged and unaffected by this addition.

## 6. What does NOT change

- `evaluateSessionGate`, the 2FA enrollment interception at
  `token.controller.ts`, and `deriveAuthMethods`'s `amr`/`idp` claim logic are
  all untouched and apply to a JIT-provisioned user exactly as they do to an
  invited one.
- BetterAuth's own account-linking precedence (§3 of the original design:
  `(providerId, accountId)` first, then verified email, deliberately never
  trusting any provider) is unchanged. This design only changes what happens
  when that rule finds **no** match.
- `resolveEnabledProviders` (which providers an app's login page shows) is
  unrelated and unchanged — an app can show a Google button without being
  JIT-signup-eligible; the button still works for an *existing* linked user,
  it just can't create a new one.
- Microsoft's known gap (Entra not emitting `email_verified` by default,
  documented in the original spec and `docs/social-auth-setup.md`) is
  unchanged — if a provider-asserted email isn't verified, BetterAuth's own
  linking rule never reaches our hook with a creatable identity in the first
  place; this design does not relax that rule.

## 7. Testing

**Unit (Jest):**
- The eligibility check (app has both `defaultOrgId` and `defaultRoleId`) as
  a pure function, given a fixture app row — mirrors how
  `resolveEnabledProviders` is tested with no HTTP/BetterAuth involved.
- Name-derivation helper: `given_name`/`family_name` present → used directly;
  absent → `name` split on first space; single-word `name` → empty
  `lastName`.
- The compensating-delete path: given an ineligible app (or unresolvable
  `client_id`), asserts the `User` row created by the hook's preconditions is
  deleted and no `SaUser` exists afterward.
- The provisioning path: given an eligible app, asserts the created `SaUser`
  has `status: 'active'`, the correct `orgId`, an `SaUserRole` row for
  `defaultRoleId`, and a `social.signup.created` audit event — no
  `SaUserConsent` rows.

**Auth-server e2e (extends the existing stub-IdP suite):**
- A first-time stub-IdP identity against an eligible app creates exactly one
  `SaUser`, active, in the right org/role, and the OAuth round-trip completes
  with a working code — the mirror image of the original design's
  security-critical "creates no `User` row" assertion for an *ineligible* app,
  which must still hold: **a first-time identity against an app with no
  `defaultOrgId`/`defaultRoleId` ends with no `User` row and no `SaUser`
  persisted** (the compensating delete in §2d/§3a actually removes what the
  transaction committed), and the browser lands specifically on
  `/oauth-error?code=social_signup_unavailable` — not the generic
  `social_no_account` a truly-unknown identity against an invite-only app
  would have produced before this feature existed.
- An eligible app with `privacyPolicyUrl` set: first social sign-in bounces
  to `/login/consent` before the OAuth code is issued, and accepting there
  completes the flow.
- A second sign-in from the same stub identity matches the now-existing
  `Account` row (BetterAuth's own linking logic) — no duplicate `SaUser`, no
  re-provisioning.

**Admin e2e (Playwright):** one round-trip test extending
`rs-social-round-trip.spec.ts`'s existing suite: unknown stub identity against
a newly-eligible demo app signs up, lands authenticated on the RS, and shows
`amr: ext`, `idp: stub` — same claim assertions as the existing linked-user
case, proving a JIT-provisioned user is indistinguishable downstream. A
second test covers the `/signup` page: the social button is present for an
eligible app's `client_id` and absent for an ineligible one.

## 8. Out of scope

- **A new admin-console toggle independent of `defaultOrgId`/`defaultRoleId`.**
  Rejected during design — reusing the existing fields was the explicit
  choice over adding a separate `allowSocialSignup` flag.
- **Just-in-time org *creation*** (an app without a `defaultOrgId` founding a
  brand-new org from a social sign-in, the way `companyName` does for email
  signup). There is no form step in the social flow to collect a company
  name, and none is added here — an app without `defaultOrgId` stays
  invite-only.
- **Per-provider eligibility** (e.g. Google but not Apple). Rejected during
  design — the same eligibility rule applies uniformly across all three
  providers.
- **A platform-app carve-out.** Rejected during design — see §1's explicit
  security-posture note; the platform app is eligible exactly like any other
  app the moment it has both default fields set.
