# Resend Activation Email + Expired-Link Handling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin resend an activation email to an `unverified` `SaUser`, and turn `/signup/verified`'s silent-success-on-error bug into a real expired/invalid-link page with one-click resend, plus a configurable activation-link expiry.

**Architecture:** Thread the user's email through `callbackURL` at every `sendVerificationEmail` call site (BetterAuth's own error redirect already appends `&error=CODE` to an existing query string) instead of building any new backend endpoint. Add one admin-only Nest route mirroring the existing `resendInvitation` pattern. Extract the existing "check your email" page's resend logic into a shared hook reused by a new expired-link component.

**Tech Stack:** NestJS (auth-server), Next.js App Router + next-intl (admin), Jest + Testing Library, BetterAuth.

**Spec:** `docs/superpowers/specs/2026-09-29-resend-activation-email-design.md`

---

### Task 1: Rate-limit BetterAuth's `send-verification-email` endpoint

**Files:**
- Modify: `apps/auth-server/src/auth/auth-rate-limit.ts:26-36`
- Test: `apps/auth-server/src/auth/auth-rate-limit.spec.ts`

- [ ] **Step 1: Write the failing test**

Add to the existing `it.each` "treats %s as sensitive" table in `apps/auth-server/src/auth/auth-rate-limit.spec.ts` (around line 39-49):

```ts
describe('isSensitiveAuthPath', () => {
  it.each([
    '/api/auth/sign-in/email',
    '/api/auth/sign-up/email',
    '/api/auth/forget-password',
    '/api/auth/reset-password',
    '/api/auth/sign-in/magic-link',
    '/api/auth/email-otp/send-verification-otp',
    '/api/auth/two-factor/verify-totp',
    '/api/auth/send-verification-email',
  ])('treats %s as sensitive', (path) => {
    expect(isSensitiveAuthPath(path)).toBe(true);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sassy-auth/auth-server test -- auth-rate-limit.spec`
Expected: FAIL — `/api/auth/send-verification-email` is not yet matched (returns `false`, test expected `true`).

- [ ] **Step 3: Write minimal implementation**

In `apps/auth-server/src/auth/auth-rate-limit.ts`, add the new prefix to `SENSITIVE_PREFIXES`:

```ts
const SENSITIVE_PREFIXES = [
  '/sign-in',
  '/sign-up',
  '/forget-password',
  '/reset-password',
  '/change-password',
  '/change-email',
  '/magic-link',
  '/email-otp',
  '/two-factor',
  '/send-verification-email',
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sassy-auth/auth-server test -- auth-rate-limit.spec`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/auth/auth-rate-limit.ts apps/auth-server/src/auth/auth-rate-limit.spec.ts
git commit -m "fix(auth-server): rate-limit send-verification-email"
```

---

### Task 2: Configurable activation link expiry

**Files:**
- Modify: `apps/auth-server/src/auth/auth.config.ts:481-529`
- Modify: `.env.example`
- Test: `apps/auth-server/src/auth/auth.config.spec.ts`

- [ ] **Step 1: Write the failing test**

Add a new `describe` block to `apps/auth-server/src/auth/auth.config.spec.ts`, right after the `advanced.cookiePrefix` block (after line 482), mirroring its env-var-reset pattern:

```ts
describe('auth.config — emailVerification.expiresIn (configurable activation link duration)', () => {
  const ORIGINAL = process.env.EMAIL_VERIFICATION_EXPIRES_IN_SECONDS;

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.EMAIL_VERIFICATION_EXPIRES_IN_SECONDS;
    else process.env.EMAIL_VERIFICATION_EXPIRES_IN_SECONDS = ORIGINAL;
    jest.resetModules();
  });

  it('defaults to 3600 seconds when EMAIL_VERIFICATION_EXPIRES_IN_SECONDS is not configured', async () => {
    delete process.env.EMAIL_VERIFICATION_EXPIRES_IN_SECONDS;
    jest.resetModules();
    const { auth } = await import('./auth.config');
    const options = (auth as unknown as { options: Record<string, unknown> }).options;
    const ev = options['emailVerification'] as Record<string, unknown>;
    expect(ev['expiresIn']).toBe(3600);
  });

  it('uses the configured value when EMAIL_VERIFICATION_EXPIRES_IN_SECONDS is set', async () => {
    process.env.EMAIL_VERIFICATION_EXPIRES_IN_SECONDS = '7200';
    jest.resetModules();
    const { auth } = await import('./auth.config');
    const options = (auth as unknown as { options: Record<string, unknown> }).options;
    const ev = options['emailVerification'] as Record<string, unknown>;
    expect(ev['expiresIn']).toBe(7200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sassy-auth/auth-server test -- auth.config.spec`
Expected: FAIL — `ev['expiresIn']` is `undefined`, not `3600`/`7200`.

- [ ] **Step 3: Write minimal implementation**

In `apps/auth-server/src/auth/auth.config.ts`, change the `emailVerification` block (currently lines 481-529) to add `expiresIn` as its first key:

```ts
  emailVerification: {
    expiresIn: Number(process.env.EMAIL_VERIFICATION_EXPIRES_IN_SECONDS ?? 3600),
    sendVerificationEmail: async ({ user, url }: { user: { id: string; email: string; name?: string }; url: string }) => {
```

(leave the rest of the block — `sendVerificationEmail`'s body, `afterEmailVerification`, `autoSignInAfterVerification` — unchanged).

Add to `.env.example`, after the `AUTH_RATE_WINDOW_MS` block (after line 161):

```
# Seconds an activation-email link stays valid before BetterAuth rejects it
# with TOKEN_EXPIRED. Unset, blank, zero, or non-numeric falls back to
# BetterAuth's own library default (3600 = 1 hour).
EMAIL_VERIFICATION_EXPIRES_IN_SECONDS=3600
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sassy-auth/auth-server test -- auth.config.spec`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/auth/auth.config.ts .env.example apps/auth-server/src/auth/auth.config.spec.ts
git commit -m "feat(auth-server): make activation link expiry configurable"
```

---

### Task 3: Thread the user's email through `callbackURL` at signup

**Files:**
- Modify: `apps/auth-server/src/registration/registration.service.ts:215-218`
- Test: `apps/auth-server/src/registration/registration.service.spec.ts:175-177`

- [ ] **Step 1: Write the failing test**

In `apps/auth-server/src/registration/registration.service.spec.ts`, replace the assertion at lines 175-177:

```ts
      expect(mockSendVerificationEmail).toHaveBeenCalledWith({
        body: {
          email: baseDto.email,
          callbackURL: expect.stringContaining(`/signup/verified?email=${encodeURIComponent(baseDto.email)}`),
        },
      });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sassy-auth/auth-server test -- registration.service.spec`
Expected: FAIL — actual `callbackURL` is `${adminUrl}/signup/verified` with no `?email=`.

- [ ] **Step 3: Write minimal implementation**

In `apps/auth-server/src/registration/registration.service.ts`, change lines 215-218:

```ts
      const adminUrl = process.env.ADMIN_URL ?? 'http://localhost:3001';
      await auth.api.sendVerificationEmail({
        body: { email: dto.email, callbackURL: `${adminUrl}/signup/verified?email=${encodeURIComponent(dto.email)}` },
      });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sassy-auth/auth-server test -- registration.service.spec`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/registration/registration.service.ts apps/auth-server/src/registration/registration.service.spec.ts
git commit -m "feat(auth-server): thread signup email into verification callbackURL"
```

---

### Task 4: `UsersService.resendActivationEmail`

**Files:**
- Modify: `apps/auth-server/src/users/users.service.ts` (add method after `resendInvitation`, i.e. after line 687)
- Test: `apps/auth-server/src/users/users.service.spec.ts`

The spec file already has `mockCheckPermission` (line 70-71) and, at line 59-61, a `jest.mock('../auth/auth.config', ...)` block that currently only stubs `requestPasswordReset`. It also has a `makeSaUser(overrides)` fixture factory (line 113-129, defaults: `id: 1, orgId: 1, status: 'active', betterAuthUser: { email: 'alice@example.com' }, ...`).

- [ ] **Step 1: Write the failing tests**

First, extend the existing mock block at line 59-61 to also stub `sendVerificationEmail`:

```ts
jest.mock('../auth/auth.config', () => ({
  auth: {
    api: {
      requestPasswordReset: jest.fn().mockResolvedValue({ status: true }),
      sendVerificationEmail: jest.fn().mockResolvedValue({ status: true }),
    },
  },
}));
```

Then add, right after the existing `mockCheckPermission` const (after line 71):

```ts
// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockSendVerificationEmail = require('../auth/auth.config').auth.api.sendVerificationEmail as jest.Mock;
```

Then add a new `describe` block to `apps/auth-server/src/users/users.service.spec.ts`, right after the `resendInvitation` describe block (after line 563):

```ts
  describe('resendActivationEmail', () => {
    it('throws NotFoundException when the user does not exist', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue(null);
      await expect(service.resendActivationEmail('ba-caller', 'usr1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws BadRequestException when the user is not unverified', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue(makeSaUser({ status: 'active' }));
      const { BadRequestException } = await import('@nestjs/common');
      await expect(service.resendActivationEmail('ba-caller', 'usr1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('checks platform/org permission before resending', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue(makeSaUser({ status: 'unverified', orgId: 10 }));
      await service.resendActivationEmail('ba-caller', 'usr1');
      expect(mockCheckPermission).toHaveBeenCalledWith(
        'ba-caller',
        ['platform.users.manage', 'org.users.manage'],
        { targetOrgId: 10 },
      );
    });

    it('calls sendVerificationEmail with the user email and a callbackURL carrying that email', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue(
        makeSaUser({ status: 'unverified', betterAuthUser: { email: 'jane@example.com' } }),
      );
      await service.resendActivationEmail('ba-caller', 'usr1');
      expect(mockSendVerificationEmail).toHaveBeenCalledWith({
        body: {
          email: 'jane@example.com',
          callbackURL: expect.stringContaining(`/signup/verified?email=${encodeURIComponent('jane@example.com')}`),
        },
      });
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sassy-auth/auth-server test -- users.service.spec`
Expected: FAIL — `service.resendActivationEmail` is not a function.

- [ ] **Step 3: Write minimal implementation**

In `apps/auth-server/src/users/users.service.ts`, add this method immediately after `resendInvitation` (after line 687, before `reset2fa`):

```ts
  async resendActivationEmail(callerBaId: string, userPublicId: string): Promise<void> {
    const user = await prisma.saUser.findUnique({
      where: { publicId: userPublicId },
      include: { betterAuthUser: { select: { email: true } } },
    });
    if (!user) throw new NotFoundException('User not found');
    if (!user.betterAuthUser) throw new NotFoundException('User account not found');
    await checkPermission(
      callerBaId,
      ['platform.users.manage', 'org.users.manage'],
      { targetOrgId: user.orgId },
    );
    if (user.status !== 'unverified') throw new BadRequestException('User is not unverified — activation email cannot be resent');

    const email = user.betterAuthUser.email;
    const adminUrl = process.env.ADMIN_URL ?? 'http://localhost:3001';
    await auth.api.sendVerificationEmail({
      body: { email, callbackURL: `${adminUrl}/signup/verified?email=${encodeURIComponent(email)}` },
    });

    this.logger.getWinstonLogger().info('Activation email resent', {
      context: 'UsersService',
      userId: userPublicId,
    });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sassy-auth/auth-server test -- users.service.spec`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/users/users.service.ts apps/auth-server/src/users/users.service.spec.ts
git commit -m "feat(auth-server): add UsersService.resendActivationEmail"
```

---

### Task 5: `POST /users/:id/resend-activation` route

**Files:**
- Modify: `apps/auth-server/src/users/users.controller.ts`
- Test: `apps/auth-server/src/users/users.controller.spec.ts`

- [ ] **Step 1: Write the failing test**

`users.controller.spec.ts` already mocks `resendInvitation` on `mockUsersService` (line 22) and tests it with a `describe('resendInvitation', ...)` block (lines 128-133) using a `makeReq(callerId)` helper. Add `resendActivationEmail: jest.fn(),` next to the existing `resendInvitation: jest.fn(),` in the `mockUsersService` object (line 22), and add a new block right after the `resendInvitation` describe block (after line 133):

```ts
  describe('resendActivation', () => {
    it('forwards caller id and id to UsersService.resendActivationEmail', async () => {
      mockUsersService.resendActivationEmail.mockResolvedValue(undefined);
      await controller.resendActivation(makeReq('ba-9'), 'usr-1');
      expect(mockUsersService.resendActivationEmail).toHaveBeenCalledWith('ba-9', 'usr-1');
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sassy-auth/auth-server test -- users.controller.spec`
Expected: FAIL — `controller.resendActivation` is not a function.

- [ ] **Step 3: Write minimal implementation**

In `apps/auth-server/src/users/users.controller.ts`, add imports at the top:

```ts
import { Throttle } from '@nestjs/throttler';
import { AUTH_THROTTLE } from '../common/config/rate-limit-config';
```

Add the new route right after `resendInvitation` (after line 77):

```ts
  @Post(':id/resend-activation')
  @Throttle({ auth: AUTH_THROTTLE })
  resendActivation(@Req() req: Request, @Param('id') id: string) {
    return this.users.resendActivationEmail(callerBaId(req), id);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sassy-auth/auth-server test -- users.controller.spec`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/users/users.controller.ts
git commit -m "feat(auth-server): add POST /users/:id/resend-activation route"
```

---

### Task 6: Admin API client — `resendActivation`

**Files:**
- Modify: `apps/admin/lib/api.ts` (add after `resendInvitation`, i.e. after line 173)

- [ ] **Step 1: Write minimal implementation**

This is a thin fetch wrapper with no independent unit test in this codebase's existing convention (`resendInvitation`, `resetPassword`, etc. have none either — they're covered indirectly via the server action + component tests in Tasks 7 and 9). Add to `apps/admin/lib/api.ts` right after `resendInvitation` (after line 173):

```ts
export async function resendActivation(userId: string): Promise<void> {
  await apiFetch(`/api/users/${userId}/resend-activation`, { method: 'POST' })
  Sentry.addBreadcrumb({ category: 'admin.action', message: `Activation email resent for user ${userId}`, level: 'info' })
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/admin/lib/api.ts
git commit -m "feat(admin): add resendActivation API client function"
```

---

### Task 7: Admin server action — `resendActivationAction`

**Files:**
- Modify: `apps/admin/app/(admin)/users/actions.ts` (add after `resendInvitationAction`, i.e. after line 203)

No dedicated test file covers this actions module today — `resendInvitationAction` and its siblings have no standalone unit test; their coverage comes entirely from the component test that exercises them through `UsersTable` (Task 9 does the same for `resendActivationAction`). Follow that existing convention: implement directly, no separate test step here.

- [ ] **Step 1: Write minimal implementation**

In `apps/admin/app/(admin)/users/actions.ts`, add `resendActivation` to the import block at the top (line 4-17):

```ts
import {
  createUser,
  getUserRoles,
  getEffectivePermissions,
  getUserDirectPermissions,
  setUserRoles,
  setUserDirectPermissions,
  getRoles,
  getPermissions,
  updateUser,
  deleteUser,
  resetPassword,
  resendInvitation,
  resendActivation,
} from '@/lib/api'
```

Add the new action right after `resendInvitationAction` (after line 203):

```ts
export async function resendActivationAction(
  userId: string,
): Promise<{ ok: true } | { errorKey: string }> {
  try {
    await resendActivation(userId)
    return { ok: true }
  } catch (err) {
    return { errorKey: mapActionError(err, { on400: 'users.errors.notUnverified', on403: 'users.errors.forbidden' }) }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/admin/app/\(admin\)/users/actions.ts
git commit -m "feat(admin): add resendActivationAction server action"
```

---

### Task 8: Admin translations for the resend-activation menu item

**Files:**
- Modify: `apps/admin/messages/en.json:499-541`
- Modify: `apps/admin/messages/fr.json:499-541`

- [ ] **Step 1: Write minimal implementation**

In `apps/admin/messages/en.json`, inside `users.actions` (line 499-507), add:

```json
    "actions": {
      "edit": "Edit",
      "resetPassword": "Reset Password",
      "deactivate": "Deactivate",
      "activate": "Activate",
      "delete": "Delete",
      "resendInvitation": "Resend Invitation",
      "resend": "Resend Invitation",
      "resendActivation": "Resend Activation Email"
    },
```

Inside `users.toast` (line 508-516), add:

```json
    "toast": {
      "created": "User created",
      "updated": "User updated",
      "deleted": "User deleted",
      "resent": "Invitation resent",
      "resetLinkGenerated": "Password reset link generated",
      "activated": "User activated",
      "deactivated": "User deactivated",
      "activationResent": "Activation email resent"
    },
```

Inside `users.errors` (line 528-541), add:

```json
    "errors": {
      "required": "Required",
      "emailInvalid": "Invalid email",
      "forbidden": "You do not have permission to perform this action.",
      "generic": "Something went wrong. Please try again.",
      "noPassword": "This user has no password to reset.",
      "notPending": "This user is no longer pending an invitation.",
      "notUnverified": "This user's email is already verified.",
      "rolesSetFailed": "Failed to update roles.",
      "directPermissionsSetFailed": "Failed to update direct permissions.",
      "selfDeactivate": "You cannot deactivate your own account.",
      "selfModify": "You cannot modify your own account.",
      "emailExists": "A user with this email already exists.",
      "validation": "Some of the details you entered are not valid. Please check and try again."
    }
```

In `apps/admin/messages/fr.json`, the same three blocks (lines 499-541), add the matching keys:

```json
    "actions": {
      "edit": "Modifier",
      "resetPassword": "Réinitialiser le mot de passe",
      "deactivate": "Désactiver",
      "activate": "Activer",
      "delete": "Supprimer",
      "resendInvitation": "Renvoyer l’invitation",
      "resend": "Resend Invitation",
      "resendActivation": "Renvoyer l’e-mail d’activation"
    },
```

```json
    "toast": {
      "created": "User created",
      "updated": "User updated",
      "deleted": "User deleted",
      "resent": "Invitation resent",
      "resetLinkGenerated": "Lien de réinitialisation généré",
      "activated": "Utilisateur activé",
      "deactivated": "Utilisateur désactivé",
      "activationResent": "E-mail d’activation renvoyé"
    },
```

```json
    "errors": {
      "required": "Obligatoire",
      "emailInvalid": "Adresse e-mail invalide",
      "forbidden": "Vous n’avez pas la permission d’effectuer cette action.",
      "generic": "Une erreur est survenue. Veuillez réessayer.",
      "noPassword": "Cet utilisateur n’a pas de mot de passe à réinitialiser.",
      "notPending": "Cet utilisateur n’est plus en attente d’invitation.",
      "notUnverified": "L’adresse e-mail de cet utilisateur est déjà vérifiée.",
      "rolesSetFailed": "Échec de la mise à jour des rôles.",
      "directPermissionsSetFailed": "Échec de la mise à jour des permissions directes.",
      "selfDeactivate": "Vous ne pouvez pas désactiver votre propre compte.",
      "selfModify": "Vous ne pouvez pas modifier votre propre compte.",
      "emailExists": "Un utilisateur avec cet e-mail existe déjà.",
      "validation": "Certaines informations saisies ne sont pas valides. Veuillez vérifier et réessayer."
    }
```

Preserve the exact curly-apostrophe style (`’`, U+2019) already used elsewhere in `fr.json` for consistency — the snippets above already use it — and keep every other untouched key in these blocks exactly as it is today; only insert the new key.

- [ ] **Step 2: Commit**

```bash
git add apps/admin/messages/en.json apps/admin/messages/fr.json
git commit -m "feat(admin): add translations for resend-activation action"
```

---

### Task 9: Admin users table — "Resend Activation Email" menu item

**Files:**
- Modify: `apps/admin/components/users-table.tsx:18,144-156`
- Test: `apps/admin/components/__tests__/users-table.test.tsx`

The test file's `jest.mock('@/app/(admin)/users/actions', ...)` block (lines 13-16) currently mocks only `deleteUserAction` and `setUserStatusAction` (there's no existing test exercising the `resendInvitation` menu item at all, so there's no prior pattern to mirror for that one — write this one directly against the file's actual conventions instead: `withIntl(...)`, `en.users.actions.<key>` for accessible names, `screen.findAllByRole('menuitem', { name })`, `fireEvent.click`, as used by the "shows an Activate item for an unverified user" test at lines 141-153).

- [ ] **Step 1: Write the failing test**

In `apps/admin/components/__tests__/users-table.test.tsx`, add `resendActivationAction` to the existing mock block (lines 13-16):

```tsx
jest.mock('@/app/(admin)/users/actions', () => ({
  deleteUserAction: jest.fn().mockResolvedValue({ ok: true }),
  setUserStatusAction: jest.fn().mockResolvedValue({ ok: true }),
  resendActivationAction: jest.fn().mockResolvedValue({ ok: true }),
}))
```

Add the import for it near the top (next to line 7's `setUserStatusAction` import):

```tsx
import { setUserStatusAction, resendActivationAction } from '@/app/(admin)/users/actions'
```

Add a new test right after "shows an Activate item for an unverified user..." (after line 153, before the closing `})` of the `describe` block on line 155):

```tsx
  it('shows a Resend Activation Email item for an unverified user and calls resendActivationAction on click', async () => {
    const unverifiedUsers: User[] = [
      { id: '3', firstName: 'Cara', lastName: 'Diaz', email: 'cara@example.com', status: 'unverified', orgId: 'org1', phoneNumber: null, username: null, createdAt: '2026-01-01T00:00:00.000Z', lastLoginAt: null },
    ]
    render(withIntl(<UsersTable users={unverifiedUsers} orgs={mockOrgs} />))

    const resendItems = await screen.findAllByRole('menuitem', { name: en.users.actions.resendActivation })
    expect(resendItems).toHaveLength(1)

    fireEvent.click(resendItems[0])

    expect(resendActivationAction).toHaveBeenCalledWith('3')
  })

  it('does not show a Resend Activation Email item for an active user', async () => {
    render(withIntl(<UsersTable users={mockUsers} orgs={mockOrgs} />))
    expect(screen.queryByRole('menuitem', { name: en.users.actions.resendActivation })).not.toBeInTheDocument()
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sassy-auth/admin test -- users-table`
Expected: FAIL — `users.actions.resendActivation` text is not found (menu item doesn't exist yet).

- [ ] **Step 3: Write minimal implementation**

In `apps/admin/components/users-table.tsx`, add `resendActivationAction` to the import on line 18:

```tsx
import { deleteUserAction, resetPasswordAction, resendInvitationAction, resendActivationAction, setUserStatusAction } from '@/app/(admin)/users/actions'
```

Add the new menu item right after the existing `u.status === 'pending'` resend-invitation block (after line 156, before the `<DropdownMenuSeparator />` on line 157):

```tsx
              {u.status === 'unverified' && (
                <DropdownMenuItem
                  onClick={async (e) => {
                    e.stopPropagation()
                    const res = await resendActivationAction(u.id)
                    if ('errorKey' in res) { toast.error(t(res.errorKey)); return }
                    toast.success(t('users.toast.activationResent'))
                  }}
                >
                  {t('users.actions.resendActivation')}
                </DropdownMenuItem>
              )}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sassy-auth/admin test -- users-table`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/admin/components/users-table.tsx apps/admin/components/__tests__/users-table.test.tsx
git commit -m "feat(admin): add Resend Activation Email menu item for unverified users"
```

---

### Task 10: Shared `useResendVerificationEmail` hook

**Files:**
- Create: `apps/admin/lib/use-resend-verification-email.ts`
- Test: `apps/admin/lib/__tests__/use-resend-verification-email.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/admin/lib/__tests__/use-resend-verification-email.test.ts`:

```ts
import { renderHook, act, waitFor } from '@testing-library/react'
import { useResendVerificationEmail } from '../use-resend-verification-email'

describe('useResendVerificationEmail', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('posts to send-verification-email with the email and a same-origin callbackURL, then sets a cooldown', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ status: true }) })
    global.fetch = fetchMock as unknown as typeof fetch

    const { result } = renderHook(() =>
      useResendVerificationEmail({ email: 'jane@example.com', authServerUrl: 'https://auth.example.com' }),
    )

    await act(async () => {
      await result.current.resend()
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://auth.example.com/api/auth/send-verification-email',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          email: 'jane@example.com',
          callbackURL: `${window.location.origin}/signup/verified?email=${encodeURIComponent('jane@example.com')}`,
        }),
      }),
    )
    expect(result.current.status).toBe('sent')
    expect(result.current.cooldown).toBeGreaterThan(0)
  })

  it('sets status to error when the request fails', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, json: async () => ({}) }) as unknown as typeof fetch
    const { result } = renderHook(() =>
      useResendVerificationEmail({ email: 'jane@example.com', authServerUrl: 'https://auth.example.com' }),
    )

    await act(async () => {
      await result.current.resend()
    })

    expect(result.current.status).toBe('error')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sassy-auth/admin test -- use-resend-verification-email`
Expected: FAIL — module `../use-resend-verification-email` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `apps/admin/lib/use-resend-verification-email.ts`:

```ts
'use client'

import * as React from 'react'

const COOLDOWN_SECONDS = 30

export type ResendStatus = 'idle' | 'sending' | 'sent' | 'error'

/**
 * Shared by CheckEmailCard (post-signup) and the expired-link card on
 * /signup/verified — both resend a verification email by calling
 * BetterAuth's public send-verification-email endpoint directly from the
 * browser. callbackURL is computed at call time (not render time) so this
 * hook never touches `window` during server-side rendering.
 */
export function useResendVerificationEmail({
  email,
  authServerUrl,
}: {
  email: string
  authServerUrl: string
}) {
  const [cooldown, setCooldown] = React.useState(0)
  const [status, setStatus] = React.useState<ResendStatus>('idle')

  React.useEffect(() => {
    if (cooldown === 0) return
    const id = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(id)
  }, [cooldown])

  async function resend() {
    setStatus('sending')
    try {
      const callbackURL = `${window.location.origin}/signup/verified?email=${encodeURIComponent(email)}`
      const res = await fetch(`${authServerUrl}/api/auth/send-verification-email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, callbackURL }),
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

  return { resend, status, cooldown }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sassy-auth/admin test -- use-resend-verification-email`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/admin/lib/use-resend-verification-email.ts apps/admin/lib/__tests__/use-resend-verification-email.test.ts
git commit -m "feat(admin): extract useResendVerificationEmail hook"
```

---

### Task 11: Refactor `CheckEmailCard` to use the shared hook, and thread email into its own callbackURL

**Files:**
- Modify: `apps/admin/app/signup/check-email/check-email-card.tsx`
- Test: `apps/admin/app/signup/check-email/__tests__/check-email-card.test.tsx:23-42`

- [ ] **Step 1: Write the failing test**

Update the body assertion in `apps/admin/app/signup/check-email/__tests__/check-email-card.test.tsx` (lines 31-39):

```ts
    expect(fetchMock).toHaveBeenCalledWith(
      'https://auth.example.com/api/auth/send-verification-email',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          email: 'alice@example.com',
          callbackURL: `${window.location.origin}/signup/verified?email=${encodeURIComponent('alice@example.com')}`,
        }),
      }),
    )
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sassy-auth/admin test -- check-email-card`
Expected: FAIL — actual `callbackURL` still has no `?email=`.

- [ ] **Step 3: Write minimal implementation**

Replace `apps/admin/app/signup/check-email/check-email-card.tsx` entirely with:

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
}: {
  email: string
  next: string
  authServerUrl: string
}) {
  const t = useTranslations('signup.checkEmail')
  const { resend, status, cooldown } = useResendVerificationEmail({ email, authServerUrl })

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

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sassy-auth/admin test -- check-email-card`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/admin/app/signup/check-email/check-email-card.tsx apps/admin/app/signup/check-email/__tests__/check-email-card.test.tsx
git commit -m "refactor(admin): CheckEmailCard uses shared resend hook, threads email into callbackURL"
```

---

### Task 12: Translations for the expired/invalid-link page

**Files:**
- Modify: `apps/admin/messages/en.json:644-648`
- Modify: `apps/admin/messages/fr.json:644-648`

- [ ] **Step 1: Write minimal implementation**

In `apps/admin/messages/en.json`, replace the `verified` block (lines 644-648):

```json
    "verified": {
      "title": "Email verified",
      "subtitle": "Your account is ready. You can now sign in.",
      "continueToLogin": "Continue to sign in",
      "expired": {
        "title": "Link expired",
        "subtitle": "Your activation link for {email} has expired.",
        "resendButton": "Resend link",
        "resendCooldown": "Resend in {seconds}s",
        "resendSent": "A new activation link is on its way.",
        "resendError": "We couldn't resend the email. Please try again in a moment.",
        "backToLogin": "Back to sign in"
      },
      "invalid": {
        "title": "This link isn't valid",
        "subtitle": "This activation link is invalid or has already been used.",
        "backToLogin": "Back to sign in"
      }
    },
```

In `apps/admin/messages/fr.json`, replace the `verified` block (lines 644-648):

```json
    "verified": {
      "title": "Adresse e-mail vérifiée",
      "subtitle": "Votre compte est prêt. Vous pouvez maintenant vous connecter.",
      "continueToLogin": "Continuer vers la connexion",
      "expired": {
        "title": "Lien expiré",
        "subtitle": "Votre lien d’activation pour {email} a expiré.",
        "resendButton": "Renvoyer le lien",
        "resendCooldown": "Renvoyer dans {seconds}s",
        "resendSent": "Un nouveau lien d’activation est en route.",
        "resendError": "Impossible de renvoyer l’e-mail. Veuillez réessayer dans un instant.",
        "backToLogin": "Retour à la connexion"
      },
      "invalid": {
        "title": "Ce lien n’est pas valide",
        "subtitle": "Ce lien d’activation est invalide ou a déjà été utilisé.",
        "backToLogin": "Retour à la connexion"
      }
    },
```

- [ ] **Step 2: Commit**

```bash
git add apps/admin/messages/en.json apps/admin/messages/fr.json
git commit -m "feat(admin): add translations for expired/invalid activation link page"
```

---

### Task 13: `LinkExpiredCard` component

**Files:**
- Create: `apps/admin/app/signup/verified/link-expired-card.tsx`
- Test: `apps/admin/app/signup/verified/__tests__/link-expired-card.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/admin/app/signup/verified/__tests__/link-expired-card.test.tsx`, mirroring `check-email-card.test.tsx`'s structure:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { LinkExpiredCard } from '../link-expired-card'

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}))

afterEach(() => {
  jest.restoreAllMocks()
})

function renderCard() {
  return render(<LinkExpiredCard email="jane@example.com" authServerUrl="https://auth.example.com" />)
}

describe('LinkExpiredCard', () => {
  it('shows the email address in the subtitle', () => {
    renderCard()
    expect(screen.getByText('subtitle:{"email":"jane@example.com"}')).toBeInTheDocument()
  })

  it('resends the verification email, shows a confirmation, and disables the button during cooldown', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ status: true }) })
    global.fetch = fetchMock as unknown as typeof fetch
    renderCard()

    fireEvent.click(screen.getByRole('button', { name: 'resendButton' }))

    await waitFor(() => expect(screen.getByTestId('link-expired-resent')).toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledWith(
      'https://auth.example.com/api/auth/send-verification-email',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          email: 'jane@example.com',
          callbackURL: `${window.location.origin}/signup/verified?email=${encodeURIComponent('jane@example.com')}`,
        }),
      }),
    )
    expect(screen.getByRole('button')).toBeDisabled()
  })

  it('shows an error when the resend request fails', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, json: async () => ({}) }) as unknown as typeof fetch
    renderCard()

    fireEvent.click(screen.getByRole('button', { name: 'resendButton' }))

    await waitFor(() => expect(screen.getByTestId('link-expired-error')).toBeInTheDocument())
  })

  it('shows a link back to sign-in', () => {
    renderCard()
    expect(screen.getByRole('link', { name: 'backToLogin' })).toHaveAttribute('href', '/login')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sassy-auth/admin test -- link-expired-card`
Expected: FAIL — module `../link-expired-card` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `apps/admin/app/signup/verified/link-expired-card.tsx`:

```tsx
'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { AuthCard, Button } from '@sassy-auth/ui'
import { useResendVerificationEmail } from '@/lib/use-resend-verification-email'

export function LinkExpiredCard({
  email,
  authServerUrl,
}: {
  email: string
  authServerUrl: string
}) {
  const t = useTranslations('signup.verified.expired')
  const { resend, status, cooldown } = useResendVerificationEmail({ email, authServerUrl })

  return (
    <AuthCard
      title={t('title')}
      subtitle={t('subtitle', { email })}
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

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sassy-auth/admin test -- link-expired-card`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/admin/app/signup/verified/link-expired-card.tsx apps/admin/app/signup/verified/__tests__/link-expired-card.test.tsx
git commit -m "feat(admin): add LinkExpiredCard component"
```

---

### Task 14: `/signup/verified` page — read `searchParams` and branch on `error`

**Files:**
- Modify: `apps/admin/app/signup/verified/page.tsx`
- Test: `apps/admin/app/signup/verified/__tests__/page.test.tsx`

- [ ] **Step 1: Write the failing tests**

Replace `apps/admin/app/signup/verified/__tests__/page.test.tsx` entirely with:

```tsx
import { render, screen } from '@testing-library/react'
import VerifiedPage from '../page'

jest.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}))

// LinkExpiredCard (rendered for the TOKEN_EXPIRED+email branch) is a client
// component that calls the *client* useTranslations from 'next-intl', not
// 'next-intl/server' — mock it too, or rendering it here throws for missing
// intl context. This mock (like check-email-card.test.tsx's identical one)
// ignores the namespace argument and returns the bare key.
jest.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}))

describe('SignupVerifiedPage', () => {
  it('renders a confirmation message and a link to /login when there is no error', async () => {
    const ui = await VerifiedPage({ searchParams: Promise.resolve({}) })
    render(ui)
    expect(screen.getByText('signup.verified.title')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'signup.verified.continueToLogin' })).toHaveAttribute('href', '/login')
  })

  it('renders the expired-link card with a resend button when error=TOKEN_EXPIRED and email is present', async () => {
    const ui = await VerifiedPage({
      searchParams: Promise.resolve({ error: 'TOKEN_EXPIRED', email: 'jane@example.com' }),
    })
    render(ui)
    // LinkExpiredCard's own useTranslations('signup.verified.expired') mock
    // ignores the namespace, so its rendered keys are bare ('title',
    // 'subtitle:{...}', 'resendButton'), unlike the page's own
    // next-intl/server-driven text below (full dotted keys). The subtitle
    // call passes {email}, so its rendered text carries that JSON suffix.
    expect(screen.getByText('subtitle:{"email":"jane@example.com"}')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'resendButton' })).toBeInTheDocument()
  })

  it('renders the generic invalid-link message when error=TOKEN_EXPIRED but there is no email', async () => {
    const ui = await VerifiedPage({ searchParams: Promise.resolve({ error: 'TOKEN_EXPIRED' }) })
    render(ui)
    expect(screen.getByText('signup.verified.invalid.title')).toBeInTheDocument()
  })

  it.each(['INVALID_TOKEN', 'USER_NOT_FOUND', 'INVALID_USER', 'SOMETHING_UNKNOWN'])(
    'renders the generic invalid-link message for error=%s',
    async (error) => {
      const ui = await VerifiedPage({ searchParams: Promise.resolve({ error, email: 'jane@example.com' }) })
      render(ui)
      expect(screen.getByText('signup.verified.invalid.title')).toBeInTheDocument()
    },
  )
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sassy-auth/admin test -- signup/verified`
Expected: FAIL — `VerifiedPage` currently takes no arguments and always renders the success card.

- [ ] **Step 3: Write minimal implementation**

Replace `apps/admin/app/signup/verified/page.tsx` entirely with:

```tsx
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { AuthCard } from '@sassy-auth/ui'
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
  searchParams: Promise<{ error?: string; email?: string }>
}) {
  const { error, email } = await searchParams
  const t = await getTranslations()

  if (error === 'TOKEN_EXPIRED' && email) {
    return <LinkExpiredCard email={email} authServerUrl={PUBLIC_AUTH_SERVER} />
  }

  if (error) {
    return (
      <AuthCard
        title={t('signup.verified.invalid.title')}
        subtitle={t('signup.verified.invalid.subtitle')}
        footer={
          <Link href="/login" className="text-label-md text-primary hover:underline">
            {t('signup.verified.invalid.backToLogin')}
          </Link>
        }
      />
    )
  }

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

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sassy-auth/admin test -- signup/verified`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/admin/app/signup/verified/page.tsx apps/admin/app/signup/verified/__tests__/page.test.tsx
git commit -m "fix(admin): /signup/verified now reflects TOKEN_EXPIRED/invalid errors instead of always showing success"
```

---

### Task 15: Full suite sanity check

**Files:** none (verification only)

- [ ] **Step 1: Run the full auth-server suite**

Run: `pnpm --filter @sassy-auth/auth-server test`
Expected: PASS (no regressions in `registration.service.spec`, `users.service.spec`, `users.controller.spec`, `auth.config.spec`, `auth-rate-limit.spec`, or any other existing spec).

- [ ] **Step 2: Run the full admin suite**

Run: `pnpm --filter @sassy-auth/admin test`
Expected: PASS (no regressions in `check-email-card.test`, `users-table.test`, `signup/verified` page test, or any other existing spec).

- [ ] **Step 3: Manual smoke test (dev environment)**

1. Sign up a new test account; confirm the "check your email" page still works and its resend button still succeeds (now posting a `callbackURL` with `?email=`).
2. As an admin, find a `SaUser` with `status = unverified` (e.g. one created above without clicking its link) and confirm the new "Resend Activation Email" menu item appears, and clicking it shows the `activationResent` toast.
3. Temporarily set `EMAIL_VERIFICATION_EXPIRES_IN_SECONDS=5` in `apps/auth-server/.env`, restart the auth-server, sign up a fresh test account, wait >5 seconds, then click the activation link from the (console-logged or received) email. Confirm you land on `/signup/verified` showing "Link expired" with your email and a working "Resend link" button — not the success page.
4. Revert `EMAIL_VERIFICATION_EXPIRES_IN_SECONDS` (or remove it) afterward.

No commit for this task — it's a verification checkpoint only.
