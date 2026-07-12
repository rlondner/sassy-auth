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
  `totpCode`/`backupCode`, verifies it, and issues a `mfa` JWT; otherwise it
  returns `403 two_factor_required`.
- A safe admin surface: a toggle on the app form, a soft warning, and a
  self-first guardrail on the platform app.

## Non-Goals

- The 2FA **mechanism**, enrollment UI, sign-in challenge, optional proposal,
  trust interval, and admin reset — all delivered in **2a**.
- A system-wide "require 2FA for everyone" switch. Enforcement is strictly
  per-app; the default is not-required.
- Non-interactive **self-enrollment**. A user with no 2FA who hits `direct/login`
  for a required app is rejected; they must enroll once via the interactive flow.
- Step-up / per-request AAL escalation, or distinguishing "fresh TOTP this login"
  from "trusted device" in `amr` (see Security Contract — both resolve to `mfa`).

## Security Contract

- **No un-enrolled access to a required app:** the authorize gate and the
  `direct/login` gate both fail closed. A non-enrolled user cannot obtain an auth
  code or a JWT for a `requireTwoFactor` app.
- **Truthful `amr`:** `amr` includes `mfa`/`otp` **iff** the user is
  `twoFactorEnabled` at authenticate time. This is truthful because 2a guarantees
  no `twoFactorEnabled` user obtains a session (or passes `direct/login`) without
  the second factor — including trusted-device sessions, which are 2FA-bound by
  construction.
- **Never logged:** TOTP secrets, `otpauth` URIs, backup codes, and entered codes
  (unchanged from 2a's bearer-credential posture). `direct/login` code fields are
  never logged.
- **No self-lockout by accident:** enabling `requireTwoFactor` on the platform
  admin app requires the acting admin to already have 2FA; 2a's admin-assisted
  "Reset 2FA" remains the recovery valve.
- The existing `status === 'active'` gates at authorize and token are unaffected
  and continue to run.

---

## Section 1 — Data model & config

- **`SaApp.requireTwoFactor Boolean @default(false)`** added to
  `packages/db/schema.prisma`, plus a Prisma migration.
- No new `User`/`SaUser`/session columns. Enforcement reads the existing global
  `User.twoFactorEnabled` (2a). No system-wide default is needed — the field
  default (`false`) *is* the "not required" default, so no resolver analogous to
  2a's `resolveTrustDays` is required.

## Section 2 — Forced-enrollment gate at authorize

In the `GET .../oauth/authorize` handler, **after** the existing session and
`status === 'active'` checks and **before** issuing the code, add one gate:

```
if (app.requireTwoFactor && !user.twoFactorEnabled) {
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

- Add optional **`totpCode`** and **`backupCode`** to the direct-login DTO.
- When the resolved app has `requireTwoFactor` **or** the user is
  `twoFactorEnabled`:
  - **No code supplied** → `403 two_factor_required`.
  - **Code supplied** → verify server-side against the user's stored TOTP secret /
    backup codes (no session). Invalid → `403 two_factor_required` (timing-safe
    alongside the existing `INVALID_CREDENTIALS` handling). Valid → issue the JWT
    with `amr = ["pwd", "otp", "mfa"]`.
  - **Non-enrolled user on a `requireTwoFactor` app** → `403 two_factor_required`.
    They cannot self-enroll non-interactively; they must enroll once via the
    interactive flow. Documented as intended.
- Password-only success on a non-required app for a non-2FA user → JWT with
  `amr = ["pwd"]`, unchanged from today.
- The `direct/login` request `totpCode`/`backupCode` fields are never logged.

**Plan risk (spike):** the session-less verification mechanism. Options to
resolve in planning: a BetterAuth server API that verifies TOTP/backup without a
session, or a direct check against the stored (plugin-managed) secret using the
same TOTP parameters. The requirement stands regardless of mechanism.

## Section 5 — Admin UI & lockout safety

- **Toggle:** a `requireTwoFactor` checkbox on the existing app create/edit form
  (beside 2a's `twoFactorTrustDays`).
- **Soft warning:** when enabling it on the **platform admin app**, show an inline
  warning: "This forces 2FA for all operators on next sign-in."
- **Self-first guardrail:** enabling `requireTwoFactor` on the **platform app** is
  blocked unless the acting admin already has `twoFactorEnabled`. Enforced
  **server-side** in the app-update path (not just the UI), returning a clear
  validation error; the checkbox warning mirrors it client-side.
- **Recovery valve:** 2a's admin-assisted "Reset 2FA" remains the lockout escape
  hatch.

## Section 6 — Testing

**Unit (auth-server, Jest):**
- **Authorize gate** — required + non-enrolled → redirect to
  `/account/security?enroll=1&next=…`; required + enrolled → code issued;
  not-required → unchanged.
- **`amr` resolution** — enabled → `["pwd","otp","mfa"]`, disabled → `["pwd"]`;
  `issueJwt` emits the claim when present and **omits** it when empty.
- **`direct/login` matrix** — no code + (required or enabled) → `403`; valid code
  → JWT with `mfa`; invalid code → `403`; non-required password-only for a
  non-2FA user → JWT with `["pwd"]`.
- **Platform-app self-first guardrail** — acting admin without 2FA is rejected
  when enabling `requireTwoFactor` on the platform app; with 2FA it succeeds.

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

1. **Session-less TOTP/backup verification for `direct/login`** (Section 4) —
   confirm the BetterAuth API or the direct-secret-check approach.
2. **Auth-code `amr` propagation** (Section 3) — confirm the authorization-code
   payload/format can carry the `amr` array through to token exchange.
3. **Enroll-page forced-enrollment mode** (Section 2) — confirm the 2a
   `/account/security` page can suppress the skip affordance and honor `next` on
   completion when entered with `enroll=1`.

## File Impact (indicative)

- `packages/db/schema.prisma` + migration — `SaApp.requireTwoFactor`.
- `apps/auth-server/src/token/token.controller.ts` — authorize forced-enrollment
  gate; `direct/login` code fields + verification + `403 two_factor_required`.
- `apps/auth-server/src/token/token.service.ts` — `issueJwt` `amr` param + claim.
- authorization-code issuance/exchange — carry `amr` on the code.
- `apps/auth-server/src/token/dto/direct-login.dto.ts` — optional `totpCode` /
  `backupCode`.
- `apps/auth-server/src/apps/` (app update path) — platform-app self-first
  guardrail (server-side).
- `apps/admin/app/(admin)/apps/` — `requireTwoFactor` checkbox + platform-app
  warning.
- `apps/admin/app/account/security/` — honor `enroll=1` forced-enrollment mode
  (hide skip, redirect to `next`).
- `apps/admin-e2e/` — authorize-sim enforcement specs + live-RS `amr` slice.
