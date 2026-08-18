# Two-Factor Authentication — Per-App Enforcement (2b) — Design

**Status:** Approved (brainstorming)
**Date:** 2026-07-12
**Author:** contact@milissai.com (with Claude)

## Context

This is **sub-project 2b** of the two-part 2FA program. **2a** (see
`2026-07-12-2fa-core-design.md`) delivered the *optional* path end to end: the
TOTP + backup-code mechanism (BetterAuth `twoFactor` plugin), self-service
enrollment/management at `/account/security`, a no-bypass sign-in challenge for
every interactive method, a skippable login-time proposal, a per-app configurable
trust/re-prompt interval (`SaApp.twoFactorTrustDays`), and admin-assisted reset.

2a explicitly scoped **out** — and 2b now delivers:

- a `SaApp` policy that **requires** 2FA,
- **forced enrollment** at the OAuth authorize step,
- 2FA handling on the non-interactive `POST /api/token/direct/login` path,
- how the JWT **signals** 2FA to the resource server (`amr`).

### Architecture that shapes the design

End users reach the auth-server through the **OAuth authorize flow**:
`GET /api/token/oauth/authorize` validates the `SaApp` (by `client_id`), checks
the BetterAuth session, enforces `SaUser.status === 'active'`, then issues an auth
code the resource server exchanges at `POST /api/token/oauth/token`. When there is
no session, authorize bounces the browser to the admin app's `/login` with
`next` = the full authorize URL, so **`/login` is the auth-server's hosted login
UI for end users** and the target app's `client_id` is known at login time.

The token exchange (`issueJwt`) is **decoupled** from the interactive login: by
the time it runs, the TOTP challenge is over and the request carries only the auth
code. Anything the JWT must reflect about *how* the user authenticated therefore
has to be **carried on the authorization code** from authorize → token.

There is also a non-interactive `POST /api/token/direct/login` (password → signed
RS256 JWT, no BetterAuth session).

Because 2a's `twoFactorEnabled` is a **global per-user** flag, once a user enrolls
(forced by any required app) they are enrolled everywhere and are challenged at
every interactive sign-in thereafter. Enforcement's novel work is therefore
(a) forcing enrollment for not-yet-enrolled users and (b) signalling 2FA on the
JWT — not re-challenging already-enrolled users, whom 2a already covers.

## Goals

- A per-app policy `SaApp.requireTwoFactor` that mandates 2FA to authenticate into
  that app.
- **Forced enrollment inline at the authorize step**: an active but non-enrolled
  user targeting a required app is routed through TOTP enrollment and only then
  receives an auth code — no way into the app without enrolling.
- **`amr` on the JWT** (RFC 8176) so resource servers can assert 2FA was used.
- **`direct/login` enforcement**: the non-interactive path accepts an optional
  `totpCode`, verifies it server-side (session-less), and issues a `mfa` JWT;
  otherwise it returns `403 two_factor_required`.
- A safe admin surface: a `requireTwoFactor` toggle on the app form for
  **non-platform** apps; platform-app enforcement is configured **out-of-band**
  via an env flag (the platform app is immutable through the app UI).

## Non-Goals

- The 2FA **mechanism**, enrollment UI, sign-in challenge, optional proposal,
  trust interval, and admin reset — all delivered in **2a**.
- A system-wide "require 2FA for everyone" switch. Enforcement is strictly
  per-app; the default is not-required.
- Non-interactive **self-enrollment**. A user with no 2FA who hits `direct/login`
  for a required app is rejected; they must enroll once via the interactive flow.
- **Backup codes on `direct/login`.** The non-interactive path accepts `totpCode`
  only. Backup codes stay an interactive-only recovery factor — consuming a
  one-time backup code outside better-auth's own verify endpoint would risk
  double-spend divergence across paths.
- A platform-app **UI toggle** or a UI/server "self-first" guardrail. Platform
  enforcement is env-driven and operational; there is no mutable platform-app
  edit path to guard.
- Step-up / per-request AAL escalation, or distinguishing "fresh TOTP this login"
  from "trusted device" in `amr` (see Security Contract — both resolve to `mfa`).

## Security Contract

- **No un-enrolled access to a required app:** the authorize gate and the
  `direct/login` gate both fail closed. A non-enrolled user cannot obtain an auth
  code or a JWT for a `requireTwoFactor` app. "Required" is the effective value:
  `app.requireTwoFactor || (app.isPlatform && PLATFORM_REQUIRE_2FA env flag)`.
- **Truthful `amr`:** `amr` includes `mfa`/`otp` **iff** the user is
  `twoFactorEnabled` at authenticate time. This is truthful because 2a guarantees
  no `twoFactorEnabled` user obtains a session (or passes `direct/login`) without
  the second factor — including trusted-device sessions, which are 2FA-bound by
  construction.
- **Never logged:** TOTP secrets, `otpauth` URIs, backup codes, and entered codes
  (unchanged from 2a's bearer-credential posture). `direct/login` code fields are
  never logged.
- **No self-lockout by accident:** the platform app cannot be toggled through the
  mutable app UI (it rejects all platform edits), so platform enforcement is a
  deliberate env-flag decision; 2a's admin-assisted "Reset 2FA" remains the
  recovery valve for any operator lockout.
- The existing `status === 'active'` gates at authorize and token are unaffected
  and continue to run.

---

## Section 1 — Data model & config

- **`SaApp.requireTwoFactor Boolean @default(false)`** added to
  `packages/db/schema.prisma`, plus a Prisma migration.
- No new `User`/`SaUser`/session columns. Enforcement reads the existing global
  `User.twoFactorEnabled` (2a).
- **Effective-requirement resolver** `isTwoFactorRequired(app)` (mirroring 2a's
  `getSystemTrustDays`/`resolveTrustDays` env pattern): returns
  `app.requireTwoFactor || (app.isPlatform && PLATFORM_REQUIRE_2FA)`, where
  `PLATFORM_REQUIRE_2FA` is a boolean env flag (default false). This is the single
  source of truth consulted by both the authorize gate and `direct/login`.

## Section 2 — Forced-enrollment gate at authorize

In the `GET .../oauth/authorize` handler, **after** the existing session and
`status === 'active'` checks and **before** issuing the code, add one gate:

```
if (isTwoFactorRequired(app) && !user.twoFactorEnabled) {
  redirect → <adminUrl>/account/security?enroll=1&next=<full authorize URL>
}
```

- The `/account/security` enroll flow (2a) runs the real TOTP enable + confirm
  (`skipVerificationOnEnable` stays false, so no lockout from a mis-scanned QR).
  On success `twoFactorEnabled` flips true and the page redirects back to `next`
  (the authorize URL), which now passes the gate and issues the code.
- This **supersedes 2a's skippable interstitial** for required apps: when the
  enroll page is entered with `enroll=1` (forced-enrollment context), the "Skip
  for now" affordance is hidden and enrollment is mandatory.
- Already-enrolled users pass straight through — 2a's sign-in challenge already
  guaranteed the second factor before the session existed.

## Section 3 — `amr` on the JWT

- **Source at authorize:** resolve `amr` from `user.twoFactorEnabled` at the
  authorize step (where the session and `saUser` are in hand). `true` →
  `["pwd", "otp", "mfa"]`; `false` → `["pwd"]`. Truthful per the Security
  Contract; trusted-device logins still resolve to the `mfa` set because the
  account is 2FA-bound.
- **Carry on the auth code:** stamp the resolved `amr` onto the authorization-code
  payload alongside the user/app/org it already carries, so the decoupled token
  exchange can read it without any session context.
- **`issueJwt`:** add an `amr: string[]` parameter and emit it as a top-level JWT
  claim. When the array is empty, **omit** the claim entirely (rather than
  emitting `[]`) so resource servers treat "absent" uniformly.
- **Email-OTP first factor:** a login that used email-OTP as first factor and then
  passed TOTP still resolves to the `mfa` set — the second factor governs `amr`.
- **Plan note:** verify whether BetterAuth exposes a cleaner per-session `amr`/
  `aal` field; if so, source from it and upgrade. The boolean derivation is
  correct regardless and is the baseline.

## Section 4 — `direct/login` enforcement (non-interactive)

`POST /api/token/direct/login` is password → JWT with no browser or session, so it
cannot run an interactive TOTP challenge or forced enrollment. Enforcement runs
**after** password verification (preserving the existing timing posture that does
not distinguish invalid-password from inactive-user):

- Add an optional **`totpCode`** to the direct-login DTO (6-digit string).
- When `isTwoFactorRequired(app)` **or** the user is `twoFactorEnabled`:
  - **No code supplied** → `403 two_factor_required`.
  - **Code supplied** → verify server-side, session-less, against the user's
    stored TOTP secret. Invalid → `403 two_factor_required` (kept opaque and
    timing-comparable alongside the existing `INVALID_CREDENTIALS` handling).
    Valid → issue the JWT with `amr = ["pwd", "otp", "mfa"]`.
  - **Non-enrolled user on a required app** → `403 two_factor_required`. They
    cannot self-enroll non-interactively; they must enroll once via the
    interactive flow. Documented as intended.
- Password-only success on a non-required app for a non-2FA user → JWT with
  `amr = ["pwd"]`, unchanged from today.
- The `direct/login` request `totpCode` field is never logged.

**Session-less verification mechanism (confirmed).** A helper
`verifyUserTotp(betterAuthUserId, code)` reads the user's `TwoFactor` row,
decrypts the secret with better-auth's own `symmetricDecrypt({ key:
BETTER_AUTH_SECRET, data: tf.secret })`, and checks it with
`createOTP(secret, { period: 30, digits: 6 }).verify(code)` — exactly what
better-auth's own `/two-factor/verify-totp` endpoint does internally. A live test
(enroll → compute a code with `otplib` from the enrollment secret → assert the
helper returns true; wrong code → false) is the guardrail that the decrypt key
matches; if better-auth wraps the secret differently the test fails loudly and
the key derivation is adjusted.

## Section 5 — Admin UI & platform enforcement

The platform app is immutable through the app UI — `AppsService.updateApp` (and
`deleteApp`) already throw `ForbiddenException('Platform app cannot be modified')`
for `isPlatform` apps. So enforcement splits cleanly by audience:

- **Non-platform apps (UI):** a `requireTwoFactor` checkbox on the existing app
  create/edit drawers (beside 2a's `twoFactorTrustDays`), wired through the
  create/update DTOs and `AppsService`. Turning this on force-enrolls **that
  app's own end users** — it does not affect admin-console operators, so no
  operator-lockout guardrail is needed here.
- **Platform app (out-of-band):** enforced by the `PLATFORM_REQUIRE_2FA` env flag,
  read by `isTwoFactorRequired(app)` for `isPlatform` apps. Enabling it
  force-enrolls all operators on next interactive sign-in. It is a deliberate
  operational action (env/deploy config), documented in the README/`.env.example`
  with the recommendation that the enabling operator enroll their own 2FA first.
- **Recovery valve:** 2a's admin-assisted "Reset 2FA" remains the lockout escape
  hatch for any operator who gets stuck.

The existing platform-immutability guard in `AppsService` is unchanged — a
`requireTwoFactor` value in an update DTO for the platform app is still rejected
wholesale by that guard, so no new server-side guardrail is required.

## Section 6 — Testing

**Unit (auth-server, Jest):**
- **`isTwoFactorRequired(app)`** — non-platform honors `requireTwoFactor`; platform
  honors the `PLATFORM_REQUIRE_2FA` env flag; env-off platform → not required.
- **Authorize gate** — required + non-enrolled → redirect to
  `/account/security?enroll=1&next=…`; required + enrolled → code issued;
  not-required → unchanged.
- **`amr` resolution** — enabled → `["pwd","otp","mfa"]`, disabled → `["pwd"]`;
  `issueJwt` emits the claim when present and **omits** it when empty.
- **`verifyUserTotp`** — a live enroll → `otplib` code → helper returns true;
  wrong code → false; user without a `TwoFactor` row → false.
- **`direct/login` matrix** — no code + (required or enabled) → `403`; valid code
  → JWT with `mfa`; invalid code → `403`; non-required password-only for a
  non-2FA user → JWT with `["pwd"]`.

**e2e — hermetic authorize-simulation** (extends 2a's
`apps/admin-e2e/lib/oauth-fixtures.ts`):
- Required app + **non-enrolled** user → forced enrollment → back to authorize →
  code issued; decode the exchanged JWT and assert `amr` contains `mfa`.
- Required app + **enrolled** user → straight to the TOTP challenge → code; JWT
  `amr` contains `mfa`.

**e2e — focused live FastAPI RS slice** (extends 2a's RS round-trip):
- RS round-trip into a `requireTwoFactor` app: browser → admin `/login` → password
  → TOTP → `/auth/callback` → assert the RS receives a JWT whose `amr` includes
  `mfa`.

## Key implementation risks (resolve in planning)

1. **Session-less TOTP verification for `direct/login`** (Section 4) — mechanism
   confirmed (`symmetricDecrypt` + `createOTP().verify`); the live enroll→verify
   test guards the decrypt-key assumption.
2. **Auth-code `amr` propagation** (Section 3) — the `SaOauthCode` row must carry
   the `amr` array from authorize → token; adds an `amr String` column (JSON) to
   `SaOauthCode`, defaulting to `["pwd"]` for codes minted before migration.

## File Impact (indicative)

- `packages/db/schema.prisma` + migration — `SaApp.requireTwoFactor`,
  `SaOauthCode.amr`.
- `apps/auth-server/src/auth/two-factor-required.ts` (+ spec) —
  `isTwoFactorRequired(app)` resolver + `PLATFORM_REQUIRE_2FA` env read.
- `apps/auth-server/src/auth/verify-user-totp.ts` (+ spec) — session-less TOTP
  verify helper.
- `apps/auth-server/src/token/oauth.service.ts` — `generateCode`/`exchangeCode`
  carry `amr`.
- `apps/auth-server/src/token/token.controller.ts` — authorize forced-enrollment
  gate; `direct/login` `totpCode` verification + `403 two_factor_required`.
- `apps/auth-server/src/token/token.service.ts` — `issueJwt` `amr` param + claim.
- `apps/auth-server/src/token/dto/direct-login.dto.ts` — optional `totpCode`.
- `apps/auth-server/src/apps/dto/{create,update}-app.dto.ts` + `apps.service.ts`
  + `apps.controller` response shape — `requireTwoFactor` field (non-platform).
- `apps/admin/components/app-{create,edit}-drawer.tsx`, `apps/admin/lib/types.ts`,
  `apps/admin/messages/{en,fr}.json` — `requireTwoFactor` checkbox + copy.
- `apps/admin/app/account/security/{page.tsx,SecurityClient.tsx}` — honor
  `enroll=1` forced mode (hide skip, redirect to `next` on success).
- `.env.example` + README — `PLATFORM_REQUIRE_2FA`.
- `apps/admin-e2e/` — authorize-sim enforcement specs + live-RS `amr` slice.
