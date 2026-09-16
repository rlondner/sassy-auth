# Restyle auth forms with shadcn/ui

## Problem

The admin console's sign-in, sign-up, forgot-password, reset-password, and
post-verification pages each hand-roll their own markup: raw `<input>` /
`<label>` elements, a `flex min-h-screen items-center justify-center ...`
shell duplicated six times, and a hand-written `text-[var(--destructive)]`
error `<p>` per form. `@sassy-auth/ui` already ships shadcn primitives
(`Card`, `Input`, `Label`, `Button`) and a `FormField` component that
implements exactly the "label + input + error" pattern these forms
reimplement — none of it is used here. Reference point for the target look:
https://better-auth-ui.com/llms.txt (its `AuthCard` + named form component
shape, not the library itself — this app calls its own auth-server via
server actions, not better-auth's client SDK).

There is also no dedicated "verify email" surface today, only a post-click
confirmation page (`signup/verified`). Signup instead shows an inline
"check your email" message in place, with no way to resend the verification
email.

## Scope

Visual restyle (shared shell + `FormField`) of:

1. `apps/admin/app/login/login-form.tsx`
2. `apps/admin/app/login/login-otp-form.tsx`
3. `apps/admin/app/login/social-buttons.tsx` (divider only)
4. `apps/admin/app/signup/signup-form.tsx` + `apps/admin/app/signup/page.tsx`
5. `apps/admin/app/forgot-password/forgot-password-form.tsx`
6. `apps/admin/app/reset-password/reset-password-form.tsx`
7. `apps/admin/app/signup/verified/page.tsx`

Plus one new surface:

8. `apps/admin/app/signup/check-email/page.tsx` — new "check your inbox"
   page with a resend-verification-email button.

Out of scope: validation logic, server actions, password-policy checks,
error-key mapping, captcha, social sign-in POST flow, two-factor forms —
none of that changes.

## Shared primitives

### `AuthCard` (new, added to `@sassy-auth/ui`)

Wraps shadcn `Card`/`CardHeader`/`CardTitle`/`CardDescription`/`CardContent`
with the `flex min-h-screen items-center justify-center` centering shell
every one of these pages currently duplicates. Props: `title`, `subtitle?`,
`children`, optional `footer` slot (for "back to sign in" links). Replaces
the repeated
```
<div className="flex min-h-screen items-center justify-center bg-[var(--background)]">
  <div className="w-full max-w-sm rounded-lg border ... p-8 shadow-sm">
```
block in all 8 surfaces.

### `FormField` (existing, currently unused by these forms)

Already implements label/input/error/hint with a11y wiring
(`aria-describedby`, unique ids via `useId`). Every raw `<label>` +
`<input>` pair in scope is replaced with `FormField`, passing through the
same `id`, `name`, `type`, `autoComplete`, `required`, `value`/`onChange`
props the raw inputs already receive, and `error` only where a form already
attaches a per-field error (most errors here are form-level, not per-field,
and stay in a form-level `<p data-testid="...">` below the fields — no
change to where errors render, just how the fields above them render).

### Preserved contracts

For every form: `data-testid` attributes, translation keys (`t('...')`),
`htmlFor`/label text pairing, form `action`/`onSubmit` wiring, and
`useActionState`/`useState` logic are unchanged. This is a markup swap, not
a behavior change — existing unit tests that query by `getByLabelText`,
`getByRole`, or `getByTestId` should not need to change, except where noted
below for the new check-email flow.

## New: check-email page + resend

### Trigger

`signup-form.tsx`'s `handleSubmit`, on a successful `registerAction`,
currently sets local `success` state and renders an inline message. It
instead calls `router.push(`/signup/check-email?email=${encodeURIComponent(email)}${next ? `&next=${encodeURIComponent(next)}` : ''}`)`.
The inline `success` state and its markup are removed.

### Page

`apps/admin/app/signup/check-email/page.tsx` (client component, reads
`email`/`next` from `useSearchParams`). Renders an `AuthCard` with:
- Title/subtitle: "Check your email" / "We sent a verification link to
  {email}."
- A resend button.
- A "back to sign in" link (reusing the existing `next`-preserving pattern
  other pages use).

If `email` is missing from the query string (direct nav, stale bookmark),
render a fallback state pointing back to `/signup` rather than a broken
page.

### Resend, no new backend endpoint

better-auth already exposes a public, anti-enumeration-safe
`POST /api/auth/send-verification-email` — the same endpoint
`registration.service.ts` calls server-side today
(`auth.api.sendVerificationEmail`). It always responds `{status: true}`
regardless of whether the email exists or is already verified, so it's safe
to call directly from an unauthenticated client, mirroring the existing
`social-buttons.tsx` pattern of `fetch`-ing `${authServerUrl}/api/auth/...`
directly from a client component:

```
POST ${authServerUrl}/api/auth/send-verification-email
Content-Type: application/json
{ "email": "<email>", "callbackURL": "<origin>/signup/verified" }
```

`authServerUrl` is resolved server-side in `signup/page.tsx` the same way
`PUBLIC_AUTH_SERVER` already is for `LoginForm`, and threaded down to the
check-email page.

**Rate limiting:** add a `customRules` entry for `/send-verification-email`
in `auth.config.ts`'s `rateLimit` block (mirroring the existing
`emailOTP`/two-factor pattern — proposed `{ window: 60, max: 3 }`), since
this is the first time that endpoint becomes directly reachable from a
public browser click rather than only server-to-server.

**Client-side cooldown:** after each click, disable the resend button for
30s with a visible countdown, independent of the server-side rate limit —
purely to stop accidental double-clicks, not a security control.

**Response handling:** any 200 is treated as "sent" (per the endpoint's
anti-enumeration design, we can't and shouldn't distinguish "no such user"
from "sent"). Network failure or non-200 shows a generic
`serverUnavailable`-style error, consistent with how other forms in this
app handle transport failures.

### PII-in-URL tradeoff (explicitly accepted)

The email address is passed via the `?email=` query parameter rather than
`sessionStorage`, so the page works even if the user opens the
verification-adjacent link in a new tab or the URL is copied/bookmarked.
This means the email is briefly present in browser history and any
referrer sent from that page. Accepted tradeoff, confirmed with the repo
owner.

## i18n

New keys under `signup.checkEmail` in `messages/en.json` and
`messages/fr.json`: `title`, `subtitle` (`{email}` placeholder),
`resendButton`, `resendCooldown` (`{seconds}` placeholder), `resendSent`,
`resendError`, `backToLogin`.

Removed (now-unused) keys: `signup.success`, `signup.continueToLogin` — the
inline success state they served is replaced by the check-email page.

## Test fallout

- `apps/admin-e2e/pages/signup.page.ts`: `successMessage` and
  `continueToLoginLink` locators target text that no longer renders inline;
  update to assert navigation to `/signup/check-email` and locate the new
  page's elements instead.
- `apps/admin-e2e/tests/signup.spec.ts`: both tests currently assert
  `successMessage` visibility + click `continueToLoginLink` in place;
  update to assert the URL change and the check-email page's content.
- `apps/admin/app/signup/__tests__/signup-form.test.tsx`: success-state
  assertions (currently checking inline success markup) need updating to
  assert the `router.push` call instead. `next/navigation`'s `useRouter` is
  already mocked in the sibling `login-forms.test.tsx`; the same mock
  pattern applies here.
- All other existing unit/e2e tests in scope (`reset-password-form.test.tsx`,
  `otp-signin.spec.ts`, `reset-password-flow.spec.ts`) query by label text,
  role, or testid and are not expected to need changes.

## Verification

- `pnpm --filter admin test`, `pnpm --filter admin typecheck`, and the
  relevant `admin-e2e` specs (`signup`, `reset-password-flow`,
  `otp-signin`) after implementation.
- Manual click-through of all 8 surfaces (including resend) in a running
  dev server, light and dark mode, before calling this done — a11y/label
  wiring and visual regressions are not something the test suite alone
  verifies.
