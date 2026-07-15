# Two-Factor Authentication — Core + Optional Self-Service (2a) — Design

**Status:** Approved (brainstorming)
**Date:** 2026-07-12
**Author:** contact@milissai.com (with Claude)

## Context

This is **sub-project 2a** of a two-part 2FA program. The program was decomposed
during brainstorming:

- **2a (this spec):** the 2FA mechanism (TOTP + backup codes via BetterAuth's
  `twoFactor` plugin), self-service enrollment/management, the sign-in
  challenge, a login-time optional proposal, a configurable trust/re-prompt
  interval, and admin-assisted reset. Delivers the **optional** path end to end.
- **2b (separate spec, later):** per-app **enforcement** — a `SaApp` policy that
  *requires* 2FA, forced enrollment + challenge in the OAuth authorize/token/
  direct-login paths, and how the JWT signals 2FA to the resource server.

### Architecture that shapes the design

End users reach the auth-server through the **OAuth authorize flow**:
`GET /api/token/oauth/authorize` validates the `SaApp` (by `client_id`),
checks `SaUser.status === 'active'`, reads the BetterAuth session, and issues an
auth code the resource server exchanges at `/api/token/oauth/token`. When there
is no session, authorize bounces the browser to the admin app's `/login` with
`next` = the authorize URL. So **`/login` is the auth-server's hosted login UI
for end users**, and the target app's `client_id` is available at login time via
`next`. There is also a non-interactive `POST /api/token/direct/login`
(password → JWT, no session) — its 2FA handling is a **2b** concern.

The `twoFactor` plugin is already available (bundled with BetterAuth 1.6.11) but
not yet configured.

## Goals

- TOTP (authenticator app) + backup codes, via BetterAuth's `twoFactor` plugin.
- Self-service enrollment/management reachable by **any authenticated user**
  (end users and operators), not gated by admin permissions.
- A sign-in challenge that applies to **every interactive method** (password and
  email-OTP) once 2FA is enabled — no bypass.
- A one-time-per-interval, skippable login proposal to enable 2FA.
- A configurable "trust this browser" / re-prompt interval: system-wide default
  with an optional per-`SaApp` override.
- Admin-assisted 2FA reset for lockout recovery.
- Real confidence: hermetic authorize-simulation e2e for the flow matrix, plus a
  focused live FastAPI-RS round-trip.

## Non-Goals

- Per-app **enforcement** of 2FA, forced enrollment at authorize, and JWT `amr`
  signalling (all 2b).
- SMS/email-as-second-factor (email-OTP is a first factor here, not a 2nd).
- `POST /token/direct/login` 2FA handling (2b).
- Running the **full** 2FA flow matrix through the live FastAPI RS (only a
  focused 1–2 test slice; the matrix runs on the hermetic simulation).

## Security Contract

- **No-bypass:** no interactive sign-in by a `twoFactorEnabled` user completes
  without the TOTP or backup-code second factor — including "sign in with a
  code" (email-OTP).
- **Never logged / never re-fetchable:** TOTP secrets, `otpauth` URIs, backup
  codes, and entered codes (same bearer-credential posture as bug-0163). Backup
  codes and the secret are shown only in the immediate response to the user's
  own action.
- **Re-auth for management:** enable, disable, and regenerate-backup-codes all
  require the user's password.
- **Rate-limited** verify endpoints (BetterAuth per-path `rateLimit`) plus the
  plugin's own attempt limits and the bounded temp-cookie lifetime.
- The existing `session.create.before` active-status gate is unaffected — the
  TOTP challenge runs before session creation, so the gate evaluates the final,
  2FA-verified session normally.

---

## Section 1 — Data model & plugin config

Configure `twoFactor` in `auth.config.ts` with `issuer: 'Sassy Auth'`, default
TOTP params (SHA1 / 6 digits / 30s period — required for Google Authenticator,
Authy, 1Password compatibility), and 10 backup codes.

Schema additions in `packages/db/schema.prisma` (+ a Prisma migration):

- **`TwoFactor` model** — `id`, `userId` (→ `User`, unique/one-per-user),
  `secret` (encrypted TOTP secret), `backupCodes` (hashed set). Managed by the
  plugin.
- **`twoFactorEnabled Boolean @default(false)`** on the `User` model — flipped on
  successful enrollment; read at sign-in.
- **`twoFactorTrustDays Int?`** on the `SaApp` model — per-app override for the
  trust/re-prompt interval (Section 4b); null → system default.
- **`twoFactorPromptedAt DateTime?`** on the `SaUser` model — last time the
  optional-setup interstitial was shown/skipped (Section 4).

The secret and backup codes are hashed/encrypted at rest by the plugin; we never
store or log them ourselves.

## Section 2 — Enrollment & management (`/account/security`)

New route `app/account/security/` in the admin app, **session-required but not
permission-gated** — it sits outside the `(admin)` permission-checked segment,
so the middleware session check is the only guard, making it reachable by any
authenticated user. Three operations, each a server-action proxy to BetterAuth
forwarding the session cookie:

- **Enable** → user enters password → POST `/two-factor/enable` returns an
  `otpauth://` URI + the 10 backup codes. Render the URI as a **QR code**
  (client lib, e.g. `qrcode.react`) with the secret shown as a manual-entry
  fallback; display the backup codes **once** with copy + download. The user
  enters a current TOTP code → POST `/two-factor/verify-totp` confirms and flips
  `twoFactorEnabled` on. Because `skipVerificationOnEnable` stays `false`, 2FA
  is not active until this confirming code succeeds (no lockout from a mis-
  scanned QR).
- **Disable** → password required → POST `/two-factor/disable`.
- **Regenerate backup codes** → password required → returns a fresh set
  (invalidates the old), shown once.

Secrets and backup codes appear only in the direct response to the user's own
action — never logged, never re-fetchable.

## Section 3 — Sign-in challenge flow

Today `signIn` posts to `/sign-in/email`, parses the session cookie from
`Set-Cookie`, sets it, and redirects. With 2FA, a `twoFactorEnabled` user's
first-factor response carries `{ twoFactorRedirect: true }` and a **temporary
2FA cookie** (not a session). The flow becomes three steps:

1. **First factor** (`signIn` password, or `verifyOtp` email-code) detects
   `twoFactorRedirect` → forwards the temp 2FA cookie to the browser and returns
   `{ twoFactor: true }` so the form advances to a TOTP step (no redirect yet).
2. **Second factor** — new server actions `verifyTotp(code)` /
   `verifyBackupCode(code)` POST to `/two-factor/verify-totp` (or
   `/verify-backup-code`) carrying the temp cookie; on success BetterAuth returns
   the real session cookie, which we set (reusing `forwardSessionCookie`), then
   redirect to `next ?? /users`.
3. Wrong code → error, stay on the step (plugin attempt limits + bounded temp-
   cookie lifetime apply).

`forwardSessionCookie` is paired with a `forwardNamedCookie(res, name)` helper so
the temp 2FA cookie can be forwarded by name.

**No-bypass (the key risk):** password sign-in triggers `twoFactorRedirect`
natively. For **email-OTP**, if BetterAuth's `sign-in/email-otp` path does not
emit `twoFactorRedirect` for a `twoFactorEnabled` user, email-OTP would bypass
2FA. The plan MUST resolve this via a short spike: if not native, enforce it —
reject `email-otp` session creation for `twoFactorEnabled` users and route them
through the TOTP step (candidate: extend the `session.create.before` gate, or a
verify-side check). Requirement stands regardless of mechanism.

## Section 4 — Login-time optional proposal

After a successful **password** login where the user has **no** 2FA, insert a
skippable interstitial before the onward redirect: "Secure your account — Set up
two-factor authentication / Skip for now." "Set up" enters the
`/account/security` enable flow carrying `next`; "Skip" continues to the
destination (OAuth `next` redirect, or admin home).

Shown at most once per interval (Section 4b), tracked by `twoFactorPromptedAt`
on `SaUser` (set when shown/skipped). Users with 2FA already enabled, or prompted
within the interval, pass straight through. Fires only on the interactive
password path — not on token refresh, and email-OTP users have already made a
security choice. It sits in front of the OAuth `next` redirect, so an end user
authenticating into a resource server sees it at most once per interval, then
proceeds normally.

## Section 4b — Configurable trust / re-prompt interval

**One interval, two uses, resolved per app:**

- **Trust-device for the challenge:** after passing TOTP, the browser is trusted
  for the interval so the 2FA step is skipped on later sign-ins from that browser
  within the window (BetterAuth trust-device: a signed browser cookie).
- **Interstitial re-prompt:** the Section 4 nudge reappears after the interval
  (`twoFactorPromptedAt < now - interval`).

**Config resolution:** system-wide default `TWO_FACTOR_TRUST_DAYS` (default
**14**) with an optional per-app override `SaApp.twoFactorTrustDays`; effective
value = `app.twoFactorTrustDays ?? systemDefault`, computed by a pure resolver
`resolveTrustDays(app)`. At login the target app is known from the `next`/
`client_id`, so the interval is resolved there and applied to both the trust-
cookie lifetime and the re-prompt threshold. A field for `twoFactorTrustDays` is
added to the existing **app create/edit** form.

**Implementation nuance:** BetterAuth's `trustDeviceMaxAge` is a *static* plugin
option, not per-request. To honor a per-app value, we set/extend the trust-device
cookie's `Max-Age` ourselves to the resolved interval when completing verify (the
plugin still validates the cookie; we control its lifetime). The plan confirms
this against the plugin's cookie handling and, if needed, manages that cookie in
the verify server-action.

## Section 5 — Admin-assisted 2FA reset

Add a **"Reset 2FA"** action to the existing user-management UI (row action /
user drawer), gated by the same platform user-management permission, mirroring the
reset-password / deactivate actions. It calls a new auth-server endpoint that
disables the target user's 2FA (deletes the `TwoFactor` row, clears
`twoFactorEnabled`) and is **audit-logged**:
`{ context, actorId, targetUserId, action: '2fa_reset' }` — never a secret. After
reset, the user has no 2FA; on next login they pass the first factor and are
re-offered enrollment via the interstitial. Reuses the existing target-exists /
in-scope checks.

## Section 6 — Observability & security

Structured Winston events mirroring
`logger.getWinstonLogger().info('...', { context, ... })`. **Never logged:** TOTP
secrets, `otpauth` URIs, backup codes, entered codes.

| Event | Level | Where | Fields |
|---|---|---|---|
| 2FA enabled | `info` | enable-confirm | `userId` |
| 2FA disabled | `info` | disable | `userId` |
| 2FA challenge passed | `info` | verify | `userId`, `method: 'totp' \| 'backup'`, `trustedDevice: bool` |
| 2FA challenge failed | `warn` | verify | `userId`, `method` |
| Backup codes regenerated | `info` | regenerate | `userId` |
| 2FA reset by admin | `warn` | admin reset | `actorId`, `targetUserId` |
| Backup code consumed (low remaining) | `info` | verify-backup | `userId`, `remaining` |

**Security posture:** verify endpoints rate-limited via BetterAuth per-path
`rateLimit` (like the email-OTP send cap); enable/disable/regenerate require
password re-auth; the trust-device cookie is httpOnly + secure (prod) + signed by
BetterAuth.

## Section 7 — Testing

**Unit (auth-server, Jest):**
- **`resolveTrustDays(app)`** — override-set, override-null→default, and a
  zero/invalid value falling back to default.
- **Admin reset service** — disables 2FA (deletes `TwoFactor` row + clears
  `twoFactorEnabled`), permission-checked, unknown target throws, emits the audit
  log; a spec asserting no secret is ever logged.
- **`twoFactor` plugin config** — issuer + backup-code count + rate-limit present
  (light assertion).

**e2e — hermetic authorize-simulation (the flow matrix).** Uses
`apps/admin-e2e/lib/oauth-fixtures.ts` (`buildAuthorizeUrl`, `newPkce`,
`fetchPlatformApp` / seeded `SaApp` for `client_id`), the seeded `s@sa.io`, and
live TOTP computed in-test from the enrollment secret (e.g. `otpauth`/`otplib`):
- **Enroll:** `/account/security` → enable (password) → read the `otpauth`
  secret → compute a live TOTP → confirm → assert enabled.
- **Challenge through an RS (simulated):** `buildAuthorizeUrl({ client_id })` →
  bounced to `/login` → password → **TOTP step** → assert redirect back to the
  app's `redirect_uri?code=…`. Plus a wrong-code error case and a **backup-code**
  path.
- **No-bypass:** with 2FA enabled, "sign in with a code" (email-OTP) also reaches
  the TOTP step (proves email-OTP can't skip 2FA).
- **Trust device:** after a trusted challenge, a second login in the same browser
  context skips the TOTP step; a fresh context still challenges.
- **Interstitial:** a no-2FA user sees the skippable prompt after password login;
  "Skip" continues; it does not reappear within the interval.
- **Per-app interval:** an app with a specific `twoFactorTrustDays` yields a
  trust-cookie `Max-Age` / re-prompt reflecting the app value vs. the system
  default (reachable because the flow goes through authorize with a real
  `client_id`).
- **Admin reset:** admin resets a user's 2FA → that user logs in with no TOTP
  step.

**e2e — focused live FastAPI RS slice (1–2 tests).** Runs the real
`apps/resource-server-fastapi` as a third Playwright `webServer`
(`uvicorn app.main:app --port 8010`), proving the genuine round-trip:
- **RS round-trip with 2FA:** browser hits `http://localhost:8010/login` → admin
  `/login` → password → **TOTP** → back to `/auth/callback` → assert the RS's
  `authorized.html` renders (code→JWT exchange works after a 2FA challenge).
- optionally **RS round-trip without 2FA** as the baseline.

Plumbing (its own plan task): add a CI Python step (`setup-python` + `uv`/pip
install of the RS), add the uvicorn `webServer` (local + CI), and wire a
deterministic `client_id`: a test-mode seed provisions the RS app with
`url = http://localhost:8010` and its `publicId` is surfaced to the uvicorn env
(`SASSY_CLIENT_ID`) — e.g. a global-setup that seeds first, writes the publicId to
a file the Playwright config reads for the RS webServer env; registered
`redirect_uri` = `http://localhost:8010/auth/callback`.

## Key implementation risks (resolve in planning)

1. **Email-OTP no-bypass** (Section 3) — verify whether BetterAuth emits
   `twoFactorRedirect` on `sign-in/email-otp`; if not, add enforcement.
2. **Per-app trust-cookie lifetime** (Section 4b) — `trustDeviceMaxAge` is static;
   confirm we can set the trust cookie's `Max-Age` per resolved interval.
3. **Live-RS `client_id` wiring** (Section 7) — deterministic seed + publicId
   surfaced to uvicorn before it boots.

## File Impact (indicative)

- `packages/db/schema.prisma` + migration — `TwoFactor`, `User.twoFactorEnabled`,
  `SaApp.twoFactorTrustDays`, `SaUser.twoFactorPromptedAt`.
- `apps/auth-server/src/auth/auth.config.ts` — `twoFactor` plugin + rate-limit;
  possibly email-OTP no-bypass enforcement.
- `apps/auth-server/src/auth/resolve-trust-days.ts` (+ spec) — interval resolver.
- `apps/auth-server/src/users/` — admin "reset 2FA" endpoint/service (+ audit log).
- `apps/admin/app/account/security/` — enrollment/management page + actions.
- `apps/admin/app/login/` — challenge step + interstitial + actions
  (`verifyTotp`, `verifyBackupCode`, `forwardNamedCookie`).
- `apps/admin/app/(admin)/apps/` — `twoFactorTrustDays` field on app edit form.
- `apps/admin/components/` — user-management "Reset 2FA" action.
- `apps/admin-e2e/` — authorize-sim flow specs + focused live-RS specs + fixtures;
  `playwright.config.ts` (uvicorn webServer) + CI `e2e.yml` (Python step + seed).
