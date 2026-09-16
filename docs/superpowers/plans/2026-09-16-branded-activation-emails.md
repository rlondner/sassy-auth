# Branded Activation Emails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each `SaApp` brand its activation (email-verification) email — subject, from name/address, and intro message — with the confirmation link always rendered as a large styled button, per `docs/superpowers/specs/2026-09-16-branded-activation-emails-design.md`.

**Architecture:** One new nullable JSON column (`SaApp.activationEmailOverride`) holds the four optional override fields. A new `renderTemplate` helper (in `@sassy-auth/types`, alongside the existing `PasswordPolicy`/`isValidAppLogoDataUri` pure-logic exports) does `{{token}}` substitution for subject/message. `verificationEmail()` renders subject/message from overrides + defaults and always appends a system-rendered button. `auth.config.ts`'s `sendVerificationEmail` hook resolves the owning `SaApp` via `SaUser.betterAuthUserId` and passes its name + override through. `EmailService.send` gains a per-message `from` override. The admin edit drawer gets a new "Activation email" section following the existing webhook-fields pattern.

**Tech Stack:** NestJS (auth-server), Prisma, Next.js + next-intl (admin), Jest.

---

## Task 1: `ActivationEmailBranding` type + `renderTemplate` helper

**Files:**
- Modify: `packages/types/index.ts`
- Test: `apps/auth-server/src/email/templates/render-template.spec.ts` (new — `packages/types` has no jest runner of its own; its pure-logic exports, like `evaluatePasswordPolicy`, are tested from `auth-server`'s suite, e.g. `apps/auth-server/src/auth/password-policy-evaluator.spec.ts`)

- [ ] **Step 1: Write the failing test**

Create `apps/auth-server/src/email/templates/render-template.spec.ts`:

```ts
import { renderTemplate } from '@sassy-auth/types';

describe('renderTemplate', () => {
  it('substitutes known tokens', () => {
    expect(renderTemplate('Hi {{firstName}}, welcome to {{appName}}', { firstName: 'Jane', appName: 'Vibecast' }))
      .toBe('Hi Jane, welcome to Vibecast');
  });

  it('leaves unknown tokens untouched', () => {
    expect(renderTemplate('Hi {{firstName}}, {{unknown}}', { firstName: 'Jane' }))
      .toBe('Hi Jane, {{unknown}}');
  });

  it('substitutes a repeated token every time it appears', () => {
    expect(renderTemplate('{{appName}} — {{appName}}', { appName: 'Vibecast' }))
      .toBe('Vibecast — Vibecast');
  });

  it('returns the template unchanged when it has no tokens', () => {
    expect(renderTemplate('plain text', {})).toBe('plain text');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter auth-server test -- render-template.spec.ts`
Expected: FAIL — `renderTemplate is not a function` (or module has no exported member `renderTemplate`)

- [ ] **Step 3: Write minimal implementation**

Append to `packages/types/index.ts` (near the other standalone exports, after `isValidAppLogoDataUri`):

```ts
/**
 * Per-app override for the activation (email-verification) email. Every
 * field is optional and independently defaulted by the caller — omitted or
 * undefined means "use the platform default" for that field.
 */
export interface ActivationEmailBranding {
  fromName?: string;
  fromAddress?: string;
  subject?: string;
  message?: string;
}

/**
 * Literal `{{token}}` substitution — no conditionals, no loops. A token not
 * present in `vars` is left in the output untouched, so a typo'd or removed
 * placeholder degrades visibly rather than silently vanishing.
 */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => (key in vars ? vars[key] : match));
}
```

- [ ] **Step 4: Rebuild the types package**

`@sassy-auth/types` is consumed via its built `dist/` output (`"main": "./dist/index.js"`, symlinked into every workspace's `node_modules/@sassy-auth/types`) — auth-server's jest run won't see the new export until it's rebuilt.

Run: `pnpm --filter @sassy-auth/types build`
Expected: exits 0, `packages/types/dist/index.js` and `dist/index.d.ts` updated (check `dist/index.d.ts` now declares `renderTemplate` and `ActivationEmailBranding`)

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter auth-server test -- render-template.spec.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add packages/types/index.ts packages/types/dist apps/auth-server/src/email/templates/render-template.spec.ts
git commit -m "feat(types): add ActivationEmailBranding type and renderTemplate helper"
```

---

## Task 2: Data model — `SaApp.activationEmailOverride`

**Files:**
- Modify: `packages/db/schema.prisma:114-147`
- Create: `packages/db/migrations/<timestamp>_add_activation_email_override/migration.sql` (generated)

- [ ] **Step 1: Add the column to the schema**

In `packages/db/schema.prisma`, inside `model SaApp`, add after `webhookSecret String?` (line 137):

```prisma
  webhookUrl    String?
  webhookSecret String?
  /// Complete ActivationEmailBranding JSON override (see @sassy-auth/types).
  /// null, or any field omitted within it, means "use the platform default"
  /// for that field.
  activationEmailOverride Json?
```

- [ ] **Step 2: Generate the migration**

Run (from repo root, requires a running dev database per this repo's existing `db:migrate` script):
`pnpm --filter @sassy-auth/db db:migrate --name add_activation_email_override`

Expected: a new directory `packages/db/migrations/<timestamp>_add_activation_email_override/migration.sql` is created, containing:

```sql
ALTER TABLE "SaApp" ADD COLUMN "activationEmailOverride" JSONB;
```

If the dev database isn't reachable in this environment, hand-create the migration directory instead — copy the exact structure of the most recent migration (`packages/db/migrations/20260914120000_add_app_logo/`) and write the SQL above verbatim, then run `pnpm --filter @sassy-auth/db db:migrate:deploy` to apply it and regenerate the client.

- [ ] **Step 3: Regenerate the Prisma client**

Run: `pnpm --filter @sassy-auth/db build`
Expected: exits 0; `packages/db/generated` now types `SaApp.activationEmailOverride` as `Prisma.JsonValue | null`

- [ ] **Step 4: Commit**

```bash
git add packages/db/schema.prisma packages/db/migrations
git commit -m "feat(db): add SaApp.activationEmailOverride column"
```

---

## Task 3: `EmailService`/`EmailMessage` — per-send `from` override

**Files:**
- Modify: `apps/auth-server/src/email/email.types.ts:1-6`
- Modify: `apps/auth-server/src/email/email.service.ts:14-18`
- Test: `apps/auth-server/src/email/email.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Add to `apps/auth-server/src/email/email.service.spec.ts`, inside the `describe('EmailService', ...)` block, after the existing `'sends via the transport with the configured from...'` test:

```ts
  it('uses msg.from when provided, overriding EMAIL_FROM', async () => {
    const send = jest.fn().mockResolvedValue(undefined);
    process.env.EMAIL_FROM = 'sender@x.co';
    const { service } = await build({ name: 'fake', send });
    const res = await service.send({ to: 'a@b.co', subject: 'S', html: '<p>h</p>', text: 'h', from: 'Vibecast <no-reply@vibecast.io>' });
    expect(res).toEqual({ sent: true });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ from: 'Vibecast <no-reply@vibecast.io>' }));
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter auth-server test -- email.service.spec.ts`
Expected: FAIL — TypeScript error (`from` not assignable to `EmailMessage`) or, if TS is lenient at the test boundary, an assertion failure because `from` came back as `'sender@x.co'` instead of the override

- [ ] **Step 3: Write minimal implementation**

In `apps/auth-server/src/email/email.types.ts`, change `EmailMessage`:

```ts
export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Per-send override; falls back to EmailService's EMAIL_FROM default when absent. */
  from?: string;
}
```

In `apps/auth-server/src/email/email.service.ts`, change line 15:

```ts
    const from = msg.from ?? process.env.EMAIL_FROM ?? 'no-reply@sassy-auth.local';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter auth-server test -- email.service.spec.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/email/email.types.ts apps/auth-server/src/email/email.service.ts apps/auth-server/src/email/email.service.spec.ts
git commit -m "feat(email): allow per-send from override in EmailService"
```

---

## Task 4: `verificationEmail()` — branding, button, computed `from`

**Files:**
- Modify: `apps/auth-server/src/email/templates/verify-email.template.ts`
- Test: `apps/auth-server/src/email/templates/templates.spec.ts:33-40`

- [ ] **Step 1: Write the failing tests**

Replace the single `verificationEmail` test in `apps/auth-server/src/email/templates/templates.spec.ts:33-40` with:

```ts
  it('verificationEmail uses the default subject/message and embeds appName, URL, name, and a button when no branding is given', () => {
    const out = verificationEmail({ firstName: 'Jane', verifyUrl: 'https://x/verify-email?token=abc', appName: 'Vibecast' });
    expect(out.subject).toBe('Verify your Vibecast email address');
    expect(out.html).toContain('https://x/verify-email?token=abc');
    expect(out.html).toContain('Confirm your email address to finish setting up your account:');
    expect(out.html).toContain('<table'); // the system-rendered button
    expect(out.text).toContain('https://x/verify-email?token=abc');
    expect(out.text).toContain('Jane');
    expect(out.from).toBeUndefined();
  });

  it('verificationEmail renders a custom subject/message with placeholders', () => {
    const out = verificationEmail({
      firstName: 'Jane',
      verifyUrl: 'https://x/verify-email?token=abc',
      appName: 'Vibecast',
      branding: { subject: 'Confirm your {{appName}} account, {{firstName}}!', message: 'Welcome to {{appName}}! Click below to confirm {{firstName}}.' },
    });
    expect(out.subject).toBe('Confirm your Vibecast account, Jane!');
    expect(out.html).toContain('Welcome to Vibecast! Click below to confirm Jane.');
    expect(out.text).toContain('Welcome to Vibecast! Click below to confirm Jane.');
  });

  it('verificationEmail computes from from fromName + fromAddress', () => {
    const out = verificationEmail({
      firstName: 'Jane', verifyUrl: 'https://x/verify', appName: 'Vibecast',
      branding: { fromName: 'Vibecast', fromAddress: 'no-reply@vibecast.io' },
    });
    expect(out.from).toBe('Vibecast <no-reply@vibecast.io>');
  });

  it('verificationEmail computes from from fromAddress alone', () => {
    const out = verificationEmail({
      firstName: 'Jane', verifyUrl: 'https://x/verify', appName: 'Vibecast',
      branding: { fromAddress: 'no-reply@vibecast.io' },
    });
    expect(out.from).toBe('no-reply@vibecast.io');
  });

  it('verificationEmail computes from from fromName alone', () => {
    const out = verificationEmail({
      firstName: 'Jane', verifyUrl: 'https://x/verify', appName: 'Vibecast',
      branding: { fromName: 'Vibecast' },
    });
    expect(out.from).toBe('Vibecast');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter auth-server test -- templates.spec.ts`
Expected: FAIL — `verificationEmail` doesn't accept `appName`/`branding`, subject/html don't match new expectations

- [ ] **Step 3: Write minimal implementation**

Replace the full contents of `apps/auth-server/src/email/templates/verify-email.template.ts`:

```ts
import { renderTemplate, type ActivationEmailBranding } from '@sassy-auth/types';
import type { EmailMessageParts } from '../email.types';

const DEFAULT_SUBJECT = 'Verify your {{appName}} email address';
const DEFAULT_MESSAGE = 'Confirm your email address to finish setting up your account:';

/**
 * Bulletproof table-based button — renders correctly in Outlook/Gmail/Apple
 * Mail without relying on border-radius or flex support. Never part of an
 * admin-customizable template (see design §3): the link must always be
 * present and correctly formatted.
 */
function renderButton(url: string): string {
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 24px 0;">` +
    `<tr><td align="center" bgcolor="#2563eb" style="border-radius: 8px;">` +
    `<a href="${url}" target="_blank" style="display: inline-block; padding: 14px 32px; font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; font-size: 16px; font-weight: 600; color: #ffffff; text-decoration: none; border-radius: 8px;">Confirm your email address</a>` +
    `</td></tr></table>`
  );
}

function computeFrom(branding?: ActivationEmailBranding): string | undefined {
  const name = branding?.fromName?.trim();
  const address = branding?.fromAddress?.trim();
  if (name && address) return `${name} <${address}>`;
  return address || name || undefined;
}

export function verificationEmail(args: {
  firstName: string;
  verifyUrl: string;
  appName: string;
  branding?: ActivationEmailBranding;
}): EmailMessageParts & { from?: string } {
  const { firstName, verifyUrl, appName, branding } = args;
  const vars = { firstName, appName, activationUrl: verifyUrl };
  const subject = renderTemplate(branding?.subject?.trim() || DEFAULT_SUBJECT, vars);
  const message = renderTemplate(branding?.message?.trim() || DEFAULT_MESSAGE, vars);
  const from = computeFrom(branding);

  return {
    subject,
    text: `Hi ${firstName},\n\n${message}\n${verifyUrl}\n\nIf you didn't create this account, you can ignore this email.`,
    html:
      `<p>Hi ${firstName},</p><p>${message}</p>${renderButton(verifyUrl)}` +
      `<p style="word-break: break-all;"><a href="${verifyUrl}">${verifyUrl}</a></p>` +
      `<p>If you didn't create this account, you can ignore this email.</p>`,
    ...(from !== undefined && { from }),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter auth-server test -- templates.spec.ts`
Expected: PASS (all `email templates` tests, including the 5 `verificationEmail` cases)

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/email/templates/verify-email.template.ts apps/auth-server/src/email/templates/templates.spec.ts
git commit -m "feat(email): brand verificationEmail with per-app subject/message/from and a CTA button"
```

---

## Task 5: Wire `sendVerificationEmail` to resolve the owning `SaApp`

**Files:**
- Modify: `apps/auth-server/src/auth/auth.config.ts:361-364`
- Test: `apps/auth-server/src/auth/auth.config.spec.ts:260-273`

- [ ] **Step 1: Write the failing test**

Replace the existing `'sendVerificationEmail sends via the emailer with the verify URL'` test at `apps/auth-server/src/auth/auth.config.spec.ts:260-273` with:

```ts
  it('sendVerificationEmail resolves the owning SaApp and brands the email with its name and override', async () => {
    const sendMock = jest.fn().mockResolvedValue({ sent: true });
    jest.doMock('../email/email.singleton', () => ({ getEmailer: () => ({ send: sendMock }) }));
    jest.resetModules();
    const { auth } = await import('./auth.config');
    const { prisma } = require('@sassy-auth/db');
    prisma.saUser.findUnique.mockResolvedValue({
      org: { app: { name: 'Vibecast', activationEmailOverride: { fromName: 'Vibecast', fromAddress: 'no-reply@vibecast.io' } } },
    });
    const options = (auth as unknown as { options: Record<string, unknown> }).options;
    const ev = options['emailVerification'] as {
      sendVerificationEmail: (args: { user: { id: string; email: string; name?: string }; url: string }) => Promise<void>;
    };
    await ev.sendVerificationEmail({ user: { id: 'ba-user-1', email: 'jane@example.com', name: 'Jane Doe' }, url: 'https://x/verify-email?token=abc' });
    expect(prisma.saUser.findUnique).toHaveBeenCalledWith({
      where: { betterAuthUserId: 'ba-user-1' },
      select: { org: { select: { app: { select: { name: true, activationEmailOverride: true } } } } },
    });
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'jane@example.com',
        subject: 'Verify your Vibecast email address',
        from: 'Vibecast <no-reply@vibecast.io>',
        html: expect.stringContaining('https://x/verify-email?token=abc'),
      }),
    );
  });

  it('sendVerificationEmail falls back to "Sassy Auth" and no branding when the SaUser lookup finds nothing', async () => {
    const sendMock = jest.fn().mockResolvedValue({ sent: true });
    jest.doMock('../email/email.singleton', () => ({ getEmailer: () => ({ send: sendMock }) }));
    jest.resetModules();
    const { auth } = await import('./auth.config');
    const { prisma } = require('@sassy-auth/db');
    prisma.saUser.findUnique.mockResolvedValue(null);
    const options = (auth as unknown as { options: Record<string, unknown> }).options;
    const ev = options['emailVerification'] as {
      sendVerificationEmail: (args: { user: { id: string; email: string; name?: string }; url: string }) => Promise<void>;
    };
    await ev.sendVerificationEmail({ user: { id: 'ba-unknown', email: 'jane@example.com', name: 'Jane Doe' }, url: 'https://x/verify-email?token=abc' });
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({ subject: 'Verify your Sassy Auth email address' }));
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter auth-server test -- auth.config.spec.ts`
Expected: FAIL — `prisma.saUser.findUnique` not called with the expected args (current hook never calls it), subject stays the old hardcoded string

- [ ] **Step 3: Write minimal implementation**

In `apps/auth-server/src/auth/auth.config.ts`, replace lines 361-364:

```ts
    sendVerificationEmail: async ({ user, url }: { user: { id: string; email: string; name?: string }; url: string }) => {
      const firstName = (user.name ?? '').trim().split(' ')[0] || 'there';
      const saUser = await prisma.saUser.findUnique({
        where: { betterAuthUserId: user.id },
        select: { org: { select: { app: { select: { name: true, activationEmailOverride: true } } } } },
      });
      const appName = saUser?.org.app.name ?? 'Sassy Auth';
      const branding = (saUser?.org.app.activationEmailOverride ?? undefined) as
        | import('@sassy-auth/types').ActivationEmailBranding
        | undefined;
      await getEmailer().send({ to: user.email, ...verificationEmail({ firstName, verifyUrl: url, appName, branding }) });
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter auth-server test -- auth.config.spec.ts`
Expected: PASS (both new tests, and all other `auth.config` tests still pass — in particular the `afterEmailVerification`/webhook tests that also stub `prisma.saUser.findUnique`, since each sets its own `mockResolvedValue` right before use)

- [ ] **Step 5: Run the full auth-server suite**

Run: `pnpm --filter auth-server test`
Expected: PASS — confirms no other spec's `prisma.saUser.findUnique` mock shape broke

- [ ] **Step 6: Commit**

```bash
git add apps/auth-server/src/auth/auth.config.ts apps/auth-server/src/auth/auth.config.spec.ts
git commit -m "feat(auth): brand activation emails using the signing-up user's SaApp"
```

---

## Task 6: Backend — `activationEmailOverride` on the Apps API

**Files:**
- Modify: `apps/auth-server/src/apps/dto/create-app.dto.ts`
- Modify: `apps/auth-server/src/apps/dto/update-app.dto.ts`
- Modify: `apps/auth-server/src/apps/apps.service.ts`
- Test: `apps/auth-server/src/apps/apps.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

Add to `apps/auth-server/src/apps/apps.service.spec.ts`, after the existing `'updateApp omits logo from update data when DTO omits it'` test (around line 244):

```ts
  it('updateApp sets activationEmailOverride when provided', async () => {
    mockPrisma.saApp.findUnique.mockResolvedValue(appRow);
    const override = { fromName: 'Vibecast', fromAddress: 'no-reply@vibecast.io', subject: 'Confirm your {{appName}} account' };
    mockPrisma.saApp.update.mockResolvedValue({ ...appRow, activationEmailOverride: override });
    const result = await service.updateApp('ba-caller', 'sq_1', { activationEmailOverride: override });
    expect(mockPrisma.saApp.update).toHaveBeenCalledWith({
      where: { publicId: 'sq_1' },
      data: { activationEmailOverride: override },
      include: { defaultOrg: { select: { publicId: true } }, defaultRole: { select: { publicId: true } } },
    });
    expect(result.activationEmailOverride).toEqual(override);
  });

  it('updateApp clears activationEmailOverride when given null', async () => {
    mockPrisma.saApp.findUnique.mockResolvedValue(appRow);
    mockPrisma.saApp.update.mockResolvedValue({ ...appRow, activationEmailOverride: null });
    await service.updateApp('ba-caller', 'sq_1', { activationEmailOverride: null });
    expect(mockPrisma.saApp.update).toHaveBeenCalledWith({
      where: { publicId: 'sq_1' },
      data: { activationEmailOverride: { __prismaJsonNull: true } },
      include: { defaultOrg: { select: { publicId: true } }, defaultRole: { select: { publicId: true } } },
    });
  });

  it('updateApp rejects an activationEmailOverride with a non-string field', async () => {
    mockPrisma.saApp.findUnique.mockResolvedValue(appRow);
    await expect(
      service.updateApp('ba-caller', 'sq_1', { activationEmailOverride: { fromName: 123 as unknown as string } }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mockPrisma.saApp.update).not.toHaveBeenCalled();
  });

  it('getApp/listApps formatting defaults activationEmailOverride to null when absent', async () => {
    mockPrisma.saApp.findUnique.mockResolvedValue({ ...appRow, defaultOrg: null, defaultRole: null });
    const result = await service.getApp('ba-caller', 'sq_1');
    expect(result.activationEmailOverride).toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter auth-server test -- apps.service.spec.ts`
Expected: FAIL — DTO rejects the unknown field (or, since no `@IsOptional`/whitelist is exercised directly by the service test, `formatApp` doesn't include `activationEmailOverride` and the update `data` doesn't include it)

- [ ] **Step 3: Write minimal implementation**

In `apps/auth-server/src/apps/dto/update-app.dto.ts`, add after the `webhookUrl` field (end of class, after line 78):

```ts

  /**
   * Per-app override for the activation email's subject/message/from (see
   * @sassy-auth/types ActivationEmailBranding). Deep-validated in
   * AppsService.assertValidActivationEmailOverride, following the same
   * manual-validation-in-service pattern as passwordPolicyOverride above.
   * null clears the override, reverting every field to the platform default.
   */
  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  activationEmailOverride?: ActivationEmailBranding | null;
```

and add the import at the top:

```ts
import { PasswordPolicy, ActivationEmailBranding } from '@sassy-auth/types';
```

In `apps/auth-server/src/apps/dto/create-app.dto.ts`, no field is added — `activationEmailOverride` is edit-only (an app is always created without branding, then customized), matching how `webhookUrl` was introduced only on `UpdateAppDto`.

In `apps/auth-server/src/apps/apps.service.ts`:

1. Add the import: `import { PasswordPolicy, ActivationEmailBranding } from '@sassy-auth/types';` (merge into the existing `import { PasswordPolicy } from '@sassy-auth/types';` line)
2. Add to `AppRow` type (after `webhookSecret?: string | null;`):
   ```ts
     activationEmailOverride?: unknown;
   ```
3. Add to `formatApp`'s return object (after `hasWebhookSecret: Boolean(a.webhookSecret),`):
   ```ts
     activationEmailOverride: (a.activationEmailOverride ?? null) as ActivationEmailBranding | null,
   ```
4. Add a new validation function, after `assertValidPasswordPolicyOverride` (after line 105):
   ```ts
   /** Every field of an activationEmailOverride is optional, but if present must be a string — mirrors assertValidPasswordPolicyOverride's manual-validation-in-service pattern. */
   function assertValidActivationEmailOverride(override: ActivationEmailBranding): void {
     const fields: Array<keyof ActivationEmailBranding> = ['fromName', 'fromAddress', 'subject', 'message'];
     for (const field of fields) {
       const value = override[field];
       if (value !== undefined && typeof value !== 'string') {
         throw new BadRequestException(`activationEmailOverride.${field} must be a string`);
       }
     }
   }
   ```
5. In `updateApp`, replace the "all fields absent" guard (`apps.service.ts:249-264`) with:
   ```ts
   if (
     dto.name === undefined &&
     dto.url === undefined &&
     dto.logo === undefined &&
     dto.twoFactorTrustDays === undefined &&
     dto.requireTwoFactor === undefined &&
     dto.redirectUris === undefined &&
     dto.defaultOrgId === undefined &&
     dto.defaultRoleId === undefined &&
     dto.passwordPolicyOverride === undefined &&
     dto.webhookUrl === undefined &&
     dto.activationEmailOverride === undefined
   ) {
     throw new BadRequestException(
       'At least one of name, url, logo, twoFactorTrustDays, requireTwoFactor, redirectUris, defaultOrgId, defaultRoleId, passwordPolicyOverride, webhookUrl, or activationEmailOverride must be provided',
     );
   }
   ```
6. In `updateApp`, call the validator alongside the other pre-transaction validations (next to `if (dto.passwordPolicyOverride) assertValidPasswordPolicyOverride(dto.passwordPolicyOverride);`): `if (dto.activationEmailOverride) assertValidActivationEmailOverride(dto.activationEmailOverride);`
7. In `updateApp`'s `tx.saApp.update` `data` object, add after the `webhookUrl` block:
   ```ts
     ...(dto.activationEmailOverride !== undefined && {
       activationEmailOverride: (dto.activationEmailOverride === null
         ? Prisma.JsonNull
         : (dto.activationEmailOverride as unknown as Prisma.InputJsonValue)),
     }),
   ```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter auth-server test -- apps.service.spec.ts`
Expected: PASS (all `AppsService` tests, including the 4 new ones)

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/apps/dto/update-app.dto.ts apps/auth-server/src/apps/apps.service.ts apps/auth-server/src/apps/apps.service.spec.ts
git commit -m "feat(apps): expose activationEmailOverride on the update-app API"
```

---

## Task 7: Admin — types

**Files:**
- Modify: `apps/admin/lib/types.ts:90-134`

- [ ] **Step 1: Add the field to `App` and `UpdateAppPayload`**

In `apps/admin/lib/types.ts`, change the import line at the top from:

```ts
import type { PasswordPolicy } from '@sassy-auth/types'
```

to:

```ts
import type { PasswordPolicy, ActivationEmailBranding } from '@sassy-auth/types'

export type { ActivationEmailBranding }
```

In the `App` interface (after `hasWebhookSecret?: boolean;` at line 110):

```ts
  activationEmailOverride: ActivationEmailBranding | null;
```

In the `UpdateAppPayload` interface (after `webhookUrl?: string | null;` at line 132):

```ts
  activationEmailOverride?: ActivationEmailBranding | null;
```

(`CreateAppPayload` is untouched — matches Task 6's edit-only decision.)

- [ ] **Step 2: Type-check the admin app**

Run: `pnpm --filter admin exec tsc --noEmit`
Expected: exits 0 (no new type errors; `app-edit-drawer.tsx` doesn't reference the new field yet, and `App` requires it, so this step is expected to newly FAIL here if any code constructs an `App` object by hand without it — search first)

Run: `grep -rn "isPlatform: " apps/admin --include=*.ts --include=*.tsx -l`
If any test fixture or mock constructs a full `App` literal, add `activationEmailOverride: null` to it before re-running `tsc --noEmit`.

- [ ] **Step 3: Commit**

```bash
git add apps/admin/lib/types.ts
git commit -m "feat(admin): add activationEmailOverride to the App type"
```

---

## Task 8: Admin — edit drawer UI

**Files:**
- Modify: `apps/admin/components/app-edit-drawer.tsx`
- Modify: `apps/admin/messages/en.json` (apps.fields section, after line 101)
- Modify: `apps/admin/messages/fr.json` (apps.fields section, after line 100)

- [ ] **Step 1: Add i18n keys**

In `apps/admin/messages/en.json`, insert after `"noWebhookSecret": "No secret configured."` (line 101):

```json
      "activationEmail": "Activation email",
      "activationEmailHint": "Customize the email sent when a new sign-up needs to confirm their address. Placeholders {{firstName}} and {{appName}} are available in the subject and message.",
      "activationEmailFromName": "From name",
      "activationEmailFromNamePlaceholder": "e.g. Vibecast",
      "activationEmailFromAddress": "From address",
      "activationEmailFromAddressPlaceholder": "no-reply@yourapp.com",
      "activationEmailFromAddressHint": "Must be on a domain verified with your email provider, or activation emails will silently fail to send.",
      "activationEmailSubject": "Subject",
      "activationEmailSubjectPlaceholder": "Verify your {{appName}} email address",
      "activationEmailMessage": "Message",
      "activationEmailMessagePlaceholder": "Confirm your email address to finish setting up your account:",
      "activationEmailMessageHint": "Shown above the confirmation button, which is always added automatically.",
```

In `apps/admin/messages/fr.json`, insert after `"noWebhookSecret": "Aucun secret configuré."` (matching line ~101):

```json
      "activationEmail": "E-mail d'activation",
      "activationEmailHint": "Personnalisez l'e-mail envoyé lorsqu'une nouvelle inscription doit confirmer son adresse. Les variables {{firstName}} et {{appName}} sont disponibles dans l'objet et le message.",
      "activationEmailFromName": "Nom de l'expéditeur",
      "activationEmailFromNamePlaceholder": "ex. Vibecast",
      "activationEmailFromAddress": "Adresse de l'expéditeur",
      "activationEmailFromAddressPlaceholder": "no-reply@votreapp.com",
      "activationEmailFromAddressHint": "Doit appartenir à un domaine vérifié auprès de votre fournisseur d'e-mail, sinon l'envoi échouera silencieusement.",
      "activationEmailSubject": "Objet",
      "activationEmailSubjectPlaceholder": "Vérifiez votre adresse e-mail {{appName}}",
      "activationEmailMessage": "Message",
      "activationEmailMessagePlaceholder": "Confirmez votre adresse e-mail pour terminer la création de votre compte :",
      "activationEmailMessageHint": "Affiché au-dessus du bouton de confirmation, qui est toujours ajouté automatiquement.",
```

(Verify the exact line numbers with `grep -n "noWebhookSecret" apps/admin/messages/en.json apps/admin/messages/fr.json` before inserting, since earlier edits in this plan don't touch this file.)

- [ ] **Step 2: Add state, dirty-tracking, and patch-building to the drawer**

In `apps/admin/components/app-edit-drawer.tsx`, add state after the `hasWebhookSecret`/`newWebhookSecret`/`rotatingWebhookSecret` block (after line 66):

```ts
  const [activationFromName, setActivationFromName] = React.useState<string>(app.activationEmailOverride?.fromName ?? '')
  const [activationFromAddress, setActivationFromAddress] = React.useState<string>(app.activationEmailOverride?.fromAddress ?? '')
  const [activationSubject, setActivationSubject] = React.useState<string>(app.activationEmailOverride?.subject ?? '')
  const [activationMessage, setActivationMessage] = React.useState<string>(app.activationEmailOverride?.message ?? '')
```

In the `React.useEffect` that resyncs state from `app` (after `setHasWebhookSecret(app.hasWebhookSecret ?? false)` at line 108):

```ts
    setActivationFromName(app.activationEmailOverride?.fromName ?? '')
    setActivationFromAddress(app.activationEmailOverride?.fromAddress ?? '')
    setActivationSubject(app.activationEmailOverride?.subject ?? '')
    setActivationMessage(app.activationEmailOverride?.message ?? '')
```

After the `webhookUrlDirty` line (line 207), add:

```ts
  const activationOverrideBaseline = app.activationEmailOverride ?? { fromName: '', fromAddress: '', subject: '', message: '' }
  const activationDirty =
    activationFromName.trim() !== (activationOverrideBaseline.fromName ?? '') ||
    activationFromAddress.trim() !== (activationOverrideBaseline.fromAddress ?? '') ||
    activationSubject.trim() !== (activationOverrideBaseline.subject ?? '') ||
    activationMessage.trim() !== (activationOverrideBaseline.message ?? '')
```

Change the `dirty` line (line 208) to append `|| activationDirty` before the closing semicolon.

In `handleSubmit`, change the `patch` type declaration (line 221) to add `activationEmailOverride?: import('@/lib/types').ActivationEmailBranding | null` to its object type, and after the `webhookUrlDirty` block (after line 238), add:

```ts
    if (activationDirty) {
      const trimmed = {
        fromName: activationFromName.trim(),
        fromAddress: activationFromAddress.trim(),
        subject: activationSubject.trim(),
        message: activationMessage.trim(),
      }
      const allEmpty = Object.values(trimmed).every((v) => v === '')
      patch.activationEmailOverride = allEmpty
        ? null
        : Object.fromEntries(Object.entries(trimmed).filter(([, v]) => v !== '')) as import('@/lib/types').ActivationEmailBranding
    }
```

- [ ] **Step 3: Add the form section**

In the JSX, after the "Webhook secret" `<div>` block (after line 648, before the `{errorKey && (...)}` block), add:

```tsx
            <div>
              <Label>{t('apps.fields.activationEmail')}</Label>
              <p className="mt-1 text-body-sm text-muted-foreground">
                {t('apps.fields.activationEmailHint')}
              </p>
              <div className="mt-3 space-y-3 rounded border border-[var(--border)] p-3">
                <div>
                  <Label htmlFor="activationFromName">{t('apps.fields.activationEmailFromName')}</Label>
                  <Input
                    id="activationFromName"
                    value={activationFromName}
                    onChange={(e) => setActivationFromName(e.target.value)}
                    placeholder={t('apps.fields.activationEmailFromNamePlaceholder')}
                  />
                </div>
                <div>
                  <Label htmlFor="activationFromAddress">{t('apps.fields.activationEmailFromAddress')}</Label>
                  <Input
                    id="activationFromAddress"
                    type="email"
                    value={activationFromAddress}
                    onChange={(e) => setActivationFromAddress(e.target.value)}
                    placeholder={t('apps.fields.activationEmailFromAddressPlaceholder')}
                  />
                  <p className="mt-1 text-body-sm text-muted-foreground">
                    {t('apps.fields.activationEmailFromAddressHint')}
                  </p>
                </div>
                <div>
                  <Label htmlFor="activationSubject">{t('apps.fields.activationEmailSubject')}</Label>
                  <Input
                    id="activationSubject"
                    value={activationSubject}
                    onChange={(e) => setActivationSubject(e.target.value)}
                    placeholder={t('apps.fields.activationEmailSubjectPlaceholder')}
                  />
                </div>
                <div>
                  <Label htmlFor="activationMessage">{t('apps.fields.activationEmailMessage')}</Label>
                  <Input
                    id="activationMessage"
                    value={activationMessage}
                    onChange={(e) => setActivationMessage(e.target.value)}
                    placeholder={t('apps.fields.activationEmailMessagePlaceholder')}
                  />
                  <p className="mt-1 text-body-sm text-muted-foreground">
                    {t('apps.fields.activationEmailMessageHint')}
                  </p>
                </div>
              </div>
            </div>
```

- [ ] **Step 4: Type-check and lint**

Run: `pnpm --filter admin exec tsc --noEmit`
Expected: exits 0

Run: `pnpm --filter admin lint`
Expected: exits 0

- [ ] **Step 5: Manually verify in the dev server**

Run: `pnpm --filter admin dev`, open the Apps page, edit an app, confirm the new "Activation email" section renders, fields are editable, Save is disabled until a field changes, and saving round-trips the values (re-opening the drawer shows what was saved).

- [ ] **Step 6: Commit**

```bash
git add apps/admin/components/app-edit-drawer.tsx apps/admin/messages/en.json apps/admin/messages/fr.json
git commit -m "feat(admin): add activation email branding fields to the app edit drawer"
```

---

## Task 9: Full-suite verification

- [ ] **Step 1: Run the full auth-server suite**

Run: `pnpm --filter auth-server test`
Expected: PASS, no regressions

- [ ] **Step 2: Run the full admin type-check + lint**

Run: `pnpm --filter admin exec tsc --noEmit && pnpm --filter admin lint`
Expected: PASS

- [ ] **Step 3: Manually send a test activation email end-to-end**

With the dev stack running (`pnpm dev`) and an app configured with an `activationEmailOverride` (from Task 8's manual check), sign up a new user through that app's registration flow and confirm the received email shows the custom subject, custom from, custom message, and a large styled confirmation button whose link matches the one BetterAuth generated.
