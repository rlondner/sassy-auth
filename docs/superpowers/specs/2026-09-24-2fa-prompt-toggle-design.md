# Disable the optional "Secure your account" 2FA prompt — design

**Date:** 2026-09-24
**Status:** approved design, no implementation plan yet
**Scope:** add a global (env var) and per-`SaApp` (nullable override) switch
that turns off the optional post-login 2FA setup interstitial entirely,
independent of the existing re-prompt interval (`twoFactorTrustDays`).

---

## 1. Problem and stance

`shouldPromptTwoFactor()` (`apps/auth-server/src/auth/should-prompt-two-factor.ts`,
mirrored client-side in `apps/admin/lib/two-factor-prompt.ts`) decides whether
to show the "Secure your account" interstitial after a successful password
login. Today the only knob is `intervalDays` (sourced from
`SaApp.twoFactorTrustDays` via `resolveTrustDays()`, falling back to the
`TWO_FACTOR_TRUST_DAYS` env var), which controls **how often** an unenrolled
user is re-prompted. It cannot disable the prompt: a user's very first login
always has `promptedAt === null`, which makes `shouldPromptTwoFactor` return
`true` regardless of `intervalDays`.

There is currently no way to turn the interstitial off, globally or per app.
This spec adds exactly that, following the existing tri-state pattern used by
`twoFactorTrustDays` (per-app nullable override falling back to a system
default) rather than inventing a new convention.

Out of scope: this only affects the *optional* setup nudge. It has no effect
on `SaApp.requireTwoFactor` (mandatory 2FA enforcement) — that's a distinct,
already-shipped control (`isTwoFactorRequired`, `token.controller.ts`) and is
untouched by this change.

## 2. Schema changes (`packages/db/schema.prisma`)

```prisma
model SaApp {
  // ...existing fields...
  twoFactorTrustDays    Int?
  twoFactorPromptEnabled Boolean? // null = inherit system default
}
```

Nullable, no `@default` — `null` means "inherit the system default,"
mirroring `twoFactorTrustDays`. New apps created via the admin UI default to
`null` (inherit).

## 3. System default (env var)

`TWO_FACTOR_PROMPT_ENABLED` (default `"true"`), read by a new
`getSystemPromptEnabled()` in `apps/auth-server/src/auth/resolve-trust-days.ts`,
parsed the same defensive way as `getSystemTrustDays()`:

```ts
export function getSystemPromptEnabled(): boolean {
  const raw = process.env['TWO_FACTOR_PROMPT_ENABLED'];
  if (raw === undefined || raw === '') return true;
  return raw.toLowerCase() !== 'false' && raw !== '0';
}
```

Anything other than an explicit `"false"`/`"0"` is treated as enabled — an
env var that's merely present-but-malformed should not silently disable the
prompt fleet-wide.

## 4. Resolution function

New `resolvePromptEnabled()` alongside `resolveTrustDays()` in the same file:

```ts
export function resolvePromptEnabled(
  app: { twoFactorPromptEnabled: boolean | null },
  systemDefault: boolean,
): boolean {
  return app.twoFactorPromptEnabled ?? systemDefault;
}
```

## 5. Decision function change

`shouldPromptTwoFactor()` gains one new required boolean param and a
top-of-function short-circuit — it stays a pure function, no env/DB access
inside it:

```ts
export interface ShouldPromptParams {
  twoFactorEnabled: boolean;
  promptedAt: Date | null;
  now: Date;
  intervalDays: number;
  promptEnabled: boolean; // NEW
}

export function shouldPromptTwoFactor({
  twoFactorEnabled,
  promptedAt,
  now,
  intervalDays,
  promptEnabled,
}: ShouldPromptParams): boolean {
  if (!promptEnabled) return false; // NEW, checked first
  if (twoFactorEnabled) return false;
  if (promptedAt === null) return true;
  const intervalMs = intervalDays * 24 * 60 * 60 * 1000;
  const elapsedMs = now.getTime() - promptedAt.getTime();
  return elapsedMs > intervalMs;
}
```

Same change applied to the client-side copy in
`apps/admin/lib/two-factor-prompt.ts` (kept in sync with the auth-server
version, as it already is today for `intervalDays`).

## 6. API wiring

`GET /api/token/app-trust-days` (`token.controller.ts`) response gains one
field. Route path is left unchanged (renaming it is an unrelated, separate
concern):

```ts
// before: { effectiveTrustDays: number }
// after:
{ effectiveTrustDays: number; promptEnabled: boolean }
```

```ts
async appTrustDays(@Query('client_id') clientId: string) {
  const systemDefault = getSystemTrustDays();
  const systemPromptEnabled = getSystemPromptEnabled();
  if (!clientId) return { effectiveTrustDays: systemDefault, promptEnabled: systemPromptEnabled };
  const app = await prisma.saApp.findUnique({
    where: { publicId: clientId },
    select: { twoFactorTrustDays: true, twoFactorPromptEnabled: true },
  });
  if (!app) return { effectiveTrustDays: systemDefault, promptEnabled: systemPromptEnabled };
  return {
    effectiveTrustDays: resolveTrustDays(app, systemDefault),
    promptEnabled: resolvePromptEnabled(app, systemPromptEnabled),
  };
}
```

`apps/admin/app/login/actions.ts` (`signIn` action) already fetches this
endpoint to resolve `intervalDays` when `next` carries a `client_id`. It reads
`promptEnabled` from the same response. Two cases:

- **`client_id` present and lookup succeeds:** use the returned
  `promptEnabled` (per-app resolved value).
- **No `client_id`, or the lookup fails/throws:** fall back to a client-side
  `getSystemPromptEnabledClient()` (mirrors the existing
  `getSystemTrustDaysClient()` — reads the same env var, exposed to the
  Next.js process). This preserves the existing fail-open-on-lookup-failure
  posture: an outage in the trust-days endpoint degrades to system-default
  behavior, not "prompt disabled" or "prompt forced on."

`create-app.dto.ts` / `update-app.dto.ts` gain:

```ts
@ValidateIf((o) => o.twoFactorPromptEnabled !== null && o.twoFactorPromptEnabled !== undefined)
@IsBoolean()
twoFactorPromptEnabled?: boolean | null;
```

`apps.service.ts` passes the field through on create/update exactly like
`twoFactorTrustDays` (a plain pass-through field, no derived logic at the
service layer — resolution only happens at read time via
`resolvePromptEnabled`).

`AppView`/`AppSummary` types (`apps/admin/lib/types.ts`) gain
`twoFactorPromptEnabled: boolean | null`.

## 7. Admin UI

Both `app-edit-drawer.tsx` and `app-create-drawer.tsx` get a new `Select`
(the existing shadcn `Select`/`SelectTrigger`/`SelectContent`/`SelectItem`
primitives already used for `defaultOrgId`/`defaultRoleId` in this file — not
a native `<select>` or checkbox), placed directly below the
`twoFactorTrustDays` input:

```tsx
<div>
  <Label htmlFor="twoFactorPromptEnabled">{t('apps.fields.twoFactorPromptEnabled')}</Label>
  <Select
    value={twoFactorPromptEnabled === null ? '__default__' : String(twoFactorPromptEnabled)}
    onValueChange={(v) =>
      setTwoFactorPromptEnabled(v === '__default__' ? null : v === 'true')
    }
  >
    <SelectTrigger id="twoFactorPromptEnabled">
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="__default__">{t('apps.fields.twoFactorPromptEnabledDefault')}</SelectItem>
      <SelectItem value="true">{t('apps.fields.twoFactorPromptEnabledOn')}</SelectItem>
      <SelectItem value="false">{t('apps.fields.twoFactorPromptEnabledOff')}</SelectItem>
    </SelectContent>
  </Select>
  <p className="mt-1 text-body-sm text-muted-foreground">
    {t('apps.fields.twoFactorPromptEnabledHint')}
  </p>
</div>
```

- State: `const [twoFactorPromptEnabled, setTwoFactorPromptEnabled] = React.useState<boolean | null>(app.twoFactorPromptEnabled ?? null)`, following the exact `twoFactorTrustDays` pattern (reset on `app` change, included in `dirty`, included in the submit `patch`).
- Create drawer: same control, defaulted to `null` (no `app` to read from).
- The "use system default" option label includes the *current effective* system value, e.g. `apps.fields.twoFactorPromptEnabledDefault` renders as "Use system default (currently: On)" — the edit drawer already has the data needed for this (or it can be a static "Use system default" label if threading the live system value into the drawer is awkward; **implementation plan should confirm which is feasible** given what data the drawer already receives as props).
- `app-view-drawer.tsx`: read-only equivalent, three possible displayed states matching the select's options.

New i18n keys in `en.json`/`fr.json` under `apps.fields`:
`twoFactorPromptEnabled`, `twoFactorPromptEnabledDefault`,
`twoFactorPromptEnabledOn`, `twoFactorPromptEnabledOff`,
`twoFactorPromptEnabledHint`.

## 8. Testing

- `resolve-trust-days.spec.ts`: add cases for `getSystemPromptEnabled()` (unset/empty → true, `"false"`/`"0"` → false, anything else → true) and `resolvePromptEnabled()` (null → system default, explicit true/false → override).
- `should-prompt-two-factor.spec.ts`: add cases where `promptEnabled: false` short-circuits to `false` regardless of the other params (including the `promptedAt: null` case that would otherwise return `true`).
- `apps/admin/lib/__tests__/two-factor-prompt.test.ts`: same short-circuit cases for the client-side copy.
- `app-dto.spec.ts`: validation cases for `twoFactorPromptEnabled` (accepts `true`/`false`/`null`/undefined, rejects non-boolean).
- `apps.service.spec.ts`: field passes through on create/update.
- `app-edit-drawer.test.tsx` / `app-create-drawer.test.tsx`: select renders three options, changing it marks the form dirty, submit includes it in the patch only when changed.
- E2E (`apps/admin-e2e/tests/two-factor.spec.ts` or `2fa-enforcement.spec.ts`): a case with an app whose `twoFactorPromptEnabled` is `false` — login as an unenrolled user does not redirect to `/login/two-factor-prompt`.

## 9. Migration

New Prisma migration adding the nullable `twoFactorPromptEnabled` column to
`SaApp`. Purely additive, no backfill needed (nullable, existing rows read as
"inherit system default" = today's behavior unchanged).
