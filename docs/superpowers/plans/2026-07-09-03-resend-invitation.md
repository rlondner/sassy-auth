# Resend Invitation + Invite Email — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Depends on:** Plan 01 (`invitationEmail` template) and Plan 02 (`getEmailer` singleton, `ShareLinkDialog` component).

**Goal:** Send the invitation email (on both create and resend) and wire the currently-stubbed "Resend invitation" admin action, surfacing the invite link in a copy dialog.

**Architecture:** `createUser` and `resendInvitation` already build `inviteUrl`; add a `getEmailer().send(invitationEmail(...))` call to each. The admin action returns `{ inviteUrl }`, which the row menu shows in the reusable `ShareLinkDialog`.

**Tech Stack:** NestJS, Jest, Next.js server actions, Playwright.

## Global Constraints

- `getEmailer()` (Plan 02, `src/email/email.singleton.ts`) returns the non-DI `EmailService` singleton; `.send(...)` never throws.
- Invite URL: `${process.env.ADMIN_URL ?? 'http://localhost:3001'}/accept-invite?token=${token}`.
- i18n keys go in **both** `messages/en.json` and `messages/fr.json`.
- Tests: `pnpm --filter @sassy-auth/auth-server test`; e2e per repo convention.

---

### Task 1: Send the invitation email (auth-server)

**Files:**
- Modify: `apps/auth-server/src/users/users.service.ts` (`createUser`, `resendInvitation`)
- Test: `apps/auth-server/src/users/users.service.spec.ts`

**Interfaces:**
- Consumes: `getEmailer` (Plan 01/02), `invitationEmail` (Plan 01).
- Produces: no signature change — `createUser` still returns `{ user, inviteUrl }`, `resendInvitation` still returns `{ inviteUrl }`; both now also send an email as a side effect.

- [ ] **Step 1: Add the email mock + failing assertions**

In `apps/auth-server/src/users/users.service.spec.ts`, add this mock next to the other `jest.mock(...)` calls:

```typescript
const mockSend = jest.fn().mockResolvedValue({ sent: true });
jest.mock('../email/email.singleton', () => ({
  getEmailer: () => ({ send: mockSend }),
}));
```

In the existing `describe('createUser')`, add:

```typescript
it('sends an invitation email to the new user', async () => {
  await service.createUser('ba-caller', dto);
  expect(mockSend).toHaveBeenCalledWith(
    expect.objectContaining({ to: 'jane@example.com', subject: expect.stringMatching(/invit/i) }),
  );
});
```

In the existing `describe('resendInvitation')`, add (the seeded user needs an email; ensure `makeSaUser` include has `betterAuthUser: { email: 'alice@example.com' }`):

```typescript
it('sends the invitation email on resend', async () => {
  mockPrisma.saUser.findUnique.mockResolvedValue(makeSaUser({ status: 'pending', betterAuthUser: { email: 'alice@example.com' } }));
  mockPrisma.saInvitation.updateMany.mockResolvedValue(undefined);
  mockPrisma.saInvitation.create.mockResolvedValue({ token: 'newtoken123', expiresAt: new Date() });
  await service.resendInvitation('ba-caller', 'usr1');
  expect(mockSend).toHaveBeenCalledWith(
    expect.objectContaining({ to: 'alice@example.com', subject: expect.stringMatching(/invit/i) }),
  );
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @sassy-auth/auth-server exec jest src/users/users.service.spec.ts -t "invitation email"`
Expected: FAIL — `mockSend` not called.

- [ ] **Step 3: Import the emailer + templates in the service**

In `apps/auth-server/src/users/users.service.ts` add near the top imports:

```typescript
import { getEmailer } from '../email/email.singleton';
import { invitationEmail } from '../email/templates/invitation.template';
```

- [ ] **Step 4: Send in `createUser`**

In `createUser`, right before the final `return { user: formatUser(saUser), inviteUrl: ... }`, insert (the `inviteUrl` const may need extracting first — build it into a variable):

```typescript
const inviteUrl = `${baseUrl}/accept-invite?token=${invitation.token}`;
await getEmailer().send({
  to: dto.email,
  ...invitationEmail({ firstName: dto.firstName, inviteUrl }),
});
```

and change the return to `return { user: formatUser(saUser), inviteUrl };`.

- [ ] **Step 5: Send in `resendInvitation`**

First ensure the user lookup includes the email. Change the `resendInvitation` lookup:

```typescript
const user = await prisma.saUser.findUnique({ where: { publicId: userPublicId } });
```

to:

```typescript
const user = await prisma.saUser.findUnique({
  where: { publicId: userPublicId },
  include: { betterAuthUser: { select: { email: true } } },
});
```

Then, before the final `return { inviteUrl: ... }`, extract the URL and send:

```typescript
const inviteUrl = `${baseUrl}/accept-invite?token=${invitation.token}`;
await getEmailer().send({
  to: user.betterAuthUser.email,
  ...invitationEmail({ firstName: user.firstName, inviteUrl }),
});
```

and change the return to `return { inviteUrl };`.

- [ ] **Step 6: Run tests + build**

Run: `pnpm --filter @sassy-auth/auth-server exec jest src/users/users.service.spec.ts`
Expected: PASS (all, including the two new email assertions).
Run: `pnpm --filter @sassy-auth/auth-server build`
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add apps/auth-server/src/users/users.service.ts apps/auth-server/src/users/users.service.spec.ts
git commit -m "feat(users): email the invite link on create + resend"
```

---

### Task 2: Wire the resend action + un-quarantine e2e (admin)

**Files:**
- Modify: `apps/admin/app/(admin)/users/actions.ts`
- Modify: `apps/admin/components/users-table.tsx`
- Modify: `apps/admin-e2e/pages/users.page.ts`
- Modify: `apps/admin-e2e/tests/matrix/users.matrix.spec.ts`
- Modify: `apps/admin/messages/en.json`, `messages/fr.json`

**Interfaces:**
- Consumes: `resendInvitation` (lib/api, exists), `ShareLinkDialog` (Plan 02).
- Produces: `resendInvitationAction(userId: string): Promise<{ inviteUrl: string } | { errorKey: string }>`.

- [ ] **Step 1: Add i18n keys**

Add under `users.drawer` in both locale files: `"resendLinkTitle": "Invitation link"`, `"resendLinkBody": "Share this link with the user, or they'll receive it by email."` (fr: `"Lien d'invitation"`, `"Partagez ce lien avec l'utilisateur ; il le recevra aussi par e-mail."`). `users.toast.resent` already exists.

- [ ] **Step 2: Add the server action**

In `apps/admin/app/(admin)/users/actions.ts`, add `resendInvitation` to the `@/lib/api` import list, then add:

```typescript
export async function resendInvitationAction(
  userId: string,
): Promise<{ inviteUrl: string } | { errorKey: string }> {
  try {
    return await resendInvitation(userId)
  } catch (err) {
    const message = err instanceof Error ? err.message : ''
    if (message.includes('400')) return { errorKey: 'users.errors.notPending' }
    if (message.includes('403')) return { errorKey: 'users.errors.forbidden' }
    return { errorKey: 'users.errors.generic' }
  }
}
```

Add `"notPending": "This user is no longer pending an invitation."` under `users.errors` in both locale files (fr: `"Cet utilisateur n'est plus en attente d'invitation."`).

- [ ] **Step 3: Wire the menu item in `users-table.tsx`**

Ensure `import { toast } from 'sonner'`, `import { ShareLinkDialog } from './share-link-dialog'` are present (added in Plan 02). Import the action: add `resendInvitationAction` to the `@/app/(admin)/users/actions` import. Add state:

```tsx
const [inviteLink, setInviteLink] = React.useState<string | null>(null)
```

Replace the stub resend item:

```tsx
{u.status === 'pending' && (
  <DropdownMenuItem>{t('users.actions.resendInvitation')}</DropdownMenuItem>
)}
```

with:

```tsx
{u.status === 'pending' && (
  <DropdownMenuItem
    onClick={async (e) => {
      e.stopPropagation()
      const res = await resendInvitationAction(u.id)
      if ('errorKey' in res) { toast.error(t(res.errorKey)); return }
      toast.success(t('users.toast.resent'))
      setInviteLink(res.inviteUrl)
    }}
  >
    {t('users.actions.resendInvitation')}
  </DropdownMenuItem>
)}
```

Render a second `ShareLinkDialog` near the reset one:

```tsx
<ShareLinkDialog
  open={inviteLink !== null}
  onOpenChange={(o) => { if (!o) setInviteLink(null) }}
  title={t('users.drawer.resendLinkTitle')}
  description={t('users.drawer.resendLinkBody')}
  url={inviteLink ?? ''}
/>
```

- [ ] **Step 4: Update the e2e page object to dismiss the dialog**

In `apps/admin-e2e/pages/users.page.ts`, replace the `resendInvitation` method body so it confirms the toast and closes the link dialog:

```typescript
async resendInvitation(email: string) {
  await this.search(email)
  await this.rowByEmail(email).locator('[aria-haspopup="menu"]').click()
  await this.page.getByRole('menuitem', { name: t('users.actions.resendInvitation') }).click()
  // A copy-link dialog appears with the regenerated invite URL; dismiss it.
  await this.page.getByRole('button', { name: t('users.drawer.done') }).click()
}
```

- [ ] **Step 5: Un-quarantine the resend matrix test**

In `apps/admin-e2e/tests/matrix/users.matrix.spec.ts`, remove the quarantine line from the `'Resend invitation succeeds for a pending user'` test:

```typescript
    test.fixme(true, 'resend-invitation row action is an unimplemented stub')
```

(delete that line and its preceding explanatory comment).

- [ ] **Step 6: Build + run the resend e2e**

Run: `pnpm --filter @sassy-auth/admin build`
Expected: build succeeds.
Run: `pnpm --filter @sassy-auth/admin-e2e test:e2e -- users.matrix.spec.ts -g "Resend invitation"`
Expected: PASS (no longer skipped).

- [ ] **Step 7: Commit**

```bash
git add apps/admin/app/\(admin\)/users/actions.ts apps/admin/components/users-table.tsx apps/admin-e2e/pages/users.page.ts apps/admin-e2e/tests/matrix/users.matrix.spec.ts apps/admin/messages/
git commit -m "feat(admin): wire resend-invitation with copy-link dialog; un-quarantine e2e"
```

---

## Self-review notes

- **Spec coverage:** Design Section 3 covered — invite email on create + resend (Task 1), UI wiring + surfaced link (Task 2), e2e un-quarantined (Task 2).
- **No placeholders:** every step has runnable code/commands.
- **Type consistency:** `resendInvitation` returns `{ inviteUrl }` unchanged in service + api; `resendInvitationAction` returns `{ inviteUrl } | { errorKey }`. `ShareLinkDialog` reused with the same prop shape from Plan 02.
