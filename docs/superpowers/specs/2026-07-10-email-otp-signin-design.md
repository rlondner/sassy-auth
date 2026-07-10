# Email-OTP Passwordless Sign-In — Design

**Status:** Approved (brainstorming)
**Date:** 2026-07-10
**Author:** contact@milissai.com (with Claude)

## Context

This is **sub-project 1** of a two-part passwordless/2FA program (2FA is a
deferred sub-project 2 with its own spec). It adds **email one-time-code
(OTP) sign-in** to the admin console as a supplement to the existing
email+password login, routed through the merged `EmailService`.

The `emailOTP` BetterAuth plugin is already registered in
`apps/auth-server/src/auth/auth.config.ts` but only wired to a dev-only
`console.log` sender and running on library defaults. This project makes it a
real, secured sign-in method.

### Key finding that shapes the design

The active-status gate (`status !== 'active'` → reject) currently lives **only
on JWT issuance** (`token.controller.ts`). **BetterAuth session sign-in has no
status check**, and the admin console gates on permissions, not status.
Consequences today:

- An inactive user can technically obtain an admin **session** (password
  sign-in creates a session regardless of status).
- The deactivate kill-switch deletes *existing* sessions but does not block
  re-login.
- For OTP this is worse: OTP needs no password, so without a gate a **pending**
  user (invited, never accepted) could OTP-in and skip invitation acceptance,
  and a **deactivated** user could OTP back in.

Therefore this project adds a **shared session-creation status gate** that
secures OTP *and* uniformly fixes password login and completes the deactivate
kill-switch.

Confirmed non-issue: `InvitationsService.acceptInvitation` sets
`status: 'active'` and returns `void` — it does **not** create a session (the
admin `/accept-invite` page then routes the user to `/login`). So the gate
never sees a `pending` user at session creation during acceptance; no special
sequencing is required.

## Goals

- Email-OTP sign-in for **existing, active** admin users only.
- OTP delivery through `EmailService` (Console/SMTP/Resend), preserving the
  dev/CI console fallback.
- A shared session-creation status gate that blocks non-`active` users across
  **all** sign-in methods.
- Enumeration-neutral request responses.
- Structured observability for every user-generated action, without ever
  logging the OTP value.

## Non-Goals

- Magic-link sign-in (its sender stays as-is, unused — YAGNI).
- 2FA / TOTP / backup codes (sub-project 2).
- OTP for email-verification or password-reset flows (this OTP is
  `type: 'sign-in'` only).
- Any metrics/telemetry stack beyond the existing structured logs + Sentry.
- An audit-log DB table (none exists; not introduced here).

## Security Contract (the four settings + the gate)

1. **`disableSignUp: true`** — existing-users-only. Without it,
   `sign-in/email-otp` would auto-create a BetterAuth user for any unknown
   email. Unknown emails get a benign failure.
2. **`otpLength: 6`**, **`expiresIn: 300`** (5 min) — code shape/lifetime,
   matched by the email copy.
3. **`allowedAttempts: 3`** — OTP invalidated after 3 wrong entries; user
   requests a fresh one. Bounds verify-side brute force.
4. **Send rate limit** — `/api/auth/email-otp/send-verification-otp` capped at
   ~3–5 requests/min per IP (see Section 5).
5. **Session-creation gate** — `databaseHooks.session.create.before` rejects
   any session whose `SaUser.status !== 'active'` (or whose user is unknown —
   fail closed).

**bug-0163 invariant:** the OTP value is a bearer credential and is NEVER
placed in any log line, structured field, or Sentry event. Only the Console
email transport ever renders it, and only when no SMTP/Resend transport is
configured.

---

## Section 1 — Flow & the status gate

**User flow:** `/login` gains a "Sign in with a code instead" link → a small
two-step form: (1) enter email → "Send code"; (2) enter the 6-digit code →
"Verify" → signed in (session cookie set, redirect to `/`). Password login is
untouched and remains the default.

**The gate:** a BetterAuth `databaseHooks.session.create.before` hook. Before
*any* session is created (password, OTP, social — all methods), look up the
`SaUser` by `betterAuthUserId`:

- `status === 'active'` → allow.
- `status` is `pending` or `inactive` → reject (block session creation).
- No matching `SaUser` → reject (fail closed).

This is the single choke point that makes OTP safe and uniformly:

- blocks **pending** users from OTP-ing past invitation acceptance,
- blocks **inactive** users from password *or* OTP sign-in (deactivate
  kill-switch becomes complete; the login form's existing "account
  deactivated" error becomes reachable).

The hook runs outside Nest's request context (like the existing bug-0186
`session.create.after` hook). It emits its security event through the
standalone winston logger instance, not the DI `LoggerService` (Section 7).

## Section 2 — OTP email via `EmailService`

Add `signInCodeEmail({ otp, minutes })` in
`apps/auth-server/src/email/templates/` returning `{ subject, html, text }`
(mirrors `invitation.template.ts` / `password-reset.template.ts`).

Rewire `emailOTP.sendVerificationOTP` in `auth.config.ts` from its dev-only
`console.log` to:

```ts
await getEmailer().send({ to: email, ...signInCodeEmail({ otp, minutes: 5 }) })
```

`EmailService`'s default Console transport logs unsent mail, so the dev/CI
console fallback is preserved for free; prod routes through SMTP/Resend. This
deletes the bespoke `console.log` and its bug-0163 exposure (Console transport
is the only thing that ever renders the code, and only when email is
unconfigured). Only `type: 'sign-in'` uses this sender.

## Section 3 — Admin OTP login UI + server actions

Two new server actions in `apps/admin/app/login/actions.ts` (alongside
`signIn`), reusing `getForwardedOrigin()` and the existing `Set-Cookie` parse
for `better-auth.session_token`:

- **`requestOtp(formData)`** → POST `{ email, type: 'sign-in' }` to
  `${AUTH_SERVER}/api/auth/email-otp/send-verification-otp`. Returns
  **enumeration-neutral** `{ sent: true }` regardless of whether the account
  exists/is active; never reveals gate/no-signup rejection. Transport failure
  → `{ error: 'serverUnavailable' }` (mirrors `signIn`).
- **`verifyOtp(formData)`** → POST `{ email, otp }` to
  `/api/auth/sign-in/email-otp`; parse `Set-Cookie`, set session cookie
  (identical to `signIn`). Map `401` → `invalidCode`, `403` → `inactive`
  (reuses existing key; the gate rejects at session creation).

**UI:** `/login` gets a "Sign in with a code instead" link to a client
component `login-otp-form.tsx` (`useActionState`): step 1 email + "Send code";
step 2 6-digit code input + "Verify", with "Resend" / "Use a different email"
affordances. Verify success → redirect to `/`. New i18n keys in **both**
`messages/en.json` and `messages/fr.json`.

## Section 4 — BetterAuth OTP config

Configure `emailOTP` explicitly in `auth.config.ts`:

```ts
emailOTP({
  otpLength: 6,
  expiresIn: 300,
  allowedAttempts: 3,
  disableSignUp: true,
  sendVerificationOTP: async ({ email, otp, type }) => { /* Section 2 */ },
})
```

(See Security Contract for the rationale of each value.)

## Section 5 — Rate limiting

The auth-server already has app-wide `ThrottlerModule`. The **send** endpoint
(`/api/auth/email-otp/send-verification-otp`) is the abuse surface (inbox spam,
enumeration-timing probes). During implementation, verify BetterAuth's
`/api/auth/*` catch-all passes through the Nest throttler; if it bypasses it,
enable BetterAuth's own per-path `rateLimit` config to cap the send endpoint at
~3–5 requests/min per IP. Verify-side abuse is already bounded by
`allowedAttempts: 3` + `expiresIn`.

## Section 6 — Testing

**Unit (auth-server, Jest):**

- **Gate hook** (`session.create.before`): `active` → allows; `pending` /
  `inactive` → rejects; unknown `betterAuthUserId` → rejects (fail closed).
- **OTP email routing:** `sendVerificationOTP` calls `getEmailer().send` with
  `{ to, subject: /code|sign.?in/i }` (same mock pattern as invitation/reset
  email tests).
- **Template** `signInCodeEmail`: returns `{ subject, html, text }` containing
  the code + expiry minutes.

**e2e (Playwright):** the OTP is emailed, not surfaced in any UI, so a
full-happy-path test must read the code. Plan:

- Add an **env-guarded test-only retrieval hook** (mounted only when
  `NODE_ENV === 'test'` / CI, never in prod): the Console transport records the
  last message per recipient in an in-memory map, exposed via a test-only
  endpoint (e.g. `GET /test/last-otp?email=`). e2e: request code → read via
  endpoint → enter → assert signed in.
- Non-happy e2e needing no code: **wrong code → `invalidCode`**; **deactivated
  user blocked** — request a code as an `inactive` user; even a correct code
  fails with the inactive message (proves the gate).

## Section 7 — Observability

Structured Winston events matching the existing
`logger.getWinstonLogger().info('User updated', { context, ... })` shape. The
OTP value is never logged (bug-0163).

| Event | Level | Where | Fields (never the code) |
|---|---|---|---|
| Sign-in code requested | `info` | `sendVerificationOTP` | `email`, `outcome: 'sent' \| 'skipped_unknown' \| 'skipped_inactive'` |
| Sign-in code delivery failed | Sentry | `EmailService.send` | already captured — no new code |
| Sign-in via code succeeded | `info` | post-verify | `betterAuthUserId`, `email` |
| Sign-in code rejected | `warn` | verify path | `email`, `reason: 'invalid' \| 'expired' \| 'too_many_attempts'` |
| Session creation blocked | `warn` | `session.create.before` gate | `betterAuthUserId`, `status` |

The HTTP response stays enumeration-neutral while the server log is fully
informative (`skipped_unknown` vs `skipped_inactive` vs `sent`). The gate
`warn` fires for all sign-in methods, so password-login lockout attempts also
become visible. The gate event is emitted via the standalone winston logger
(the hook runs outside Nest DI). Email send failures are already routed to
Sentry by `EmailService`, so no new Sentry code is required.

## File Impact Summary

**auth-server:**
- Modify `src/auth/auth.config.ts` — `emailOTP` config + `sendVerificationOTP`
  rewire; `databaseHooks.session.create.before` gate.
- Create `src/email/templates/sign-in-code.template.ts`.
- Test-only OTP capture (Console transport map + guarded endpoint).

**admin:**
- Modify `app/login/actions.ts` — `requestOtp`, `verifyOtp`.
- Modify `app/login/login-form.tsx` (or page) — link to OTP flow.
- Create `app/login/login-otp-form.tsx`.
- Modify `messages/en.json`, `messages/fr.json`.

**admin-e2e:**
- OTP sign-in happy-path + wrong-code + deactivated-blocked specs; page
  object + test-only endpoint helper.
