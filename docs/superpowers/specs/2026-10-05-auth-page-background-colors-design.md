# Per-app background color overrides on sign in / sign up

## Problem

Admins can already brand an app's hosted login/signup page with a logo and
favicon, but the page/card background colors are fixed to the platform's
default light/dark theme. Admins should be able to override the page
background and card background independently for light and dark mode.

## Data model

Add 4 nullable columns to `SaApp`:

```prisma
model SaApp {
  ...
  /// 6-digit hex (e.g. "#0F172A"). null = use the default theme background.
  pageLightBackgroundColor String?
  pageDarkBackgroundColor  String?
  cardLightBackgroundColor String?
  cardDarkBackgroundColor  String?
}
```

Each of the 4 is independent — an admin may set only one and leave the other
three `null`. `null` means "use today's `--background`/`--card` CSS variable
default" (see `packages/ui/globals.css`).

## Validation

Server-side: `class-validator`'s built-in `@IsHexColor()` on each field in
`CreateAppDto` / `UpdateAppDto` (no custom decorator needed, unlike
`logo`/`favicon`). `null` clears the override.

Client-side (admin console): `/^#[0-9A-Fa-f]{6}$/` before submit, same inline
error placement pattern as the existing logo/favicon fields.

## Rendering (`packages/ui/src/components/auth-card.tsx`)

`AuthCard` gains 4 new optional props, all `string | null | undefined`:
`pageLightBackgroundColor`, `pageDarkBackgroundColor`,
`cardLightBackgroundColor`, `cardDarkBackgroundColor`.

When any are set, `AuthCard` renders a small scoped `<style>` block (SSR-safe,
no FOUC, no client JS) instead of relying on the `bg-background`/`bg-card`
Tailwind utility classes for the overridden piece:

```css
[data-auth-page-bg] { background-color: var(--auth-page-bg-light, <default>); }
.dark [data-auth-page-bg] { background-color: var(--auth-page-bg-dark, <default>); }
[data-auth-card-bg] { background-color: var(--auth-card-bg-light, <default>); }
.dark [data-auth-card-bg] { background-color: var(--auth-card-bg-dark, <default>); }
```

The hex values are passed as inline CSS custom properties on the page wrapper
`div` and the `Card`. This mirrors the existing `.dark` class toggle already
applied to `<html>` by `next-themes` (`attribute="class"` in
`apps/admin/components/theme-provider.tsx`), so `defaultTheme="system"`
continues to work with zero extra client-side logic. A color that isn't set
leaves that element on its existing `bg-background`/`bg-card` class —
fully backward compatible.

## Backend: branding lookups

No new endpoints. Extend 3 existing per-app lookups to include the 4 color
fields, alongside the fields they already return:

1. **`GET /api/register/app?client_id=...`**
   (`RegistrationService.getAppName`, backs `/signup`).
2. **`GET /api/social-providers?client_id=...`**
   (`SocialService.listForApp`, backs `/login`). Already overloaded to
   return branding (`logo`, `name`, `favicon`) beyond just `providers` — this
   becomes the general-purpose "branding by client_id" source reused by every
   page below that has only a `client_id` and no richer existing fetch
   (check-email, verified, login/code, two-factor, two-factor-prompt,
   forgot-password). Wrapped by a new `apps/admin/lib/app-branding.ts`
   (`fetchAppBranding(clientId)`), used alongside — not replacing —
   `fetchSocialProviders` (which still also needs `providers`).
3. **`resolveAppForResetToken`** (`apps/auth-server/src/auth/resolve-app-for-reset-token.ts`)
   — already resolves `SaApp` from a reset token for
   `passwordPolicyOverride`; extend its `select` to include the 4 color
   fields, and extend the endpoint behind `getPasswordPolicyForResetToken`
   (`apps/admin/lib/api-public.ts`) to return them.

`AppsService.formatApp` includes all 4 fields (`?? null`); `createApp` /
`updateApp` persist them with the same present-vs-omitted handling as the
other optional fields.

## Page-by-page plumbing

All lookups are best-effort: a missing identifier or any fetch failure
silently falls back to default theme colors, matching how logo/favicon
already fail open.

| Page | App-context source | Change |
|---|---|---|
| `/login` | `client_id` parsed from `next` (`fetchSocialProviders`, already does this) | Add colors to response; thread through `LoginForm` → `AuthCard` |
| `/signup` | `client_id` query param (already read) | Add colors to `fetchAppInfo`; thread through `signup-wizard-card.tsx` → `AuthCard` |
| `/signup/check-email` | `clientId` query param — already sent by `signup-form.tsx`'s redirect, but ignored by `check-email/page.tsx` today | Read `clientId` from `searchParams`; call `fetchAppBranding`; pass to `AuthCard` (both the `!email` branch and via `CheckEmailCard`) |
| `/signup/verified` + `link-expired-card` | Not available today — the verification-link `callbackURL` built in `registration.service.ts` / `users.service.ts` carries only `email` | Add `client_id` to that `callbackURL`; `verified/page.tsx` reads it, calls `fetchAppBranding` |
| `/login/code` (OTP) | `next` → `client_id`, via a `clientIdFromNext` helper extracted from `login-form.tsx` into a shared lib | Fetch + pass colors into `LoginOtpForm` → `AuthCard` |
| `/login/two-factor` | `next` → `client_id` (same shared helper) | Same pattern |
| `/login/two-factor-prompt` | `next` → `client_id` (same shared helper) | Same pattern |
| `/login/consent` | `appPublicId` query param (already present; `SaApp.publicId` is the same identifier as `client_id`) | Fetch branding by `appPublicId`; pass to `AuthCard` |
| `/forgot-password` | Not available today, zero params | `login-form.tsx`'s existing `/forgot-password` link gains `?client_id=...` (best-effort, mirroring the signup link beside it); page reads it if present and fetches branding — direct/bookmarked visits with no param get default colors |
| `/reset-password` | `token` → `resolveAppForResetToken` (already exists) | Extend `select` + `getPasswordPolicyForResetToken` response to include colors |

## Admin console

`apps/admin/lib/types.ts` — `App`, `CreateAppPayload`, `UpdateAppPayload`
gain the 4 optional fields.

`AppCreateDrawer` / `AppEditDrawer` — new "Background colors" subsection
after the existing logo/favicon fields: 4 paired `<input type="color">`
swatch + hex text field controls (Page background light/dark, Card
background light/dark), each with a "Reset to default" action that clears to
`null`. Client-side hex regex validation before submit, inline error reuse of
the existing `errorKey` paragraph pattern.

`AppViewDrawer` — shows the 4 swatches read-only (colored dot + hex value)
when set; omitted entirely when unset.

New i18n keys added under the existing `apps.fields.*` / `apps.errors.*`
trees in both `en.json` and `fr.json` (e.g. `pageLightBackgroundColor`,
`pageLightBackgroundColorHint`, `invalidHexColor`) — no new namespace.

## Out of scope

- No contrast/accessibility validation (e.g. warning on low-contrast
  page/card + text combinations) — admin is trusted, same level as logo.
- No live preview of the actual login/signup page in the admin drawer beyond
  the color swatches themselves.
- No extension to AuthCard-adjacent surfaces outside the auth flow (e.g. the
  admin console's own dashboard) — sign-in/sign-up and their directly
  reachable sub-flows only.
- No alpha/transparency — solid 6-digit hex only, per `@IsHexColor()`.
- No dedicated audit history for color changes beyond whatever general
  app-edit audit trail already exists, matching the logo precedent.
