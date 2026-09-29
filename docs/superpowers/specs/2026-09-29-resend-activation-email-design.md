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
- Threading the user's email through `callbackURL` itself at every
  `sendVerificationEmail` call site, so BetterAuth's own error redirect
  — which appends `&error=CODE` to an existing `callbackURL` query string —
  naturally carries the email to the error page. No wrapper endpoint, no
  token decoding.
- Error-aware rendering on `/signup/verified`, with a one-click "Resend link"
  action for the expired case (no retyping the email) and a generic
  invalid-link message for the other error codes. The resend button calls
  BetterAuth's existing public `POST /api/auth/send-verification-email`
  endpoint directly from the browser — the same endpoint
  `apps/admin/app/signup/check-email/check-email-card.tsx` already uses for
  its own resend button — via a small shared hook, not a new backend
  endpoint.
- Closing a pre-existing rate-limit gap: `/send-verification-email` is missing
  from `auth-rate-limit.ts`'s `SENSITIVE_PREFIXES`, so both the existing
  check-email resend and the new expired-link resend are currently
  unthrottled at the Express layer. Adding it protects both.
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
  - Calls `auth.api.sendVerificationEmail({ body: { email, callbackURL: \`${adminUrl}/signup/verified?email=${encodeURIComponent(email)}\` } })`
    where `email = user.betterAuthUser.email`
    — the same BetterAuth API already used at signup
    (`registration.service.ts:216-218`), with `email` now threaded into
    `callbackURL` (see §4). No new token-generation logic; BetterAuth issues
    a fresh JWT with its own expiry.
- **`apps/admin/app/(admin)/users/actions.ts`**: new `resendActivationAction`,
  same `mapActionError`/`errorKey` shape as `resendInvitationAction`.
- **`apps/admin/components/users-table.tsx`**: new `DropdownMenuItem`, gated on
  `u.status === 'unverified'`, alongside the existing pending-gated
  resend-invitation item.

## 4. Threading the email through `callbackURL`

BetterAuth's built-in `GET /api/auth/verify-email` handler
(`node_modules/better-auth/.../email-verification.mjs:150-164`) redirects on
failure with:

```js
function redirectOnError(error) {
  if (ctx.query.callbackURL) {
    if (ctx.query.callbackURL.includes("?")) throw ctx.redirect(`${ctx.query.callbackURL}&error=${error.code}`);
    throw ctx.redirect(`${ctx.query.callbackURL}?error=${error.code}`);
  }
  throw APIError.from("UNAUTHORIZED", error);
}
```

— it appends `&error=CODE` to whatever `callbackURL` already contains. Today
every call site builds `callbackURL` as a bare `${adminUrl}/signup/verified`,
so the email is lost. Instead, every place that calls
`auth.api.sendVerificationEmail` (or the browser calls
`POST /api/auth/send-verification-email` directly) builds `callbackURL` as
`${base}/signup/verified?email=${encodeURIComponent(email)}` — a same-origin
relative concern, no new backend code:

- `apps/auth-server/src/registration/registration.service.ts:217` (initial
  signup send) — add `?email=...`.
- The new admin resend action (§3) — add `?email=...`.
- `apps/admin/app/signup/check-email/check-email-card.tsx`'s existing
  `resend()` (the "check your email" page's own resend button) — add
  `?email=...` too, so if *that* resent link also expires, the user still
  lands on an error page that knows their email. Requires updating that
  component's existing test assertion on the `callbackURL` body value.

On success, BetterAuth redirects to `callbackURL` unchanged (`email=...`
harmlessly present); on failure, it becomes
`.../signup/verified?email=...&error=CODE` with zero app-owned endpoint
sitting in front of BetterAuth's own verify-email handler. GET requests skip
BetterAuth's origin-check middleware entirely
(`origin-check.mjs:39`: `if (ctx.request?.method === "GET" ...) return;`), so
the extra query param on `callbackURL` needs no `trustedOrigins` changes.

## 5. `/signup/verified` page

`apps/admin/app/signup/verified/page.tsx` becomes a Server Component that
reads `searchParams` (`error`, `email`):

- No `error` → today's success card, unchanged.
- `error === 'TOKEN_EXPIRED'` and `email` is present → "Link expired for
  `{email}`" card with a single **Resend link** button (client component).
  Clicking it calls BetterAuth's public `send-verification-email` endpoint
  (§6) with that email — no typing required.
- `error === 'TOKEN_EXPIRED'` without a decodable `email`, or
  `error` ∈ `{INVALID_TOKEN, USER_NOT_FOUND, INVALID_USER}`, or any other/
  unrecognized error code → generic "This link isn't valid" card with a link
  back to login/signup, no resend button.

## 6. Self-service resend: reuse BetterAuth's existing public endpoint

No new backend endpoint. The expired-link page's "Resend link" button calls
`POST /api/auth/send-verification-email` directly from the browser — the
exact endpoint `check-email-card.tsx:32` already calls for its own resend
button, with the same body shape: `{ email, callbackURL }`. Since the email
on the expired-link page came from a legitimately-issued (if expired) token's
`callbackURL` round-trip rather than arbitrary user input, there's no new
enumeration surface — this is the same public, no-op-if-unknown-email
behavior `send-verification-email` already has today (`email-verification.mjs:93-102`:
unknown/already-verified email still returns `{status:true}`).

Extract the shared "POST send-verification-email, track cooldown/status"
logic out of `check-email-card.tsx`'s inline `resend()` into a small reusable
hook, e.g. `apps/admin/lib/use-resend-verification-email.ts`, parameterized by
`email` and `callbackURL`. Both `CheckEmailCard` and the new expired-link
component use it — DRY, since the logic is now needed in two places with
identical shape.

**Rate limiting**: `send-verification-email` is currently *not* in
`apps/auth-server/src/auth/auth-rate-limit.ts`'s `SENSITIVE_PREFIXES` list,
so calls to it bypass the Express-level limiter entirely (BetterAuth's own
optional rate limiting is off outside production and not configured here).
Add `/send-verification-email` to `SENSITIVE_PREFIXES` — this protects both
the pre-existing check-email resend button and the new expired-link resend
button with the same `AUTH_THROTTLE` budget (`auth-rate-limit.ts:26-36`).

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
  `sendVerificationEmail` with `callbackURL` containing `?email=<encoded>`
  on success.
- `registration.service.spec.ts`: existing assertion
  (`expect.stringContaining('/signup/verified')`) still passes; add a
  narrower assertion that `callbackURL` also contains
  `email=${encodeURIComponent(baseDto.email)}`.
- `apps/admin/lib/__tests__/use-resend-verification-email.test.ts` (new): the
  extracted hook — posts to `${authServerUrl}/api/auth/send-verification-email`
  with `{ email, callbackURL }`, sets a cooldown on success, surfaces an
  error on failure.
- `check-email-card.test.tsx`: update the existing `callbackURL` body
  assertion to include `?email=...`.
- `apps/admin/app/signup/verified/__tests__/page.test.tsx`: extend to cover
  the three new branches (success / expired-with-email+resend-button /
  generic-invalid-no-resend), asserting the resend button posts to the right
  endpoint with the email from `searchParams`.
- `apps/admin/components/users-table.tsx` test: resend-activation menu item
  visible only for `status === 'unverified'` rows, wired to the new server
  action.
- `auth-rate-limit.spec.ts`: add `/api/auth/send-verification-email` to the
  `isSensitiveAuthPath` "treats %s as sensitive" table.
