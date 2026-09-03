# Self-serve signup in the admin console — design

**Date:** 2026-09-03
**Status:** approved design, no implementation plan yet
**Scope:** a public `/signup` page in `apps/admin` that lets a visitor create a
new org (tenant) and its first admin user for a specific registered app, using
the existing `POST /api/register` endpoint.

---

## 1. Problem and stance

`apps/auth-server` already has a self-serve registration endpoint,
`POST /api/register` (`registration.controller.ts` → `registration.service.ts`),
that creates a new `SaOrg` + `SaUser` under a given `SaApp`. Nothing in
`apps/admin` calls it — the only way to get an admin-console account today is
an admin-issued invitation (`SaInvitation` → `/accept-invite`). This spec adds
the missing UI.

**Scope decision — new org only.** This signup page always creates a **new**
org. It never attaches a self-registered visitor to an *existing* org: org
public ids are not secret (they appear in URLs, JWT `aud` claims, etc. — see
`token.service.ts`), so accepting one from an untrusted URL and using it to
grant org membership would let anyone who learns an org's id add themselves as
a member, bypassing the admin gatekeeping invitations exist to enforce.
Self-serve joining of an existing org is explicitly out of scope (§7).

**Scope decision — person vs. company identity.** `SaUser.firstName`/
`lastName` are separate required columns (`schema.prisma:162-163`), populated
as real person-name fields by every other user-creation path (the admin's
user-create form, invitations). The existing `RegistrationService.register()`
does not collect them — it stuffs the org's `companyName` into `firstName` and
leaves `lastName` empty. This spec fixes that as part of adding the form,
rather than perpetuating it (§3).

## 2. Entry point and app context

The signup page is reached with `?client_id=<appPublicId>` — the same query
param name already used by the OAuth `authorize` flow and by
`fetchSocialProviders`/`app-trust-days` on the login page, so an app's own
onboarding can link to `/signup?client_id=...` using an id it already has.

- Missing or unknown `client_id` → the page renders an "this signup link isn't
  valid" state instead of a broken form. There is no such thing as registering
  without knowing which app the new org belongs to.
- The login page's "Don't have an account? Sign up" link is built by parsing
  `client_id` out of its own `next` param, the same way
  `applyPerAppTrustCookie` already does for trust-day lookups. If `next` carries
  no `client_id`, the signup link is simply omitted (there's no app to send the
  visitor to sign up for).

### App name display

To show "Register with {App Name}" instead of a generic heading, add a new
public endpoint:

- `GET /api/register/app?appPublicId=<id>` → `{ name: string }`, 404 if unknown.
- Lives on `RegistrationController` (not `AppsController`, whose
  `@UseGuards(BetterAuthGuard)` is applied at the controller level to every
  route). No guard is added, matching the existing public-route convention
  (`SocialController`'s unauthenticated `GET /api/social-providers`,
  `TokenController`'s `jwks`/`app-trust-days`).
- Exposure level: an app's display name for a known public id. Same class of
  disclosure as the existing `/api/social-providers?client_id=` endpoint
  (confirms whether a `client_id` exists at all).
- The admin page fetches this server-side (in `page.tsx`, alongside reading the
  query param) and falls back to a generic "Create your account" heading if the
  lookup 404s or the fetch fails — same fail-open-to-generic pattern as
  `fetchSocialProviders`.

## 3. Backend changes (`apps/auth-server`)

**`registration/register.dto.ts`** — add two required fields, same validation
style as the existing ones:

```ts
@IsString() @MinLength(1) firstName!: string;
@IsString() @MinLength(1) lastName!: string;
```

**`registration/registration.service.ts`** — use the new fields instead of the
`companyName`/`''` placeholders when creating the `SaUser`:

```ts
firstName: dto.firstName,
lastName: dto.lastName,
```

No other change to `register()`'s control flow (app lookup, BetterAuth
sign-up, duplicate-email handling, transactional org+user creation,
compensation on failure all stay as-is).

**`registration/registration.controller.ts`** — add the public app-name
lookup described in §2:

```ts
@Get('app')
async getAppName(@Query('appPublicId') appPublicId: string) {
  return this.service.getAppName(appPublicId); // 404 via NotFoundException if unknown
}
```

(New `RegistrationService.getAppName()` — a plain `prisma.saApp.findUnique`
returning `{ name }`, mirroring the existing app lookup already at the top of
`register()`.)

**Tests:** update `registration.service.spec.ts` fixtures (`baseDto`) to
include `firstName`/`lastName`; add cases for the new `getAppName` method
(found / not found) and a controller spec for the new route.

## 4. Frontend changes (`apps/admin`)

New route, following the existing `/login`, `/forgot-password`,
`/accept-invite` structure:

- **`app/signup/page.tsx`** (server component): reads `client_id` from
  `searchParams`; if present, fetches the app name via the new endpoint
  (`AUTH_SERVER_URL`, server-to-server — same origin variable `forgot-password`
  and `login` already use for non-browser-facing calls); renders `<SignupForm>`
  with `clientId`, `appName`, and `next` (passthrough for the post-signup link
  back to `/login`).
- **`app/signup/signup-form.tsx`** (client component): fields — First name,
  Last name, Company name, Email, Password, Confirm password. Client-side
  password rule matches the site-wide policy already enforced identically in
  `accept-invite-form.tsx` and `reset-password-form.tsx`: 12+ characters,
  at least one uppercase, one lowercase, one digit. (Stricter than the server's
  `@MinLength(8)`, same relationship those two forms already have to their
  server-side minimums.)
- **`app/signup/actions.ts`** (`'use server'`): a single `registerAction`,
  following `forgot-password/actions.ts`'s pattern (plain server-side `fetch`,
  no cookie handling) rather than `accept-invite`'s client-side
  `lib/api-public.ts` call — `/api/register` returns no session
  (`autoSignIn: false`), so there's nothing to forward, and doing the fetch
  server-side avoids the browser needing a publicly-reachable auth-server
  origin for this call.

  POST body: `{ email, password, firstName, lastName, companyName, appPublicId: clientId }`.

  Response mapping:
  | Condition | Result |
  |---|---|
  | 2xx | `{ ok: true }` |
  | 404 | `{ error: 'appNotFound' }` |
  | 409 | `{ error: 'emailTaken' }` |
  | 429 | `{ error: 'tooManyRequests' }` (existing `REGISTER_RATE_LIMIT`/`REGISTER_RATE_WINDOW_MS` guard on the auth-server side — unchanged) |
  | other non-2xx | `{ error: 'validationError' }` |
  | transport failure | `{ error: 'serverUnavailable' }` (+ `Sentry.captureException`, matching every other action) |

  On success: the form shows an inline success message and an explicit link to
  `/login` (carrying `next`/`client_id` forward so a visitor who arrived via an
  app's OAuth `authorize` flow can continue it after signing in). No
  auto-redirect timer — `accept-invite-form.tsx`'s equivalent needed explicit
  unmount cleanup for its timer (bug-0160); a plain link avoids that class of
  bug for a one-off form.

- **`app/login/login-form.tsx`**: add a "Don't have an account? Sign up" link,
  visible only when a `client_id` can be parsed out of `next` (§2).
- **`messages/en.json`**: new `signup` namespace (title, subtitle, field
  labels, submit, success, and its own copies of the mismatch/tooShort/
  complexity/appNotFound/emailTaken/tooManyRequests/serverUnavailable/
  validationError strings — following the existing convention of each form
  owning its own error-string copies rather than sharing a namespace with
  `acceptInvite`/`resetPassword`), plus `login.signupPrompt`/`login.signupLink`.

**Tests:** `signup/__tests__/actions.test.ts` (status-code mapping, mirroring
`login/__tests__/actions.signin.test.ts`), `signup/__tests__/signup-form.test.tsx`
(client-side validation, mirroring `accept-invite/__tests__/accept-invite-form.test.tsx`),
and an update to `login/__tests__/login-forms.test.tsx` for the new
conditional link.

## 5. What stays unchanged

- `RegistrationService.register()`'s app lookup, BetterAuth sign-up call,
  duplicate-email detection, and transactional org+user creation with
  compensation-on-failure.
- `REGISTER_RATE_LIMIT`/`REGISTER_RATE_WINDOW_MS` (already configurable,
  currently unset/unlimited in `.env` — a deployment concern, not addressed
  here).
- Social/OTP signup stays disabled (`disableSignUp` on both) — unrelated to
  this credential-based flow.
- No email verification is added or required (BetterAuth's
  `requireEmailVerification` is already off; not toggled by this work).

## 6. Error handling summary

Every failure mode surfaces a distinct, honest message to the visitor (no
generic 500s bubbling up), matching the rest of the admin console's public
forms:

- Unknown app (`client_id` missing or 404 from the app-name lookup /
  registration itself) → distinct "invalid signup link" / `appNotFound` states,
  not conflated.
- Duplicate email → `emailTaken` (the auth-server already avoids leaking
  *which* email exists via BetterAuth's synthetic-user behavior on
  `autoSignIn: false`; the admin side just surfaces the resulting 409 plainly,
  same as any other "this email is taken" UX).
- Rate limiting → `tooManyRequests`, distinct from a validation error, mirroring
  the existing `tooManyRequests` handling in `login/actions.ts` and
  `reset-password/actions.ts`.
- Transport/server failure → `serverUnavailable` + Sentry capture, never
  presented as if the input were wrong.

## 7. Explicitly out of scope

- **Joining an existing org via a self-serve link.** No `orgPublicId`/`org_id`
  URL param is accepted anywhere in this flow. Adding an existing user to an
  existing org remains admin-invite-only (`SaInvitation` → `/accept-invite`),
  unchanged. A future secret, org-scoped, admin-generated "join link" (distinct
  from a raw org id) is a separate design if ever pursued.
- Email verification / verified-domain auto-join.
- Any change to `REGISTER_RATE_LIMIT` defaults or `.env`.
- Admin UI for managing signup links per app (e.g. copy-a-signup-URL button on
  the apps page) — the URL shape (`?client_id=`) is stable and can be
  hand-constructed today; a UI affordance for it is separate, smaller work if
  wanted later.
