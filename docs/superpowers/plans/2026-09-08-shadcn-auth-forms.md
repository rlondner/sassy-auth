# Restyle Auth Forms with shadcn/ui Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the admin console's sign-in, sign-up, forgot-password, reset-password, and email-verification surfaces to use the shadcn/ui primitives already present in `@sassy-auth/ui` (`Card`, `Input`, `Label`, `Button`, `FormField`) instead of hand-rolled markup, and add a new post-signup "check your email" page with a working resend button.

**Architecture:** Add one new shared component (`AuthCard`, wrapping shadcn's `Card`) to `@sassy-auth/ui` and reuse the existing-but-unused `FormField` component everywhere a raw `<label>`/`<input>` pair currently appears. Swap every form's shell markup for `AuthCard`. Add a new client route (`/signup/check-email`) whose resend button calls better-auth's existing public `POST /api/auth/send-verification-email` endpoint directly (no new backend endpoint needed) — mirroring the pattern `social-buttons.tsx` already uses to call `/api/auth/sign-in/social` from the browser.

**Tech Stack:** Next.js 15 (admin app), React 19, next-intl, Tailwind + shadcn/ui primitives (`@sassy-auth/ui`), Jest + Testing Library (unit), Playwright (e2e), NestJS + better-auth (auth-server).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-08-shadcn-auth-forms-design.md`.
- This is a **markup/visual restyle**, not a behavior change: every `data-testid`, translation key (except the ones explicitly added/removed for the new check-email flow), `htmlFor`/label pairing, and server action/`useActionState` wiring must be preserved exactly, so existing tests that query by label text, role, or testid keep passing unless a task explicitly says otherwise.
- Use the shadcn semantic Tailwind tokens already wired in `packages/ui/tailwind.config.ts` (`bg-background`, `text-foreground`, `text-muted-foreground`, `text-primary`, `text-destructive`, `border-border` etc.) — **not** the old `bg-[var(--background)]` / `text-[var(--foreground)]` arbitrary-value form these files currently use. Both resolve to the same CSS custom properties; the semantic classes are what the rest of `@sassy-auth/ui`'s shadcn components already use.
- Keep the existing type-scale classes (`text-headline-sm`, `text-body-sm`, `text-body-md`, `text-label-md`) — they're this app's own extension of the shadcn font-size scale (`packages/ui/tailwind.config.ts`), not something being replaced.
- `apps/auth-server/src/auth/auth.config.spec.ts` is currently **broken** in this working copy from unrelated, uncommitted, in-progress work (an activation-webhook feature — `jest.mock('../activation/notify-activation', ...)` where that module doesn't exist yet). This is not something this plan introduces or is responsible for fixing. Do not edit that file and do not treat its failure as a regression caused by this plan — Task 8 verifies its own change by other means.
- The check-email page carries the user's email address in a `?email=` query parameter (accepted PII-in-URL tradeoff, confirmed in the spec) — do not "fix" this by switching to `sessionStorage` without checking with the user first.

---

## Task 1: `FormField` forwards `required` to the underlying input

`FormField` (`packages/ui/src/components/form-field.tsx`) currently destructures `required` only to decide whether to render the `*` marker — it never passes `required` through to the underlying `<Input>`. Every form this plan touches relies on native HTML `required` today (and several existing tests, e.g. `reset-password-form.test.tsx`, explicitly submit the form directly rather than clicking the button specifically *because* `required` triggers jsdom's constraint validation on a click). Adopting `FormField` without this fix would silently drop that behavior.

**Files:**
- Modify: `packages/ui/src/components/form-field.tsx`
- Test: `packages/ui/src/__tests__/form-field.test.tsx`

**Interfaces:**
- Produces: `FormField` (unchanged public signature) now also sets the native `required` attribute on its rendered `<input>` when `required` is truthy.

- [ ] **Step 1: Write the failing test**

Add to `packages/ui/src/__tests__/form-field.test.tsx`, inside the existing `describe('FormField', ...)` block, after the "does not render a required marker by default" test:

```tsx
  it('forwards required to the underlying input element', () => {
    render(<FormField label="Name" required />)
    expect(screen.getByLabelText('Name')).toBeRequired()
  })

  it('does not mark the input required by default', () => {
    render(<FormField label="Name" />)
    expect(screen.getByLabelText('Name')).not.toBeRequired()
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/ui && npx jest src/__tests__/form-field.test.tsx -t "forwards required"`
Expected: FAIL — `expect(element).toBeRequired()` fails because the rendered `<input>` has no `required` attribute.

- [ ] **Step 3: Fix `FormField`**

In `packages/ui/src/components/form-field.tsx`, change the `<Input ... />` line from:

```tsx
      <Input id={fieldId} aria-invalid={!!error} aria-describedby={describedBy} {...props} />
```

to:

```tsx
      <Input id={fieldId} required={required} aria-invalid={!!error} aria-describedby={describedBy} {...props} />
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/ui && npx jest src/__tests__/form-field.test.tsx`
Expected: PASS (all tests in the file, including the two new ones).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/form-field.tsx packages/ui/src/__tests__/form-field.test.tsx
git commit -m "fix(ui): FormField forwards required to the underlying input"
```

---

## Task 2: Add the `AuthCard` component

**Files:**
- Create: `packages/ui/src/components/auth-card.tsx`
- Create: `packages/ui/src/__tests__/auth-card.test.tsx`
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Consumes: `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter` from `./ui/card`; `cn` from `../lib/utils`.
- Produces: `AuthCard` component and `AuthCardProps` type, exported from `@sassy-auth/ui`.
  ```ts
  interface AuthCardProps {
    title?: string
    subtitle?: string
    icon?: React.ReactNode
    footer?: React.ReactNode
    className?: string
    children?: React.ReactNode
  }
  function AuthCard(props: AuthCardProps): JSX.Element
  ```
  Renders a full-viewport centered shell (`flex min-h-screen items-center justify-center`) around a `Card`. Renders a `CardHeader` (icon above title above subtitle) only when at least one of `title`/`subtitle`/`icon` is given. Renders `CardContent` only when `children` is given. Renders `CardFooter` only when `footer` is given. Default card width is `max-w-sm`; `className` is merged on top via `cn` (so passing e.g. `className="max-w-md"` overrides it, matching how `Card`'s own `className` merging already works elsewhere in this package).

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/__tests__/auth-card.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { AuthCard } from '../components/auth-card'

describe('AuthCard', () => {
  it('renders the title and subtitle', () => {
    render(
      <AuthCard title="Sign in" subtitle="Welcome back">
        content
      </AuthCard>,
    )
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByText('Welcome back')).toBeInTheDocument()
    expect(screen.getByText('content')).toBeInTheDocument()
  })

  it('renders an icon above the title when provided', () => {
    render(
      <AuthCard title="Verified" icon={<span data-testid="icon">check</span>}>
        content
      </AuthCard>,
    )
    expect(screen.getByTestId('icon')).toBeInTheDocument()
  })

  it('renders the footer when provided', () => {
    render(
      <AuthCard title="Sign in" footer={<a href="/login">Back to sign in</a>}>
        content
      </AuthCard>,
    )
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toBeInTheDocument()
  })

  it('omits the header entirely when no title, subtitle, or icon is given', () => {
    render(<AuthCard>plain content</AuthCard>)
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
    expect(screen.getByText('plain content')).toBeInTheDocument()
  })

  it('merges an overriding className onto the card', () => {
    const { container } = render(<AuthCard className="max-w-md">content</AuthCard>)
    const card = container.querySelector('.max-w-md')
    expect(card).not.toBeNull()
    expect(card?.className).not.toContain('max-w-sm')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/ui && npx jest src/__tests__/auth-card.test.tsx`
Expected: FAIL with "Cannot find module '../components/auth-card'".

- [ ] **Step 3: Create `AuthCard`**

Create `packages/ui/src/components/auth-card.tsx`:

```tsx
import * as React from 'react'
import { cn } from '../lib/utils'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './ui/card'

export interface AuthCardProps {
  title?: string
  subtitle?: string
  icon?: React.ReactNode
  footer?: React.ReactNode
  className?: string
  children?: React.ReactNode
}

export function AuthCard({ title, subtitle, icon, footer, className, children }: AuthCardProps) {
  const hasHeader = Boolean(title || subtitle || icon)
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className={cn('w-full max-w-sm', className)}>
        {hasHeader && (
          <CardHeader className="text-center">
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

- [ ] **Step 4: Export it from the package**

In `packages/ui/src/index.ts`, add this line directly below the existing `FormField` export:

```ts
export { AuthCard, type AuthCardProps } from './components/auth-card'
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd packages/ui && npx jest src/__tests__/auth-card.test.tsx`
Expected: PASS.

- [ ] **Step 6: Typecheck the package**

Run: `cd packages/ui && pnpm typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/components/auth-card.tsx packages/ui/src/__tests__/auth-card.test.tsx packages/ui/src/index.ts
git commit -m "feat(ui): add AuthCard component"
```

---

## Task 3: Restyle `login-form.tsx`

**Files:**
- Modify: `apps/admin/app/login/login-form.tsx`
- Test: `apps/admin/app/login/__tests__/login-forms.test.tsx` (existing — should pass unmodified; run it to confirm)

**Interfaces:**
- Consumes: `AuthCard`, `Button`, `FormField` from `@sassy-auth/ui` (all already exported after Task 2).

- [ ] **Step 1: Replace the file**

Replace the full contents of `apps/admin/app/login/login-form.tsx` with:

```tsx
'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import { AuthCard, Button, FormField } from '@sassy-auth/ui'
import { signIn } from './actions'
import { SocialButtons } from './social-buttons'

/**
 * `next` may be a relative or absolute authorize URL carrying `client_id` —
 * the same shape `applyPerAppTrustCookie` (app/login/actions.ts) already
 * parses for trust-day lookups. A placeholder base lets a relative `next`
 * parse without throwing.
 */
function clientIdFromNext(next: string): string | null {
  if (!next) return null
  try {
    return new URL(next, 'http://placeholder.invalid').searchParams.get('client_id')
  } catch {
    return null
  }
}

export function LoginForm({
  next,
  providers = [],
  authServerUrl,
}: {
  next: string
  providers?: string[]
  authServerUrl: string
}) {
  const t = useTranslations('login')
  const router = useRouter()
  const clientId = clientIdFromNext(next)

  const [state, formAction, isPending] = useActionState(
    async (
      _prev: { error?: string } | { twoFactor: true },
      formData: FormData,
    ): Promise<{ error?: string } | { twoFactor: true }> => {
      formData.set('next', next)
      const result = await signIn(formData)
      if ('twoFactor' in result && result.twoFactor) {
        router.push(`/login/two-factor${next ? `?next=${encodeURIComponent(next)}` : ''}`)
      }
      return result
    },
    {} as { error?: string } | { twoFactor: true },
  )

  return (
    <AuthCard
      title={t('title')}
      subtitle={t('subtitle')}
      footer={
        clientId ? (
          <p className="text-center text-label-md text-muted-foreground">
            {t('signupPrompt')}{' '}
            <Link
              href={`/signup?client_id=${encodeURIComponent(clientId)}${next ? `&next=${encodeURIComponent(next)}` : ''}`}
              className="text-primary hover:underline"
            >
              {t('signupLink')}
            </Link>
          </p>
        ) : undefined
      }
    >
      <SocialButtons providers={providers} next={next} authServerUrl={authServerUrl} />

      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="next" value={next} />

        <FormField id="email" name="email" type="email" autoComplete="email" required label={t('email')} />

        <FormField
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          label={t('password')}
        />

        {'error' in state && state.error && (
          <p data-testid="login-error" className="text-label-md text-destructive">
            {state.error === 'invalidCredentials' ||
            state.error === 'inactive' ||
            state.error === 'unverified' ||
            state.error === 'serverUnavailable' ||
            state.error === 'tooManyRequests'
              ? t(`error.${state.error}`)
              : state.error}
          </p>
        )}

        <Link href="/forgot-password" className="self-end text-label-md text-primary hover:underline">
          {t('forgotPassword')}
        </Link>
        <Link
          href={next ? `/login/code?next=${encodeURIComponent(next)}` : '/login/code'}
          className="self-end text-label-md text-primary hover:underline"
        >
          {t('useCode')}
        </Link>

        <Button type="submit" className="w-full" loading={isPending}>
          {t('submit')}
        </Button>
      </form>
    </AuthCard>
  )
}
```

- [ ] **Step 2: Run the existing tests**

Run: `cd apps/admin && npx jest app/login/__tests__/login-forms.test.tsx -t LoginForm`
Expected: PASS, no changes needed to the test file — it queries by label text (`getByLabelText`), role, and `data-testid`, none of which changed.

- [ ] **Step 3: Commit**

```bash
git add apps/admin/app/login/login-form.tsx
git commit -m "refactor(admin): restyle LoginForm with AuthCard and FormField"
```

---

## Task 4: Restyle `login-otp-form.tsx`

**Files:**
- Modify: `apps/admin/app/login/login-otp-form.tsx`
- Test: `apps/admin/app/login/__tests__/login-forms.test.tsx` (existing — `describe('LoginOtpForm', ...)` block)

**Interfaces:**
- Consumes: `AuthCard`, `Button`, `FormField` from `@sassy-auth/ui`.

- [ ] **Step 1: Replace the file**

Replace the full contents of `apps/admin/app/login/login-otp-form.tsx` with:

```tsx
'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import { AuthCard, Button, FormField } from '@sassy-auth/ui'
import { requestOtp, verifyOtp } from './actions'

export function LoginOtpForm({ next }: { next: string }) {
  const t = useTranslations('login')
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [step, setStep] = useState<'email' | 'code'>('email')

  const [reqState, requestAction, reqPending] = useActionState<
    { sent?: true; error?: string },
    FormData
  >(
    async (_prev, formData) => {
      const res = await requestOtp(formData)
      if ('sent' in res) setStep('code')
      return res as { sent?: true; error?: string }
    },
    {},
  )

  const [verifyState, verifyActionFn, verifyPending] = useActionState<
    { error?: string } | { twoFactor: true },
    FormData
  >(
    async (_prev, formData) => {
      const result = await verifyOtp(formData)
      if ('twoFactor' in result && result.twoFactor) {
        router.push(`/login/two-factor${next ? `?next=${encodeURIComponent(next)}` : ''}`)
      }
      return result
    },
    {},
  )

  const errKey = (e?: string) =>
    e === 'invalidCode' || e === 'inactive' || e === 'serverUnavailable' || e === 'tooManyRequests'
      ? t(`error.${e}`)
      : e

  return (
    <AuthCard title={t('otp.title')} subtitle={t('otp.subtitle')}>
      {step === 'email' ? (
        <form action={requestAction} className="flex flex-col gap-4">
          <FormField
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            label={t('email')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {reqState?.error && (
            <p data-testid="otp-error" className="text-label-md text-destructive">{errKey(reqState.error)}</p>
          )}
          <Button type="submit" className="w-full" loading={reqPending}>{t('otp.sendCode')}</Button>
          <Link href="/login" className="self-center text-label-md text-primary hover:underline">
            {t('otp.usePassword')}
          </Link>
        </form>
      ) : (
        <form action={verifyActionFn} className="flex flex-col gap-4">
          <input type="hidden" name="next" value={next} />
          <input type="hidden" name="email" value={email} />
          <p data-testid="otp-sent" className="text-body-sm text-muted-foreground">{t('otp.sent')}</p>
          <p className="text-body-sm text-muted-foreground">
            {t('otp.twoFactorHint')}
          </p>
          <FormField
            id="otp"
            name="otp"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            label={t('otp.codeLabel')}
          />
          {'error' in verifyState && verifyState.error && (
            <p data-testid="otp-error" className="text-label-md text-destructive">{errKey(verifyState.error)}</p>
          )}
          <Button type="submit" className="w-full" loading={verifyPending}>{t('otp.verify')}</Button>
          <button
            type="button"
            onClick={() => setStep('email')}
            className="self-center text-label-md text-primary hover:underline"
          >
            {t('otp.changeEmail')}
          </button>
        </form>
      )}
    </AuthCard>
  )
}
```

- [ ] **Step 2: Run the existing tests**

Run: `cd apps/admin && npx jest app/login/__tests__/login-forms.test.tsx -t LoginOtpForm`
Expected: PASS, unmodified.

- [ ] **Step 3: Commit**

```bash
git add apps/admin/app/login/login-otp-form.tsx
git commit -m "refactor(admin): restyle LoginOtpForm with AuthCard and FormField"
```

---

## Task 5: Restyle the `social-buttons.tsx` divider

**Files:**
- Modify: `apps/admin/app/login/social-buttons.tsx`
- Test: `apps/admin/components/__tests__/social-buttons.test.tsx` (existing — should pass unmodified)

**Interfaces:**
- Consumes: `Separator` (new import) alongside the existing `Button` from `@sassy-auth/ui`.

- [ ] **Step 1: Replace the divider markup**

In `apps/admin/app/login/social-buttons.tsx`, change the import line from:

```tsx
import { Button } from '@sassy-auth/ui'
```

to:

```tsx
import { Button, Separator } from '@sassy-auth/ui'
```

Then change the return statement's divider block from:

```tsx
      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-[var(--border)]" />
        <span className="text-body-sm text-[var(--muted-foreground)]">{t('socialDivider')}</span>
        <span className="h-px flex-1 bg-[var(--border)]" />
      </div>
```

to:

```tsx
      <div className="flex items-center gap-3">
        <Separator className="flex-1" />
        <span className="text-body-sm text-muted-foreground">{t('socialDivider')}</span>
        <Separator className="flex-1" />
      </div>
```

No other lines in this file change — the `fetch`/POST logic, error handling, and all comments stay exactly as they are.

- [ ] **Step 2: Run the existing tests**

Run: `cd apps/admin && npx jest components/__tests__/social-buttons.test.tsx`
Expected: PASS, unmodified — the divider test queries by `getByText(messages.login.socialDivider)`, which still renders.

- [ ] **Step 3: Commit**

```bash
git add apps/admin/app/login/social-buttons.tsx
git commit -m "refactor(admin): restyle social sign-in divider with shadcn Separator"
```

---

## Task 6: Restyle `forgot-password-form.tsx`

**Files:**
- Modify: `apps/admin/app/forgot-password/forgot-password-form.tsx`
- Test: none exists today for this file; the e2e `reset-password-flow.spec.ts` covers it (verified in Task 11's neighbor — no changes needed there since it queries by label/testid).

**Interfaces:**
- Consumes: `AuthCard`, `Button`, `FormField` from `@sassy-auth/ui`.

- [ ] **Step 1: Replace the file**

Replace the full contents of `apps/admin/app/forgot-password/forgot-password-form.tsx` with:

```tsx
'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { useActionState } from 'react'
import { AuthCard, Button, FormField } from '@sassy-auth/ui'
import { requestPasswordResetAction } from './actions'

export function ForgotPasswordForm() {
  const t = useTranslations('forgotPassword')
  const [state, formAction, isPending] = useActionState(
    async (_prev: { done?: boolean } | { done: true }, formData: FormData) => requestPasswordResetAction(formData),
    {} as { done?: boolean },
  )

  return (
    <AuthCard
      title={t('title')}
      subtitle={t('subtitle')}
      footer={
        <Link href="/login" className="text-label-md text-primary hover:underline">
          {t('backToLogin')}
        </Link>
      }
    >
      {state?.done ? (
        <p data-testid="forgot-sent" className="text-body-md text-foreground">{t('sent')}</p>
      ) : (
        <form action={formAction} className="flex flex-col gap-4">
          <FormField id="email" name="email" type="email" autoComplete="email" required label={t('email')} />
          <Button type="submit" className="w-full" disabled={isPending}>{isPending ? '…' : t('submit')}</Button>
        </form>
      )}
    </AuthCard>
  )
}
```

- [ ] **Step 2: Verify by running the e2e-adjacent unit suite for the admin app**

There is no dedicated unit test for this component; confirm the app still typechecks:

Run: `cd apps/admin && pnpm typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/admin/app/forgot-password/forgot-password-form.tsx
git commit -m "refactor(admin): restyle ForgotPasswordForm with AuthCard and FormField"
```

---

## Task 7: Restyle `reset-password-form.tsx` and `reset-password/page.tsx`

**Files:**
- Modify: `apps/admin/app/reset-password/reset-password-form.tsx`
- Modify: `apps/admin/app/reset-password/page.tsx`
- Test: `apps/admin/app/reset-password/__tests__/reset-password-form.test.tsx` (existing — should pass unmodified)

**Interfaces:**
- Consumes: `AuthCard`, `Button`, `FormField` from `@sassy-auth/ui`.

- [ ] **Step 1: Replace `reset-password-form.tsx`**

Replace the full contents of `apps/admin/app/reset-password/reset-password-form.tsx` with:

```tsx
'use client'

import * as React from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { AuthCard, Button, FormField } from '@sassy-auth/ui'
import { evaluatePasswordPolicy } from '@sassy-auth/types'
import { getPasswordPolicyForResetToken } from '@/lib/api-public'
import { FALLBACK_PASSWORD_POLICY, type PasswordPolicy } from '@/lib/types'
import { PasswordRequirementsChecklist } from '@/components/password-requirements-checklist'
import { resetPasswordSubmitAction } from './actions'

export function ResetPasswordForm({ token }: { token: string }) {
  const t = useTranslations('resetPassword')
  const [password, setPassword] = React.useState('')
  const [confirm, setConfirm] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const [success, setSuccess] = React.useState(false)
  // FALLBACK_PASSWORD_POLICY: used until the client-side policy fetch
  // resolves, and kept on fetch failure — the server-side hooks.before
  // enforcement (Task 7) is the real gate regardless of what this checklist
  // shows.
  const [policy, setPolicy] = React.useState<PasswordPolicy>(FALLBACK_PASSWORD_POLICY)

  React.useEffect(() => {
    let cancelled = false
    getPasswordPolicyForResetToken(token)
      .then((fetched) => {
        if (cancelled) return
        setPolicy(fetched)
      })
      .catch(() => {
        // Silently keep FALLBACK_POLICY: the server-side hooks.before
        // enforcement is the real gate regardless of what this checklist
        // shows.
      })
    return () => {
      cancelled = true
    }
  }, [token])

  const policyMet = evaluatePasswordPolicy(password, policy).every((r) => r.met)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password !== confirm) { setError(t('mismatch')); return }
    if (!policyMet) { setError(t('complexity')); return }
    setSubmitting(true)
    const res = await resetPasswordSubmitAction(token, password)
    setSubmitting(false)
    // Branch on the error value, not merely its presence. The action
    // distinguishes an unreachable server and a throttled request from a
    // rejected token; blaming the link in either case sends the user to
    // request a new one, which is itself rate-limited.
    if ('error' in res) {
      const known = ['serverUnavailable', 'tooManyRequests'] as const
      const key = (known as readonly string[]).includes(res.error) ? res.error : 'invalidToken'
      setError(t(key as 'serverUnavailable' | 'tooManyRequests' | 'invalidToken'))
      return
    }
    setSuccess(true)
  }

  if (success) {
    return (
      <AuthCard
        footer={
          <Link href="/login" className="text-label-md text-primary hover:underline">
            {t('backToLogin')}
          </Link>
        }
      >
        <p data-testid="reset-success" className="text-center text-body-md text-foreground">{t('success')}</p>
      </AuthCard>
    )
  }

  return (
    <AuthCard title={t('title')}>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <FormField
            id="password"
            type="password"
            label={t('password')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <PasswordRequirementsChecklist password={password} policy={policy} />
        </div>
        <FormField
          id="confirm-password"
          type="password"
          label={t('confirmPassword')}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
        />
        {error && <p data-testid="reset-error" className="text-label-md text-destructive">{error}</p>}
        <Button
          type="submit"
          className="w-full"
          disabled={submitting || !policyMet || password !== confirm || password.length === 0}
        >
          {submitting ? '…' : t('submit')}
        </Button>
      </form>
    </AuthCard>
  )
}
```

- [ ] **Step 2: Replace `page.tsx`'s invalid-token branch**

Replace the full contents of `apps/admin/app/reset-password/page.tsx` with:

```tsx
import { getTranslations } from 'next-intl/server'
import { AuthCard } from '@sassy-auth/ui'
import { ResetPasswordForm } from './reset-password-form'

export const dynamic = 'force-dynamic'

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

- [ ] **Step 3: Run the existing tests**

Run: `cd apps/admin && npx jest app/reset-password/__tests__/reset-password-form.test.tsx`
Expected: PASS, unmodified.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/app/reset-password/reset-password-form.tsx apps/admin/app/reset-password/page.tsx
git commit -m "refactor(admin): restyle ResetPasswordForm and its invalid-token page with AuthCard"
```

---

## Task 8: Rate-limit the verification-email resend endpoint

better-auth's `POST /api/auth/send-verification-email` is about to become reachable directly from a public, unauthenticated browser click (Task 9's resend button) for the first time — previously it was only ever called server-to-server from `registration.service.ts`. Add an explicit rate-limit rule for it, mirroring the existing pattern for the two-factor endpoints.

**Files:**
- Modify: `apps/auth-server/src/auth/auth.config.ts:105-120`

**Interfaces:** none (config-only change).

- [ ] **Step 1: Add the custom rule**

In `apps/auth-server/src/auth/auth.config.ts`, the `rateLimit` block currently reads:

```ts
  rateLimit: {
    // Explicit rate-limit for the 2FA verify endpoints. In better-auth 1.6.11
    // customRules *override* the twoFactor plugin's built-in per-path limit
    // (window: 10, max: 3 in dist/plugins/two-factor/index.mjs:269) for exact
    // path matches — they do NOT stack on top of it. These rules are therefore
    // set at the same value as the plugin default so the intent (at most 3
    // attempts per 10 s) is preserved explicitly in config and visible to
    // reviewers. If stricter limits are needed, lower max here rather than
    // relying on the plugin's implicit default.
    // Note: storage defaults to in-memory; limits are per-process, not global
    // across replicas. Wire secondaryStorage (Redis) for a cross-replica cap.
    customRules: {
      '/two-factor/verify-totp': { window: 10, max: 3 },
      '/two-factor/verify-backup-code': { window: 10, max: 3 },
    },
  },
```

Change the `customRules` object to:

```ts
    customRules: {
      '/two-factor/verify-totp': { window: 10, max: 3 },
      '/two-factor/verify-backup-code': { window: 10, max: 3 },
      // The admin console's /signup/check-email page calls this endpoint
      // directly from the browser (unauthenticated — see check-email-card.tsx)
      // to resend the verification email. Without an explicit limit it falls
      // back to better-auth's generic default, which is generous enough to
      // let a client hammer an arbitrary inbox with verification emails.
      '/send-verification-email': { window: 60, max: 3 },
    },
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/auth-server && pnpm typecheck`
Expected: no errors.

- [ ] **Step 3: Confirm the change by reading the merged config, not by running `auth.config.spec.ts`**

`auth.config.spec.ts` cannot currently run at all in this working copy (see Global Constraints — an unrelated, uncommitted, in-progress change references a module that doesn't exist yet). Do not edit that file. Instead, sanity-check the change with a one-off script:

Run:
```bash
cd apps/auth-server && node -e "
require('ts-node/register');
" 2>/dev/null; grep -A2 "'/send-verification-email'" src/auth/auth.config.ts
```
Expected output: the new `'/send-verification-email': { window: 60, max: 3 },` line, confirming it landed inside `customRules`.

- [ ] **Step 4: Commit**

```bash
git add apps/auth-server/src/auth/auth.config.ts
git commit -m "feat(auth-server): rate-limit the publicly-callable verification-email resend"
```

---

## Task 9: Signup completion flow — check-email page, resend, and signup-form redirect

This is the one feature slice from the spec that changes behavior (not just markup): after a successful signup, the form now navigates to a new `/signup/check-email` page instead of rendering an inline success message, and that page has a working resend button. It's one task because the pieces aren't independently useful — a check-email page nothing links to, or a redirect to a page that doesn't exist, both leave the app broken.

**Files:**
- Create: `apps/admin/app/signup/check-email/check-email-card.tsx`
- Create: `apps/admin/app/signup/check-email/page.tsx`
- Create: `apps/admin/app/signup/check-email/__tests__/check-email-card.test.tsx`
- Modify: `apps/admin/app/signup/signup-form.tsx`
- Modify: `apps/admin/app/signup/page.tsx`
- Modify: `apps/admin/app/signup/__tests__/signup-form.test.tsx`
- Modify: `apps/admin/messages/en.json`
- Modify: `apps/admin/messages/fr.json`

**Interfaces:**
- Produces: `CheckEmailCard({ email: string, next: string, authServerUrl: string }): JSX.Element` (client component).
- Consumes: `AuthCard`, `Button` from `@sassy-auth/ui`; better-auth's public `POST {authServerUrl}/api/auth/send-verification-email` endpoint, body `{ email: string, callbackURL: string }`, always responding `{ status: true }` on 200 (anti-enumeration — do not attempt to special-case "email not found").

- [ ] **Step 1: Add the new translation keys, remove the now-unused ones**

In `apps/admin/messages/en.json`, inside the `signup` object, remove the `"success"` and `"continueToLogin"` keys (they served the inline success state this task removes) and add a `"checkEmail"` object. The `signup` object should read:

```json
  "signup": {
    "title": "Create your account",
    "titleWithApp": "Create your account with {appName}",
    "subtitle": "Set up your organization to get started.",
    "invalidLink": "This signup link has expired or is invalid. Contact the app you're signing up for to get a new one.",
    "firstName": "First Name",
    "lastName": "Last Name",
    "companyName": "Company Name",
    "email": "Email Address",
    "password": "Password",
    "confirmPassword": "Confirm Password",
    "submit": "Create account",
    "backToLogin": "Back to sign in",
    "checkEmail": {
      "title": "Check your email",
      "subtitle": "We sent a verification link to {email}.",
      "missingEmail": "We couldn't tell which address to check. Start the signup process again.",
      "resendButton": "Resend email",
      "resendCooldown": "Resend in {seconds}s",
      "resendSent": "Verification email sent.",
      "resendError": "We couldn't resend the email. Please try again in a moment.",
      "backToLogin": "Back to sign in"
    },
    "verified": {
      "title": "Email verified",
      "subtitle": "Your account is ready. You can now sign in.",
      "continueToLogin": "Continue to sign in"
    },
    "errors": {
      "passwordMismatch": "Passwords do not match.",
      "passwordTooShort": "Password must be at least 12 characters.",
      "passwordComplexity": "Password must contain an uppercase letter, a lowercase letter, and a digit.",
      "captchaRequired": "Please complete the captcha before submitting.",
      "captchaFailed": "We couldn't verify you're not a robot. Please try the captcha again.",
      "appNotFound": "We couldn't find the app for this signup link.",
      "emailTaken": "An account with this email already exists.",
      "tooManyRequests": "Too many attempts. Please wait a minute and try again.",
      "serverUnavailable": "We could not reach the server. Please try again in a moment.",
      "validationError": "We couldn't create your account. Please check your details and try again."
    }
  },
```

Do the equivalent in `apps/admin/messages/fr.json` — remove `"success"`/`"continueToLogin"` from `signup`, add:

```json
    "checkEmail": {
      "title": "Vérifiez votre e-mail",
      "subtitle": "Nous avons envoyé un lien de vérification à {email}.",
      "missingEmail": "Nous n'avons pas pu déterminer quelle adresse vérifier. Recommencez l'inscription.",
      "resendButton": "Renvoyer l'e-mail",
      "resendCooldown": "Renvoyer dans {seconds}s",
      "resendSent": "E-mail de vérification envoyé.",
      "resendError": "Impossible de renvoyer l'e-mail. Veuillez réessayer dans un instant.",
      "backToLogin": "Retour à la connexion"
    },
```
(inserted in the same position, right after `"backToLogin": "Retour à la connexion",` and before the `"errors"` object — note `fr.json` today has no `"verified"` block for `signup`; leave that as-is, it's out of scope).

- [ ] **Step 2: Write the failing test for `CheckEmailCard`**

Create `apps/admin/app/signup/check-email/__tests__/check-email-card.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { CheckEmailCard } from '../check-email-card'

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}))

afterEach(() => {
  jest.restoreAllMocks()
})

function renderCard() {
  return render(<CheckEmailCard email="alice@example.com" next="" authServerUrl="https://auth.example.com" />)
}

describe('CheckEmailCard', () => {
  it('shows the email address in the subtitle', () => {
    renderCard()
    expect(screen.getByText('subtitle:{"email":"alice@example.com"}')).toBeInTheDocument()
  })

  it('resends the verification email, shows a confirmation, and disables the button during cooldown', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ status: true }) })
    global.fetch = fetchMock as unknown as typeof fetch
    renderCard()

    fireEvent.click(screen.getByRole('button', { name: 'resendButton' }))

    await waitFor(() => expect(screen.getByTestId('check-email-resent')).toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledWith(
      'https://auth.example.com/api/auth/send-verification-email',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          email: 'alice@example.com',
          callbackURL: `${window.location.origin}/signup/verified`,
        }),
      }),
    )
    expect(screen.getByRole('button')).toBeDisabled()
  })

  it('shows an error when the resend request fails', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, json: async () => ({}) }) as unknown as typeof fetch
    renderCard()

    fireEvent.click(screen.getByRole('button', { name: 'resendButton' }))

    await waitFor(() => expect(screen.getByTestId('check-email-error')).toBeInTheDocument())
  })

  it('shows a link back to sign-in, preserving next', () => {
    render(<CheckEmailCard email="alice@example.com" next="/orgs" authServerUrl="https://auth.example.com" />)
    expect(screen.getByRole('link', { name: 'backToLogin' })).toHaveAttribute(
      'href',
      '/login?next=%2Forgs',
    )
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd apps/admin && npx jest app/signup/check-email/__tests__/check-email-card.test.tsx`
Expected: FAIL with "Cannot find module '../check-email-card'".

- [ ] **Step 4: Create `CheckEmailCard`**

Create `apps/admin/app/signup/check-email/check-email-card.tsx`:

```tsx
'use client'

import * as React from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { AuthCard, Button } from '@sassy-auth/ui'

const COOLDOWN_SECONDS = 30

export function CheckEmailCard({
  email,
  next,
  authServerUrl,
}: {
  email: string
  next: string
  authServerUrl: string
}) {
  const t = useTranslations('signup.checkEmail')
  const [cooldown, setCooldown] = React.useState(0)
  const [status, setStatus] = React.useState<'idle' | 'sending' | 'sent' | 'error'>('idle')

  React.useEffect(() => {
    if (cooldown === 0) return
    const id = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(id)
  }, [cooldown])

  async function resend() {
    setStatus('sending')
    try {
      const res = await fetch(`${authServerUrl}/api/auth/send-verification-email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email,
          callbackURL: `${window.location.origin}/signup/verified`,
        }),
      })
      if (!res.ok) {
        setStatus('error')
        return
      }
      setStatus('sent')
      setCooldown(COOLDOWN_SECONDS)
    } catch {
      setStatus('error')
    }
  }

  const loginHref = next ? `/login?next=${encodeURIComponent(next)}` : '/login'

  return (
    <AuthCard
      title={t('title')}
      subtitle={t('subtitle', { email })}
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

- [ ] **Step 5: Create the route's `page.tsx`**

Create `apps/admin/app/signup/check-email/page.tsx`:

```tsx
import { getTranslations } from 'next-intl/server'
import { AuthCard } from '@sassy-auth/ui'
import { CheckEmailCard } from './check-email-card'

export const dynamic = 'force-dynamic'

// Same "PUBLIC vs internal auth-server origin" split as app/login/page.tsx —
// this page fetches directly from the browser, so it needs the origin the
// browser can reach, not the one this Next.js process reaches internally.
const PUBLIC_AUTH_SERVER =
  process.env.PUBLIC_AUTH_SERVER_URL ?? process.env.AUTH_SERVER_URL ?? 'http://localhost:3000'

export default async function CheckEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; next?: string }>
}) {
  const { email, next } = await searchParams
  const t = await getTranslations('signup.checkEmail')

  if (!email) {
    return <AuthCard title={t('title')} subtitle={t('missingEmail')} />
  }

  return <CheckEmailCard email={email} next={next ?? ''} authServerUrl={PUBLIC_AUTH_SERVER} />
}
```

- [ ] **Step 6: Run the `CheckEmailCard` tests to verify they pass**

Run: `cd apps/admin && npx jest app/signup/check-email/__tests__/check-email-card.test.tsx`
Expected: PASS.

- [ ] **Step 7: Update `signup-form.tsx` to redirect instead of showing inline success**

Replace the full contents of `apps/admin/app/signup/signup-form.tsx` with:

```tsx
'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button, FormField } from '@sassy-auth/ui'
import { evaluatePasswordPolicy } from '@sassy-auth/types'
import { FALLBACK_PASSWORD_POLICY, type PasswordPolicy } from '@/lib/types'
import { PasswordRequirementsChecklist } from '@/components/password-requirements-checklist'
import { Turnstile } from '@marsidev/react-turnstile'
import { registerAction } from './actions'

interface SignupFormProps {
  clientId: string
  next: string
  hasDefaultOrg: boolean
  passwordPolicy: PasswordPolicy | null
}

const KNOWN_ERRORS = [
  'appNotFound',
  'emailTaken',
  'captchaFailed',
  'tooManyRequests',
  'serverUnavailable',
  'validationError',
] as const

export function SignupForm({ clientId, next, hasDefaultOrg, passwordPolicy }: SignupFormProps) {
  const t = useTranslations()
  const router = useRouter()
  const [firstName, setFirstName] = React.useState('')
  const [lastName, setLastName] = React.useState('')
  const [companyName, setCompanyName] = React.useState('')
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [confirm, setConfirm] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const [captchaToken, setCaptchaToken] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) {
      console.warn('NEXT_PUBLIC_TURNSTILE_SITE_KEY is not set; the signup captcha widget will not function.')
    }
  }, [])

  const policy = passwordPolicy ?? FALLBACK_PASSWORD_POLICY
  const policyMet = evaluatePasswordPolicy(password, policy).every((r) => r.met)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) { setError(t('signup.errors.passwordMismatch')); return }
    if (!policyMet) { setError(t('signup.errors.passwordComplexity')); return }
    if (!captchaToken) { setError(t('signup.errors.captchaRequired')); return }
    setError(null)
    setSubmitting(true)
    try {
      const result = await registerAction({
        clientId, firstName, lastName, email, password, turnstileToken: captchaToken,
        ...(hasDefaultOrg ? {} : { companyName }),
      })
      if ('error' in result) {
        const key = (KNOWN_ERRORS as readonly string[]).includes(result.error) ? result.error : 'validationError'
        setError(t(`signup.errors.${key as (typeof KNOWN_ERRORS)[number]}`))
        return
      }
      router.push(
        `/signup/check-email?email=${encodeURIComponent(email)}${next ? `&next=${encodeURIComponent(next)}` : ''}`,
      )
    } catch {
      setError(t('signup.errors.validationError'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4">
        <FormField
          id="firstName"
          label={t('signup.firstName')}
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          required
        />
        <FormField
          id="lastName"
          label={t('signup.lastName')}
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          required
        />
      </div>
      {!hasDefaultOrg && (
        <FormField
          id="companyName"
          label={t('signup.companyName')}
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          required
        />
      )}
      <FormField
        id="email"
        type="email"
        autoComplete="email"
        label={t('signup.email')}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <div className="flex flex-col gap-1.5">
        <FormField
          id="password"
          type="password"
          label={t('signup.password')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <PasswordRequirementsChecklist password={password} policy={policy} />
      </div>
      <FormField
        id="confirm-password"
        type="password"
        label={t('signup.confirmPassword')}
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        required
      />
      {error && <p data-testid="signup-error" className="text-label-md text-destructive">{error}</p>}
      <Turnstile
        siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ''}
        onSuccess={setCaptchaToken}
        onExpire={() => setCaptchaToken(null)}
      />
      <Button
        type="submit"
        className="w-full"
        loading={submitting}
        disabled={submitting || !policyMet || password !== confirm || password.length === 0}
      >
        {t('signup.submit')}
      </Button>
    </form>
  )
}
```

`AuthCard` is not used inside `SignupForm` itself — it wraps `SignupForm` one level up, in `page.tsx` (Step 9) — so this file's import list is exactly `{ Button, FormField }` from `@sassy-auth/ui`.

- [ ] **Step 8: Update `signup-form.test.tsx` for the redirect**

In `apps/admin/app/signup/__tests__/signup-form.test.tsx`, add a router mock near the top, right after the `jest.mock('next-intl', ...)` block:

```tsx
const mockPush = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))
```

Then replace these two tests:

```tsx
  it('shows the success state and a link to /login after a successful submit', async () => {
    render(<SignupForm clientId="sq_1" next="" hasDefaultOrg={false} passwordPolicy={POLICY} />)
    fillValidForm()
    completeCaptcha()
    fireEvent.click(screen.getByText('signup.submit'))

    await waitFor(() => expect(screen.getByText('signup.success')).toBeInTheDocument())
    expect(screen.getByText('signup.continueToLogin').closest('a')).toHaveAttribute('href', '/login')
  })

  it('carries next forward into the post-signup login link', async () => {
    render(<SignupForm clientId="sq_1" next="/orgs" hasDefaultOrg={false} passwordPolicy={POLICY} />)
    fillValidForm()
    completeCaptcha()
    fireEvent.click(screen.getByText('signup.submit'))

    await waitFor(() => expect(screen.getByText('signup.success')).toBeInTheDocument())
    expect(screen.getByText('signup.continueToLogin').closest('a')).toHaveAttribute(
      'href',
      '/login?next=%2Forgs',
    )
  })
```

with:

```tsx
  it('navigates to /signup/check-email with the submitted address after a successful submit', async () => {
    render(<SignupForm clientId="sq_1" next="" hasDefaultOrg={false} passwordPolicy={POLICY} />)
    fillValidForm()
    completeCaptcha()
    fireEvent.click(screen.getByText('signup.submit'))

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith('/signup/check-email?email=alice%40example.com'),
    )
  })

  it('carries next forward into the check-email redirect', async () => {
    render(<SignupForm clientId="sq_1" next="/orgs" hasDefaultOrg={false} passwordPolicy={POLICY} />)
    fillValidForm()
    completeCaptcha()
    fireEvent.click(screen.getByText('signup.submit'))

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith(
        '/signup/check-email?email=alice%40example.com&next=%2Forgs',
      ),
    )
  })
```

Also add `mockPush.mockClear()` to the existing `beforeEach`, which currently reads:

```tsx
beforeEach(() => {
  jest.clearAllMocks()
  mockRegisterAction.mockResolvedValue({ ok: true })
})
```

`jest.clearAllMocks()` already clears `mockPush` too (it's a `jest.fn()`), so no change is actually needed there — leave `beforeEach` as-is.

- [ ] **Step 9: Wrap `signup/page.tsx` in `AuthCard`**

Replace the full contents of `apps/admin/app/signup/page.tsx` with:

```tsx
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { AuthCard } from '@sassy-auth/ui'
import type { PasswordPolicy } from '@/lib/types'
import { SignupForm } from './signup-form'

const AUTH_SERVER = process.env.AUTH_SERVER_URL ?? 'http://localhost:3000'

export const dynamic = 'force-dynamic'

export async function fetchAppInfo(
  clientId: string,
): Promise<{ name: string | null; hasDefaultOrg: boolean; passwordPolicy: PasswordPolicy | null }> {
  try {
    const res = await fetch(`${AUTH_SERVER}/api/register/app?appPublicId=${encodeURIComponent(clientId)}`, {
      cache: 'no-store',
    })
    if (!res.ok) {
      // Fail toward hasDefaultOrg: false, not true: a Company name field shown
      // but ignored by the server is harmless, whereas defaulting to true could
      // hide a required field and produce a signup-blocking dead end.
      return { name: null, hasDefaultOrg: false, passwordPolicy: null }
    }
    const body = (await res.json()) as { name?: string; hasDefaultOrg?: boolean; passwordPolicy?: PasswordPolicy }
    return {
      name: typeof body.name === 'string' ? body.name : null,
      hasDefaultOrg: body.hasDefaultOrg === true,
      passwordPolicy: body.passwordPolicy ?? null,
    }
  } catch {
    // Same reasoning as the !res.ok branch above: fail toward false.
    return { name: null, hasDefaultOrg: false, passwordPolicy: null }
  }
}

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ client_id?: string; next?: string }>
}) {
  const { client_id: clientId, next } = await searchParams
  const t = await getTranslations()

  if (!clientId) {
    return (
      <AuthCard
        className="max-w-md"
        icon={<span className="material-symbols-outlined text-[48px] text-destructive">error</span>}
      >
        <p className="text-center text-body-md text-foreground">{t('signup.invalidLink')}</p>
      </AuthCard>
    )
  }

  const { name: appName, hasDefaultOrg, passwordPolicy } = await fetchAppInfo(clientId)
  const nextSafe = next ?? ''

  return (
    <AuthCard
      title={appName ? t('signup.titleWithApp', { appName }) : t('signup.title')}
      subtitle={t('signup.subtitle')}
      footer={
        <Link
          href={nextSafe ? `/login?next=${encodeURIComponent(nextSafe)}` : '/login'}
          className="text-label-md text-primary hover:underline"
        >
          {t('signup.backToLogin')}
        </Link>
      }
    >
      <SignupForm clientId={clientId} next={nextSafe} hasDefaultOrg={hasDefaultOrg} passwordPolicy={passwordPolicy} />
    </AuthCard>
  )
}
```

- [ ] **Step 10: Run the full signup test suite**

Run: `cd apps/admin && npx jest app/signup`
Expected: PASS — `signup-form.test.tsx` (with the two replaced tests) and `check-email-card.test.tsx`.

- [ ] **Step 11: Grep for now-dead translation keys**

Run: `cd apps/admin && grep -rn "signup\.success\|signup\.continueToLogin" app messages ../admin-e2e 2>/dev/null`
Expected: no matches (Task 11 will update the e2e references; if this greps anything outside `apps/admin-e2e`, stop and investigate before continuing — it means some other file still depends on the removed keys).

- [ ] **Step 12: Typecheck**

Run: `cd apps/admin && pnpm typecheck`
Expected: no errors.

- [ ] **Step 13: Commit**

```bash
git add apps/admin/app/signup apps/admin/messages/en.json apps/admin/messages/fr.json
git commit -m "feat(admin): add check-email/resend page, redirect signup there on success"
```

---

## Task 10: Restyle `signup/verified/page.tsx`

**Files:**
- Modify: `apps/admin/app/signup/verified/page.tsx`

**Interfaces:**
- Consumes: `AuthCard` from `@sassy-auth/ui`.

- [ ] **Step 1: Replace the file**

Replace the full contents of `apps/admin/app/signup/verified/page.tsx` with:

```tsx
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { AuthCard } from '@sassy-auth/ui'

export default async function SignupVerifiedPage() {
  const t = await getTranslations()

  return (
    <AuthCard
      title={t('signup.verified.title')}
      subtitle={t('signup.verified.subtitle')}
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

- [ ] **Step 2: Typecheck**

Run: `cd apps/admin && pnpm typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/admin/app/signup/verified/page.tsx
git commit -m "refactor(admin): restyle signup-verified page with AuthCard"
```

---

## Task 11: Update e2e coverage for the new check-email flow

**Files:**
- Modify: `apps/admin-e2e/pages/signup.page.ts`
- Modify: `apps/admin-e2e/tests/signup.spec.ts`

**Interfaces:**
- Produces (on `SignupPage`): `checkEmailTitle: Locator`, `resendButton: Locator`, `backToLoginLink: Locator` — replacing the removed `successMessage`/`continueToLoginLink`.

- [ ] **Step 1: Update `signup.page.ts`**

In `apps/admin-e2e/pages/signup.page.ts`, replace the `successMessage`/`continueToLoginLink` field declarations and constructor assignments. The class currently reads (relevant excerpt):

```ts
  readonly successMessage: Locator
  readonly continueToLoginLink: Locator
  readonly invalidLinkMessage: Locator

  constructor(page: Page) {
    this.page = page
    this.firstNameInput = page.getByLabel(t('signup.firstName'))
    this.lastNameInput = page.getByLabel(t('signup.lastName'))
    this.companyNameInput = page.getByLabel(t('signup.companyName'))
    this.emailInput = page.getByLabel(t('signup.email'))
    this.passwordInput = page.getByLabel(t('signup.password'), { exact: true })
    this.confirmPasswordInput = page.getByLabel(t('signup.confirmPassword'))
    this.submitButton = page.getByRole('button', { name: t('signup.submit') })
    // Single error <p> renders one of several dynamic error keys; selecting
    // by testid avoids coupling to a specific key (mirrors LoginPage).
    this.errorMessage = page.getByTestId('signup-error')
    this.successMessage = page.getByText(t('signup.success'))
    this.continueToLoginLink = page.getByRole('link', { name: t('signup.continueToLogin') })
    this.invalidLinkMessage = page.getByText(t('signup.invalidLink'))
  }
```

Replace it with:

```ts
  readonly checkEmailTitle: Locator
  readonly resendButton: Locator
  readonly backToLoginLink: Locator
  readonly invalidLinkMessage: Locator

  constructor(page: Page) {
    this.page = page
    this.firstNameInput = page.getByLabel(t('signup.firstName'))
    this.lastNameInput = page.getByLabel(t('signup.lastName'))
    this.companyNameInput = page.getByLabel(t('signup.companyName'))
    this.emailInput = page.getByLabel(t('signup.email'))
    this.passwordInput = page.getByLabel(t('signup.password'), { exact: true })
    this.confirmPasswordInput = page.getByLabel(t('signup.confirmPassword'))
    this.submitButton = page.getByRole('button', { name: t('signup.submit') })
    // Single error <p> renders one of several dynamic error keys; selecting
    // by testid avoids coupling to a specific key (mirrors LoginPage).
    this.errorMessage = page.getByTestId('signup-error')
    // Signup success navigates to /signup/check-email rather than rendering
    // inline — see signup-form.tsx.
    this.checkEmailTitle = page.getByText(t('signup.checkEmail.title'))
    this.resendButton = page.getByRole('button', { name: t('signup.checkEmail.resendButton') })
    this.backToLoginLink = page.getByRole('link', { name: t('signup.checkEmail.backToLogin') })
    this.invalidLinkMessage = page.getByText(t('signup.invalidLink'))
  }
```

- [ ] **Step 2: Update `signup.spec.ts`**

In `apps/admin-e2e/tests/signup.spec.ts`, replace:

```ts
    await expect(signup.successMessage).toBeVisible()

    await signup.continueToLoginLink.click()
    await expect(page).toHaveURL(/\/login$/)
  })
```

with:

```ts
    await expect(page).toHaveURL(/\/signup\/check-email/)
    await expect(signup.checkEmailTitle).toBeVisible()

    await signup.backToLoginLink.click()
    await expect(page).toHaveURL(/\/login$/)
  })
```

And in the second `test.describe` block, replace:

```ts
    await expect(signup.successMessage).toBeVisible()
  })
```

with:

```ts
    await expect(page).toHaveURL(/\/signup\/check-email/)
    await expect(signup.checkEmailTitle).toBeVisible()
  })
```

- [ ] **Step 3: Typecheck the e2e package**

Run: `cd apps/admin-e2e && pnpm typecheck` (or, if that script doesn't exist in this package, `npx tsc --noEmit`)
Expected: no errors.

- [ ] **Step 4: Run the signup e2e spec, if a live stack is available**

Run: `cd apps/admin-e2e && npx playwright test tests/signup.spec.ts`
Expected: PASS if `RS_CLIENT_ID` (or `SASSY_CLIENT_ID`) is set and a real auth-server/admin stack is running; both tests `test.skip` cleanly otherwise (per the file's existing `beforeEach` gate) — either outcome is fine, just don't ignore an actual failure.

- [ ] **Step 5: Commit**

```bash
git add apps/admin-e2e/pages/signup.page.ts apps/admin-e2e/tests/signup.spec.ts
git commit -m "test(e2e): update signup e2e for the check-email redirect"
```

---

## Final Verification

- [ ] `cd packages/ui && pnpm test` — PASS (Tasks 1, 2)
- [ ] `cd apps/admin && pnpm test` — PASS (Tasks 3–10)
- [ ] `cd apps/admin && pnpm typecheck` — no errors
- [ ] `cd apps/auth-server && pnpm typecheck` — no errors (Task 8)
- [ ] Start the admin dev server (`cd apps/admin && pnpm dev`) and manually click through, in a browser, both light and dark mode:
  - `/login` (password fields, social buttons if configured, error state by submitting wrong credentials)
  - `/login/code` (OTP request + code step)
  - `/signup?client_id=<a real one>` (all fields, company name shown/hidden per `hasDefaultOrg`, submit → redirect to `/signup/check-email`)
  - `/signup/check-email?email=someone@example.com` (resend button, cooldown, error state by temporarily pointing `authServerUrl` at an unreachable host)
  - `/signup/verified`
  - `/forgot-password` (submit → neutral confirmation)
  - `/reset-password?token=<any>` and `/reset-password` with no token (invalid-link state)
- [ ] Confirm no leftover `var(--...)` arbitrary-value classes remain in any of the 10 files this plan touches: `grep -rn "var(--" apps/admin/app/login apps/admin/app/signup apps/admin/app/forgot-password apps/admin/app/reset-password` should only match files this plan didn't touch (e.g. `two-factor/TwoFactorForm.tsx`, out of scope).
