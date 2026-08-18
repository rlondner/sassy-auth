# User Lifecycle Actions — Design

**Date:** 2026-07-09
**Status:** Approved (pending spec review)
**Scope:** Implement the currently-stubbed user actions in the admin app — **resend invitation**, **reset password** (admin- and user-initiated), and **activate/deactivate** — plus the shared **email delivery** capability they depend on.

## Problem

Four user row actions are UI stubs today:

- `users-table.tsx` renders `resetPassword`, `resendInvitation`, `activate`, and `deactivate` menu items with **no `onClick`** handlers.
- `user-view-drawer.tsx` renders a `resetPassword` button stub.

Backend maturity varies:

| Action | Backend today | Frontend today |
|---|---|---|
| Resend invitation | ✅ `POST /api/users/:id/resend-invitation` (returns `inviteUrl`, guards `status === 'pending'`) | ❌ stub menu item |
| Activate / deactivate | ✅ `PATCH /api/users/:id` accepts `status`; self-mod + pending→inactive→active transition guards exist | ❌ stub menu items |
| Reset password | ❌ none | ❌ stub menu item + drawer button |

There is **no email service**. BetterAuth's `magicLink`/`emailOTP` senders `console.log`; the existing invitation flow only surfaces the invite link in the admin UI ("Copy link" panel).

## Decisions (from brainstorming)

1. **Delivery model:** send a real email **and** surface the link in the admin UI as a fallback.
2. **Email transports:** pluggable, selected by env — **Resend** (prod HTTP API) > **SMTP/nodemailer** (Mailpit locally, any SMTP provider) > **Console** (default; dev/CI; sends nothing).
3. **Reset password:** a one-time **reset link** redeemed on a "set new password" page (Approach 1 — BetterAuth native reset). Supports **both** user-initiated ("forgot password") and admin-initiated resets, sharing one redemption page.
4. **Deactivate:** immediately **revoke all active sessions** (kill switch), on top of blocking new logins/tokens.
5. **Activate/deactivate:** **silent** (no user email); admin-UI feedback only.

## Non-goals (YAGNI)

- No user email on activate/deactivate.
- No "temporary password" or force-change-on-next-login flow.
- No custom reset-token table (BetterAuth owns token generation/expiry/hashing).
- No Mailpit/real-email assertions in CI (CI stays on the Console transport).
- No changes to social-login or OAuth token flows beyond the status/session semantics already described.
- **Magic-link / email-OTP senders are left as-is** (they keep `console.log`). Routing them through `EmailService` is a natural follow-up but is out of scope here to keep the change focused.

---

## Section 1 — `EmailService` (foundation)

New `EmailModule` in `auth-server` exposing:

- `EmailService.send({ to, subject, html, text }): Promise<{ sent: boolean }>`
- Template functions returning `{ subject, html, text }`: `invitationEmail({ inviteUrl, ... })`, `passwordResetEmail({ resetUrl, ... })`.

**Transport selection (once at startup, priority order):**

1. `RESEND_API_KEY` set → **Resend** transport (`resend` SDK).
2. else `EMAIL_SMTP_HOST` set → **SMTP** transport (`nodemailer`).
3. else → **Console** transport — logs `to` / `subject` / link; sends nothing. **Default in dev & CI.**

Shared `EMAIL_FROM` (default `no-reply@sassy-auth.local`).

**Failure rule:** `send(...)` **never throws into the caller's critical path**. Transport errors are caught, logged (Winston + Sentry), and returned as `{ sent: false }`. A flaky provider never blocks an admin action or a user reset — the link is still surfaced/persisted.

**Boundary:** callers depend only on `EmailService.send(...)` + template functions. Transport choice is fully internal and swappable; tests inject a fake transport.

---

## Section 2 — Password reset (user- & admin-initiated)

**BetterAuth config.** On the already-`enabled` `emailAndPassword`, add:

- `sendResetPassword({ user, url, token })` hook that (a) sends `passwordResetEmail(...)` via `EmailService`, and (b) builds the user-facing link as `${ADMIN_URL}/reset-password?token=${token}` (same construction as the invite link).
- `resetPasswordTokenExpiresIn` ~1h.
- On successful reset, use BetterAuth's `revokeOtherSessions` so a reset also boots existing sessions (consistent with the deactivate kill-switch).

**User-initiated ("forgot password").**

- `/login` gains a **"Forgot password?"** link → new **public `/forgot-password`** page: email field → calls BetterAuth `requestPasswordReset`. Always shows a neutral "if that account exists, a link is on its way" (no user enumeration).
- New **public `/reset-password?token=…`** page: new-password + confirm, reusing accept-invite's password-field validation → calls BetterAuth `resetPassword` → redirect to `/login` with a success toast.

**Admin-initiated.**

- New guarded endpoint **`POST /api/users/:id/reset-password`** — same permission model as `updateUser` (`platform.users.manage` / org-scoped). Triggers a reset for the target user's email and **returns `{ resetUrl }`** so the admin UI can surface a "Copy link" panel (mirrors resend-invitation). Email sends regardless.
- Offered only for users with a **credential (email/password) account**. Pending users (use invite) and social-only users (no credential row) are guarded out with a clear error.
- Self-reset is allowed (an admin may reset their own password; they can also use the public forgot-password page).

**URL capture (the one non-obvious mechanism).** `sendResetPassword` is a fire-and-forget hook, so to *return* the URL from the admin endpoint we capture it via a short-lived **request-scoped context (AsyncLocalStorage)** that the hook writes to and the endpoint reads. Email still sends independently; if capture misses for any reason, the endpoint still succeeds (email sent) and returns `{ resetUrl: null }`, and the UI shows a "email sent" state without a copyable link.

**Redemption page** reuses accept-invite's password UX and validation for consistency.

---

## Section 3 — Resend invitation

- **Backend:** `resendInvitation(...)` keeps regenerating the token and returning `inviteUrl`, and now also sends `invitationEmail(...)` via `EmailService`. For consistency, **`createUser` sends the same invite email** (today it only surfaces the link). Both still surface the link.
- **Admin UI:** new `resendInvitationAction(userId)`; wire the stub menu item (already gated to `status === 'pending'`). On click → call action → show an **"Invitation resent" dialog** reusing the create-drawer invite-link panel (URL + "Copy link") + a toast noting the email was sent. Errors (e.g., user no longer pending) surface as an error toast.
- Enables **un-quarantining** the `resendInvitation` e2e test previously skipped with `test.fixme`.

---

## Section 4 — Activate / deactivate

- **Backend:** `updateUser` already applies `status`. Add: whenever a user's status transitions **to `inactive`**, delete their BetterAuth `Session` rows (by `betterAuthUserId`) inside the service — so the kill-switch fires regardless of entry point (row menu *or* drawer status edit). Existing self-modification and pending→inactive→active transition guards stay.
- **Admin UI:** wire the two stub menu items — `deactivate` (when active) and `activate` (when inactive) — via `setUserStatusAction(userId, status)`.
  - **Deactivate → confirmation dialog** ("signs the user out everywhere and blocks new logins"). **Activate → no confirm.**
  - Both items are **hidden on the current admin's own row** (mirrors the backend self-guard).
  - Success toast; table + any open drawer reflect the new status.

---

## Section 5 — Config & Mailpit

- **New env (all optional; Console default works with zero config):** `EMAIL_FROM` (default `no-reply@sassy-auth.local`), `RESEND_API_KEY`, `EMAIL_SMTP_HOST/_PORT/_USER/_PASS/_SECURE`. Links reuse existing `ADMIN_URL`.
- **`.env.example`**: add these with comments, including Mailpit local values (`EMAIL_SMTP_HOST=localhost`, `EMAIL_SMTP_PORT=1025`).
- **`docker-compose.dev.yml`**: add a Mailpit service (`axllent/mailpit`, SMTP `1025`, web UI `8025`) + a README "Local email testing" note.
- **Deps:** `nodemailer` (+ `@types/nodemailer`), `resend`.

---

## Section 6 — Testing / CI

- **TDD**, following the auth-server's existing Jest patterns.
- **Unit:**
  - Transport selection by env (Resend > SMTP > Console).
  - Template output (`invitationEmail`, `passwordResetEmail`).
  - **Non-fatal send failure** — a throwing transport returns `{ sent: false }` and does not break the caller.
  - Reset endpoint guards: permission, credential-account requirement, self-allowed.
  - Session revocation on status→inactive.
  - Resend/create send the invite email.
  - AsyncLocalStorage URL capture returns the reset URL to the admin endpoint.
- **e2e (Playwright)** — all assert on the **surfaced link**, never on delivery, so CI runs on the **Console transport and stays hermetic**:
  - Un-quarantine the resend-invitation test.
  - Activate/deactivate: confirm dialog, status reflects, self-row items hidden.
  - Admin reset password → copy-link panel.
  - User-initiated `/forgot-password` (neutral message) → `/reset-password?token=…` → new password works at login.
  - Mailpit-based assertions are a local-only nicety, not required in CI.

---

## Component / file map (anticipated)

**auth-server**
- `src/email/` — `email.module.ts`, `email.service.ts`, `transports/{console,smtp,resend}.transport.ts`, `templates/{invitation,password-reset}.ts`, `reset-url-context.ts` (AsyncLocalStorage).
- `src/auth/auth.config.ts` — `sendResetPassword` hook wired to `EmailService` (magic-link/OTP senders unchanged; see non-goals).
- `src/users/users.controller.ts` / `users.service.ts` — `POST /:id/reset-password`; invite-email send in `createUser`/`resendInvitation`; session revocation on deactivate.

**admin**
- `lib/api.ts` — `resetPassword` client, `resendInvitation` (exists).
- `app/(admin)/users/actions.ts` — `resendInvitationAction`, `resetPasswordAction`, `setUserStatusAction`.
- `components/users-table.tsx` — wire the four menu items (+ confirm dialog for deactivate, invite/reset link dialogs).
- `components/user-view-drawer.tsx` — wire the reset-password button.
- `app/forgot-password/`, `app/reset-password/` — new public pages.
- `app/login/page.tsx` — "Forgot password?" link.

**repo**
- `.env.example`, `docker-compose.dev.yml`, `README.md`.
