# Auth page text contrast + logo/favicon parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compute legible text/button colors on top of the existing per-app page/card background override, with a dedicated vivid error color, and bring logo + favicon branding to parity across all 10 auth pages.

**Architecture:** A new shared `packages/ui/src/lib/auth-colors.ts` module centralizes hex validation, luminance-based contrast calculation, and CSS-rule building; both `AuthCard` and `apps/admin`'s `AuthBackgroundStyle` import it instead of duplicating the logic. The reset-password branding chain (`resolveAppForResetToken` → `PasswordPolicyController` → `getPasswordPolicyForResetToken`) gains `logo`/`favicon` fields to match what every other page's branding fetch already returns. Then each of the 10 pages gets logo and/or favicon threaded through via the same patterns already established for background colors.

**Tech Stack:** React/Next.js App Router, Tailwind CSS custom properties, NestJS/Prisma (auth-server), Jest/Testing Library.

---

## Task 1: Shared `auth-colors` library

**Files:**
- Create: `packages/ui/src/lib/auth-colors.ts`
- Create: `packages/ui/src/lib/__tests__/auth-colors.test.ts`
- Modify: `packages/ui/src/index.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/ui/src/lib/__tests__/auth-colors.test.ts`:

```ts
import { isHexColor, buildAuthColorStyleSheet } from '../auth-colors'

describe('isHexColor', () => {
  it('accepts a valid 6-digit hex with #', () => {
    expect(isHexColor('#0F172A')).toBe(true)
  })
  it('rejects a value with no #', () => {
    expect(isHexColor('0F172A')).toBe(false)
  })
  it('rejects a 3-digit short hex', () => {
    expect(isHexColor('#FFF')).toBe(false)
  })
  it('rejects null/undefined', () => {
    expect(isHexColor(null)).toBe(false)
    expect(isHexColor(undefined)).toBe(false)
  })
  it('rejects a style-tag-breakout attempt', () => {
    expect(isHexColor('</style><script>window.__x=1</script>')).toBe(false)
  })
})

describe('buildAuthColorStyleSheet', () => {
  it('returns no css and no overrides when nothing is set', () => {
    const result = buildAuthColorStyleSheet({})
    expect(result.css).toBe('')
    expect(result.hasPageOverride).toBe(false)
    expect(result.hasCardOverride).toBe(false)
  })

  it('emits page/card background rules when only backgrounds are set (no text/button recolor without both page+card for that mode)', () => {
    const result = buildAuthColorStyleSheet({
      pageLightBackgroundColor: '#490080',
      cardDarkBackgroundColor: '#111111',
    })
    expect(result.hasPageOverride).toBe(true)
    expect(result.hasCardOverride).toBe(true)
    expect(result.css).toContain('[data-auth-page-bg]{background-color:#490080;}')
    expect(result.css).toContain('.dark [data-auth-card-bg]{background-color:#111111;}')
    // Neither mode has BOTH page+card set, so no text/button recolor rules at all.
    expect(result.css).not.toContain('--foreground')
    expect(result.css).not.toContain('.bg-primary')
  })

  it('emits light-mode text/button/error rules when light page+card are both set, independent of dark mode', () => {
    const result = buildAuthColorStyleSheet({
      pageLightBackgroundColor: '#490080', // luminance ~36 -> white contrast
      cardLightBackgroundColor: '#f4ebf9', // luminance ~239 -> black contrast
    })
    expect(result.css).toContain('[data-auth-card-bg]{--foreground:0 0% 0%;--card-foreground:0 0% 0%;--muted-foreground:0 0% 0%;--primary:0 0% 0%;--primary-foreground:0 0% 0%;}')
    expect(result.css).toContain('[data-auth-card-bg] .bg-primary{background-color:#FFFFFF;border:1.5px solid #000000;}')
    expect(result.css).toContain('[data-auth-card-bg] .text-destructive{color:#DC2626;}')
    expect(result.css).not.toContain('.dark [data-auth-card-bg]{--foreground')
  })

  it('emits dark-mode text/button/error rules scoped under .dark when dark page+card are both set', () => {
    const result = buildAuthColorStyleSheet({
      pageDarkBackgroundColor: '#ddb7ff', // luminance ~202 -> black contrast
      cardDarkBackgroundColor: '#490080', // luminance ~36 -> white contrast
    })
    expect(result.css).toContain('.dark [data-auth-card-bg]{--foreground:0 0% 100%;--card-foreground:0 0% 100%;--muted-foreground:0 0% 100%;--primary:0 0% 100%;--primary-foreground:0 0% 100%;}')
    expect(result.css).toContain('.dark [data-auth-card-bg] .bg-primary{background-color:#000000;border:1.5px solid #FFFFFF;}')
    expect(result.css).toContain('.dark [data-auth-card-bg] .text-destructive{color:#FB923C;}')
  })

  it('treats a malformed color the same as unset (no crash, no rule for that side)', () => {
    const result = buildAuthColorStyleSheet({
      pageLightBackgroundColor: 'not-a-color',
      cardLightBackgroundColor: '#f4ebf9',
    })
    expect(result.hasPageOverride).toBe(false)
    expect(result.css).not.toContain('--foreground')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `packages/ui`): `npx jest src/lib/__tests__/auth-colors.test.ts`
Expected: FAIL — module `../auth-colors` doesn't exist.

- [ ] **Step 3: Implement `auth-colors.ts`**

Create `packages/ui/src/lib/auth-colors.ts`:

```ts
/**
 * Shared per-app auth-page color logic: hex validation, luminance-based
 * text/button contrast, and the CSS rules both `AuthCard`
 * (`../components/auth-card.tsx`) and the admin console's
 * `AuthBackgroundStyle` (for the two pages that hand-roll their own
 * page/card wrapper divs instead of using AuthCard) render. Centralized here
 * so the two call sites can't drift out of sync with each other.
 */

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/

/**
 * Rejects anything that isn't a plain 6-digit hex color before it ever
 * reaches a <style> tag's raw text content. `<style>` is a raw-text HTML
 * element, so an unvalidated value containing e.g. `</style>` could
 * prematurely close the tag and let the rest be parsed as markup.
 */
export function isHexColor(value: string | null | undefined): value is string {
  return typeof value === 'string' && HEX_COLOR_PATTERN.test(value)
}

interface Contrast {
  hex: '#000000' | '#FFFFFF'
  hsl: '0 0% 0%' | '0 0% 100%'
}

const BLACK: Contrast = { hex: '#000000', hsl: '0 0% 0%' }
const WHITE: Contrast = { hex: '#FFFFFF', hsl: '0 0% 100%' }

/**
 * Standard luminance threshold (0-255 RGB scale): >128 is light enough for
 * black text/elements to read clearly; otherwise white reads better. No
 * WCAG contrast-ratio math — a simple binary choice, deliberately.
 */
function contrastOf(hex: string): Contrast {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b
  return luminance > 128 ? BLACK : WHITE
}

/**
 * Error/destructive text never uses the computed contrast color — a vivid
 * red or orange, chosen by which contrast bucket the card landed in, keeps
 * it reading as a warning instead of blending in as regular text. Mirrors
 * how this theme's own --destructive token already differs between light
 * and dark mode, just keyed off the card's contrast bucket instead of the
 * viewer's OS theme.
 */
function errorColorFor(cardContrast: Contrast): string {
  return cardContrast.hex === BLACK.hex ? '#DC2626' : '#FB923C'
}

export interface AuthColorOverrides {
  pageLightBackgroundColor?: string | null
  pageDarkBackgroundColor?: string | null
  cardLightBackgroundColor?: string | null
  cardDarkBackgroundColor?: string | null
}

export interface AuthColorStyleSheet {
  css: string
  hasPageOverride: boolean
  hasCardOverride: boolean
}

/**
 * Builds every CSS rule the per-app background/text/button/error color
 * override needs, keyed off the `[data-auth-page-bg]` / `[data-auth-card-bg]`
 * attributes and the `.dark` class next-themes applies to <html>.
 *
 * Background rules apply independently per color that's set. Text/button/
 * error recoloring is stricter: it only activates for a given mode (light or
 * dark) when BOTH that mode's page and card colors are set — a page
 * background with no matching card color has nothing to compute contrast
 * against, so the default theme text/button colors are left alone.
 */
export function buildAuthColorStyleSheet({
  pageLightBackgroundColor,
  pageDarkBackgroundColor,
  cardLightBackgroundColor,
  cardDarkBackgroundColor,
}: AuthColorOverrides): AuthColorStyleSheet {
  const safePageLight = isHexColor(pageLightBackgroundColor) ? pageLightBackgroundColor : undefined
  const safePageDark = isHexColor(pageDarkBackgroundColor) ? pageDarkBackgroundColor : undefined
  const safeCardLight = isHexColor(cardLightBackgroundColor) ? cardLightBackgroundColor : undefined
  const safeCardDark = isHexColor(cardDarkBackgroundColor) ? cardDarkBackgroundColor : undefined

  const pageRules = [
    safePageLight && `[data-auth-page-bg]{background-color:${safePageLight};}`,
    safePageDark && `.dark [data-auth-page-bg]{background-color:${safePageDark};}`,
  ].filter(Boolean) as string[]
  const cardRules = [
    safeCardLight && `[data-auth-card-bg]{background-color:${safeCardLight};}`,
    safeCardDark && `.dark [data-auth-card-bg]{background-color:${safeCardDark};}`,
  ].filter(Boolean) as string[]

  const textRules: string[] = []

  if (safePageLight && safeCardLight) {
    const cardContrast = contrastOf(safeCardLight)
    const pageContrast = contrastOf(safePageLight)
    const errorColor = errorColorFor(cardContrast)
    textRules.push(
      `[data-auth-card-bg]{--foreground:${cardContrast.hsl};--card-foreground:${cardContrast.hsl};--muted-foreground:${cardContrast.hsl};--primary:${cardContrast.hsl};--primary-foreground:${cardContrast.hsl};}`,
      `[data-auth-card-bg] .bg-primary{background-color:${pageContrast.hex};border:1.5px solid ${cardContrast.hex};}`,
      `[data-auth-card-bg] .text-destructive{color:${errorColor};}`,
    )
  }

  if (safePageDark && safeCardDark) {
    const cardContrast = contrastOf(safeCardDark)
    const pageContrast = contrastOf(safePageDark)
    const errorColor = errorColorFor(cardContrast)
    textRules.push(
      `.dark [data-auth-card-bg]{--foreground:${cardContrast.hsl};--card-foreground:${cardContrast.hsl};--muted-foreground:${cardContrast.hsl};--primary:${cardContrast.hsl};--primary-foreground:${cardContrast.hsl};}`,
      `.dark [data-auth-card-bg] .bg-primary{background-color:${pageContrast.hex};border:1.5px solid ${cardContrast.hex};}`,
      `.dark [data-auth-card-bg] .text-destructive{color:${errorColor};}`,
    )
  }

  return {
    css: [...pageRules, ...cardRules, ...textRules].join(''),
    hasPageOverride: pageRules.length > 0,
    hasCardOverride: cardRules.length > 0,
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run (from `packages/ui`): `npx jest src/lib/__tests__/auth-colors.test.ts`
Expected: PASS (all 11 tests).

- [ ] **Step 5: Export from the package index**

In `packages/ui/src/index.ts`, add (after the `cn` export at the top):

```ts
export { isHexColor, buildAuthColorStyleSheet, type AuthColorOverrides, type AuthColorStyleSheet } from './lib/auth-colors'
```

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/lib/auth-colors.ts packages/ui/src/lib/__tests__/auth-colors.test.ts packages/ui/src/index.ts
git commit -m "feat(ui): add shared auth-colors lib (hex validation, contrast calc, CSS rules)"
```

---

## Task 2: `AuthCard` uses the shared library

**Files:**
- Modify: `packages/ui/src/components/auth-card.tsx`
- Modify: `packages/ui/src/__tests__/auth-card.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add to `packages/ui/src/__tests__/auth-card.test.tsx`:

```tsx
it('recolors card text, links, and the button, and outlines the button, when both light-mode colors are set', () => {
  const { container } = render(
    <AuthCard
      title="Hi"
      pageLightBackgroundColor="#490080"
      cardLightBackgroundColor="#f4ebf9"
      footer={<a className="text-primary" href="#">Link</a>}
    >
      <button className="bg-primary text-primary-foreground">Go</button>
    </AuthCard>,
  )
  const style = container.querySelector('style')
  expect(style?.textContent).toContain('[data-auth-card-bg]{--foreground:0 0% 0%')
  expect(style?.textContent).toContain('[data-auth-card-bg] .bg-primary{background-color:#FFFFFF;border:1.5px solid #000000;}')
})

it('gives error text a dedicated vivid color instead of the computed contrast', () => {
  const { container } = render(
    <AuthCard
      title="Hi"
      pageLightBackgroundColor="#490080"
      cardLightBackgroundColor="#f4ebf9"
    />,
  )
  expect(container.querySelector('style')?.textContent).toContain('[data-auth-card-bg] .text-destructive{color:#DC2626;}')
})

it('does not recolor text/button when only one of page/card light colors is set', () => {
  const { container } = render(
    <AuthCard title="Hi" pageLightBackgroundColor="#490080" />,
  )
  expect(container.querySelector('style')?.textContent ?? '').not.toContain('--foreground')
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `packages/ui`): `npx jest src/__tests__/auth-card.test.tsx -t "recolors"`
Expected: FAIL — `AuthCard` doesn't emit these rules yet.

- [ ] **Step 3: Implement — delegate to `buildAuthColorStyleSheet`**

Replace the full contents of `packages/ui/src/components/auth-card.tsx` with:

```tsx
import * as React from 'react'
import { cn } from '../lib/utils'
import { buildAuthColorStyleSheet } from '../lib/auth-colors'
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
   * back to the existing bg-background/bg-card theme default. When a mode
   * has BOTH its page and card color set, text/links/button colors and the
   * button's background are also recomputed for contrast against that
   * mode's card/page — see `buildAuthColorStyleSheet`. Rendered via a
   * scoped <style> block keyed off the `.dark` class next-themes already
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

  const { css, hasPageOverride, hasCardOverride } = buildAuthColorStyleSheet({
    pageLightBackgroundColor,
    pageDarkBackgroundColor,
    cardLightBackgroundColor,
    cardDarkBackgroundColor,
  })

  return (
    <div
      className={cn('flex min-h-screen items-center justify-center bg-background p-6')}
      {...(hasPageOverride ? { 'data-auth-page-bg': '' } : {})}
    >
      {css && <style>{css}</style>}
      <Card
        className={cn('w-full max-w-sm', className)}
        {...(hasCardOverride ? { 'data-auth-card-bg': '' } : {})}
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

- [ ] **Step 4: Run the full `auth-card.test.tsx` file to verify everything passes**

Run (from `packages/ui`): `npx jest src/__tests__/auth-card.test.tsx`
Expected: PASS — all pre-existing tests (background colors, malformed-value guard, etc.) plus the 3 new ones.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/auth-card.tsx packages/ui/src/__tests__/auth-card.test.tsx
git commit -m "feat(ui): AuthCard computes text/button contrast colors via shared auth-colors lib"
```

---

## Task 3: `AuthBackgroundStyle` uses the shared library

**Files:**
- Modify: `apps/admin/components/auth-background-style.tsx`
- Modify: `apps/admin/components/__tests__/auth-background-style.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add to `apps/admin/components/__tests__/auth-background-style.test.tsx`:

```tsx
it('emits text/button/error contrast rules when both light-mode colors are set', () => {
  const { container } = render(
    <AuthBackgroundStyle pageLightBackgroundColor="#490080" cardLightBackgroundColor="#f4ebf9" />,
  )
  const text = container.querySelector('style')?.textContent ?? ''
  expect(text).toContain('[data-auth-card-bg]{--foreground:0 0% 0%')
  expect(text).toContain('[data-auth-card-bg] .bg-primary{background-color:#FFFFFF;border:1.5px solid #000000;}')
  expect(text).toContain('[data-auth-card-bg] .text-destructive{color:#DC2626;}')
})
```

- [ ] **Step 2: Run it to verify it fails**

Run (from `apps/admin`): `npx jest components/__tests__/auth-background-style.test.tsx -t "emits text"`
Expected: FAIL.

- [ ] **Step 3: Implement — delegate to the shared lib instead of duplicating it**

Replace the full contents of `apps/admin/components/auth-background-style.tsx` with:

```tsx
import { buildAuthColorStyleSheet, type AuthColorOverrides } from '@sassy-auth/ui'

/**
 * Renders the same per-app background/text/button/error color override
 * `@sassy-auth/ui`'s AuthCard renders internally (see
 * `packages/ui/src/components/auth-card.tsx` and the shared
 * `packages/ui/src/lib/auth-colors.ts` module both of them now call), for
 * the two pages (`TwoFactorForm`, `TwoFactorPromptClient`) that hand-roll
 * their own page/card wrapper `<div>`s instead of using `AuthCard`.
 */
export type AuthBackgroundStyleProps = AuthColorOverrides

export function AuthBackgroundStyle(props: AuthBackgroundStyleProps) {
  const { css } = buildAuthColorStyleSheet(props)
  if (!css) return null
  return <style>{css}</style>
}
```

- [ ] **Step 4: Run the full file to verify everything passes**

Run (from `apps/admin`): `npx jest components/__tests__/auth-background-style.test.tsx`
Expected: PASS — all pre-existing tests plus the new one.

- [ ] **Step 5: Run a broader sweep**

Run (from `apps/admin`): `npx jest two-factor`
Expected: PASS — `TwoFactorForm`/`TwoFactorPromptClient` render unaffected (same props, same component, now backed by the shared lib instead of a local duplicate).

- [ ] **Step 6: Commit**

```bash
git add apps/admin/components/auth-background-style.tsx apps/admin/components/__tests__/auth-background-style.test.tsx
git commit -m "refactor(admin): AuthBackgroundStyle delegates to the shared @sassy-auth/ui auth-colors lib"
```

---

## Task 4: Reset-password branding gains logo + favicon

**Files:**
- Modify: `apps/auth-server/src/auth/resolve-app-for-reset-token.ts`
- Modify: `apps/auth-server/src/auth/resolve-app-for-reset-token.spec.ts`
- Modify: `apps/auth-server/src/auth/password-policy.controller.ts`
- Modify: `apps/auth-server/src/auth/password-policy.controller.spec.ts`
- Modify: `apps/admin/lib/api-public.ts`

This is a prerequisite for Tasks 8 and 18 (the reset-password page is the only
one of the 10 whose branding doesn't already include `logo`/`favicon`,
because its branding comes through the password-policy lookup rather than
`fetchAppInfo`/`fetchSocialProviders`/`fetchAppBranding`).

- [ ] **Step 1: Write the failing test for `resolveAppForResetToken`**

In `apps/auth-server/src/auth/resolve-app-for-reset-token.spec.ts`, add:

```ts
it('includes logo and favicon', async () => {
  const prisma = {
    verification: { findFirst: jest.fn().mockResolvedValue({ value: 'ba-user-1' }) },
    saUser: { findFirst: jest.fn().mockResolvedValue({ org: { appId: 1 } }) },
    saApp: {
      findUnique: jest.fn().mockResolvedValue({
        id: 1,
        passwordPolicyOverride: null,
        pageLightBackgroundColor: null,
        pageDarkBackgroundColor: null,
        cardLightBackgroundColor: null,
        cardDarkBackgroundColor: null,
        logo: 'data:image/png;base64,AAA=',
        favicon: 'data:image/png;base64,FFF=',
      }),
    },
  };

  const result = await resolveAppForResetToken(prisma as never, 'token-1');

  expect(result?.logo).toBe('data:image/png;base64,AAA=');
  expect(result?.favicon).toBe('data:image/png;base64,FFF=');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run (from `apps/auth-server`, with `DATABASE_URL="postgresql://betterauth_admin:betterauth@localhost:5432/sassyauth_0.1" OTEL_SDK_DISABLED=true`): `npx jest src/auth/resolve-app-for-reset-token.spec.ts -t "logo and favicon"`
Expected: FAIL.

- [ ] **Step 3: Implement — extend `resolveAppForResetToken`**

In `apps/auth-server/src/auth/resolve-app-for-reset-token.ts`, change the return type and `select`:

```ts
export async function resolveAppForResetToken(
  prisma: Pick<PrismaClient, 'verification' | 'saUser' | 'saApp'>,
  token: string,
): Promise<{
  id: number;
  passwordPolicyOverride: unknown;
  pageLightBackgroundColor: string | null;
  pageDarkBackgroundColor: string | null;
  cardLightBackgroundColor: string | null;
  cardDarkBackgroundColor: string | null;
  logo: string | null;
  favicon: string | null;
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
      id: true,
      passwordPolicyOverride: true,
      pageLightBackgroundColor: true,
      pageDarkBackgroundColor: true,
      cardLightBackgroundColor: true,
      cardDarkBackgroundColor: true,
      logo: true,
      favicon: true,
    },
  });
}
```

- [ ] **Step 4: Run it to verify it passes**

Run (from `apps/auth-server`): `npx jest src/auth/resolve-app-for-reset-token.spec.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing test for `PasswordPolicyController`**

In `apps/auth-server/src/auth/password-policy.controller.spec.ts`, add a test mocking `resolveAppForResetToken` to resolve with `logo`/`favicon` set, asserting the controller's response includes them (mirror this file's existing test style for the 4 color fields).

- [ ] **Step 6: Run it to verify it fails**

Run (from `apps/auth-server`): `npx jest src/auth/password-policy.controller.spec.ts -t "logo"`
Expected: FAIL.

- [ ] **Step 7: Implement — extend `PasswordPolicyController`**

Replace the full contents of `apps/auth-server/src/auth/password-policy.controller.ts` with:

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
 * policy and all-null branding (never a 404/error) for a missing or
 * unresolvable resetToken: the page still needs something to render, and
 * the hooks.before matcher in auth.config.ts is the actual enforcement at
 * submit time regardless of what this endpoint showed beforehand.
 */
@ApiTags('Password Policy')
@Controller('password-policy')
export class PasswordPolicyController {
  @Get()
  async get(@Query('resetToken') resetToken?: string): Promise<{
    passwordPolicy: PasswordPolicy;
    pageLightBackgroundColor: string | null;
    pageDarkBackgroundColor: string | null;
    cardLightBackgroundColor: string | null;
    cardDarkBackgroundColor: string | null;
    logo: string | null;
    favicon: string | null;
  }> {
    if (!resetToken) {
      return {
        passwordPolicy: getGlobalPasswordPolicy(process.env),
        pageLightBackgroundColor: null,
        pageDarkBackgroundColor: null,
        cardLightBackgroundColor: null,
        cardDarkBackgroundColor: null,
        logo: null,
        favicon: null,
      };
    }
    const app = await resolveAppForResetToken(prisma, resetToken);
    return {
      passwordPolicy: resolvePasswordPolicy(app ?? { passwordPolicyOverride: null }),
      pageLightBackgroundColor: app?.pageLightBackgroundColor ?? null,
      pageDarkBackgroundColor: app?.pageDarkBackgroundColor ?? null,
      cardLightBackgroundColor: app?.cardLightBackgroundColor ?? null,
      cardDarkBackgroundColor: app?.cardDarkBackgroundColor ?? null,
      logo: app?.logo ?? null,
      favicon: app?.favicon ?? null,
    };
  }
}
```

- [ ] **Step 8: Run it to verify it passes**

Run (from `apps/auth-server`): `npx jest src/auth/password-policy.controller.spec.ts`
Expected: PASS.

- [ ] **Step 9: Extend `api-public.ts`'s `PasswordPolicyAndBranding`**

In `apps/admin/lib/api-public.ts`, change:

```ts
export interface PasswordPolicyAndBranding {
  passwordPolicy: PasswordPolicy
  pageLightBackgroundColor: string | null
  pageDarkBackgroundColor: string | null
  cardLightBackgroundColor: string | null
  cardDarkBackgroundColor: string | null
}
```

to:

```ts
export interface PasswordPolicyAndBranding {
  passwordPolicy: PasswordPolicy
  pageLightBackgroundColor: string | null
  pageDarkBackgroundColor: string | null
  cardLightBackgroundColor: string | null
  cardDarkBackgroundColor: string | null
  logo: string | null
  favicon: string | null
}
```

(`getPasswordPolicyForResetToken`'s body — `return res.json()` — needs no change, since it already passes through whatever the endpoint returns; only the type annotation needs the 2 new fields so callers get them typed.)

- [ ] **Step 10: Run a broader sweep**

Run (from `apps/auth-server`): `npx jest src/auth` (with `DATABASE_URL` set). Run (from `apps/admin`): `npx jest app/reset-password`.
Expected: PASS. If `ResetPasswordForm`'s existing test mocks `getPasswordPolicyForResetToken`'s resolved value with an object literal that doesn't include `logo`/`favicon`, that's fine — TypeScript structural typing on a test mock doesn't require every field unless something destructures and asserts on it; this step is to confirm nothing breaks at runtime, not to force a test update.

- [ ] **Step 11: Commit**

```bash
git add apps/auth-server/src/auth/resolve-app-for-reset-token.ts apps/auth-server/src/auth/resolve-app-for-reset-token.spec.ts apps/auth-server/src/auth/password-policy.controller.ts apps/auth-server/src/auth/password-policy.controller.spec.ts apps/admin/lib/api-public.ts
git commit -m "feat(reset-password): include logo and favicon in the password-policy branding lookup"
```

---

## Task 5: Logo on `/signup/check-email`

**Files:**
- Modify: `apps/admin/app/signup/check-email/page.tsx`
- Modify: `apps/admin/app/signup/check-email/check-email-card.tsx`
- Modify: `apps/admin/app/signup/check-email/__tests__/page.test.tsx`
- Modify: `apps/admin/app/signup/check-email/__tests__/check-email-card.test.tsx`

- [ ] **Step 1: Write the failing test for `CheckEmailCard`**

Add to `apps/admin/app/signup/check-email/__tests__/check-email-card.test.tsx`:

```tsx
it('renders the app logo when provided', () => {
  const { container } = render(
    <CheckEmailCard email="a@b.com" next="" authServerUrl="https://auth.test" logo="data:image/png;base64,AAA=" />,
  )
  expect(container.querySelector('img')).toHaveAttribute('src', 'data:image/png;base64,AAA=')
})
```

- [ ] **Step 2: Run it to verify it fails**

Run (from `apps/admin`): `npx jest app/signup/check-email/__tests__/check-email-card.test.tsx -t "logo"`
Expected: FAIL — `CheckEmailCard` doesn't accept a `logo` prop yet.

- [ ] **Step 3: Implement — `CheckEmailCard`**

In `apps/admin/app/signup/check-email/check-email-card.tsx`, add `logo` to the props (after `authServerUrl`):

```tsx
export function CheckEmailCard({
  email,
  next,
  authServerUrl,
  logo = null,
  pageLightBackgroundColor = null,
  pageDarkBackgroundColor = null,
  cardLightBackgroundColor = null,
  cardDarkBackgroundColor = null,
}: {
  email: string
  next: string
  authServerUrl: string
  logo?: string | null
  pageLightBackgroundColor?: string | null
  pageDarkBackgroundColor?: string | null
  cardLightBackgroundColor?: string | null
  cardDarkBackgroundColor?: string | null
}) {
```

and add `logoUrl={logo}` to the `<AuthCard>` call (after `title={t('title')}`):

```tsx
    <AuthCard
      title={t('title')}
      logoUrl={logo}
      subtitle={t('subtitle', { email })}
```

- [ ] **Step 4: Implement — `page.tsx`**

In `apps/admin/app/signup/check-email/page.tsx`, add `logoUrl={branding.logo}` to the `!email` branch's `<AuthCard>` call (after `title={t('title')}`) and `logo={branding.logo}` to the `<CheckEmailCard>` call (after `authServerUrl={PUBLIC_AUTH_SERVER}`):

```tsx
  if (!email) {
    return (
      <AuthCard
        title={t('title')}
        logoUrl={branding.logo}
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
      logo={branding.logo}
      pageLightBackgroundColor={branding.pageLightBackgroundColor}
      pageDarkBackgroundColor={branding.pageDarkBackgroundColor}
      cardLightBackgroundColor={branding.cardLightBackgroundColor}
      cardDarkBackgroundColor={branding.cardDarkBackgroundColor}
    />
  )
```

- [ ] **Step 5: Run the tests to verify they pass**

Run (from `apps/admin`): `npx jest app/signup/check-email`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/app/signup/check-email
git commit -m "feat(signup): show the app logo on the check-email page"
```

---

## Task 6: Logo on `/signup/verified` + link-expired

**Files:**
- Modify: `apps/admin/app/signup/verified/page.tsx`
- Modify: `apps/admin/app/signup/verified/link-expired-card.tsx`

- [ ] **Step 1: Write the failing test**

In `apps/admin/app/signup/verified/__tests__` (find the existing test file covering `LinkExpiredCard` — likely `link-expired-card.test.tsx`; if none exists, add this case to `page.test.tsx` instead, rendering the `TOKEN_EXPIRED` branch), add:

```tsx
it('renders the app logo when provided', () => {
  const { container } = render(
    <LinkExpiredCard email="a@b.com" authServerUrl="https://auth.test" logo="data:image/png;base64,AAA=" />,
  )
  expect(container.querySelector('img')).toHaveAttribute('src', 'data:image/png;base64,AAA=')
})
```

- [ ] **Step 2: Run it to verify it fails**

Run (from `apps/admin`): `npx jest app/signup/verified -t "logo"`
Expected: FAIL.

- [ ] **Step 3: Implement — `LinkExpiredCard`**

In `apps/admin/app/signup/verified/link-expired-card.tsx`, add `logo` to the props (after `authServerUrl`):

```tsx
export function LinkExpiredCard({
  email,
  authServerUrl,
  logo = null,
  pageLightBackgroundColor = null,
  pageDarkBackgroundColor = null,
  cardLightBackgroundColor = null,
  cardDarkBackgroundColor = null,
}: {
  email: string
  authServerUrl: string
  logo?: string | null
  pageLightBackgroundColor?: string | null
  pageDarkBackgroundColor?: string | null
  cardLightBackgroundColor?: string | null
  cardDarkBackgroundColor?: string | null
}) {
```

and add `logoUrl={logo}` to its `<AuthCard>` call (after `title={t('title')}`):

```tsx
    <AuthCard
      title={t('title')}
      logoUrl={logo}
      subtitle={t('subtitle', { email })}
```

- [ ] **Step 4: Implement — `page.tsx`**

In `apps/admin/app/signup/verified/page.tsx`, add `logoUrl={branding.logo}` / `logo={branding.logo}` to all three branches. The `LinkExpiredCard` call becomes:

```tsx
    return (
      <LinkExpiredCard
        email={email}
        authServerUrl={PUBLIC_AUTH_SERVER}
        logo={branding.logo}
        pageLightBackgroundColor={branding.pageLightBackgroundColor}
        pageDarkBackgroundColor={branding.pageDarkBackgroundColor}
        cardLightBackgroundColor={branding.cardLightBackgroundColor}
        cardDarkBackgroundColor={branding.cardDarkBackgroundColor}
      />
    )
```

the generic `error` branch's `<AuthCard>` becomes:

```tsx
      <AuthCard
        title={t('signup.verified.invalid.title')}
        logoUrl={branding.logo}
        subtitle={t('signup.verified.invalid.subtitle')}
```

(leave the rest of that branch — props and children — exactly as-is), and the success branch's `<AuthCard>` becomes:

```tsx
    <AuthCard
      title={t('signup.verified.title')}
      logoUrl={branding.logo}
      subtitle={t('signup.verified.subtitle')}
```

(leave `icon`, `footer`, and everything else in that branch unchanged).

- [ ] **Step 5: Run the tests to verify they pass**

Run (from `apps/admin`): `npx jest app/signup/verified`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/app/signup/verified
git commit -m "feat(signup): show the app logo on the verified and link-expired pages"
```

---

## Task 7: Logo on `/login/consent`

**Files:**
- Modify: `apps/admin/app/login/consent/page.tsx`

- [ ] **Step 1: Implement**

In `apps/admin/app/login/consent/page.tsx`, add `logoUrl={branding.logo}` to the `<AuthCard>` call (after `title={t('loginConsent.title')}`):

```tsx
  return (
    <AuthCard
      title={t('loginConsent.title')}
      logoUrl={branding.logo}
      className="max-w-md"
      pageLightBackgroundColor={branding.pageLightBackgroundColor}
      pageDarkBackgroundColor={branding.pageDarkBackgroundColor}
      cardLightBackgroundColor={branding.cardLightBackgroundColor}
      cardDarkBackgroundColor={branding.cardDarkBackgroundColor}
    >
```

- [ ] **Step 2: Run the consent test suite**

Run (from `apps/admin`): `npx jest login/consent`
Expected: PASS.

- [ ] **Step 3: Run a broader sweep**

Run (from `apps/admin`): `npx jest app/login`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/app/login/consent/page.tsx
git commit -m "feat(login): show the app logo on the consent page"
```

---

## Task 8: Logo on `/reset-password`

**Files:**
- Modify: `apps/admin/app/reset-password/reset-password-form.tsx`

Depends on Task 4 (the branding fetch this page uses now includes `logo`).

- [ ] **Step 1: Implement**

In `apps/admin/app/reset-password/reset-password-form.tsx`, change the `branding` state's type and initial value to include `logo` (the `useState` call currently typed with only the 4 color fields):

```tsx
  const [branding, setBranding] = React.useState<{
    pageLightBackgroundColor: string | null
    pageDarkBackgroundColor: string | null
    cardLightBackgroundColor: string | null
    cardDarkBackgroundColor: string | null
    logo: string | null
  }>({
    pageLightBackgroundColor: null,
    pageDarkBackgroundColor: null,
    cardLightBackgroundColor: null,
    cardDarkBackgroundColor: null,
    logo: null,
  })
```

(the `.then((fetched) => { setPolicy(fetched.passwordPolicy); setBranding(fetched) })` effect body needs no change — `fetched` already carries `logo` per Task 4's extension of `PasswordPolicyAndBranding`, and `setBranding(fetched)` already passes the whole object through.)

Add `logoUrl={branding.logo}` to both `<AuthCard>` calls. The `success` branch's call becomes:

```tsx
      <AuthCard
        logoUrl={branding.logo}
        footer={
```

and the main form branch's call becomes:

```tsx
    <AuthCard
      title={t('title')}
      logoUrl={branding.logo}
      pageLightBackgroundColor={branding.pageLightBackgroundColor}
```

- [ ] **Step 2: Run the reset-password test suite**

Run (from `apps/admin`): `npx jest app/reset-password`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/admin/app/reset-password/reset-password-form.tsx
git commit -m "feat(reset-password): show the app logo"
```

---

## Task 9: Logo on `/login/two-factor`

**Files:**
- Modify: `apps/admin/app/login/two-factor/TwoFactorForm.tsx`
- Modify: `apps/admin/app/login/two-factor/page.tsx`

`TwoFactorForm` doesn't use `AuthCard`, so it gets a small hand-built logo
block mirroring `AuthCard`'s own logo markup (`max-h-12 object-contain`,
centered, `mb-4` wrapper) rather than a `logoUrl` prop on a component that
doesn't exist here.

- [ ] **Step 1: Implement — `TwoFactorForm`**

In `apps/admin/app/login/two-factor/TwoFactorForm.tsx`, add `logo` to the props (after `trustDays`):

```tsx
export function TwoFactorForm({
  next,
  trustDays = 14,
  logo = null,
  pageLightBackgroundColor = null,
  pageDarkBackgroundColor = null,
  cardLightBackgroundColor = null,
  cardDarkBackgroundColor = null,
}: {
  next: string
  trustDays?: number
  logo?: string | null
  pageLightBackgroundColor?: string | null
  pageDarkBackgroundColor?: string | null
  cardLightBackgroundColor?: string | null
  cardDarkBackgroundColor?: string | null
}) {
```

and add the logo block inside the card wrapper div, immediately before the existing `<div className="mb-6 text-center">` title block:

```tsx
      <div
        className="w-full max-w-sm rounded-lg border border-[var(--border)] bg-[var(--card)] p-8 shadow-sm"
        data-auth-card-bg=""
      >
        {logo && (
          <div className="mb-4 flex justify-center">
            <img src={logo} alt="" className="max-h-12 object-contain" />
          </div>
        )}
        <div className="mb-6 text-center">
```

- [ ] **Step 2: Implement — `page.tsx`**

In `apps/admin/app/login/two-factor/page.tsx`, add `logo={branding.logo}` to the `<TwoFactorForm>` call (after `trustDays={trustDays}`):

```tsx
  return (
    <TwoFactorForm
      next={nextSafe ?? ''}
      trustDays={trustDays}
      logo={branding.logo}
      pageLightBackgroundColor={branding.pageLightBackgroundColor}
```

- [ ] **Step 3: Run the two-factor test suite**

Run (from `apps/admin`): `npx jest two-factor`
Expected: PASS — existing tests render unaffected since `logo` defaults to `null` (no image rendered).

- [ ] **Step 4: Commit**

```bash
git add apps/admin/app/login/two-factor
git commit -m "feat(login): show the app logo on the two-factor page"
```

---

## Task 10: Logo on `/login/two-factor-prompt`

**Files:**
- Modify: `apps/admin/app/login/two-factor-prompt/TwoFactorPromptClient.tsx`
- Modify: `apps/admin/app/login/two-factor-prompt/page.tsx`

- [ ] **Step 1: Implement — `TwoFactorPromptClient`**

In `apps/admin/app/login/two-factor-prompt/TwoFactorPromptClient.tsx`, add `logo` to `Props` and the destructured parameters:

```tsx
interface Props {
  next: string
  logo?: string | null
  pageLightBackgroundColor?: string | null
  pageDarkBackgroundColor?: string | null
  cardLightBackgroundColor?: string | null
  cardDarkBackgroundColor?: string | null
}

export function TwoFactorPromptClient({
  next,
  logo = null,
  pageLightBackgroundColor = null,
  pageDarkBackgroundColor = null,
  cardLightBackgroundColor = null,
  cardDarkBackgroundColor = null,
}: Props) {
```

and add the same logo block used in Task 9, immediately before the existing `<h1 className="text-headline-sm text-[var(--foreground)]">{t('title')}</h1>` line, inside the card wrapper div:

```tsx
      <div
        className="w-full max-w-sm rounded-lg border border-[var(--border)] bg-[var(--card)] p-8 shadow-sm text-center space-y-4"
        data-auth-card-bg=""
      >
        {logo && (
          <div className="flex justify-center">
            <img src={logo} alt="" className="max-h-12 object-contain" />
          </div>
        )}
        <h1 className="text-headline-sm text-[var(--foreground)]">{t('title')}</h1>
```

(Note: this wrapper already uses `space-y-4` for vertical spacing between children, unlike `TwoFactorForm`'s explicit `mb-4`/`mb-6` margins — the logo block above uses no `mb-*` class so it relies on the parent's `space-y-4` for consistent spacing, matching this file's existing convention.)

- [ ] **Step 2: Implement — `page.tsx`**

In `apps/admin/app/login/two-factor-prompt/page.tsx`, add `logo={branding.logo}` to the `<TwoFactorPromptClient>` call (after `next={nextSafe ?? ''}`):

```tsx
  return (
    <TwoFactorPromptClient
      next={nextSafe ?? ''}
      logo={branding.logo}
      pageLightBackgroundColor={branding.pageLightBackgroundColor}
```

- [ ] **Step 3: Run the two-factor-prompt test suite**

Run (from `apps/admin`): `npx jest two-factor-prompt`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/app/login/two-factor-prompt
git commit -m "feat(login): show the app logo on the two-factor-prompt page"
```

---

## Task 11: Favicon on `/signup/check-email`

**Files:**
- Modify: `apps/admin/app/signup/check-email/page.tsx`

- [ ] **Step 1: Implement**

In `apps/admin/app/signup/check-email/page.tsx`, add the `Metadata` import and a `generateMetadata` export (before the default export), following the exact pattern already used in `apps/admin/app/signup/page.tsx`:

```tsx
import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { AuthCard } from '@sassy-auth/ui'
import { fetchAppBranding } from '@/lib/app-branding'
import { CheckEmailCard } from './check-email-card'

export const dynamic = 'force-dynamic'

const PUBLIC_AUTH_SERVER =
  process.env.PUBLIC_AUTH_SERVER_URL ?? process.env.AUTH_SERVER_URL ?? 'https://localhost:3010'

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ client_id?: string }>
}): Promise<Metadata> {
  const { client_id: clientId } = await searchParams
  if (!clientId) return {}
  const { favicon } = await fetchAppBranding(clientId)
  return favicon ? { icons: { icon: favicon } } : {}
}

export default async function CheckEmailPage({
```

(leave the rest of the file — the default export's body — unchanged; this only adds the new `generateMetadata` export and its `Metadata` import above it.)

- [ ] **Step 2: Run the test suite**

Run (from `apps/admin`): `npx jest app/signup/check-email`
Expected: PASS — no existing test calls `generateMetadata`, so this is additive and shouldn't break anything; confirms nothing else broke.

- [ ] **Step 3: Commit**

```bash
git add apps/admin/app/signup/check-email/page.tsx
git commit -m "feat(signup): set the app favicon on the check-email page"
```

---

## Task 12: Favicon on `/signup/verified`

**Files:**
- Modify: `apps/admin/app/signup/verified/page.tsx`

- [ ] **Step 1: Implement**

In `apps/admin/app/signup/verified/page.tsx`, add the `Metadata` import and a `generateMetadata` export (before the default export):

```tsx
import type { Metadata } from 'next'
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

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ client_id?: string }>
}): Promise<Metadata> {
  const { client_id: clientId } = await searchParams
  if (!clientId) return {}
  const { favicon } = await fetchAppBranding(clientId)
  return favicon ? { icons: { icon: favicon } } : {}
}

export default async function SignupVerifiedPage({
```

- [ ] **Step 2: Run the test suite**

Run (from `apps/admin`): `npx jest app/signup/verified`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/admin/app/signup/verified/page.tsx
git commit -m "feat(signup): set the app favicon on the verified page"
```

---

## Task 13: Favicon on `/login/code`

**Files:**
- Modify: `apps/admin/app/login/code/page.tsx`

- [ ] **Step 1: Implement**

Replace the full contents of `apps/admin/app/login/code/page.tsx` with:

```tsx
import type { Metadata } from 'next'
import { validateNextUrl } from '@/lib/safe-next'
import { clientIdFromNext } from '@/lib/client-id-from-next'
import { fetchAppBranding } from '@/lib/app-branding'
import { LoginOtpForm } from '../login-otp-form'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}): Promise<Metadata> {
  const { next } = await searchParams
  const nextSafe = validateNextUrl(next)
  const clientId = clientIdFromNext(nextSafe ?? '')
  if (!clientId) return {}
  const { favicon } = await fetchAppBranding(clientId)
  return favicon ? { icons: { icon: favicon } } : {}
}

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
      logo={branding.logo}
      pageLightBackgroundColor={branding.pageLightBackgroundColor}
      pageDarkBackgroundColor={branding.pageDarkBackgroundColor}
      cardLightBackgroundColor={branding.cardLightBackgroundColor}
      cardDarkBackgroundColor={branding.cardDarkBackgroundColor}
    />
  )
}
```

- [ ] **Step 2: Run the login test suite**

Run (from `apps/admin`): `npx jest app/login`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/admin/app/login/code/page.tsx
git commit -m "feat(login): set the app favicon on the OTP login page"
```

---

## Task 14: Favicon on `/login/two-factor`

**Files:**
- Modify: `apps/admin/app/login/two-factor/page.tsx`

- [ ] **Step 1: Implement**

Replace the full contents of `apps/admin/app/login/two-factor/page.tsx` with:

```tsx
import type { Metadata } from 'next'
import { validateNextUrl } from '@/lib/safe-next'
import { getSystemTrustDaysClient } from '@/lib/two-factor-prompt'
import { clientIdFromNext } from '@/lib/client-id-from-next'
import { fetchAppBranding } from '@/lib/app-branding'
import { TwoFactorForm } from './TwoFactorForm'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}): Promise<Metadata> {
  const { next } = await searchParams
  const nextSafe = validateNextUrl(next)
  const clientId = clientIdFromNext(nextSafe ?? '')
  if (!clientId) return {}
  const { favicon } = await fetchAppBranding(clientId)
  return favicon ? { icons: { icon: favicon } } : {}
}

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
      logo={branding.logo}
      pageLightBackgroundColor={branding.pageLightBackgroundColor}
      pageDarkBackgroundColor={branding.pageDarkBackgroundColor}
      cardLightBackgroundColor={branding.cardLightBackgroundColor}
      cardDarkBackgroundColor={branding.cardDarkBackgroundColor}
    />
  )
}
```

- [ ] **Step 2: Run the two-factor test suite**

Run (from `apps/admin`): `npx jest two-factor`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/admin/app/login/two-factor/page.tsx
git commit -m "feat(login): set the app favicon on the two-factor page"
```

---

## Task 15: Favicon on `/login/two-factor-prompt`

**Files:**
- Modify: `apps/admin/app/login/two-factor-prompt/page.tsx`

- [ ] **Step 1: Implement**

Replace the full contents of `apps/admin/app/login/two-factor-prompt/page.tsx` with:

```tsx
import type { Metadata } from 'next'
import { validateNextUrl } from '@/lib/safe-next'
import { clientIdFromNext } from '@/lib/client-id-from-next'
import { fetchAppBranding } from '@/lib/app-branding'
import { TwoFactorPromptClient } from './TwoFactorPromptClient'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}): Promise<Metadata> {
  const { next } = await searchParams
  const nextSafe = validateNextUrl(next)
  const clientId = clientIdFromNext(nextSafe ?? '')
  if (!clientId) return {}
  const { favicon } = await fetchAppBranding(clientId)
  return favicon ? { icons: { icon: favicon } } : {}
}

export default async function TwoFactorPromptPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const params = await searchParams
  const nextSafe = validateNextUrl(params.next)
  const branding = await fetchAppBranding(clientIdFromNext(nextSafe ?? ''))
  return (
    <TwoFactorPromptClient
      next={nextSafe ?? ''}
      logo={branding.logo}
      pageLightBackgroundColor={branding.pageLightBackgroundColor}
      pageDarkBackgroundColor={branding.pageDarkBackgroundColor}
      cardLightBackgroundColor={branding.cardLightBackgroundColor}
      cardDarkBackgroundColor={branding.cardDarkBackgroundColor}
    />
  )
}
```

- [ ] **Step 2: Run the two-factor-prompt test suite**

Run (from `apps/admin`): `npx jest two-factor-prompt`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/admin/app/login/two-factor-prompt/page.tsx
git commit -m "feat(login): set the app favicon on the two-factor-prompt page"
```

---

## Task 16: Favicon on `/login/consent`

**Files:**
- Modify: `apps/admin/app/login/consent/page.tsx`

- [ ] **Step 1: Implement**

In `apps/admin/app/login/consent/page.tsx`, add the `Metadata` import and a `generateMetadata` export (before the default export):

```tsx
import type { Metadata } from 'next'
import { AuthCard } from '@sassy-auth/ui'
import { getTranslations } from 'next-intl/server'
import { redirect } from 'next/navigation'
import { fetchAppBranding } from '@/lib/app-branding'
import { fetchOutstandingConsent } from '@/lib/consent'
import { validateNextUrl } from '@/lib/safe-next'
import { ConsentGateClient } from './ConsentGateClient'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ appPublicId?: string }>
}): Promise<Metadata> {
  const { appPublicId } = await searchParams
  if (!appPublicId) return {}
  const { favicon } = await fetchAppBranding(appPublicId)
  return favicon ? { icons: { icon: favicon } } : {}
}

export default async function LoginConsentPage({
```

- [ ] **Step 2: Run the consent test suite**

Run (from `apps/admin`): `npx jest login/consent`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/admin/app/login/consent/page.tsx
git commit -m "feat(login): set the app favicon on the consent page"
```

---

## Task 17: Favicon on `/forgot-password`

**Files:**
- Modify: `apps/admin/app/forgot-password/page.tsx`

- [ ] **Step 1: Implement**

Replace the full contents of `apps/admin/app/forgot-password/page.tsx` with:

```tsx
import type { Metadata } from 'next'
import { fetchAppBranding } from '@/lib/app-branding'
import { ForgotPasswordForm } from './forgot-password-form'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ client_id?: string }>
}): Promise<Metadata> {
  const { client_id: clientId } = await searchParams
  if (!clientId) return {}
  const { favicon } = await fetchAppBranding(clientId)
  return favicon ? { icons: { icon: favicon } } : {}
}

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { next } = await searchParams
  const nextSafe = validateNextUrl(next)
  const branding = await fetchAppBranding(clientIdFromNext(nextSafe ?? ''))
  return (
    <ForgotPasswordForm
      next={nextSafe ?? ''}
      logo={branding.logo}
      pageLightBackgroundColor={branding.pageLightBackgroundColor}
      pageDarkBackgroundColor={branding.pageDarkBackgroundColor}
      cardLightBackgroundColor={branding.cardLightBackgroundColor}
      cardDarkBackgroundColor={branding.cardDarkBackgroundColor}
    />
  )
}
```

IMPORTANT: this page's default export already calls `validateNextUrl` and
`clientIdFromNext` — the existing imports for those (`@/lib/safe-next`,
`@/lib/client-id-from-next`) must stay; only the `Metadata` import and the
new `generateMetadata` export are being added. The full corrected import
block is:

```tsx
import type { Metadata } from 'next'
import { validateNextUrl } from '@/lib/safe-next'
import { clientIdFromNext } from '@/lib/client-id-from-next'
import { fetchAppBranding } from '@/lib/app-branding'
import { ForgotPasswordForm } from './forgot-password-form'
```

- [ ] **Step 2: Run the forgot-password test suite**

Run (from `apps/admin`): `npx jest forgot-password`
Expected: PASS (if no dedicated test file exists for this page, confirm via `find apps/admin -iname "*forgot-password*test*"` and run the broader `npx jest app/login` sweep instead, since `forgot-password`'s link originates from `login-form.tsx`).

- [ ] **Step 3: Commit**

```bash
git add apps/admin/app/forgot-password/page.tsx
git commit -m "feat(forgot-password): set the app favicon"
```

---

## Task 18: Favicon on `/reset-password`

**Files:**
- Modify: `apps/admin/app/reset-password/page.tsx`

Depends on Task 4 (the branding lookup this page uses now includes `favicon`).

- [ ] **Step 1: Implement**

Replace the full contents of `apps/admin/app/reset-password/page.tsx` with:

```tsx
import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { AuthCard } from '@sassy-auth/ui'
import { getPasswordPolicyForResetToken } from '@/lib/api-public'
import { ResetPasswordForm } from './reset-password-form'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}): Promise<Metadata> {
  const { token } = await searchParams
  if (!token) return {}
  try {
    const { favicon } = await getPasswordPolicyForResetToken(token)
    return favicon ? { icons: { icon: favicon } } : {}
  } catch {
    // Same fail-open stance as the page body below: an unreachable
    // auth-server must not break metadata generation.
    return {}
  }
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token } = await searchParams
  const t = await getTranslations('resetPassword')
  if (!token) {
    return (
      <AuthCard className="max-w-md">
        <p className="text-body-md text-foreground">{t('invalidToken')}</p>
      </AuthCard>
    )
  }
  return <ResetPasswordForm token={token} />
}
```

- [ ] **Step 2: Run the reset-password test suite**

Run (from `apps/admin`): `npx jest app/reset-password`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/admin/app/reset-password/page.tsx
git commit -m "feat(reset-password): set the app favicon"
```

---

## Task 19: Full-suite verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full `packages/ui` test suite**

Run (from `packages/ui`): `npx jest`
Expected: PASS (0 failing).

- [ ] **Step 2: Run the full `apps/admin` test suite**

Run (from `apps/admin`): `npx jest`
Expected: PASS (0 failing).

- [ ] **Step 3: Run the full `apps/auth-server` test suite**

Run (from `apps/auth-server`, with `DATABASE_URL="postgresql://betterauth_admin:betterauth@localhost:5432/sassyauth_0.1" OTEL_SDK_DISABLED=true`): `npx jest`
Expected: PASS (0 failing).

- [ ] **Step 4: Type-check all 3 packages**

Run `npx tsc --noEmit` from `packages/ui`, `apps/admin`, and `apps/auth-server`.
Expected: no NEW errors beyond whatever pre-existing, unrelated errors already exist on the base branch (verify by comparing against `git diff` scope — no error should reference a file this plan touched).

- [ ] **Step 5: Manual smoke test**

Using VibeCast (`publicId: p5sV`, already configured with
`pageLightBackgroundColor: #490080`, `pageDarkBackgroundColor: #ddb7ff`,
`cardLightBackgroundColor: #f4ebf9`, `cardDarkBackgroundColor: #490080`) or
any other app with both page+card colors set per mode, visit all 10 pages in
both light and dark mode and confirm: text is legible against the card,
buttons have a visible outline and legible label text, error text (e.g. an
invalid OTP code) shows in the dedicated vivid red/orange rather than the
computed contrast color, and the app's logo/favicon appear on every page.

- [ ] **Step 6: Commit (if the smoke test required any fixes)**

```bash
git add -A
git commit -m "fix: address issues found during text-contrast/branding-parity smoke test"
```
