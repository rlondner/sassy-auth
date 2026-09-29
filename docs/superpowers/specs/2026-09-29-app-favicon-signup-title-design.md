# Per-app favicon + dynamic signup/login tab title — design

**Date:** 2026-09-29
**Status:** approved design, no implementation plan yet
**Scope:** (1) the `/signup` page's browser tab title shows `"{appName} Sign
Up"` instead of the static `"SassyAuth Admin"` console title when signing up
for a specific app; (2) the `/login` page's browser tab title shows
`"{appName} Sign In"` when the login is for a specific app — including a
resource server registered as an `SaApp`, reached via
`/login?next=<authorize URL carrying client_id>`; (3) a new `favicon` image
property on `SaApp`, uploaded from the app create/edit drawer next to the
existing `Logo` field, shown as the browser tab icon on both pages above for
that app.

Out of scope: any other auth page (`/login/two-factor`, `/login/code`,
`/forgot-password`, `/reset-password`, `/accept-invite`) keeps its current
static title/favicon behavior. This spec only touches `/signup` and `/login`.

---

## 1. Problem and stance

Today `apps/admin/app/layout.tsx` sets a single static
`metadata.title = 'SassyAuth Admin'` for the whole admin console, and no
favicon file exists anywhere in the app (no `favicon.ico`, no `app/icon.tsx`
— the browser shows its own default). Both `/signup` (reached via
`?client_id=<app>`) and `/login` (reached directly, or via
`?next=<authorize URL carrying client_id>` when a resource server registered
as an `SaApp` bounces a user here to sign in) are end-user-facing per app, so
showing internal console branding in the tab, and no per-app favicon, is a
rough edge for apps embedding either flow. `login-form.tsx` already
recognizes this for the on-page title — it hides the `"Admin Console"`
`AuthCard` title whenever a `client_id` is resolved out of `next`, with the
same rationale this spec extends to the browser tab.

`SaApp` already has an identical precedent for an uploaded image: `logo`
(`packages/db/schema.prisma`), stored as a full base64 data URI, validated by
a shared `packages/types` rule (`APP_LOGO_MAX_BYTES` / `APP_LOGO_ALLOWED_MIME_TYPES`
/ `isValidAppLogoDataUri`) enforced identically client- and server-side, fed
through `AppLogoField` in the create/edit drawers, and surfaced publicly via
`registration.service.ts`'s `getAppName()` → `fetchAppInfo()` →
`signup/page.tsx`'s `logoUrl`. This spec adds `favicon` as a second field
following that exact same path, reusing the same size/type rule (confirmed:
same 250KB cap, same PNG/JPEG/WebP/SVG allow-list — no favicon-specific
tightening), and adds a `generateMetadata` export on the signup page for the
title + icon.

## 2. Schema change (`packages/db/schema.prisma`)

```prisma
model SaApp {
  // ...existing fields...
  /// Full data URI (e.g. "data:image/png;base64,...."). null = no logo set.
  logo        String?
  /// Full data URI. null = no favicon set; the signup page falls back to
  /// the browser's default icon (no site-wide favicon exists to fall back to).
  favicon     String?
}
```

Nullable, no default, no migration data backfill needed (every existing row
gets `null`).

## 3. Shared validation (`packages/types/index.ts`)

Same rule as the logo, exposed as its own named export so call sites read
clearly (`IsAppFavicon`, `AppFaviconField`, etc., not a generic "image"
concept leaking into unrelated call sites). Refactor the existing
byte/type-check logic into a private helper parameterized by allow-list and
max bytes, then define both public checks in terms of it:

```ts
export const APP_LOGO_MAX_BYTES = 250 * 1024;
export const APP_LOGO_ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'] as const;

export const APP_FAVICON_MAX_BYTES = APP_LOGO_MAX_BYTES;
export const APP_FAVICON_ALLOWED_MIME_TYPES = APP_LOGO_ALLOWED_MIME_TYPES;

function isValidImageDataUri(value: unknown, allowedTypes: readonly string[], maxBytes: number): boolean {
  // body = today's isValidAppLogoDataUri implementation, generalized over
  // allowedTypes/maxBytes instead of the APP_LOGO_* constants directly
}

export function isValidAppLogoDataUri(value: unknown): boolean {
  return isValidImageDataUri(value, APP_LOGO_ALLOWED_MIME_TYPES, APP_LOGO_MAX_BYTES);
}

export function isValidAppFaviconDataUri(value: unknown): boolean {
  return isValidImageDataUri(value, APP_FAVICON_ALLOWED_MIME_TYPES, APP_FAVICON_MAX_BYTES);
}
```

`APP_FAVICON_MAX_BYTES`/`APP_FAVICON_ALLOWED_MIME_TYPES` are defined as
aliases of the logo constants (not independently duplicated values) so a
future change to the shared rule can't silently drift between the two.

## 4. Server: DTOs, decorator, persistence

- New `apps/auth-server/src/common/config/is-app-favicon.decorator.ts`:
  `IsAppFavicon()`, structurally identical to `IsAppLogo` but calling
  `isValidAppFaviconDataUri`.
- `create-app.dto.ts` / `update-app.dto.ts`: add
  `@IsOptional() @IsAppFavicon() favicon?: string | null;` next to the
  existing `logo` field, with the same doc comment style.
- `apps.service.ts`:
  - `AppRow` type: add `favicon?: string | null`.
  - `formatApp()`: add `favicon: a.favicon ?? null`.
  - `listApps` (the bulk list query at the `formatApp(r), logo: null`
    call site): add `favicon: null` there too — same reasoning as the
    existing comment (don't pull every row's base64 blob into a paginated
    list response). Single-row reads (`getApp`, `createApp`, `updateApp`)
    keep returning it, exactly mirroring `logo`.
  - `createApp`: pass `favicon: dto.favicon ?? null` into the Prisma
    `data` object next to `logo`.
  - `updateApp`: add `favicon` to the "at least one field provided" dto-key
    check and to the conditional patch spread (`...(dto.favicon !== undefined && { favicon: dto.favicon })`).

## 5. Server: public app-info endpoint

`registration.service.ts`'s `getAppName()`:
- Add `favicon: true` to the Prisma `select`.
- Add `favicon: string | null` to the return type.
- Add `favicon: app.favicon ?? null` to the returned object.

`registration.controller.ts`'s `GET /api/register/app` passes the service
result straight through — no controller change needed beyond whatever
response-shape typing it has, which should widen automatically.

## 6. Server: public social-providers endpoint (for `/login`)

`/login` cannot use `getAppName()` — per the confirmed decision above, doing
so would apply that endpoint's rate-limited/404-on-unknown enumeration
trade-off to a much higher-traffic page. Instead, extend the already-public,
never-404s `GET /api/social-providers` (`social.controller.ts` /
`social.service.ts`) to also return `name` and `favicon`, following the
exact null-if-absent-or-unknown pattern it already uses for `logo` — this
does not change that endpoint's enumeration-safety posture (it already
returns 200 with `logo: null` for an unknown `client_id`; `name`/`favicon`
behave identically).

`social.service.ts`:
- Replace `getLogoForApp(clientId)` with a single
  `getBrandingForApp(clientId): Promise<{ name: string | null; logo: string | null; favicon: string | null }>`
  that does one `findUnique` selecting `name`, `logo`, `favicon` instead of
  three separate lookups. (Today there's only the one lookup for `logo`;
  this consolidates what would otherwise become three near-identical
  `findUnique` calls into one.)
- Same enumeration-safety rule as today: unknown/absent `clientId` → every
  field `null`, never a throw.

`social.controller.ts`'s `list()`:
```ts
async list(@Query('client_id') clientId?: string): Promise<{
  providers: string[]; logo: string | null; name: string | null; favicon: string | null
}> {
  const [providers, branding] = await Promise.all([
    this.social.listForApp(clientId),
    this.social.getBrandingForApp(clientId),
  ]);
  return { providers, ...branding };
}
```

`apps/admin/lib/social-providers.ts`'s `fetchSocialProviders()`: widen its
return type and JSON-body mapping to include `name: string | null` and
`favicon: string | null`, following the exact same `typeof body.x === 'string' ? ... : null` pattern already used for `logo`.

## 7. Admin UI: shared image-upload field

Generalize `apps/admin/components/app-logo-field.tsx` into
`apps/admin/components/app-image-field.tsx` exporting one parameterized
component:

```ts
interface AppImageFieldProps {
  value: string | null
  onValueChange: (next: string | null) => void
  label: string
  hint: string
  removeLabel: string
  invalidTypeErrorKey: string
  tooLargeErrorKey: string
  allowedMimeTypes: readonly string[]
  maxBytes: number
  inputId: string
}
export function AppImageField(props: AppImageFieldProps) { /* today's AppLogoField body, parameterized */ }
```

Then:
- `app-logo-field.tsx` keeps its existing default export `AppLogoField`, now
  a thin wrapper that calls `AppImageField` with the logo-specific props
  (`t('apps.fields.logo')`, `apps.errors.logoInvalidType`, etc.) — so every
  existing import of `AppLogoField` elsewhere keeps working unchanged.
- New `app-favicon-field.tsx` exports `AppFaviconField`, the same wrapper
  shape with favicon-specific props.

This keeps the two call sites in the drawers as simple, named,
single-purpose components (`<AppLogoField .../>`, `<AppFaviconField .../>`)
rather than a bag-of-props `<AppImageField field="favicon" .../>`, while the
~80 lines of upload/preview/remove/validate logic exist exactly once.

New translation keys (`en.json` + `fr.json`), mirroring the existing
`apps.fields.logo`/`logoHint`/`removeLogo` and
`apps.errors.logoInvalidType`/`logoTooLarge`:
- `apps.fields.favicon`, `apps.fields.faviconHint`, `apps.fields.removeFavicon`, `apps.fields.noFavicon`
- `apps.errors.faviconInvalidType`, `apps.errors.faviconTooLarge`

## 8. Admin UI: drawer wiring

`apps/admin/components/app-edit-drawer.tsx` and `app-create-drawer.tsx`, for
every place `logo`/`originalLogo` appears, add the `favicon` equivalent:
- State: `const [favicon, setFavicon] = React.useState<string | null>(app.favicon ?? null)` and `originalFavicon` baseline, following the same reset-on-app-change and reset-after-save effects `logo`/`originalLogo` already have.
- Dirty check: extend the big `dirty` boolean expression with `|| favicon !== originalFavicon`.
- Patch building: extend the patch type and `if (favicon !== originalFavicon) patch.favicon = favicon`.
- Render `<AppFaviconField value={favicon} onValueChange={setFavicon} />` immediately after `<AppLogoField .../>` in the form (same section, "next to Logo" per the request).

`apps/admin/lib/types.ts`: add `favicon?: string | null` to the same three
`App`-shaped interfaces that already carry `logo?: string | null`.

`apps/admin/components/app-view-drawer.tsx` (read-only view) already renders
a read-only logo preview (`displayApp.logo`, with an `apps.fields.noLogo`
empty state). Add the same block for `favicon` right after it: an
`apps.fields.favicon` label, an `<img>` preview when set, and a new
`apps.fields.noFavicon` translation key for the empty state.

## 9. Signup page: dynamic title + favicon

`apps/admin/lib/app-info.ts` `fetchAppInfo()`: add `favicon: string | null`
to its return type and the mapping from the endpoint's JSON body, following
the exact pattern of the existing `logo` field (including the same
fail-toward-`null` behavior on a non-OK response or thrown error).

`apps/admin/app/signup/page.tsx`: add

```ts
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ client_id?: string; next?: string }>
}): Promise<Metadata> {
  const { client_id: clientId } = await searchParams
  if (!clientId) return {}
  const { name: appName, favicon } = await fetchAppInfo(clientId)
  return {
    ...(appName && { title: `${appName} Sign Up` }),
    ...(favicon && { icons: { icon: favicon } }),
  }
}
```

- No `client_id` → returns `{}` → inherits the root layout's `"SassyAuth
  Admin"` title and no icon override (confirmed fallback for the
  invalid-link case).
- `client_id` present but app fetch fails/`name` is `null` → same: no title
  override, default console title.
- `favicon` present → sets the tab icon via Next.js's `Metadata.icons.icon`,
  which accepts a data URI directly.
- This calls `fetchAppInfo` a second time (once for metadata, once in the
  page body) — accepted, keeps the implementation straightforward rather
  than threading a cache/dedupe mechanism through for a single cheap
  same-request fetch.

## 10. Login page: dynamic title + favicon

`apps/admin/lib/social-providers.ts`'s `fetchSocialProviders()` already
resolves `client_id` out of `next` the same way `login-form.tsx`'s
client-side `clientIdFromNext()` does; per section 6 its return type now
also carries `name`/`favicon`.

`apps/admin/app/login/page.tsx`: add

```ts
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}): Promise<Metadata> {
  const { next } = await searchParams
  const nextSafe = validateNextUrl(next)
  if (!nextSafe) return {}
  const { name: appName, favicon } = await fetchSocialProviders(nextSafe)
  return {
    ...(appName && { title: `${appName} Sign In` }),
    ...(favicon && { icons: { icon: favicon } }),
  }
}
```

- No valid `next` (plain console login, or an untrusted/malformed `next`
  that `validateNextUrl` rejects) → `{}` → default `"SassyAuth Admin"` title,
  no icon override. Mirrors the signup page's no-`client_id` fallback.
- `next` present but its `client_id` doesn't resolve to a known app (or the
  app has no name somehow) → same fallback, since `fetchSocialProviders`
  yields `name: null` in that case, exactly like it does for `logo` today.
- This is a second call to `fetchSocialProviders` beyond the one
  `LoginPage`'s body already makes (for `providers`/`logo`) — same accepted
  trade-off as `/signup`'s double `fetchAppInfo` call (section 9).
- `login-form.tsx`'s existing client-side `clientIdFromNext()` /
  `AuthCard title={clientId ? undefined : t('title')}` logic is unrelated
  and unchanged — that controls the on-page `<CardTitle>`, this controls the
  browser tab; both now agree on hiding console branding for an app-scoped
  login, via two independent mechanisms that already existed for the logo
  case (server-fetched `fetchSocialProviders` vs. client-side
  `clientIdFromNext`).

## 11. Testing

- `packages/types`: unit tests for `isValidAppFaviconDataUri` — valid PNG,
  wrong mime type, over-size — mirroring the existing logo test cases.
- `apps/auth-server`: DTO validation tests for `favicon` in
  `apps/dto/app-dto.spec.ts` (covers both create/update DTOs today for
  `logo`); `registration.service.spec.ts` update asserting `getAppName()`
  returns `favicon`; `apps.service.spec.ts` and `apps.controller.spec.ts`
  extended for create/update/list behavior mirroring `logo`.
- `apps/admin`:
  - `components/__tests__/app-logo-field.test.tsx`: rename/retarget to
    `app-image-field.test.tsx` covering the generalized `AppImageField`
    component; keep a thin `AppLogoField`/`AppFaviconField` prop-wiring test
    in each of `app-logo-field.test.tsx` (kept, now trivial) and a new
    `app-favicon-field.test.tsx`.
  - `app-edit-drawer.test.tsx` / `app-create-drawer.test.tsx`: extend dirty
    state and patch-building assertions for `favicon`, mirroring `logo`
    cases.
  - `app-view-drawer.test.tsx`: extend for the new read-only favicon
    preview / empty state.
  - `lib/__tests__/app-info.test.ts`: extend for the new `favicon` field.
  - `app/signup/__tests__/page.test.tsx` (already exists from prior work
    this session): add cases for `generateMetadata` — title set when
    `appName` present, unset when absent; icon set when `favicon` present,
    unset when absent.
  - `lib/__tests__/social-providers.test.ts`: extend for the new
    `name`/`favicon` fields, including the unknown-`client_id` → all-null
    case.
  - New `app/login/__tests__/page.test.tsx` (no such file exists today —
    `LoginPage` currently has no dedicated page-level test, only
    `login-forms.test.tsx` for the client component): add `generateMetadata`
    cases mirroring signup's — title set when the resolved app has a name,
    unset when `next` is absent/invalid/unresolvable; icon set when
    `favicon` present.
- `apps/auth-server` social module: extend `social.service.spec.ts` /
  `social.controller.spec.ts` for `getBrandingForApp` and the widened
  `list()` response, including the unknown-`client_id` all-null case.

## 12. Non-goals / explicitly out of scope

- No favicon (or per-app title) support on `/login/two-factor`,
  `/login/code`, `/forgot-password`, `/reset-password`, `/accept-invite`, or
  any other page — only `/signup` and `/login`.
- No change to the site-wide default favicon (still none — untouched by
  this spec).
- No stricter/smaller favicon-specific validation rule — deliberately
  reuses the logo's rule byte-for-byte, per the confirmed decision above.
- No change to `/api/register/app`'s existing enumeration/rate-limit
  trade-off, and no reuse of it from `/login` — per the confirmed decision
  above, `/login` uses the already-public `/api/social-providers` instead.
