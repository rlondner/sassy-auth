# App logo on sign in / sign up pages

## Problem

When a downstream app redirects a user to the auth-server's hosted login or
signup page (carrying `client_id`), the page shows generic branding only.
Admins should be able to upload a logo per app, and that logo should appear
on the login/signup card whenever the page is scoped to that app via
`client_id`.

## Data model

Add a nullable `logo` column to `SaApp`:

```prisma
model SaApp {
  ...
  /// Full data URI (e.g. "data:image/png;base64,...."). null = no logo set.
  logo String?
  ...
}
```

Stored as the complete data URI (not raw base64) so every consumer — API
responses, the `<img src>` on login/signup, the admin preview thumbnail —
can use the value directly with no reassembly step.

## Shared validation (`@sassy-auth/types`)

New exports, reused by the admin console's client-side file picker and the
auth-server's DTO validator, so the size/type rule is defined once:

- `APP_LOGO_MAX_BYTES = 250 * 1024` (raw file size cap, pre-encoding)
- `APP_LOGO_ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']`
- `isValidAppLogoDataUri(value: unknown): boolean` — checks the value is a
  string matching `data:<allowed-mime>;base64,<payload>`, and that the
  decoded byte length (estimated from the base64 payload length) does not
  exceed `APP_LOGO_MAX_BYTES`.

SVG is served exclusively via `<img src="data:...">`, never injected as
inline markup, so an SVG payload cannot execute script in the viewer's page.

## Backend

**`apps/auth-server/src/common/config/is-app-logo.decorator.ts`** — new
`IsAppLogo()` class-validator decorator mirroring the existing `IsAppUrl`,
wrapping `isValidAppLogoDataUri`.

**`CreateAppDto` / `UpdateAppDto`** — add `logo?: string | null`, validated
with `@IsOptional() @IsAppLogo()`.

**`AppsService`**:
- `formatApp` includes `logo: a.logo ?? null`.
- `createApp` persists `dto.logo ?? null`.
- `updateApp` persists `logo` when present in the patch (same
  present-vs-omitted handling as the other optional fields), and clearing is
  `logo: null`.

**`RegistrationService.getAppName`** (backs `GET /api/register/app`, used by
the signup page) — select and return `logo` alongside the existing fields.

**`SocialService.listForApp`** (backs `GET /api/social-providers`, used by
the login page) — the app lookup this method already performs additionally
selects `logo`; the method returns `{ providers, logo }` instead of a bare
array. Unknown/absent `client_id` yields `logo: null`, matching today's
`providers: []` behavior — no new enumeration signal.

`SocialController.list` return type becomes
`Promise<{ providers: string[]; logo: string | null }>`.

## Admin console

**`apps/admin/lib/types.ts`** — `App`, `CreateAppPayload`, `UpdateAppPayload`
gain `logo?: string | null`.

**`AppCreateDrawer` / `AppEditDrawer`** — new field, placed after the URL
field:

- `<input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml">`
- On change: validate via `APP_LOGO_ALLOWED_MIME_TYPES` / `APP_LOGO_MAX_BYTES`
  before reading; on failure show `apps.errors.logoInvalidType` /
  `apps.errors.logoTooLarge` inline, same placement as the existing
  `errorKey` paragraph.
- On success: `FileReader.readAsDataURL`, store the resulting data URI in
  component state (`logo: string | null`), show a small preview thumbnail
  next to the input.
- A "Remove logo" button (visible when a logo is set) clears state to `null`.
- Included in the `createAppAction` / `updateAppAction` payload like the
  other fields.

No new translation namespace — new keys added under the existing
`apps.fields.*` / `apps.errors.*` trees (`logo`, `logoHint`, `changeLogo`,
`removeLogo`, `logoInvalidType`, `logoTooLarge`) in both `en.json` and
`fr.json`.

## Sign in / sign up rendering

**`packages/ui/src/components/auth-card.tsx`** — new prop
`logoUrl?: string | null`. When set, renders a capped-height image
(`max-h-12 object-contain`, centered) above the title, in the header block.
This is additive to the existing `icon` prop (unchanged, still used by the
signup page's invalid-link error state) — `logoUrl` and `icon` render in
different states so no conflict.

**Signup (`apps/admin/app/signup/page.tsx`)** — `fetchAppInfo` already calls
`GET /api/register/app`; its return type gains `logo`, passed to
`<AuthCard logoUrl={logo} ...>`.

**Login (`apps/admin/lib/social-providers.ts`)** — `fetchSocialProviders`
renamed in effect to return `{ providers, logo }` instead of `string[]`
(call sites updated). `LoginPage` passes `logo` through to `LoginForm`,
which passes it to `<AuthCard logoUrl={logo} ...>`.

When there's no `client_id` in scope, both pages behave exactly as today
(signup already hard-requires `client_id`; login's `logo` is simply `null`
when `next` carries no `client_id`).

## Out of scope

- No logo resizing/cropping UI — admins upload an already-sized image.
- No CDN/object storage — base64-in-Postgres only, per the request.
- No dedicated logo-removal audit/history beyond the existing app edit
  audit trail (if any).
