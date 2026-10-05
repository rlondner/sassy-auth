# Per-app sign in/sign up background color overrides Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins override the page background and card background colors (independently for light/dark mode) on an app's hosted sign-in/sign-up flow and every reachable sub-page of it.

**Architecture:** 4 new nullable hex-string columns on `SaApp`. `AuthCard` renders them via a scoped inline `<style>` block keyed off the existing `.dark` class on `<html>` (no new client JS). Three existing per-app lookups (signup's `getAppName`, login's `getBrandingForApp`, reset-password's `resolveAppForResetToken`) are extended to return the 4 colors; a new `fetchAppBranding` admin-console helper (wrapping `GET /api/social-providers`) covers every page that only has a `client_id`/`appPublicId` and no richer existing fetch. A `clientIdFromNext` helper is extracted so OTP/two-factor/two-factor-prompt can derive `client_id` the same way login already does.

**Tech Stack:** NestJS (auth-server), Prisma/Postgres, Next.js App Router (admin console), class-validator, Tailwind/shadcn UI, Jest/Testing Library.

---

## Task 1: Database migration — 4 color columns on `SaApp`

**Files:**
- Modify: `packages/db/schema.prisma`
- Create: `packages/db/migrations/20261005120000_add_app_background_colors/migration.sql`

- [ ] **Step 1: Add the 4 fields to the Prisma schema**

In `packages/db/schema.prisma`, inside `model SaApp`, immediately after the `favicon` field (and its doc comment), add:

```prisma
  /// 6-digit hex (e.g. "#0F172A"). null = use the default theme background.
  /// Overrides the page's background on sign in/sign up (light mode).
  pageLightBackgroundColor String?
  /// Same as pageLightBackgroundColor, for dark mode.
  pageDarkBackgroundColor  String?
  /// Same as pageLightBackgroundColor, but for the card, not the page.
  cardLightBackgroundColor String?
  /// Same as cardLightBackgroundColor, for dark mode.
  cardDarkBackgroundColor  String?
```

- [ ] **Step 2: Write the migration SQL**

Create `packages/db/migrations/20261005120000_add_app_background_colors/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "SaApp" ADD COLUMN     "pageLightBackgroundColor" TEXT,
ADD COLUMN     "pageDarkBackgroundColor" TEXT,
ADD COLUMN     "cardLightBackgroundColor" TEXT,
ADD COLUMN     "cardDarkBackgroundColor" TEXT;
```

- [ ] **Step 3: Apply the migration and regenerate the Prisma client**

Run: `cd packages/db && npx prisma migrate deploy && npx prisma generate`
Expected: migration `20261005120000_add_app_background_colors` applied, Prisma client regenerated with the 4 new fields on `SaApp`.

- [ ] **Step 4: Commit**

```bash
git add packages/db/schema.prisma packages/db/migrations/20261005120000_add_app_background_colors
git commit -m "feat(db): add per-app background color override columns"
```

---

## Task 2: `AuthCard` renders the override colors

**Files:**
- Modify: `packages/ui/src/components/auth-card.tsx`
- Test: `packages/ui/src/__tests__/auth-card.test.tsx`

- [ ] **Step 1: Write the failing test**

Open `packages/ui/src/__tests__/auth-card.test.tsx` and add (following the existing test style in that file):

```tsx
it('renders a scoped style block with the light/dark overrides when background colors are set', () => {
  const { container } = render(
    <AuthCard
      title="Hi"
      pageLightBackgroundColor="#111111"
      pageDarkBackgroundColor="#222222"
      cardLightBackgroundColor="#333333"
      cardDarkBackgroundColor="#444444"
    />,
  )
  const style = container.querySelector('style')
  expect(style).not.toBeNull()
  expect(style?.textContent).toContain('#111111')
  expect(style?.textContent).toContain('#222222')
  expect(style?.textContent).toContain('#333333')
  expect(style?.textContent).toContain('#444444')
  expect(container.querySelector('[data-auth-page-bg]')).not.toBeNull()
  expect(container.querySelector('[data-auth-card-bg]')).not.toBeNull()
})

it('renders no style block and no data attributes when no background colors are set', () => {
  const { container } = render(<AuthCard title="Hi" />)
  expect(container.querySelector('style')).toBeNull()
  expect(container.querySelector('[data-auth-page-bg]')).toBeNull()
  expect(container.querySelector('[data-auth-card-bg]')).toBeNull()
})

it('only emits the page override when only page colors are set', () => {
  const { container } = render(
    <AuthCard title="Hi" pageLightBackgroundColor="#111111" pageDarkBackgroundColor="#222222" />,
  )
  expect(container.querySelector('[data-auth-page-bg]')).not.toBeNull()
  expect(container.querySelector('[data-auth-card-bg]')).toBeNull()
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/ui && npx jest src/__tests__/auth-card.test.tsx -t "background"`
Expected: FAIL — `pageLightBackgroundColor` etc. are not valid `AuthCard` props yet / no `<style>` is rendered.

- [ ] **Step 3: Implement the color override rendering**

Replace the full contents of `packages/ui/src/components/auth-card.tsx` with:

```tsx
import * as React from 'react'
import { cn } from '../lib/utils'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './ui/card'

export interface AuthCardProps {
  title?: string
  subtitle?: string
  icon?: React.ReactNode
  logoUrl?: string | null
  /**
   * Accessible alt text for the logo image. `packages/ui` is a shared
   * component package with no i18n of its own, so callers on localized
   * pages (admin console's `/login` and `/signup`) must pass a translated
   * string here rather than this component hardcoding English. Defaults to
   * `''` (decorative/silent) for callers that don't provide one.
   */
  logoAlt?: string
  footer?: React.ReactNode
  className?: string
  children?: React.ReactNode
  /**
   * Per-app page/card background color overrides (6-digit hex), independent
   * per light/dark mode. Any combination may be set; an unset one falls
   * back to the existing bg-background/bg-card theme default. Rendered via
   * a scoped <style> block keyed off the `.dark` class next-themes already
   * applies to <html> (see theme-provider.tsx), so this needs no client JS
   * and has no FOUC.
   */
  pageLightBackgroundColor?: string | null
  pageDarkBackgroundColor?: string | null
  cardLightBackgroundColor?: string | null
  cardDarkBackgroundColor?: string | null
}

export function AuthCard({
  title,
  subtitle,
  icon,
  logoUrl,
  logoAlt = '',
  footer,
  className,
  children,
  pageLightBackgroundColor,
  pageDarkBackgroundColor,
  cardLightBackgroundColor,
  cardDarkBackgroundColor,
}: AuthCardProps) {
  const hasHeader = Boolean(title || subtitle || icon || logoUrl)
  const hasPageOverride = Boolean(pageLightBackgroundColor || pageDarkBackgroundColor)
  const hasCardOverride = Boolean(cardLightBackgroundColor || cardDarkBackgroundColor)

  const pageStyle: React.CSSProperties = hasPageOverride
    ? ({
        ...(pageLightBackgroundColor && { '--auth-page-bg-light': pageLightBackgroundColor }),
        ...(pageDarkBackgroundColor && { '--auth-page-bg-dark': pageDarkBackgroundColor }),
      } as React.CSSProperties)
    : {}
  const cardStyle: React.CSSProperties = hasCardOverride
    ? ({
        ...(cardLightBackgroundColor && { '--auth-card-bg-light': cardLightBackgroundColor }),
        ...(cardDarkBackgroundColor && { '--auth-card-bg-dark': cardDarkBackgroundColor }),
      } as React.CSSProperties)
    : {}

  return (
    <div
      className={cn('flex min-h-screen items-center justify-center p-6', !hasPageOverride && 'bg-background')}
      {...(hasPageOverride ? { 'data-auth-page-bg': '' } : {})}
      style={pageStyle}
    >
      {(hasPageOverride || hasCardOverride) && (
        <style>
          {hasPageOverride &&
            `[data-auth-page-bg]{background-color:var(--auth-page-bg-light,hsl(var(--background)));}` +
              `.dark [data-auth-page-bg]{background-color:var(--auth-page-bg-dark,hsl(var(--background)));}`}
          {hasCardOverride &&
            `[data-auth-card-bg]{background-color:var(--auth-card-bg-light,hsl(var(--card)));}` +
              `.dark [data-auth-card-bg]{background-color:var(--auth-card-bg-dark,hsl(var(--card)));}`}
        </style>
      )}
      <Card
        className={cn('w-full max-w-sm', !hasCardOverride && 'bg-card', className)}
        {...(hasCardOverride ? { 'data-auth-card-bg': '' } : {})}
        style={cardStyle}
      >
        {hasHeader && (
          <CardHeader className="text-center">
            {logoUrl && (
              <div className="mb-4 flex justify-center">
                <img src={logoUrl} alt={logoAlt} className="max-h-12 object-contain" />
              </div>
            )}
            {icon && <div className="mb-4 flex justify-center">{icon}</div>}
            {title && <CardTitle className="text-headline-sm">{title}</CardTitle>}
            {subtitle && <CardDescription className="mt-1 text-body-sm">{subtitle}</CardDescription>}
          </CardHeader>
        )}
        {children && <CardContent className={hasHeader ? undefined : 'pt-6'}>{children}</CardContent>}
        {footer && <CardFooter className="flex flex-col gap-2 pt-0">{footer}</CardFooter>}
      </Card>
    </div>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/ui && npx jest src/__tests__/auth-card.test.tsx`
Expected: PASS (all tests, including the 3 new ones and the pre-existing ones — `bg-background`/`bg-card` classes are preserved when no override is set, so nothing else in this file should break).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/auth-card.tsx packages/ui/src/__tests__/auth-card.test.tsx
git commit -m "feat(ui): AuthCard renders per-app page/card background color overrides"
```

---

## Task 3: `UpdateAppDto`/`CreateAppDto` accept the 4 hex colors

**Files:**
- Modify: `apps/auth-server/src/apps/dto/update-app.dto.ts`
- Modify: `apps/auth-server/src/apps/dto/create-app.dto.ts`

- [ ] **Step 1: Add the fields to `UpdateAppDto`**

In `apps/auth-server/src/apps/dto/update-app.dto.ts`, change the import line to add `IsHexColor`:

```ts
import { IsArray, IsBoolean, IsEnum, IsHexColor, IsInt, IsOptional, IsPositive, IsString, Max, MaxLength, MinLength, ValidateIf } from 'class-validator';
```

Then, immediately after the `favicon` field (right before the `twoFactorTrustDays` doc comment), add:

```ts
  /**
   * 6-digit hex (e.g. "#0F172A"). null clears the override, reverting to
   * the default theme background. Independent of the other 3 color fields.
   */
  @IsOptional() @IsHexColor() pageLightBackgroundColor?: string | null;
  @IsOptional() @IsHexColor() pageDarkBackgroundColor?: string | null;
  @IsOptional() @IsHexColor() cardLightBackgroundColor?: string | null;
  @IsOptional() @IsHexColor() cardDarkBackgroundColor?: string | null;
```

- [ ] **Step 2: Add the fields to `CreateAppDto`**

In `apps/auth-server/src/apps/dto/create-app.dto.ts`, change the import line:

```ts
import { IsArray, IsBoolean, IsHexColor, IsInt, IsOptional, IsPositive, IsString, Max, MaxLength, MinLength, ValidateIf } from 'class-validator';
```

Then, immediately after the `favicon` field, add:

```ts
  /**
   * 6-digit hex (e.g. "#0F172A"). Omitted or null means no override —
   * the default theme background applies.
   */
  @IsOptional() @IsHexColor() pageLightBackgroundColor?: string | null;
  @IsOptional() @IsHexColor() pageDarkBackgroundColor?: string | null;
  @IsOptional() @IsHexColor() cardLightBackgroundColor?: string | null;
  @IsOptional() @IsHexColor() cardDarkBackgroundColor?: string | null;
```

- [ ] **Step 3: Commit**

```bash
git add apps/auth-server/src/apps/dto/update-app.dto.ts apps/auth-server/src/apps/dto/create-app.dto.ts
git commit -m "feat(auth-server): accept page/card background color overrides on app DTOs"
```

---

## Task 4: `AppsService` persists and returns the 4 colors

**Files:**
- Modify: `apps/auth-server/src/apps/apps.service.ts`
- Test: `apps/auth-server/src/apps/apps.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

Open `apps/auth-server/src/apps/apps.service.spec.ts`. Find the existing `createApp` test block that asserts `logo`/`favicon` pass through, and add a sibling test (following that file's existing mocking style — `prisma.saApp.create`/`update` mocks):

```ts
it('createApp persists and returns the 4 background color overrides', async () => {
  (prisma.saApp.create as jest.Mock).mockResolvedValue({ id: 1, publicId: 'pending' });
  (prisma.saApp.update as jest.Mock).mockResolvedValue({
    id: 1,
    publicId: 'abc',
    name: 'App',
    url: 'https://app.test',
    isPlatform: false,
    twoFactorTrustDays: null,
    twoFactorPromptEnabled: null,
    requireTwoFactor: false,
    allowOfflineAccess: false,
    pageLightBackgroundColor: '#111111',
    pageDarkBackgroundColor: '#222222',
    cardLightBackgroundColor: '#333333',
    cardDarkBackgroundColor: '#444444',
  });

  const result = await service.createApp('ba-1', {
    name: 'App',
    url: 'https://app.test',
    pageLightBackgroundColor: '#111111',
    pageDarkBackgroundColor: '#222222',
    cardLightBackgroundColor: '#333333',
    cardDarkBackgroundColor: '#444444',
  } as CreateAppDto);

  expect(result.pageLightBackgroundColor).toBe('#111111');
  expect(result.pageDarkBackgroundColor).toBe('#222222');
  expect(result.cardLightBackgroundColor).toBe('#333333');
  expect(result.cardDarkBackgroundColor).toBe('#444444');
});

it('updateApp persists the 4 background color overrides and clears them with null', async () => {
  (prisma.saApp.findUnique as jest.Mock).mockResolvedValue({
    id: 1, publicId: 'abc', isPlatform: false, redirectUris: [], defaultOrg: null, defaultRole: null,
  });
  (prisma.saApp.update as jest.Mock).mockResolvedValue({
    id: 1,
    publicId: 'abc',
    name: 'App',
    url: 'https://app.test',
    isPlatform: false,
    twoFactorTrustDays: null,
    twoFactorPromptEnabled: null,
    requireTwoFactor: false,
    allowOfflineAccess: false,
    defaultOrg: null,
    defaultRole: null,
    pageLightBackgroundColor: null,
    pageDarkBackgroundColor: null,
    cardLightBackgroundColor: null,
    cardDarkBackgroundColor: null,
  });

  const result = await service.updateApp('ba-1', 'abc', {
    pageLightBackgroundColor: null,
    pageDarkBackgroundColor: null,
    cardLightBackgroundColor: null,
    cardDarkBackgroundColor: null,
  } as UpdateAppDto);

  expect(prisma.saApp.update).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        pageLightBackgroundColor: null,
        pageDarkBackgroundColor: null,
        cardLightBackgroundColor: null,
        cardDarkBackgroundColor: null,
      }),
    }),
  );
  expect(result.pageLightBackgroundColor).toBeNull();
});
```

(Adjust the exact mock shape/imports to match whatever `prisma` mock and `CreateAppDto`/`UpdateAppDto` imports the top of this spec file already uses — this file already has equivalent tests for `logo`/`favicon`/`privacyPolicyUrl`; mirror those exactly for field names/mock structure.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/auth-server && npx jest src/apps/apps.service.spec.ts -t "background color"`
Expected: FAIL — `pageLightBackgroundColor` not present in `formatApp`'s output / not persisted.

- [ ] **Step 3: Implement — extend `AppRow`, `formatApp`, `createApp`, `updateApp`**

In `apps/auth-server/src/apps/apps.service.ts`:

Add to the `AppRow` type (after `favicon?: string | null;`):

```ts
  pageLightBackgroundColor?: string | null;
  pageDarkBackgroundColor?: string | null;
  cardLightBackgroundColor?: string | null;
  cardDarkBackgroundColor?: string | null;
```

Add to `formatApp`'s returned object (after `favicon: a.favicon ?? null,`):

```ts
    pageLightBackgroundColor: a.pageLightBackgroundColor ?? null,
    pageDarkBackgroundColor: a.pageDarkBackgroundColor ?? null,
    cardLightBackgroundColor: a.cardLightBackgroundColor ?? null,
    cardDarkBackgroundColor: a.cardDarkBackgroundColor ?? null,
```

In `createApp`, add to the `tx.saApp.create({ data: { ... } })` call (after `favicon: dto.favicon ?? null,`):

```ts
            pageLightBackgroundColor: dto.pageLightBackgroundColor ?? null,
            pageDarkBackgroundColor: dto.pageDarkBackgroundColor ?? null,
            cardLightBackgroundColor: dto.cardLightBackgroundColor ?? null,
            cardDarkBackgroundColor: dto.cardDarkBackgroundColor ?? null,
```

In `updateApp`, add to the big "at least one of" `undefined` check (after `dto.favicon === undefined &&`):

```ts
      dto.pageLightBackgroundColor === undefined &&
      dto.pageDarkBackgroundColor === undefined &&
      dto.cardLightBackgroundColor === undefined &&
      dto.cardDarkBackgroundColor === undefined &&
```

and update the error message string to append `, pageLightBackgroundColor, pageDarkBackgroundColor, cardLightBackgroundColor, cardDarkBackgroundColor` before the final `or emailVerificationMethod must be provided` text.

Add to the `tx.saApp.update({ data: { ... } })` call (after the `favicon` entry):

```ts
            ...(dto.pageLightBackgroundColor !== undefined && { pageLightBackgroundColor: dto.pageLightBackgroundColor }),
            ...(dto.pageDarkBackgroundColor !== undefined && { pageDarkBackgroundColor: dto.pageDarkBackgroundColor }),
            ...(dto.cardLightBackgroundColor !== undefined && { cardLightBackgroundColor: dto.cardLightBackgroundColor }),
            ...(dto.cardDarkBackgroundColor !== undefined && { cardDarkBackgroundColor: dto.cardDarkBackgroundColor }),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/auth-server && npx jest src/apps/apps.service.spec.ts`
Expected: PASS (all tests, including the 2 new ones).

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/apps/apps.service.ts apps/auth-server/src/apps/apps.service.spec.ts
git commit -m "feat(auth-server): persist and return per-app background color overrides"
```

---

## Task 5: Signup page gets colors via `getAppName` / `fetchAppInfo`

**Files:**
- Modify: `apps/auth-server/src/registration/registration.service.ts`
- Modify: `apps/admin/lib/app-info.ts`
- Modify: `apps/admin/app/signup/page.tsx`
- Modify: `apps/admin/app/signup/signup-wizard-card.tsx`
- Test: `apps/auth-server/src/registration/registration.service.spec.ts`
- Test: `apps/admin/lib/__tests__/app-info.test.ts`
- Test: `apps/admin/app/signup/__tests__/page.test.tsx`

- [ ] **Step 1: Write the failing backend test**

In `apps/auth-server/src/registration/registration.service.spec.ts`, find the existing `getAppName` describe block (it asserts `logo`/`favicon` pass through) and add:

```ts
it('getAppName includes the 4 background color overrides', async () => {
  (prisma.saApp.findUnique as jest.Mock).mockResolvedValue({
    name: 'App',
    defaultOrgId: null,
    passwordPolicyOverride: null,
    logo: null,
    favicon: null,
    privacyPolicyUrl: null,
    termsUrl: null,
    gdprUrl: null,
    emailVerificationMethod: 'link',
    pageLightBackgroundColor: '#111111',
    pageDarkBackgroundColor: '#222222',
    cardLightBackgroundColor: '#333333',
    cardDarkBackgroundColor: '#444444',
  });

  const result = await service.getAppName('app-1');

  expect(result.pageLightBackgroundColor).toBe('#111111');
  expect(result.pageDarkBackgroundColor).toBe('#222222');
  expect(result.cardLightBackgroundColor).toBe('#333333');
  expect(result.cardDarkBackgroundColor).toBe('#444444');
});
```

(Mirror this spec file's existing mock-building style for `prisma.saApp.findUnique` in its other `getAppName` tests.)

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/auth-server && npx jest src/registration/registration.service.spec.ts -t "background color"`
Expected: FAIL — `result.pageLightBackgroundColor` is `undefined`.

- [ ] **Step 3: Implement — extend `getAppName`**

In `apps/auth-server/src/registration/registration.service.ts`, extend `getAppName`'s return type (after `favicon: string | null;`):

```ts
    pageLightBackgroundColor: string | null;
    pageDarkBackgroundColor: string | null;
    cardLightBackgroundColor: string | null;
    cardDarkBackgroundColor: string | null;
```

Add the 4 fields to the `select` object (after `favicon: true,`):

```ts
        pageLightBackgroundColor: true,
        pageDarkBackgroundColor: true,
        cardLightBackgroundColor: true,
        cardDarkBackgroundColor: true,
```

Add to the returned object (after `favicon: app.favicon ?? null,`):

```ts
      pageLightBackgroundColor: app.pageLightBackgroundColor ?? null,
      pageDarkBackgroundColor: app.pageDarkBackgroundColor ?? null,
      cardLightBackgroundColor: app.cardLightBackgroundColor ?? null,
      cardDarkBackgroundColor: app.cardDarkBackgroundColor ?? null,
```

- [ ] **Step 4: Run the backend test to verify it passes**

Run: `cd apps/auth-server && npx jest src/registration/registration.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing admin-lib test**

In `apps/admin/lib/__tests__/app-info.test.ts`, add (mirroring the existing `logo`/`favicon` pass-through test):

```ts
it('passes through the 4 background color overrides', async () => {
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      name: 'App', hasDefaultOrg: false, logo: null, favicon: null,
      privacyPolicyUrl: null, termsUrl: null, gdprUrl: null, gdprRequired: false,
      emailVerificationMethod: 'link',
      pageLightBackgroundColor: '#111111',
      pageDarkBackgroundColor: '#222222',
      cardLightBackgroundColor: '#333333',
      cardDarkBackgroundColor: '#444444',
    }),
  })

  const result = await fetchAppInfo('client-1')

  expect(result.pageLightBackgroundColor).toBe('#111111')
  expect(result.pageDarkBackgroundColor).toBe('#222222')
  expect(result.cardLightBackgroundColor).toBe('#333333')
  expect(result.cardDarkBackgroundColor).toBe('#444444')
})

it('defaults the 4 background color overrides to null on fetch failure', async () => {
  mockFetch.mockResolvedValue({ ok: false })
  const result = await fetchAppInfo('client-1')
  expect(result.pageLightBackgroundColor).toBeNull()
  expect(result.cardDarkBackgroundColor).toBeNull()
})
```

(Match this test file's existing `mockFetch` setup exactly — it already mocks `global.fetch` for the other `fetchAppInfo` tests.)

- [ ] **Step 6: Run it to verify it fails**

Run: `cd apps/admin && npx jest lib/__tests__/app-info.test.ts -t "background color"`
Expected: FAIL.

- [ ] **Step 7: Implement — extend `fetchAppInfo`**

Replace the full contents of `apps/admin/lib/app-info.ts` with:

```ts
import 'server-only'
import type { PasswordPolicy } from './types'
import { getForwardedClientIpHeader } from './forward-client-ip'

const AUTH_SERVER = process.env.AUTH_SERVER_URL ?? 'https://localhost:3010'

export interface AppInfo {
  name: string | null; hasDefaultOrg: boolean; passwordPolicy: PasswordPolicy | null; logo: string | null;
  favicon: string | null;
  privacyPolicyUrl: string | null; termsUrl: string | null; gdprUrl: string | null; gdprRequired: boolean;
  emailVerificationMethod: 'link' | 'code';
  pageLightBackgroundColor: string | null;
  pageDarkBackgroundColor: string | null;
  cardLightBackgroundColor: string | null;
  cardDarkBackgroundColor: string | null;
}

const FAILSAFE: AppInfo = {
  name: null, hasDefaultOrg: false, passwordPolicy: null, logo: null, favicon: null,
  privacyPolicyUrl: null, termsUrl: null, gdprUrl: null, gdprRequired: false,
  emailVerificationMethod: 'link',
  pageLightBackgroundColor: null, pageDarkBackgroundColor: null,
  cardLightBackgroundColor: null, cardDarkBackgroundColor: null,
}

export async function fetchAppInfo(clientId: string): Promise<AppInfo> {
  try {
    const forwardedIp = await getForwardedClientIpHeader()
    const res = await fetch(`${AUTH_SERVER}/api/register/app?appPublicId=${encodeURIComponent(clientId)}`, {
      cache: 'no-store',
      headers: { ...forwardedIp },
    })
    if (!res.ok) {
      // Fail toward hasDefaultOrg: false, not true: a Company name field shown
      // but ignored by the server is harmless, whereas defaulting to true could
      // hide a required field and produce a signup-blocking dead end. Same
      // fail-safe reasoning for emailVerificationMethod: 'link' is the
      // existing, always-supported flow.
      return FAILSAFE
    }
    const body = (await res.json()) as {
      name?: string; hasDefaultOrg?: boolean; passwordPolicy?: PasswordPolicy; logo?: string | null; favicon?: string | null;
      privacyPolicyUrl?: string | null; termsUrl?: string | null; gdprUrl?: string | null; gdprRequired?: boolean;
      emailVerificationMethod?: 'link' | 'code';
      pageLightBackgroundColor?: string | null; pageDarkBackgroundColor?: string | null;
      cardLightBackgroundColor?: string | null; cardDarkBackgroundColor?: string | null;
    }
    return {
      name: typeof body.name === 'string' ? body.name : null,
      hasDefaultOrg: body.hasDefaultOrg === true,
      passwordPolicy: body.passwordPolicy ?? null,
      logo: typeof body.logo === 'string' ? body.logo : null,
      favicon: typeof body.favicon === 'string' ? body.favicon : null,
      privacyPolicyUrl: typeof body.privacyPolicyUrl === 'string' ? body.privacyPolicyUrl : null,
      termsUrl: typeof body.termsUrl === 'string' ? body.termsUrl : null,
      gdprUrl: typeof body.gdprUrl === 'string' ? body.gdprUrl : null,
      gdprRequired: body.gdprRequired === true,
      emailVerificationMethod: body.emailVerificationMethod === 'code' ? 'code' : 'link',
      pageLightBackgroundColor: typeof body.pageLightBackgroundColor === 'string' ? body.pageLightBackgroundColor : null,
      pageDarkBackgroundColor: typeof body.pageDarkBackgroundColor === 'string' ? body.pageDarkBackgroundColor : null,
      cardLightBackgroundColor: typeof body.cardLightBackgroundColor === 'string' ? body.cardLightBackgroundColor : null,
      cardDarkBackgroundColor: typeof body.cardDarkBackgroundColor === 'string' ? body.cardDarkBackgroundColor : null,
    }
  } catch {
    // Same reasoning as the !res.ok branch above: fail toward false/link.
    return FAILSAFE
  }
}
```

- [ ] **Step 8: Run the admin-lib test to verify it passes**

Run: `cd apps/admin && npx jest lib/__tests__/app-info.test.ts`
Expected: PASS.

- [ ] **Step 9: Wire the colors into the signup page and signup-wizard-card**

In `apps/admin/app/signup/page.tsx`, change the destructuring in `SignupPage` (currently `const { name: appName, hasDefaultOrg, passwordPolicy, logo, privacyPolicyUrl, termsUrl, gdprUrl, gdprRequired, emailVerificationMethod } = await fetchAppInfo(clientId)`) to:

```tsx
  const {
    name: appName, hasDefaultOrg, passwordPolicy, logo, privacyPolicyUrl, termsUrl, gdprUrl, gdprRequired,
    emailVerificationMethod,
    pageLightBackgroundColor, pageDarkBackgroundColor, cardLightBackgroundColor, cardDarkBackgroundColor,
  } = await fetchAppInfo(clientId)
```

Pass the 4 colors to `SignupWizardCard` (add after `logo={logo}`):

```tsx
        logo={logo}
        pageLightBackgroundColor={pageLightBackgroundColor}
        pageDarkBackgroundColor={pageDarkBackgroundColor}
        cardLightBackgroundColor={cardLightBackgroundColor}
        cardDarkBackgroundColor={cardDarkBackgroundColor}
```

Pass the 4 colors to the plain `<AuthCard>` branch below it (add after `logoAlt={appName ?? t('signup.title')}`):

```tsx
      logoAlt={appName ?? t('signup.title')}
      pageLightBackgroundColor={pageLightBackgroundColor}
      pageDarkBackgroundColor={pageDarkBackgroundColor}
      cardLightBackgroundColor={cardLightBackgroundColor}
      cardDarkBackgroundColor={cardDarkBackgroundColor}
```

In `apps/admin/app/signup/signup-wizard-card.tsx`, add the 4 props to `SignupWizardCardProps`:

```tsx
  pageLightBackgroundColor: string | null
  pageDarkBackgroundColor: string | null
  cardLightBackgroundColor: string | null
  cardDarkBackgroundColor: string | null
```

destructure them in the function signature, and pass them through to `<AuthCard>`:

```tsx
export function SignupWizardCard({
  clientId,
  next,
  hasDefaultOrg,
  passwordPolicy,
  privacyPolicyUrl,
  termsUrl,
  gdprUrl,
  appName,
  logo,
  pageLightBackgroundColor,
  pageDarkBackgroundColor,
  cardLightBackgroundColor,
  cardDarkBackgroundColor,
  footer,
}: SignupWizardCardProps) {
  const t = useTranslations('signup')
  const [step, setStep] = React.useState<Step>('email')

  const title = step === 'code' ? t('verifyCode.title') : appName ? t('titleWithApp', { appName }) : t('title')
  const subtitle =
    step === 'code' ? t('verifyCode.headerSubtitle') : hasDefaultOrg ? t('subtitleDefaultOrg') : t('subtitle')

  return (
    <AuthCard
      title={title}
      subtitle={subtitle}
      logoUrl={logo}
      logoAlt={appName ?? t('title')}
      footer={footer}
      pageLightBackgroundColor={pageLightBackgroundColor}
      pageDarkBackgroundColor={pageDarkBackgroundColor}
      cardLightBackgroundColor={cardLightBackgroundColor}
      cardDarkBackgroundColor={cardDarkBackgroundColor}
    >
```

(leave the rest of the file, including the closing `</AuthCard>` and `<SignupWizard>` body, unchanged).

- [ ] **Step 10: Update the existing signup page test fixtures**

In `apps/admin/app/signup/__tests__/page.test.tsx`, every mocked `fetchAppInfo` resolved value (search for `logo: null,`) needs the 4 new fields added alongside it, e.g.:

```ts
logo: null,
pageLightBackgroundColor: null,
pageDarkBackgroundColor: null,
cardLightBackgroundColor: null,
cardDarkBackgroundColor: null,
```

- [ ] **Step 11: Run the full signup page test suite**

Run: `cd apps/admin && npx jest app/signup/__tests__/page.test.tsx`
Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add apps/auth-server/src/registration/registration.service.ts apps/auth-server/src/registration/registration.service.spec.ts apps/admin/lib/app-info.ts apps/admin/lib/__tests__/app-info.test.ts apps/admin/app/signup/page.tsx apps/admin/app/signup/signup-wizard-card.tsx apps/admin/app/signup/__tests__/page.test.tsx
git commit -m "feat(signup): apply per-app background color overrides on the signup page"
```

---

## Task 6: Login page gets colors via `getBrandingForApp` / `fetchSocialProviders`

**Files:**
- Modify: `apps/auth-server/src/social/social.service.ts`
- Modify: `apps/auth-server/src/social/social.controller.ts`
- Modify: `apps/admin/lib/social-providers.ts`
- Modify: `apps/admin/app/login/login-form.tsx`
- Test: `apps/auth-server/src/social/social.service.spec.ts`
- Test: `apps/auth-server/src/social/social.controller.spec.ts`
- Test: `apps/admin/app/login/__tests__/login-forms.test.tsx`

- [ ] **Step 1: Write the failing `SocialService` test**

In `apps/auth-server/src/social/social.service.spec.ts`, find the `getBrandingForApp` describe block and add:

```ts
it('getBrandingForApp includes the 4 background color overrides', async () => {
  const db = {
    saApp: {
      findUnique: jest.fn().mockResolvedValue({
        id: 1, name: 'App', logo: null, favicon: null,
        pageLightBackgroundColor: '#111111',
        pageDarkBackgroundColor: '#222222',
        cardLightBackgroundColor: '#333333',
        cardDarkBackgroundColor: '#444444',
      }),
    },
    saSocialProvider: { findMany: jest.fn(), upsert: jest.fn() },
  };
  const service = new SocialService(db as never, {} as never);

  const result = await service.getBrandingForApp('client-1');

  expect(result.pageLightBackgroundColor).toBe('#111111');
  expect(result.pageDarkBackgroundColor).toBe('#222222');
  expect(result.cardLightBackgroundColor).toBe('#333333');
  expect(result.cardDarkBackgroundColor).toBe('#444444');
});

it('getBrandingForApp defaults the 4 background color overrides to null for an unknown client_id', async () => {
  const db = {
    saApp: { findUnique: jest.fn().mockResolvedValue(null) },
    saSocialProvider: { findMany: jest.fn(), upsert: jest.fn() },
  };
  const service = new SocialService(db as never, {} as never);

  const result = await service.getBrandingForApp('unknown');

  expect(result.pageLightBackgroundColor).toBeNull();
  expect(result.cardDarkBackgroundColor).toBeNull();
});
```

(Match this spec file's existing `new SocialService(mockDb, mockEnv)` construction style exactly — see the file's other `getBrandingForApp` tests.)

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/auth-server && npx jest src/social/social.service.spec.ts -t "background color"`
Expected: FAIL.

- [ ] **Step 3: Implement — extend `SocialService.getBrandingForApp`**

In `apps/auth-server/src/social/social.service.ts`, extend the `Db` type's `saApp.findUnique` return shape (after `favicon?: string | null`):

```ts
type Db = {
  saApp: { findUnique(args: unknown): Promise<{
    id: number; isPlatform?: boolean; name?: string | null; logo?: string | null; favicon?: string | null;
    pageLightBackgroundColor?: string | null; pageDarkBackgroundColor?: string | null;
    cardLightBackgroundColor?: string | null; cardDarkBackgroundColor?: string | null;
  } | null> };
  saSocialProvider: {
    findMany(args?: unknown): Promise<{ appId: number | null; provider: string; enabled: boolean }[]>;
    upsert(args: unknown): Promise<unknown>;
  };
};
```

Replace `getBrandingForApp` with:

```ts
  /**
   * The name, logo, favicon, and background color overrides to show on the
   * login/signup screen for this app, or all-null if the app has none of
   * these or the client_id is unknown/absent. Mirrors listForApp's
   * enumeration-safety rule: an unknown client_id yields all-null fields,
   * never a throw, so this stays indistinguishable from "app has none of
   * these set."
   */
  async getBrandingForApp(clientId: string | undefined): Promise<{
    name: string | null; logo: string | null; favicon: string | null;
    pageLightBackgroundColor: string | null; pageDarkBackgroundColor: string | null;
    cardLightBackgroundColor: string | null; cardDarkBackgroundColor: string | null;
  }> {
    const allNull = {
      name: null, logo: null, favicon: null,
      pageLightBackgroundColor: null, pageDarkBackgroundColor: null,
      cardLightBackgroundColor: null, cardDarkBackgroundColor: null,
    };
    if (!clientId) return allNull;
    const app = await this.db.saApp.findUnique({
      where: { publicId: clientId },
      select: {
        id: true, name: true, logo: true, favicon: true,
        pageLightBackgroundColor: true, pageDarkBackgroundColor: true,
        cardLightBackgroundColor: true, cardDarkBackgroundColor: true,
      },
    });
    return {
      name: app?.name ?? null,
      logo: app?.logo ?? null,
      favicon: app?.favicon ?? null,
      pageLightBackgroundColor: app?.pageLightBackgroundColor ?? null,
      pageDarkBackgroundColor: app?.pageDarkBackgroundColor ?? null,
      cardLightBackgroundColor: app?.cardLightBackgroundColor ?? null,
      cardDarkBackgroundColor: app?.cardDarkBackgroundColor ?? null,
    };
  }
```

- [ ] **Step 4: Run the `SocialService` test to verify it passes**

Run: `cd apps/auth-server && npx jest src/social/social.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing `SocialController` test**

In `apps/auth-server/src/social/social.controller.spec.ts`, find the `list` describe block and add an assertion (mirroring how it already checks `logo`/`favicon` pass through) that the controller's response includes the 4 color fields from `getBrandingForApp`'s mocked return value. Follow the exact mock-and-assert shape already used there for `logo`/`favicon`.

- [ ] **Step 6: Run it to verify it fails**

Run: `cd apps/auth-server && npx jest src/social/social.controller.spec.ts -t "background"`
Expected: FAIL.

- [ ] **Step 7: Implement — extend `SocialController.list`'s return type**

In `apps/auth-server/src/social/social.controller.ts`, change the `list` method's return type annotation from:

```ts
  async list(@Query('client_id') clientId?: string): Promise<{
    providers: string[]; logo: string | null; name: string | null; favicon: string | null
  }> {
```

to:

```ts
  async list(@Query('client_id') clientId?: string): Promise<{
    providers: string[]; logo: string | null; name: string | null; favicon: string | null;
    pageLightBackgroundColor: string | null; pageDarkBackgroundColor: string | null;
    cardLightBackgroundColor: string | null; cardDarkBackgroundColor: string | null;
  }> {
```

(the method body — `const [providers, branding] = ...; return { providers, ...branding };` — needs no change, since `branding` already spreads whatever `getBrandingForApp` returns.)

- [ ] **Step 8: Run the `SocialController` test to verify it passes**

Run: `cd apps/auth-server && npx jest src/social/social.controller.spec.ts`
Expected: PASS.

- [ ] **Step 9: Write the failing admin-lib + `LoginForm` test**

In `apps/admin/app/login/__tests__/login-forms.test.tsx`, add a test (mirroring `'renders the app logo when a logo URL is provided'`):

```tsx
it('applies background color overrides when provided', () => {
  const { container } = wrap(
    <LoginForm
      next=""
      authServerUrl="https://auth.test"
      pageLightBackgroundColor="#111111"
      pageDarkBackgroundColor="#222222"
      cardLightBackgroundColor="#333333"
      cardDarkBackgroundColor="#444444"
    />,
  )
  expect(container.querySelector('[data-auth-page-bg]')).not.toBeNull()
  expect(container.querySelector('[data-auth-card-bg]')).not.toBeNull()
})
```

- [ ] **Step 10: Run it to verify it fails**

Run: `cd apps/admin && npx jest app/login/__tests__/login-forms.test.tsx -t "background"`
Expected: FAIL — `LoginForm` doesn't accept these props yet.

- [ ] **Step 11: Implement — `fetchSocialProviders` and `LoginForm`**

Replace `apps/admin/lib/social-providers.ts` with:

```ts
const AUTH_SERVER = process.env.AUTH_SERVER_URL ?? 'https://localhost:3010'

export interface SocialProvidersResult {
  providers: string[]; logo: string | null; name: string | null; favicon: string | null;
  pageLightBackgroundColor: string | null; pageDarkBackgroundColor: string | null;
  cardLightBackgroundColor: string | null; cardDarkBackgroundColor: string | null;
}

const FAILSAFE: SocialProvidersResult = {
  providers: [], logo: null, name: null, favicon: null,
  pageLightBackgroundColor: null, pageDarkBackgroundColor: null,
  cardLightBackgroundColor: null, cardDarkBackgroundColor: null,
}

/**
 * Ask the auth-server which provider buttons this app shows, and what
 * branding (name/logo/favicon/background colors, if any) to render on the
 * login card. `next` is the authorize URL the user was bounced from; its
 * client_id names the app. Any failure yields an empty provider list and no
 * branding — the password form must still render.
 */
export async function fetchSocialProviders(next: string): Promise<SocialProvidersResult> {
  let clientId: string | null = null
  try {
    clientId = new URL(next, 'http://placeholder.invalid').searchParams.get('client_id')
  } catch {
    clientId = null
  }

  const query = clientId ? `?client_id=${encodeURIComponent(clientId)}` : ''
  try {
    const res = await fetch(`${AUTH_SERVER}/api/social-providers${query}`, { cache: 'no-store' })
    if (!res.ok) return FAILSAFE
    const body = (await res.json()) as {
      providers?: unknown; logo?: unknown; name?: unknown; favicon?: unknown;
      pageLightBackgroundColor?: unknown; pageDarkBackgroundColor?: unknown;
      cardLightBackgroundColor?: unknown; cardDarkBackgroundColor?: unknown;
    }
    return {
      providers: Array.isArray(body.providers) ? (body.providers as string[]) : [],
      logo: typeof body.logo === 'string' ? body.logo : null,
      name: typeof body.name === 'string' ? body.name : null,
      favicon: typeof body.favicon === 'string' ? body.favicon : null,
      pageLightBackgroundColor: typeof body.pageLightBackgroundColor === 'string' ? body.pageLightBackgroundColor : null,
      pageDarkBackgroundColor: typeof body.pageDarkBackgroundColor === 'string' ? body.pageDarkBackgroundColor : null,
      cardLightBackgroundColor: typeof body.cardLightBackgroundColor === 'string' ? body.cardLightBackgroundColor : null,
      cardDarkBackgroundColor: typeof body.cardDarkBackgroundColor === 'string' ? body.cardDarkBackgroundColor : null,
    }
  } catch {
    return FAILSAFE
  }
}
```

In `apps/admin/app/login/login-form.tsx`, add the 4 props to the component's destructured props (after `logo = null,`):

```tsx
export function LoginForm({
  next,
  providers = [],
  logo = null,
  pageLightBackgroundColor = null,
  pageDarkBackgroundColor = null,
  cardLightBackgroundColor = null,
  cardDarkBackgroundColor = null,
  authServerUrl,
}: {
  next: string
  providers?: string[]
  logo?: string | null
  pageLightBackgroundColor?: string | null
  pageDarkBackgroundColor?: string | null
  cardLightBackgroundColor?: string | null
  cardDarkBackgroundColor?: string | null
  authServerUrl: string
}) {
```

and pass them to `<AuthCard>` (add after `logoAlt={t('logoAlt')}`):

```tsx
      logoAlt={t('logoAlt')}
      pageLightBackgroundColor={pageLightBackgroundColor}
      pageDarkBackgroundColor={pageDarkBackgroundColor}
      cardLightBackgroundColor={cardLightBackgroundColor}
      cardDarkBackgroundColor={cardDarkBackgroundColor}
```

In `apps/admin/app/login/page.tsx`, change the destructuring (currently `const { providers, logo } = await fetchSocialProviders(nextSafe ?? '')`) to:

```tsx
  const {
    providers, logo, pageLightBackgroundColor, pageDarkBackgroundColor,
    cardLightBackgroundColor, cardDarkBackgroundColor,
  } = await fetchSocialProviders(nextSafe ?? '')
```

and pass the 4 colors through to `<LoginForm>` (add after `logo={logo}`):

```tsx
  return (
    <LoginForm
      next={nextSafe ?? ''}
      providers={providers}
      logo={logo}
      pageLightBackgroundColor={pageLightBackgroundColor}
      pageDarkBackgroundColor={pageDarkBackgroundColor}
      cardLightBackgroundColor={cardLightBackgroundColor}
      cardDarkBackgroundColor={cardDarkBackgroundColor}
      authServerUrl={PUBLIC_AUTH_SERVER}
    />
  )
```

- [ ] **Step 12: Update existing login page/form test fixtures**

In `apps/admin/app/login/__tests__/page.test.tsx`, every mocked `fetchSocialProviders` resolved value needs the 4 new fields added, e.g. `pageLightBackgroundColor: null, pageDarkBackgroundColor: null, cardLightBackgroundColor: null, cardDarkBackgroundColor: null`.

- [ ] **Step 13: Run the full login test suites**

Run: `cd apps/admin && npx jest app/login/__tests__/login-forms.test.tsx app/login/__tests__/page.test.tsx`
Expected: PASS.

- [ ] **Step 14: Commit**

```bash
git add apps/auth-server/src/social/social.service.ts apps/auth-server/src/social/social.service.spec.ts apps/auth-server/src/social/social.controller.ts apps/auth-server/src/social/social.controller.spec.ts apps/admin/lib/social-providers.ts apps/admin/app/login/login-form.tsx apps/admin/app/login/page.tsx apps/admin/app/login/__tests__
git commit -m "feat(login): apply per-app background color overrides on the login page"
```

---

## Task 7: Shared `clientIdFromNext` helper + `fetchAppBranding` admin-lib helper

**Files:**
- Create: `apps/admin/lib/client-id-from-next.ts`
- Create: `apps/admin/lib/__tests__/client-id-from-next.test.ts`
- Create: `apps/admin/lib/app-branding.ts`
- Create: `apps/admin/lib/__tests__/app-branding.test.ts`
- Modify: `apps/admin/app/login/login-form.tsx`

This extracts the `client_id`-from-`next` parsing (currently duplicated inline in `login-form.tsx` and `social-providers.ts`) into one shared helper, and adds a lightweight branding-by-`client_id` fetch (wrapping `GET /api/social-providers`, which already returns the 4 colors as of Task 6) for the pages that have only a `client_id`/`appPublicId` and no richer existing fetch.

- [ ] **Step 1: Write the failing test for `clientIdFromNext`**

Create `apps/admin/lib/__tests__/client-id-from-next.test.ts`:

```ts
import { clientIdFromNext } from '../client-id-from-next'

describe('clientIdFromNext', () => {
  it('extracts client_id from an absolute authorize URL', () => {
    expect(clientIdFromNext('https://auth.test/api/token/oauth/authorize?client_id=sq_1&redirect_uri=x')).toBe('sq_1')
  })

  it('extracts client_id from a relative next', () => {
    expect(clientIdFromNext('/api/token/oauth/authorize?client_id=sq_1')).toBe('sq_1')
  })

  it('returns null for an empty next', () => {
    expect(clientIdFromNext('')).toBeNull()
  })

  it('returns null when next has no client_id', () => {
    expect(clientIdFromNext('/users')).toBeNull()
  })

  it('returns null for an unparseable next', () => {
    expect(clientIdFromNext('::::not a url')).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/admin && npx jest lib/__tests__/client-id-from-next.test.ts`
Expected: FAIL — module `../client-id-from-next` doesn't exist.

- [ ] **Step 3: Implement `clientIdFromNext`**

Create `apps/admin/lib/client-id-from-next.ts`:

```ts
/**
 * `next` may be a relative or absolute authorize URL carrying `client_id` —
 * the same shape login-form.tsx, social-providers.ts, login/actions.ts's
 * applyPerAppTrustCookie, and consent.ts's extractClientId each already
 * parse independently for their own purposes. A placeholder base lets a
 * relative `next` parse without throwing.
 */
export function clientIdFromNext(next: string): string | null {
  if (!next) return null
  try {
    return new URL(next, 'http://placeholder.invalid').searchParams.get('client_id')
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd apps/admin && npx jest lib/__tests__/client-id-from-next.test.ts`
Expected: PASS.

- [ ] **Step 5: Use the shared helper in `login-form.tsx`**

In `apps/admin/app/login/login-form.tsx`, remove the local `clientIdFromNext` function definition (lines 17-24) and its now-unused nothing else changes; add the import:

```tsx
import { clientIdFromNext } from '@/lib/client-id-from-next'
```

Run: `cd apps/admin && npx jest app/login/__tests__/login-forms.test.tsx`
Expected: PASS (behavior unchanged).

- [ ] **Step 6: Write the failing test for `fetchAppBranding`**

Create `apps/admin/lib/__tests__/app-branding.test.ts`:

```ts
import { fetchAppBranding } from '../app-branding'

const mockFetch = jest.fn()
global.fetch = mockFetch as unknown as typeof fetch

beforeEach(() => mockFetch.mockReset())

describe('fetchAppBranding', () => {
  it('returns the 4 background colors (and logo) for a known client_id', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        providers: [], logo: 'data:image/png;base64,AAA=', name: 'App', favicon: null,
        pageLightBackgroundColor: '#111111', pageDarkBackgroundColor: '#222222',
        cardLightBackgroundColor: '#333333', cardDarkBackgroundColor: '#444444',
      }),
    })

    const result = await fetchAppBranding('client-1')

    expect(result.logo).toBe('data:image/png;base64,AAA=')
    expect(result.pageLightBackgroundColor).toBe('#111111')
    expect(result.cardDarkBackgroundColor).toBe('#444444')
  })

  it('returns all-null on a missing client_id', async () => {
    const result = await fetchAppBranding(null)
    expect(mockFetch).not.toHaveBeenCalled()
    expect(result.pageLightBackgroundColor).toBeNull()
  })

  it('returns all-null on fetch failure', async () => {
    mockFetch.mockResolvedValue({ ok: false })
    const result = await fetchAppBranding('client-1')
    expect(result.pageLightBackgroundColor).toBeNull()
  })

  it('returns all-null when fetch throws', async () => {
    mockFetch.mockRejectedValue(new Error('network'))
    const result = await fetchAppBranding('client-1')
    expect(result.cardLightBackgroundColor).toBeNull()
  })
})
```

- [ ] **Step 7: Run it to verify it fails**

Run: `cd apps/admin && npx jest lib/__tests__/app-branding.test.ts`
Expected: FAIL — module `../app-branding` doesn't exist.

- [ ] **Step 8: Implement `fetchAppBranding`**

Create `apps/admin/lib/app-branding.ts`:

```ts
const AUTH_SERVER = process.env.AUTH_SERVER_URL ?? 'https://localhost:3010'

export interface AppBranding {
  logo: string | null; favicon: string | null;
  pageLightBackgroundColor: string | null; pageDarkBackgroundColor: string | null;
  cardLightBackgroundColor: string | null; cardDarkBackgroundColor: string | null;
}

const FAILSAFE: AppBranding = {
  logo: null, favicon: null,
  pageLightBackgroundColor: null, pageDarkBackgroundColor: null,
  cardLightBackgroundColor: null, cardDarkBackgroundColor: null,
}

/**
 * Branding (logo/favicon/background colors) for an app identified by
 * client_id, for pages that have only a client_id and no richer existing
 * app-info fetch (check-email, verified, login/code, two-factor,
 * two-factor-prompt, forgot-password). Wraps GET /api/social-providers,
 * which already resolves this exact shape for the login page (see
 * SocialService.getBrandingForApp) — reused here rather than adding a new
 * endpoint. A missing clientId or any fetch failure fails open to all-null,
 * matching every other per-app branding lookup in this codebase.
 */
export async function fetchAppBranding(clientId: string | null): Promise<AppBranding> {
  if (!clientId) return FAILSAFE
  try {
    const res = await fetch(`${AUTH_SERVER}/api/social-providers?client_id=${encodeURIComponent(clientId)}`, {
      cache: 'no-store',
    })
    if (!res.ok) return FAILSAFE
    const body = (await res.json()) as {
      logo?: unknown; favicon?: unknown;
      pageLightBackgroundColor?: unknown; pageDarkBackgroundColor?: unknown;
      cardLightBackgroundColor?: unknown; cardDarkBackgroundColor?: unknown;
    }
    return {
      logo: typeof body.logo === 'string' ? body.logo : null,
      favicon: typeof body.favicon === 'string' ? body.favicon : null,
      pageLightBackgroundColor: typeof body.pageLightBackgroundColor === 'string' ? body.pageLightBackgroundColor : null,
      pageDarkBackgroundColor: typeof body.pageDarkBackgroundColor === 'string' ? body.pageDarkBackgroundColor : null,
      cardLightBackgroundColor: typeof body.cardLightBackgroundColor === 'string' ? body.cardLightBackgroundColor : null,
      cardDarkBackgroundColor: typeof body.cardDarkBackgroundColor === 'string' ? body.cardDarkBackgroundColor : null,
    }
  } catch {
    return FAILSAFE
  }
}
```

- [ ] **Step 9: Run it to verify it passes**

Run: `cd apps/admin && npx jest lib/__tests__/app-branding.test.ts`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/admin/lib/client-id-from-next.ts apps/admin/lib/__tests__/client-id-from-next.test.ts apps/admin/lib/app-branding.ts apps/admin/lib/__tests__/app-branding.test.ts apps/admin/app/login/login-form.tsx
git commit -m "refactor(admin): extract clientIdFromNext; add fetchAppBranding helper"
```

---

## Task 8: `/signup/check-email` applies background colors

**Files:**
- Modify: `apps/admin/app/signup/check-email/page.tsx`
- Modify: `apps/admin/app/signup/check-email/check-email-card.tsx`
- Test: `apps/admin/app/signup/check-email/__tests__/page.test.tsx`

- [ ] **Step 1: Write the failing test**

In `apps/admin/app/signup/check-email/__tests__/page.test.tsx`, add a test that mocks `fetchAppBranding` (from `@/lib/app-branding`) to resolve with the 4 colors set, renders `CheckEmailPage` with `searchParams` including `clientId: 'sq_1'`, and asserts the rendered output contains a `[data-auth-page-bg]` element. Mirror this file's existing mocking style (it likely already mocks neighboring modules the same way — check the top of the file for the `jest.mock(...)` pattern used there).

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/admin && npx jest app/signup/check-email/__tests__/page.test.tsx -t "background"`
Expected: FAIL.

- [ ] **Step 3: Implement**

Replace `apps/admin/app/signup/check-email/page.tsx` with:

```tsx
import { getTranslations } from 'next-intl/server'
import { AuthCard } from '@sassy-auth/ui'
import { fetchAppBranding } from '@/lib/app-branding'
import { CheckEmailCard } from './check-email-card'

export const dynamic = 'force-dynamic'

const PUBLIC_AUTH_SERVER =
  process.env.PUBLIC_AUTH_SERVER_URL ?? process.env.AUTH_SERVER_URL ?? 'https://localhost:3010'

export default async function CheckEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; next?: string; clientId?: string }>
}) {
  const { email, next, clientId } = await searchParams
  const t = await getTranslations('signup.checkEmail')
  const branding = await fetchAppBranding(clientId ?? null)

  if (!email) {
    return (
      <AuthCard
        title={t('title')}
        subtitle={t('missingEmail')}
        pageLightBackgroundColor={branding.pageLightBackgroundColor}
        pageDarkBackgroundColor={branding.pageDarkBackgroundColor}
        cardLightBackgroundColor={branding.cardLightBackgroundColor}
        cardDarkBackgroundColor={branding.cardDarkBackgroundColor}
      />
    )
  }

  // code-method apps verify entirely within /signup (see signup-wizard.tsx)
  // and never navigate here — this page now always serves the link flow.
  return (
    <CheckEmailCard
      email={email}
      next={next ?? ''}
      authServerUrl={PUBLIC_AUTH_SERVER}
      pageLightBackgroundColor={branding.pageLightBackgroundColor}
      pageDarkBackgroundColor={branding.pageDarkBackgroundColor}
      cardLightBackgroundColor={branding.cardLightBackgroundColor}
      cardDarkBackgroundColor={branding.cardDarkBackgroundColor}
    />
  )
}
```

Replace `apps/admin/app/signup/check-email/check-email-card.tsx` with:

```tsx
'use client'

import * as React from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { AuthCard, Button } from '@sassy-auth/ui'
import { useResendVerificationEmail } from '@/lib/use-resend-verification-email'

export function CheckEmailCard({
  email,
  next,
  authServerUrl,
  pageLightBackgroundColor = null,
  pageDarkBackgroundColor = null,
  cardLightBackgroundColor = null,
  cardDarkBackgroundColor = null,
}: {
  email: string
  next: string
  authServerUrl: string
  pageLightBackgroundColor?: string | null
  pageDarkBackgroundColor?: string | null
  cardLightBackgroundColor?: string | null
  cardDarkBackgroundColor?: string | null
}) {
  const t = useTranslations('signup.checkEmail')
  const { resend, status, cooldown } = useResendVerificationEmail({ email, authServerUrl })

  const loginHref = next ? `/login?next=${encodeURIComponent(next)}` : '/login'

  return (
    <AuthCard
      title={t('title')}
      subtitle={t('subtitle', { email })}
      pageLightBackgroundColor={pageLightBackgroundColor}
      pageDarkBackgroundColor={pageDarkBackgroundColor}
      cardLightBackgroundColor={cardLightBackgroundColor}
      cardDarkBackgroundColor={cardDarkBackgroundColor}
      footer={
        <Link href={loginHref} className="text-label-md text-primary hover:underline">
          {t('backToLogin')}
        </Link>
      }
    >
      <div className="flex flex-col items-center gap-3">
        <Button type="button" onClick={resend} loading={status === 'sending'} disabled={cooldown > 0}>
          {cooldown > 0 ? t('resendCooldown', { seconds: cooldown }) : t('resendButton')}
        </Button>
        {status === 'sent' && (
          <p data-testid="check-email-resent" className="text-body-sm text-muted-foreground">
            {t('resendSent')}
          </p>
        )}
        {status === 'error' && (
          <p data-testid="check-email-error" className="text-label-md text-destructive">
            {t('resendError')}
          </p>
        )}
      </div>
    </AuthCard>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/admin && npx jest app/signup/check-email/__tests__/page.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/app/signup/check-email
git commit -m "feat(signup): apply per-app background colors on the check-email page"
```

---

## Task 9: `/signup/verified` + `link-expired-card` apply background colors

The verification-link `callbackURL` carries only `email` today. `client_id` must be added to it in both places it's built (`RegistrationService.finishRegistration` and `UsersService.resendActivationEmail`) so the `/signup/verified` page has something to resolve branding from.

**Files:**
- Modify: `apps/auth-server/src/registration/registration.service.ts`
- Modify: `apps/auth-server/src/users/users.service.ts`
- Modify: `apps/admin/app/signup/verified/page.tsx`
- Modify: `apps/admin/app/signup/verified/link-expired-card.tsx`
- Test: `apps/auth-server/src/registration/registration.service.spec.ts`
- Test: `apps/auth-server/src/users/users.service.spec.ts`

- [ ] **Step 1: Write the failing backend tests**

In `apps/auth-server/src/registration/registration.service.spec.ts`, find the existing assertion `callbackURL: expect.stringContaining(`/signup/verified?email=${encodeURIComponent(baseDto.email)}`)` and change it to also assert the `client_id` query param is present, e.g.:

```ts
expect(auth.api.sendVerificationEmail).toHaveBeenCalledWith({
  body: {
    email: baseDto.email,
    callbackURL: expect.stringContaining(
      `/signup/verified?email=${encodeURIComponent(baseDto.email)}&client_id=${encodeURIComponent(baseDto.appPublicId)}`,
    ),
  },
})
```

(Adjust `baseDto.appPublicId` to whatever the test fixture's app public id field is actually named — check the top of this spec file.)

Do the equivalent in `apps/auth-server/src/users/users.service.spec.ts` for the `resendActivationEmail` test's `callbackURL` assertion, appending `&client_id=...` with whatever app publicId the test's mocked `saUser`/`org`/`app` fixture uses.

- [ ] **Step 2: Run both to verify they fail**

Run: `cd apps/auth-server && npx jest src/registration/registration.service.spec.ts src/users/users.service.spec.ts -t "callbackURL"`
Expected: FAIL (or the closest matching test name — use `-t` matching whatever the actual test description is) — `client_id` missing from the URL.

- [ ] **Step 3: Implement — `registration.service.ts`**

In `apps/auth-server/src/registration/registration.service.ts`, inside `finishRegistration`, change:

```ts
        await auth.api.sendVerificationEmail({
          body: { email, callbackURL: `${adminUrl}/signup/verified?email=${encodeURIComponent(email)}` },
        });
```

to:

```ts
        await auth.api.sendVerificationEmail({
          body: {
            email,
            callbackURL: `${adminUrl}/signup/verified?email=${encodeURIComponent(email)}&client_id=${encodeURIComponent(app.publicId)}`,
          },
        });
```

- [ ] **Step 4: Implement — `users.service.ts`**

In `apps/auth-server/src/users/users.service.ts`, `resendActivationEmail` currently only selects `betterAuthUser.email` — it needs the app's `publicId` too. Change the `prisma.saUser.findUnique` call from:

```ts
    const user = await prisma.saUser.findUnique({
      where: { publicId: userPublicId },
      include: { betterAuthUser: { select: { email: true } } },
    });
```

to:

```ts
    const user = await prisma.saUser.findUnique({
      where: { publicId: userPublicId },
      include: {
        betterAuthUser: { select: { email: true } },
        org: { select: { app: { select: { publicId: true } } } },
      },
    });
```

and change the `sendVerificationEmail` call from:

```ts
    await auth.api.sendVerificationEmail({
      body: { email, callbackURL: `${adminUrl}/signup/verified?email=${encodeURIComponent(email)}` },
    });
```

to:

```ts
    await auth.api.sendVerificationEmail({
      body: {
        email,
        callbackURL: `${adminUrl}/signup/verified?email=${encodeURIComponent(email)}&client_id=${encodeURIComponent(user.org.app.publicId)}`,
      },
    });
```

- [ ] **Step 5: Run the backend tests to verify they pass**

Run: `cd apps/auth-server && npx jest src/registration/registration.service.spec.ts src/users/users.service.spec.ts`
Expected: PASS. If other pre-existing tests in these two spec files assert the exact `include`/`select` shape of the `saUser.findUnique` mock in `resendActivationEmail`'s other tests, update their fixtures to add `org: { app: { publicId: '...' } }` so they don't break.

- [ ] **Step 6: Wire the admin pages**

Replace `apps/admin/app/signup/verified/page.tsx` with:

```tsx
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { AuthCard } from '@sassy-auth/ui'
import { fetchAppBranding } from '@/lib/app-branding'
import { LinkExpiredCard } from './link-expired-card'

export const dynamic = 'force-dynamic'

// Same "PUBLIC vs internal auth-server origin" split as
// app/signup/check-email/page.tsx — this page's resend button fetches
// directly from the browser, so it needs the origin the browser can reach.
const PUBLIC_AUTH_SERVER =
  process.env.PUBLIC_AUTH_SERVER_URL ?? process.env.AUTH_SERVER_URL ?? 'https://localhost:3010'

export default async function SignupVerifiedPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; email?: string; client_id?: string }>
}) {
  const { error, email, client_id: clientId } = await searchParams
  const t = await getTranslations()
  const branding = await fetchAppBranding(clientId ?? null)

  if (error === 'TOKEN_EXPIRED' && email) {
    return (
      <LinkExpiredCard
        email={email}
        authServerUrl={PUBLIC_AUTH_SERVER}
        pageLightBackgroundColor={branding.pageLightBackgroundColor}
        pageDarkBackgroundColor={branding.pageDarkBackgroundColor}
        cardLightBackgroundColor={branding.cardLightBackgroundColor}
        cardDarkBackgroundColor={branding.cardDarkBackgroundColor}
      />
    )
  }

  if (error) {
    return (
      <AuthCard
        title={t('signup.verified.invalid.title')}
        subtitle={t('signup.verified.invalid.subtitle')}
        pageLightBackgroundColor={branding.pageLightBackgroundColor}
        pageDarkBackgroundColor={branding.pageDarkBackgroundColor}
        cardLightBackgroundColor={branding.cardLightBackgroundColor}
        cardDarkBackgroundColor={branding.cardDarkBackgroundColor}
        footer={
          <Link href="/login" className="text-label-md text-primary hover:underline">
            {t('signup.verified.invalid.backToLogin')}
          </Link>
        }
      >
        <p className="text-center text-body-md text-foreground">{t('signup.verified.invalid.subtitle')}</p>
      </AuthCard>
    )
  }

  return (
    <AuthCard
      title={t('signup.verified.title')}
      subtitle={t('signup.verified.subtitle')}
      pageLightBackgroundColor={branding.pageLightBackgroundColor}
      pageDarkBackgroundColor={branding.pageDarkBackgroundColor}
      cardLightBackgroundColor={branding.cardLightBackgroundColor}
      cardDarkBackgroundColor={branding.cardDarkBackgroundColor}
      icon={
        <span
          className="material-symbols-outlined text-[48px] text-primary"
          style={{ fontVariationSettings: "'FILL' 1" }}
        >
          check_circle
        </span>
      }
      footer={
        <Link href="/login" className="text-label-md text-primary hover:underline">
          {t('signup.verified.continueToLogin')}
        </Link>
      }
    />
  )
}
```

(Note: the `error` branch's original JSX rendered no `<p>` body — this plan adds one reusing the `subtitle` translation key as the body text is already shown via `subtitle`; to avoid changing visible behavior, instead keep the original structure exactly and only add the 4 color props — i.e. do NOT add a `<p>` child to that branch. Revert that one deviation: the `error` branch stays childless, exactly as the original file, with only the 4 color props added.)

Replace `apps/admin/app/signup/verified/link-expired-card.tsx` with:

```tsx
'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { AuthCard, Button } from '@sassy-auth/ui'
import { useResendVerificationEmail } from '@/lib/use-resend-verification-email'

export function LinkExpiredCard({
  email,
  authServerUrl,
  pageLightBackgroundColor = null,
  pageDarkBackgroundColor = null,
  cardLightBackgroundColor = null,
  cardDarkBackgroundColor = null,
}: {
  email: string
  authServerUrl: string
  pageLightBackgroundColor?: string | null
  pageDarkBackgroundColor?: string | null
  cardLightBackgroundColor?: string | null
  cardDarkBackgroundColor?: string | null
}) {
  const t = useTranslations('signup.verified.expired')
  const { resend, status, cooldown } = useResendVerificationEmail({ email, authServerUrl })

  return (
    <AuthCard
      title={t('title')}
      subtitle={t('subtitle', { email })}
      pageLightBackgroundColor={pageLightBackgroundColor}
      pageDarkBackgroundColor={pageDarkBackgroundColor}
      cardLightBackgroundColor={cardLightBackgroundColor}
      cardDarkBackgroundColor={cardDarkBackgroundColor}
      footer={
        <Link href="/login" className="text-label-md text-primary hover:underline">
          {t('backToLogin')}
        </Link>
      }
    >
      <div className="flex flex-col items-center gap-3">
        <Button type="button" onClick={resend} loading={status === 'sending'} disabled={cooldown > 0}>
          {cooldown > 0 ? t('resendCooldown', { seconds: cooldown }) : t('resendButton')}
        </Button>
        {status === 'sent' && (
          <p data-testid="link-expired-resent" className="text-body-sm text-muted-foreground">
            {t('resendSent')}
          </p>
        )}
        {status === 'error' && (
          <p data-testid="link-expired-error" className="text-label-md text-destructive">
            {t('resendError')}
          </p>
        )}
      </div>
    </AuthCard>
  )
}
```

- [ ] **Step 7: Run the admin signup/verified tests**

Run: `cd apps/admin && npx jest app/signup/verified`
Expected: PASS. Update any test that renders `SignupVerifiedPage`/`LinkExpiredCard` and asserts on exact props/searchParams shape to account for the new optional `client_id` search param (omitting it should keep prior behavior unchanged — branding resolves to all-null).

- [ ] **Step 8: Commit**

```bash
git add apps/auth-server/src/registration/registration.service.ts apps/auth-server/src/registration/registration.service.spec.ts apps/auth-server/src/users/users.service.ts apps/auth-server/src/users/users.service.spec.ts apps/admin/app/signup/verified
git commit -m "feat(signup): carry client_id on verification links; apply background colors on /signup/verified"
```

---

## Task 10: `/login/code` (OTP) applies background colors

**Files:**
- Modify: `apps/admin/app/login/code/page.tsx`
- Modify: `apps/admin/app/login/login-otp-form.tsx`
- Test: `apps/admin/app/login/__tests__/login-forms.test.tsx` (or a new `code/__tests__/page.test.tsx` if `login-otp-form` has its own test file — check first)

- [ ] **Step 1: Write the failing test**

Add a test to whichever existing spec file already covers `LoginOtpForm` (search `apps/admin/app/login/__tests__` and `apps/admin/app/login/code` for one; if none exists, create `apps/admin/app/login/__tests__/login-otp-form.test.tsx` following the same `wrap()`/render helper pattern as `login-forms.test.tsx`), asserting that passing the 4 color props renders `[data-auth-page-bg]`/`[data-auth-card-bg]`, same shape as Task 6 Step 1's `LoginForm` test.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/admin && npx jest login-otp-form -t "background"`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `apps/admin/app/login/login-otp-form.tsx`, add the 4 optional props to `LoginOtpForm`'s signature and pass them to `<AuthCard>`:

```tsx
export function LoginOtpForm({
  next,
  pageLightBackgroundColor = null,
  pageDarkBackgroundColor = null,
  cardLightBackgroundColor = null,
  cardDarkBackgroundColor = null,
}: {
  next: string
  pageLightBackgroundColor?: string | null
  pageDarkBackgroundColor?: string | null
  cardLightBackgroundColor?: string | null
  cardDarkBackgroundColor?: string | null
}) {
```

and change the `<AuthCard title={t('otp.title')} subtitle={t('otp.subtitle')}>` opening tag to:

```tsx
    <AuthCard
      title={t('otp.title')}
      subtitle={t('otp.subtitle')}
      pageLightBackgroundColor={pageLightBackgroundColor}
      pageDarkBackgroundColor={pageDarkBackgroundColor}
      cardLightBackgroundColor={cardLightBackgroundColor}
      cardDarkBackgroundColor={cardDarkBackgroundColor}
    >
```

Replace `apps/admin/app/login/code/page.tsx` with:

```tsx
import { validateNextUrl } from '@/lib/safe-next'
import { clientIdFromNext } from '@/lib/client-id-from-next'
import { fetchAppBranding } from '@/lib/app-branding'
import { LoginOtpForm } from '../login-otp-form'

export const dynamic = 'force-dynamic'

export default async function LoginCodePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const params = await searchParams
  const nextSafe = validateNextUrl(params.next)
  const branding = await fetchAppBranding(clientIdFromNext(nextSafe ?? ''))
  return (
    <LoginOtpForm
      next={nextSafe ?? ''}
      pageLightBackgroundColor={branding.pageLightBackgroundColor}
      pageDarkBackgroundColor={branding.pageDarkBackgroundColor}
      cardLightBackgroundColor={branding.cardLightBackgroundColor}
      cardDarkBackgroundColor={branding.cardDarkBackgroundColor}
    />
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/admin && npx jest login-otp-form`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/app/login/code/page.tsx apps/admin/app/login/login-otp-form.tsx apps/admin/app/login/__tests__
git commit -m "feat(login): apply per-app background colors on the OTP login page"
```

---

## Task 11: `/login/two-factor` and `/login/two-factor-prompt` apply background colors

Unlike every page so far, `TwoFactorForm` and `TwoFactorPromptClient` do **not** use `AuthCard` — they hand-roll their own `bg-[var(--background)]`/`bg-[var(--card)]` wrapper `<div>`s. The override is applied directly on those divs with the same `data-*` + scoped `<style>` pattern `AuthCard` uses internally, rather than refactoring these two components onto `AuthCard` (out of scope — different internal layout/shape, no shared behavior to gain).

**Files:**
- Create: `apps/admin/components/auth-background-style.tsx`
- Create: `apps/admin/components/__tests__/auth-background-style.test.tsx`
- Modify: `apps/admin/app/login/two-factor/TwoFactorForm.tsx`
- Modify: `apps/admin/app/login/two-factor/page.tsx`
- Modify: `apps/admin/app/login/two-factor-prompt/TwoFactorPromptClient.tsx`
- Modify: `apps/admin/app/login/two-factor-prompt/page.tsx`

- [ ] **Step 1: Write the failing test for the shared style helper**

Create `apps/admin/components/__tests__/auth-background-style.test.tsx`:

```tsx
import { render } from '@testing-library/react'
import { AuthBackgroundStyle } from '../auth-background-style'

describe('AuthBackgroundStyle', () => {
  it('renders a style block with all 4 colors when set', () => {
    const { container } = render(
      <AuthBackgroundStyle
        pageLightBackgroundColor="#111111"
        pageDarkBackgroundColor="#222222"
        cardLightBackgroundColor="#333333"
        cardDarkBackgroundColor="#444444"
      />,
    )
    const style = container.querySelector('style')
    expect(style?.textContent).toContain('#111111')
    expect(style?.textContent).toContain('#444444')
  })

  it('renders nothing when no colors are set', () => {
    const { container } = render(<AuthBackgroundStyle />)
    expect(container.querySelector('style')).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/admin && npx jest components/__tests__/auth-background-style.test.tsx`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the shared style helper**

Create `apps/admin/components/auth-background-style.tsx`:

```tsx
/**
 * Emits the same scoped <style> override `@sassy-auth/ui`'s AuthCard uses
 * internally (see auth-card.tsx), for the two auth pages (two-factor,
 * two-factor-prompt) that hand-roll their own bg-[var(--background)] /
 * bg-[var(--card)] wrapper divs instead of using AuthCard. Pair this with
 * `data-auth-page-bg`/`data-auth-card-bg` attributes on those divs.
 */
export function AuthBackgroundStyle({
  pageLightBackgroundColor = null,
  pageDarkBackgroundColor = null,
  cardLightBackgroundColor = null,
  cardDarkBackgroundColor = null,
}: {
  pageLightBackgroundColor?: string | null
  pageDarkBackgroundColor?: string | null
  cardLightBackgroundColor?: string | null
  cardDarkBackgroundColor?: string | null
}) {
  const hasPageOverride = Boolean(pageLightBackgroundColor || pageDarkBackgroundColor)
  const hasCardOverride = Boolean(cardLightBackgroundColor || cardDarkBackgroundColor)
  if (!hasPageOverride && !hasCardOverride) return null

  return (
    <style>
      {hasPageOverride &&
        `[data-auth-page-bg]{background-color:var(--auth-page-bg-light,hsl(var(--background)));}` +
          `.dark [data-auth-page-bg]{background-color:var(--auth-page-bg-dark,hsl(var(--background)));}`}
      {hasCardOverride &&
        `[data-auth-card-bg]{background-color:var(--auth-card-bg-light,hsl(var(--card)));}` +
          `.dark [data-auth-card-bg]{background-color:var(--auth-card-bg-dark,hsl(var(--card)));}`}
    </style>
  )
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd apps/admin && npx jest components/__tests__/auth-background-style.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire `TwoFactorForm`**

In `apps/admin/app/login/two-factor/TwoFactorForm.tsx`, add the import:

```tsx
import { AuthBackgroundStyle } from '@/components/auth-background-style'
```

Add the 4 optional props to the component signature:

```tsx
export function TwoFactorForm({
  next,
  trustDays = 14,
  pageLightBackgroundColor = null,
  pageDarkBackgroundColor = null,
  cardLightBackgroundColor = null,
  cardDarkBackgroundColor = null,
}: {
  next: string
  trustDays?: number
  pageLightBackgroundColor?: string | null
  pageDarkBackgroundColor?: string | null
  cardLightBackgroundColor?: string | null
  cardDarkBackgroundColor?: string | null
}) {
```

Change the outer wrapper markup from:

```tsx
    <div className="flex min-h-screen items-center justify-center bg-[var(--background)]">
      <div className="w-full max-w-sm rounded-lg border border-[var(--border)] bg-[var(--card)] p-8 shadow-sm">
```

to:

```tsx
    <div
      className="flex min-h-screen items-center justify-center bg-[var(--background)]"
      data-auth-page-bg=""
      style={{
        ...(pageLightBackgroundColor && { '--auth-page-bg-light': pageLightBackgroundColor }),
        ...(pageDarkBackgroundColor && { '--auth-page-bg-dark': pageDarkBackgroundColor }),
      } as React.CSSProperties}
    >
      <AuthBackgroundStyle
        pageLightBackgroundColor={pageLightBackgroundColor}
        pageDarkBackgroundColor={pageDarkBackgroundColor}
        cardLightBackgroundColor={cardLightBackgroundColor}
        cardDarkBackgroundColor={cardDarkBackgroundColor}
      />
      <div
        className="w-full max-w-sm rounded-lg border border-[var(--border)] bg-[var(--card)] p-8 shadow-sm"
        data-auth-card-bg=""
        style={{
          ...(cardLightBackgroundColor && { '--auth-card-bg-light': cardLightBackgroundColor }),
          ...(cardDarkBackgroundColor && { '--auth-card-bg-dark': cardDarkBackgroundColor }),
        } as React.CSSProperties}
      >
```

(the closing `</div></div>` at the bottom of the file needs no change — the nesting depth is unchanged.)

Replace `apps/admin/app/login/two-factor/page.tsx` with:

```tsx
import { validateNextUrl } from '@/lib/safe-next'
import { getSystemTrustDaysClient } from '@/lib/two-factor-prompt'
import { clientIdFromNext } from '@/lib/client-id-from-next'
import { fetchAppBranding } from '@/lib/app-branding'
import { TwoFactorForm } from './TwoFactorForm'

export const dynamic = 'force-dynamic'

export default async function TwoFactorPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const params = await searchParams
  const nextSafe = validateNextUrl(params.next)
  const trustDays = getSystemTrustDaysClient()
  const branding = await fetchAppBranding(clientIdFromNext(nextSafe ?? ''))
  return (
    <TwoFactorForm
      next={nextSafe ?? ''}
      trustDays={trustDays}
      pageLightBackgroundColor={branding.pageLightBackgroundColor}
      pageDarkBackgroundColor={branding.pageDarkBackgroundColor}
      cardLightBackgroundColor={branding.cardLightBackgroundColor}
      cardDarkBackgroundColor={branding.cardDarkBackgroundColor}
    />
  )
}
```

- [ ] **Step 6: Wire `TwoFactorPromptClient`**

Apply the identical pattern to `apps/admin/app/login/two-factor-prompt/TwoFactorPromptClient.tsx` (add the 4 props to `Props`, import `AuthBackgroundStyle`, add `data-auth-page-bg`/`data-auth-card-bg` + inline `style` to its two wrapper divs exactly as in Step 5) and to `apps/admin/app/login/two-factor-prompt/page.tsx` (add the `clientIdFromNext`/`fetchAppBranding` calls and pass the 4 props to `<TwoFactorPromptClient>`, mirroring `two-factor/page.tsx` above).

- [ ] **Step 7: Run the two-factor test suites**

Run: `cd apps/admin && npx jest two-factor`
Expected: PASS — existing tests for these two components render unaffected since all 4 new props default to `null`/no-op.

- [ ] **Step 8: Commit**

```bash
git add apps/admin/components/auth-background-style.tsx apps/admin/components/__tests__/auth-background-style.test.tsx apps/admin/app/login/two-factor apps/admin/app/login/two-factor-prompt
git commit -m "feat(login): apply per-app background colors on two-factor and two-factor-prompt pages"
```

---

## Task 12: `/login/consent` applies background colors

**Files:**
- Modify: `apps/admin/app/login/consent/page.tsx`

`appPublicId` here is literally `SaApp.publicId` — the same identifier `fetchAppBranding` expects as `clientId`.

- [ ] **Step 1: Implement**

In `apps/admin/app/login/consent/page.tsx`, add the import:

```tsx
import { fetchAppBranding } from '@/lib/app-branding'
```

and change the body to fetch and pass branding:

```tsx
export default async function LoginConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ appPublicId?: string; next?: string }>
}) {
  const { appPublicId, next } = await searchParams
  const t = await getTranslations()
  const nextSafe = validateNextUrl(next) ?? ''

  const [outstanding, branding] = await Promise.all([
    appPublicId ? fetchOutstandingConsent(appPublicId) : Promise.resolve([]),
    fetchAppBranding(appPublicId ?? null),
  ])

  // An empty outstanding list means either genuinely nothing is required, or
  // fetchOutstandingConsent fail-opened on a transport error — in both cases
  // this whole gate's established fail-open stance says proceed rather than
  // render a form with zero checkboxes whose vacuously-true "every checkbox
  // is checked" would let the user click Continue straight into a 400 with
  // nothing left to fix.
  if (outstanding.length === 0) {
    redirect(nextSafe || '/users')
  }

  return (
    <AuthCard
      title={t('loginConsent.title')}
      className="max-w-md"
      pageLightBackgroundColor={branding.pageLightBackgroundColor}
      pageDarkBackgroundColor={branding.pageDarkBackgroundColor}
      cardLightBackgroundColor={branding.cardLightBackgroundColor}
      cardDarkBackgroundColor={branding.cardDarkBackgroundColor}
    >
      <ConsentGateClient appPublicId={appPublicId ?? ''} next={nextSafe} outstanding={outstanding} />
    </AuthCard>
  )
}
```

(This also fixes a pre-existing minor inefficiency — `fetchOutstandingConsent` and the new `fetchAppBranding` now run concurrently via `Promise.all` instead of sequentially.)

- [ ] **Step 2: Run the consent test suite**

Run: `cd apps/admin && npx jest login/consent`
Expected: PASS — no existing test asserts the exact shape of a sequential vs. parallel fetch, so this should be behavior-neutral for them.

- [ ] **Step 3: Commit**

```bash
git add apps/admin/app/login/consent/page.tsx
git commit -m "feat(login): apply per-app background colors on the consent page"
```

---

## Task 13: `/forgot-password` applies background colors (best-effort)

**Files:**
- Modify: `apps/admin/app/login/login-form.tsx`
- Modify: `apps/admin/app/forgot-password/page.tsx`
- Modify: `apps/admin/app/forgot-password/forgot-password-form.tsx`
- Test: `apps/admin/app/login/__tests__/login-forms.test.tsx`

- [ ] **Step 1: Write the failing test**

In `apps/admin/app/login/__tests__/login-forms.test.tsx`, add a test asserting the "forgot password" link carries `client_id` when `next` has one:

```tsx
it('carries client_id on the forgot-password link when next has one', () => {
  wrap(<LoginForm next="/api/token/oauth/authorize?client_id=sq_1&redirect_uri=x" authServerUrl="https://auth.test" />)
  expect(screen.getByText(/forgot/i).closest('a')).toHaveAttribute('href', '/forgot-password?client_id=sq_1')
})
```

(Match the exact `t('forgotPassword')` text/selector style this file already uses for similar link assertions — adjust the `getByText` matcher to the real translated string if `/forgot/i` is ambiguous in context.)

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/admin && npx jest app/login/__tests__/login-forms.test.tsx -t "forgot-password link"`
Expected: FAIL — link href is still the bare `/forgot-password`.

- [ ] **Step 3: Implement — `login-form.tsx`**

In `apps/admin/app/login/login-form.tsx`, change:

```tsx
        <Link href="/forgot-password" className="self-end text-label-md text-primary hover:underline">
          {t('forgotPassword')}
        </Link>
```

to:

```tsx
        <Link
          href={clientId ? `/forgot-password?client_id=${encodeURIComponent(clientId)}` : '/forgot-password'}
          className="self-end text-label-md text-primary hover:underline"
        >
          {t('forgotPassword')}
        </Link>
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd apps/admin && npx jest app/login/__tests__/login-forms.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire `forgot-password/page.tsx` and the form**

Replace `apps/admin/app/forgot-password/page.tsx` with:

```tsx
import { fetchAppBranding } from '@/lib/app-branding'
import { ForgotPasswordForm } from './forgot-password-form'

export const dynamic = 'force-dynamic'

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ client_id?: string }>
}) {
  const { client_id: clientId } = await searchParams
  const branding = await fetchAppBranding(clientId ?? null)
  return (
    <ForgotPasswordForm
      pageLightBackgroundColor={branding.pageLightBackgroundColor}
      pageDarkBackgroundColor={branding.pageDarkBackgroundColor}
      cardLightBackgroundColor={branding.cardLightBackgroundColor}
      cardDarkBackgroundColor={branding.cardDarkBackgroundColor}
    />
  )
}
```

In `apps/admin/app/forgot-password/forgot-password-form.tsx`, add the 4 optional props:

```tsx
export function ForgotPasswordForm({
  pageLightBackgroundColor = null,
  pageDarkBackgroundColor = null,
  cardLightBackgroundColor = null,
  cardDarkBackgroundColor = null,
}: {
  pageLightBackgroundColor?: string | null
  pageDarkBackgroundColor?: string | null
  cardLightBackgroundColor?: string | null
  cardDarkBackgroundColor?: string | null
} = {}) {
```

and change the `<AuthCard title={t('title')} subtitle={t('subtitle')}` opening tag to also pass the 4 colors:

```tsx
    <AuthCard
      title={t('title')}
      subtitle={t('subtitle')}
      pageLightBackgroundColor={pageLightBackgroundColor}
      pageDarkBackgroundColor={pageDarkBackgroundColor}
      cardLightBackgroundColor={cardLightBackgroundColor}
      cardDarkBackgroundColor={cardDarkBackgroundColor}
```

- [ ] **Step 6: Run the forgot-password test suite**

Run: `cd apps/admin && npx jest forgot-password`
Expected: PASS — `ForgotPasswordForm` is called with no props in any existing test (the `= {}` default keeps that working).

- [ ] **Step 7: Commit**

```bash
git add apps/admin/app/login/login-form.tsx apps/admin/app/login/__tests__/login-forms.test.tsx apps/admin/app/forgot-password
git commit -m "feat(forgot-password): carry client_id from login; apply background colors"
```

---

## Task 14: `/reset-password` applies background colors

**Files:**
- Modify: `apps/auth-server/src/auth/resolve-app-for-reset-token.ts`
- Modify: `apps/auth-server/src/auth/password-policy.controller.ts`
- Modify: `apps/admin/lib/api-public.ts`
- Modify: `apps/admin/app/reset-password/reset-password-form.tsx`
- Test: `apps/auth-server/src/auth/resolve-app-for-reset-token.spec.ts`
- Test: `apps/auth-server/src/auth/password-policy.controller.spec.ts`

- [ ] **Step 1: Write the failing test for `resolveAppForResetToken`**

In `apps/auth-server/src/auth/resolve-app-for-reset-token.spec.ts`, find the existing happy-path test and add an assertion (or a sibling test) that the 4 color fields are selected and returned, following this file's existing `prisma` mock shape:

```ts
it('includes the 4 background color overrides', async () => {
  const prisma = {
    verification: { findFirst: jest.fn().mockResolvedValue({ value: 'ba-user-1' }) },
    saUser: { findFirst: jest.fn().mockResolvedValue({ org: { appId: 1 } }) },
    saApp: {
      findUnique: jest.fn().mockResolvedValue({
        id: 1, passwordPolicyOverride: null,
        pageLightBackgroundColor: '#111111', pageDarkBackgroundColor: '#222222',
        cardLightBackgroundColor: '#333333', cardDarkBackgroundColor: '#444444',
      }),
    },
  };

  const result = await resolveAppForResetToken(prisma as never, 'token-1');

  expect(result?.pageLightBackgroundColor).toBe('#111111');
  expect(result?.cardDarkBackgroundColor).toBe('#444444');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/auth-server && npx jest src/auth/resolve-app-for-reset-token.spec.ts -t "background color"`
Expected: FAIL.

- [ ] **Step 3: Implement — `resolveAppForResetToken`**

In `apps/auth-server/src/auth/resolve-app-for-reset-token.ts`, change the return type and the final `select`:

```ts
export async function resolveAppForResetToken(
  prisma: Pick<PrismaClient, 'verification' | 'saUser' | 'saApp'>,
  token: string,
): Promise<{
  id: number; passwordPolicyOverride: unknown;
  pageLightBackgroundColor: string | null; pageDarkBackgroundColor: string | null;
  cardLightBackgroundColor: string | null; cardDarkBackgroundColor: string | null;
} | null> {
  const verification = await prisma.verification.findFirst({
    where: { identifier: `reset-password:${token}` },
  });
  if (!verification) return null;

  const user = await prisma.saUser.findFirst({
    where: { betterAuthUserId: verification.value },
    select: { org: { select: { appId: true } } },
  });
  if (!user) return null;

  return prisma.saApp.findUnique({
    where: { id: user.org.appId },
    select: {
      id: true, passwordPolicyOverride: true,
      pageLightBackgroundColor: true, pageDarkBackgroundColor: true,
      cardLightBackgroundColor: true, cardDarkBackgroundColor: true,
    },
  });
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd apps/auth-server && npx jest src/auth/resolve-app-for-reset-token.spec.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing test for `PasswordPolicyController`**

In `apps/auth-server/src/auth/password-policy.controller.spec.ts`, add a test (mocking `resolveAppForResetToken` to resolve with the 4 colors, same as this file's existing `resetToken`-present test) asserting the controller's response includes them.

- [ ] **Step 6: Run it to verify it fails**

Run: `cd apps/auth-server && npx jest src/auth/password-policy.controller.spec.ts -t "background"`
Expected: FAIL.

- [ ] **Step 7: Implement — `PasswordPolicyController`**

Replace `apps/auth-server/src/auth/password-policy.controller.ts` with:

```ts
import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { prisma } from '@sassy-auth/db';
import { PasswordPolicy } from '@sassy-auth/types';
import { getGlobalPasswordPolicy, resolvePasswordPolicy } from './password-policy';
import { resolveAppForResetToken } from './resolve-app-for-reset-token';

/**
 * Public (no auth guard), unauthenticated by design — the forgot-password
 * page needs the effective policy for its live requirements checklist
 * before the user has proven they control the account. Returns the GLOBAL
 * policy and all-null background colors (never a 404/error) for a missing
 * or unresolvable resetToken: the page still needs something to render, and
 * the hooks.before matcher in auth.config.ts is the actual enforcement at
 * submit time regardless of what this endpoint showed beforehand.
 */
@ApiTags('Password Policy')
@Controller('password-policy')
export class PasswordPolicyController {
  @Get()
  async get(@Query('resetToken') resetToken?: string): Promise<{
    passwordPolicy: PasswordPolicy;
    pageLightBackgroundColor: string | null; pageDarkBackgroundColor: string | null;
    cardLightBackgroundColor: string | null; cardDarkBackgroundColor: string | null;
  }> {
    if (!resetToken) {
      return {
        passwordPolicy: getGlobalPasswordPolicy(process.env),
        pageLightBackgroundColor: null, pageDarkBackgroundColor: null,
        cardLightBackgroundColor: null, cardDarkBackgroundColor: null,
      };
    }
    const app = await resolveAppForResetToken(prisma, resetToken);
    return {
      passwordPolicy: resolvePasswordPolicy(app ?? { passwordPolicyOverride: null }),
      pageLightBackgroundColor: app?.pageLightBackgroundColor ?? null,
      pageDarkBackgroundColor: app?.pageDarkBackgroundColor ?? null,
      cardLightBackgroundColor: app?.cardLightBackgroundColor ?? null,
      cardDarkBackgroundColor: app?.cardDarkBackgroundColor ?? null,
    };
  }
}
```

- [ ] **Step 8: Run it to verify it passes**

Run: `cd apps/auth-server && npx jest src/auth/password-policy.controller.spec.ts`
Expected: PASS.

- [ ] **Step 9: Implement — `api-public.ts` and `reset-password-form.tsx`**

In `apps/admin/lib/api-public.ts`, replace `getPasswordPolicyForResetToken` with:

```ts
export interface PasswordPolicyAndBranding {
  passwordPolicy: PasswordPolicy;
  pageLightBackgroundColor: string | null; pageDarkBackgroundColor: string | null;
  cardLightBackgroundColor: string | null; cardDarkBackgroundColor: string | null;
}

export async function getPasswordPolicyForResetToken(token: string): Promise<PasswordPolicyAndBranding> {
  const res = await fetch(`${BASE}/api/password-policy?resetToken=${encodeURIComponent(token)}`)
  if (!res.ok) throw new Error(`API error ${res.status}: fetching password policy`)
  return res.json()
}
```

In `apps/admin/app/reset-password/reset-password-form.tsx`, change the `policy` state block to also track branding:

```tsx
  const [policy, setPolicy] = React.useState<PasswordPolicy>(FALLBACK_PASSWORD_POLICY)
  const [branding, setBranding] = React.useState<{
    pageLightBackgroundColor: string | null; pageDarkBackgroundColor: string | null;
    cardLightBackgroundColor: string | null; cardDarkBackgroundColor: string | null;
  }>({ pageLightBackgroundColor: null, pageDarkBackgroundColor: null, cardLightBackgroundColor: null, cardDarkBackgroundColor: null })

  React.useEffect(() => {
    let cancelled = false
    getPasswordPolicyForResetToken(token)
      .then((fetched) => {
        if (cancelled) return
        setPolicy(fetched.passwordPolicy)
        setBranding(fetched)
      })
      .catch(() => {
        // Silently keep FALLBACK_POLICY/all-null branding: the server-side
        // hooks.before enforcement is the real gate regardless of what this
        // checklist/background shows.
      })
    return () => {
      cancelled = true
    }
  }, [token])
```

and add the 4 `branding.*` props to both `<AuthCard>` usages in this file (the `success` branch and the main form branch), e.g. for the main form branch:

```tsx
  return (
    <AuthCard
      title={t('title')}
      pageLightBackgroundColor={branding.pageLightBackgroundColor}
      pageDarkBackgroundColor={branding.pageDarkBackgroundColor}
      cardLightBackgroundColor={branding.cardLightBackgroundColor}
      cardDarkBackgroundColor={branding.cardDarkBackgroundColor}
    >
```

and identically for the `success` branch's `<AuthCard footer={...}>` tag (add the same 4 props alongside `footer`).

- [ ] **Step 10: Run the reset-password test suite**

Run: `cd apps/admin && npx jest app/reset-password`
Expected: PASS. Update any test that mocks `getPasswordPolicyForResetToken`'s resolved value to return the new `{ passwordPolicy, pageLightBackgroundColor, ... }` shape instead of a bare `PasswordPolicy`.

- [ ] **Step 11: Commit**

```bash
git add apps/auth-server/src/auth/resolve-app-for-reset-token.ts apps/auth-server/src/auth/resolve-app-for-reset-token.spec.ts apps/auth-server/src/auth/password-policy.controller.ts apps/auth-server/src/auth/password-policy.controller.spec.ts apps/admin/lib/api-public.ts apps/admin/app/reset-password
git commit -m "feat(reset-password): apply per-app background colors"
```

---

## Task 15: Admin console types + shared `AppColorField` component

**Files:**
- Modify: `apps/admin/lib/types.ts`
- Create: `apps/admin/components/app-color-field.tsx`
- Create: `apps/admin/components/__tests__/app-color-field.test.tsx`

- [ ] **Step 1: Add the 4 fields to the admin `App`/payload types**

In `apps/admin/lib/types.ts`, add to `App` (after `favicon?: string | null;`):

```ts
  pageLightBackgroundColor?: string | null;
  pageDarkBackgroundColor?: string | null;
  cardLightBackgroundColor?: string | null;
  cardDarkBackgroundColor?: string | null;
```

Add the same 4 lines to `CreateAppPayload` (after `favicon?: string | null;`) and to `UpdateAppPayload` (after `favicon?: string | null;`).

- [ ] **Step 2: Write the failing test for `AppColorField`**

Create `apps/admin/components/__tests__/app-color-field.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import en from '../../messages/en.json'
import { AppColorField } from '../app-color-field'

function wrap(ui: React.ReactElement) {
  return render(<NextIntlClientProvider locale="en" messages={en}>{ui}</NextIntlClientProvider>)
}

describe('AppColorField', () => {
  it('renders the hex text input with the current value', () => {
    wrap(<AppColorField value="#111111" onValueChange={jest.fn()} inputId="x" label="Page background (light)" hint="hint" />)
    expect(screen.getByDisplayValue('#111111')).toBeInTheDocument()
  })

  it('calls onValueChange with a valid 6-digit hex value', () => {
    const onValueChange = jest.fn()
    wrap(<AppColorField value={null} onValueChange={onValueChange} inputId="x" label="Page background (light)" hint="hint" />)
    fireEvent.change(screen.getByLabelText('Page background (light)'), { target: { value: '#abcdef' } })
    expect(onValueChange).toHaveBeenCalledWith('#abcdef')
  })

  it('shows an invalid-hex error and does not call onValueChange for a malformed value', () => {
    const onValueChange = jest.fn()
    wrap(<AppColorField value={null} onValueChange={onValueChange} inputId="x" label="Page background (light)" hint="hint" />)
    fireEvent.change(screen.getByLabelText('Page background (light)'), { target: { value: 'not-a-color' } })
    fireEvent.blur(screen.getByLabelText('Page background (light)'))
    expect(screen.getByText(en.apps.errors.invalidHexColor)).toBeInTheDocument()
  })

  it('clears to null when Reset to default is clicked', () => {
    const onValueChange = jest.fn()
    wrap(<AppColorField value="#111111" onValueChange={onValueChange} inputId="x" label="Page background (light)" hint="hint" />)
    fireEvent.click(screen.getByText(en.apps.fields.resetColorToDefault))
    expect(onValueChange).toHaveBeenCalledWith(null)
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd apps/admin && npx jest components/__tests__/app-color-field.test.tsx`
Expected: FAIL — `AppColorField` and the new i18n keys don't exist yet.

- [ ] **Step 4: Implement `AppColorField`**

Create `apps/admin/components/app-color-field.tsx`:

```tsx
'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { Input, Label } from '@sassy-auth/ui'

const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/

interface Props {
  value: string | null
  onValueChange: (next: string | null) => void
  inputId: string
  label: string
  hint: string
}

export function AppColorField({ value, onValueChange, inputId, label, hint }: Props) {
  const t = useTranslations()
  const [draft, setDraft] = React.useState(value ?? '')
  const [invalid, setInvalid] = React.useState(false)

  React.useEffect(() => {
    setDraft(value ?? '')
    setInvalid(false)
  }, [value])

  function commit(next: string) {
    const trimmed = next.trim()
    if (trimmed === '') {
      setInvalid(false)
      onValueChange(null)
      return
    }
    if (!HEX_COLOR_PATTERN.test(trimmed)) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    onValueChange(trimmed)
  }

  return (
    <div>
      <Label htmlFor={inputId}>{label}</Label>
      <p className="mt-1 text-body-sm text-muted-foreground">{hint}</p>
      <div className="mt-2 flex items-center gap-2">
        <input
          type="color"
          aria-hidden="true"
          tabIndex={-1}
          value={HEX_COLOR_PATTERN.test(draft) ? draft : '#ffffff'}
          onChange={(e) => {
            setDraft(e.target.value)
            commit(e.target.value)
          }}
          className="h-9 w-9 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0.5"
        />
        <Input
          id={inputId}
          value={draft}
          placeholder="#0F172A"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commit(draft)}
          className="flex-1"
        />
        {value && (
          <button
            type="button"
            onClick={() => {
              setDraft('')
              setInvalid(false)
              onValueChange(null)
            }}
            className="shrink-0 text-label-md text-primary hover:underline"
          >
            {t('apps.fields.resetColorToDefault')}
          </button>
        )}
      </div>
      {invalid && <p className="mt-1 text-label-md text-destructive">{t('apps.errors.invalidHexColor')}</p>}
    </div>
  )
}
```

- [ ] **Step 5: Add the i18n keys (en/fr) — needed before the test can pass**

In `apps/admin/messages/en.json`, in the `apps.fields` object, add (after `"noFavicon": "No favicon configured",`):

```json
      "pageLightBackgroundColor": "Page background (light)",
      "pageLightBackgroundColorHint": "Overrides the page background behind the sign in/sign up card in light mode.",
      "pageDarkBackgroundColor": "Page background (dark)",
      "pageDarkBackgroundColorHint": "Overrides the page background behind the sign in/sign up card in dark mode.",
      "cardLightBackgroundColor": "Card background (light)",
      "cardLightBackgroundColorHint": "Overrides the sign in/sign up card's own background in light mode.",
      "cardDarkBackgroundColor": "Card background (dark)",
      "cardDarkBackgroundColorHint": "Overrides the sign in/sign up card's own background in dark mode.",
      "resetColorToDefault": "Reset to default",
```

In the `apps.errors` object, add (after `"logoTooLarge": "That image is too large. Please choose one under 250KB.",`):

```json
      "invalidHexColor": "Enter a 6-digit hex color (e.g. #0F172A).",
```

In `apps/admin/messages/fr.json`, in `apps.fields`, add (after `"noFavicon": "Aucun favicon configuré",`):

```json
      "pageLightBackgroundColor": "Arrière-plan de la page (clair)",
      "pageLightBackgroundColorHint": "Remplace l'arrière-plan de la page derrière la carte de connexion/inscription en mode clair.",
      "pageDarkBackgroundColor": "Arrière-plan de la page (sombre)",
      "pageDarkBackgroundColorHint": "Remplace l'arrière-plan de la page derrière la carte de connexion/inscription en mode sombre.",
      "cardLightBackgroundColor": "Arrière-plan de la carte (clair)",
      "cardLightBackgroundColorHint": "Remplace l'arrière-plan de la carte de connexion/inscription elle-même en mode clair.",
      "cardDarkBackgroundColor": "Arrière-plan de la carte (sombre)",
      "cardDarkBackgroundColorHint": "Remplace l'arrière-plan de la carte de connexion/inscription elle-même en mode sombre.",
      "resetColorToDefault": "Réinitialiser par défaut",
```

In `apps.errors`, add (after `"logoTooLarge": "Cette image est trop volumineuse. Veuillez en choisir une de moins de 250 Ko.",`):

```json
      "invalidHexColor": "Saisissez une couleur hexadécimale à 6 chiffres (ex. #0F172A).",
```

- [ ] **Step 6: Run the `AppColorField` test to verify it passes**

Run: `cd apps/admin && npx jest components/__tests__/app-color-field.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/admin/lib/types.ts apps/admin/components/app-color-field.tsx apps/admin/components/__tests__/app-color-field.test.tsx apps/admin/messages/en.json apps/admin/messages/fr.json
git commit -m "feat(admin): add App types and AppColorField for background color overrides"
```

---

## Task 16: Wire `AppColorField` into `AppCreateDrawer`, `AppEditDrawer`, `AppViewDrawer`

**Files:**
- Modify: `apps/admin/components/app-create-drawer.tsx`
- Modify: `apps/admin/components/app-edit-drawer.tsx`
- Modify: `apps/admin/components/app-view-drawer.tsx`
- Test: `apps/admin/components/__tests__/app-create-drawer.test.tsx`
- Test: `apps/admin/components/__tests__/app-edit-drawer.test.tsx`

- [ ] **Step 1: `AppCreateDrawer`**

In `apps/admin/components/app-create-drawer.tsx`, add the import:

```tsx
import { AppColorField } from './app-color-field'
```

Add 4 state variables (after `const [favicon, setFavicon] = React.useState<string | null>(null)`):

```tsx
  const [pageLightBackgroundColor, setPageLightBackgroundColor] = React.useState<string | null>(null)
  const [pageDarkBackgroundColor, setPageDarkBackgroundColor] = React.useState<string | null>(null)
  const [cardLightBackgroundColor, setCardLightBackgroundColor] = React.useState<string | null>(null)
  const [cardDarkBackgroundColor, setCardDarkBackgroundColor] = React.useState<string | null>(null)
```

Add the 4 fields to the payload built around line 73-74 (`logo, favicon,`):

```tsx
        logo,
        favicon,
        pageLightBackgroundColor,
        pageDarkBackgroundColor,
        cardLightBackgroundColor,
        cardDarkBackgroundColor,
```

Add 4 `<AppColorField>` elements to the JSX, immediately after the existing `<AppFaviconField value={favicon} onValueChange={setFavicon} />` block:

```tsx
            <div>
              <AppColorField
                value={pageLightBackgroundColor}
                onValueChange={setPageLightBackgroundColor}
                inputId="appPageLightBg"
                label={t('apps.fields.pageLightBackgroundColor')}
                hint={t('apps.fields.pageLightBackgroundColorHint')}
              />
            </div>
            <div>
              <AppColorField
                value={pageDarkBackgroundColor}
                onValueChange={setPageDarkBackgroundColor}
                inputId="appPageDarkBg"
                label={t('apps.fields.pageDarkBackgroundColor')}
                hint={t('apps.fields.pageDarkBackgroundColorHint')}
              />
            </div>
            <div>
              <AppColorField
                value={cardLightBackgroundColor}
                onValueChange={setCardLightBackgroundColor}
                inputId="appCardLightBg"
                label={t('apps.fields.cardLightBackgroundColor')}
                hint={t('apps.fields.cardLightBackgroundColorHint')}
              />
            </div>
            <div>
              <AppColorField
                value={cardDarkBackgroundColor}
                onValueChange={setCardDarkBackgroundColor}
                inputId="appCardDarkBg"
                label={t('apps.fields.cardDarkBackgroundColor')}
                hint={t('apps.fields.cardDarkBackgroundColorHint')}
              />
            </div>
```

- [ ] **Step 2: Run the create-drawer test suite**

Run: `cd apps/admin && npx jest components/__tests__/app-create-drawer.test.tsx`
Expected: PASS — existing tests don't assert on form payload exhaustively enough to break (verify by running; if a test does assert exact payload shape, add the 4 new `null` fields to its expectation).

- [ ] **Step 3: `AppEditDrawer`**

In `apps/admin/components/app-edit-drawer.tsx`, add the import:

```tsx
import { AppColorField } from './app-color-field'
```

Add 4 state + 4 "original" baseline state variables (after `const [originalFavicon, setOriginalFavicon] = React.useState<string | null>(app.favicon ?? null)`):

```tsx
  const [pageLightBackgroundColor, setPageLightBackgroundColor] = React.useState<string | null>(app.pageLightBackgroundColor ?? null)
  const [pageDarkBackgroundColor, setPageDarkBackgroundColor] = React.useState<string | null>(app.pageDarkBackgroundColor ?? null)
  const [cardLightBackgroundColor, setCardLightBackgroundColor] = React.useState<string | null>(app.cardLightBackgroundColor ?? null)
  const [cardDarkBackgroundColor, setCardDarkBackgroundColor] = React.useState<string | null>(app.cardDarkBackgroundColor ?? null)
```

(Unlike `logo`/`favicon`, these 4 fields are NOT stripped from the list/single-app GET responses — Task 4 kept them in `formatApp` unconditionally — so no separate "original" tracking state or re-fetch-on-open logic is needed; the `app` prop's value is always the real current value.)

Add to the `dirty` boolean expression (append before the closing of the expression, e.g. right after `|| emailVerificationMethodDirty`):

```tsx
 || pageLightBackgroundColor !== (app.pageLightBackgroundColor ?? null) || pageDarkBackgroundColor !== (app.pageDarkBackgroundColor ?? null) || cardLightBackgroundColor !== (app.cardLightBackgroundColor ?? null) || cardDarkBackgroundColor !== (app.cardDarkBackgroundColor ?? null)
```

Add the 4 fields to the `patch` type annotation (append before the closing `}` of that inline type, after `emailVerificationMethod?: 'link' | 'code'`):

```ts
; pageLightBackgroundColor?: string | null; pageDarkBackgroundColor?: string | null; cardLightBackgroundColor?: string | null; cardDarkBackgroundColor?: string | null
```

Add the 4 patch-building lines (after `if (favicon !== originalFavicon) patch.favicon = favicon`):

```tsx
    if (pageLightBackgroundColor !== (app.pageLightBackgroundColor ?? null)) patch.pageLightBackgroundColor = pageLightBackgroundColor
    if (pageDarkBackgroundColor !== (app.pageDarkBackgroundColor ?? null)) patch.pageDarkBackgroundColor = pageDarkBackgroundColor
    if (cardLightBackgroundColor !== (app.cardLightBackgroundColor ?? null)) patch.cardLightBackgroundColor = cardLightBackgroundColor
    if (cardDarkBackgroundColor !== (app.cardDarkBackgroundColor ?? null)) patch.cardDarkBackgroundColor = cardDarkBackgroundColor
```

Add a `React.useEffect` reset (alongside the existing one that resets `logo`/`favicon`/etc. when `app` changes — find the effect that contains `setLogo(app.logo ?? null)` and add inside it):

```tsx
    setPageLightBackgroundColor(app.pageLightBackgroundColor ?? null)
    setPageDarkBackgroundColor(app.pageDarkBackgroundColor ?? null)
    setCardLightBackgroundColor(app.cardLightBackgroundColor ?? null)
    setCardDarkBackgroundColor(app.cardDarkBackgroundColor ?? null)
```

Add the 4 `<AppColorField>` elements to the JSX, immediately after `<AppFaviconField value={favicon} onValueChange={setFavicon} />` (identical block to Task 16 Step 1's 4 `<div>`s, with `onValueChange` pointing at this file's own setters).

- [ ] **Step 4: Run the edit-drawer test suite**

Run: `cd apps/admin && npx jest components/__tests__/app-edit-drawer.test.tsx`
Expected: PASS. If this file has a test asserting the exact `dirty`/patch computation for other fields (e.g. toggling `logo` and checking `updateAppAction` was called with a specific patch object), verify it doesn't now also expect the 4 new keys to be absent — adjust any such strict-equality assertion to use `expect.objectContaining(...)` or add the new `null`/unchanged-value keys as needed.

- [ ] **Step 5: `AppViewDrawer`**

In `apps/admin/components/app-view-drawer.tsx`, add 4 read-only swatch rows immediately after the existing favicon `<div>` block (the one ending with `{t('apps.fields.noFavicon')}`):

```tsx
          {(displayApp.pageLightBackgroundColor || displayApp.pageDarkBackgroundColor || displayApp.cardLightBackgroundColor || displayApp.cardDarkBackgroundColor) && (
            <div>
              <p className="text-label-sm font-bold uppercase tracking-wider text-muted-foreground">
                {t('apps.fields.backgroundColors')}
              </p>
              <div className="mt-1 flex flex-wrap gap-3">
                {([
                  ['pageLightBackgroundColor', displayApp.pageLightBackgroundColor],
                  ['pageDarkBackgroundColor', displayApp.pageDarkBackgroundColor],
                  ['cardLightBackgroundColor', displayApp.cardLightBackgroundColor],
                  ['cardDarkBackgroundColor', displayApp.cardDarkBackgroundColor],
                ] as const).map(([key, color]) =>
                  color ? (
                    <div key={key} className="flex items-center gap-2 rounded border border-border bg-card px-2 py-1">
                      <span
                        className="h-4 w-4 shrink-0 rounded-full border border-border"
                        style={{ backgroundColor: color }}
                      />
                      <span className="text-body-sm text-muted-foreground">
                        {t(`apps.fields.${key}`)}: {color}
                      </span>
                    </div>
                  ) : null,
                )}
              </div>
            </div>
          )}
```

Add the `backgroundColors` i18n key to `apps.fields` in both `en.json` (`"backgroundColors": "Background colors",`) and `fr.json` (`"backgroundColors": "Couleurs d'arrière-plan",`), alongside the keys added in Task 15 Step 5.

- [ ] **Step 6: Run the full admin component test suite for apps**

Run: `cd apps/admin && npx jest components/__tests__/app-`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/admin/components/app-create-drawer.tsx apps/admin/components/app-edit-drawer.tsx apps/admin/components/app-view-drawer.tsx apps/admin/messages/en.json apps/admin/messages/fr.json apps/admin/components/__tests__
git commit -m "feat(admin): wire background color fields into app create/edit/view drawers"
```

---

## Task 17: Full-suite verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full auth-server test suite**

Run: `cd apps/auth-server && npx jest`
Expected: PASS (0 failing).

- [ ] **Step 2: Run the full admin test suite**

Run: `cd apps/admin && npx jest`
Expected: PASS (0 failing).

- [ ] **Step 3: Run the full UI package test suite**

Run: `cd packages/ui && npx jest`
Expected: PASS (0 failing).

- [ ] **Step 4: Type-check both apps**

Run: `cd apps/auth-server && npx tsc --noEmit` and `cd apps/admin && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual smoke test**

Start the dev stack (per this repo's existing dev-server instructions), set `pageLightBackgroundColor`/`pageDarkBackgroundColor`/`cardLightBackgroundColor`/`cardDarkBackgroundColor` on a test app via the admin console's App edit drawer, then visit that app's `/signup?client_id=...` and `/login?next=...client_id=...` in both light and dark mode (toggle OS/browser color scheme) and confirm the page and card backgrounds match the configured hex values in both modes, and that an app with no colors set still renders the default theme.

- [ ] **Step 6: Commit (if the smoke test required any fixes)**

```bash
git add -A
git commit -m "fix: address issues found during background-color override smoke test"
```
