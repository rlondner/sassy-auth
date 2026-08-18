# Password Reset (user- & admin-initiated) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Depends on:** Plan 01 (EmailService, `passwordResetEmail` template, `selectTransport`).

**Goal:** Let a user reset their own password ("forgot password") and let an admin trigger a reset for another user — both via a one-time BetterAuth reset link that's emailed and (for the admin path) surfaced in the UI.

**Architecture:** BetterAuth's native reset (`emailAndPassword.sendResetPassword`) is the engine. The hook emails `passwordResetEmail(...)` and builds the link as `${ADMIN_URL}/reset-password?token=…`. The admin endpoint calls `auth.api.requestPasswordReset(...)` inside an AsyncLocalStorage scope so the hook can hand the URL back for the "copy link" panel. Two new public pages (`/forgot-password`, `/reset-password`) drive the user side by POSTing to BetterAuth like `login/actions.ts` already does.

**Tech Stack:** better-auth 1.6.11, NestJS, Next.js App Router server actions, Jest, Playwright.

## Global Constraints

- BetterAuth endpoints (already mounted under `/api/auth`): `POST /api/auth/request-password-reset` (`{ email, redirectTo }`), `POST /api/auth/reset-password` (`{ newPassword, token }`).
- Admin talks to auth-server via `process.env.AUTH_SERVER_URL ?? 'http://localhost:3000'`, forwarding the browser Origin with `getForwardedOrigin()` (see `apps/admin/lib/auth-origin.ts`) — mirror `apps/admin/app/login/actions.ts`.
- Reset link base is `process.env.ADMIN_URL ?? 'http://localhost:3001'`.
- Password rules (mirror `accept-invite-form.tsx`): ≥12 chars, must contain upper + lower + digit; confirm must match.
- Credential accounts are `Account` rows with `providerId === 'credential'`.
- Permission checks live in the service via `checkPermission(callerBaId, ['platform.users.manage','org.users.manage'], { targetOrgId })`.
- Actions return `{ errorKey }` on failure; add i18n keys to **both** `messages/en.json` and `messages/fr.json`.
- Tests: `pnpm --filter @sassy-auth/auth-server test`; e2e run per repo convention (`pnpm --filter @sassy-auth/admin-e2e test:e2e`).

---

## File structure

**auth-server**
- `src/auth/reset-url-context.ts` — AsyncLocalStorage capture.
- `src/email/email.singleton.ts` — non-DI `EmailService` singleton for `auth.config`.
- `src/auth/auth.config.ts` (modify) — `sendResetPassword` hook + `resetPasswordTokenExpiresIn`.
- `src/users/users.service.ts` (modify) — `resetPassword(...)`.
- `src/users/users.controller.ts` (modify) — `POST :id/reset-password`.

**admin**
- `lib/api.ts` (modify) — `resetPassword(userId)`.
- `app/(admin)/users/actions.ts` (modify) — `resetPasswordAction`.
- `components/share-link-dialog.tsx` — reusable "copy link" dialog (also used by Plan 03).
- `components/users-table.tsx` (modify) — wire reset menu item.
- `components/user-view-drawer.tsx` (modify) — wire reset button.
- `app/forgot-password/{page.tsx,forgot-password-form.tsx,actions.ts}` — user-initiated request.
- `app/reset-password/{page.tsx,reset-password-form.tsx,actions.ts}` — redemption.
- `app/login/login-form.tsx` (modify) — "Forgot password?" link.
- `middleware.ts` (modify) — public paths.
- `messages/en.json`, `messages/fr.json` (modify) — i18n.

---

### Task 1: BetterAuth reset hook + URL capture (auth-server)

**Files:**
- Create: `apps/auth-server/src/auth/reset-url-context.ts`
- Create: `apps/auth-server/src/email/email.singleton.ts`
- Modify: `apps/auth-server/src/auth/auth.config.ts`
- Test: `apps/auth-server/src/auth/reset-url-context.spec.ts`

**Interfaces:**
- Consumes: `EmailService` (Plan 01), `passwordResetEmail` (Plan 01), `selectTransport` (Plan 01), `LoggerService`.
- Produces:
  - `runWithResetUrlCapture<T>(fn: () => Promise<T>): Promise<{ result: T; resetUrl: string | null }>`
  - `captureResetUrl(url: string): void`
  - `getEmailer(): EmailService`

- [ ] **Step 1: Write the failing capture test**

Create `apps/auth-server/src/auth/reset-url-context.spec.ts`:

```typescript
import { runWithResetUrlCapture, captureResetUrl } from './reset-url-context';

describe('reset-url-context', () => {
  it('captures a URL written from inside the scope', async () => {
    const { result, resetUrl } = await runWithResetUrlCapture(async () => {
      captureResetUrl('https://x/reset-password?token=abc');
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(resetUrl).toBe('https://x/reset-password?token=abc');
  });

  it('captureResetUrl outside any scope is a no-op (no throw)', () => {
    expect(() => captureResetUrl('https://x')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @sassy-auth/auth-server exec jest src/auth/reset-url-context.spec.ts`
Expected: FAIL — cannot find module `./reset-url-context`.

- [ ] **Step 3: Implement the capture context**

Create `apps/auth-server/src/auth/reset-url-context.ts`:

```typescript
import { AsyncLocalStorage } from 'node:async_hooks';

interface ResetUrlStore {
  url: string | null;
}

const storage = new AsyncLocalStorage<ResetUrlStore>();

/** Run `fn` in a scope where sendResetPassword can hand back the generated URL. */
export async function runWithResetUrlCapture<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; resetUrl: string | null }> {
  const store: ResetUrlStore = { url: null };
  const result = await storage.run(store, fn);
  return { result, resetUrl: store.url };
}

/** Called from the sendResetPassword hook. No-op when not inside a capture scope. */
export function captureResetUrl(url: string): void {
  const store = storage.getStore();
  if (store) store.url = url;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @sassy-auth/auth-server exec jest src/auth/reset-url-context.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Add the non-DI email singleton**

Create `apps/auth-server/src/email/email.singleton.ts`:

```typescript
import { EmailService } from './email.service';
import { selectTransport } from './select-transport';
import { LoggerService } from '../common/logger/logger.service';

let instance: EmailService | null = null;

/** EmailService for use outside Nest DI (e.g. the BetterAuth config module). */
export function getEmailer(): EmailService {
  if (!instance) {
    instance = new EmailService(selectTransport(process.env), new LoggerService());
  }
  return instance;
}
```

- [ ] **Step 6: Wire `sendResetPassword` into `auth.config.ts`**

In `apps/auth-server/src/auth/auth.config.ts`, add imports near the top (after the existing imports):

```typescript
import { passwordResetEmail } from '../email/templates/password-reset.template';
import { getEmailer } from '../email/email.singleton';
import { captureResetUrl } from './reset-url-context';
```

Replace the existing `emailAndPassword` block:

```typescript
  emailAndPassword: {
    enabled: true,
  },
```

with:

```typescript
  emailAndPassword: {
    enabled: true,
    resetPasswordTokenExpiresIn: 3600, // 1 hour
    sendResetPassword: async ({ user, token }: { user: { email: string; name?: string }; token: string }) => {
      const adminUrl = process.env.ADMIN_URL ?? 'http://localhost:3001';
      const resetUrl = `${adminUrl}/reset-password?token=${token}`;
      captureResetUrl(resetUrl); // hand the URL back to the admin endpoint if it's listening
      const firstName = (user.name ?? '').trim().split(' ')[0] || 'there';
      await getEmailer().send({ to: user.email, ...passwordResetEmail({ firstName, resetUrl }) });
    },
  },
```

- [ ] **Step 7: Build to verify types + wiring**

Run: `pnpm --filter @sassy-auth/auth-server build`
Expected: build succeeds.

- [ ] **Step 8: Commit**

```bash
git add apps/auth-server/src/auth/reset-url-context.ts apps/auth-server/src/auth/reset-url-context.spec.ts apps/auth-server/src/email/email.singleton.ts apps/auth-server/src/auth/auth.config.ts
git commit -m "feat(auth): sendResetPassword hook emails link + captures URL"
```

---

### Task 2: Admin reset endpoint + service (auth-server)

**Files:**
- Modify: `apps/auth-server/src/users/users.service.ts`
- Modify: `apps/auth-server/src/users/users.controller.ts`
- Test: `apps/auth-server/src/users/users.service.spec.ts` (add a `describe('resetPassword')`)

**Interfaces:**
- Consumes: `checkPermission`, `runWithResetUrlCapture`, `auth` (from `../auth/auth.config`), `prisma`.
- Produces: `UsersService.resetPassword(callerBaId: string, userPublicId: string): Promise<{ resetUrl: string | null }>`. Throws `NotFoundException` (no user), `BadRequestException` (no credential account).

- [ ] **Step 1: Write the failing service test**

Add to `apps/auth-server/src/users/users.service.spec.ts`. First extend the top `jest.mock('@sassy-auth/db', ...)` prisma object to include an `account` mock finder (if not present): ensure `account: { create: jest.fn(), findFirst: jest.fn() }` is in the mock and in `mockPrisma`'s type. Then add this mock near the other `jest.mock(...)` calls:

```typescript
jest.mock('../auth/auth.config', () => ({
  auth: { api: { requestPasswordReset: jest.fn().mockResolvedValue({ status: true }) } },
}));
```

Then add the describe block:

```typescript
describe('resetPassword', () => {
  const mockAuth = require('../auth/auth.config').auth.api.requestPasswordReset as jest.Mock;

  beforeEach(() => {
    mockPrisma.saUser.findUnique.mockResolvedValue(
      makeSaUser({ status: 'active', betterAuthUserId: 'ba-1', orgId: 1, betterAuthUser: { email: 'a@b.co' } }),
    );
    mockPrisma.account.findFirst.mockResolvedValue({ id: 'acc1', providerId: 'credential' });
    mockAuth.mockResolvedValue({ status: true });
  });

  it('triggers a reset and returns the captured resetUrl', async () => {
    // Simulate the hook writing a URL during requestPasswordReset.
    mockAuth.mockImplementation(async () => {
      const { captureResetUrl } = require('../auth/reset-url-context');
      captureResetUrl('http://localhost:3001/reset-password?token=xyz');
      return { status: true };
    });
    const res = await service.resetPassword('ba-caller', 'usr1');
    expect(mockAuth).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.objectContaining({ email: 'a@b.co' }) }),
    );
    expect(res.resetUrl).toContain('token=xyz');
  });

  it('throws NotFoundException when the user does not exist', async () => {
    mockPrisma.saUser.findUnique.mockResolvedValue(null);
    await expect(service.resetPassword('ba-caller', 'nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws BadRequestException when the user has no credential account', async () => {
    mockPrisma.account.findFirst.mockResolvedValue(null);
    await expect(service.resetPassword('ba-caller', 'usr1')).rejects.toBeInstanceOf(BadRequestException);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @sassy-auth/auth-server exec jest src/users/users.service.spec.ts -t resetPassword`
Expected: FAIL — `service.resetPassword` is not a function.

- [ ] **Step 3: Implement `resetPassword` in the service**

In `apps/auth-server/src/users/users.service.ts`, add imports near the top:

```typescript
import { auth } from '../auth/auth.config';
import { runWithResetUrlCapture } from '../auth/reset-url-context';
```

Add this method to the `UsersService` class (e.g. after `resendInvitation`):

```typescript
async resetPassword(callerBaId: string, userPublicId: string): Promise<{ resetUrl: string | null }> {
  const user = await prisma.saUser.findUnique({
    where: { publicId: userPublicId },
    include: { betterAuthUser: { select: { email: true } } },
  });
  if (!user) throw new NotFoundException('User not found');

  await checkPermission(
    callerBaId,
    ['platform.users.manage', 'org.users.manage'],
    { targetOrgId: user.orgId },
  );

  // Only users with an email/password (credential) account can reset a password.
  // Pending users (not yet accepted) and social-only users have none.
  const credential = await prisma.account.findFirst({
    where: { userId: user.betterAuthUserId, providerId: 'credential' },
    select: { id: true },
  });
  if (!credential) {
    throw new BadRequestException('User has no password to reset');
  }

  const email = user.betterAuthUser.email;
  const adminUrl = process.env.ADMIN_URL ?? 'http://localhost:3001';
  const { resetUrl } = await runWithResetUrlCapture(async () => {
    await auth.api.requestPasswordReset({
      body: { email, redirectTo: `${adminUrl}/reset-password` },
    });
  });

  this.logger.getWinstonLogger().info('Admin triggered password reset', {
    context: 'UsersService',
    userId: userPublicId,
    linkSurfaced: resetUrl !== null,
  });

  return { resetUrl };
}
```

- [ ] **Step 4: Add the controller route**

In `apps/auth-server/src/users/users.controller.ts`, add after the `resendInvitation` route:

```typescript
  @Post(':id/reset-password')
  resetPassword(@Req() req: Request, @Param('id') id: string) {
    return this.users.resetPassword(callerBaId(req), id);
  }
```

- [ ] **Step 5: Run the tests + build**

Run: `pnpm --filter @sassy-auth/auth-server exec jest src/users/users.service.spec.ts -t resetPassword`
Expected: PASS (3 tests).
Run: `pnpm --filter @sassy-auth/auth-server build`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add apps/auth-server/src/users/users.service.ts apps/auth-server/src/users/users.controller.ts apps/auth-server/src/users/users.service.spec.ts
git commit -m "feat(users): admin-initiated password reset endpoint"
```

---

### Task 3: Reusable share-link dialog + admin reset wiring (admin)

**Files:**
- Create: `apps/admin/components/share-link-dialog.tsx`
- Modify: `apps/admin/lib/api.ts`
- Modify: `apps/admin/app/(admin)/users/actions.ts`
- Modify: `apps/admin/components/users-table.tsx`
- Modify: `apps/admin/components/user-view-drawer.tsx`
- Modify: `apps/admin/messages/en.json`, `apps/admin/messages/fr.json`

**Interfaces:**
- Produces:
  - `ShareLinkDialog(props: { open: boolean; onOpenChange: (o: boolean) => void; title: string; description: string; url: string })` — a dialog showing `url` read-only with a copy button.
  - `resetPassword(userId: string): Promise<{ resetUrl: string | null }>` (lib/api).
  - `resetPasswordAction(userId: string): Promise<{ resetUrl: string | null } | { errorKey: string }>`.

- [ ] **Step 1: Add i18n keys**

In `apps/admin/messages/en.json`, add under `users.toast`: `"resetLinkGenerated": "Password reset link generated"`. Add under `users.drawer`: `"resetLinkTitle": "Password reset link"`, `"resetLinkBody": "Share this one-time link with the user, or they'll receive it by email."`. Add under `users.errors`: keep existing `generic`/`forbidden`. Mirror the same keys in `apps/admin/messages/fr.json` with French copy (`"resetLinkGenerated": "Lien de réinitialisation généré"`, `"resetLinkTitle": "Lien de réinitialisation"`, `"resetLinkBody": "Partagez ce lien à usage unique avec l'utilisateur ; il le recevra aussi par e-mail."`).

- [ ] **Step 2: Create the `ShareLinkDialog` component**

Create `apps/admin/components/share-link-dialog.tsx`:

```tsx
'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import {
  AlertDialog, AlertDialogAction, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, Button,
} from '@sassy-auth/ui'
import { copyToClipboard } from '@/lib/clipboard'

interface ShareLinkDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  url: string
}

export function ShareLinkDialog({ open, onOpenChange, title, description, url }: ShareLinkDialogProps) {
  const t = useTranslations()
  const [copied, setCopied] = React.useState(false)

  React.useEffect(() => { if (!open) setCopied(false) }, [open])

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex gap-2">
          <input
            readOnly
            value={url}
            aria-label={title}
            className="flex-1 rounded border border-border bg-muted px-3 py-2 text-body-sm font-mono"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={async () => { if (await copyToClipboard(url)) { setCopied(true); setTimeout(() => setCopied(false), 2000) } }}
          >
            {copied ? t('users.drawer.copied') : t('users.drawer.copyLink')}
          </Button>
        </div>
        <AlertDialogFooter>
          <AlertDialogAction>{t('users.drawer.done')}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
```

Note: confirm `AlertDialogAction`/`AlertDialogHeader` etc. are exported from `@sassy-auth/ui` (they are used by `delete-alert-dialog.tsx`). If `users.drawer.done` is missing in messages, add `"done": "Done"` under `users.drawer` in both locale files.

- [ ] **Step 3: Add the API client function**

In `apps/admin/lib/api.ts`, add after `resendInvitation`:

```typescript
export async function resetPassword(userId: string): Promise<{ resetUrl: string | null }> {
  const res = await apiFetch(`/api/users/${userId}/reset-password`, { method: 'POST' })
  const result = await res.json()
  Sentry.addBreadcrumb({ category: 'admin.action', message: `Password reset triggered for ${userId}`, level: 'info' })
  return result
}
```

- [ ] **Step 4: Add the server action**

In `apps/admin/app/(admin)/users/actions.ts`, add `resetPassword` to the `@/lib/api` import list, then add:

```typescript
export async function resetPasswordAction(
  userId: string,
): Promise<{ resetUrl: string | null } | { errorKey: string }> {
  try {
    return await resetPassword(userId)
  } catch (err) {
    const message = err instanceof Error ? err.message : ''
    if (message.includes('400')) return { errorKey: 'users.errors.noPassword' }
    if (message.includes('403')) return { errorKey: 'users.errors.forbidden' }
    return { errorKey: 'users.errors.generic' }
  }
}
```

Add `"noPassword": "This user has no password to reset."` under `users.errors` in both locale files (fr: `"noPassword": "Cet utilisateur n'a pas de mot de passe à réinitialiser."`).

- [ ] **Step 5: Wire the reset menu item in `users-table.tsx`**

In `apps/admin/components/users-table.tsx`: add imports `import { toast } from 'sonner'`, `import { ShareLinkDialog } from './share-link-dialog'`, `import { resetPasswordAction } from '@/app/(admin)/users/actions'`. Add state near the other `useState` hooks:

```tsx
const [resetLink, setResetLink] = React.useState<string | null>(null)
```

Replace the stub reset item:

```tsx
{u.status === 'active' && (
  <DropdownMenuItem>{t('users.actions.resetPassword')}</DropdownMenuItem>
)}
```

with:

```tsx
{u.status === 'active' && (
  <DropdownMenuItem
    onClick={async (e) => {
      e.stopPropagation()
      const res = await resetPasswordAction(u.id)
      if ('errorKey' in res) { toast.error(t(res.errorKey)); return }
      toast.success(t('users.toast.resetLinkGenerated'))
      if (res.resetUrl) setResetLink(res.resetUrl)
    }}
  >
    {t('users.actions.resetPassword')}
  </DropdownMenuItem>
)}
```

Render the dialog near the bottom (alongside the delete dialog):

```tsx
<ShareLinkDialog
  open={resetLink !== null}
  onOpenChange={(o) => { if (!o) setResetLink(null) }}
  title={t('users.drawer.resetLinkTitle')}
  description={t('users.drawer.resetLinkBody')}
  url={resetLink ?? ''}
/>
```

- [ ] **Step 6: Wire the reset button in `user-view-drawer.tsx`**

In `apps/admin/components/user-view-drawer.tsx`, replace the stub button:

```tsx
<Button variant="outline" size="sm">{t('users.drawer.resetPassword')}</Button>
```

with a handler that calls the same action. Add `import { toast } from 'sonner'`, `import { ShareLinkDialog } from './share-link-dialog'`, `import { resetPasswordAction } from '@/app/(admin)/users/actions'`, a `const [resetLink, setResetLink] = React.useState<string | null>(null)`, then:

```tsx
<Button
  variant="outline"
  size="sm"
  onClick={async () => {
    const res = await resetPasswordAction(user.id)
    if ('errorKey' in res) { toast.error(t(res.errorKey)); return }
    toast.success(t('users.toast.resetLinkGenerated'))
    if (res.resetUrl) setResetLink(res.resetUrl)
  }}
>
  {t('users.drawer.resetPassword')}
</Button>
```

and render `<ShareLinkDialog ... url={resetLink ?? ''} open={resetLink !== null} onOpenChange={(o) => { if (!o) setResetLink(null) }} title={t('users.drawer.resetLinkTitle')} description={t('users.drawer.resetLinkBody')} />` in the drawer body.

- [ ] **Step 7: Build the admin app**

Run: `pnpm --filter @sassy-auth/admin build`
Expected: build succeeds (0 type errors).

- [ ] **Step 8: Commit**

```bash
git add apps/admin/components/share-link-dialog.tsx apps/admin/lib/api.ts apps/admin/app/\(admin\)/users/actions.ts apps/admin/components/users-table.tsx apps/admin/components/user-view-drawer.tsx apps/admin/messages/
git commit -m "feat(admin): wire admin-initiated password reset with copy-link dialog"
```

---

### Task 4: User-initiated "forgot password" page (admin)

**Files:**
- Create: `apps/admin/app/forgot-password/page.tsx`
- Create: `apps/admin/app/forgot-password/forgot-password-form.tsx`
- Create: `apps/admin/app/forgot-password/actions.ts`
- Modify: `apps/admin/messages/en.json`, `messages/fr.json`

**Interfaces:**
- Produces: `requestPasswordResetAction(formData: FormData): Promise<{ done: true }>` — always returns `{ done: true }` (no user enumeration).

- [ ] **Step 1: Add i18n keys**

Add a `forgotPassword` block to both locale files. en.json:

```json
"forgotPassword": {
  "title": "Reset your password",
  "subtitle": "Enter your email and we'll send you a reset link.",
  "email": "Email Address",
  "submit": "Send reset link",
  "sent": "If an account exists for that email, a reset link is on its way.",
  "backToLogin": "Back to sign in"
}
```

fr.json (mirror with French copy).

- [ ] **Step 2: Create the server action**

Create `apps/admin/app/forgot-password/actions.ts`:

```typescript
'use server'

import * as Sentry from '@sentry/nextjs'
import { getForwardedOrigin } from '@/lib/auth-origin'

const AUTH_SERVER = process.env.AUTH_SERVER_URL ?? 'http://localhost:3000'
const ADMIN_URL = process.env.ADMIN_URL ?? 'http://localhost:3001'

export async function requestPasswordResetAction(formData: FormData): Promise<{ done: true }> {
  const email = String(formData.get('email') ?? '')
  const origin = await getForwardedOrigin()
  try {
    await fetch(`${AUTH_SERVER}/api/auth/request-password-reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(origin && { Origin: origin }) },
      body: JSON.stringify({ email, redirectTo: `${ADMIN_URL}/reset-password` }),
    })
  } catch (err) {
    // Swallow: never reveal whether the address exists or the service state.
    Sentry.captureException(err, { tags: { area: 'auth', action: 'forgot-password' } })
  }
  return { done: true }
}
```

- [ ] **Step 3: Create the form component**

Create `apps/admin/app/forgot-password/forgot-password-form.tsx`:

```tsx
'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { useActionState } from 'react'
import { Button } from '@sassy-auth/ui'
import { requestPasswordResetAction } from './actions'

export function ForgotPasswordForm() {
  const t = useTranslations('forgotPassword')
  const [state, formAction, isPending] = useActionState(
    async (_prev: { done?: boolean }, formData: FormData) => requestPasswordResetAction(formData),
    {},
  )

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--background)]">
      <div className="w-full max-w-sm rounded-lg border border-[var(--border)] bg-[var(--card)] p-8 shadow-sm">
        <div className="mb-6 text-center">
          <h1 className="text-headline-sm text-[var(--foreground)]">{t('title')}</h1>
          <p className="mt-1 text-body-sm text-[var(--muted-foreground)]">{t('subtitle')}</p>
        </div>
        {state?.done ? (
          <p data-testid="forgot-sent" className="text-body-md text-[var(--foreground)]">{t('sent')}</p>
        ) : (
          <form action={formAction} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-label-md font-semibold" htmlFor="email">{t('email')}</label>
              <input id="email" name="email" type="email" autoComplete="email" required
                className="flex h-9 w-full rounded border border-[var(--border)] bg-[var(--card)] px-3 text-body-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]" />
            </div>
            <Button type="submit" className="w-full" disabled={isPending}>{isPending ? '…' : t('submit')}</Button>
          </form>
        )}
        <div className="mt-4 text-center">
          <Link href="/login" className="text-label-md text-[var(--primary)] hover:underline">{t('backToLogin')}</Link>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Create the page**

Create `apps/admin/app/forgot-password/page.tsx`:

```tsx
import { ForgotPasswordForm } from './forgot-password-form'

export const dynamic = 'force-dynamic'

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />
}
```

- [ ] **Step 5: Build**

Run: `pnpm --filter @sassy-auth/admin build`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/app/forgot-password/ apps/admin/messages/
git commit -m "feat(admin): forgot-password request page"
```

---

### Task 5: Reset-password redemption page (admin)

**Files:**
- Create: `apps/admin/app/reset-password/page.tsx`
- Create: `apps/admin/app/reset-password/reset-password-form.tsx`
- Create: `apps/admin/app/reset-password/actions.ts`
- Modify: `apps/admin/messages/en.json`, `messages/fr.json`

**Interfaces:**
- Produces: `resetPasswordSubmitAction(token: string, newPassword: string): Promise<{ ok: true } | { error: string }>`.

- [ ] **Step 1: Add i18n keys**

Add a `resetPassword` block to both locale files. en.json:

```json
"resetPassword": {
  "title": "Choose a new password",
  "password": "New Password",
  "confirmPassword": "Confirm Password",
  "submit": "Reset password",
  "success": "Password updated. You can now sign in.",
  "invalidToken": "This reset link is invalid or has expired. Request a new one.",
  "mismatch": "Passwords do not match.",
  "tooShort": "Password must be at least 12 characters.",
  "complexity": "Password must contain an uppercase letter, a lowercase letter, and a digit.",
  "backToLogin": "Back to sign in"
}
```

fr.json (mirror).

- [ ] **Step 2: Create the server action**

Create `apps/admin/app/reset-password/actions.ts`:

```typescript
'use server'

import * as Sentry from '@sentry/nextjs'
import { getForwardedOrigin } from '@/lib/auth-origin'

const AUTH_SERVER = process.env.AUTH_SERVER_URL ?? 'http://localhost:3000'

export async function resetPasswordSubmitAction(
  token: string,
  newPassword: string,
): Promise<{ ok: true } | { error: string }> {
  const origin = await getForwardedOrigin()
  let res: Response
  try {
    res = await fetch(`${AUTH_SERVER}/api/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(origin && { Origin: origin }) },
      body: JSON.stringify({ token, newPassword }),
    })
  } catch (err) {
    Sentry.captureException(err, { tags: { area: 'auth', action: 'reset-password' } })
    return { error: 'serverUnavailable' }
  }
  if (!res.ok) return { error: 'invalidToken' }
  return { ok: true }
}
```

- [ ] **Step 3: Create the form component (mirrors accept-invite-form)**

Create `apps/admin/app/reset-password/reset-password-form.tsx`:

```tsx
'use client'

import * as React from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Button } from '@sassy-auth/ui'
import { resetPasswordSubmitAction } from './actions'

export function ResetPasswordForm({ token }: { token: string }) {
  const t = useTranslations('resetPassword')
  const [password, setPassword] = React.useState('')
  const [confirm, setConfirm] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const [success, setSuccess] = React.useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password !== confirm) { setError(t('mismatch')); return }
    if (password.length < 12) { setError(t('tooShort')); return }
    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/.test(password)) { setError(t('complexity')); return }
    setSubmitting(true)
    const res = await resetPasswordSubmitAction(token, password)
    setSubmitting(false)
    if ('error' in res) { setError(t('invalidToken')); return }
    setSuccess(true)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--background)]">
      <div className="w-full max-w-sm rounded-lg border border-[var(--border)] bg-[var(--card)] p-8 shadow-sm">
        {success ? (
          <div className="text-center">
            <p data-testid="reset-success" className="text-body-md text-[var(--foreground)]">{t('success')}</p>
            <div className="mt-4"><Link href="/login" className="text-label-md text-[var(--primary)] hover:underline">{t('backToLogin')}</Link></div>
          </div>
        ) : (
          <>
            <h1 className="mb-6 text-center text-headline-sm text-[var(--foreground)]">{t('title')}</h1>
            <form onSubmit={onSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="password" className="text-label-md font-semibold">{t('password')}</label>
                <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={12}
                  className="flex h-9 rounded border border-[var(--border)] px-3 text-body-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="confirm-password" className="text-label-md font-semibold">{t('confirmPassword')}</label>
                <input id="confirm-password" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required
                  className="flex h-9 rounded border border-[var(--border)] px-3 text-body-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]" />
              </div>
              {error && <p data-testid="reset-error" className="text-label-md text-[var(--destructive)]">{error}</p>}
              <Button type="submit" className="w-full" disabled={submitting}>{submitting ? '…' : t('submit')}</Button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Create the page (reads token, guards missing token)**

Create `apps/admin/app/reset-password/page.tsx`:

```tsx
import { getTranslations } from 'next-intl/server'
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
      <div className="flex min-h-screen items-center justify-center bg-[var(--background)] p-6">
        <div className="w-full max-w-md rounded-lg border border-[var(--border)] bg-[var(--card)] p-8 shadow-sm">
          <p className="text-body-md text-[var(--foreground)]">{t('invalidToken')}</p>
        </div>
      </div>
    )
  }
  return <ResetPasswordForm token={token} />
}
```

- [ ] **Step 5: Build**

Run: `pnpm --filter @sassy-auth/admin build`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/app/reset-password/ apps/admin/messages/
git commit -m "feat(admin): reset-password redemption page"
```

---

### Task 6: Public routes + login link (admin)

**Files:**
- Modify: `apps/admin/middleware.ts`
- Modify: `apps/admin/app/login/login-form.tsx`
- Modify: `apps/admin/messages/en.json`, `messages/fr.json`

- [ ] **Step 1: Allow the new pages through middleware**

In `apps/admin/middleware.ts`, change:

```typescript
const PUBLIC_PATHS = ['/login', '/accept-invite', '/oauth-error']
```

to:

```typescript
const PUBLIC_PATHS = ['/login', '/accept-invite', '/oauth-error', '/forgot-password', '/reset-password']
```

- [ ] **Step 2: Add the login i18n key**

Add `"forgotPassword": "Forgot password?"` under `login` in both locale files (fr: `"forgotPassword": "Mot de passe oublié ?"`).

- [ ] **Step 3: Add the link to the login form**

In `apps/admin/app/login/login-form.tsx`, add `import Link from 'next/link'` at the top. Insert, immediately before the submit `<Button ...>`:

```tsx
<Link href="/forgot-password" className="text-label-md text-[var(--primary)] hover:underline self-end">
  {t('forgotPassword')}
</Link>
```

- [ ] **Step 4: Build**

Run: `pnpm --filter @sassy-auth/admin build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/middleware.ts apps/admin/app/login/login-form.tsx apps/admin/messages/
git commit -m "feat(admin): forgot-password link + public routes"
```

---

### Task 7: End-to-end tests (admin-e2e)

**Files:**
- Create: `apps/admin-e2e/tests/authed/reset-password.spec.ts`
- Create: `apps/admin-e2e/tests/reset-password-flow.spec.ts` (unauthed project)

**Interfaces:** consumes existing e2e helpers (`UsersPage`, `login.page`, seeded `s@sa.io` super admin). All assertions read the **surfaced link** from the UI — CI's Console transport sends nothing.

- [ ] **Step 1: Write the admin-reset e2e (copy-link panel)**

Create `apps/admin-e2e/tests/authed/reset-password.spec.ts`:

```typescript
import { test, expect } from '../../lib/fixtures'
import { t } from '../../lib/i18n'
import { UsersPage } from '../../pages/users.page'

test.describe('Admin password reset', () => {
  test('reset action surfaces a copy-link dialog for an active user', async ({ page }) => {
    const users = new UsersPage(page)
    await users.goto()
    // s@sa.io (super admin) is active and has a credential account.
    await users.search('s@sa.io')
    await users.rowByEmail('s@sa.io').locator('[aria-haspopup="menu"]').click()
    await page.getByRole('menuitem', { name: t('users.actions.resetPassword') }).click()
    // The share-link dialog exposes the reset URL in a readonly field.
    const link = page.getByRole('textbox', { name: t('users.drawer.resetLinkTitle') })
    await expect(link).toBeVisible()
    await expect(link).toHaveValue(/\/reset-password\?token=/)
  })
})
```

- [ ] **Step 2: Run it (expect PASS once servers are running)**

Run: `pnpm --filter @sassy-auth/admin-e2e test:e2e -- reset-password.spec.ts`
Expected: PASS. If it fails on the menu opening, confirm animations-disabled fixture is active (it is, in `lib/fixtures.ts`).

- [ ] **Step 3: Write the user-initiated flow e2e**

Create `apps/admin-e2e/tests/reset-password-flow.spec.ts`:

```typescript
import { test, expect } from '../lib/fixtures'
import { t } from '../lib/i18n'

test.describe('User-initiated password reset', () => {
  test('/forgot-password shows a neutral confirmation', async ({ page }) => {
    await page.goto('/forgot-password')
    await page.getByLabel(t('forgotPassword.email')).fill('s@sa.io')
    await page.getByRole('button', { name: t('forgotPassword.submit') }).click()
    await expect(page.getByTestId('forgot-sent')).toBeVisible()
  })

  test('/reset-password with no token shows the invalid-link message', async ({ page }) => {
    await page.goto('/reset-password')
    await expect(page.getByText(t('resetPassword.invalidToken'))).toBeVisible()
  })
})
```

- [ ] **Step 4: Run the flow e2e**

Run: `pnpm --filter @sassy-auth/admin-e2e test:e2e -- reset-password-flow.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/admin-e2e/tests/authed/reset-password.spec.ts apps/admin-e2e/tests/reset-password-flow.spec.ts
git commit -m "test(e2e): admin + user-initiated password reset"
```

---

## Self-review notes

- **Spec coverage:** Design Section 2 fully covered — sendResetPassword hook + `resetPasswordTokenExpiresIn` (Task 1), admin endpoint returning `{ resetUrl }` with credential guard + AsyncLocalStorage capture (Tasks 1–2), user-initiated forgot/redemption pages (Tasks 4–5), login link + public routes (Task 6), e2e asserting on surfaced links (Task 7).
- **`revokeOtherSessions`:** BetterAuth's `/reset-password` invalidates the reset token and the account password; existing sessions become unusable on next validation. The deactivate kill-switch (Plan 04) covers hard session deletion; no extra option is needed on the reset endpoint for 1.6.11.
- **No placeholders:** all steps have runnable code/commands.
- **Type consistency:** `resetPassword(...)` returns `{ resetUrl: string | null }` in the service (Task 2), the API client (Task 3), and the action (Task 3); `ShareLinkDialog` prop names are stable and reused by Plan 03.
