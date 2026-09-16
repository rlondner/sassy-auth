# Branded, per-app activation emails — design

**Date:** 2026-09-16
**Status:** approved design, no implementation plan yet
**Scope:** let each `SaApp` brand the account-activation (email-verification)
email a new signup receives: subject, from name/address, and an intro message,
with the "confirm your email" link always rendered as a large button by the
platform. Other transactional emails (password reset, sign-in code,
invitation) are untouched except for the shared `from`-override plumbing.

---

## 1. Problem and stance

Today `verificationEmail()` (`apps/auth-server/src/email/templates/verify-email.template.ts:3-10`)
hardcodes subject ("Verify your Sassy Auth email address") and body text, and
`EmailService.send` (`apps/auth-server/src/email/email.service.ts:14-29`)
hardcodes `from` from `process.env.EMAIL_FROM` for every email sent by every
app. A user signing up through Vibecast (or any other SaApp) gets an email
that looks like it came from "Sassy Auth," not from the app they actually
signed up for.

This design lets an app admin set, per `SaApp`:

- a custom subject line,
- a custom from display name + email address,
- a custom intro message,

all with `{{placeholder}}` substitution, while the platform always renders the
actual activation link as a styled, large call-to-action button (never
admin-authored raw HTML) so the email can't be broken or have the link
omitted by a bad template.

## 2. Data model

One nullable JSON column on `SaApp` (`schema.prisma:114-147`), mirroring the
existing `passwordPolicyOverride: Json?` pattern rather than four more flat
columns — null means "use platform defaults" for every field:

```prisma
model SaApp {
  // ...existing fields...
  /// Complete ActivationEmailBranding JSON override (see @sassy-auth/types).
  /// null, or any field omitted within it, means "use platform default" for
  /// that field.
  activationEmailOverride Json?
}
```

```ts
// packages/types
export interface ActivationEmailBranding {
  fromName?: string; // e.g. "Vibecast"
  fromAddress?: string; // e.g. "no-reply@vibecast.io"
  subject?: string; // e.g. "Confirm your {{appName}} account"
  message?: string; // e.g. "Welcome to Vibecast! One click and you're in."
}
```

One Prisma migration. No changes to any other table.

**Deliverability note (accepted tradeoff):** `fromAddress` is a free-text
field. Most ESPs (Resend included) require the sending domain to be verified
on the account before they'll relay mail from it — an unverified
`fromAddress` will fail at send time. This design does not add domain
verification; `EmailService.send` already fails soft (logs + returns
`{ sent: false }`, never throws — see §4), so a bad override degrades to "no
activation email sent" rather than crashing signup. The admin UI surfaces this
constraint as helper text (§6).

## 3. Placeholders and rendering

A small shared helper, `renderTemplate(str: string, vars: Record<string, string>): string`,
does literal `{{token}}` substitution — no conditionals, no loops, unknown
tokens left as-is. Supported tokens: `{{firstName}}`, `{{appName}}`,
`{{activationUrl}}`. Used for both `subject` and `message`.

Defaults (used whenever the corresponding override field is unset):

- `subject` → `Verify your {{appName}} email address`
- `message` → `Confirm your email address to finish setting up your account:`

`verificationEmail()` (`verify-email.template.ts`) gains a `branding` param:

```ts
export function verificationEmail(args: {
  firstName: string;
  verifyUrl: string;
  appName: string;
  branding?: ActivationEmailBranding;
}): EmailMessageParts & { from?: string };
```

It renders subject and message from `branding` + defaults via
`renderTemplate`, then appends the button + plain-URL fallback:

- **HTML:** message paragraph, then a bulletproof table-based button (large
  padding, brand-neutral blue background, white bold text, rounded corners
  via inline CSS with a plain fallback for clients that ignore
  `border-radius`), then the raw URL as a plain link underneath for clients
  that strip button styling.
- **Text:** message, blank line, raw URL — unchanged shape from today's plain-text
  email, since a button has no text-part equivalent.

`from` is computed here too (`"${fromName} <${fromAddress}>"`, or just
whichever of the two is set, or `undefined` when neither is set) and returned
alongside subject/html/text.

## 4. Wiring

- `sendVerificationEmail` in `auth.config.ts:361-364` currently only receives
  `{ user: { email, name }, url }`. We extend the type to include `user.id`
  (BetterAuth's user object has it; only the local type annotation was
  narrower) and resolve the owning `SaApp`:

  ```ts
  const saUser = await prisma.saUser.findUnique({
    where: { betterAuthUserId: user.id },
    select: { org: { select: { app: { select: { name: true, activationEmailOverride: true } } } } },
  });
  ```

  then pass `appName: saUser?.org.app.name ?? 'Sassy Auth'` and
  `branding: (saUser?.org.app.activationEmailOverride ?? undefined) as ActivationEmailBranding | undefined`
  into `verificationEmail()`.

- `EmailMessage` (`email.types.ts:1-6`) gains an optional `from?: string`.
  `EmailService.send` (`email.service.ts:14-29`) uses `msg.from ?? process.env.EMAIL_FROM ?? 'no-reply@sassy-auth.local'`
  instead of always overriding with the env var. This is generic plumbing —
  any future caller can pass a per-send `from`; only the verification-email
  call site does today.

## 5. Admin UI

Extend `app-edit-drawer.tsx`'s existing collapsible-section pattern (same one
used for the webhook fields) with a new "Activation email" section: From name,
From address, Subject, Message — all optional text inputs. Helper text under
From address: "Must be on a domain verified with your email provider, or
activation emails will silently fail to send." `apps.service.ts` /
`update-app.dto.ts` / `create-app.dto.ts` gain an optional
`activationEmailOverride` object field, validated as a plain object of
optional strings (same shallow-validation style as `redirectUris`).

## 6. Explicitly out of scope

- Domain verification UI/flow for custom `fromAddress` values.
- Customizing the button's color/shape per app, or any other visual theming
  beyond message/subject/from text — logo already exists on `SaApp` and is
  not wired into this email in this pass.
- Customizing password-reset, sign-in-code, or invitation email bodies —
  only the `from` plumbing (§4) is shared; their subject/message stay as-is.
- A full custom-HTML template mode — rejected in favor of message-text +
  system-rendered button, to guarantee the link is always present and
  correctly formatted.

## 7. Testing

- `renderTemplate`: substitutes known tokens, leaves unknown tokens
  untouched, handles repeated tokens.
- `verificationEmail()`: default subject/message when `branding` is
  undefined/partial; custom subject/message + placeholder substitution when
  provided; `from` computed correctly for name-only, address-only, both, and
  neither; button HTML always contains `verifyUrl`.
- `EmailService.send`: uses `msg.from` when provided, falls back to
  `process.env.EMAIL_FROM` otherwise.
- `auth.config.spec.ts`: `sendVerificationEmail` resolves the `SaApp` via
  `betterAuthUserId` and passes its name + override through; falls back to
  `'Sassy Auth'`/no branding when the `SaUser` lookup finds nothing.
- `apps.service.spec.ts`: `create`/`updateApp` persist and round-trip
  `activationEmailOverride`, including clearing it back to `null`.
