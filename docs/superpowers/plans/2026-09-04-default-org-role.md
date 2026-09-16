# Default Org & Default Role for Self-Serve Sign-Up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a `SaApp` designate an existing org and/or role as its default, so self-serve `POST /api/register` auto-joins/auto-assigns instead of always founding a fresh, roleless org — gated behind a new required email-verification step.

**Architecture:** Two new nullable FKs on `SaApp` (`defaultOrgId`, `defaultRoleId`) plus a 4th `UserStatus` value (`unverified`), consumed by `RegistrationService.register()`. Email verification is wired through BetterAuth's built-in `emailVerification` config (stateless signed-JWT token, no new table), triggered explicitly from `RegistrationService` rather than BetterAuth's global `sendOnSignUp` (which would also fire for the seed scripts). Admin console gets two new optional selects on the app-edit drawer and a new status badge; the public `/signup` page conditionally hides the "Company name" field.

**Tech Stack:** NestJS + Prisma (`apps/auth-server`), Next.js admin console (`apps/admin`), BetterAuth 1.6.11, Jest.

**Spec:** `docs/superpowers/specs/2026-09-04-default-org-role-design.md`

---

## Task 1: Schema — `defaultOrgId`, `defaultRoleId`, `unverified` status

**Files:**
- Modify: `packages/db/schema.prisma`

- [ ] **Step 1: Edit the schema**

In `packages/db/schema.prisma`, change the `UserStatus` enum (currently lines 107-111):

```prisma
enum UserStatus {
  active
  pending
  inactive
  unverified
}
```

Add two fields + two back-relations to `SaApp` (currently lines 113-130) — insert after the existing `socialProviders SaSocialProvider[]` line, before the closing `}`:

```prisma
  defaultOrgId    Int?
  defaultOrg      SaOrg?  @relation("AppDefaultOrg", fields: [defaultOrgId], references: [id])
  defaultRoleId   Int?
  defaultRole     SaRole? @relation("AppDefaultRole", fields: [defaultRoleId], references: [id])
```

Add the back-relation to `SaOrg` (currently lines 144-154) — insert after `users SaUser[]`:

```prisma
  defaultForApps SaApp[] @relation("AppDefaultOrg")
```

Add the back-relation to `SaRole` (currently lines 232-243) — insert after `users SaUserRole[]`:

```prisma
  defaultForApps SaApp[] @relation("AppDefaultRole")
```

- [ ] **Step 2: Generate and apply the migration**

Run (requires a running local Postgres per `.env.local`, same as any other schema change in this repo):

```bash
pnpm --filter @sassy-auth/db exec prisma migrate dev --name default_org_role_unverified_status
```

Expected: a new folder `packages/db/migrations/<timestamp>_default_org_role_unverified_status/migration.sql` is created and applied, containing an `ALTER TYPE "UserStatus" ADD VALUE 'unverified'` and `ALTER TABLE "SaApp" ADD COLUMN "defaultOrgId" INTEGER, ADD COLUMN "defaultRoleId" INTEGER` plus two `ADD CONSTRAINT ... FOREIGN KEY` statements (default `ON DELETE RESTRICT`, matching every other FK in this schema — no explicit `onDelete` was written above).

- [ ] **Step 3: Regenerate the Prisma client**

```bash
pnpm --filter @sassy-auth/db db:generate
```

Expected: no errors. `packages/db/generated/prisma` now has `defaultOrgId`/`defaultRoleId` on `SaApp` and `'unverified'` as a valid `UserStatus` literal.

- [ ] **Step 4: Commit**

```bash
git add packages/db/schema.prisma packages/db/migrations
git commit -m "feat(db): add SaApp.defaultOrgId/defaultRoleId and UserStatus.unverified"
```

---

## Task 2: Email template for verification

**Files:**
- Create: `apps/auth-server/src/email/templates/verify-email.template.ts`
- Modify: `apps/auth-server/src/email/templates/templates.spec.ts`

- [ ] **Step 1: Write the failing test**

Add to `apps/auth-server/src/email/templates/templates.spec.ts`:

```ts
import { verifyEmailTemplate } from './verify-email.template';
```

And a new `it` inside the existing `describe('email templates', ...)` block:

```ts
  it('verifyEmailTemplate embeds the verification URL and name in html + text', () => {
    const out = verifyEmailTemplate({ firstName: 'Jane', verifyUrl: 'https://x/verify-email?token=abc' });
    expect(out.subject).toMatch(/verif/i);
    expect(out.html).toContain('https://x/verify-email?token=abc');
    expect(out.text).toContain('https://x/verify-email?token=abc');
    expect(out.text).toContain('Jane');
    expect(out.html).toContain('Jane');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sassy-auth/auth-server test -- templates.spec.ts`
Expected: FAIL — `Cannot find module './verify-email.template'`

- [ ] **Step 3: Write the template**

Create `apps/auth-server/src/email/templates/verify-email.template.ts`:

```ts
import type { EmailMessageParts } from '../email.types';

export function verifyEmailTemplate(args: { firstName: string; verifyUrl: string }): EmailMessageParts {
  const { firstName, verifyUrl } = args;
  return {
    subject: 'Verify your Sassy Auth email address',
    text: `Hi ${firstName},\n\nConfirm your email address to finish setting up your account:\n${verifyUrl}\n\nIf you didn't create this account, you can ignore this email.`,
    html: `<p>Hi ${firstName},</p><p>Confirm your email address to finish setting up your account:</p><p><a href="${verifyUrl}">${verifyUrl}</a></p><p>If you didn't create this account, you can ignore this email.</p>`,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sassy-auth/auth-server test -- templates.spec.ts`
Expected: PASS (4 tests: invitation, password-reset, sign-in-code, verify-email)

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/email/templates/verify-email.template.ts apps/auth-server/src/email/templates/templates.spec.ts
git commit -m "feat(email): add verify-email template"
```

---

## Task 3: BetterAuth `emailVerification` config + FORBIDDEN error code

**Files:**
- Modify: `apps/auth-server/src/auth/auth.config.ts`
- Modify: `apps/auth-server/src/auth/auth.config.spec.ts`

- [ ] **Step 1: Write the failing tests**

Add to `apps/auth-server/src/auth/auth.config.spec.ts`. First, extend the top-of-file `jest.mock('@sassy-auth/db', ...)` (currently `prisma: {}`) so it supports the new `afterEmailVerification` hook's write:

```ts
jest.mock('@sassy-auth/db', () => ({
  prisma: { saUser: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) } },
}));
```

Then add a new `describe` block at the end of the file:

```ts
describe('auth.config — emailVerification', () => {
  it('disables auto sign-in after verification, consistent with autoSignIn: false', async () => {
    const { auth } = await import('./auth.config');
    const options = (auth as unknown as { options: Record<string, unknown> }).options;
    const ev = options['emailVerification'] as Record<string, unknown>;
    expect(ev['autoSignInAfterVerification']).toBe(false);
  });

  it('sendVerificationEmail sends via the emailer with the verify URL', async () => {
    const sendMock = jest.fn().mockResolvedValue({ sent: true });
    jest.doMock('../email/email.singleton', () => ({ getEmailer: () => ({ send: sendMock }) }));
    jest.resetModules();
    const { auth } = await import('./auth.config');
    const options = (auth as unknown as { options: Record<string, unknown> }).options;
    const ev = options['emailVerification'] as {
      sendVerificationEmail: (args: { user: { email: string; name?: string }; url: string }) => Promise<void>;
    };
    await ev.sendVerificationEmail({ user: { email: 'jane@example.com', name: 'Jane Doe' }, url: 'https://x/verify-email?token=abc' });
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'jane@example.com', html: expect.stringContaining('https://x/verify-email?token=abc') }),
    );
  });

  it('afterEmailVerification flips a matching unverified SaUser to active', async () => {
    const { auth } = await import('./auth.config');
    const { prisma } = require('@sassy-auth/db');
    const options = (auth as unknown as { options: Record<string, unknown> }).options;
    const ev = options['emailVerification'] as { afterEmailVerification: (u: { id: string }) => Promise<void> };
    await ev.afterEmailVerification({ id: 'ba-user-1' });
    expect(prisma.saUser.updateMany).toHaveBeenCalledWith({
      where: { betterAuthUserId: 'ba-user-1', status: 'unverified' },
      data: { status: 'active' },
    });
  });
});

describe('auth.config — session gate FORBIDDEN code', () => {
  it('the FORBIDDEN throw distinguishes unverified from other inactive statuses', async () => {
    // evaluateSessionGate itself is unit-tested in session-gate.spec.ts; this
    // just proves the throw site reads gate.status into the error body.
    const src = require('fs').readFileSync(require.resolve('./auth.config.ts'), 'utf8');
    expect(src).toMatch(/code:\s*gate\.status === 'unverified' \? 'ACCOUNT_UNVERIFIED' : 'ACCOUNT_INACTIVE'/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @sassy-auth/auth-server test -- auth.config.spec.ts`
Expected: FAIL — `options['emailVerification']` is `undefined`, and the FORBIDDEN-code source-match fails.

- [ ] **Step 3: Add the `emailVerification` config and the error code**

In `apps/auth-server/src/auth/auth.config.ts`, add an import near the other template import (after line 5, `import { passwordResetEmail } ...`):

```ts
import { verifyEmailTemplate } from '../email/templates/verify-email.template';
```

Change the FORBIDDEN throw inside `databaseHooks.session.create.before` (lines 142-144) from:

```ts
            throw new APIError('FORBIDDEN', {
              message: 'This account is not active.',
            });
```

to:

```ts
            throw new APIError('FORBIDDEN', {
              message: 'This account is not active.',
              code: gate.status === 'unverified' ? 'ACCOUNT_UNVERIFIED' : 'ACCOUNT_INACTIVE',
            });
```

Add the `emailVerification` block to the `betterAuth({...})` config object, immediately after the closing `},` of `emailAndPassword` (after line 298, before the `// Social providers are built from env...` comment on line 299):

```ts
  emailVerification: {
    sendVerificationEmail: async ({ user, url }: { user: { email: string; name?: string }; url: string }) => {
      const firstName = (user.name ?? '').trim().split(' ')[0] || 'there';
      await getEmailer().send({ to: user.email, ...verifyEmailTemplate({ firstName, verifyUrl: url }) });
    },
    afterEmailVerification: async (updatedUser: { id: string }) => {
      // No-op for any status other than 'unverified' — a 'pending' user
      // (invitation, no credential) or an already-'active' user verifying an
      // email through some future path must not be silently promoted.
      await prisma.saUser.updateMany({
        where: { betterAuthUserId: updatedUser.id, status: 'unverified' },
        data: { status: 'active' },
      });
    },
    autoSignInAfterVerification: false, // consistent with emailAndPassword.autoSignIn: false above
  },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @sassy-auth/auth-server test -- auth.config.spec.ts`
Expected: PASS

- [ ] **Step 5: Run the full auth-server test suite to check for regressions**

Run: `pnpm --filter @sassy-auth/auth-server test`
Expected: PASS (no other spec references the FORBIDDEN body shape or `options.emailVerification`)

- [ ] **Step 6: Commit**

```bash
git add apps/auth-server/src/auth/auth.config.ts apps/auth-server/src/auth/auth.config.spec.ts
git commit -m "feat(auth): wire BetterAuth emailVerification + distinguish unverified in session-gate 403"
```

---

## Task 4: `RegisterDto.companyName` becomes optional

**Files:**
- Modify: `apps/auth-server/src/registration/register.dto.ts`

- [ ] **Step 1: Edit the DTO**

In `apps/auth-server/src/registration/register.dto.ts`, change:

```ts
  @IsString() @MinLength(1) companyName!: string;
```

to:

```ts
  @IsString() @IsOptional() @MinLength(1) companyName?: string;
```

Add `IsOptional` to the existing `class-validator` import at the top:

```ts
import { IsEmail, IsOptional, IsString, Matches, MinLength } from 'class-validator';
```

- [ ] **Step 2: Commit**

(No test change here — `RegistrationService`'s conditional requirement is covered by Task 5's tests.)

```bash
git add apps/auth-server/src/registration/register.dto.ts
git commit -m "feat(register): make companyName optional (required only for apps with no defaultOrgId)"
```

---

## Task 5: `RegistrationService` — default org, default role, unverified status, verification email, `hasDefaultOrg`

**Files:**
- Modify: `apps/auth-server/src/registration/registration.service.ts`
- Modify: `apps/auth-server/src/registration/registration.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

Add to the mock setup at the top of `apps/auth-server/src/registration/registration.service.spec.ts`: extend the `@sassy-auth/db` mock to include `saUserRole.create` and `saOrg.findUnique`, and extend the `auth.config` mock to include `sendVerificationEmail`.

```ts
jest.mock('@sassy-auth/db', () => ({
  prisma: {
    saApp: { findUnique: jest.fn() },
    saOrg: { create: jest.fn(), update: jest.fn(), findUnique: jest.fn() },
    saUser: { create: jest.fn() },
    saUserRole: { create: jest.fn() },
    user: { delete: jest.fn(), findUnique: jest.fn() },
    $transaction: jest.fn(),
  },
}));

jest.mock('../auth/auth.config', () => ({
  auth: {
    api: {
      signUpEmail: jest.fn(),
      sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
    },
  },
}));
```

Update the `const mockPrisma = ...` cast and add `const mockSendVerificationEmail = require('../auth/auth.config').auth.api.sendVerificationEmail as jest.Mock;` next to the existing `mockSignUpEmail` line.

Update the existing happy-path test's `saUser.create` assertion (status changed from `'active'` to `'unverified'`) — change:

```ts
      expect(mockPrisma.saUser.create).toHaveBeenCalledWith({
        data: {
          publicId: baUserId.slice(0, 12),
          betterAuthUserId: baUserId,
          orgId: finalOrgRow.id,
          firstName: baseDto.firstName,
          lastName: baseDto.lastName,
          status: 'active',
        },
      });
```

to:

```ts
      expect(mockPrisma.saUser.create).toHaveBeenCalledWith({
        data: {
          publicId: baUserId.slice(0, 12),
          betterAuthUserId: baUserId,
          orgId: finalOrgRow.id,
          firstName: baseDto.firstName,
          lastName: baseDto.lastName,
          status: 'unverified',
        },
      });
      expect(mockSendVerificationEmail).toHaveBeenCalledWith({
        body: { email: baseDto.email, callbackURL: expect.stringContaining('/signup/verified') },
      });
```

Add new `describe` blocks after the existing `describe('register', ...)` block:

```ts
  describe('register — app with defaultOrgId', () => {
    const appWithDefaultOrg = { ...appRow, defaultOrgId: 99, defaultRoleId: null };
    const defaultOrgRow = { id: 99, publicId: 'sq_99', name: 'Citadel', appId: 1, isPlatform: false };

    it('joins the default org and ignores companyName, without creating a new org', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue(appWithDefaultOrg);
      mockPrisma.saOrg.findUnique.mockResolvedValue(defaultOrgRow);
      mockSignUpEmail.mockResolvedValue({ token: 'tok', user: { id: baUserId, email: baseDto.email } });
      mockPrisma.$transaction.mockImplementation(async (cb: (tx: typeof mockPrisma) => unknown) => cb(mockPrisma));
      mockPrisma.saUser.create.mockResolvedValue({ id: 1, publicId: baUserId.slice(0, 12) });

      const result = await service.register({ ...baseDto, companyName: undefined });

      expect(mockPrisma.saOrg.create).not.toHaveBeenCalled();
      expect(mockPrisma.saUser.create).toHaveBeenCalledWith({
        data: {
          publicId: baUserId.slice(0, 12),
          betterAuthUserId: baUserId,
          orgId: defaultOrgRow.id,
          firstName: baseDto.firstName,
          lastName: baseDto.lastName,
          status: 'unverified',
        },
      });
      expect(result).toEqual({ ok: true, orgPublicId: defaultOrgRow.publicId });
    });

    it('throws BadRequestException when companyName is missing and the app has no defaultOrgId', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue(appRow); // no defaultOrgId
      mockSignUpEmail.mockResolvedValue({ token: 'tok', user: { id: baUserId, email: baseDto.email } });

      await expect(service.register({ ...baseDto, companyName: undefined })).rejects.toThrow(
        /companyName is required/,
      );
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('register — app with defaultRoleId', () => {
    it('assigns the default role in the same transaction, for a founder-path signup too', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue({ ...appRow, defaultOrgId: null, defaultRoleId: 7 });
      mockSignUpEmail.mockResolvedValue({ token: 'tok', user: { id: baUserId, email: baseDto.email } });
      mockPrisma.$transaction.mockImplementation(async (cb: (tx: typeof mockPrisma) => unknown) => cb(mockPrisma));
      mockPrisma.saOrg.create.mockResolvedValue(draftOrgRow);
      mockPrisma.saOrg.update.mockResolvedValue(finalOrgRow);
      mockPrisma.saUser.create.mockResolvedValue({ id: 1, publicId: baUserId.slice(0, 12) });

      await service.register(baseDto);

      expect(mockPrisma.saUserRole.create).toHaveBeenCalledWith({ data: { userId: 1, roleId: 7 } });
    });

    it('does not assign a role when defaultRoleId is not set', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue(appRow);
      mockSignUpEmail.mockResolvedValue({ token: 'tok', user: { id: baUserId, email: baseDto.email } });
      mockPrisma.$transaction.mockImplementation(async (cb: (tx: typeof mockPrisma) => unknown) => cb(mockPrisma));
      mockPrisma.saOrg.create.mockResolvedValue(draftOrgRow);
      mockPrisma.saOrg.update.mockResolvedValue(finalOrgRow);
      mockPrisma.saUser.create.mockResolvedValue({ id: 1, publicId: baUserId.slice(0, 12) });

      await service.register(baseDto);

      expect(mockPrisma.saUserRole.create).not.toHaveBeenCalled();
    });
  });

  describe('getAppName — hasDefaultOrg', () => {
    it('reports hasDefaultOrg: true when the app has a defaultOrgId', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue({ name: 'MyApp', defaultOrgId: 99 });
      await expect(service.getAppName('sq_1')).resolves.toEqual({ name: 'MyApp', hasDefaultOrg: true });
    });

    it('reports hasDefaultOrg: false when the app has no defaultOrgId', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue({ name: 'MyApp', defaultOrgId: null });
      await expect(service.getAppName('sq_1')).resolves.toEqual({ name: 'MyApp', hasDefaultOrg: false });
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @sassy-auth/auth-server test -- registration.service.spec.ts`
Expected: FAIL — new describe blocks fail (`defaultOrgId`/`hasDefaultOrg` not handled yet), and the happy-path test fails on `status: 'active'` vs `'unverified'` and the missing `sendVerificationEmail` call.

- [ ] **Step 3: Rewrite `registration.service.ts`**

Replace the full content of `apps/auth-server/src/registration/registration.service.ts` with:

```ts
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '@sassy-auth/db';
import { auth } from '../auth/auth.config';
import { SqidService } from '../common/sqid/sqid.service';
import { generatePendingPublicId } from '../common/pending-public-id';
import { RegisterDto } from './register.dto';

/**
 * BetterAuth (v1.6.x) throws an APIError instance when sign-up fails.
 * For a duplicate email (without requireEmailVerification), the error has:
 *   status: 'UNPROCESSABLE_ENTITY' (string) and statusCode: 422 (number)
 *   body.code: 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL'
 *
 * We detect it by checking the string status field rather than instanceof,
 * since the APIError class may not be easily importable in all environments.
 */
function isDuplicateEmailError(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    'status' in e &&
    (e as { status?: string }).status === 'UNPROCESSABLE_ENTITY'
  );
}

@Injectable()
export class RegistrationService {
  constructor(private readonly sqids: SqidService) {}

  async register(dto: RegisterDto): Promise<{ ok: true; orgPublicId: string }> {
    // 1. Resolve the app — 404 if unknown
    const app = await prisma.saApp.findUnique({ where: { publicId: dto.appPublicId } });
    if (!app) throw new NotFoundException('App not found');

    // An app with a defaultOrgId places every self-serve signup into that
    // existing org — companyName is irrelevant and never read in that case.
    // Otherwise companyName is required to found a brand-new org, same as
    // before this feature existed.
    let defaultOrg: { id: number; publicId: string } | null = null;
    if (app.defaultOrgId) {
      // Guaranteed to exist by the FK (Restrict on delete) — no defensive
      // null-check needed beyond satisfying the type checker.
      defaultOrg = await prisma.saOrg.findUnique({
        where: { id: app.defaultOrgId },
        select: { id: true, publicId: true },
      });
    } else if (!dto.companyName?.trim()) {
      throw new BadRequestException('companyName is required');
    }

    // 2. Create the BetterAuth credential account (user row + scrypt-hashed password)
    let baUserId: string;
    try {
      const signUp = await auth.api.signUpEmail({
        body: { email: dto.email, password: dto.password, name: `${dto.firstName} ${dto.lastName}`.trim() },
      });
      baUserId = signUp.user.id;
    } catch (e: unknown) {
      if (isDuplicateEmailError(e)) {
        throw new ConflictException('email already registered');
      }
      throw e;
    }

    // `emailAndPassword.autoSignIn` is disabled (see auth.config.ts — a session
    // at sign-up can never pass the session-create gate). A side effect of that
    // flag is that BetterAuth no longer throws on a duplicate email: to avoid
    // leaking which addresses are registered, it returns a synthetic user whose
    // id was never written to the database. Taking that id at face value would
    // point an SaUser at a BetterAuth user that does not exist. The catch above
    // still handles the throwing shape, so both paths end in the same 409.
    const persisted = await prisma.user.findUnique({ where: { id: baUserId }, select: { id: true } });
    if (!persisted) {
      throw new ConflictException('email already registered');
    }

    // 3. Atomically create/resolve the org, create the saUser (always
    // 'unverified' — see auth.config.ts's emailVerification block), and
    // assign the app's default role if one is set.
    try {
      type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
      const org = await prisma.$transaction(async (tx: Tx) => {
        let targetOrg: { id: number; publicId: string };
        if (defaultOrg) {
          targetOrg = defaultOrg;
        } else {
          const draft = await tx.saOrg.create({
            data: { publicId: generatePendingPublicId(), name: dto.companyName, appId: app.id, isPlatform: false },
          });
          targetOrg = await tx.saOrg.update({
            where: { id: draft.id },
            data: { publicId: this.sqids.encode(draft.id) },
          });
        }
        const createdSaUser = await tx.saUser.create({
          data: {
            publicId: baUserId.slice(0, 12),
            betterAuthUserId: baUserId,
            orgId: targetOrg.id,
            firstName: dto.firstName,
            lastName: dto.lastName,
            status: 'unverified',
          },
        });
        if (app.defaultRoleId) {
          await tx.saUserRole.create({ data: { userId: createdSaUser.id, roleId: app.defaultRoleId } });
        }
        return targetOrg;
      });

      const adminUrl = process.env.ADMIN_URL ?? 'http://localhost:3001';
      await auth.api.sendVerificationEmail({
        body: { email: dto.email, callbackURL: `${adminUrl}/signup/verified` },
      });

      return { ok: true as const, orgPublicId: org.publicId };
    } catch (e: unknown) {
      // Compensation: delete the BetterAuth user so the email can be re-used
      await prisma.user.delete({ where: { id: baUserId } }).catch(() => {
        // Swallow — we still re-throw the original error below
      });
      throw e;
    }
  }

  async getAppName(appPublicId: string): Promise<{ name: string; hasDefaultOrg: boolean }> {
    if (!appPublicId) throw new NotFoundException('App not found');
    const app = await prisma.saApp.findUnique({
      where: { publicId: appPublicId },
      select: { name: true, defaultOrgId: true },
    });
    if (!app) throw new NotFoundException('App not found');
    return { name: app.name, hasDefaultOrg: app.defaultOrgId !== null };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @sassy-auth/auth-server test -- registration.service.spec.ts`
Expected: PASS (all describe blocks, including the pre-existing ones)

- [ ] **Step 5: Run the full auth-server test suite**

Run: `pnpm --filter @sassy-auth/auth-server test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/auth-server/src/registration/registration.service.ts apps/auth-server/src/registration/registration.service.spec.ts
git commit -m "feat(register): join app default org, assign default role, require email verification"
```

---

## Task 6: `AppsService` — expose and validate `defaultOrgId`/`defaultRoleId`

**Files:**
- Modify: `apps/auth-server/src/apps/dto/update-app.dto.ts`
- Modify: `apps/auth-server/src/apps/apps.service.ts`
- Modify: `apps/auth-server/src/apps/apps.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

Add to the `jest.mock('@sassy-auth/db', ...)` block in `apps/auth-server/src/apps/apps.service.spec.ts`: add `saOrg: { findUnique: jest.fn() }` and `saRole: { findUnique: jest.fn() }` to the mocked `prisma`, and to the `mockPrisma` type cast.

Add new tests inside the existing `describe('updateApp', ...)` block (find it by searching the file for `updateApp` — mirror the existing 2FA-field test style):

```ts
  it('sets defaultOrgId when the org belongs to this app', async () => {
    mockPrisma.saApp.findUnique.mockResolvedValue(appRow);
    mockPrisma.saOrg.findUnique.mockResolvedValue({ id: 50, appId: appRow.id });
    mockPrisma.saApp.update.mockResolvedValue({ ...appRow, defaultOrgId: 50 });
    const result = await service.updateApp('ba-caller', 'sq_1', { defaultOrgId: 'org_pub_50' });
    expect(mockPrisma.saApp.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ defaultOrgId: 50 }) }),
    );
    expect(result.defaultOrgId).toBe('org_pub_50');
  });

  it('rejects defaultOrgId when the org belongs to a different app', async () => {
    mockPrisma.saApp.findUnique.mockResolvedValue(appRow);
    mockPrisma.saOrg.findUnique.mockResolvedValue({ id: 50, appId: 999 });
    await expect(
      service.updateApp('ba-caller', 'sq_1', { defaultOrgId: 'org_pub_50' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mockPrisma.saApp.update).not.toHaveBeenCalled();
  });

  it('rejects defaultOrgId that does not exist', async () => {
    mockPrisma.saApp.findUnique.mockResolvedValue(appRow);
    mockPrisma.saOrg.findUnique.mockResolvedValue(null);
    await expect(
      service.updateApp('ba-caller', 'sq_1', { defaultOrgId: 'nope' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('clears defaultOrgId when explicitly set to null', async () => {
    mockPrisma.saApp.findUnique.mockResolvedValue(appRow);
    mockPrisma.saApp.update.mockResolvedValue({ ...appRow, defaultOrgId: null });
    await service.updateApp('ba-caller', 'sq_1', { defaultOrgId: null });
    expect(mockPrisma.saOrg.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.saApp.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ defaultOrgId: null }) }),
    );
  });

  it('sets defaultRoleId when the role belongs to this app', async () => {
    mockPrisma.saApp.findUnique.mockResolvedValue(appRow);
    mockPrisma.saRole.findUnique.mockResolvedValue({ id: 7, appId: appRow.id });
    mockPrisma.saApp.update.mockResolvedValue({ ...appRow, defaultRoleId: 7 });
    const result = await service.updateApp('ba-caller', 'sq_1', { defaultRoleId: 'role_pub_7' });
    expect(mockPrisma.saApp.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ defaultRoleId: 7 }) }),
    );
    expect(result.defaultRoleId).toBe('role_pub_7');
  });

  it('rejects defaultRoleId when the role belongs to a different app', async () => {
    mockPrisma.saApp.findUnique.mockResolvedValue(appRow);
    mockPrisma.saRole.findUnique.mockResolvedValue({ id: 7, appId: 999 });
    await expect(
      service.updateApp('ba-caller', 'sq_1', { defaultRoleId: 'role_pub_7' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
```

Note: `appRow`'s public id in this spec file is `'sq_1'` and its numeric `id` is `1` — the sqid fake maps `sq_1` → `1` — so `org_pub_50`/`role_pub_7` above are just opaque public-id strings resolved via `prisma.saOrg.findUnique`/`prisma.saRole.findUnique` directly (not sqid-decoded), matching how `resolveRoleIdsForApp` looks roles up by `publicId` elsewhere in this codebase.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @sassy-auth/auth-server test -- apps.service.spec.ts`
Expected: FAIL — `UpdateAppDto` has no `defaultOrgId`/`defaultRoleId`, `updateApp` ignores them.

- [ ] **Step 3: Extend the DTO**

In `apps/auth-server/src/apps/dto/update-app.dto.ts`, add after the `requireTwoFactor` field:

```ts
  /**
   * publicId of an existing org under this app to auto-join self-serve
   * sign-ups into. Must belong to the same app — validated in AppsService
   * (not expressible as a schema-level FK constraint). `null` clears it.
   */
  @IsOptional() @IsString() defaultOrgId?: string | null;

  /**
   * publicId of an existing role under this app to auto-assign to self-serve
   * sign-ups. Must belong to the same app — validated in AppsService.
   * `null` clears it.
   */
  @IsOptional() @IsString() defaultRoleId?: string | null;
```

(`IsString` is already imported in this file.)

- [ ] **Step 4: Update `apps.service.ts`**

Add a resolver helper near the top of `apps/auth-server/src/apps/apps.service.ts`, after `isPrismaCode`:

```ts
async function resolveDefaultOrgId(appId: number, orgPublicId: string | null | undefined): Promise<number | null | undefined> {
  if (orgPublicId === undefined) return undefined;
  if (orgPublicId === null) return null;
  const org = await prisma.saOrg.findUnique({ where: { publicId: orgPublicId }, select: { id: true, appId: true } });
  if (!org) throw new NotFoundException('Default org not found');
  if (org.appId !== appId) throw new BadRequestException('Default org must belong to this app');
  return org.id;
}

async function resolveDefaultRoleId(appId: number, rolePublicId: string | null | undefined): Promise<number | null | undefined> {
  if (rolePublicId === undefined) return undefined;
  if (rolePublicId === null) return null;
  const role = await prisma.saRole.findUnique({ where: { publicId: rolePublicId }, select: { id: true, appId: true } });
  if (!role) throw new NotFoundException('Default role not found');
  if (role.appId !== appId) throw new BadRequestException('Default role must belong to this app');
  return role.id;
}
```

Update `formatApp` to include the new fields — change:

```ts
function formatApp(a: AppRow) {
  return {
    publicId: a.publicId, name: a.name, url: a.url, isPlatform: a.isPlatform,
    twoFactorTrustDays: a.twoFactorTrustDays ?? null,
    requireTwoFactor: a.requireTwoFactor,
    redirectUris: (a.redirectUris ?? []).map((r) => ({ uri: r.uri, kind: r.kind })),
    isConfidential: Boolean(a.clientSecretHash),
    clientSecretUpdatedAt: a.clientSecretUpdatedAt ? a.clientSecretUpdatedAt.toISOString() : null,
  };
}
```

to (add two lines, and thread the public ids through `AppRow`'s type):

```ts
function formatApp(a: AppRow) {
  return {
    publicId: a.publicId, name: a.name, url: a.url, isPlatform: a.isPlatform,
    twoFactorTrustDays: a.twoFactorTrustDays ?? null,
    requireTwoFactor: a.requireTwoFactor,
    redirectUris: (a.redirectUris ?? []).map((r) => ({ uri: r.uri, kind: r.kind })),
    isConfidential: Boolean(a.clientSecretHash),
    clientSecretUpdatedAt: a.clientSecretUpdatedAt ? a.clientSecretUpdatedAt.toISOString() : null,
    defaultOrgId: a.defaultOrg?.publicId ?? null,
    defaultRoleId: a.defaultRole?.publicId ?? null,
  };
}
```

Update the `AppRow` type above `formatApp` to add:

```ts
  defaultOrg?: { publicId: string } | null;
  defaultRole?: { publicId: string } | null;
```

Update every `prisma.saApp.findUnique`/`findMany` call in this file that feeds `formatApp` to `include`/select the two relations. `listApps` and `getApp` both use `include: { redirectUris: true }` — change both to:

```ts
      include: { redirectUris: true, defaultOrg: { select: { publicId: true } }, defaultRole: { select: { publicId: true } } },
```

(there are three occurrences: `listApps`'s `findMany`, `getApp`'s `findUnique`, and `updateApp`'s pre-fetch `findUnique` — update all three; `createApp`'s post-create `formatApp({ ...created, redirectUris: ... })` call needs `defaultOrgId: null, defaultRoleId: null` merged in too since a brand-new app never has these set).

Update `updateApp`'s "at least one field" guard — change:

```ts
  async updateApp(callerBaId: string, publicId: string, dto: UpdateAppDto) {
    if (
      dto.name === undefined &&
      dto.url === undefined &&
      dto.twoFactorTrustDays === undefined &&
      dto.requireTwoFactor === undefined &&
      dto.redirectUris === undefined
    ) {
      throw new BadRequestException(
        'At least one of name, url, twoFactorTrustDays, requireTwoFactor, or redirectUris must be provided',
      );
    }
```

to:

```ts
  async updateApp(callerBaId: string, publicId: string, dto: UpdateAppDto) {
    if (
      dto.name === undefined &&
      dto.url === undefined &&
      dto.twoFactorTrustDays === undefined &&
      dto.requireTwoFactor === undefined &&
      dto.redirectUris === undefined &&
      dto.defaultOrgId === undefined &&
      dto.defaultRoleId === undefined
    ) {
      throw new BadRequestException(
        'At least one of name, url, twoFactorTrustDays, requireTwoFactor, redirectUris, defaultOrgId, or defaultRoleId must be provided',
      );
    }
```

Resolve and write the two fields inside the transaction. Change the `tx.saApp.update({...})` call inside `updateApp`'s transaction from:

```ts
        const updatedApp = await tx.saApp.update({
          where: { publicId },
          data: {
            ...(dto.name !== undefined && { name: dto.name }),
            ...(dto.url !== undefined && { url: dto.url }),
            ...(dto.twoFactorTrustDays !== undefined && {
              twoFactorTrustDays: dto.twoFactorTrustDays,
            }),
            ...(dto.requireTwoFactor !== undefined && {
              requireTwoFactor: dto.requireTwoFactor,
            }),
          },
        });
```

to:

```ts
        const updatedApp = await tx.saApp.update({
          where: { publicId },
          data: {
            ...(dto.name !== undefined && { name: dto.name }),
            ...(dto.url !== undefined && { url: dto.url }),
            ...(dto.twoFactorTrustDays !== undefined && {
              twoFactorTrustDays: dto.twoFactorTrustDays,
            }),
            ...(dto.requireTwoFactor !== undefined && {
              requireTwoFactor: dto.requireTwoFactor,
            }),
            ...(resolvedDefaultOrgId !== undefined && { defaultOrgId: resolvedDefaultOrgId }),
            ...(resolvedDefaultRoleId !== undefined && { defaultRoleId: resolvedDefaultRoleId }),
          },
          include: { defaultOrg: { select: { publicId: true } }, defaultRole: { select: { publicId: true } } },
        });
```

Resolve `resolvedDefaultOrgId`/`resolvedDefaultRoleId` **before** the transaction starts (validation must happen before any write; `existing` is already fetched above the transaction in `updateApp`), by inserting this right after `if (dto.redirectUris) assertValidRedirectUris(dto.redirectUris);`:

```ts
    const resolvedDefaultOrgId = await resolveDefaultOrgId(existing.id, dto.defaultOrgId);
    const resolvedDefaultRoleId = await resolveDefaultRoleId(existing.id, dto.defaultRoleId);
```

Finally, update the `return formatApp({ ...updated, redirectUris: ... })` line at the end of `updateApp` — `updated` now already carries `defaultOrg`/`defaultRole` from the `include` above, so no change needed there; but the `catch` block for `createApp` needs its `formatApp({ ...created, redirectUris: dto.redirectUris ?? [] })` call updated to `formatApp({ ...created, redirectUris: dto.redirectUris ?? [], defaultOrg: null, defaultRole: null })`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @sassy-auth/auth-server test -- apps.service.spec.ts`
Expected: PASS

- [ ] **Step 6: Run the full auth-server test suite**

Run: `pnpm --filter @sassy-auth/auth-server test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/auth-server/src/apps/dto/update-app.dto.ts apps/auth-server/src/apps/apps.service.ts apps/auth-server/src/apps/apps.service.spec.ts
git commit -m "feat(apps): let updateApp set/clear defaultOrgId and defaultRoleId, same-app validated"
```

---

## Task 7: Better delete-error messages when an org/role is an app's default

**Files:**
- Modify: `apps/auth-server/src/orgs/orgs.service.ts`
- Modify: `apps/auth-server/src/orgs/orgs.service.spec.ts`
- Modify: `apps/auth-server/src/roles/roles.service.ts`
- Modify: `apps/auth-server/src/roles/roles.service.spec.ts`

- [ ] **Step 1: Write the failing test for orgs**

Add to `apps/auth-server/src/orgs/orgs.service.spec.ts`, inside the `describe('deleteOrg', ...)` block (add `saApp: { findFirst: jest.fn() }` to the mocked prisma first):

```ts
    it('reports the app name when the org is that app\'s default (not "has dependent users")', async () => {
      mockPrisma.saOrg.findUnique.mockResolvedValue({ id: 5, publicId: 'org5', isPlatform: false });
      const p2003 = Object.assign(new Error('FK violation'), { code: 'P2003' });
      mockPrisma.saOrg.delete.mockRejectedValue(p2003);
      mockPrisma.saApp.findFirst.mockResolvedValue({ name: 'Resource Server' });
      await expect(service.deleteOrg('ba-caller', 'org5')).rejects.toThrow(
        /default org for app "Resource Server"/,
      );
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sassy-auth/auth-server test -- orgs.service.spec.ts`
Expected: FAIL — current message is "Org has dependent users" regardless of cause.

- [ ] **Step 3: Update `orgs.service.ts`**

Change `deleteOrg`'s catch block from:

```ts
    try {
      await prisma.saOrg.delete({ where: { publicId } });
      this.logger.getWinstonLogger().info('Org deleted', { context: 'OrgsService', orgId: publicId });
    } catch (e: unknown) {
      if (isPrismaCode(e, 'P2003')) {
        throw new ConflictException('Org has dependent users');
      }
      throw e;
    }
```

to:

```ts
    try {
      await prisma.saOrg.delete({ where: { publicId } });
      this.logger.getWinstonLogger().info('Org deleted', { context: 'OrgsService', orgId: publicId });
    } catch (e: unknown) {
      if (isPrismaCode(e, 'P2003')) {
        const defaultForApp = await prisma.saApp.findFirst({
          where: { defaultOrgId: existing.id },
          select: { name: true },
        });
        if (defaultForApp) {
          throw new ConflictException(`Org is the default org for app "${defaultForApp.name}"`);
        }
        throw new ConflictException('Org has dependent users');
      }
      throw e;
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sassy-auth/auth-server test -- orgs.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Write the failing test for roles**

Add to `apps/auth-server/src/roles/roles.service.spec.ts`, inside the `describe('deleteRole', ...)` block (add `saApp: { findFirst: jest.fn() }` to the mocked prisma first):

```ts
    it('reports the app name when the role is that app\'s default (not "assigned to N users")', async () => {
      mockPrisma.saRole.findUnique.mockResolvedValue({ id: 7, publicId: 'role7' });
      const p2003 = Object.assign(new Error('FK violation'), { code: 'P2003' });
      mockPrisma.$transaction.mockRejectedValue(p2003);
      mockPrisma.saUserRole.count.mockResolvedValue(0);
      mockPrisma.saApp.findFirst.mockResolvedValue({ name: 'Resource Server' });
      await expect(service.deleteRole('ba-caller', 'role7')).rejects.toThrow(
        /default role for app "Resource Server"/,
      );
    });
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm --filter @sassy-auth/auth-server test -- roles.service.spec.ts`
Expected: FAIL

- [ ] **Step 7: Update `roles.service.ts`**

Change `deleteRole`'s catch block from:

```ts
    } catch (e: unknown) {
      if (isPrismaCode(e, 'P2003')) {
        const userCount = await prisma.saUserRole.count({ where: { roleId: existing.id } });
        throw new ConflictException(`Role is assigned to ${userCount} users`);
      }
      throw e;
    }
```

to:

```ts
    } catch (e: unknown) {
      if (isPrismaCode(e, 'P2003')) {
        const defaultForApp = await prisma.saApp.findFirst({
          where: { defaultRoleId: existing.id },
          select: { name: true },
        });
        if (defaultForApp) {
          throw new ConflictException(`Role is the default role for app "${defaultForApp.name}"`);
        }
        const userCount = await prisma.saUserRole.count({ where: { roleId: existing.id } });
        throw new ConflictException(`Role is assigned to ${userCount} users`);
      }
      throw e;
    }
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm --filter @sassy-auth/auth-server test -- roles.service.spec.ts`
Expected: PASS

- [ ] **Step 9: Run the full auth-server test suite**

Run: `pnpm --filter @sassy-auth/auth-server test`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add apps/auth-server/src/orgs/orgs.service.ts apps/auth-server/src/orgs/orgs.service.spec.ts apps/auth-server/src/roles/roles.service.ts apps/auth-server/src/roles/roles.service.spec.ts
git commit -m "fix(orgs,roles): distinguish default-for-app from has-dependents in delete errors"
```

---

## Task 8: Regression test — admin can already activate an `unverified` user

**Files:**
- Modify: `apps/auth-server/src/users/users.service.spec.ts`

No production code changes in this task — `UsersService.updateUser`'s existing guard (`if (dto.status === 'active' && existing.status === 'pending')`) only blocks `pending → active`, not `unverified → active`, so the admin-manual-activation path from the spec already works. This task locks that behavior in with a test so a future refactor of the guard can't silently break it.

- [ ] **Step 1: Write the test**

Add inside the existing `describe('updateUser', ...)` block in `apps/auth-server/src/users/users.service.spec.ts`:

```ts
    it('allows an admin to flip an unverified user to active (unlike pending, bug-0152)', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue(makeSaUser({ status: 'unverified' }));
      mockPrisma.saUser.update.mockResolvedValue(makeSaUser({ status: 'active' }));
      const result = await service.updateUser('ba-caller', 'usr1', { status: 'active' });
      expect(result.status).toBe('active');
    });
```

- [ ] **Step 2: Run test to verify it passes**

Run: `pnpm --filter @sassy-auth/auth-server test -- users.service.spec.ts`
Expected: PASS (no code change needed — this documents existing, correct behavior)

- [ ] **Step 3: Commit**

```bash
git add apps/auth-server/src/users/users.service.spec.ts
git commit -m "test(users): lock in that unverified→active admin activation is allowed (unlike pending)"
```

---

## Task 9: `StatusChip` — new `unverified` variant

**Files:**
- Modify: `packages/ui/src/components/status-chip.tsx`
- Modify: `packages/ui/src/__tests__/status-chip.test.tsx`

- [ ] **Step 1: Write the failing test**

Check the existing test file's pattern first (`packages/ui/src/__tests__/status-chip.test.tsx`), then add a case for `variant="unverified"` following the same shape as the existing `active`/`pending`/`inactive` cases — e.g. if the existing tests assert a specific class or the dot color, add:

```ts
  it('renders the unverified variant with its label', () => {
    render(<StatusChip variant="unverified" label="Unverified" />)
    expect(screen.getByText('Unverified')).toBeInTheDocument()
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sassy-auth/ui test -- status-chip.test.tsx`
Expected: FAIL — TypeScript error, `"unverified"` is not assignable to `StatusVariant`.

- [ ] **Step 3: Update `status-chip.tsx`**

Change:

```ts
type StatusVariant = 'active' | 'pending' | 'inactive'

const styles: Record<StatusVariant, { wrap: string; dot: string }> = {
  active:   { wrap: 'bg-green-100 text-green-800 border border-green-200 dark:bg-green-900/40 dark:text-green-300 dark:border-green-800', dot: 'bg-green-500' },
  pending:  { wrap: 'bg-amber-100 text-amber-800 border border-amber-200 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-800', dot: 'bg-amber-500' },
  inactive: { wrap: 'bg-slate-100 text-slate-600 border border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700',     dot: 'bg-slate-400' },
}
```

to:

```ts
type StatusVariant = 'active' | 'pending' | 'inactive' | 'unverified'

const styles: Record<StatusVariant, { wrap: string; dot: string }> = {
  active:     { wrap: 'bg-green-100 text-green-800 border border-green-200 dark:bg-green-900/40 dark:text-green-300 dark:border-green-800', dot: 'bg-green-500' },
  pending:    { wrap: 'bg-amber-100 text-amber-800 border border-amber-200 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-800', dot: 'bg-amber-500' },
  inactive:   { wrap: 'bg-slate-100 text-slate-600 border border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700',     dot: 'bg-slate-400' },
  unverified: { wrap: 'bg-sky-100 text-sky-800 border border-sky-200 dark:bg-sky-900/40 dark:text-sky-300 dark:border-sky-800',             dot: 'bg-sky-500' },
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sassy-auth/ui test -- status-chip.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/status-chip.tsx packages/ui/src/__tests__/status-chip.test.tsx
git commit -m "feat(ui): add unverified StatusChip variant"
```

---

## Task 10: Admin `lib/types.ts` and `lib/api.ts` — new fields

**Files:**
- Modify: `apps/admin/lib/types.ts`

- [ ] **Step 1: Edit types**

In `apps/admin/lib/types.ts`, change `User.status`:

```ts
  status: 'active' | 'pending' | 'inactive'
```

to:

```ts
  status: 'active' | 'pending' | 'inactive' | 'unverified'
```

Change the `App` interface — add after `clientSecretUpdatedAt?: string | null;`:

```ts
  defaultOrgId?: string | null;
  defaultRoleId?: string | null;
```

Change `UpdateAppPayload` — add:

```ts
  defaultOrgId?: string | null;
  defaultRoleId?: string | null;
```

(No change needed to `lib/api.ts` — `updateApp()` already forwards `patch` generically via `JSON.stringify(patch)`.)

- [ ] **Step 2: Commit**

```bash
git add apps/admin/lib/types.ts
git commit -m "feat(admin): add defaultOrgId/defaultRoleId to App types, unverified to User status"
```

---

## Task 11: `messages/en.json` — new copy

**Files:**
- Modify: `apps/admin/messages/en.json`

- [ ] **Step 1: Add app-drawer field labels**

Inside `apps.fields` (after `requireTwoFactorHint`, before `socialProviders`), add:

```json
      "defaultOrg": "Default organization",
      "defaultOrgHint": "New self-serve sign-ups on this app automatically join this org instead of founding a new one. Leave unset to let each sign-up create its own org.",
      "defaultOrgNone": "None — sign-ups create a new org",
      "defaultRole": "Default role",
      "defaultRoleHint": "Automatically assigned to every self-serve sign-up on this app, whether they join the default org or found a new one.",
      "defaultRoleNone": "None — no role assigned",
```

- [ ] **Step 2: Add the `unverified` user status label**

Inside `users.status` (after `"pending": "Pending",`), add:

```json
      "unverified": "Unverified",
```

- [ ] **Step 3: Add the `unverified` login error**

Inside `login.error` (after `"inactive": "This account has been deactivated.",`), add:

```json
      "unverified": "Please check your email and click the verification link before signing in.",
```

- [ ] **Step 4: Update signup copy**

Change the `signup` namespace's `success` key from:

```json
    "success": "Account created! You can now sign in.",
```

to:

```json
    "success": "Account created! Check your email for a verification link before you can sign in.",
```

- [ ] **Step 5: Commit**

```bash
git add apps/admin/messages/en.json
git commit -m "feat(admin): i18n copy for default org/role, unverified status, verification-gated login"
```

---

## Task 12: `login/actions.ts` + `login-form.tsx` — surface `unverified` distinctly

**Files:**
- Modify: `apps/admin/app/login/actions.ts`
- Modify: `apps/admin/app/login/__tests__/actions.signin.test.ts`
- Modify: `apps/admin/app/login/login-form.tsx`
- Modify: `apps/admin/app/login/__tests__/login-forms.test.tsx`

- [ ] **Step 1: Write the failing test for `actions.ts`**

Check `apps/admin/app/login/__tests__/actions.signin.test.ts` for its existing `res.status === 403` test (mocking `global.fetch`), then add a sibling test asserting that a 403 response whose JSON body is `{ code: 'ACCOUNT_UNVERIFIED' }` maps to `{ error: 'unverified' }`, and that a 403 with `{ code: 'ACCOUNT_INACTIVE' }` (or no body) still maps to `{ error: 'inactive' }`. Follow the exact `global.fetch` mocking shape already used by the neighboring 403 test in that file (same `Response`-like object shape, same import of the action under test).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sassy-auth/admin test -- actions.signin.test.ts`
Expected: FAIL — currently every 403 maps to `'inactive'` regardless of body.

- [ ] **Step 3: Add a shared classifier and use it in both 403 branches**

In `apps/admin/app/login/actions.ts`, add a helper near the top (after the `tracer` const):

```ts
/**
 * The session-create gate (auth.config.ts's databaseHooks.session.create.before)
 * throws FORBIDDEN with `code: 'ACCOUNT_UNVERIFIED' | 'ACCOUNT_INACTIVE'` in its
 * body — read it so the UI can tell "verify your email" apart from "deactivated"
 * instead of collapsing every 403 into one generic message.
 */
async function classifyForbidden(res: Response): Promise<'unverified' | 'inactive'> {
  try {
    const body = (await res.clone().json()) as { code?: string };
    if (body.code === 'ACCOUNT_UNVERIFIED') return 'unverified'
  } catch {
    // Non-JSON or empty body — fall through to the generic case.
  }
  return 'inactive'
}
```

Change the password sign-in branch (currently `if (res.status === 403) return { error: 'inactive' }` around line 236) to:

```ts
    if (res.status === 403) return { error: await classifyForbidden(res) }
```

Change the OTP verify branch (currently `if (res.status === 403) return { error: 'inactive' }` around line 381) to the same:

```ts
    if (res.status === 403) return { error: await classifyForbidden(res) }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sassy-auth/admin test -- actions.signin.test.ts`
Expected: PASS

- [ ] **Step 5: Write the failing test for `login-form.tsx`**

Check `apps/admin/app/login/__tests__/login-forms.test.tsx` for how it drives the form to a known-error state, then add a case asserting that an `'unverified'` action result renders the translated `login.error.unverified` copy (not the raw string `'unverified'`).

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm --filter @sassy-auth/admin test -- login-forms.test.tsx`
Expected: FAIL — `'unverified'` isn't in the known-error whitelist, so it renders as the raw literal `unverified` instead of translated copy.

- [ ] **Step 7: Update `login-form.tsx`**

Change:

```tsx
          {'error' in state && state.error && (
            <p data-testid="login-error" className="text-label-md text-[var(--destructive)]">
              {state.error === 'invalidCredentials' ||
              state.error === 'inactive' ||
              state.error === 'serverUnavailable' ||
              state.error === 'tooManyRequests'
                ? t(`error.${state.error}`)
                : state.error}
```

to:

```tsx
          {'error' in state && state.error && (
            <p data-testid="login-error" className="text-label-md text-[var(--destructive)]">
              {state.error === 'invalidCredentials' ||
              state.error === 'inactive' ||
              state.error === 'unverified' ||
              state.error === 'serverUnavailable' ||
              state.error === 'tooManyRequests'
                ? t(`error.${state.error}`)
                : state.error}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm --filter @sassy-auth/admin test -- login-forms.test.tsx`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add apps/admin/app/login/actions.ts apps/admin/app/login/__tests__/actions.signin.test.ts apps/admin/app/login/login-form.tsx apps/admin/app/login/__tests__/login-forms.test.tsx
git commit -m "feat(admin): distinguish 'verify your email' from 'account deactivated' on sign-in"
```

---

## Task 13: `AppEditDrawer` — default org / default role selects

**Files:**
- Modify: `apps/admin/components/app-edit-drawer.tsx`
- Modify: `apps/admin/components/__tests__/app-edit-drawer.test.tsx`

- [ ] **Step 1: Write the failing tests**

Check `apps/admin/components/__tests__/app-edit-drawer.test.tsx` for how it mocks `getSocialProviderSettingsAction` (it will be an adjacent `jest.mock('@/app/(admin)/apps/actions', ...)` or similar) and mirrors that to also mock `listOrgsAction`/`listRolesAction` from `@/app/(admin)/orgs/actions` and `@/app/(admin)/roles/actions`. Add tests asserting:

```tsx
  it('renders Default organization and Default role selects populated from this app\'s orgs/roles', async () => {
    // Arrange: mock listOrgsAction to resolve { items: [{ publicId: 'org1', name: 'Citadel', ... }], total: 1, page: 1, pageSize: 100 }
    // and listRolesAction to resolve { items: [{ publicId: 'role1', name: 'Managers', ... }], total: 1, page: 1, pageSize: 100 }
    // Render <AppEditDrawer app={app} open onOpenChange={jest.fn()} />
    // Assert the "Citadel" and "Managers" option text appears once the effect resolves (await findByText).
  })

  it('includes defaultOrgId/defaultRoleId in the PATCH payload when changed', async () => {
    // Select a new org/role option, click Save, assert updateAppAction was called
    // with a patch object containing { defaultOrgId: 'org1' } / { defaultRoleId: 'role1' }.
  })
```

Follow this test file's existing conventions exactly (its render helper, its way of waiting for the drawer's `open`-gated `useEffect` to settle, its way of asserting on the `updateAppAction` mock's call args) rather than introducing a new testing pattern.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @sassy-auth/admin test -- app-edit-drawer.test.tsx`
Expected: FAIL — no such selects exist yet.

- [ ] **Step 3: Update `app-edit-drawer.tsx`**

Add imports (alongside the existing `Select`-family import used elsewhere in this codebase, e.g. `Select, SelectContent, SelectItem, SelectTrigger, SelectValue` from `@sassy-auth/ui` — add these to the existing `@sassy-auth/ui` import list at the top) and the two list actions:

```tsx
import { listOrgsAction } from '@/app/(admin)/orgs/actions'
import { listRolesAction } from '@/app/(admin)/roles/actions'
import type { OrgRow, RoleRow } from '@/lib/types'
```

Add state, alongside the existing `twoFactorTrustDays`/`requireTwoFactor` state:

```tsx
  const [defaultOrgId, setDefaultOrgId] = React.useState<string | null>(app.defaultOrgId ?? null)
  const [defaultRoleId, setDefaultRoleId] = React.useState<string | null>(app.defaultRoleId ?? null)
  const [appOrgs, setAppOrgs] = React.useState<OrgRow[]>([])
  const [appRoles, setAppRoles] = React.useState<RoleRow[]>([])
```

In the existing `React.useEffect` that resets form state and fetches social-provider settings when `open`/`app` change, add the reset lines alongside the existing ones:

```tsx
    setDefaultOrgId(app.defaultOrgId ?? null)
    setDefaultRoleId(app.defaultRoleId ?? null)
```

and, inside the same effect's `if (!open) return` — gated block (right where `getSocialProviderSettingsAction` is called), fetch the org/role options too:

```tsx
    Promise.all([
      listOrgsAction({ appId: app.publicId, pageSize: 100 }),
      listRolesAction({ appId: app.publicId, pageSize: 100 }),
    ]).then(([orgsResult, rolesResult]) => {
      if (cancelled) return
      setAppOrgs('items' in orgsResult ? orgsResult.items : [])
      setAppRoles('items' in rolesResult ? rolesResult.items : [])
    })
```

Extend the `dirty` computation:

```tsx
  const dirty = name !== app.name || url !== app.url || redirectUrisDirty || twoFactorTrustDays !== (app.twoFactorTrustDays ?? null) || requireTwoFactor !== (app.requireTwoFactor ?? false) || socialDirty || defaultOrgId !== (app.defaultOrgId ?? null) || defaultRoleId !== (app.defaultRoleId ?? null)
```

Extend the patch built in `handleSubmit`:

```tsx
    const patch: { name?: string; url?: string; redirectUris?: RedirectUri[]; twoFactorTrustDays?: number | null; requireTwoFactor?: boolean; defaultOrgId?: string | null; defaultRoleId?: string | null } = {}
    if (name !== app.name) patch.name = name.trim()
    if (url !== app.url) patch.url = url.trim()
    if (redirectUrisDirty) patch.redirectUris = redirectUris
    if (twoFactorTrustDays !== (app.twoFactorTrustDays ?? null)) patch.twoFactorTrustDays = twoFactorTrustDays
    if (requireTwoFactor !== (app.requireTwoFactor ?? false)) patch.requireTwoFactor = requireTwoFactor
    if (defaultOrgId !== (app.defaultOrgId ?? null)) patch.defaultOrgId = defaultOrgId
    if (defaultRoleId !== (app.defaultRoleId ?? null)) patch.defaultRoleId = defaultRoleId
```

Add the two selects to the JSX, after the `requireTwoFactor` checkbox block and before the `socialProviders` block:

```tsx
            <div>
              <Label htmlFor="defaultOrgId">{t('apps.fields.defaultOrg')}</Label>
              <Select value={defaultOrgId ?? '__none__'} onValueChange={(v) => setDefaultOrgId(v === '__none__' ? null : v)}>
                <SelectTrigger id="defaultOrgId">
                  <SelectValue placeholder={t('apps.fields.defaultOrgNone')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{t('apps.fields.defaultOrgNone')}</SelectItem>
                  {appOrgs.map((o) => <SelectItem key={o.publicId} value={o.publicId}>{o.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="mt-1 text-body-sm text-muted-foreground">
                {t('apps.fields.defaultOrgHint')}
              </p>
            </div>
            <div>
              <Label htmlFor="defaultRoleId">{t('apps.fields.defaultRole')}</Label>
              <Select value={defaultRoleId ?? '__none__'} onValueChange={(v) => setDefaultRoleId(v === '__none__' ? null : v)}>
                <SelectTrigger id="defaultRoleId">
                  <SelectValue placeholder={t('apps.fields.defaultRoleNone')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{t('apps.fields.defaultRoleNone')}</SelectItem>
                  {appRoles.map((r) => <SelectItem key={r.publicId} value={r.publicId}>{r.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="mt-1 text-body-sm text-muted-foreground">
                {t('apps.fields.defaultRoleHint')}
              </p>
            </div>
```

(`Select` is used with the sentinel value `'__none__'` because this Radix-based `Select` component, like every other usage of it in this codebase, does not accept an empty string as a valid item value.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @sassy-auth/admin test -- app-edit-drawer.test.tsx`
Expected: PASS

- [ ] **Step 5: Run the full admin test suite**

Run: `pnpm --filter @sassy-auth/admin test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/admin/components/app-edit-drawer.tsx apps/admin/components/__tests__/app-edit-drawer.test.tsx
git commit -m "feat(admin): default org/role selects on the app edit drawer"
```

---

## Task 14: `UsersTable` — manual activation action for `unverified` users

**Files:**
- Modify: `apps/admin/components/users-table.tsx`
- Modify: `apps/admin/components/__tests__/users-table.test.tsx`

- [ ] **Step 1: Write the failing test**

Check `apps/admin/components/__tests__/users-table.test.tsx` for how it drives the row action dropdown for an `inactive` user's "Activate" item, and add an analogous case for a user with `status: 'unverified'`: opening the row menu shows an "Activate" item, and clicking it calls `setUserStatusAction(user.id, 'active')`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sassy-auth/admin test -- users-table.test.tsx`
Expected: FAIL — the dropdown's status-action branch only checks `u.status === 'active'` / `'inactive'`, so an `unverified` user gets neither the "Deactivate" nor the "Activate" item today.

- [ ] **Step 3: Update `users-table.tsx`**

Change the status-action branch from:

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

to:

```tsx
              {u.status === 'active' && u.id !== currentUserId ? (
                <DropdownMenuItem
                  className="text-destructive"
                  onClick={(e) => { e.stopPropagation(); setStatusError(null); setStatusTarget(u) }}
                >
                  {t('users.actions.deactivate')}
                </DropdownMenuItem>
              ) : u.status === 'inactive' || u.status === 'unverified' ? (
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

(`StatusChip variant={row.original.status}` in the status column already works unchanged — `User.status` now includes `'unverified'` per Task 10, and `StatusChip` accepts it per Task 9; `t('users.status.unverified')` resolves per Task 11.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sassy-auth/admin test -- users-table.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/admin/components/users-table.tsx apps/admin/components/__tests__/users-table.test.tsx
git commit -m "feat(admin): let an admin manually activate an unverified user from the users table"
```

---

## Task 15: Signup page/form — hide "Company name" when the app has a default org

**Files:**
- Modify: `apps/admin/app/signup/page.tsx`
- Modify: `apps/admin/app/signup/signup-form.tsx`
- Modify: `apps/admin/app/signup/__tests__/signup-form.test.tsx`
- Modify: `apps/admin/app/signup/__tests__/actions.test.ts` (if it asserts on the `companyName` request body shape)

- [ ] **Step 1: Write the failing test**

Check `apps/admin/app/signup/__tests__/signup-form.test.tsx` for its existing render pattern, then add:

```tsx
  it('hides the Company name field when hasDefaultOrg is true, and omits it from the submit payload', async () => {
    // Render <SignupForm clientId="sq_1" next="" hasDefaultOrg /> (or however
    // this test file constructs props for SignupForm today).
    // Assert screen.queryByLabelText(/company name/i) is null.
    // Fill in the remaining fields, submit, and assert the mocked
    // registerAction was called with a payload that has no companyName key
    // (or companyName: undefined) rather than an empty string.
  })

  it('shows the Company name field when hasDefaultOrg is false', () => {
    // Render <SignupForm clientId="sq_1" next="" hasDefaultOrg={false} />
    // Assert screen.getByLabelText(/company name/i) exists.
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @sassy-auth/admin test -- signup-form.test.tsx`
Expected: FAIL — `SignupForm` has no `hasDefaultOrg` prop yet; the field always renders.

- [ ] **Step 3: Update `signup-form.tsx`**

Change the props interface:

```tsx
interface SignupFormProps {
  clientId: string
  next: string
}
```

to:

```tsx
interface SignupFormProps {
  clientId: string
  next: string
  hasDefaultOrg: boolean
}
```

```tsx
export function SignupForm({ clientId, next }: SignupFormProps) {
```

to:

```tsx
export function SignupForm({ clientId, next, hasDefaultOrg }: SignupFormProps) {
```

In `handleSubmit`, change:

```tsx
      const result = await registerAction({ clientId, firstName, lastName, companyName, email, password })
```

to:

```tsx
      const result = await registerAction({
        clientId, firstName, lastName, email, password,
        ...(hasDefaultOrg ? {} : { companyName }),
      })
```

Wrap the Company name field block in a conditional — change:

```tsx
      <div className="flex flex-col gap-1.5">
        <label htmlFor="companyName" className="text-label-md font-semibold">{t('signup.companyName')}</label>
        <input
          id="companyName"
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          required
          className="flex h-9 rounded border border-[var(--border)] px-3 text-body-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        />
      </div>
```

to:

```tsx
      {!hasDefaultOrg && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="companyName" className="text-label-md font-semibold">{t('signup.companyName')}</label>
          <input
            id="companyName"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            required
            className="flex h-9 rounded border border-[var(--border)] px-3 text-body-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          />
        </div>
      )}
```

- [ ] **Step 4: Update `registerAction`'s payload type in `actions.ts`**

In `apps/admin/app/signup/actions.ts`, change `RegisterInput`:

```ts
export interface RegisterInput {
  clientId: string
  firstName: string
  lastName: string
  companyName: string
  email: string
  password: string
}
```

to:

```ts
export interface RegisterInput {
  clientId: string
  firstName: string
  lastName: string
  companyName?: string
  email: string
  password: string
}
```

and the fetch body construction from:

```ts
      body: JSON.stringify({
        email: input.email,
        password: input.password,
        firstName: input.firstName,
        lastName: input.lastName,
        companyName: input.companyName,
        appPublicId: input.clientId,
      }),
```

to:

```ts
      body: JSON.stringify({
        email: input.email,
        password: input.password,
        firstName: input.firstName,
        lastName: input.lastName,
        ...(input.companyName !== undefined && { companyName: input.companyName }),
        appPublicId: input.clientId,
      }),
```

- [ ] **Step 5: Wire `hasDefaultOrg` through `page.tsx`**

In `apps/admin/app/signup/page.tsx`, change `fetchAppName`'s return type and body:

```tsx
async function fetchAppName(clientId: string): Promise<string | null> {
  try {
    const res = await fetch(`${AUTH_SERVER}/api/register/app?appPublicId=${encodeURIComponent(clientId)}`, {
      cache: 'no-store',
    })
    if (!res.ok) return null
    const body = (await res.json()) as { name?: string }
    return typeof body.name === 'string' ? body.name : null
  } catch {
    return null
  }
}
```

to:

```tsx
async function fetchAppInfo(clientId: string): Promise<{ name: string | null; hasDefaultOrg: boolean }> {
  try {
    const res = await fetch(`${AUTH_SERVER}/api/register/app?appPublicId=${encodeURIComponent(clientId)}`, {
      cache: 'no-store',
    })
    if (!res.ok) return { name: null, hasDefaultOrg: false }
    const body = (await res.json()) as { name?: string; hasDefaultOrg?: boolean }
    return {
      name: typeof body.name === 'string' ? body.name : null,
      hasDefaultOrg: body.hasDefaultOrg === true,
    }
  } catch {
    return { name: null, hasDefaultOrg: false }
  }
}
```

Change the call site:

```tsx
  const appName = await fetchAppName(clientId)
```

to:

```tsx
  const { name: appName, hasDefaultOrg } = await fetchAppInfo(clientId)
```

Change the `<SignupForm>` usage:

```tsx
        <SignupForm clientId={clientId} next={nextSafe} />
```

to:

```tsx
        <SignupForm clientId={clientId} next={nextSafe} hasDefaultOrg={hasDefaultOrg} />
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @sassy-auth/admin test -- signup-form.test.tsx actions.test.ts`
Expected: PASS. If `actions.test.ts` has an existing test asserting the exact JSON body sent for a normal (non-default-org) registration, verify it still passes unchanged — the spread only omits the key when `companyName` is `undefined`, so an existing test that always supplies `companyName` is unaffected.

- [ ] **Step 7: Run the full admin test suite**

Run: `pnpm --filter @sassy-auth/admin test`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add apps/admin/app/signup/page.tsx apps/admin/app/signup/signup-form.tsx apps/admin/app/signup/actions.ts apps/admin/app/signup/__tests__/signup-form.test.tsx apps/admin/app/signup/__tests__/actions.test.ts
git commit -m "feat(admin): hide Company name on signup when the app has a default org"
```

---

## Task 16: `/signup/verified` landing page (email-verification callback target)

**Files:**
- Create: `apps/admin/app/signup/verified/page.tsx`
- Create: `apps/admin/app/signup/verified/__tests__/page.test.tsx`

`RegistrationService` (Task 5) points BetterAuth's verification link at `${ADMIN_URL}/signup/verified`. BetterAuth's `/verify-email` endpoint itself performs the token check server-side and then redirects the browser to this `callbackURL` — so this page's only job is to tell the visitor they're done and link them to `/login`. It does not need to call any API itself.

- [ ] **Step 1: Write the failing test**

Create `apps/admin/app/signup/verified/__tests__/page.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import VerifiedPage from '../page'

jest.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
}))

describe('SignupVerifiedPage', () => {
  it('renders a confirmation message and a link to /login', async () => {
    const ui = await VerifiedPage()
    render(ui)
    expect(screen.getByText('signup.verified.title')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'signup.verified.continueToLogin' })).toHaveAttribute('href', '/login')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sassy-auth/admin test -- signup/verified/__tests__/page.test.tsx`
Expected: FAIL — `../page` does not exist.

- [ ] **Step 3: Write the page**

Create `apps/admin/app/signup/verified/page.tsx`:

```tsx
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'

export default async function SignupVerifiedPage() {
  const t = await getTranslations()

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--background)]">
      <div className="w-full max-w-sm rounded-lg border border-[var(--border)] bg-[var(--card)] p-8 shadow-sm text-center">
        <div className="mb-4 flex justify-center">
          <span className="material-symbols-outlined text-[48px] text-[var(--primary)]" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
        </div>
        <h1 className="text-headline-sm text-[var(--foreground)]">{t('signup.verified.title')}</h1>
        <p className="mt-1 text-body-sm text-[var(--muted-foreground)]">{t('signup.verified.subtitle')}</p>
        <div className="mt-4">
          <Link href="/login" className="text-label-md text-[var(--primary)] hover:underline">
            {t('signup.verified.continueToLogin')}
          </Link>
        </div>
      </div>
    </div>
  )
}
```

Add the new keys to the `signup` namespace in `apps/admin/messages/en.json` (after the existing `"backToLogin": "Back to sign in",` line):

```json
    "verified": {
      "title": "Email verified",
      "subtitle": "Your account is ready. You can now sign in.",
      "continueToLogin": "Continue to sign in"
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sassy-auth/admin test -- signup/verified/__tests__/page.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/admin/app/signup/verified/page.tsx apps/admin/app/signup/verified/__tests__/page.test.tsx apps/admin/messages/en.json
git commit -m "feat(admin): add /signup/verified landing page for the email-verification callback"
```

---

## Task 17: Full-repo verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run every workspace's test suite**

```bash
pnpm --filter @sassy-auth/db test
pnpm --filter @sassy-auth/auth-server test
pnpm --filter @sassy-auth/ui test
pnpm --filter @sassy-auth/admin test
```

Expected: all PASS.

- [ ] **Step 2: Typecheck and lint everything touched**

```bash
pnpm --filter @sassy-auth/db exec tsc --noEmit
pnpm --filter @sassy-auth/auth-server exec tsc --noEmit
pnpm --filter @sassy-auth/admin exec tsc --noEmit
```

Expected: no errors. (If this repo has a root-level `pnpm lint`/`pnpm typecheck` script, prefer running that instead — check `package.json` at the repo root.)

- [ ] **Step 3: Manual smoke test**

Start the stack locally (`apps/auth-server` + `apps/admin` + Postgres), then:

1. In the admin console, create (or reuse the seeded `resourceserver01`) app, create an org under it, edit the app and set "Default organization" to that org and (optionally) "Default role" to an existing role.
2. Visit `/signup?client_id=<that app's publicId>` — confirm "Company name" does **not** render.
3. Submit the form with a fresh email — confirm the success screen says to check email, and (since this is dev) capture the verification email via whatever the local email transport logs/prints (check `select-transport.ts` for the dev-mode behavior — likely console output, mirroring the existing magic-link dev log).
4. Attempt to sign in before clicking the link — confirm the login page shows the new "check your email" message, not "account has been deactivated".
5. Click the verification link — confirm it redirects to `/signup/verified`, and that the new user's `SaUser.status` is now `active` (check via the admin Users page — the row should show the green "Active" chip, and if a default role was set, the user's assigned roles should include it).
6. Sign in — confirm it now succeeds.

- [ ] **Step 4: Report**

No commit for this task — it's verification-only. If any step fails, return to the relevant task above and fix before considering the plan complete.
