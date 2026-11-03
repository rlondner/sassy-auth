# Social Sign-Up/Sign-In UI Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle `/login`, `/signup` (plain form), and the `/signup` code-verification
wizard's email step to match the better-auth-ui shadcn reference's visual language,
and add branded icons (Google, Microsoft, Apple) to the social sign-in buttons.

**Architecture:** Extract the divider markup `SocialButtons` already draws into a new
shared `AuthDivider` primitive in `packages/ui`, switch `SocialButtons`'s button style
from filled (`secondary`) to bordered (`outline`) and give each button a provider
icon, then reorder `SocialButtons`/`AuthDivider` relative to the form on each of the
three in-scope pages (divider position differs per page, so it can no longer live
inside `SocialButtons` itself).

**Tech Stack:** Next.js (admin), `@sassy-auth/ui` (shadcn primitives), Jest + Testing
Library, next-intl.

**Design doc:** `docs/superpowers/specs/2026-11-02-social-auth-ui-refresh-design.md` —
read this first; every task below implements a specific section of it.

---

### Task 1: Copy provider icon assets into `apps/admin/public/icons/`

**Files:**
- Create: `apps/admin/public/icons/google.svg`
- Create: `apps/admin/public/icons/microsoft.svg`
- Create: `apps/admin/public/icons/apple-light.svg`
- Create: `apps/admin/public/icons/apple-dark.svg`

Source assets already exist at the repo root in `designs/social/`. Copy them
byte-for-byte — do **not** hand-retype the SVG markup (`google.svg` in particular has
~8.5KB of gradient/filter definitions; a transcription error would silently break the
icon).

- [ ] **Step 1: Create the target directory and copy the four files**

```bash
mkdir -p apps/admin/public/icons
cp designs/social/google.svg apps/admin/public/icons/google.svg
cp designs/social/microsoft.svg apps/admin/public/icons/microsoft.svg
cp designs/social/apple_light.svg apps/admin/public/icons/apple-light.svg
cp designs/social/apple_dark.svg apps/admin/public/icons/apple-dark.svg
```

- [ ] **Step 2: Verify the copies are byte-identical to the sources**

Run: `diff designs/social/google.svg apps/admin/public/icons/google.svg && diff designs/social/microsoft.svg apps/admin/public/icons/microsoft.svg && diff designs/social/apple_light.svg apps/admin/public/icons/apple-light.svg && diff designs/social/apple_dark.svg apps/admin/public/icons/apple-dark.svg && echo "all identical"`
Expected: `all identical` (no diff output above it)

- [ ] **Step 3: Commit**

```bash
git add apps/admin/public/icons/google.svg apps/admin/public/icons/microsoft.svg apps/admin/public/icons/apple-light.svg apps/admin/public/icons/apple-dark.svg
git commit -m "feat(admin): add Google/Microsoft/Apple brand icon assets"
```

---

### Task 2: `AuthDivider` — shared divider primitive in `packages/ui`

**Files:**
- Create: `packages/ui/src/components/auth-divider.tsx`
- Test: `packages/ui/src/__tests__/auth-divider.test.tsx`
- Modify: `packages/ui/src/index.ts`

This is the divider markup already inside `social-buttons.tsx` (two `Separator`
halves + a centered label), extracted so three different pages can place it wherever
they need it instead of `SocialButtons` always owning its position.

- [ ] **Step 1: Write the failing test**

```typescript
import { render, screen } from '@testing-library/react'
import { AuthDivider } from '../components/auth-divider'

describe('AuthDivider', () => {
  it('renders the given label', () => {
    render(<AuthDivider label="or continue with" />)
    expect(screen.getByText('or continue with')).toBeInTheDocument()
  })

  it('renders two separators flanking the label', () => {
    const { container } = render(<AuthDivider label="or continue with" />)
    expect(container.querySelectorAll('[role="separator"]')).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ui && npx jest auth-divider --silent`
Expected: FAIL with "Cannot find module '../components/auth-divider'"

- [ ] **Step 3: Write minimal implementation**

```typescript
import { Separator } from './ui/separator'

export interface AuthDividerProps {
  label: string
}

/**
 * The "OR" divider shadcn auth cards place between a form and its social
 * sign-in buttons. Takes the label as a prop (rather than owning any
 * translation) and no opinion on which side of a form it sits on — see
 * design doc 2026-11-02 §3, "New: AuthDivider".
 */
export function AuthDivider({ label }: AuthDividerProps) {
  return (
    <div className="flex items-center gap-3">
      <Separator className="flex-1" />
      <span className="text-body-sm text-muted-foreground">{label}</span>
      <Separator className="flex-1" />
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/ui && npx jest auth-divider --silent`
Expected: PASS (2 tests)

- [ ] **Step 5: Export it from the package**

In `packages/ui/src/index.ts`, add this line in the "Domain components" section,
alongside the existing `AuthCard` export:

```typescript
export { AuthDivider, type AuthDividerProps } from './components/auth-divider'
```

- [ ] **Step 6: Typecheck**

Run: `cd packages/ui && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/components/auth-divider.tsx packages/ui/src/__tests__/auth-divider.test.tsx packages/ui/src/index.ts
git commit -m "feat(ui): add shared AuthDivider primitive"
```

---

### Task 3: Provider icon components in `apps/admin`

**Files:**
- Create: `apps/admin/components/provider-icons.tsx`
- Test: `apps/admin/components/__tests__/provider-icons.test.tsx`

Thin `<img>`-based wrappers around the assets from Task 1. Decorative (`alt=""` +
`aria-hidden`) — the button's accessible name already comes from its visible text
label (e.g. "Continue with Google"), not the icon, so the icon must not inject its
own name into the accessibility tree. `AppleIcon` renders two `<img>` tags (light and
dark variants) toggled with Tailwind's `dark:`/`hidden` classes — CSS-only, no
JS/hydration flash (see design doc §4).

- [ ] **Step 1: Write the failing test**

```typescript
import { render } from '@testing-library/react'
import { GoogleIcon, MicrosoftIcon, AppleIcon } from '../provider-icons'

describe('provider icons', () => {
  it('GoogleIcon renders the Google asset as a decorative image', () => {
    const { container } = render(<GoogleIcon />)
    const img = container.querySelector('img')
    expect(img).toHaveAttribute('src', '/icons/google.svg')
    expect(img).toHaveAttribute('alt', '')
    expect(img).toHaveAttribute('aria-hidden', 'true')
  })

  it('MicrosoftIcon renders the Microsoft asset as a decorative image', () => {
    const { container } = render(<MicrosoftIcon />)
    const img = container.querySelector('img')
    expect(img).toHaveAttribute('src', '/icons/microsoft.svg')
    expect(img).toHaveAttribute('alt', '')
  })

  it('AppleIcon renders both light and dark variants, toggled via Tailwind dark: classes', () => {
    const { container } = render(<AppleIcon />)
    const imgs = container.querySelectorAll('img')
    expect(imgs).toHaveLength(2)
    expect(imgs[0]).toHaveAttribute('src', '/icons/apple-light.svg')
    expect(imgs[0]).toHaveClass('dark:hidden')
    expect(imgs[1]).toHaveAttribute('src', '/icons/apple-dark.svg')
    expect(imgs[1]).toHaveClass('hidden')
    expect(imgs[1]).toHaveClass('dark:block')
  })

  it('accepts a className override for custom sizing, defaulting to size-4', () => {
    const { container: defaultContainer } = render(<GoogleIcon />)
    expect(defaultContainer.querySelector('img')).toHaveClass('size-4')

    const { container } = render(<GoogleIcon className="h-6 w-6" />)
    expect(container.querySelector('img')).toHaveClass('h-6', 'w-6')
    expect(container.querySelector('img')).not.toHaveClass('size-4')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/admin && npx jest provider-icons --silent`
Expected: FAIL with "Cannot find module '../provider-icons'"

- [ ] **Step 3: Write minimal implementation**

```typescript
interface ProviderIconProps {
  className?: string
}

/**
 * Decorative brand icons for the social sign-in buttons (social-buttons.tsx).
 * `<img>`, not inline SVG — google.svg in particular is a complex gradient/
 * filter asset (~8.5KB); serving it as a static file avoids hand-transcribing
 * that markup into JSX and the bundle-size cost of inlining it. Sized via
 * `className` directly rather than Button's `[&_svg]:size-4` cascade, which
 * only targets inline <svg> descendants, not <img> tags — see design doc
 * 2026-11-02 §4.
 */
export function GoogleIcon({ className = 'size-4' }: ProviderIconProps) {
  return <img src="/icons/google.svg" alt="" aria-hidden="true" className={className} />
}

export function MicrosoftIcon({ className = 'size-4' }: ProviderIconProps) {
  return <img src="/icons/microsoft.svg" alt="" aria-hidden="true" className={className} />
}

/** Renders both theme variants; CSS (not JS) decides which one is visible, so
 * there's no hydration-mismatch risk the way a useTheme() hook would have. */
export function AppleIcon({ className = 'size-4' }: ProviderIconProps) {
  return (
    <>
      <img src="/icons/apple-light.svg" alt="" aria-hidden="true" className={`${className} dark:hidden`} />
      <img src="/icons/apple-dark.svg" alt="" aria-hidden="true" className={`${className} hidden dark:block`} />
    </>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/admin && npx jest provider-icons --silent`
Expected: PASS (4 tests)

- [ ] **Step 5: Typecheck**

Run: `cd apps/admin && npx tsc --noEmit`
Expected: no new errors (there may be a pre-existing, unrelated error about
`@sassy-auth/telemetry/server` in `src/instrument.ts` if that package hasn't been
built in this worktree — ignore it, it's not introduced by this change)

- [ ] **Step 6: Commit**

```bash
git add apps/admin/components/provider-icons.tsx apps/admin/components/__tests__/provider-icons.test.tsx
git commit -m "feat(admin): add GoogleIcon/MicrosoftIcon/AppleIcon components"
```

---

### Task 4: `SocialButtons` — outline variant, icons, drop the internal divider

**Files:**
- Modify: `apps/admin/components/social-buttons.tsx`
- Modify: `apps/admin/components/__tests__/social-buttons.test.tsx`

Read the full current `apps/admin/components/social-buttons.tsx` before editing — the
`start()` function (the `/sign-in/social` POST flow) is untouched; only the `return`
block and the `variant` prop change.

- [ ] **Step 1: Update the existing test file**

In `apps/admin/components/__tests__/social-buttons.test.tsx`, make two changes:

1. Delete this test entirely — the divider no longer lives in `SocialButtons`:

```typescript
  it('renders the divider only when there is at least one provider', () => {
    renderWith(['google'])
    expect(screen.getByText(messages.login.socialDivider)).toBeInTheDocument()
  })
```

2. This test's assertion is still correct (an all-unknown provider list still renders
   nothing) — only its description mentions a divider that no longer exists. Change:

```typescript
  it('renders nothing (no divider) when every provider id is unknown', () => {
    const { container } = renderWith(['unknown-future-provider'])
    expect(container).toBeEmptyDOMElement()
  })
```

to:

```typescript
  it('renders nothing when every provider id is unknown', () => {
    const { container } = renderWith(['unknown-future-provider'])
    expect(container).toBeEmptyDOMElement()
  })
```

Then add these new tests, inside the same `describe('SocialButtons', ...)` block:

```typescript
  it('renders buttons with the outline variant (bordered, not filled)', () => {
    renderWith(['google'])
    expect(screen.getByRole('button', { name: /google/i })).toHaveClass('border')
  })

  it('renders a brand icon inside the google, microsoft, and apple buttons', () => {
    renderWith(['google', 'microsoft', 'apple'])
    const buttons = screen.getAllByRole('button')
    expect(buttons[0].querySelector('img')).toHaveAttribute('src', '/icons/google.svg')
    expect(buttons[1].querySelector('img')).toHaveAttribute('src', '/icons/microsoft.svg')
    // Apple renders two <img> tags (light/dark theme variants)
    expect(buttons[2].querySelectorAll('img')).toHaveLength(2)
  })

  it('renders no icon for the stub test-IdP provider', () => {
    renderWith(['stub'])
    expect(screen.getByRole('button', { name: /test idp/i }).querySelector('img')).toBeNull()
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/admin && npx jest social-buttons --silent`
Expected: FAIL — the new icon/variant assertions don't match the current
`secondary`-variant, icon-less implementation; the two divider tests you just deleted
are gone so they no longer run

- [ ] **Step 3: Update the implementation**

In `apps/admin/components/social-buttons.tsx`, change the import line:

```typescript
import { Button, Separator } from '@sassy-auth/ui'
```

to:

```typescript
import { Button } from '@sassy-auth/ui'
import { GoogleIcon, MicrosoftIcon, AppleIcon } from './provider-icons'
```

Add this helper function right after the `LABEL_KEY` constant (before the
`SocialButtons` export):

```typescript
function ProviderIcon({ provider }: { provider: string }) {
  switch (provider) {
    case 'google':
      return <GoogleIcon />
    case 'microsoft':
      return <MicrosoftIcon />
    case 'apple':
      return <AppleIcon />
    default:
      return null
  }
}
```

Replace the `return` block at the end of `SocialButtons` — change:

```typescript
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        {known.map((provider) => (
          <Button
            key={provider}
            type="button"
            variant="secondary"
            onClick={() => start(provider)}
          >
            {t(LABEL_KEY[provider] as 'socialGoogle')}
          </Button>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <Separator className="flex-1" />
        <span className="text-body-sm text-muted-foreground">{t('socialDivider')}</span>
        <Separator className="flex-1" />
      </div>
    </div>
  )
}
```

to:

```typescript
  return (
    <div className="flex flex-col gap-2">
      {known.map((provider) => (
        <Button
          key={provider}
          type="button"
          variant="outline"
          onClick={() => start(provider)}
        >
          <ProviderIcon provider={provider} />
          {t(LABEL_KEY[provider] as 'socialGoogle')}
        </Button>
      ))}
    </div>
  )
}
```

(`Button`'s own `inline-flex items-center justify-center gap-2` already centers the
icon+label group and spaces them — no extra className needed here.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/admin && npx jest social-buttons --silent`
Expected: PASS

- [ ] **Step 5: Typecheck**

Run: `cd apps/admin && npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 6: Commit**

```bash
git add apps/admin/components/social-buttons.tsx apps/admin/components/__tests__/social-buttons.test.tsx
git commit -m "feat(admin): outline-style social buttons with brand icons, drop internal divider"
```

---

### Task 5: `/login` — move social buttons below the form, behind a divider

**Files:**
- Modify: `apps/admin/app/login/login-form.tsx`
- Modify: `apps/admin/app/login/__tests__/login-forms.test.tsx`

Read the full current `apps/admin/app/login/login-form.tsx` before editing.

- [ ] **Step 1: Write the failing tests**

Add these two tests to the `describe('LoginForm', ...)` block in
`apps/admin/app/login/__tests__/login-forms.test.tsx`, alongside the other
`wrap(<LoginForm .../>)` calls (this file's `wrap()` uses a real
`NextIntlClientProvider` with the real `messages` import, so `t('socialDivider')`
resolves to real English copy):

```typescript
  it('shows the "or continue with" divider above the social buttons when providers are configured', () => {
    wrap(<LoginForm next="" authServerUrl="https://auth.test" providers={['google']} />)
    expect(screen.getByText(messages.login.socialDivider)).toBeInTheDocument()
  })

  it('does not show the divider when no providers are configured', () => {
    wrap(<LoginForm next="" authServerUrl="https://auth.test" />)
    expect(screen.queryByText(messages.login.socialDivider)).not.toBeInTheDocument()
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/admin && npx jest login-forms --silent`
Expected: FAIL — the divider isn't rendered by `LoginForm` at all yet (only by the
now-mocked-to-null `SocialButtons`)

- [ ] **Step 3: Update the implementation**

In `apps/admin/app/login/login-form.tsx`, change the import line:

```typescript
import { AuthCard, Button, FormField } from '@sassy-auth/ui'
```

to:

```typescript
import { AuthCard, AuthDivider, Button, FormField } from '@sassy-auth/ui'
```

Replace the `AuthCard`'s children — change:

```typescript
    >
      <SocialButtons providers={providers} next={next} authServerUrl={authServerUrl} />

      <form action={formAction} className="flex flex-col gap-4">
```

to:

```typescript
    >
      <div className="flex flex-col gap-6">
        <form action={formAction} className="flex flex-col gap-4">
```

and change the closing of the form plus the `</AuthCard>` tag — find:

```typescript
        <Button type="submit" className="w-full" loading={isPending}>
          {t('submit')}
        </Button>
      </form>
    </AuthCard>
  )
}
```

replace with:

```typescript
        <Button type="submit" className="w-full" loading={isPending}>
          {t('submit')}
        </Button>
        </form>

        {providers.length > 0 && (
          <div className="flex flex-col gap-4">
            <AuthDivider label={t('socialDivider')} />
            <SocialButtons providers={providers} next={next} authServerUrl={authServerUrl} />
          </div>
        )}
      </div>
    </AuthCard>
  )
}
```

(The `providers.length > 0` gate mirrors the same, already-established pattern
`signup-form.tsx` uses — it doesn't account for a list of entirely-unknown provider
ids, same as that existing code; this is a pre-existing, accepted imprecision, not a
new gap introduced here.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/admin && npx jest login-forms --silent`
Expected: PASS

- [ ] **Step 5: Run the full login test suite to catch regressions**

Run: `cd apps/admin && npx jest login --silent`
Expected: PASS — no existing test should have changed behavior

- [ ] **Step 6: Typecheck**

Run: `cd apps/admin && npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 7: Commit**

```bash
git add apps/admin/app/login/login-form.tsx apps/admin/app/login/__tests__/login-forms.test.tsx
git commit -m "feat(admin): move /login social buttons below the form, behind a divider"
```

---

### Task 6: `/signup` plain form — add the divider between social buttons and the form

**Files:**
- Modify: `apps/admin/app/signup/signup-form.tsx`

Read the full current `apps/admin/app/signup/signup-form.tsx` before editing. Social
buttons already render above the form here (per design doc §2, this page keeps that
order since the form is long) — this task only adds the divider and wraps both
sections for consistent spacing. No existing `signup-form.test.tsx` assertion checks
DOM order or the divider, so there's no test to update here; the existing
`canSocialSignup`/`providers`-gated render tests (`'renders SocialButtons when
canSocialSignup is true...'`, etc.) continue to pass unchanged since they only check
button presence/absence, not what's immediately above or below it.

- [ ] **Step 1: Update the implementation**

In `apps/admin/app/signup/signup-form.tsx`, change the import line:

```typescript
import { Button, FormField } from '@sassy-auth/ui'
```

to:

```typescript
import { AuthDivider, Button, FormField } from '@sassy-auth/ui'
```

Replace the opening of the returned JSX — change:

```typescript
  return (
    <>
      {canSocialSignup && providers.length > 0 && (
        <SocialButtons providers={providers} next={next} authServerUrl={authServerUrl} />
      )}
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
```

to:

```typescript
  return (
    <div className="flex flex-col gap-6">
      {canSocialSignup && providers.length > 0 && (
        <div className="flex flex-col gap-4">
          <SocialButtons providers={providers} next={next} authServerUrl={authServerUrl} />
          <AuthDivider label={t('login.socialDivider')} />
        </div>
      )}
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
```

and change the closing — find:

```typescript
      </form>
      </>
  )
}
```

replace with:

```typescript
      </form>
    </div>
  )
}
```

(`t` here is `useTranslations()` with no namespace argument — confirmed from the top
of this file — so `t('login.socialDivider')` reaches the same `login.socialDivider`
key `SocialButtons` used to read directly; no new translation key, no copy change.)

- [ ] **Step 2: Run the signup-form test suite**

Run: `cd apps/admin && npx jest signup-form --silent`
Expected: PASS — no existing assertion depends on DOM order

- [ ] **Step 3: Typecheck**

Run: `cd apps/admin && npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 4: Commit**

```bash
git add apps/admin/app/signup/signup-form.tsx
git commit -m "feat(admin): add divider between /signup's social buttons and form"
```

---

### Task 7: `/signup` wizard email step — reorder to email → captcha → divider → social → Continue

**Files:**
- Modify: `apps/admin/app/signup/signup-wizard.tsx`

Read the full current `apps/admin/app/signup/signup-wizard.tsx` before editing — only
the `step === 'email'` branch changes; the `code`/`password`/`name` steps are
untouched. Per design doc §2, captcha and the Continue button stay anchored together
at the bottom of this step (captcha gates that step's own submission), with the
social-buttons shortcut placed between the email field and captcha's divider. Moving
the Continue button after the social-buttons block means it's no longer a DOM
descendant of the `<form>` it submits — give the form an `id` and associate the
button via the standard HTML `form` attribute instead of nesting.

- [ ] **Step 1: Add the `AuthDivider` import and a second translator for the shared divider copy**

Change:

```typescript
import { Button, FormField, OtpInput } from '@sassy-auth/ui'
```

to:

```typescript
import { AuthDivider, Button, FormField, OtpInput } from '@sassy-auth/ui'
```

In the `SignupWizard` function body, change:

```typescript
  const t = useTranslations('signup')
  const tCommon = useTranslations('common')
```

to:

```typescript
  const t = useTranslations('signup')
  const tCommon = useTranslations('common')
  // The "or continue with" divider copy lives under the 'login' namespace
  // (social-buttons.tsx's existing SocialButtons consumer convention) —
  // reused here rather than duplicating the string under 'signup'.
  const tLogin = useTranslations('login')
```

- [ ] **Step 2: Replace the `step === 'email'` branch**

Change:

```typescript
  if (step === 'email') {
    return (
      <>
        {canSocialSignup && providers.length > 0 && (
          <SocialButtons providers={providers} next={next} authServerUrl={authServerUrl} />
        )}
        <form onSubmit={handleEmailSubmit} className="flex flex-col gap-4">
          <FormField
            id="email"
            type="email"
            autoComplete="email"
            label={t('email')}
            placeholder={t('emailPlaceholder')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Turnstile
            siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ''}
            onSuccess={setCaptchaToken}
            onExpire={() => setCaptchaToken(null)}
          />
          {error && (
            <p data-testid="signup-error" className="text-label-md text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" loading={submitting} disabled={submitting || email.length === 0}>
            {t('continue')}
          </Button>
        </form>
      </>
    )
  }
```

to:

```typescript
  if (step === 'email') {
    return (
      <div className="flex flex-col gap-6">
        <form id="signup-email-form" onSubmit={handleEmailSubmit} className="flex flex-col gap-4">
          <FormField
            id="email"
            type="email"
            autoComplete="email"
            label={t('email')}
            placeholder={t('emailPlaceholder')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Turnstile
            siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ''}
            onSuccess={setCaptchaToken}
            onExpire={() => setCaptchaToken(null)}
          />
          {error && (
            <p data-testid="signup-error" className="text-label-md text-destructive">
              {error}
            </p>
          )}
        </form>

        {canSocialSignup && providers.length > 0 && (
          <div className="flex flex-col gap-4">
            <AuthDivider label={tLogin('socialDivider')} />
            <SocialButtons providers={providers} next={next} authServerUrl={authServerUrl} />
          </div>
        )}

        <Button
          type="submit"
          form="signup-email-form"
          className="w-full"
          loading={submitting}
          disabled={submitting || email.length === 0}
        >
          {t('continue')}
        </Button>
      </div>
    )
  }
```

- [ ] **Step 3: Run the wizard test suites to catch regressions**

Run: `cd apps/admin && npx jest signup-wizard signup-wizard-card --silent`
Expected: PASS — `fireEvent.click(screen.getByRole('button', { name: 'continue' }))`
(used by `advanceToPasswordStep` and others) still finds and submits the form via the
`form="signup-email-form"` association regardless of the button's new DOM position;
no assertion in this file checks ordering, only presence/role/name and submitted
values

- [ ] **Step 4: Typecheck**

Run: `cd apps/admin && npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 5: Commit**

```bash
git add apps/admin/app/signup/signup-wizard.tsx
git commit -m "feat(admin): reorder signup wizard email step — social buttons between captcha and Continue"
```

---

### Task 8: Full regression check and visual confirmation

**Files:** none (verification only)

- [ ] **Step 1: Run the full admin unit suite**

Run: `cd apps/admin && npx jest --silent`
Expected: PASS — no failures beyond any already-known, pre-existing, unrelated ones
in this worktree (e.g. a missing `@sassy-auth/telemetry/*` module if that package
hasn't been built here)

- [ ] **Step 2: Run the full ui package unit suite**

Run: `cd packages/ui && npx jest --silent`
Expected: PASS

- [ ] **Step 3: Typecheck both packages**

Run: `cd apps/admin && npx tsc --noEmit && cd ../../packages/ui && npx tsc --noEmit`
Expected: no new errors in either

- [ ] **Step 4: Visual confirmation against the reference**

Start the dev server (`pnpm dev` from the repo root, or the admin app's own dev
script) and open, with at least one social provider enabled for the app you're
testing against:

- `/login` — form, submit button, divider, social buttons (with icons) in that
  order, title centered
- `/signup` — social buttons (with icons), divider, then the rest of the form, title
  centered
- `/signup` with `emailVerificationMethod` set to `'code'` (the wizard) — email field,
  captcha, divider, social buttons (with icons), Continue button, in that order on
  the first step; confirm the `code`/`password`/`name` steps are visually unchanged
  from before this work
- Toggle dark mode and confirm the Apple icon switches from the black mark to the
  white mark

This step has no automated assertion — it's a manual pass confirming the ordering and
icon rendering actually look right in a real browser, not just in jsdom.

- [ ] **Step 5: Report any visual discrepancy found**

If anything doesn't match the reference or looks visually broken, note it — don't
silently "fix" spacing/sizing without reviewing against the design doc's stated
intent first, since several spacing values in this plan (`gap-6`, `gap-4`) were
chosen to match this codebase's existing conventions but weren't pixel-validated
against a live render before this plan was written.

---

## Post-implementation checklist

- [ ] Confirm `apps/admin/public/icons/*.svg` are the only new static assets added
      (no leftover copies under `designs/social/` need to move — that directory can
      stay as the source-of-truth checked-in originals, or be removed, at the
      implementer's discretion; this plan doesn't require deleting it)
- [ ] Confirm no other page using `AuthCard` was touched (forgot-password,
      reset-password, consent, check-email, verified, link-expired, `/login/code`,
      two-factor, two-factor-prompt)
