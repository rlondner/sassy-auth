# Signup Email OTP Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 6-digit-code email verification option for self-serve signup, selectable per `SaApp` alongside the existing link-based flow, reusing that app's `activationEmailOverride` branding.

**Architecture:** A new `SaApp.emailVerificationMethod: 'link' | 'code'` column (default `'link'`) drives a branch inside `auth.config.ts`'s existing `emailVerification.sendVerificationEmail`. The `'code'` branch generates+stores an OTP via BetterAuth's `emailOTP` plugin (`auth.api.createVerificationOTP`, wrapped in a small testable `sendVerificationCode` helper) and emails it with a new template that reuses the same `ActivationEmailBranding` fields as the link template. Verification itself happens via BetterAuth's always-registered `POST /api/auth/email-otp/verify-email` endpoint — no new backend verification endpoint needed. The admin console's `/signup/check-email` page renders a new `VerifyCodeCard` for `'code'` apps (code entry + inline errors) or the existing `CheckEmailCard` otherwise, decided by extending the app-info lookup both pages already use. An admin-facing toggle in `app-edit-drawer.tsx`'s "Activation email" section lets an operator pick the method per app.

**Tech Stack:** NestJS (auth-server), Prisma/Postgres, BetterAuth (`emailOTP` plugin), Next.js/React (admin), Jest + Testing Library.

**Design doc:** `docs/superpowers/specs/2026-10-01-signup-email-otp-verification-design.md`

---

### Task 1: Prisma schema — `emailVerificationMethod` column

**Files:**
- Modify: `packages/db/schema.prisma:114` (the `SaApp` model)
- Create: `packages/db/migrations/<timestamp>_add_email_verification_method/migration.sql`

- [ ] **Step 1: Add the enum and field to the schema**

In `packages/db/schema.prisma`, add a new top-level enum near the existing `UserStatus` enum (search for `enum UserStatus` to find it and add this enum directly after it):

```prisma
enum EmailVerificationMethod {
  link
  code
}
```

Then add the new field to `model SaApp` (insert directly after `activationEmailOverride Json?` at line 152):

```prisma
  /// Which mechanism self-serve signup uses to verify a new user's email.
  /// 'link' (default) preserves today's behavior; 'code' sends a 6-digit
  /// code instead, reusing the same activationEmailOverride branding.
  emailVerificationMethod EmailVerificationMethod @default(link)
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm --filter @sassy-auth/db db:migrate -- --name add_email_verification_method`

This creates `packages/db/migrations/<timestamp>_add_email_verification_method/migration.sql`. Verify it was generated with content equivalent to:

```sql
-- CreateEnum
CREATE TYPE "EmailVerificationMethod" AS ENUM ('link', 'code');

-- AlterTable
ALTER TABLE "SaApp" ADD COLUMN     "emailVerificationMethod" "EmailVerificationMethod" NOT NULL DEFAULT 'link';
```

If the generated SQL differs in formatting, that's fine — Prisma's formatting is deterministic for this shape; only the column/enum names and `DEFAULT 'link'` matter.

- [ ] **Step 3: Regenerate the Prisma client**

Run: `pnpm --filter @sassy-auth/db db:generate`
Expected: completes without error; `EmailVerificationMethod` is now exported from `@sassy-auth/db` (via `export * from './generated/prisma/client'` in `packages/db/index.ts`).

- [ ] **Step 4: Commit**

```bash
git add packages/db/schema.prisma packages/db/migrations
git commit -m "feat(db): add SaApp.emailVerificationMethod (link|code)"
```

---

### Task 2: New email template for the 6-digit code

**Files:**
- Create: `apps/auth-server/src/email/templates/verify-email-code.template.ts`
- Modify: `apps/auth-server/src/email/templates/templates.spec.ts`

- [ ] **Step 1: Write the failing tests**

Add to the bottom of `apps/auth-server/src/email/templates/templates.spec.ts` (add the import at the top alongside the existing ones, and the new `describe` block at the end, before the final closing `});` of the file — i.e. as a sibling top-level `describe`, not nested inside the existing one):

```ts
import { verificationCodeEmail } from './verify-email-code.template';
```

```ts
describe('verificationCodeEmail', () => {
  it('uses the default subject/message and embeds the code and appName when no branding is given', () => {
    const out = verificationCodeEmail({ firstName: 'Jane', otp: '123456', appName: 'Vibecast' });
    expect(out.subject).toBe('Verify your Vibecast email address');
    expect(out.html).toContain('123456');
    expect(out.html).toContain('Enter this code to verify your email address:');
    expect(out.text).toContain('123456');
    expect(out.text).toContain('Jane');
    expect(out.from).toBeUndefined();
  });

  it('renders a custom subject/message with placeholders', () => {
    const out = verificationCodeEmail({
      firstName: 'Jane',
      otp: '123456',
      appName: 'Vibecast',
      branding: { subject: 'Confirm your {{appName}} account, {{firstName}}!', message: 'Welcome to {{appName}}, {{firstName}}! Your code:' },
    });
    expect(out.subject).toBe('Confirm your Vibecast account, Jane!');
    expect(out.html).toContain('Welcome to Vibecast, Jane! Your code:');
    expect(out.text).toContain('Welcome to Vibecast, Jane! Your code:');
    expect(out.html).toContain('123456');
  });

  it('computes from from fromName + fromAddress', () => {
    const out = verificationCodeEmail({
      firstName: 'Jane', otp: '123456', appName: 'Vibecast',
      branding: { fromName: 'Vibecast', fromAddress: 'no-reply@vibecast.io' },
    });
    expect(out.from).toBe('Vibecast <no-reply@vibecast.io>');
  });

  it('escapes HTML in a custom message', () => {
    const out = verificationCodeEmail({
      firstName: 'Jane',
      otp: '123456',
      appName: 'Vibecast',
      branding: { message: '<a href="https://evil.example/phish">Click here</a> & "confirm" now' },
    });
    expect(out.html).not.toContain('<a href="https://evil.example/phish">');
    expect(out.html).toContain('&lt;a href=&quot;https://evil.example/phish&quot;&gt;Click here&lt;/a&gt; &amp; &quot;confirm&quot; now');
    expect(out.html).toContain('123456');
    expect(out.text).toContain('<a href="https://evil.example/phish">Click here</a> & "confirm" now');
  });

  it('converts message line breaks to <br> in html but keeps them literal in text', () => {
    const out = verificationCodeEmail({
      firstName: 'Jane',
      otp: '123456',
      appName: 'Vibecast',
      branding: { message: 'Line one.\nLine two.\r\nLine three.' },
    });
    expect(out.html).toContain('Line one.<br>Line two.<br>Line three.');
    expect(out.text).toContain('Line one.\nLine two.\r\nLine three.');
  });

  it('falls back to the default subject/message when branding fields are whitespace-only', () => {
    const out = verificationCodeEmail({
      firstName: 'Jane', otp: '123456', appName: 'Vibecast',
      branding: { subject: '   ', message: '   ' },
    });
    expect(out.subject).toBe('Verify your Vibecast email address');
    expect(out.html).toContain('Enter this code to verify your email address:');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @sassy-auth/auth-server test -- templates.spec`
Expected: FAIL — `Cannot find module './verify-email-code.template'`

- [ ] **Step 3: Write the template**

Create `apps/auth-server/src/email/templates/verify-email-code.template.ts`:

```ts
import { renderTemplate, type ActivationEmailBranding } from '@sassy-auth/types';
import type { EmailMessageParts } from '../email.types';

const DEFAULT_SUBJECT = 'Verify your {{appName}} email address';
const DEFAULT_MESSAGE = 'Enter this code to verify your email address:';

/**
 * Fixed, non-admin-customizable code display — same rationale as
 * verify-email.template.ts's renderButton: the mechanism of verification
 * must never be something an admin's custom `message` text can spoof or
 * omit.
 */
function renderCode(otp: string): string {
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 24px 0;">` +
    `<tr><td align="center" style="background: #f3f4f6; border-radius: 8px; padding: 16px 32px;">` +
    `<span style="font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #111827;">${otp}</span>` +
    `</td></tr></table>`
  );
}

/** Same escaping rationale as verify-email.template.ts's escapeHtml. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeHtmlMultiline(value: string): string {
  return escapeHtml(value).replace(/\r\n|\r|\n/g, '<br>');
}

function computeFrom(branding?: ActivationEmailBranding): string | undefined {
  const name = branding?.fromName?.trim();
  const address = branding?.fromAddress?.trim();
  if (name && address) return `${name} <${address}>`;
  return address || name || undefined;
}

export function verificationCodeEmail(args: {
  firstName: string;
  otp: string;
  appName: string;
  branding?: ActivationEmailBranding;
}): EmailMessageParts & { from?: string } {
  const { firstName, otp, appName, branding } = args;
  const vars = { firstName, appName };
  const subject = renderTemplate(branding?.subject?.trim() || DEFAULT_SUBJECT, vars);
  const message = renderTemplate(branding?.message?.trim() || DEFAULT_MESSAGE, vars);
  const from = computeFrom(branding);

  return {
    subject,
    text: `Hi ${firstName},\n\n${message}\n${otp}\n\nIf you didn't create this account, you can ignore this email.`,
    html:
      `<p>Hi ${firstName},</p><p>${escapeHtmlMultiline(message)}</p>${renderCode(otp)}` +
      `<p>If you didn't create this account, you can ignore this email.</p>`,
    ...(from !== undefined && { from }),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @sassy-auth/auth-server test -- templates.spec`
Expected: PASS, all tests including the new `verificationCodeEmail` describe block.

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/email/templates/verify-email-code.template.ts apps/auth-server/src/email/templates/templates.spec.ts
git commit -m "feat(auth-server): add verificationCodeEmail template for signup OTP"
```

---

### Task 3: Testable sender wrapper around `auth.api.createVerificationOTP`

**Files:**
- Create: `apps/auth-server/src/auth/verification-code-sender.ts`
- Create: `apps/auth-server/src/auth/verification-code-sender.spec.ts`

This isolates the OTP-generation call behind a small injectable interface (mirroring `otp-sender.ts`'s `SendOtpDeps` pattern) so it can be unit tested without needing a fully-initialized BetterAuth instance — `auth.config.spec.ts` only mocks `@sassy-auth/db` and `better-auth/adapters/prisma` at a shallow level, so a real call to BetterAuth's internal adapter from inside `auth.config.ts`'s own test suite would not work.

- [ ] **Step 1: Write the failing test**

Create `apps/auth-server/src/auth/verification-code-sender.spec.ts`:

```ts
import { sendVerificationCode } from './verification-code-sender';

describe('sendVerificationCode', () => {
  it('creates an OTP for the email-verification type and emails it with the given branding', async () => {
    const createOtp = jest.fn().mockResolvedValue('654321');
    const send = jest.fn().mockResolvedValue({ sent: true });
    await sendVerificationCode(
      { createOtp, emailer: { send } },
      { email: 'jane@example.com', firstName: 'Jane', appName: 'Vibecast', branding: { fromName: 'Vibecast' } },
    );
    expect(createOtp).toHaveBeenCalledWith({ email: 'jane@example.com', type: 'email-verification' });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'jane@example.com',
        subject: 'Verify your Vibecast email address',
        from: 'Vibecast',
        html: expect.stringContaining('654321'),
      }),
    );
  });

  it('sends with no branding when none is given', async () => {
    const createOtp = jest.fn().mockResolvedValue('111111');
    const send = jest.fn().mockResolvedValue({ sent: true });
    await sendVerificationCode(
      { createOtp, emailer: { send } },
      { email: 'jane@example.com', firstName: 'Jane', appName: 'Sassy Auth' },
    );
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ subject: 'Verify your Sassy Auth email address', from: undefined }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sassy-auth/auth-server test -- verification-code-sender.spec`
Expected: FAIL — `Cannot find module './verification-code-sender'`

- [ ] **Step 3: Write the implementation**

Create `apps/auth-server/src/auth/verification-code-sender.ts`:

```ts
import type { ActivationEmailBranding } from '@sassy-auth/types';
import { verificationCodeEmail } from '../email/templates/verify-email-code.template';

export interface SendVerificationCodeDeps {
  /** Normally `(data) => auth.api.createVerificationOTP({ body: data })`. */
  createOtp(data: { email: string; type: 'email-verification' }): Promise<string>;
  emailer: {
    send(msg: { to: string; subject: string; html: string; text: string; from?: string }): Promise<{ sent: boolean }>;
  };
}

/**
 * Generates and stores a 6-digit email-verification OTP via BetterAuth's
 * emailOTP plugin, then emails it using the same ActivationEmailBranding
 * shape the link-based verification email uses. Kept separate from
 * auth.config.ts so it can be unit tested without a fully-initialized
 * BetterAuth instance (see auth.config.spec.ts's shallow mocking of
 * @sassy-auth/db and the Prisma adapter).
 */
export async function sendVerificationCode(
  deps: SendVerificationCodeDeps,
  data: { email: string; firstName: string; appName: string; branding?: ActivationEmailBranding },
): Promise<void> {
  const { createOtp, emailer } = deps;
  const { email, firstName, appName, branding } = data;
  const otp = await createOtp({ email, type: 'email-verification' });
  await emailer.send({ to: email, ...verificationCodeEmail({ firstName, otp, appName, branding }) });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sassy-auth/auth-server test -- verification-code-sender.spec`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/auth/verification-code-sender.ts apps/auth-server/src/auth/verification-code-sender.spec.ts
git commit -m "feat(auth-server): add testable sendVerificationCode wrapper"
```

---

### Task 4: Branch `auth.config.ts`'s `sendVerificationEmail` per app method

**Files:**
- Modify: `apps/auth-server/src/auth/auth.config.ts:487-500`
- Modify: `apps/auth-server/src/auth/auth.config.spec.ts:260-301`

- [ ] **Step 1: Extend the two existing tests' `select` assertion and add two new failing tests**

In `apps/auth-server/src/auth/auth.config.spec.ts`, update the `select` object inside both existing `toHaveBeenCalledWith` assertions (lines ~274-277 and the second test has no such assertion, so only the first needs it) to include the new field:

Find (in the first test, "sendVerificationEmail resolves the owning SaApp..."):
```ts
    expect(prisma.saUser.findUnique).toHaveBeenCalledWith({
      where: { betterAuthUserId: 'ba-user-1' },
      select: { org: { select: { app: { select: { name: true, activationEmailOverride: true } } } } },
    });
```
Replace with:
```ts
    expect(prisma.saUser.findUnique).toHaveBeenCalledWith({
      where: { betterAuthUserId: 'ba-user-1' },
      select: { org: { select: { app: { select: { name: true, activationEmailOverride: true, emailVerificationMethod: true } } } } },
    });
```

Also update that same test's mocked resolved value (a few lines above) to include the new field so the mock shape matches what the real query would return:

Find:
```ts
    prisma.saUser.findUnique.mockResolvedValue({
      org: { app: { name: 'Vibecast', activationEmailOverride: { fromName: 'Vibecast', fromAddress: 'no-reply@vibecast.io' } } },
    });
```
Replace with:
```ts
    prisma.saUser.findUnique.mockResolvedValue({
      org: { app: { name: 'Vibecast', activationEmailOverride: { fromName: 'Vibecast', fromAddress: 'no-reply@vibecast.io' }, emailVerificationMethod: 'link' } },
    });
```

Now add two new tests immediately after the existing `'sendVerificationEmail falls back to "Sassy Auth"...'` test (i.e. right after its closing `});`, still inside the `describe('auth.config — emailVerification', ...)` block):

```ts
  it('sendVerificationEmail sends a 6-digit code instead of a link when the app is configured for emailVerificationMethod "code"', async () => {
    const sendMock = jest.fn().mockResolvedValue({ sent: true });
    jest.doMock('../email/email.singleton', () => ({ getEmailer: () => ({ send: sendMock }) }));
    jest.resetModules();
    const { auth } = await import('./auth.config');
    const { prisma } = require('@sassy-auth/db');
    prisma.saUser.findUnique.mockResolvedValue({
      org: { app: { name: 'Vibecast', activationEmailOverride: { fromName: 'Vibecast' }, emailVerificationMethod: 'code' } },
    });
    (auth.api as unknown as { createVerificationOTP: jest.Mock }).createVerificationOTP = jest.fn().mockResolvedValue('123456');
    const options = (auth as unknown as { options: Record<string, unknown> }).options;
    const ev = options['emailVerification'] as {
      sendVerificationEmail: (args: { user: { id: string; email: string; name?: string }; url: string }) => Promise<void>;
    };
    await ev.sendVerificationEmail({ user: { id: 'ba-user-1', email: 'jane@example.com', name: 'Jane Doe' }, url: 'https://x/verify-email?token=abc' });
    expect((auth.api as unknown as { createVerificationOTP: jest.Mock }).createVerificationOTP).toHaveBeenCalledWith({
      body: { email: 'jane@example.com', type: 'email-verification' },
    });
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'jane@example.com',
        subject: 'Verify your Vibecast email address',
        from: 'Vibecast',
        html: expect.stringContaining('123456'),
      }),
    );
    // The link-based email must never also be sent.
    expect(sendMock).not.toHaveBeenCalledWith(expect.objectContaining({ html: expect.stringContaining('https://x/verify-email?token=abc') }));
  });

  it('sendVerificationEmail sends the link when emailVerificationMethod is "link" (default)', async () => {
    const sendMock = jest.fn().mockResolvedValue({ sent: true });
    jest.doMock('../email/email.singleton', () => ({ getEmailer: () => ({ send: sendMock }) }));
    jest.resetModules();
    const { auth } = await import('./auth.config');
    const { prisma } = require('@sassy-auth/db');
    prisma.saUser.findUnique.mockResolvedValue({
      org: { app: { name: 'Vibecast', activationEmailOverride: null, emailVerificationMethod: 'link' } },
    });
    const options = (auth as unknown as { options: Record<string, unknown> }).options;
    const ev = options['emailVerification'] as {
      sendVerificationEmail: (args: { user: { id: string; email: string; name?: string }; url: string }) => Promise<void>;
    };
    await ev.sendVerificationEmail({ user: { id: 'ba-user-1', email: 'jane@example.com', name: 'Jane Doe' }, url: 'https://x/verify-email?token=abc' });
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({ html: expect.stringContaining('https://x/verify-email?token=abc') }));
  });
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `pnpm --filter @sassy-auth/auth-server test -- auth.config.spec`
Expected: FAIL on the two new tests — `auth.api.createVerificationOTP` is not a function / the code branch doesn't exist yet (the "code" test fails because the real `sendVerificationEmail` still sends the link-based email, so `sendMock` isn't called with the OTP code at all).

- [ ] **Step 3: Implement the branch**

In `apps/auth-server/src/auth/auth.config.ts`, add the import (alongside the existing template imports near the top, e.g. directly after the `verificationEmail` import on line 7):

```ts
import { sendVerificationCode } from './verification-code-sender';
```

Then replace the `sendVerificationEmail` function body (lines 487-500):

Find:
```ts
    sendVerificationEmail: async ({ user, url }: { user: { id: string; email: string; name?: string }; url: string }) => {
      const firstName = (user.name ?? '').trim().split(' ')[0] || 'there';
      const saUser = await prisma.saUser.findUnique({
        where: { betterAuthUserId: user.id },
        select: { org: { select: { app: { select: { name: true, activationEmailOverride: true } } } } },
      });
      const appName = saUser?.org.app.name ?? 'Sassy Auth';
      // AppsService.assertValidActivationEmailOverride is the only write path
      // and shape-checks every field, but this cast still isn't a runtime
      // guarantee — verificationEmail()'s optional chaining degrades to
      // defaults on any malformed/missing field regardless.
      const branding = (saUser?.org.app.activationEmailOverride ?? undefined) as ActivationEmailBranding | undefined;
      await getEmailer().send({ to: user.email, ...verificationEmail({ firstName, verifyUrl: url, appName, branding }) });
    },
```

Replace with:
```ts
    sendVerificationEmail: async ({ user, url }: { user: { id: string; email: string; name?: string }; url: string }) => {
      const firstName = (user.name ?? '').trim().split(' ')[0] || 'there';
      const saUser = await prisma.saUser.findUnique({
        where: { betterAuthUserId: user.id },
        select: { org: { select: { app: { select: { name: true, activationEmailOverride: true, emailVerificationMethod: true } } } } },
      });
      const appName = saUser?.org.app.name ?? 'Sassy Auth';
      // AppsService.assertValidActivationEmailOverride is the only write path
      // and shape-checks every field, but this cast still isn't a runtime
      // guarantee — verificationEmail()'s optional chaining degrades to
      // defaults on any malformed/missing field regardless.
      const branding = (saUser?.org.app.activationEmailOverride ?? undefined) as ActivationEmailBranding | undefined;

      if (saUser?.org.app.emailVerificationMethod === 'code') {
        // `auth` (this module's own export, defined by the betterAuth(...)
        // call this object literal is part of) is referenced here via
        // closure, not read at definition time — safe, since this callback
        // only runs on a real request, long after module evaluation (and
        // thus the `auth` binding) has completed.
        await sendVerificationCode(
          { createOtp: (d) => auth.api.createVerificationOTP({ body: d }), emailer: getEmailer() },
          { email: user.email, firstName, appName, branding },
        );
        return;
      }

      await getEmailer().send({ to: user.email, ...verificationEmail({ firstName, verifyUrl: url, appName, branding }) });
    },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @sassy-auth/auth-server test -- auth.config.spec`
Expected: PASS, all tests in the `emailVerification` describe block including the two new ones.

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/auth/auth.config.ts apps/auth-server/src/auth/auth.config.spec.ts
git commit -m "feat(auth-server): branch signup verification email per SaApp.emailVerificationMethod"
```

---

### Task 5: Admin API — expose and persist `emailVerificationMethod` on `SaApp`

**Files:**
- Modify: `apps/auth-server/src/apps/apps.service.ts`
- Modify: `apps/auth-server/src/apps/dto/update-app.dto.ts`
- Modify: `apps/auth-server/src/apps/apps.service.spec.ts`
- Modify: `apps/admin/lib/types.ts`

- [ ] **Step 1: Write the failing backend tests**

In `apps/auth-server/src/apps/apps.service.spec.ts`, update the three exact `toEqual` object literals that currently end `..., gdprUrl: null }` (or `, gdprUrl: null,\n    });` for the multi-line one) to also include the new field. There are three call sites — lines ~85, ~109-116, and ~190 as of this writing; search for `gdprUrl: null` to find all three precisely, since line numbers will have shifted after Task 1-4's edits land elsewhere in the repo (this file is untouched by those tasks, so they should still be accurate, but verify by search).

Find (appears 3 times — the `listApps` test around line 85, the `getApp` test around lines 109-116, and the `createApp` test around line 190):
```ts
activationWebhookUrl: null, hasActivationWebhookSecret: false, activationEmailOverride: null, privacyPolicyUrl: null, termsUrl: null, gdprUrl: null
```
(single-line variant, lines 85 and 190) and:
```ts
      activationWebhookUrl: null, hasActivationWebhookSecret: false, activationEmailOverride: null,
      privacyPolicyUrl: null, termsUrl: null, gdprUrl: null,
```
(multi-line variant, `getApp` test around line 114-115)

Replace each with the same content plus `, emailVerificationMethod: 'link'` appended right before the closing brace/comma — i.e.:
```ts
activationWebhookUrl: null, hasActivationWebhookSecret: false, activationEmailOverride: null, privacyPolicyUrl: null, termsUrl: null, gdprUrl: null, emailVerificationMethod: 'link'
```
and:
```ts
      activationWebhookUrl: null, hasActivationWebhookSecret: false, activationEmailOverride: null,
      privacyPolicyUrl: null, termsUrl: null, gdprUrl: null, emailVerificationMethod: 'link',
```

Now add two new tests. Find the existing test `'updateApp sets activationEmailOverride when provided'` (around line 307) and add these two new tests directly after the block of activationEmailOverride-related tests ends (after the test `'updateApp accepts line breaks in activationEmailOverride.message...'`, i.e. after its closing `});`):

```ts
  it('updateApp sets emailVerificationMethod to "code"', async () => {
    mockPrisma.saApp.findUnique.mockResolvedValue(appRow);
    mockPrisma.saApp.update.mockResolvedValue({ ...appRow, emailVerificationMethod: 'code' });
    const result = await service.updateApp('ba-caller', 'sq_1', { emailVerificationMethod: 'code' });
    expect(mockPrisma.saApp.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { publicId: 'sq_1' },
      data: expect.objectContaining({ emailVerificationMethod: 'code' }),
    }));
    expect(result.emailVerificationMethod).toBe('code');
  });

  it('updateApp rejects an invalid emailVerificationMethod value', async () => {
    mockPrisma.saApp.findUnique.mockResolvedValue(appRow);
    await expect(
      service.updateApp('ba-caller', 'sq_1', { emailVerificationMethod: 'carrier-pigeon' as unknown as 'link' }),
    ).rejects.toThrow(BadRequestException);
  });
```

Note: `BadRequestException` is already imported at the top of this spec file (used by other tests) and `appRow`/`mockPrisma`/`service` are the existing shared fixtures — no new imports needed. The second test relies on class-validator's `@IsEnum` rejecting the value at the controller layer; since `AppsService.updateApp` is called directly in this unit test (bypassing the Nest pipeline), add a defensive runtime check in the service itself in Step 3 below so this test passes without going through the DTO validation pipe.

- [ ] **Step 2: Run tests to verify failures**

Run: `pnpm --filter @sassy-auth/auth-server test -- apps.service.spec`
Expected: FAIL — the three updated `toEqual` assertions fail (actual result is missing `emailVerificationMethod`), and the two new tests fail (`emailVerificationMethod` not persisted; no rejection thrown for an invalid value).

- [ ] **Step 3: Implement — `AppsService`**

In `apps/auth-server/src/apps/apps.service.ts`:

Add to the `AppRow` type (directly after `activationEmailOverride?: unknown;` on line 33):
```ts
  emailVerificationMethod?: string;
```

Add to `formatApp`'s return object (directly after `gdprUrl: a.gdprUrl ?? null,` on line 60):
```ts
    emailVerificationMethod: (a.emailVerificationMethod ?? 'link') as 'link' | 'code',
```

Add a small validator function directly after `assertValidActivationEmailOverride` (after its closing brace, before `function isPrismaCode`):
```ts
/** Defense-in-depth alongside the DTO's @IsEnum — the DTO pipe only runs for
 * HTTP requests, not for AppsService called directly (see apps.service.spec.ts). */
function assertValidEmailVerificationMethod(value: string): void {
  if (value !== 'link' && value !== 'code') {
    throw new BadRequestException('emailVerificationMethod must be "link" or "code"');
  }
}
```

In `updateApp`, add `dto.emailVerificationMethod` to the "nothing provided" guard's condition list (the long `&&` chain starting at line 293) — insert `dto.emailVerificationMethod === undefined &&` right before the closing `dto.activationEmailOverride === undefined` line, and update the error message's field list to match:

Find:
```ts
      dto.activationEmailOverride === undefined
    ) {
      throw new BadRequestException(
        'At least one of name, url, logo, favicon, twoFactorTrustDays, twoFactorPromptEnabled, requireTwoFactor, allowOfflineAccess, redirectUris, defaultOrgId, defaultRoleId, passwordPolicyOverride, activationWebhookUrl, privacyPolicyUrl, termsUrl, gdprUrl, or activationEmailOverride must be provided',
      );
```
Replace with:
```ts
      dto.activationEmailOverride === undefined &&
      dto.emailVerificationMethod === undefined
    ) {
      throw new BadRequestException(
        'At least one of name, url, logo, favicon, twoFactorTrustDays, twoFactorPromptEnabled, requireTwoFactor, allowOfflineAccess, redirectUris, defaultOrgId, defaultRoleId, passwordPolicyOverride, activationWebhookUrl, privacyPolicyUrl, termsUrl, gdprUrl, activationEmailOverride, or emailVerificationMethod must be provided',
      );
```

Add the validation call alongside the other `assertValid*` calls (directly after `if (dto.activationEmailOverride) assertValidActivationEmailOverride(dto.activationEmailOverride);` around line 325):
```ts
    if (dto.emailVerificationMethod !== undefined) assertValidEmailVerificationMethod(dto.emailVerificationMethod);
```

Add the write to the `data` object inside the transaction's `tx.saApp.update` call, directly after the `activationEmailOverride` block (after its closing `}),` around line 377):
```ts
            ...(dto.emailVerificationMethod !== undefined && { emailVerificationMethod: dto.emailVerificationMethod }),
```

- [ ] **Step 4: Implement — DTO**

In `apps/auth-server/src/apps/dto/update-app.dto.ts`, add the import:
```ts
import { IsEnum } from 'class-validator';
```
(merge into the existing `class-validator` import line rather than duplicating it — it already imports several names from `'class-validator'` on line 1.)

Add the new field at the end of the class, after `activationEmailOverride`:
```ts

  /**
   * Which mechanism self-serve signup uses to verify a new user's email for
   * this app. 'link' (default) sends a clickable verification link; 'code'
   * sends a 6-digit code instead, reusing the same activationEmailOverride
   * branding. See AppsService.assertValidEmailVerificationMethod for the
   * service-layer defense-in-depth check.
   */
  @IsOptional() @IsEnum(['link', 'code']) emailVerificationMethod?: 'link' | 'code';
```

- [ ] **Step 5: Implement — admin `types.ts`**

In `apps/admin/lib/types.ts`, add to the `App` interface (directly after `gdprUrl?: string | null;` on line 118). Optional, like `activationWebhookUrl`/`hasActivationWebhookSecret`/`defaultOrgId` on the same interface — several admin test files (`app-edit-drawer.test.tsx`, `app-view-drawer.test.tsx`, `apps-table.test.tsx`) construct `App` fixtures by hand without every optional field set, and this keeps that working without touching them:
```ts
  emailVerificationMethod?: 'link' | 'code';
```

Add to the `UpdateAppPayload` interface (directly after `gdprUrl?: string | null;` on line 150):
```ts
  emailVerificationMethod?: 'link' | 'code';
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @sassy-auth/auth-server test -- apps.service.spec`
Expected: PASS, all tests.

Run: `pnpm --filter @sassy-auth/auth-server typecheck` and `pnpm --filter @sassy-auth/admin typecheck`
Expected: both PASS — since the new field is optional on `App`/`UpdateAppPayload`, no existing hand-built fixture needs updating for this step to type-check.

- [ ] **Step 7: Commit**

```bash
git add apps/auth-server/src/apps/apps.service.ts apps/auth-server/src/apps/dto/update-app.dto.ts apps/auth-server/src/apps/apps.service.spec.ts apps/admin/lib/types.ts
git commit -m "feat(apps): expose and persist SaApp.emailVerificationMethod via admin API"
```

---

### Task 6: `registration.service.ts` — surface the method to the signup flow

**Files:**
- Modify: `apps/auth-server/src/registration/registration.service.ts`
- Modify: `apps/auth-server/src/registration/registration.service.spec.ts`

- [ ] **Step 1: Update existing tests and add a new one**

`registration.service.spec.ts` has two `describe` blocks that call `getAppName` with exact `.resolves.toEqual({...})` assertions that will break once the real return value gains `emailVerificationMethod` (since the service will default it to `'link'`, not leave it `undefined`). Update all four of them, then add one new test for the `'code'` case.

In `describe('getAppName — hasDefaultOrg', ...)` (search for this exact string, around line 709), both tests' `toEqual` blocks currently end `gdprUrl: null,\n      });`. Add `emailVerificationMethod: 'link',` as a new line directly before that closing `});` in both:

Find (appears twice, once per test in this describe block):
```ts
        termsUrl: null,
        gdprUrl: null,
        gdprRequired: false,
      });
```
Replace both occurrences with:
```ts
        termsUrl: null,
        gdprUrl: null,
        gdprRequired: false,
        emailVerificationMethod: 'link',
      });
```

In `describe('getAppName', ...)` (search for this exact string, around line 788 — a *different* describe block with the same `getAppName` name but distinct tests), the first two tests ("returns the app name, logo, and favicon..." and "returns logo: null and favicon: null...") have the identical `gdprUrl: null,\n        gdprRequired: false,\n      });` ending — apply the same `emailVerificationMethod: 'link',` insertion to both.

Also update the `mockPrisma.saApp.findUnique.mockResolvedValue({...})` call inside the first test of this second `describe('getAppName', ...)` block (the one asserting the `select` shape) to include the new field, and extend that test's `select` assertion to match the new query. Find:
```ts
      mockPrisma.saApp.findUnique.mockResolvedValue({ name: 'MyApp', defaultOrgId: null, passwordPolicyOverride: null, logo: 'data:image/png;base64,AAA=', favicon: 'data:image/png;base64,FFF=' });

      await expect(service.getAppName('sq_1')).resolves.toEqual({
        name: 'MyApp',
        hasDefaultOrg: false,
        passwordPolicy: expect.any(Object),
        logo: 'data:image/png;base64,AAA=',
        favicon: 'data:image/png;base64,FFF=',
        privacyPolicyUrl: null,
        termsUrl: null,
        gdprUrl: null,
        gdprRequired: false,
      });
      expect(mockPrisma.saApp.findUnique).toHaveBeenCalledWith({
        where: { publicId: 'sq_1' },
        select: {
          name: true,
          defaultOrgId: true,
          passwordPolicyOverride: true,
          logo: true,
          favicon: true,
          privacyPolicyUrl: true,
          termsUrl: true,
          gdprUrl: true,
        },
      });
    });
```
Replace with:
```ts
      mockPrisma.saApp.findUnique.mockResolvedValue({ name: 'MyApp', defaultOrgId: null, passwordPolicyOverride: null, logo: 'data:image/png;base64,AAA=', favicon: 'data:image/png;base64,FFF=', emailVerificationMethod: 'link' });

      await expect(service.getAppName('sq_1')).resolves.toEqual({
        name: 'MyApp',
        hasDefaultOrg: false,
        passwordPolicy: expect.any(Object),
        logo: 'data:image/png;base64,AAA=',
        favicon: 'data:image/png;base64,FFF=',
        privacyPolicyUrl: null,
        termsUrl: null,
        gdprUrl: null,
        gdprRequired: false,
        emailVerificationMethod: 'link',
      });
      expect(mockPrisma.saApp.findUnique).toHaveBeenCalledWith({
        where: { publicId: 'sq_1' },
        select: {
          name: true,
          defaultOrgId: true,
          passwordPolicyOverride: true,
          logo: true,
          favicon: true,
          privacyPolicyUrl: true,
          termsUrl: true,
          gdprUrl: true,
          emailVerificationMethod: true,
        },
      });
    });
```

Now add a new test directly after that `describe('getAppName', ...)` block's last existing test (the "includes privacyPolicyUrl, termsUrl, gdprUrl, and gdprRequired" one, around line 845-862), before the block's closing `});`:

```ts
    it('reports emailVerificationMethod "code" when the app is configured for it', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue({
        name: 'MyApp', defaultOrgId: null, passwordPolicyOverride: null, logo: null, favicon: null,
        privacyPolicyUrl: null, termsUrl: null, gdprUrl: null, emailVerificationMethod: 'code',
      });
      const result = await service.getAppName('sq_1');
      expect(result.emailVerificationMethod).toBe('code');
    });
```

- [ ] **Step 2: Run test to verify the new one fails**

Run: `pnpm --filter @sassy-auth/auth-server test -- registration.service.spec`
Expected: the new "reports emailVerificationMethod 'code'" test FAILs (`result.emailVerificationMethod` is `undefined`); the four updated `toEqual` blocks also now FAIL, since the real method still doesn't return the field at all.

- [ ] **Step 3: Implement**

In `apps/auth-server/src/registration/registration.service.ts`, extend `getAppName`'s return type and query. Find:

```ts
  async getAppName(
    appPublicId: string,
    ip: string = 'unknown',
  ): Promise<{
    name: string;
    hasDefaultOrg: boolean;
    passwordPolicy: PasswordPolicy;
    logo: string | null;
    favicon: string | null;
    privacyPolicyUrl: string | null;
    termsUrl: string | null;
    gdprUrl: string | null;
    gdprRequired: boolean;
  }> {
    if (!appPublicId) throw new NotFoundException('App not found');
    const app = await prisma.saApp.findUnique({
      where: { publicId: appPublicId },
      select: {
        name: true,
        defaultOrgId: true,
        passwordPolicyOverride: true,
        logo: true,
        favicon: true,
        privacyPolicyUrl: true,
        termsUrl: true,
        gdprUrl: true,
      },
    });
```

Replace with:
```ts
  async getAppName(
    appPublicId: string,
    ip: string = 'unknown',
  ): Promise<{
    name: string;
    hasDefaultOrg: boolean;
    passwordPolicy: PasswordPolicy;
    logo: string | null;
    favicon: string | null;
    privacyPolicyUrl: string | null;
    termsUrl: string | null;
    gdprUrl: string | null;
    gdprRequired: boolean;
    emailVerificationMethod: 'link' | 'code';
  }> {
    if (!appPublicId) throw new NotFoundException('App not found');
    const app = await prisma.saApp.findUnique({
      where: { publicId: appPublicId },
      select: {
        name: true,
        defaultOrgId: true,
        passwordPolicyOverride: true,
        logo: true,
        favicon: true,
        privacyPolicyUrl: true,
        termsUrl: true,
        gdprUrl: true,
        emailVerificationMethod: true,
      },
    });
```

Then add the field to the return statement at the bottom of the method. Find:
```ts
      gdprRequired: resolveRequiredConsent(app, country).some((d) => d.documentType === 'gdpr'),
    };
  }
}
```
Replace with:
```ts
      gdprRequired: resolveRequiredConsent(app, country).some((d) => d.documentType === 'gdpr'),
      // Defaults to 'link' for the same reason formatApp (apps.service.ts)
      // does — a real Prisma row always has this NOT NULL column populated,
      // but hand-built test fixtures and any other caller that doesn't
      // select it should still get the safe, existing-behavior default.
      emailVerificationMethod: (app.emailVerificationMethod ?? 'link') as 'link' | 'code',
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sassy-auth/auth-server test -- registration.service.spec`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/registration/registration.service.ts apps/auth-server/src/registration/registration.service.spec.ts
git commit -m "feat(registration): surface emailVerificationMethod from GET /api/register/app"
```

---

### Task 7: Admin `fetchAppInfo` — thread the method through to the frontend

**Files:**
- Modify: `apps/admin/lib/app-info.ts`
- Modify: `apps/admin/lib/__tests__/app-info.test.ts`
- Modify: `apps/admin/app/signup/__tests__/page.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `apps/admin/lib/__tests__/app-info.test.ts`, add `emailVerificationMethod: 'link'` to every expected result object in the existing `toEqual(...)` calls (there are 5: the success case, the "falls back to passwordPolicy: null" case, the "not ok" case, the "fetch throws" case, and the "favicon" case) — each currently ends with `gdprRequired: false,\n    })`. Add `emailVerificationMethod: 'link',` as a new line directly before `gdprRequired: false,` in each of these 5 objects (the field defaults to `'link'` in every fallback branch, matching the "fail toward the safe/existing default" pattern this file already uses for `hasDefaultOrg: false` etc.).

Then add one new test at the end of the `describe('fetchAppInfo', ...)` block, directly before its closing `})`:

```ts
  it('returns emailVerificationMethod "code" from a successful response', async () => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ name: 'Acme', hasDefaultOrg: true, passwordPolicy: POLICY, emailVerificationMethod: 'code' }),
    } as Response)

    const result = await fetchAppInfo('sq_1')
    expect(result.emailVerificationMethod).toBe('code')
  })
```

In `apps/admin/app/signup/__tests__/page.test.tsx`, add `emailVerificationMethod: 'link',` to the `BASE_APP_INFO` fixture object (directly after `gdprRequired: false,`).

- [ ] **Step 2: Run tests to verify failures**

Run: `pnpm --filter @sassy-auth/admin test -- app-info.test`
Expected: FAIL — `fetchAppInfo`'s return type doesn't yet have `emailVerificationMethod`, so the new test's assertion fails and (once Step 3 lands) the `toEqual` ones would too; right now (before any implementation change) all of these still pass except the brand-new test, which fails because the field is `undefined`, not `'code'`.

Run: `pnpm --filter @sassy-auth/admin test -- signup/__tests__/page.test`
Expected: PASS (this file doesn't assert on the field yet — it's just completing the fixture ahead of the type change in Step 3, to avoid a second failing-test round-trip once `fetchAppInfo`'s return type becomes stricter).

- [ ] **Step 3: Implement**

In `apps/admin/lib/app-info.ts`, update the return type and all four return statements. Find:

```ts
export async function fetchAppInfo(
  clientId: string,
): Promise<{
  name: string | null; hasDefaultOrg: boolean; passwordPolicy: PasswordPolicy | null; logo: string | null;
  favicon: string | null;
  privacyPolicyUrl: string | null; termsUrl: string | null; gdprUrl: string | null; gdprRequired: boolean;
}> {
  try {
    const forwardedIp = await getForwardedClientIpHeader()
    const res = await fetch(`${AUTH_SERVER}/api/register/app?appPublicId=${encodeURIComponent(clientId)}`, {
      cache: 'no-store',
      headers: { ...forwardedIp },
    })
    if (!res.ok) {
      // Fail toward hasDefaultOrg: false, not true: a Company name field shown
      // but ignored by the server is harmless, whereas defaulting to true could
      // hide a required field and produce a signup-blocking dead end.
      return {
        name: null, hasDefaultOrg: false, passwordPolicy: null, logo: null, favicon: null,
        privacyPolicyUrl: null, termsUrl: null, gdprUrl: null, gdprRequired: false,
      }
    }
    const body = (await res.json()) as {
      name?: string; hasDefaultOrg?: boolean; passwordPolicy?: PasswordPolicy; logo?: string | null; favicon?: string | null;
      privacyPolicyUrl?: string | null; termsUrl?: string | null; gdprUrl?: string | null; gdprRequired?: boolean;
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
    }
  } catch {
    // Same reasoning as the !res.ok branch above: fail toward false.
    return {
      name: null, hasDefaultOrg: false, passwordPolicy: null, logo: null, favicon: null,
      privacyPolicyUrl: null, termsUrl: null, gdprUrl: null, gdprRequired: false,
    }
  }
}
```

Replace with:
```ts
export async function fetchAppInfo(
  clientId: string,
): Promise<{
  name: string | null; hasDefaultOrg: boolean; passwordPolicy: PasswordPolicy | null; logo: string | null;
  favicon: string | null;
  privacyPolicyUrl: string | null; termsUrl: string | null; gdprUrl: string | null; gdprRequired: boolean;
  emailVerificationMethod: 'link' | 'code';
}> {
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
      return {
        name: null, hasDefaultOrg: false, passwordPolicy: null, logo: null, favicon: null,
        privacyPolicyUrl: null, termsUrl: null, gdprUrl: null, gdprRequired: false,
        emailVerificationMethod: 'link',
      }
    }
    const body = (await res.json()) as {
      name?: string; hasDefaultOrg?: boolean; passwordPolicy?: PasswordPolicy; logo?: string | null; favicon?: string | null;
      privacyPolicyUrl?: string | null; termsUrl?: string | null; gdprUrl?: string | null; gdprRequired?: boolean;
      emailVerificationMethod?: 'link' | 'code';
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
    }
  } catch {
    // Same reasoning as the !res.ok branch above: fail toward false/link.
    return {
      name: null, hasDefaultOrg: false, passwordPolicy: null, logo: null, favicon: null,
      privacyPolicyUrl: null, termsUrl: null, gdprUrl: null, gdprRequired: false,
      emailVerificationMethod: 'link',
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @sassy-auth/admin test -- app-info.test`
Expected: PASS

Run: `pnpm --filter @sassy-auth/admin test -- signup/__tests__/page.test`
Expected: PASS

Run: `pnpm --filter @sassy-auth/admin typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/admin/lib/app-info.ts apps/admin/lib/__tests__/app-info.test.ts apps/admin/app/signup/__tests__/page.test.tsx
git commit -m "feat(admin): thread emailVerificationMethod through fetchAppInfo"
```

---

### Task 8: Thread `clientId` to `/signup/check-email` and branch its render

**Files:**
- Modify: `apps/admin/app/signup/signup-form.tsx:107-109`
- Modify: `apps/admin/app/signup/check-email/page.tsx`
- Create: `apps/admin/app/signup/check-email/__tests__/page.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/admin/app/signup/check-email/__tests__/page.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import CheckEmailPage from '../page'
import { fetchAppInfo } from '@/lib/app-info'

jest.mock('next-intl/server', () => ({
  getTranslations: async (namespace?: string) => {
    const t = (key: string, values?: Record<string, string>) => {
      const full = namespace ? `${namespace}.${key}` : key
      return values ? `${full} ${JSON.stringify(values)}` : full
    }
    return t
  },
}))

jest.mock('@/lib/app-info', () => ({
  fetchAppInfo: jest.fn(),
}))

jest.mock('../check-email-card', () => ({
  CheckEmailCard: () => <div data-testid="check-email-card" />,
}))

jest.mock('../verify-code-card', () => ({
  VerifyCodeCard: () => <div data-testid="verify-code-card" />,
}))

const mockFetchAppInfo = fetchAppInfo as jest.MockedFunction<typeof fetchAppInfo>

const BASE_APP_INFO = {
  name: null, hasDefaultOrg: false, passwordPolicy: null, logo: null, favicon: null,
  privacyPolicyUrl: null, termsUrl: null, gdprUrl: null, gdprRequired: false,
  emailVerificationMethod: 'link' as const,
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('CheckEmailPage', () => {
  it('shows the missing-email message when no email is given', async () => {
    const ui = await CheckEmailPage({ searchParams: Promise.resolve({}) })
    render(ui)
    expect(screen.getByText('signup.checkEmail.missingEmail')).toBeInTheDocument()
    expect(mockFetchAppInfo).not.toHaveBeenCalled()
  })

  it('renders CheckEmailCard when no clientId is given (fail open)', async () => {
    const ui = await CheckEmailPage({ searchParams: Promise.resolve({ email: 'a@x.com' }) })
    render(ui)
    expect(screen.getByTestId('check-email-card')).toBeInTheDocument()
    expect(mockFetchAppInfo).not.toHaveBeenCalled()
  })

  it('renders CheckEmailCard when the app is configured for the link method', async () => {
    mockFetchAppInfo.mockResolvedValue({ ...BASE_APP_INFO, emailVerificationMethod: 'link' })
    const ui = await CheckEmailPage({ searchParams: Promise.resolve({ email: 'a@x.com', clientId: 'sq_1' }) })
    render(ui)
    expect(screen.getByTestId('check-email-card')).toBeInTheDocument()
  })

  it('renders VerifyCodeCard when the app is configured for the code method', async () => {
    mockFetchAppInfo.mockResolvedValue({ ...BASE_APP_INFO, emailVerificationMethod: 'code' })
    const ui = await CheckEmailPage({ searchParams: Promise.resolve({ email: 'a@x.com', clientId: 'sq_1' }) })
    render(ui)
    expect(screen.getByTestId('verify-code-card')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sassy-auth/admin test -- check-email/__tests__/page.test`
Expected: FAIL — `../verify-code-card` module doesn't exist yet, and `page.tsx` doesn't read `clientId` or call `fetchAppInfo` yet.

- [ ] **Step 3: Implement — `signup-form.tsx`**

In `apps/admin/app/signup/signup-form.tsx`, find:
```ts
      router.push(
        `/signup/check-email?email=${encodeURIComponent(email)}${next ? `&next=${encodeURIComponent(next)}` : ''}`,
      )
```
Replace with:
```ts
      router.push(
        `/signup/check-email?email=${encodeURIComponent(email)}&clientId=${encodeURIComponent(clientId)}${next ? `&next=${encodeURIComponent(next)}` : ''}`,
      )
```

- [ ] **Step 4: Implement — `check-email/page.tsx`**

This step also creates a placeholder `VerifyCodeCard` just sufficient to satisfy the import — the real implementation is Task 9. Replace the full contents of `apps/admin/app/signup/check-email/page.tsx`:

```tsx
import { getTranslations } from 'next-intl/server'
import { AuthCard } from '@sassy-auth/ui'
import { fetchAppInfo } from '@/lib/app-info'
import { CheckEmailCard } from './check-email-card'
import { VerifyCodeCard } from './verify-code-card'

export const dynamic = 'force-dynamic'

// Same "PUBLIC vs internal auth-server origin" split as app/login/page.tsx —
// this page fetches directly from the browser, so it needs the origin the
// browser can reach, not the one this Next.js process reaches internally.
const PUBLIC_AUTH_SERVER =
  process.env.PUBLIC_AUTH_SERVER_URL ?? process.env.AUTH_SERVER_URL ?? 'https://localhost:3010'

export default async function CheckEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; next?: string; clientId?: string }>
}) {
  const { email, next, clientId } = await searchParams
  const t = await getTranslations('signup.checkEmail')

  if (!email) {
    return <AuthCard title={t('title')} subtitle={t('missingEmail')} />
  }

  // Fail open to the classic link flow when clientId is missing or the app
  // lookup fails — matches fetchAppInfo's own fail-toward-'link' default.
  const emailVerificationMethod = clientId ? (await fetchAppInfo(clientId)).emailVerificationMethod : 'link'

  if (emailVerificationMethod === 'code') {
    return <VerifyCodeCard email={email} next={next ?? ''} authServerUrl={PUBLIC_AUTH_SERVER} />
  }

  return <CheckEmailCard email={email} next={next ?? ''} authServerUrl={PUBLIC_AUTH_SERVER} />
}
```

Create a minimal placeholder `apps/admin/app/signup/check-email/verify-code-card.tsx` so the import resolves (Task 9 replaces this file's contents with the real implementation):

```tsx
'use client'

export function VerifyCodeCard({ email: _email, next: _next, authServerUrl: _authServerUrl }: { email: string; next: string; authServerUrl: string }) {
  return null
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @sassy-auth/admin test -- check-email/__tests__/page.test`
Expected: PASS, all 4 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/app/signup/signup-form.tsx apps/admin/app/signup/check-email/page.tsx apps/admin/app/signup/check-email/verify-code-card.tsx apps/admin/app/signup/check-email/__tests__/page.test.tsx
git commit -m "feat(admin): branch /signup/check-email rendering on emailVerificationMethod"
```

---

### Task 9: `VerifyCodeCard` — the real code-entry UI

**Files:**
- Modify: `apps/admin/app/signup/check-email/verify-code-card.tsx` (replacing the Task 8 placeholder)
- Create: `apps/admin/app/signup/check-email/__tests__/verify-code-card.test.tsx`
- Modify: `apps/admin/messages/en.json`
- Modify: `apps/admin/messages/fr.json`

- [ ] **Step 1: Add translation keys**

In `apps/admin/messages/en.json`, find the `"checkEmail": { ... }` block (search for `"checkEmail": {`) and add a sibling `"verifyCode"` key at the same nesting level as `"checkEmail"` (i.e. directly after `"checkEmail"`'s closing `},`):

```json
    "verifyCode": {
      "title": "Enter your code",
      "subtitle": "We sent a 6-digit code to {email}.",
      "codeLabel": "Verification code",
      "submit": "Verify",
      "resendButton": "Resend code",
      "resendCooldown": "Resend in {seconds}s",
      "resendSent": "A new code is on its way.",
      "resendError": "We couldn't resend the code. Please try again in a moment.",
      "errorInvalid": "That code isn't right. Please try again.",
      "errorExpired": "That code has expired. Request a new one below.",
      "errorTooManyAttempts": "Too many attempts. Request a new code below.",
      "errorGeneric": "Something went wrong. Please try again.",
      "backToLogin": "Back to sign in"
    },
```

Add the equivalent French block to `apps/admin/messages/fr.json` in the same position (find the French `"checkEmail"` block there) — check that file's existing `"checkEmail"` translations first to match tone/formality, then translate the same keys:

```json
    "verifyCode": {
      "title": "Saisissez votre code",
      "subtitle": "Nous avons envoyé un code à 6 chiffres à {email}.",
      "codeLabel": "Code de vérification",
      "submit": "Vérifier",
      "resendButton": "Renvoyer le code",
      "resendCooldown": "Renvoyer dans {seconds}s",
      "resendSent": "Un nouveau code est en route.",
      "resendError": "Impossible de renvoyer le code. Veuillez réessayer dans un instant.",
      "errorInvalid": "Ce code est incorrect. Veuillez réessayer.",
      "errorExpired": "Ce code a expiré. Demandez-en un nouveau ci-dessous.",
      "errorTooManyAttempts": "Trop de tentatives. Demandez un nouveau code ci-dessous.",
      "errorGeneric": "Une erreur s'est produite. Veuillez réessayer.",
      "backToLogin": "Retour à la connexion"
    },
```

- [ ] **Step 2: Write the failing test**

Create `apps/admin/app/signup/check-email/__tests__/verify-code-card.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { VerifyCodeCard } from '../verify-code-card'

const pushMock = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }))

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}))

afterEach(() => {
  jest.restoreAllMocks()
  pushMock.mockClear()
})

function renderCard() {
  return render(<VerifyCodeCard email="alice@example.com" next="" authServerUrl="https://auth.example.com" />)
}

describe('VerifyCodeCard', () => {
  it('shows the email address in the subtitle', () => {
    renderCard()
    expect(screen.getByText('subtitle:{"email":"alice@example.com"}')).toBeInTheDocument()
  })

  it('submits the code and navigates to /signup/verified on success', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ status: true }) })
    global.fetch = fetchMock as unknown as typeof fetch
    renderCard()

    fireEvent.change(screen.getByLabelText('codeLabel'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'submit' }))

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/signup/verified'))
    expect(fetchMock).toHaveBeenCalledWith(
      'https://auth.example.com/api/auth/email-otp/verify-email',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'alice@example.com', otp: '123456' }),
      }),
    )
  })

  it('shows an invalid-code error and does not navigate when the code is wrong', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ code: 'INVALID_OTP', message: 'Invalid OTP' }),
    }) as unknown as typeof fetch
    renderCard()

    fireEvent.change(screen.getByLabelText('codeLabel'), { target: { value: '000000' } })
    fireEvent.click(screen.getByRole('button', { name: 'submit' }))

    await waitFor(() => expect(screen.getByText('errorInvalid')).toBeInTheDocument())
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('shows an expired-code error distinctly from an invalid code', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ code: 'OTP_EXPIRED', message: 'OTP expired' }),
    }) as unknown as typeof fetch
    renderCard()

    fireEvent.change(screen.getByLabelText('codeLabel'), { target: { value: '000000' } })
    fireEvent.click(screen.getByRole('button', { name: 'submit' }))

    await waitFor(() => expect(screen.getByText('errorExpired')).toBeInTheDocument())
  })

  it('resends the code, shows a confirmation, and disables the resend button during cooldown', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ status: true }) })
    global.fetch = fetchMock as unknown as typeof fetch
    renderCard()

    fireEvent.click(screen.getByRole('button', { name: 'resendButton' }))

    await waitFor(() => expect(screen.getByTestId('verify-code-resent')).toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledWith(
      'https://auth.example.com/api/auth/send-verification-email',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('shows a link back to sign-in, preserving next', () => {
    render(<VerifyCodeCard email="alice@example.com" next="/orgs" authServerUrl="https://auth.example.com" />)
    expect(screen.getByRole('link', { name: 'backToLogin' })).toHaveAttribute('href', '/login?next=%2Forgs')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @sassy-auth/admin test -- verify-code-card.test`
Expected: FAIL — the placeholder component renders `null`, so none of the queries find anything.

- [ ] **Step 4: Implement**

Replace the full contents of `apps/admin/app/signup/check-email/verify-code-card.tsx`:

```tsx
'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { AuthCard, Button, FormField } from '@sassy-auth/ui'
import { useResendVerificationEmail } from '@/lib/use-resend-verification-email'

const ERROR_KEY_BY_CODE: Record<string, string> = {
  INVALID_OTP: 'errorInvalid',
  OTP_EXPIRED: 'errorExpired',
  TOO_MANY_ATTEMPTS: 'errorTooManyAttempts',
}

export function VerifyCodeCard({
  email,
  next,
  authServerUrl,
}: {
  email: string
  next: string
  authServerUrl: string
}) {
  const t = useTranslations('signup.verifyCode')
  const router = useRouter()
  const { resend, status: resendStatus, cooldown } = useResendVerificationEmail({ email, authServerUrl })
  const [otp, setOtp] = React.useState('')
  const [verifying, setVerifying] = React.useState(false)
  const [errorKey, setErrorKey] = React.useState<string | null>(null)

  const loginHref = next ? `/login?next=${encodeURIComponent(next)}` : '/login'

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErrorKey(null)
    setVerifying(true)
    try {
      const res = await fetch(`${authServerUrl}/api/auth/email-otp/verify-email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, otp }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { code?: string }
        setErrorKey(ERROR_KEY_BY_CODE[body.code ?? ''] ?? 'errorGeneric')
        return
      }
      router.push('/signup/verified')
    } catch {
      setErrorKey('errorGeneric')
    } finally {
      setVerifying(false)
    }
  }

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
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <FormField
          id="otp"
          inputMode="numeric"
          autoComplete="one-time-code"
          required
          label={t('codeLabel')}
          value={otp}
          onChange={(e) => setOtp(e.target.value)}
        />
        {errorKey && (
          <p data-testid="verify-code-error" className="text-label-md text-destructive">
            {t(errorKey)}
          </p>
        )}
        <Button type="submit" className="w-full" loading={verifying}>
          {t('submit')}
        </Button>
        <div className="flex flex-col items-center gap-2">
          <Button type="button" variant="ghost" onClick={resend} loading={resendStatus === 'sending'} disabled={cooldown > 0}>
            {cooldown > 0 ? t('resendCooldown', { seconds: cooldown }) : t('resendButton')}
          </Button>
          {resendStatus === 'sent' && (
            <p data-testid="verify-code-resent" className="text-body-sm text-muted-foreground">
              {t('resendSent')}
            </p>
          )}
          {resendStatus === 'error' && (
            <p data-testid="verify-code-resend-error" className="text-label-md text-destructive">
              {t('resendError')}
            </p>
          )}
        </div>
      </form>
    </AuthCard>
  )
}
```

Note: if `Button` from `@sassy-auth/ui` doesn't support a `variant="ghost"` prop, check `packages/ui/src/components/button.tsx` (or wherever it's defined) for its actual variant options before this step and use whatever secondary/subtle variant it already exposes (or drop the `variant` prop entirely if it only has one visual style) — the test assertions above only query by role/name/test-id and don't depend on styling, so this is a safe adjustment to make without touching the test.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @sassy-auth/admin test -- verify-code-card.test`
Expected: PASS, all 6 tests.

Run: `pnpm --filter @sassy-auth/admin test -- check-email/__tests__/page.test`
Expected: still PASS (this file's mock of `../verify-code-card` is unaffected by the real implementation).

- [ ] **Step 6: Commit**

```bash
git add apps/admin/app/signup/check-email/verify-code-card.tsx apps/admin/app/signup/check-email/__tests__/verify-code-card.test.tsx apps/admin/messages/en.json apps/admin/messages/fr.json
git commit -m "feat(admin): add VerifyCodeCard for 6-digit signup email verification"
```

---

### Task 10: Admin console — link/code toggle in the app edit drawer

**Files:**
- Modify: `apps/admin/components/app-edit-drawer.tsx`
- Modify: `apps/admin/components/__tests__/app-edit-drawer.test.tsx`
- Modify: `apps/admin/messages/en.json`
- Modify: `apps/admin/messages/fr.json`

This component's tests mock `@sassy-auth/ui` with a thin native-`<select>` shim for `Select` (JSDOM can't drive Radix's real pointer-event-based dropdown) — see the `jest.mock('@sassy-auth/ui', ...)` block near the top of the test file. The shim renders an `aria-label` equal to the `SelectValue`'s `placeholder` prop, so a `Select` field is driven with `fireEvent.change(screen.getByLabelText(<placeholder text>), { target: { value } })`, exactly like the existing `twoFactorPromptEnabled` test does. The new field follows that same pattern.

- [ ] **Step 1: Add translation keys**

In `apps/admin/messages/en.json`, find `"activationEmailMessageHint"` (inside the `apps.fields` section) and add a new key directly after its line:
```json
      "activationEmailMessageHint": "Shown above the confirmation button, which is always added automatically.",
      "emailVerificationMethod": "Verification method",
      "emailVerificationMethodHint": "How new sign-ups confirm their email address.",
      "emailVerificationMethodLink": "Clickable link",
      "emailVerificationMethodCode": "6-digit code",
```

Add the equivalent to `apps/admin/messages/fr.json` in the same position (match that file's existing `apps.fields.activationEmail*` translations for tone):
```json
      "emailVerificationMethod": "Méthode de vérification",
      "emailVerificationMethodHint": "Comment les nouveaux inscrits confirment leur adresse e-mail.",
      "emailVerificationMethodLink": "Lien cliquable",
      "emailVerificationMethodCode": "Code à 6 chiffres",
```

- [ ] **Step 2: Write the failing test**

In `apps/admin/components/__tests__/app-edit-drawer.test.tsx`, add two new tests directly after the existing `'does not mark the form dirty when twoFactorPromptEnabled is re-selected to its current value'` test (around line 552-565, before whatever test follows it):

```tsx
  it('changes emailVerificationMethod and includes it in the patch when changed', async () => {
    ;(actions.updateAppAction as jest.Mock).mockResolvedValue({
      app: { ...app, emailVerificationMethod: 'code' },
    })
    render(withIntl(<AppEditDrawer app={app} open onOpenChange={() => undefined} />))

    fireEvent.change(screen.getByLabelText(en.apps.fields.emailVerificationMethod), { target: { value: 'code' } })
    fireEvent.click(screen.getByRole('button', { name: en.apps.drawer.save }))

    await waitFor(() =>
      expect(actions.updateAppAction).toHaveBeenCalledWith('sq_1', { emailVerificationMethod: 'code' }),
    )
  })

  it('does not mark the form dirty when emailVerificationMethod is re-selected to its current value', () => {
    const appWithCode = { ...app, emailVerificationMethod: 'code' as const }
    render(withIntl(<AppEditDrawer app={appWithCode} open onOpenChange={() => undefined} />))
    const save = screen.getByRole('button', { name: en.apps.drawer.save })
    expect(save).toBeDisabled()

    fireEvent.change(screen.getByLabelText(en.apps.fields.emailVerificationMethod), { target: { value: 'code' } })
    expect(save).toBeDisabled()
  })
```

These mirror the existing `twoFactorPromptEnabled` tests (same file, directly above) exactly in structure — same `app` fixture, same `withIntl`/`render`/`waitFor` calls, same `actions.updateAppAction` mock.

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @sassy-auth/admin test -- app-edit-drawer`
Expected: FAIL — no element with label `en.apps.fields.emailVerificationMethod` ("Verification method") exists yet.

- [ ] **Step 4: Implement**

In `apps/admin/components/app-edit-drawer.tsx`, add state (directly after the `activationMessage` state declaration on line 79). `app.emailVerificationMethod` is optional (Task 5, Step 5) so every read defaults to `'link'`, matching the field's DB-level default:
```ts
  const [emailVerificationMethod, setEmailVerificationMethod] = React.useState<'link' | 'code'>(app.emailVerificationMethod ?? 'link')
```

Add to the reset-on-open `useEffect` (directly after `setActivationMessage(app.activationEmailOverride?.message ?? '')` on line 140):
```ts
    setEmailVerificationMethod(app.emailVerificationMethod ?? 'link')
```

Add a dirty flag (directly after the `activationDirty` declaration, around line 257, before the `dirty` combinator):
```ts
  const emailVerificationMethodDirty = emailVerificationMethod !== (app.emailVerificationMethod ?? 'link')
```

Add it to the `dirty` combinator — find:
```ts
  const dirty = name !== app.name || url !== app.url || logo !== originalLogo || favicon !== originalFavicon || redirectUrisDirty || twoFactorTrustDays !== (app.twoFactorTrustDays ?? null) || twoFactorPromptEnabled !== (app.twoFactorPromptEnabled ?? null) || requireTwoFactor !== (app.requireTwoFactor ?? false) || allowOfflineAccess !== (app.allowOfflineAccess ?? false) || socialDirty || defaultOrgId !== (app.defaultOrgId ?? null) || defaultRoleId !== (app.defaultRoleId ?? null) || passwordPolicyDirty || webhookUrlDirty || activationDirty || privacyPolicyUrlDirty || termsUrlDirty || gdprUrlDirty
```
Replace with (appending `|| emailVerificationMethodDirty` before the closing of the expression):
```ts
  const dirty = name !== app.name || url !== app.url || logo !== originalLogo || favicon !== originalFavicon || redirectUrisDirty || twoFactorTrustDays !== (app.twoFactorTrustDays ?? null) || twoFactorPromptEnabled !== (app.twoFactorPromptEnabled ?? null) || requireTwoFactor !== (app.requireTwoFactor ?? false) || allowOfflineAccess !== (app.allowOfflineAccess ?? false) || socialDirty || defaultOrgId !== (app.defaultOrgId ?? null) || defaultRoleId !== (app.defaultRoleId ?? null) || passwordPolicyDirty || webhookUrlDirty || activationDirty || privacyPolicyUrlDirty || termsUrlDirty || gdprUrlDirty || emailVerificationMethodDirty
```

Add it to the patch-building `handleSubmit` — find the `patch` type declaration and add the field, then add a patch-setting line. Find:
```ts
    const patch: { name?: string; url?: string; logo?: string | null; favicon?: string | null; redirectUris?: RedirectUri[]; twoFactorTrustDays?: number | null; twoFactorPromptEnabled?: boolean | null; requireTwoFactor?: boolean; allowOfflineAccess?: boolean; defaultOrgId?: string | null; defaultRoleId?: string | null; passwordPolicyOverride?: PasswordPolicy | null; activationWebhookUrl?: string | null; activationEmailOverride?: import('@/lib/types').ActivationEmailBranding | null; privacyPolicyUrl?: string | null; termsUrl?: string | null; gdprUrl?: string | null } = {}
```
Replace with:
```ts
    const patch: { name?: string; url?: string; logo?: string | null; favicon?: string | null; redirectUris?: RedirectUri[]; twoFactorTrustDays?: number | null; twoFactorPromptEnabled?: boolean | null; requireTwoFactor?: boolean; allowOfflineAccess?: boolean; defaultOrgId?: string | null; defaultRoleId?: string | null; passwordPolicyOverride?: PasswordPolicy | null; activationWebhookUrl?: string | null; activationEmailOverride?: import('@/lib/types').ActivationEmailBranding | null; privacyPolicyUrl?: string | null; termsUrl?: string | null; gdprUrl?: string | null; emailVerificationMethod?: 'link' | 'code' } = {}
```

Then add, directly after the `if (gdprUrlDirty) { ... }` block (before `if (activationDirty) {`):
```ts
    if (emailVerificationMethodDirty) patch.emailVerificationMethod = emailVerificationMethod
```

Finally, add the UI control. Insert it directly after the activation-email override `<div>` block closes (after the `</div>` that closes the `activationEmail` field block, i.e. right after line 855's `</div>`, and before the `{errorKey && (` block):

```tsx
            <div>
              <Label htmlFor="emailVerificationMethod">{t('apps.fields.emailVerificationMethod')}</Label>
              <Select
                value={emailVerificationMethod}
                onValueChange={(v) => setEmailVerificationMethod(v as 'link' | 'code')}
              >
                <SelectTrigger id="emailVerificationMethod">
                  <SelectValue placeholder={t('apps.fields.emailVerificationMethod')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="link">{t('apps.fields.emailVerificationMethodLink')}</SelectItem>
                  <SelectItem value="code">{t('apps.fields.emailVerificationMethodCode')}</SelectItem>
                </SelectContent>
              </Select>
              <p className="mt-1 text-body-sm text-muted-foreground">
                {t('apps.fields.emailVerificationMethodHint')}
              </p>
            </div>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @sassy-auth/admin test -- app-edit-drawer`
Expected: PASS, including both new tests.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/components/app-edit-drawer.tsx apps/admin/components/__tests__/app-edit-drawer.test.tsx apps/admin/messages/en.json apps/admin/messages/fr.json
git commit -m "feat(admin): add link/code toggle to the Activation email drawer section"
```

---

### Task 11: Full verification sweep

**Files:** none (verification only)

- [ ] **Step 1: Typecheck every touched package**

Run: `pnpm --filter @sassy-auth/db build`
Expected: PASS (confirms the Prisma client compiles).

Run: `pnpm --filter @sassy-auth/auth-server typecheck`
Expected: PASS

Run: `pnpm --filter @sassy-auth/admin typecheck`
Expected: PASS

- [ ] **Step 2: Run the full test suite for both touched apps**

Run: `pnpm --filter @sassy-auth/auth-server test`
Expected: PASS — in particular, re-check `apps.service.spec.ts`, `auth.config.spec.ts`, `registration.service.spec.ts`, and the two new template/sender spec files all still pass together (not just in isolation), since Jest module-registry state (`jest.resetModules()` in `auth.config.spec.ts`) can occasionally interact across files run in the same worker.

Run: `pnpm --filter @sassy-auth/admin test`
Expected: PASS — in particular, confirm `check-email-card.test.tsx` (untouched, still covers the `'link'`-method path) and the three new/modified test files from Tasks 8-10 all pass together.

- [ ] **Step 3: Lint**

Run: `pnpm --filter @sassy-auth/auth-server lint` and `pnpm --filter @sassy-auth/admin lint`
Expected: both PASS. Fix any lint findings (e.g. unused imports left over from edits) before proceeding.

- [ ] **Step 4: Manual smoke check (documented, not automated)**

This plan does not include an e2e test for the new flow (none of the existing signup e2e coverage was identified as requiring an update per the design doc's scope). Before merging, manually verify locally:
1. Set an app's `emailVerificationMethod` to `'code'` via the admin console's app edit drawer.
2. Sign up a new user against that app's `client_id`.
3. Confirm the received email (Mailpit in local dev, per the README's "Local email testing" section) shows a 6-digit code using that app's activation-email branding, not a link.
4. Enter the code on `/signup/check-email` and confirm it redirects to `/signup/verified` and the user's `SaUser.status` becomes `active`.
5. Confirm an app left at the default `'link'` method is completely unaffected (still receives and can click a link).

Note any issues found and fix them before considering this plan complete.

- [ ] **Step 5: Final commit (if any fixups were needed)**

```bash
git add -A
git commit -m "fix: address lint/typecheck/test fixups from signup OTP verification sweep"
```

(Skip this step if Steps 1-4 found nothing to fix.)
