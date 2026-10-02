# Code-first signup flow (email → code → password → name) — design

**Date:** 2026-10-02
**Status:** draft, pending user review
**Scope:** for `SaApp`s configured with `emailVerificationMethod: 'code'`
only, replace today's single-page signup form with a 4-step wizard that
verifies the email *before* collecting a password or name, matching the
reference flow in `docs/zyte/{1,2,3a,3b,4}.png`. Apps on `emailVerificationMethod: 'link'`
are completely unaffected — they keep today's one-page form and the
`check-email`/`verify-email` flow exactly as shipped.

**Explicitly out of scope** (deferred to their own design docs, or require
no design at all):
- Social sign-up buttons (step 1 in the Zyte reference shows "Sign up with
  Google/Github"). Every social provider in this codebase has
  `disableSignUp: true` set deliberately, platform-wide, to keep federation
  invite-only (`build-social-providers.ts:54-65`) — that flag is evaluated
  by a single shared BetterAuth instance with no awareness of which `SaApp`
  initiated the request, so making it a genuine per-app opt-in requires new
  BetterAuth hook work that hasn't been scoped yet. Separate design doc.
- The password "1 symbol" rule from the Zyte reference needs **no new
  code at all**: `PasswordPolicy.requireSpecial`/`minSpecial` and
  `evaluatePasswordPolicy` (`packages/types/index.ts:62-121`) already exist
  platform-wide, and `PasswordRequirementsChecklist` already renders
  whatever rules a policy enables. Turning it on for an app is an existing
  admin config change, not part of this design.
- A "setting up your account" provisioning screen after step 4 — the Zyte
  reference's `provisioning.htm` has no corresponding screenshot to copy,
  and nothing in the current `/signup` flow has an equivalent step.

## 1. Problem and stance

Today, `emailVerificationMethod: 'code'` apps (added in
`docs/superpowers/specs/2026-10-01-signup-email-otp-verification-design.md`)
collect name/email/password in one form, submit, and only *then* see a
6-digit code entry screen (`/signup/check-email` → `VerifyCodeCard`). The
account (BetterAuth user + `SaUser` + org) is fully created before the code
is ever checked.

The reference flow collects and verifies the email *first*, and only asks
for a password and name once the email is proven real. This is a materially
different sequencing, not a UI reorder: it changes *when* the account gets
created relative to *when* the email gets verified.

## 2. Why the account must be created at step 1, not step 4

BetterAuth's own OTP-check endpoints both require the user to already
exist:

- `checkVerificationOTP` (`/email-otp/check-verification-otp`) —
  `routes.mjs:235`: `if (!await ctx.context.internalAdapter.findUserByEmail(email)) throw ... USER_NOT_FOUND`
- `verifyEmailOTP` (`/email-otp/verify-email`) — `routes.mjs:311-317`: same
  `findUserByEmail` requirement.

So a code cannot be checked against "just an email" with these endpoints —
there must be a BetterAuth `User` row first. The alternative (re-implementing
OTP matching/attempt-counting/expiry against the `Verification` table
directly, bypassing both endpoints) would duplicate `routes.mjs`'s
`storeOTP`/`verifyStoredOTP`/attempt-tracking logic, which supports multiple
storage modes (plain/hashed/encrypted) — real, fragile, and unnecessary
work. Creating the account one step earlier is simpler and keeps us on
supported, already-tested BetterAuth primitives for everything else.

This is safe with respect to the existing session-gate invariant: the
codebase comment at `auth.config.ts:457-466` already establishes that
`signUpEmail` with `autoSignIn: false` never attempts to create a session,
so creating the BetterAuth user early doesn't risk tripping
`evaluateSessionGate` (which requires an active `SaUser` — not created
until step 4).

## 3. Flow

One client component on `/signup` (not separate routes) holds a `step`
index in local state — same shape as today's `signup-form.tsx`, just with
4 screens instead of 1. The password never touches the URL or browser
history. `link` apps keep rendering the existing single form; the decision
is the same `fetchAppInfo(clientId).emailVerificationMethod` branch
`/signup/page.tsx` already makes.

**Step 1 — Email.** `POST /api/register/start { appPublicId, email }`:
1. Same duplicate-email semantics as today's `register()` — except
   "duplicate" now means *verified* duplicate. If a BetterAuth user exists
   for this email with `emailVerified: false` and no linked `SaUser`, this
   is an **abandoned step-1 signup** (see §5) — reuse it and resend a code
   instead of erroring.
2. Otherwise: `auth.api.signUpEmail({ email, password: <random 32-char
   placeholder, never shown or emailed>, name: '' })`.
3. `auth.api.createVerificationOTP({ email, type: 'email-verification' })`
   + email it via the existing `sendVerificationCode` helper
   (`verification-code-sender.ts`), reusing the app's `activationEmailOverride`
   branding exactly as the current 'code' path does.
4. Rate-limited the same way `POST /api/register` is today.

**Step 2 — Code.** `POST /api/register/verify-code { email, otp }` →
`auth.api.checkVerificationOTP({ email, type: 'email-verification', otp })`.
This does **not** consume the code, so a wrong entry can be retried without
burning the attempt budget BetterAuth itself doesn't expose separately.
Errors map to inline UI states exactly like `VerifyCodeCard` already
handles today: `INVALID_OTP` ("wrong code"), `OTP_EXPIRED`/`TOO_MANY_ATTEMPTS`
("request a new code"). "Resend code" re-runs step 1's send logic (same
account, new OTP).

**Step 3 — Password.** Client-only — no backend call. `evaluatePasswordPolicy`
validates live via the same `PasswordRequirementsChecklist` component
`link`-flow signup already uses, now joined by a 5-segment strength-bar
component (new, presentational, no new policy logic — see §6).

**Step 4 — Name, then submit.** Collects `firstName`/`lastName`/`companyName`
(when the app has no default org)/consents/`marketingOptIn`, then
`POST /api/register/complete` with everything gathered across all 4 steps
(email, the OTP from step 2, password, name, consents):
1. `auth.api.verifyEmailOTP({ email, otp })` — consumes the code for real,
   sets `emailVerified: true`, and independently guards against someone
   skipping straight to this endpoint with a stale/guessed code.
2. Sets the real password, replacing the step-1 placeholder (via
   BetterAuth's session-less `resetPassword` token flow, or a direct
   `Account` password-hash update using BetterAuth's own hashing utility —
   whichever is more cleanly available is pinned down during planning, not
   here).
3. Runs the exact same org/`SaUser`/consent transaction `register()` already
   runs today (`registration.service.ts:176-213`), plus writing
   `marketingOptIn`.
4. Does **not** call `auth.api.sendVerificationEmail` — the email is already
   verified. Today's unconditional call at `registration.service.ts:216-218`
   becomes conditional on `app.emailVerificationMethod`.
5. Same PKCE/redirect-back-to-app logic as today, unchanged.

**Consequence:** once this ships, `code` apps never reach
`/signup/check-email` — they verify and create the account entirely within
`/signup`. The `VerifyCodeCard`/`check-email` branch added by the previous
design becomes dead code *for `code` apps specifically* (`link` apps still
use it exactly as today). The implementation plan should remove that
now-unreachable branch rather than leave two code paths doing the same job.

## 4. OTP expiry mid-flow

`emailOTP.expiresIn` (5 minutes) is a single BetterAuth-plugin-wide value
shared by sign-in OTP, 2FA step-up, password-reset OTP, and
email-verification OTP alike (`email-otp/index.mjs:14` — there is no
per-type override in this BetterAuth version). So it is **not** changed by
this design — doing so would widen the replay window for sign-in OTP and
password-reset OTP, flows this feature has nothing to do with.

Instead: if step 4's `verifyEmailOTP` call fails with `OTP_EXPIRED` (the
user spent too long on steps 3-4), the client auto-triggers a resend
(step 1's send logic, same account) and bounces back to the code step —
**without discarding** the password/name already typed, since all of that
lives in the wizard's client-side state regardless of which step is showing.

## 5. Abandoned step-1 signups

A user who finishes step 1 (account created, code sent) and never returns
leaves a BetterAuth `User` row behind with a placeholder password and
`emailVerified: false`. Two complementary mitigations:

- **Idempotent restart**: step 1, on finding an existing unverified,
  `SaUser`-less account for that email, reuses it and resends a code rather
  than returning a duplicate-email error — so retrying an abandoned signup
  just works.
- **Cleanup sweep**: a new service, sibling to the existing
  `OauthCodeCleanupService` pattern, running on the same kind of interval,
  deletes BetterAuth `User` rows that are `emailVerified: false`, have no
  linked `SaUser`, and are older than 24 hours.

## 6. New UI: password strength meter

Purely presentational — a 5-segment bar driven by the same
`evaluatePasswordPolicy` results already computed for the checklist (e.g.
segments lit = rules met / rules total, or a simple bucketed score). No new
password-policy logic; `requireSpecial`/`minSpecial` already flow through
`evaluatePasswordPolicy` today if an app's `PasswordPolicy` enables them.

## 7. Data model changes

```prisma
model SaUser {
  // ...existing fields...
  /// Captured at signup step 4 for `code`-method apps (and available to
  /// `link` apps too, via the same form field, if they choose to collect
  /// it — nothing here is 'code'-method-specific). Nothing in the
  /// platform consumes this yet; it's recorded for a future use.
  marketingOptIn Boolean @default(false)
}
```

A migration adds the column with the default — no backfill needed.

## 8. New backend surface

- `POST /api/register/start` — new controller route + service method,
  sibling to today's `POST /api/register`.
- `POST /api/register/verify-code` — new, thin wrapper around
  `auth.api.checkVerificationOTP`.
- `POST /api/register/complete` — replaces what `POST /api/register` does
  for `code`-method apps; `link`-method apps keep using today's
  `POST /api/register` unchanged.
- New cleanup service for abandoned step-1 signups (§5), registered the
  same way `OauthCodeCleanupService` is.

Each of the three new endpoints needs its own rate-limit guard instance
(same `RateLimitGuard` pattern as `AppLookupRateLimitGuard`), since they're
distinct abuse surfaces from both each other and from
`POST /api/register`/`GET /api/register/app`.

## 9. Testing

- **Backend**: unit tests for `start`/`verify-code`/`complete` mirroring
  `registration.service.spec.ts`'s existing structure — duplicate-email vs.
  abandoned-signup-reuse, OTP valid/invalid/expired/too-many-attempts,
  `complete` correctly skipping `sendVerificationEmail` and correctly
  persisting `marketingOptIn`. New `cleanup-abandoned-signups.spec.ts`
  mirroring the existing `OauthCodeCleanupService` test shape.
- **Frontend**: a new wizard component's test suite covering each step's
  validation, forward/back navigation, that password/name survive an
  expired-code bounce-back (§4), and that `marketingOptIn` is submitted.
  `signup-form.test.tsx` (the `link`-flow form) stays untouched.
- **Password strength meter**: presentational component, snapshot/interaction
  tests only.

## 10. Explicitly out of scope (recap)

- Social sign-up buttons — separate design doc (BetterAuth hook research
  needed; see top of this doc).
- Password symbol rule — already fully implemented platform-wide; just an
  admin config toggle, not covered by this design.
- A "provisioning"/account-setup loading screen after step 4.
- Any change to `link`-method apps' signup flow.
- Any change to sign-in OTP, 2FA, or password-reset OTP behavior or
  `expiresIn`.
