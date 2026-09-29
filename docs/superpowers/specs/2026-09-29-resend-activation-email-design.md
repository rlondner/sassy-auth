# Resend activation email + expired-link handling — design

**Date:** 2026-09-29
**Status:** approved design, no implementation plan yet
**Scope:** (a) an admin action to resend the activation email to a `SaUser`
with `status = 'unverified'`; (b) a dedicated expired/invalid-link page at
`/signup/verified`, with self-service one-click resend when the link expired;
(c) making the activation link's expiry configurable. Deactivation, other
status-change flows, and any change to invitation resend are explicitly out
of scope.

---

## 1. Problem and stance

Two related gaps in the account-activation flow:

- There is no way to resend an activation email to a `SaUser` stuck in
  `unverified` status. Admins can already resend an invitation
  (`resendInvitation`, `users.service.ts:641-681`) for `pending` users, but
  there is no equivalent for `unverified` users who never clicked their
  original link.
- When an activation link has expired, BetterAuth's built-in
  `GET /api/auth/verify-email` handler redirects to
  `/signup/verified?error=TOKEN_EXPIRED` (and similar for `INVALID_TOKEN`,
  `USER_NOT_FOUND`, `INVALID_USER`) — but `SignupVerifiedPage`
  (`apps/admin/app/signup/verified/page.tsx`) never reads `searchParams` at
  all, so it unconditionally shows the success card regardless of the error.

This design adds:

- An admin-triggered resend action, mirroring the existing `resendInvitation`
  pattern.
- A thin wrapper around BetterAuth's verify-email endpoint that we own, so the
  error redirect can carry the user's email (decoded from the JWT payload,
  which is unencrypted) alongside the error code.
- Error-aware rendering on `/signup/verified`, with a one-click "Resend link"
  action for the expired case (no retyping the email) and a generic
  invalid-link message for the other error codes.
- A public, unauthenticated, rate-limited resend endpoint that the expired-link
  page's button calls.
- A new env var to make the activation link's lifetime configurable, replacing
  today's implicit reliance on BetterAuth's library default (1 hour).

## 2. Data model

No schema changes. `SaUser.status` keeps its existing enum
(`active | pending | inactive | unverified`, `schema.prisma:107-112`). The
activation token itself remains entirely owned by BetterAuth (a signed JWT,
not persisted as app-owned columns) — this design does not introduce any
app-owned token storage.

## 3. Admin "Resend activation email" action

Mirrors `resendInvitation` (`users.service.ts:641-681`,
`users.controller.ts:74-76`, `apps/admin/app/(admin)/users/actions.ts:195-203`,
`apps/admin/components/users-table.tsx:144-156`) as closely as possible:

- **`apps/auth-server/src/users/users.controller.ts`**: new
  `POST /users/:id/resend-activation`, decorated
  `@Throttle({ auth: AUTH_THROTTLE })`.
- **`apps/auth-server/src/users/users.service.ts`**: new
  `resendActivationEmail(callerBaId, userPublicId)`:
  - `checkPermission(..., ['platform.users.manage', 'org.users.manage'], { targetOrgId })`
    — same gate as `resendInvitation`.
  - Guard: throws `BadRequestException` unless `user.status === 'unverified'`.
  - Calls `auth.api.sendVerificationEmail({ body: { email: user.betterAuthUser.email, callbackURL: \`${adminUrl}/signup/verified\` } })`
    — the same BetterAuth API already used at signup
    (`registration.service.ts:216-218`). No new token-generation logic;
    BetterAuth issues a fresh JWT with its own expiry.
- **`apps/admin/app/(admin)/users/actions.ts`**: new `resendActivationAction`,
  same `mapActionError`/`errorKey` shape as `resendInvitationAction`.
- **`apps/admin/components/users-table.tsx`**: new `DropdownMenuItem`, gated on
  `u.status === 'unverified'`, alongside the existing pending-gated
  resend-invitation item.

## 4. Verify-email wrapper endpoint

Today's activation link points directly at BetterAuth's built-in
`GET /api/auth/verify-email`, which lives in library code
(`node_modules/better-auth/.../email-verification.mjs`) and, on failure, only
forwards `?error=CODE` to `callbackURL` — never the email. We insert a thin
wrapper we own so the error redirect can also carry the decoded email:

- **New endpoint**, `GET /verify-email`, in
  `apps/auth-server/src/registration/` (co-located with the other
  registration/activation code that already calls `auth.api.*` directly):
  1. Base64url-decode the JWT payload portion of `token` to extract `email`.
     This is best-effort UX only — no signature verification, and a decode
     failure simply means no email is available downstream.
  2. Call `auth.api.verifyEmail({ query: { token } })` directly — the same
     "call the BetterAuth API programmatically" pattern already used for
     `sendVerificationEmail`.
  3. On success: redirect to `callbackURL` unchanged (today's success
     behavior — no `error` param).
  4. On failure: map the thrown error to a code using the same rules
     BetterAuth's own handler uses (`JWTExpired` → `TOKEN_EXPIRED`; missing
     user → `USER_NOT_FOUND`; otherwise `INVALID_TOKEN`/`INVALID_USER` as
     appropriate), then redirect to
     `callbackURL?error=CODE&email=<decoded-email-if-any>`.
- **Email template change**: in `auth.config.ts`'s `sendVerificationEmail`
  callback (`auth.config.ts:482-495`, already customized to build the
  branded email), rewrite the `url` BetterAuth hands us so its path points at
  `/verify-email` (our wrapper) instead of `/api/auth/verify-email`, keeping
  the `token` and `callbackURL` query params unchanged.

## 5. `/signup/verified` page

`apps/admin/app/signup/verified/page.tsx` becomes a Server Component that
reads `searchParams` (`error`, `email`):

- No `error` → today's success card, unchanged.
- `error === 'TOKEN_EXPIRED'` and `email` is present → "Link expired for
  `{email}`" card with a single **Resend link** button (client component).
  Clicking it calls the self-service resend endpoint (§6) with that email —
  no typing required.
- `error === 'TOKEN_EXPIRED'` without a decodable `email`, or
  `error` ∈ `{INVALID_TOKEN, USER_NOT_FOUND, INVALID_USER}`, or any other/
  unrecognized error code → generic "This link isn't valid" card with a link
  back to login/signup, no resend button.

## 6. Self-service resend endpoint

- New route `POST /users/resend-verification-email` (colocated with the
  wrapper endpoint in `apps/auth-server/src/registration/`), body
  `{ email: string }`, decorated `@Throttle({ auth: AUTH_THROTTLE })`. No
  authentication.
- Behavior: look up the user by email. If found and `status === 'unverified'`,
  call `auth.api.sendVerificationEmail(...)` the same way the admin path
  does. Always return the same generic success-shaped response regardless of
  whether the email matched a real unverified account, so the endpoint cannot
  be used to enumerate accounts.
- The email reaching this endpoint is decoded from a legitimately-issued (if
  expired) token rather than arbitrary user input, so the abuse surface is
  already narrow; the shared `AUTH_THROTTLE` bucket (`auth` bucket, same one
  used by invitations/token/social endpoints,
  `rate-limit-config.ts:40-42`) is sufficient — no new dedicated cooldown.

## 7. Configurable activation link duration

- `apps/auth-server/src/auth/auth.config.ts`: the `emailVerification` block
  currently doesn't set `expiresIn` at all, so it silently falls back to
  BetterAuth's library default of 3600 seconds. Add:
  ```ts
  emailVerification: {
    expiresIn: Number(process.env.EMAIL_VERIFICATION_EXPIRES_IN_SECONDS ?? 3600),
    sendVerificationEmail,
    afterEmailVerification,
    autoSignInAfterVerification,
  }
  ```
- Document `EMAIL_VERIFICATION_EXPIRES_IN_SECONDS` alongside the existing
  `AUTH_RATE_LIMIT`-style env vars.

## 8. Explicitly out of scope

- Any change to `resendInvitation` or the `pending`-status flow.
- Invalidating/expiring previously-issued verification tokens when a new one
  is sent — BetterAuth's JWT-based tokens are self-contained and stateless; an
  old, still-unexpired link continues to work after a resend, matching
  existing behavior for `sendVerificationEmail` calls elsewhere in the
  codebase.
- A dedicated per-email cooldown separate from `AUTH_THROTTLE`.

## 9. Testing

- `users.service.spec.ts`: `resendActivationEmail` — permission gate, status
  gate (`BadRequestException` for non-`unverified` users), calls
  `sendVerificationEmail` with the right email/callbackURL on success.
- New `verify-email` wrapper endpoint test: JWT-expired → redirects with
  `error=TOKEN_EXPIRED&email=...`; malformed/invalid token → redirects with
  `error=INVALID_TOKEN` and no `email`; unknown user → `USER_NOT_FOUND`;
  success → redirects to `callbackURL` with no `error` param.
- New `resend-verification-email` endpoint test: existing unverified user →
  triggers `sendVerificationEmail`, generic success response; unknown email →
  same generic success response, no email sent; non-`unverified` user → same
  generic success response, no email sent.
- `apps/admin/app/signup/verified/__tests__/page.test.tsx`: extend to cover
  the three new branches (success / expired-with-email+resend-button /
  generic-invalid).
- `apps/admin/components/users-table.tsx` test: resend-activation menu item
  visible only for `status === 'unverified'` rows, wired to the new server
  action.
