# Signup email verification via 6-digit code — design

**Date:** 2026-10-01
**Status:** draft, pending user review
**Scope:** add a 6-digit-code email verification option for self-serve
signup, selectable per `SaApp` alongside the existing link-based flow,
reusing that app's `activationEmailOverride` branding. Sign-in OTP,
2FA, password reset, and the admin "Resend Activation Email" action are
unaffected in behavior (though some share underlying plumbing).

---

## 1. Problem and stance

Today, self-serve signup (`POST /api/register`,
`registration.service.ts:216-218`) always verifies a new user's email via a
clickable link: BetterAuth issues a signed JWT, embeds it in a URL, and
`auth.config.ts`'s `emailVerification.sendVerificationEmail` sends that URL
using the registering `SaApp`'s branding (`activationEmailOverride` —
`fromName`/`fromAddress`/`subject`/`message`). Separately, this codebase
already has a 6-digit-code mechanism (`emailOTP` plugin, `otpLength: 6`),
but it is wired up only for sign-in (passwordless/step-up login,
`otp-sender.ts`), with `disableSignUp: true` keeping it out of registration
entirely.

This design adds the 6-digit code as a **second, per-app-selectable**
verification method for signup — not a wholesale replacement. A recently
shipped feature (`docs/superpowers/specs/2026-09-29-resend-activation-email-design.md`,
branch `resend-activation-email`, merged into `dev`) built out expired-link
handling (`LinkExpiredCard`, `/signup/verified`'s error branches) and an
admin "Resend Activation Email" action — both of which must keep working
unmodified for apps that stay on the link flow.

**Decision:** add `SaApp.emailVerificationMethod: 'link' | 'code'`
(default `'link'`, so every existing app's behavior is unchanged with no
migration of existing rows needed). The registering app's own setting
decides which flow a given signup goes through.

## 2. Data model

New Prisma enum and field on `SaApp` (`packages/db/schema.prisma:114-173`):

```prisma
enum EmailVerificationMethod {
  link
  code
}

model SaApp {
  // ...existing fields...
  /// Which mechanism self-serve signup uses to verify a new user's email.
  /// 'link' (default) preserves today's behavior; 'code' sends a 6-digit
  /// code instead, reusing the same activationEmailOverride branding.
  emailVerificationMethod EmailVerificationMethod @default(link)
}
```

A migration adds the column with the default — existing rows get `'link'`
automatically, no backfill script needed.

## 3. Backend: per-app branching in `sendVerificationEmail`

BetterAuth's `emailOTP` plugin has an `overrideDefaultEmailVerification`
flag, but it's a single global switch for the whole plugin instance — it
can't branch per app. So this design does **not** use that flag. Instead,
`auth.config.ts`'s existing `emailVerification.sendVerificationEmail`
(`:487-500`) — which already looks up `SaUser → SaOrg → SaApp` for
`activationEmailOverride` — is extended to also read
`emailVerificationMethod` from that same query, and branch:

```ts
sendVerificationEmail: async ({ user, url }) => {
  const firstName = (user.name ?? '').trim().split(' ')[0] || 'there';
  const saUser = await prisma.saUser.findUnique({
    where: { betterAuthUserId: user.id },
    select: {
      org: { select: { app: { select: {
        name: true,
        activationEmailOverride: true,
        emailVerificationMethod: true,
      } } } },
    },
  });
  const appName = saUser?.org.app.name ?? 'Sassy Auth';
  const branding = (saUser?.org.app.activationEmailOverride ?? undefined) as ActivationEmailBranding | undefined;

  if (saUser?.org.app.emailVerificationMethod === 'code') {
    const otp = await auth.api.createVerificationOTP({
      body: { email: user.email, type: 'email-verification' },
    });
    await getEmailer().send({ to: user.email, ...verificationCodeEmail({ firstName, otp, appName, branding }) });
    return;
  }

  await getEmailer().send({ to: user.email, ...verificationEmail({ firstName, verifyUrl: url, appName, branding }) });
},
```

`auth.api.createVerificationOTP` is the `emailOTP` plugin's existing
generate-and-store endpoint (`routes.mjs`'s `createVerificationOTP`): it
writes a `verification` row keyed by `toOTPIdentifier('email-verification', email)`
with the plugin's configured `expiresIn`, and returns the plain code. This
is the same storage `POST /api/auth/email-otp/verify-email` (always
registered, regardless of any plugin-level override flag) reads from — so
verification "just works" with zero changes to BetterAuth's own endpoint.

**Nothing else in the backend changes:**
- `registration.service.ts:216-218`'s call to `auth.api.sendVerificationEmail`
  is untouched — it's generic and routes through the branch above either way.
- `afterEmailVerification` (`auth.config.ts:501-532` — promotes `SaUser.status`
  to `active`, fires the activation webhook) is invoked identically by
  BetterAuth's `/email-otp/verify-email` endpoint (confirmed in
  `routes.mjs`: `await ctx.context.options.emailVerification?.afterEmailVerification?.(updatedUser, ...)`)
  as by the link-based `/verify-email` endpoint. No change needed.
- The admin "Resend Activation Email" action (`users.service.ts`'s
  `resendActivationEmail`) calls the same `sendVerificationEmail` API and
  automatically resends via the app's configured method.
- `useResendVerificationEmail` (the check-email page's own resend button)
  also calls the same generic endpoint — unchanged.
- Sign-in OTP (`otp-sender.ts`, `sendSignInOtp`), 2FA, and password reset
  are untouched; they don't go through this function at all.

**Expiry**: the `emailOTP` plugin's `expiresIn: 300` (5 minutes,
`auth.config.ts:559`) is shared config across all its OTP types
(`sign-in`, `email-verification`, `forget-password`, `change-email`) — it
cannot be set per-type. Code-verification apps get a 5-minute window,
notably shorter than link apps' 1-hour window
(`EMAIL_VERIFICATION_EXPIRES_IN_SECONDS`, which only applies to the link
path). Confirmed acceptable — matches the existing sign-in OTP UX exactly,
and resend is one click away on both the check-email page and (for stuck
users) the admin console.

## 4. New email template

New file `apps/auth-server/src/email/templates/verify-email-code.template.ts`,
sibling to `verify-email.template.ts` and `sign-in-code.template.ts`:

```ts
export function verificationCodeEmail(args: {
  firstName: string;
  otp: string;
  appName: string;
  branding?: ActivationEmailBranding;
}): EmailMessageParts & { from?: string }
```

Reuses `ActivationEmailBranding` exactly as `verify-email.template.ts`
does: `fromName`/`fromAddress` compute the `From` header the same way
(`computeFrom`), `subject` defaults to the same
`'Verify your {{appName}} email address'` and goes through the same
`renderTemplate` substitution, `message` defaults to new copy ("Enter
this code to verify your email address:") and is escaped the same way
(`escapeHtmlMultiline`) before interpolation. The one difference from the
link template: the fixed, non-admin-customizable element is a **code
display block** instead of a button+raw-URL — same rationale as
`renderButton`'s doc comment (the mechanism of verification must never be
something an admin's custom `message` text can spoof or omit). `vars`
passed to `renderTemplate` are `{ firstName, appName }` — no `activationUrl`,
since there's no URL; if an app's existing custom `message` text happens
to reference `{{activationUrl}}`, it's left as a literal unresolved
placeholder (pre-existing `renderTemplate` behavior for unknown keys) —
an acceptable edge case to flag to whoever administers that app's branding
if they switch it from `link` to `code`.

## 5. Frontend: per-app rendering on `/signup/check-email`

`fetchAppInfo` (`apps/admin/lib/app-info.ts`) and the backing
`GET /api/register/app` endpoint (`registration.controller.ts:48-52`,
`registration.service.ts:308-...`) already return app metadata for the
signup page. Both are extended to also return `emailVerificationMethod`.

- **`signup-form.tsx`**: already has `clientId` in scope at submit time:
  the `router.push` on success
  (`/signup/check-email?email=...&next=...`) adds `&clientId=${clientId}`.
- **`apps/admin/app/signup/check-email/page.tsx`**: now also reads
  `clientId` from `searchParams`, calls `fetchAppInfo(clientId)`, and
  renders:
  - `emailVerificationMethod === 'code'` → new `VerifyCodeCard` component
    (code-entry form).
  - otherwise (`'link'`, or `clientId` missing/lookup failed — fail open
    to today's behavior) → existing `CheckEmailCard`, unchanged.
- **New `apps/admin/app/signup/check-email/verify-code-card.tsx`**:
  - A 6-digit code input + submit button, `AuthCard` shell matching
    `CheckEmailCard`'s look.
  - Submit calls `POST ${authServerUrl}/api/auth/email-otp/verify-email`
    with `{ email, otp }` directly from the browser (same
    direct-fetch-to-auth-server pattern `useResendVerificationEmail`
    already uses, not a new Next.js server action).
  - On success (`{ status: true, ... }`): client-side
    `router.push('/signup/verified')` — no query params needed, since
    there's no BetterAuth redirect involved in this path.
  - On failure: inline error message distinguishing `INVALID_OTP` ("wrong
    code, try again") from `OTP_EXPIRED`/`TOO_MANY_ATTEMPTS` ("request a
    new code"), both from the JSON error BetterAuth's endpoint returns —
    no redirect, no new page.
  - A "Resend code" action reusing `useResendVerificationEmail` as-is (it
    already posts to the generic `/send-verification-email` endpoint,
    which the backend branch above routes to the code path for this app).
- **`/signup/verified/page.tsx`** and `LinkExpiredCard`: **unchanged** —
  still exclusively serve the link flow's success/expired/invalid states,
  exactly as shipped in the resend-activation-email design. `code` apps
  never produce a BetterAuth redirect to this page in the failure case
  (errors are inline on `VerifyCodeCard`); the success case does navigate
  here, which already renders correctly with no `error` param.

## 6. Admin configuration UI

`apps/admin/components/app-edit-drawer.tsx`'s "Activation email" section
(`:76-172,252-312`) gets a new control — a two-option toggle ("Link" /
"6-digit code") above the existing `fromName`/`fromAddress`/`subject`/
`message` fields, which stay visible and apply to either method (per §4,
the same branding object drives both templates). Wired through the
existing `PATCH /api/apps/:publicId` path: `update-app.dto.ts` gets an
optional `emailVerificationMethod: 'link' | 'code'` field, validated by a
simple enum check (no new validator needed — simpler than
`assertValidActivationEmailOverride`, since there's no injection surface
here), `apps.service.ts`'s `formatApp` serializes it, and the PATCH handler
writes it directly (no `Prisma.JsonNull` clearing semantics needed — it's
a plain enum column, not a nullable JSON override).

## 7. Explicitly out of scope

- Any change to sign-in OTP, 2FA, or password-reset OTP behavior.
- A UI for showing both a link and a code in the same email ("keep both"
  was considered and rejected in favor of a per-app choice — simpler
  mental model, no dual-path testing burden per email).
- Migrating any existing app's `emailVerificationMethod` away from the
  `'link'` default — that's an explicit admin opt-in per app, not a
  platform-wide cutover.
- Any change to `EMAIL_VERIFICATION_EXPIRES_IN_SECONDS` or the shared
  `emailOTP` plugin's `expiresIn`/`otpLength`/`allowedAttempts`.

## 8. Testing

- `auth.config.spec.ts` (or wherever `sendVerificationEmail` is unit
  tested today): branch coverage — `emailVerificationMethod: 'code'` calls
  `auth.api.createVerificationOTP` and sends `verificationCodeEmail` with
  the app's `activationEmailOverride`; `'link'` (and a `SaUser` with no
  resolvable app) keeps sending the existing link email unchanged.
- New `verify-email-code.template.spec.ts`: default subject/message,
  branding override of `fromName`/`fromAddress`/`subject`/`message`,
  HTML-escaping of a malicious `message` (mirroring
  `verify-email.template`'s existing escaping tests), and the `{{appName}}`/
  `{{firstName}}` substitution.
- `registration.service.spec.ts`: no new coverage needed — the branch lives
  entirely inside `sendVerificationEmail`, which registration already calls
  generically.
- New `verify-code-card.test.tsx`: renders the code form; submits valid
  code → navigates to `/signup/verified`; submits invalid/expired code →
  shows the right inline error without navigating; resend button reuses
  the existing hook's cooldown behavior.
- `check-email/page.tsx` test: extend to assert `VerifyCodeCard` renders
  when `fetchAppInfo` returns `emailVerificationMethod: 'code'`, and
  `CheckEmailCard` renders otherwise (including when `clientId` is
  missing, to confirm the fail-open default).
- `app-edit-drawer.test.tsx`: new toggle renders current value, dirty-
  tracking/reset/save wiring matches the existing `activationEmailOverride`
  fields' pattern.
- `apps.service.spec.ts`: `formatApp` includes `emailVerificationMethod`;
  PATCH accepts and persists `'link'`/`'code'`, rejects any other value.
