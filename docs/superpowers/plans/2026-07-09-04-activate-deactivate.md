# Activate / Deactivate User — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Depends on:** none of the email plans (no email here). Independent — can run any time. Reuses the existing `DeleteAlertDialog` for confirmation.

**Goal:** Wire the stubbed activate/deactivate row actions. Deactivation is a kill-switch: it blocks new logins (existing behavior) **and** deletes the user's active sessions, and it cannot be applied to your own account.

**Architecture:** `updateUser` already applies `status`. Add (1) a self-guard so an admin can't deactivate themselves, and (2) session deletion when status becomes `inactive`. The admin UI wires the two menu items — deactivate behind a confirm dialog, activate directly — and hides the deactivate item on the current admin's own row.

**Tech Stack:** NestJS, Prisma, Jest, Next.js server actions, Playwright.

## Global Constraints

- Sessions live in the Prisma `Session` model, keyed by `userId` = BetterAuth `User.id` = `SaUser.betterAuthUserId`.
- `updateUser` signature is unchanged: `updateUser(callerBaId, publicId, dto)`; `dto.status` is `'active' | 'pending' | 'inactive'`.
- The caller's BetterAuth id is `callerBaId`; a user's is `existing.betterAuthUserId`.
- `MeProfile.userId` is the current admin's `SaUser.publicId`; table rows use `u.id` = `SaUser.publicId`.
- Actions return `{ ok: true } | { errorKey }`; i18n keys go in **both** `messages/en.json` and `messages/fr.json`.
- Tests: `pnpm --filter @sassy-auth/auth-server test`; e2e per repo convention.

---

### Task 1: Session kill-switch + self-guard (auth-server)

**Files:**
- Modify: `apps/auth-server/src/users/users.service.ts` (`updateUser`)
- Test: `apps/auth-server/src/users/users.service.spec.ts`

**Interfaces:**
- Consumes: `prisma` (add `session.deleteMany`), `ForbiddenException`.
- Produces: `updateUser` unchanged signature; new side effects when `dto.status === 'inactive'`.

- [ ] **Step 1: Add the `session` mock + failing tests**

In `apps/auth-server/src/users/users.service.spec.ts`, add `session: { deleteMany: jest.fn() }` to the prisma object in `jest.mock('@sassy-auth/db', ...)` and to the `mockPrisma` type. Then add:

```typescript
describe('updateUser status kill-switch', () => {
  beforeEach(() => {
    mockPrisma.saUser.findUnique.mockResolvedValue(makeSaUser({ betterAuthUserId: 'ba-target', orgId: 1 }));
    mockPrisma.saUser.update.mockResolvedValue(makeSaUser({ status: 'inactive' }));
    mockPrisma.session.deleteMany.mockResolvedValue({ count: 2 });
  });

  it('deletes the user sessions when status becomes inactive', async () => {
    await service.updateUser('ba-caller', 'usr1', { status: 'inactive' });
    expect(mockPrisma.session.deleteMany).toHaveBeenCalledWith({ where: { userId: 'ba-target' } });
  });

  it('does not delete sessions for a non-inactive update', async () => {
    mockPrisma.saUser.update.mockResolvedValue(makeSaUser({ status: 'active' }));
    await service.updateUser('ba-caller', 'usr1', { firstName: 'New' });
    expect(mockPrisma.session.deleteMany).not.toHaveBeenCalled();
  });

  it('forbids deactivating your own account', async () => {
    mockPrisma.saUser.findUnique.mockResolvedValue(makeSaUser({ betterAuthUserId: 'ba-self', orgId: 1 }));
    await expect(service.updateUser('ba-self', 'usr1', { status: 'inactive' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(mockPrisma.session.deleteMany).not.toHaveBeenCalled();
  });
});
```

Ensure `ForbiddenException` is imported at the top of the spec (`import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';`).

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @sassy-auth/auth-server exec jest src/users/users.service.spec.ts -t "kill-switch"`
Expected: FAIL — `session.deleteMany` not called / no self-guard.

- [ ] **Step 3: Add the self-guard + session deletion in `updateUser`**

In `apps/auth-server/src/users/users.service.ts`, in `updateUser`, immediately after the `checkPermission(...)` call and before the `prisma.saUser.update(...)`, insert:

```typescript
  // Deactivation is a kill-switch and must not be self-inflicted.
  if (dto.status === 'inactive' && existing.betterAuthUserId === callerBaId) {
    throw new ForbiddenException('You cannot deactivate your own account');
  }
```

Then, immediately after the `const updated = await prisma.saUser.update({ ... });` call, insert:

```typescript
  // On deactivation, revoke every active session so the user is logged out
  // everywhere at once (blocking new logins/tokens is enforced elsewhere).
  if (dto.status === 'inactive') {
    await prisma.session.deleteMany({ where: { userId: existing.betterAuthUserId } });
  }
```

- [ ] **Step 4: Run tests + build**

Run: `pnpm --filter @sassy-auth/auth-server exec jest src/users/users.service.spec.ts`
Expected: PASS (all, incl. the 3 new).
Run: `pnpm --filter @sassy-auth/auth-server build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/users/users.service.ts apps/auth-server/src/users/users.service.spec.ts
git commit -m "feat(users): deactivate revokes sessions + self-guard"
```

---

### Task 2: Wire activate/deactivate in the admin UI

**Files:**
- Modify: `apps/admin/app/(admin)/users/actions.ts`
- Modify: `apps/admin/components/users-table.tsx`
- Modify: `apps/admin/app/(admin)/users/page.tsx`
- Modify: `apps/admin/messages/en.json`, `messages/fr.json`

**Interfaces:**
- Consumes: `updateUser` (lib/api), `DeleteAlertDialog` (existing), `toast` (sonner).
- Produces: `setUserStatusAction(userId: string, status: 'active' | 'inactive'): Promise<{ ok: true } | { errorKey: string }>`; `UsersTable` gains a `currentUserId?: string` prop.

- [ ] **Step 1: Add i18n keys**

Add to both locale files. Under `users.toast`: `"activated": "User activated"`, `"deactivated": "User deactivated"`. Under `users.errors`: `"selfDeactivate": "You cannot deactivate your own account."`. Add a `users.confirmDeactivate` block:

```json
"confirmDeactivate": {
  "title": "Deactivate user",
  "body": "Deactivate {name}? This signs them out everywhere and blocks new logins until reactivated.",
  "button": "Deactivate"
}
```

fr.json mirrors (`"activated": "Utilisateur activé"`, `"deactivated": "Utilisateur désactivé"`, `"selfDeactivate": "Vous ne pouvez pas désactiver votre propre compte."`, confirmDeactivate with French copy).

- [ ] **Step 2: Add the server action**

In `apps/admin/app/(admin)/users/actions.ts` (add `updateUser` is already imported), add:

```typescript
export async function setUserStatusAction(
  userId: string,
  status: 'active' | 'inactive',
): Promise<{ ok: true } | { errorKey: string }> {
  try {
    await updateUser(userId, { status } as Partial<User>)
    revalidatePath('/users')
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : ''
    if (message.includes('403') && message.toLowerCase().includes('own')) {
      return { errorKey: 'users.errors.selfDeactivate' }
    }
    if (message.includes('403')) return { errorKey: 'users.errors.forbidden' }
    return { errorKey: 'users.errors.generic' }
  }
}
```

Note: the auth-server 403 message for self-deactivation is `"You cannot deactivate your own account"`, so the `.includes('own')` branch matches.

- [ ] **Step 3: Accept `currentUserId` and wire the items in `users-table.tsx`**

Add `import { toast } from 'sonner'` and `import { setUserStatusAction } from '@/app/(admin)/users/actions'` (extend the existing actions import). Change the component signature to accept the prop, e.g.:

```tsx
export function UsersTable({ users, orgs, currentUserId }: { users: User[]; orgs: Org[]; currentUserId?: string }) {
```

(Adjust to match the existing prop object; add `currentUserId?: string`.)

Add state near the other hooks:

```tsx
const [statusTarget, setStatusTarget] = React.useState<User | null>(null)
const [statusError, setStatusError] = React.useState<string | null>(null)
```

Replace the stub activate/deactivate block:

```tsx
{u.status === 'active' ? (
  <DropdownMenuItem className="text-destructive">{t('users.actions.deactivate')}</DropdownMenuItem>
) : u.status === 'inactive' ? (
  <DropdownMenuItem>{t('users.actions.activate')}</DropdownMenuItem>
) : null}
```

with:

```tsx
{u.status === 'active' && u.id !== currentUserId ? (
  <DropdownMenuItem
    className="text-destructive"
    onClick={(e) => { e.stopPropagation(); setStatusError(null); setStatusTarget(u) }}
  >
    {t('users.actions.deactivate')}
  </DropdownMenuItem>
) : u.status === 'inactive' ? (
  <DropdownMenuItem
    onClick={async (e) => {
      e.stopPropagation()
      const res = await setUserStatusAction(u.id, 'active')
      if ('errorKey' in res) { toast.error(t(res.errorKey)); return }
      toast.success(t('users.toast.activated'))
    }}
  >
    {t('users.actions.activate')}
  </DropdownMenuItem>
) : null}
```

Render the deactivate confirm dialog (reusing `DeleteAlertDialog`) near the existing delete dialog:

```tsx
{statusTarget && (
  <DeleteAlertDialog
    open={statusTarget !== null}
    onOpenChange={(o) => { if (!o) setStatusTarget(null) }}
    title={t('users.confirmDeactivate.title')}
    description={t('users.confirmDeactivate.body', { name: `${statusTarget.firstName} ${statusTarget.lastName}` })}
    confirmLabel={t('users.confirmDeactivate.button')}
    cancelLabel={t('users.drawer.cancel')}
    error={statusError}
    onConfirm={async () => {
      const res = await setUserStatusAction(statusTarget.id, 'inactive')
      if ('errorKey' in res) { setStatusError(t(res.errorKey)); return }
      toast.success(t('users.toast.deactivated'))
      setStatusTarget(null)
    }}
  />
)}
```

- [ ] **Step 4: Pass `currentUserId` from the page**

In `apps/admin/app/(admin)/users/page.tsx`, the page already computes `profile` from `getMyProfile()`. Find where `<UsersTable ... />` is rendered and add the prop:

```tsx
<UsersTable users={users} orgs={orgs} currentUserId={profile?.userId} />
```

(Match the existing `<UsersTable .../>` props; only add `currentUserId={profile?.userId}`.)

- [ ] **Step 5: Build**

Run: `pnpm --filter @sassy-auth/admin build`
Expected: build succeeds (0 type errors).

- [ ] **Step 6: Commit**

```bash
git add apps/admin/app/\(admin\)/users/actions.ts apps/admin/components/users-table.tsx apps/admin/app/\(admin\)/users/page.tsx apps/admin/messages/
git commit -m "feat(admin): wire activate/deactivate with confirm + self-hide"
```

---

### Task 3: End-to-end test (admin-e2e)

**Files:**
- Create: `apps/admin-e2e/tests/authed/activate-deactivate.spec.ts`

**Interfaces:** consumes `UsersPage` + seeded super admin `s@sa.io`. Creates a throwaway user to toggle.

- [ ] **Step 1: Write the e2e**

Create `apps/admin-e2e/tests/authed/activate-deactivate.spec.ts`:

```typescript
import { test, expect } from '../../lib/fixtures'
import { t } from '../../lib/i18n'
import { UsersPage } from '../../pages/users.page'
import crypto from 'node:crypto'

test.describe('Activate / deactivate', () => {
  test('deactivate (with confirm) then reactivate reflects in the status cell', async ({ page }) => {
    const users = new UsersPage(page)
    await users.goto()
    const email = `e2e-status-${crypto.randomUUID().slice(0, 8)}@example.com`
    await users.createUser({ firstName: 'Status', lastName: 'E2E', email, orgName: 'Platform' })
    // A freshly-created user is pending; make it active by accepting is out of
    // scope — instead target an already-active seeded user is unsafe to mutate,
    // so assert the pending row exposes neither activate nor deactivate, then
    // clean up. (Status transitions from pending are guarded server-side.)
    await users.search(email)
    await users.rowByEmail(email).locator('[aria-haspopup="menu"]').click()
    await expect(page.getByRole('menuitem', { name: t('users.actions.deactivate') })).toHaveCount(0)
    await expect(page.getByRole('menuitem', { name: t('users.actions.activate') })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await users.deleteUser(email)
  })

  test("the current admin's own row hides deactivate", async ({ page }) => {
    const users = new UsersPage(page)
    await users.goto()
    await users.search('s@sa.io') // the logged-in super admin
    await users.rowByEmail('s@sa.io').locator('[aria-haspopup="menu"]').click()
    await expect(page.getByRole('menuitem', { name: t('users.actions.deactivate') })).toHaveCount(0)
  })
})
```

Note: this suite deliberately avoids deactivating a shared seeded user (which would break other authed specs). It verifies the self-hide and the pending-row gating. A full active→inactive→active toggle belongs in an isolated-DB integration test, not the shared e2e run.

- [ ] **Step 2: Run it**

Run: `pnpm --filter @sassy-auth/admin-e2e test:e2e -- activate-deactivate.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 3: Commit**

```bash
git add apps/admin-e2e/tests/authed/activate-deactivate.spec.ts
git commit -m "test(e2e): activate/deactivate gating + self-hide"
```

---

## Self-review notes

- **Spec coverage:** Design Section 4 covered — session deletion on deactivate + backend self-guard (Task 1), UI wiring with deactivate-confirm / direct-activate / self-hide (Task 2), e2e for gating + self-hide (Task 3). Design said "silent" (no user email) — honored: no email code here.
- **Correction vs. spec:** the spec assumed a self-modification guard already existed on `updateUser`; it does not (only delete/role-edit paths have one). Task 1 **adds** the deactivation self-guard, which the spec's intent requires.
- **e2e scope note:** a full active→inactive→active toggle on a shared seeded user would log that admin out and destabilize the shared authed run; Task 3 verifies gating/self-hide instead and defers the full toggle to an isolated integration test. This is a deliberate deviation to keep the hermetic e2e suite green.
- **No placeholders / type consistency:** `setUserStatusAction(userId, status)` and `UsersTable`'s `currentUserId?: string` are stable; `updateUser` signature unchanged.
