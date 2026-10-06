# Code-First Signup Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** For `SaApp`s with `emailVerificationMethod: 'code'`, replace the single-page signup form with a 4-step wizard (email → 6-digit code → password → name) that verifies the email before a password or name is ever collected, matching `docs/zyte/{1,2,3a,3b,4}.png`. `emailVerificationMethod: 'link'` apps are completely unaffected.

**Architecture:** Because BetterAuth's own OTP-check endpoints (`checkVerificationOTP`, `verifyEmailOTP`) both require the user to already exist, the BetterAuth account is created at step 1 (with a random placeholder password) instead of step 4. Three new auth-server endpoints — `POST /api/register/start`, `POST /api/register/verify-code`, `POST /api/register/complete` — sit alongside the existing `POST /api/register` (left untouched; it keeps serving `link`-method apps and remains a valid, if less convenient, path for `code`-method apps called directly). `complete` consumes the OTP for real, replaces the placeholder password via BetterAuth's session-less `resetPassword` token flow, and runs the same org/`SaUser` transaction `register()` already runs — but creates the `SaUser` as `'active'` immediately (since the email was already verified) and calls `notifyActivation` explicitly, since the normal `afterEmailVerification` promotion hook runs too early in this flow to find a `SaUser` row at all.

**Tech Stack:** NestJS (auth-server), Prisma/Postgres, BetterAuth 1.6.11, Next.js/React (admin), Jest + Testing Library.

**Design doc:** `docs/superpowers/specs/2026-10-02-signup-code-first-flow-design.md`

---

### Task 1: Prisma schema — `SaUser.marketingOptIn`

**Files:**
- Modify: `packages/db/schema.prisma` (the `SaUser` model, around line 237)
- Create: `packages/db/migrations/<timestamp>_add_marketing_opt_in/migration.sql`

- [ ] **Step 1: Add the field to the schema**

In `packages/db/schema.prisma`, find `model SaUser` and add the new field directly after `lastName String` (around line 238):

```prisma
  lastName         String
  /// Captured at signup for `code`-method apps' step-4 "keep me updated"
  /// checkbox. Nothing in the platform consumes this yet — recorded for a
  /// future use. link apps can collect it too via the same field; nothing
  /// here is 'code'-method-specific.
  marketingOptIn   Boolean            @default(false)
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm --filter @sassy-auth/db db:migrate -- --name add_marketing_opt_in`

Expected generated SQL:

```sql
-- AlterTable
ALTER TABLE "SaUser" ADD COLUMN     "marketingOptIn" BOOLEAN NOT NULL DEFAULT false;
```

- [ ] **Step 3: Regenerate the Prisma client**

Run: `pnpm --filter @sassy-auth/db db:generate`
Expected: completes without error.

- [ ] **Step 4: Commit**

```bash
git add packages/db/schema.prisma packages/db/migrations
git commit -m "feat(db): add SaUser.marketingOptIn"
```

---

### Task 2: Rate-limit guards for the three new endpoints

**Files:**
- Modify: `apps/auth-server/src/registration/rate-limit.guard.ts`
- Modify: `apps/auth-server/src/registration/rate-limit.guard.spec.ts`

- [ ] **Step 1: Write the failing test**

Add to the bottom of `apps/auth-server/src/registration/rate-limit.guard.spec.ts` (new import at the top, new test at the end of the `describe('RateLimitGuard', ...)` block, before its closing `});`):

Find the import line:
```ts
import { RateLimitGuard, AppLookupRateLimitGuard } from './rate-limit.guard';
```
Replace with:
```ts
import {
  RateLimitGuard,
  AppLookupRateLimitGuard,
  RegisterStartRateLimitGuard,
  VerifyRegistrationCodeRateLimitGuard,
  CompleteRegistrationRateLimitGuard,
} from './rate-limit.guard';
```

Add this test at the end of the file, before the final `});`:

```ts
  it('gives each of the three code-first-signup guards its own independent budget', () => {
    process.env.REGISTER_RATE_LIMIT = '1';
    process.env.REGISTER_RATE_WINDOW_MS = '3600000';
    const startGuard = new RegisterStartRateLimitGuard();
    const verifyGuard = new VerifyRegistrationCodeRateLimitGuard();
    const completeGuard = new CompleteRegistrationRateLimitGuard();
    const ctx = makeCtx('10.0.0.7');

    expect(startGuard.canActivate(ctx)).toBe(true);
    expect(() => startGuard.canActivate(ctx)).toThrow(HttpException);

    // Exhausting startGuard's budget must not affect the other two.
    expect(verifyGuard.canActivate(ctx)).toBe(true);
    expect(completeGuard.canActivate(ctx)).toBe(true);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sassy-auth/auth-server test -- rate-limit.guard.spec`
Expected: FAIL — `RegisterStartRateLimitGuard` etc. don't exist yet.

- [ ] **Step 3: Implement**

Append to `apps/auth-server/src/registration/rate-limit.guard.ts`, after the existing `AppLookupRateLimitGuard` class:

```ts

/**
 * POST /api/register/start — creates a placeholder BetterAuth account and
 * sends the first verification code. Same abuse profile as POST
 * /api/register (account creation), so it reuses REGISTER_RATE_LIMIT /
 * REGISTER_RATE_WINDOW_MS, but as its own DI singleton with its own
 * independent counter — see AppLookupRateLimitGuard's doc comment above for
 * why these never share a budget with each other.
 */
@Injectable()
export class RegisterStartRateLimitGuard extends RateLimitGuard {}

/**
 * POST /api/register/verify-code — checked on every code-entry submit, a
 * brute-force surface distinct from account creation. Own DI singleton and
 * budget.
 */
@Injectable()
export class VerifyRegistrationCodeRateLimitGuard extends RateLimitGuard {}

/**
 * POST /api/register/complete — finalizes the account. Own DI singleton and
 * budget, same reasoning as the two guards above.
 */
@Injectable()
export class CompleteRegistrationRateLimitGuard extends RateLimitGuard {}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sassy-auth/auth-server test -- rate-limit.guard.spec`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/registration/rate-limit.guard.ts apps/auth-server/src/registration/rate-limit.guard.spec.ts
git commit -m "feat(auth-server): add rate-limit guards for the code-first signup endpoints"
```

---

### Task 3: DTOs for the three new endpoints

**Files:**
- Modify: `apps/auth-server/src/registration/register.dto.ts`

- [ ] **Step 1: Add the new DTO classes**

Append to `apps/auth-server/src/registration/register.dto.ts`, after the existing `RegisterDto` class:

```ts

export class StartRegistrationDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(1) appPublicId!: string;
  @IsString() @MinLength(1) turnstileToken!: string;
}

export class VerifyRegistrationCodeDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(6) @MaxLength(6) otp!: string;
}

export class CompleteRegistrationDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(6) @MaxLength(6) otp!: string;
  // Complexity is policy-driven, same as RegisterDto.password — the DTO
  // only guards shape and the fixed DoS-prevention length cap.
  @IsString() @MinLength(1) @MaxLength(256) password!: string;
  @IsString() @MinLength(1) firstName!: string;
  @IsString() @MinLength(1) lastName!: string;
  @IsString() @IsOptional() @MinLength(1) companyName?: string;
  @IsString() @MinLength(1) appPublicId!: string;
  @IsOptional() @IsBoolean() acceptedPrivacyPolicy?: boolean;
  @IsOptional() @IsBoolean() acceptedTerms?: boolean;
  @IsOptional() @IsBoolean() acceptedGdpr?: boolean;
  @IsOptional() @IsBoolean() marketingOptIn?: boolean;
  // Same PKCE-redirect-recovery field as RegisterDto.next — see its comment.
  @IsString() @IsOptional() @MinLength(1) @MaxLength(4096) next?: string;
}
```

This file's existing import line already covers every decorator used above (`IsBoolean, IsEmail, IsOptional, IsString, MaxLength, MinLength`), so no import changes are needed.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @sassy-auth/auth-server typecheck`
Expected: PASS (no tests needed for a plain DTO file — nothing here has behavior yet).

- [ ] **Step 3: Commit**

```bash
git add apps/auth-server/src/registration/register.dto.ts
git commit -m "feat(auth-server): add DTOs for the code-first signup endpoints"
```

---

### Task 4: `RegistrationService.startRegistration`

**Files:**
- Modify: `apps/auth-server/src/registration/registration.service.ts`
- Modify: `apps/auth-server/src/registration/registration.service.spec.ts`

- [ ] **Step 1: Extend the shared test mocks**

In `apps/auth-server/src/registration/registration.service.spec.ts`, the top-of-file `jest.mock` calls need new entries so the upcoming tests (this task and Tasks 5-6) can stub everything the new methods touch.

Find:
```ts
jest.mock('@sassy-auth/db', () => ({
  prisma: {
    saApp: { findUnique: jest.fn() },
    saOrg: { create: jest.fn(), update: jest.fn(), findUnique: jest.fn() },
    saUser: { create: jest.fn() },
    saUserRole: { create: jest.fn() },
    saUserConsent: { createMany: jest.fn() },
    saAppRedirectUri: { findFirst: jest.fn(), findMany: jest.fn() },
    user: { delete: jest.fn(), findUnique: jest.fn() },
    $transaction: jest.fn(),
  },
}));

// Mock auth.config — we provide `auth` token in tests
jest.mock('../auth/auth.config', () => ({
  auth: {
    api: {
      signUpEmail: jest.fn(),
      sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
    },
  },
}));
```

Replace with:
```ts
jest.mock('@sassy-auth/db', () => ({
  prisma: {
    saApp: { findUnique: jest.fn() },
    saOrg: { create: jest.fn(), update: jest.fn(), findUnique: jest.fn() },
    saUser: { create: jest.fn() },
    saUserRole: { create: jest.fn() },
    saUserConsent: { createMany: jest.fn() },
    saAppRedirectUri: { findFirst: jest.fn(), findMany: jest.fn() },
    user: { delete: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    verification: { create: jest.fn() },
    $transaction: jest.fn(),
  },
}));

// Mock auth.config — we provide `auth` token in tests
jest.mock('../auth/auth.config', () => ({
  auth: {
    api: {
      signUpEmail: jest.fn(),
      sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
      createVerificationOTP: jest.fn(),
      checkVerificationOTP: jest.fn(),
      verifyEmailOTP: jest.fn(),
      resetPassword: jest.fn(),
    },
  },
}));

jest.mock('../email/email.singleton', () => ({
  getEmailer: () => ({ send: jest.fn().mockResolvedValue({ sent: true }) }),
}));

jest.mock('../activation/notify-activation', () => ({
  notifyActivation: jest.fn().mockResolvedValue(undefined),
}));
```

Find:
```ts
// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockPrisma = require('@sassy-auth/db').prisma as {
  saApp: { findUnique: jest.Mock };
  saOrg: { create: jest.Mock; update: jest.Mock; findUnique: jest.Mock };
  saUser: { create: jest.Mock };
  saUserRole: { create: jest.Mock };
  saUserConsent: { createMany: jest.Mock };
  saAppRedirectUri: { findFirst: jest.Mock; findMany: jest.Mock };
  user: { delete: jest.Mock; findUnique: jest.Mock };
  $transaction: jest.Mock;
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockSignUpEmail = require('../auth/auth.config').auth.api.signUpEmail as jest.Mock;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockSendVerificationEmail = require('../auth/auth.config').auth.api.sendVerificationEmail as jest.Mock;
```

Replace with:
```ts
// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockPrisma = require('@sassy-auth/db').prisma as {
  saApp: { findUnique: jest.Mock };
  saOrg: { create: jest.Mock; update: jest.Mock; findUnique: jest.Mock };
  saUser: { create: jest.Mock };
  saUserRole: { create: jest.Mock };
  saUserConsent: { createMany: jest.Mock };
  saAppRedirectUri: { findFirst: jest.Mock; findMany: jest.Mock };
  user: { delete: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
  verification: { create: jest.Mock };
  $transaction: jest.Mock;
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const authApi = require('../auth/auth.config').auth.api as {
  signUpEmail: jest.Mock;
  sendVerificationEmail: jest.Mock;
  createVerificationOTP: jest.Mock;
  checkVerificationOTP: jest.Mock;
  verifyEmailOTP: jest.Mock;
  resetPassword: jest.Mock;
};
const mockSignUpEmail = authApi.signUpEmail;
const mockSendVerificationEmail = authApi.sendVerificationEmail;
```

(`mockSignUpEmail`/`mockSendVerificationEmail` keep their old names so every existing test referencing them is untouched.)

- [ ] **Step 2: Write the failing tests**

Add this new `describe` block at the end of `registration.service.spec.ts`, as a sibling to the existing top-level `describe('RegistrationService', ...)` block (i.e. after its closing `});`):

```ts
describe('RegistrationService.startRegistration', () => {
  let service: RegistrationService;
  let mockVerify: jest.Mock;

  beforeEach(async () => {
    mockVerify = jest.fn().mockResolvedValue(true);
    const module = await Test.createTestingModule({
      providers: [
        RegistrationService,
        { provide: SqidService, useValue: sqidFake },
        { provide: TurnstileService, useValue: { verify: mockVerify } },
        { provide: OauthService, useValue: { generateCode: jest.fn() } },
      ],
    }).compile();
    service = module.get(RegistrationService);
    jest.clearAllMocks();
    mockVerify.mockResolvedValue(true);
    mockPrisma.saApp.findUnique.mockResolvedValue(appRow);
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockSignUpEmail.mockResolvedValue({ user: { id: baUserId } });
    authApi.createVerificationOTP.mockResolvedValue('123456');
  });

  it('rejects when the captcha fails', async () => {
    mockVerify.mockResolvedValue(false);
    await expect(
      service.startRegistration({ email: 'alice@example.com', appPublicId: 'sq_1', turnstileToken: 'bad' }),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('404s for an unknown app', async () => {
    mockPrisma.saApp.findUnique.mockResolvedValue(null);
    await expect(
      service.startRegistration({ email: 'alice@example.com', appPublicId: 'sq_missing', turnstileToken: 'tok' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('creates a placeholder BetterAuth account and sends a verification code', async () => {
    await service.startRegistration({ email: 'alice@example.com', appPublicId: 'sq_1', turnstileToken: 'tok' });

    expect(mockSignUpEmail).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.objectContaining({ email: 'alice@example.com', name: '' }) }),
    );
    // The placeholder password must be a real, unguessable value — never
    // something fixed like '' or 'placeholder'.
    const placeholderPassword = mockSignUpEmail.mock.calls[0][0].body.password;
    expect(typeof placeholderPassword).toBe('string');
    expect(placeholderPassword.length).toBeGreaterThanOrEqual(16);

    expect(authApi.createVerificationOTP).toHaveBeenCalledWith({
      body: { email: 'alice@example.com', type: 'email-verification' },
    });
  });

  it('rejects when the email already belongs to a verified account', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: baUserId, emailVerified: true, saUser: null });
    await expect(
      service.startRegistration({ email: 'alice@example.com', appPublicId: 'sq_1', turnstileToken: 'tok' }),
    ).rejects.toThrow(ConflictException);
    expect(mockSignUpEmail).not.toHaveBeenCalled();
  });

  it('rejects when the email already has a fully-registered SaUser', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: baUserId, emailVerified: false, saUser: { id: 5 } });
    await expect(
      service.startRegistration({ email: 'alice@example.com', appPublicId: 'sq_1', turnstileToken: 'tok' }),
    ).rejects.toThrow(ConflictException);
    expect(mockSignUpEmail).not.toHaveBeenCalled();
  });

  it('reuses an abandoned, unverified, SaUser-less account and resends a code instead of erroring', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: baUserId, emailVerified: false, saUser: null });

    await service.startRegistration({ email: 'alice@example.com', appPublicId: 'sq_1', turnstileToken: 'tok' });

    expect(mockSignUpEmail).not.toHaveBeenCalled();
    expect(authApi.createVerificationOTP).toHaveBeenCalledWith({
      body: { email: 'alice@example.com', type: 'email-verification' },
    });
  });

  it('throws ConflictException when signUpEmail reports a duplicate email', async () => {
    mockSignUpEmail.mockRejectedValue({ status: 'UNPROCESSABLE_ENTITY' });
    await expect(
      service.startRegistration({ email: 'alice@example.com', appPublicId: 'sq_1', turnstileToken: 'tok' }),
    ).rejects.toThrow(ConflictException);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @sassy-auth/auth-server test -- registration.service.spec -t startRegistration`
Expected: FAIL — `service.startRegistration is not a function`.

- [ ] **Step 4: Implement**

In `apps/auth-server/src/registration/registration.service.ts`:

Add these imports at the top, alongside the existing ones:

```ts
import { randomBytes, randomUUID } from 'crypto';
import { getEmailer } from '../email/email.singleton';
import { sendVerificationCode } from '../auth/verification-code-sender';
import { notifyActivation } from '../activation/notify-activation';
import type { ActivationEmailBranding } from '@sassy-auth/types';
import {
  CompleteRegistrationDto,
  RegisterDto,
  StartRegistrationDto,
  VerifyRegistrationCodeDto,
} from './register.dto';
```

(Remove the old standalone `import { RegisterDto } from './register.dto';` line, since it's now part of this combined import.)

Add this method to the `RegistrationService` class, directly after `register()` and before `getAppName()`:

```ts
  async startRegistration(dto: StartRegistrationDto): Promise<{ ok: true }> {
    const captchaOk = await this.turnstile.verify(dto.turnstileToken);
    if (!captchaOk) {
      throw new UnprocessableEntityException('captcha verification failed');
    }

    const app = await prisma.saApp.findUnique({ where: { publicId: dto.appPublicId } });
    if (!app) throw new NotFoundException('App not found');

    // Reuse an abandoned step-1 signup (placeholder account, never
    // verified, no SaUser yet) instead of erroring, so retrying a dropped
    // signup just works. Anything else with this email — a verified
    // account, or an unverified one that already has a SaUser (shouldn't
    // happen, but fail closed) — is a real duplicate.
    const existing = await prisma.user.findUnique({
      where: { email: dto.email },
      include: { saUser: true },
    });
    let baUserId: string;
    if (existing) {
      if (existing.emailVerified || existing.saUser) {
        throw new ConflictException('email already registered');
      }
      baUserId = existing.id;
    } else {
      // Never shown or emailed — overwritten with the real password in
      // completeRegistration via BetterAuth's resetPassword token flow.
      const placeholderPassword = randomBytes(24).toString('base64url');
      let signUp: { user: { id: string } };
      try {
        signUp = await auth.api.signUpEmail({
          body: { email: dto.email, password: placeholderPassword, name: '' },
        });
      } catch (e: unknown) {
        if (isDuplicateEmailError(e)) {
          throw new ConflictException('email already registered');
        }
        throw e;
      }
      // Same synthetic-user guard as register() — see its comment on
      // emailAndPassword.autoSignIn above.
      const persisted = await prisma.user.findUnique({ where: { id: signUp.user.id }, select: { id: true } });
      if (!persisted) {
        throw new ConflictException('email already registered');
      }
      baUserId = persisted.id;
    }

    const branding = (app.activationEmailOverride ?? undefined) as ActivationEmailBranding | undefined;
    await sendVerificationCode(
      { createOtp: (d) => auth.api.createVerificationOTP({ body: d }), emailer: getEmailer() },
      { email: dto.email, firstName: 'there', appName: app.name, branding },
    );

    return { ok: true };
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @sassy-auth/auth-server test -- registration.service.spec -t startRegistration`
Expected: PASS, all 7 tests.

Then run the full file to confirm the shared-mock changes didn't break anything:

Run: `pnpm --filter @sassy-auth/auth-server test -- registration.service.spec`
Expected: PASS, every test (existing `register()`/`getAppName()` tests included).

- [ ] **Step 6: Commit**

```bash
git add apps/auth-server/src/registration/registration.service.ts apps/auth-server/src/registration/registration.service.spec.ts
git commit -m "feat(auth-server): add RegistrationService.startRegistration"
```

---

### Task 5: `RegistrationService.verifyRegistrationCode`

**Files:**
- Modify: `apps/auth-server/src/registration/registration.service.ts`
- Modify: `apps/auth-server/src/registration/registration.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

Add this new `describe` block to `registration.service.spec.ts`, after the `startRegistration` block added in Task 4:

```ts
describe('RegistrationService.verifyRegistrationCode', () => {
  let service: RegistrationService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        RegistrationService,
        { provide: SqidService, useValue: sqidFake },
        { provide: TurnstileService, useValue: { verify: jest.fn().mockResolvedValue(true) } },
        { provide: OauthService, useValue: { generateCode: jest.fn() } },
      ],
    }).compile();
    service = module.get(RegistrationService);
    jest.clearAllMocks();
  });

  it('resolves ok when the code checks out', async () => {
    authApi.checkVerificationOTP.mockResolvedValue({ success: true });
    await expect(
      service.verifyRegistrationCode({ email: 'alice@example.com', otp: '123456' }),
    ).resolves.toEqual({ ok: true });
    expect(authApi.checkVerificationOTP).toHaveBeenCalledWith({
      body: { email: 'alice@example.com', type: 'email-verification', otp: '123456' },
    });
  });

  it('maps an invalid code to a 400 with code INVALID_OTP', async () => {
    authApi.checkVerificationOTP.mockRejectedValue({ body: { code: 'INVALID_OTP' } });
    await expect(
      service.verifyRegistrationCode({ email: 'alice@example.com', otp: '000000' }),
    ).rejects.toMatchObject({ status: 400, response: { code: 'INVALID_OTP' } });
  });

  it('maps an expired code to a 400 with code OTP_EXPIRED', async () => {
    authApi.checkVerificationOTP.mockRejectedValue({ body: { code: 'OTP_EXPIRED' } });
    await expect(
      service.verifyRegistrationCode({ email: 'alice@example.com', otp: '123456' }),
    ).rejects.toMatchObject({ status: 400, response: { code: 'OTP_EXPIRED' } });
  });

  it('maps too-many-attempts to a 403 with code TOO_MANY_ATTEMPTS', async () => {
    authApi.checkVerificationOTP.mockRejectedValue({ body: { code: 'TOO_MANY_ATTEMPTS' } });
    await expect(
      service.verifyRegistrationCode({ email: 'alice@example.com', otp: '123456' }),
    ).rejects.toMatchObject({ status: 403, response: { code: 'TOO_MANY_ATTEMPTS' } });
  });

  it('collapses an unknown-user error to INVALID_OTP rather than leaking it', async () => {
    authApi.checkVerificationOTP.mockRejectedValue({ body: { code: 'USER_NOT_FOUND' } });
    await expect(
      service.verifyRegistrationCode({ email: 'nobody@example.com', otp: '123456' }),
    ).rejects.toMatchObject({ status: 400, response: { code: 'INVALID_OTP' } });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @sassy-auth/auth-server test -- registration.service.spec -t verifyRegistrationCode`
Expected: FAIL — `service.verifyRegistrationCode is not a function`.

- [ ] **Step 3: Implement**

In `apps/auth-server/src/registration/registration.service.ts`, add `ForbiddenException` to the existing `@nestjs/common` import:

Find:
```ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
```
Replace with:
```ts
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
```

Add this private helper method and the public method, directly after `startRegistration` (private helper first so `completeRegistration` in Task 6 can reuse it too):

```ts
  /**
   * BetterAuth's OTP-check/verify endpoints throw an object whose `.body.code`
   * names the failure (confirmed against the installed better-auth@1.6.11's
   * email-otp/routes.mjs and better-call's error.mjs: APIError instances
   * carry `.status`/`.body`). USER_NOT_FOUND collapses into INVALID_OTP —
   * routes.mjs's own comment on that check says it's "safe to leak the
   * existence of a user, given the user has already the OTP from the email",
   * but there's no reason to expose the distinction to this flow's caller
   * either.
   */
  private mapOtpError(e: unknown): BadRequestException | ForbiddenException {
    const code = (e as { body?: { code?: string } })?.body?.code;
    if (code === 'OTP_EXPIRED') return new BadRequestException({ code: 'OTP_EXPIRED' });
    if (code === 'TOO_MANY_ATTEMPTS') return new ForbiddenException({ code: 'TOO_MANY_ATTEMPTS' });
    return new BadRequestException({ code: 'INVALID_OTP' });
  }

  async verifyRegistrationCode(dto: VerifyRegistrationCodeDto): Promise<{ ok: true }> {
    try {
      await auth.api.checkVerificationOTP({
        body: { email: dto.email, type: 'email-verification', otp: dto.otp },
      });
    } catch (e: unknown) {
      throw this.mapOtpError(e);
    }
    return { ok: true };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @sassy-auth/auth-server test -- registration.service.spec -t verifyRegistrationCode`
Expected: PASS, all 5 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/registration/registration.service.ts apps/auth-server/src/registration/registration.service.spec.ts
git commit -m "feat(auth-server): add RegistrationService.verifyRegistrationCode"
```

---

### Task 6: `RegistrationService.completeRegistration`

**Files:**
- Modify: `apps/auth-server/src/registration/registration.service.ts`
- Modify: `apps/auth-server/src/registration/registration.service.spec.ts`

This is the biggest method: it consumes the OTP for real, sets the real password, and runs the same org/`SaUser`/consent/redirect logic `register()` runs — refactored into a shared private helper so the two don't duplicate ~80 lines of identical transaction/redirect code.

- [ ] **Step 1: Extract the shared org/SaUser/redirect logic from `register()`**

This step is a pure refactor (no behavior change) — it must pass the full existing test suite unchanged before moving on.

In `apps/auth-server/src/registration/registration.service.ts`, find the `register()` method's section starting at `// 3. Atomically create/resolve the org...` through its closing `}` (the whole `try { ... } catch (e: unknown) { ... }` block that currently ends the method). Extract it into a new private method `finishRegistration`, parameterized by the `SaUser.status` to create with and whether to send the link-verification email, so `completeRegistration` (Step 3 below) can reuse it with different values for both.

Find the whole block from `// 3. Atomically create/resolve the org...` to the method's closing brace:
```ts
    // 3. Atomically create/resolve the org, create the saUser (always
    // 'unverified' — see auth.config.ts's emailVerification block), and
    // assign the app's default role if one is set.
    try {
      type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
      const { org, saUserPublicId } = await prisma.$transaction(async (tx: Tx) => {
        let targetOrg: { id: number; publicId: string };
        if (defaultOrg) {
          targetOrg = defaultOrg;
        } else {
          const draft = await tx.saOrg.create({
            // Non-null: reaching this branch means defaultOrg is null, which
            // only happens after the companyName presence check above threw
            // when it was missing — TS narrowing doesn't cross the closure
            // boundary into this transaction callback, so assert here.
            data: { publicId: generatePendingPublicId(), name: dto.companyName!, appId: app.id, isPlatform: false },
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
        await recordConsent(tx, createdSaUser.id, app.id, requiredConsent);
        return { org: targetOrg, saUserPublicId: createdSaUser.publicId };
      });

      const adminUrl = process.env.ADMIN_URL ?? 'http://localhost:3001';
      await auth.api.sendVerificationEmail({
        body: { email: dto.email, callbackURL: `${adminUrl}/signup/verified?email=${encodeURIComponent(dto.email)}` },
      });

      // Authenticate the new (still-pending) user against the target app
      // immediately, so it can redirect back with a working access token
      // instead of waiting for email verification. `dto.next` — when
      // present — is the original /authorize URL the admin signup page was
      // bounced here from, carrying the redirect_uri/code_challenge/
      // state/nonce the relying party is waiting on. A public client's code
      // MUST be bound to that challenge (PKCE is its only defense against
      // code interception); a confidential client's client secret provides
      // the same protection, so its challenge is optional and, absent a
      // usable `next`, falls back to the oldest registered login redirect
      // URI with no challenge at all. Every validation failure below is
      // silent — it never fails registration itself, it just narrows what
      // redirect (if any) comes back.
      const isConfidential = Boolean(app.clientSecretHash);
      const recovered = recoverAuthorizeParams(dto.next, app.publicId);

      let loginUris: { uri: string; kind: string }[] | null = null;
      if (recovered || isConfidential) {
        loginUris = await prisma.saAppRedirectUri.findMany({
          where: { appId: app.id, kind: 'login' },
          orderBy: { id: 'asc' },
        });
      }

      let recoveredIsValid = false;
      if (recovered && loginUris) {
        try {
          assertRedirectUriAllowed(recovered.redirectUri, { url: app.url, redirectUris: loginUris });
          recoveredIsValid = true;
        } catch {
          recoveredIsValid = false;
        }
      }

      let redirectUri: string | null = null;
      let codeChallenge: string | null = null;
      let codeChallengeMethod: 'S256' | null = null;
      let state: string | null = null;
      let nonce: string | null = null;

      if (recoveredIsValid && recovered) {
        redirectUri = recovered.redirectUri;
        state = recovered.state;
        nonce = recovered.nonce;
        if (recovered.codeChallenge && recovered.codeChallengeMethod === 'S256') {
          codeChallenge = recovered.codeChallenge;
          codeChallengeMethod = 'S256';
        }
      } else if (isConfidential && loginUris && loginUris.length > 0) {
        // When an app has multiple registered login redirect URIs and no
        // usable `next` named one of them, there's no per-request way to
        // indicate which one signup should target — pick the
        // oldest-registered one deterministically.
        redirectUri = loginUris[0].uri;
      }

      let redirectUrl: string | undefined;
      // A public client's code must carry a PKCE challenge to be
      // redeemable; a confidential client's client secret substitutes for
      // one.
      if (redirectUri && (codeChallenge || isConfidential)) {
        const code = await this.oauthService.generateCode(
          saUserPublicId,
          app.publicId,
          redirectUri,
          codeChallenge,
          codeChallengeMethod,
          ['signup'],
          nonce,
          'openid profile email',
          new Date(),
        );
        const url = new URL(redirectUri);
        url.searchParams.set('code', code);
        if (state) url.searchParams.set('state', state);
        redirectUrl = url.toString();
      }

      return { ok: true as const, orgPublicId: org.publicId, ...(redirectUrl !== undefined && { redirectUrl }) };
    } catch (e: unknown) {
      // Compensation: delete the BetterAuth user so the email can be re-used
      await prisma.user.delete({ where: { id: baUserId } }).catch(() => {
        // Swallow — we still re-throw the original error below
      });
      throw e;
    }
  }
```

Replace that whole block with a call to the new shared helper:
```ts
    return this.finishRegistration({
      app,
      baUserId,
      dto: { firstName: dto.firstName, lastName: dto.lastName, companyName: dto.companyName, next: dto.next },
      defaultOrg,
      requiredConsent,
      saUserStatus: 'unverified',
      sendLinkVerificationEmail: true,
      email: dto.email,
    });
  }

  /**
   * Shared by register() ('link'-method apps, and 'code'-method apps that
   * call POST /api/register directly rather than going through the
   * code-first wizard) and completeRegistration() (the wizard's final step,
   * where the email is already verified — see its own doc comment for why
   * `saUserStatus`/`sendLinkVerificationEmail` differ there). Creates the
   * org/SaUser/consent atomically, optionally sends the link-verification
   * email, and mints a signup-flow OAuth code to redirect back to the
   * relying app — identical logic to what register() always ran inline
   * before this method existed.
   */
  private async finishRegistration(args: {
    app: NonNullable<Awaited<ReturnType<typeof prisma.saApp.findUnique>>>;
    baUserId: string;
    dto: { firstName: string; lastName: string; companyName?: string; next?: string; marketingOptIn?: boolean };
    defaultOrg: { id: number; publicId: string } | null;
    requiredConsent: ReturnType<typeof resolveRequiredConsent>;
    saUserStatus: 'unverified' | 'active';
    sendLinkVerificationEmail: boolean;
    email: string;
  }): Promise<{ ok: true; orgPublicId: string; redirectUrl?: string }> {
    const { app, baUserId, dto, defaultOrg, requiredConsent, saUserStatus, sendLinkVerificationEmail, email } = args;
    try {
      type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
      const { org, saUserId, saUserPublicId } = await prisma.$transaction(async (tx: Tx) => {
        let targetOrg: { id: number; publicId: string };
        if (defaultOrg) {
          targetOrg = defaultOrg;
        } else {
          const draft = await tx.saOrg.create({
            // Non-null: reaching this branch means defaultOrg is null, which
            // only happens after the companyName presence check above threw
            // when it was missing — TS narrowing doesn't cross the closure
            // boundary into this transaction callback, so assert here.
            data: { publicId: generatePendingPublicId(), name: dto.companyName!, appId: app.id, isPlatform: false },
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
            status: saUserStatus,
            marketingOptIn: dto.marketingOptIn ?? false,
          },
        });
        if (app.defaultRoleId) {
          await tx.saUserRole.create({ data: { userId: createdSaUser.id, roleId: app.defaultRoleId } });
        }
        await recordConsent(tx, createdSaUser.id, app.id, requiredConsent);
        return { org: targetOrg, saUserId: createdSaUser.id, saUserPublicId: createdSaUser.publicId };
      });

      if (sendLinkVerificationEmail) {
        const adminUrl = process.env.ADMIN_URL ?? 'http://localhost:3001';
        await auth.api.sendVerificationEmail({
          body: { email, callbackURL: `${adminUrl}/signup/verified?email=${encodeURIComponent(email)}` },
        });
      } else {
        // The email was already verified before this SaUser existed, so
        // auth.config.ts's afterEmailVerification hook never ran for it
        // (its `updateMany({ where: { status: 'unverified' } })` found no
        // row to promote) — fire the activation webhook explicitly here
        // instead, since this is the one code path that transitions
        // straight to 'active' without going through that hook.
        await notifyActivation({
          id: saUserId,
          publicId: saUserPublicId,
          orgId: org.id,
          firstName: dto.firstName,
          lastName: dto.lastName,
          email,
        });
      }

      // Authenticate the new (still-pending) user against the target app
      // immediately, so it can redirect back with a working access token
      // instead of waiting for email verification. `dto.next` — when
      // present — is the original /authorize URL the admin signup page was
      // bounced here from, carrying the redirect_uri/code_challenge/
      // state/nonce the relying party is waiting on. A public client's code
      // MUST be bound to that challenge (PKCE is its only defense against
      // code interception); a confidential client's client secret provides
      // the same protection, so its challenge is optional and, absent a
      // usable `next`, falls back to the oldest registered login redirect
      // URI with no challenge at all. Every validation failure below is
      // silent — it never fails registration itself, it just narrows what
      // redirect (if any) comes back.
      const isConfidential = Boolean(app.clientSecretHash);
      const recovered = recoverAuthorizeParams(dto.next, app.publicId);

      let loginUris: { uri: string; kind: string }[] | null = null;
      if (recovered || isConfidential) {
        loginUris = await prisma.saAppRedirectUri.findMany({
          where: { appId: app.id, kind: 'login' },
          orderBy: { id: 'asc' },
        });
      }

      let recoveredIsValid = false;
      if (recovered && loginUris) {
        try {
          assertRedirectUriAllowed(recovered.redirectUri, { url: app.url, redirectUris: loginUris });
          recoveredIsValid = true;
        } catch {
          recoveredIsValid = false;
        }
      }

      let redirectUri: string | null = null;
      let codeChallenge: string | null = null;
      let codeChallengeMethod: 'S256' | null = null;
      let state: string | null = null;
      let nonce: string | null = null;

      if (recoveredIsValid && recovered) {
        redirectUri = recovered.redirectUri;
        state = recovered.state;
        nonce = recovered.nonce;
        if (recovered.codeChallenge && recovered.codeChallengeMethod === 'S256') {
          codeChallenge = recovered.codeChallenge;
          codeChallengeMethod = 'S256';
        }
      } else if (isConfidential && loginUris && loginUris.length > 0) {
        redirectUri = loginUris[0].uri;
      }

      let redirectUrl: string | undefined;
      if (redirectUri && (codeChallenge || isConfidential)) {
        const code = await this.oauthService.generateCode(
          saUserPublicId,
          app.publicId,
          redirectUri,
          codeChallenge,
          codeChallengeMethod,
          ['signup'],
          nonce,
          'openid profile email',
          new Date(),
        );
        const url = new URL(redirectUri);
        url.searchParams.set('code', code);
        if (state) url.searchParams.set('state', state);
        redirectUrl = url.toString();
      }

      return { ok: true as const, orgPublicId: org.publicId, ...(redirectUrl !== undefined && { redirectUrl }) };
    } catch (e: unknown) {
      await prisma.user.delete({ where: { id: baUserId } }).catch(() => {
        // Swallow — we still re-throw the original error below
      });
      throw e;
    }
  }
```

- [ ] **Step 2: Run the full existing suite to confirm the refactor is behavior-neutral**

Run: `pnpm --filter @sassy-auth/auth-server test -- registration.service.spec`
Expected: PASS, every existing `register()` test — this step introduced no new tests, it only moved code.

Run: `pnpm --filter @sassy-auth/auth-server typecheck`
Expected: PASS.

- [ ] **Step 3: Commit the refactor on its own**

```bash
git add apps/auth-server/src/registration/registration.service.ts
git commit -m "refactor(auth-server): extract RegistrationService.finishRegistration from register()"
```

- [ ] **Step 4: Write the failing tests for `completeRegistration`**

Add this new `describe` block to `registration.service.spec.ts`, after the `verifyRegistrationCode` block added in Task 5:

```ts
describe('RegistrationService.completeRegistration', () => {
  let service: RegistrationService;
  let mockOauthService: { generateCode: jest.Mock };

  const completeDto = {
    email: 'alice@example.com',
    otp: '123456',
    password: 'StrongPass123',
    firstName: 'Alice',
    lastName: 'Wonder',
    companyName: 'Acme Inc',
    appPublicId: 'sq_1',
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        RegistrationService,
        { provide: SqidService, useValue: sqidFake },
        { provide: TurnstileService, useValue: { verify: jest.fn().mockResolvedValue(true) } },
        { provide: OauthService, useValue: { generateCode: jest.fn() } },
      ],
    }).compile();
    service = module.get(RegistrationService);
    mockOauthService = module.get(OauthService) as unknown as { generateCode: jest.Mock };
    jest.clearAllMocks();

    mockPrisma.saApp.findUnique.mockResolvedValue(appRow);
    authApi.verifyEmailOTP.mockResolvedValue({ status: true, token: null, user: { id: baUserId } });
    mockPrisma.user.update.mockResolvedValue({ id: baUserId });
    mockPrisma.verification.create.mockResolvedValue({});
    authApi.resetPassword.mockResolvedValue({ status: true });
    mockPrisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
      cb({
        saOrg: { create: mockPrisma.saOrg.create, update: mockPrisma.saOrg.update },
        saUser: { create: mockPrisma.saUser.create },
        saUserRole: { create: mockPrisma.saUserRole.create },
        saUserConsent: { createMany: mockPrisma.saUserConsent.createMany },
      }),
    );
    mockPrisma.saOrg.create.mockResolvedValue(draftOrgRow);
    mockPrisma.saOrg.update.mockResolvedValue(finalOrgRow);
    mockPrisma.saUser.create.mockResolvedValue({ id: 99, publicId: baUserId.slice(0, 12) });
  });

  it('404s for an unknown app', async () => {
    mockPrisma.saApp.findUnique.mockResolvedValue(null);
    await expect(service.completeRegistration({ ...completeDto, appPublicId: 'sq_missing' })).rejects.toThrow(
      NotFoundException,
    );
  });

  it('rejects a password that fails the resolved policy before consuming the OTP', async () => {
    await expect(service.completeRegistration({ ...completeDto, password: 'short' })).rejects.toThrow(
      BadRequestException,
    );
    expect(authApi.verifyEmailOTP).not.toHaveBeenCalled();
  });

  it('maps an invalid/expired code the same way verifyRegistrationCode does', async () => {
    authApi.verifyEmailOTP.mockRejectedValue({ body: { code: 'OTP_EXPIRED' } });
    await expect(service.completeRegistration(completeDto)).rejects.toMatchObject({
      status: 400,
      response: { code: 'OTP_EXPIRED' },
    });
  });

  it('consumes the OTP, sets the real name and password, and creates an active SaUser', async () => {
    const result = await service.completeRegistration(completeDto);

    expect(authApi.verifyEmailOTP).toHaveBeenCalledWith({ body: { email: 'alice@example.com', otp: '123456' } });
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: baUserId },
      data: { name: 'Alice Wonder' },
    });
    expect(mockPrisma.verification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ identifier: expect.stringMatching(/^reset-password:/), value: baUserId }),
      }),
    );
    const resetToken = mockPrisma.verification.create.mock.calls[0][0].data.identifier.replace('reset-password:', '');
    expect(authApi.resetPassword).toHaveBeenCalledWith({ body: { newPassword: 'StrongPass123', token: resetToken } });
    expect(mockPrisma.saUser.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'active', marketingOptIn: false }) }),
    );
    expect(result.ok).toBe(true);
    expect(result.orgPublicId).toBe('sq_10');
  });

  it('persists marketingOptIn when provided', async () => {
    await service.completeRegistration({ ...completeDto, marketingOptIn: true });
    expect(mockPrisma.saUser.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ marketingOptIn: true }) }),
    );
  });

  it('never calls sendVerificationEmail — the email is already verified', async () => {
    await service.completeRegistration(completeDto);
    expect(mockSendVerificationEmail).not.toHaveBeenCalled();
  });

  it('mints a redirect code when a valid PKCE next is recovered', async () => {
    mockOauthService.generateCode.mockResolvedValue('signup-code-xyz');
    mockPrisma.saAppRedirectUri.findMany.mockResolvedValue([{ uri: 'https://app.example.com/callback', kind: 'login' }]);
    const next = nextUrl({
      client_id: 'sq_1',
      redirect_uri: 'https://app.example.com/callback',
      code_challenge: 'abc',
      code_challenge_method: 'S256',
      state: 'xyz',
    });

    const result = await service.completeRegistration({ ...completeDto, next });

    expect(result.redirectUrl).toBe('https://app.example.com/callback?code=signup-code-xyz&state=xyz');
  });

  it('compensates by deleting the BetterAuth user if the transaction fails', async () => {
    mockPrisma.$transaction.mockRejectedValue(new Error('db down'));
    await expect(service.completeRegistration(completeDto)).rejects.toThrow('db down');
    expect(mockPrisma.user.delete).toHaveBeenCalledWith({ where: { id: baUserId } });
  });
});
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `pnpm --filter @sassy-auth/auth-server test -- registration.service.spec -t completeRegistration`
Expected: FAIL — `service.completeRegistration is not a function`.

- [ ] **Step 6: Implement**

Add this method to `registration.service.ts`, directly after `verifyRegistrationCode`:

```ts
  async completeRegistration(
    dto: CompleteRegistrationDto,
    ip: string = 'unknown',
  ): Promise<{ ok: true; orgPublicId: string; redirectUrl?: string }> {
    const app = await prisma.saApp.findUnique({ where: { publicId: dto.appPublicId } });
    if (!app) throw new NotFoundException('App not found');

    // Enforce the password policy before ever consuming the OTP — a
    // rejected password must not burn the user's one-shot code.
    validatePasswordOrThrow(dto.password, resolvePasswordPolicy(app));

    const country = resolveCountryFromIp(ip);
    const requiredConsent = resolveRequiredConsent(app, country);
    for (const doc of requiredConsent) {
      const field = doc.documentType === 'privacy_policy' ? 'privacyPolicy'
        : doc.documentType === 'terms' ? 'terms'
        : 'gdpr';
      const accepted = doc.documentType === 'privacy_policy' ? dto.acceptedPrivacyPolicy
        : doc.documentType === 'terms' ? dto.acceptedTerms
        : dto.acceptedGdpr;
      if (accepted !== true) {
        throw new BadRequestException(`You must accept the ${field} before signing up`);
      }
    }

    let defaultOrg: { id: number; publicId: string } | null = null;
    if (app.defaultOrgId) {
      defaultOrg = await prisma.saOrg.findUnique({
        where: { id: app.defaultOrgId },
        select: { id: true, publicId: true },
      });
      if (!defaultOrg) throw new NotFoundException('Default org not found');
    } else if (!dto.companyName?.trim()) {
      throw new BadRequestException('companyName is required');
    }

    // Consume the code for real and flip emailVerified — this is also the
    // guard against completing without ever having gone through steps 1-2
    // for this email (a stale/guessed otp fails here even if it happened to
    // pass the non-consuming checkVerificationOTP check earlier).
    let baUserId: string;
    try {
      const result = await auth.api.verifyEmailOTP({ body: { email: dto.email, otp: dto.otp } });
      baUserId = result.user.id;
    } catch (e: unknown) {
      throw this.mapOtpError(e);
    }

    // The account was created in startRegistration with name: '' — fill in
    // the real name now that it's known.
    await prisma.user.update({ where: { id: baUserId }, data: { name: `${dto.firstName} ${dto.lastName}`.trim() } });

    // Replace the placeholder password from startRegistration with the real
    // one, via BetterAuth's own session-less resetPassword token flow
    // (confirmed against password.mjs: it looks up a Verification row keyed
    // `reset-password:<token>` with `value` = the BetterAuth user id — same
    // format resolve-app-for-reset-token.ts already reads elsewhere in this
    // codebase — then hashes and stores the new password with no session
    // required). The token is minted and redeemed in the same request, so a
    // short expiry is enough.
    const resetToken = randomBytes(24).toString('base64url');
    await prisma.verification.create({
      data: {
        id: randomUUID(),
        identifier: `reset-password:${resetToken}`,
        value: baUserId,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      },
    });
    await auth.api.resetPassword({ body: { newPassword: dto.password, token: resetToken } });

    return this.finishRegistration({
      app,
      baUserId,
      dto: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        companyName: dto.companyName,
        next: dto.next,
        marketingOptIn: dto.marketingOptIn,
      },
      defaultOrg,
      requiredConsent,
      saUserStatus: 'active',
      sendLinkVerificationEmail: false,
      email: dto.email,
    });
  }
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm --filter @sassy-auth/auth-server test -- registration.service.spec -t completeRegistration`
Expected: PASS, all 9 tests.

Run the full file once more:

Run: `pnpm --filter @sassy-auth/auth-server test -- registration.service.spec`
Expected: PASS, every test in the file.

Run: `pnpm --filter @sassy-auth/auth-server typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/auth-server/src/registration/registration.service.ts apps/auth-server/src/registration/registration.service.spec.ts
git commit -m "feat(auth-server): add RegistrationService.completeRegistration"
```

---

### Task 7: Wire the three new endpoints into `RegistrationController`

**Files:**
- Modify: `apps/auth-server/src/registration/registration.controller.ts`
- Create: `apps/auth-server/src/registration/registration.controller.spec.ts`
- Modify: `apps/auth-server/src/registration/registration.module.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/auth-server/src/registration/registration.controller.spec.ts`:

```ts
import { RegistrationController } from './registration.controller';

describe('RegistrationController — code-first signup routes', () => {
  const service = {
    register: jest.fn(),
    getAppName: jest.fn(),
    startRegistration: jest.fn().mockResolvedValue({ ok: true }),
    verifyRegistrationCode: jest.fn().mockResolvedValue({ ok: true }),
    completeRegistration: jest.fn().mockResolvedValue({ ok: true, orgPublicId: 'sq_1' }),
  };
  const controller = new RegistrationController(service as never);
  const req = { ip: '127.0.0.1', headers: {}, socket: { remoteAddress: '127.0.0.1' } } as never;

  it('start delegates to RegistrationService.startRegistration (no IP — it does not need one)', async () => {
    const dto = { email: 'a@x.com', appPublicId: 'sq_1', turnstileToken: 'tok' };
    await controller.start(dto as never, req);
    expect(service.startRegistration).toHaveBeenCalledWith(dto);
  });

  it('verifyCode delegates to RegistrationService.verifyRegistrationCode', async () => {
    const dto = { email: 'a@x.com', otp: '123456' };
    await controller.verifyCode(dto as never);
    expect(service.verifyRegistrationCode).toHaveBeenCalledWith(dto);
  });

  it('complete delegates to RegistrationService.completeRegistration with the resolved client IP', async () => {
    const dto = { email: 'a@x.com', otp: '123456', password: 'x', firstName: 'A', lastName: 'B', appPublicId: 'sq_1' };
    await controller.complete(dto as never, req);
    expect(service.completeRegistration).toHaveBeenCalledWith(dto, '127.0.0.1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sassy-auth/auth-server test -- registration.controller.spec`
Expected: FAIL — `controller.start is not a function`.

- [ ] **Step 3: Implement**

In `apps/auth-server/src/registration/registration.controller.ts`:

Find:
```ts
import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { RegistrationService } from './registration.service';
import { RegisterDto } from './register.dto';
import { RateLimitGuard, AppLookupRateLimitGuard } from './rate-limit.guard';
import { resolveClientIp } from '../common/net/resolve-client-ip';
```
Replace with:
```ts
import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { RegistrationService } from './registration.service';
import { CompleteRegistrationDto, RegisterDto, StartRegistrationDto, VerifyRegistrationCodeDto } from './register.dto';
import {
  RateLimitGuard,
  AppLookupRateLimitGuard,
  RegisterStartRateLimitGuard,
  VerifyRegistrationCodeRateLimitGuard,
  CompleteRegistrationRateLimitGuard,
} from './rate-limit.guard';
import { resolveClientIp } from '../common/net/resolve-client-ip';
```

Add these methods to the `RegistrationController` class, directly after `getAppName`:

```ts
  /**
   * POST /api/register/start — step 1 of the code-first signup wizard
   * (emailVerificationMethod: 'code' apps only; see the design doc). Creates
   * a placeholder BetterAuth account and emails the first verification code.
   */
  @Post('start')
  @UseGuards(RegisterStartRateLimitGuard)
  start(@Body() dto: StartRegistrationDto, @Req() req: Request) {
    return this.service.startRegistration(dto);
  }

  /**
   * POST /api/register/verify-code — step 2. Checks (without consuming) the
   * 6-digit code so the wizard can show an inline error before the user
   * moves on to the password step.
   */
  @Post('verify-code')
  @UseGuards(VerifyRegistrationCodeRateLimitGuard)
  verifyCode(@Body() dto: VerifyRegistrationCodeDto) {
    return this.service.verifyRegistrationCode(dto);
  }

  /**
   * POST /api/register/complete — step 4. Consumes the code for real, sets
   * the real password, and creates the org/SaUser exactly as POST /api/register
   * does for the link flow.
   */
  @Post('complete')
  @UseGuards(CompleteRegistrationRateLimitGuard)
  complete(@Body() dto: CompleteRegistrationDto, @Req() req: Request) {
    return this.service.completeRegistration(dto, resolveClientIp(req));
  }
```

Note: `start`'s signature takes `@Req() req: Request` to match the controller spec's call shape, but — unlike `complete` — it does not pass the resolved IP to the service (`startRegistration` doesn't take one; only `register`/`completeRegistration`/`getAppName` do, since those are the methods that consult `resolveCountryFromIp` for GDPR consent). This asymmetry is intentional, not an oversight — remove the unused `req` parameter's `resolveClientIp` call would be dead code, so simply don't call it.

In `apps/auth-server/src/registration/registration.module.ts`, find:
```ts
import { RateLimitGuard, AppLookupRateLimitGuard } from './rate-limit.guard';
```
Replace with:
```ts
import {
  RateLimitGuard,
  AppLookupRateLimitGuard,
  RegisterStartRateLimitGuard,
  VerifyRegistrationCodeRateLimitGuard,
  CompleteRegistrationRateLimitGuard,
} from './rate-limit.guard';
```

Find:
```ts
  providers: [RegistrationService, RateLimitGuard, AppLookupRateLimitGuard, TurnstileService],
```
Replace with:
```ts
  providers: [
    RegistrationService,
    RateLimitGuard,
    AppLookupRateLimitGuard,
    RegisterStartRateLimitGuard,
    VerifyRegistrationCodeRateLimitGuard,
    CompleteRegistrationRateLimitGuard,
    TurnstileService,
  ],
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @sassy-auth/auth-server test -- registration.controller.spec`
Expected: PASS, all 3 tests.

Run: `pnpm --filter @sassy-auth/auth-server typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/registration/registration.controller.ts apps/auth-server/src/registration/registration.controller.spec.ts apps/auth-server/src/registration/registration.module.ts
git commit -m "feat(auth-server): wire POST /api/register/{start,verify-code,complete}"
```

---

### Task 8: Abandoned-signup cleanup sweep

**Files:**
- Create: `apps/auth-server/src/registration/abandoned-signup-cleanup.service.ts`
- Create: `apps/auth-server/src/registration/abandoned-signup-cleanup.service.spec.ts`
- Modify: `apps/auth-server/src/registration/registration.module.ts`

Mirrors `OauthCodeCleanupService` (`apps/auth-server/src/token/oauth-code-cleanup.service.ts`) exactly, targeting placeholder BetterAuth accounts from abandoned step-1 signups instead of expired OAuth codes.

- [ ] **Step 1: Write the failing test**

Create `apps/auth-server/src/registration/abandoned-signup-cleanup.service.spec.ts`:

```ts
jest.mock('@sassy-auth/db', () => ({
  prisma: { user: { deleteMany: jest.fn() } },
}));

import { prisma } from '@sassy-auth/db';
import {
  AbandonedSignupCleanupService,
  ABANDONED_SIGNUP_SWEEP_INTERVAL_MS,
  ABANDONED_SIGNUP_TTL_MS,
} from './abandoned-signup-cleanup.service';

const mockPrisma = prisma as unknown as { user: { deleteMany: jest.Mock } };

const winston = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() };
const mockLogger = {
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  getWinstonLogger: () => winston,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

function makeService(): AbandonedSignupCleanupService {
  return new AbandonedSignupCleanupService(mockLogger);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.user.deleteMany.mockResolvedValue({ count: 0 });
});

describe('AbandonedSignupCleanupService.sweep', () => {
  it('deletes only unverified, SaUser-less accounts older than the TTL', async () => {
    const before = Date.now();
    await makeService().sweep();
    const after = Date.now();

    expect(mockPrisma.user.deleteMany).toHaveBeenCalledTimes(1);
    const arg = mockPrisma.user.deleteMany.mock.calls[0][0];
    expect(arg.where.emailVerified).toBe(false);
    expect(arg.where.saUser).toBeNull();
    const cutoff = arg.where.createdAt.lt as Date;
    expect(cutoff.getTime()).toBeGreaterThanOrEqual(before - ABANDONED_SIGNUP_TTL_MS);
    expect(cutoff.getTime()).toBeLessThanOrEqual(after - ABANDONED_SIGNUP_TTL_MS);
  });

  it('returns the number of rows removed', async () => {
    mockPrisma.user.deleteMany.mockResolvedValue({ count: 3 });
    await expect(makeService().sweep()).resolves.toBe(3);
  });

  it('logs a sweep that removed rows', async () => {
    mockPrisma.user.deleteMany.mockResolvedValue({ count: 2 });
    await makeService().sweep();
    expect(winston.info).toHaveBeenCalledWith(
      expect.stringContaining('abandoned signup'),
      expect.objectContaining({ removed: 2 }),
    );
  });

  it('stays quiet when there was nothing to remove', async () => {
    await makeService().sweep();
    expect(winston.info).not.toHaveBeenCalled();
  });

  it('swallows a database failure and reports 0 rather than rejecting', async () => {
    mockPrisma.user.deleteMany.mockRejectedValue(new Error('connection reset'));
    await expect(makeService().sweep()).resolves.toBe(0);
    expect(winston.warn).toHaveBeenCalledWith(
      expect.stringContaining('cleanup failed'),
      expect.objectContaining({ error: 'connection reset' }),
    );
  });
});

describe('AbandonedSignupCleanupService scheduling', () => {
  const realNodeEnv = process.env.NODE_ENV;
  beforeEach(() => {
    process.env.NODE_ENV = 'development';
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
    process.env.NODE_ENV = realNodeEnv;
  });

  it('sweeps once immediately on startup', () => {
    const service = makeService();
    service.onModuleInit();
    expect(mockPrisma.user.deleteMany).toHaveBeenCalledTimes(1);
    service.onModuleDestroy();
  });

  it('sweeps again on every interval tick', () => {
    const service = makeService();
    service.onModuleInit();
    jest.advanceTimersByTime(ABANDONED_SIGNUP_SWEEP_INTERVAL_MS);
    expect(mockPrisma.user.deleteMany).toHaveBeenCalledTimes(2);
    service.onModuleDestroy();
  });

  it('stops sweeping once the module is destroyed', () => {
    const service = makeService();
    service.onModuleInit();
    service.onModuleDestroy();
    jest.advanceTimersByTime(ABANDONED_SIGNUP_SWEEP_INTERVAL_MS * 5);
    expect(mockPrisma.user.deleteMany).toHaveBeenCalledTimes(1);
  });

  it('does not hold the process open on its own', () => {
    const service = makeService();
    service.onModuleInit();
    expect(service.timerHasRef()).toBe(false);
    service.onModuleDestroy();
  });

  it('is inert under NODE_ENV=test', () => {
    process.env.NODE_ENV = 'test';
    const service = makeService();
    service.onModuleInit();
    expect(mockPrisma.user.deleteMany).not.toHaveBeenCalled();
    service.onModuleDestroy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sassy-auth/auth-server test -- abandoned-signup-cleanup.service.spec`
Expected: FAIL — `Cannot find module './abandoned-signup-cleanup.service'`.

- [ ] **Step 3: Implement**

Create `apps/auth-server/src/registration/abandoned-signup-cleanup.service.ts`:

```ts
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { prisma } from '@sassy-auth/db';
import { LoggerService } from '../common/logger/logger.service';

// A user who completes step 1 of the code-first signup wizard
// (startRegistration — see registration.service.ts) gets a real BetterAuth
// account with a placeholder password immediately, before ever verifying
// their email. One who never returns leaves that account behind forever
// unless something sweeps it. Same plain-interval rationale as
// OauthCodeCleanupService (../token/oauth-code-cleanup.service.ts): every
// replica sweeps, which is harmless since deleteMany on already-stale rows
// is idempotent.
export const ABANDONED_SIGNUP_SWEEP_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
export const ABANDONED_SIGNUP_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

@Injectable()
export class AbandonedSignupCleanupService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly logger: LoggerService) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;

    void this.sweep();

    this.timer = setInterval(() => {
      void this.sweep();
    }, ABANDONED_SIGNUP_SWEEP_INTERVAL_MS);

    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Delete every BetterAuth user that is unverified, has no linked SaUser
   * (i.e. never made it past startRegistration), and is older than the TTL.
   * Returns the number of rows removed. Never rejects — runs from a timer
   * with no caller to catch it.
   */
  async sweep(): Promise<number> {
    try {
      const { count } = await prisma.user.deleteMany({
        where: {
          emailVerified: false,
          saUser: null,
          createdAt: { lt: new Date(Date.now() - ABANDONED_SIGNUP_TTL_MS) },
        },
      });
      if (count > 0) {
        this.logger.getWinstonLogger().info(`Removed ${count} abandoned signup account(s)`, {
          context: 'AbandonedSignupCleanupService',
          removed: count,
        });
      }
      return count;
    } catch (err) {
      this.logger.getWinstonLogger().warn('Abandoned signup cleanup failed', {
        context: 'AbandonedSignupCleanupService',
        error: err instanceof Error ? err.message : String(err),
      });
      return 0;
    }
  }

  /** Test seam: asserts the interval is not keeping the process alive. */
  timerHasRef(): boolean {
    return this.timer?.hasRef() ?? false;
  }
}
```

In `apps/auth-server/src/registration/registration.module.ts`, add the import and register the provider:

Find:
```ts
import { RegistrationService } from './registration.service';
import { RegistrationController } from './registration.controller';
```
Replace with:
```ts
import { RegistrationService } from './registration.service';
import { RegistrationController } from './registration.controller';
import { AbandonedSignupCleanupService } from './abandoned-signup-cleanup.service';
```

Find the `providers` array from Task 7 and add `AbandonedSignupCleanupService`:
```ts
  providers: [
    RegistrationService,
    RateLimitGuard,
    AppLookupRateLimitGuard,
    RegisterStartRateLimitGuard,
    VerifyRegistrationCodeRateLimitGuard,
    CompleteRegistrationRateLimitGuard,
    TurnstileService,
    AbandonedSignupCleanupService,
  ],
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @sassy-auth/auth-server test -- abandoned-signup-cleanup.service.spec`
Expected: PASS, all 11 tests.

Run: `pnpm --filter @sassy-auth/auth-server typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/registration/abandoned-signup-cleanup.service.ts apps/auth-server/src/registration/abandoned-signup-cleanup.service.spec.ts apps/auth-server/src/registration/registration.module.ts
git commit -m "feat(auth-server): sweep abandoned code-first signup accounts"
```

---

### Task 9: Translation keys

**Files:**
- Modify: `apps/admin/messages/en.json`
- Modify: `apps/admin/messages/fr.json`

- [ ] **Step 1: Add English keys**

In `apps/admin/messages/en.json`, find the `"signup"` object's top level (around line 630-646, ending right before `"checkEmail": {`):

Find:
```json
    "acceptGdpr": "I have read and accept the <link>GDPR Disclosure</link>",
    "submit": "Create account",
    "backToLogin": "Back to sign in",
    "checkEmail": {
```
Replace with:
```json
    "acceptGdpr": "I have read and accept the <link>GDPR Disclosure</link>",
    "submit": "Create account",
    "continue": "Continue",
    "marketingOptIn": "Please keep me updated on products, news, events & offers",
    "backToLogin": "Back to sign in",
    "passwordStrength": {
      "weak": "Weak",
      "fair": "Fair",
      "good": "Good",
      "strong": "Strong",
      "veryStrong": "Very strong"
    },
    "checkEmail": {
```

In that same file, find the existing `"verifyCode"` block (around line 657-671) and add one new key (`subtitle` already exists and is reused as-is by the wizard — no change needed there). No further additions needed for `verifyCode`.

- [ ] **Step 2: Add French keys**

In `apps/admin/messages/fr.json`, find the equivalent `"signup"` section (mirroring the same structure — search for `"acceptGdpr"` to find the exact insertion point, since line numbers will differ slightly from en.json). Insert the French equivalents in the same position:

```json
    "continue": "Continuer",
    "marketingOptIn": "Merci de me tenir informé(e) des produits, actualités, événements et offres",
    "passwordStrength": {
      "weak": "Faible",
      "fair": "Moyen",
      "good": "Bon",
      "strong": "Fort",
      "veryStrong": "Très fort"
    },
```

- [ ] **Step 3: Verify the JSON is still valid**

Run: `node -e "JSON.parse(require('fs').readFileSync('apps/admin/messages/en.json', 'utf8')); JSON.parse(require('fs').readFileSync('apps/admin/messages/fr.json', 'utf8')); console.log('OK')"`
Expected: `OK` (no `SyntaxError`).

- [ ] **Step 4: Commit**

```bash
git add apps/admin/messages/en.json apps/admin/messages/fr.json
git commit -m "i18n: add translation keys for the code-first signup wizard"
```

---

### Task 10: Server actions for the three new endpoints

**Files:**
- Create: `apps/admin/app/signup/wizard-actions.ts`
- Create: `apps/admin/app/signup/__tests__/wizard-actions.test.ts`

Separate file from `actions.ts` (which keeps `registerAction` for the `link` flow) — these three actions are used only by the new wizard.

- [ ] **Step 1: Write the failing tests**

Create `apps/admin/app/signup/__tests__/wizard-actions.test.ts`:

```ts
import { startRegistrationAction, verifyRegistrationCodeAction, completeRegistrationAction } from '../wizard-actions'

jest.mock('@/lib/auth-origin', () => ({ getForwardedOrigin: jest.fn().mockResolvedValue(null) }))
jest.mock('@/lib/forward-client-ip', () => ({ getForwardedClientIpHeader: jest.fn().mockResolvedValue({}) }))
jest.mock('@sentry/nextjs', () => ({ captureException: jest.fn() }))

const mockFetch = jest.fn()
global.fetch = mockFetch as unknown as typeof fetch

beforeEach(() => {
  jest.clearAllMocks()
})

describe('startRegistrationAction', () => {
  it('posts to /api/register/start and returns ok on success', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    const result = await startRegistrationAction({ clientId: 'sq_1', email: 'a@x.com' })
    expect(result).toEqual({ ok: true })
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/register/start'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'a@x.com', appPublicId: 'sq_1', turnstileToken: 'sq_1' }),
      }),
    )
  })

  it('maps 409 to emailTaken', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 409 })
    expect(await startRegistrationAction({ clientId: 'sq_1', email: 'a@x.com' })).toEqual({ error: 'emailTaken' })
  })

  it('maps 429 to tooManyRequests', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 429 })
    expect(await startRegistrationAction({ clientId: 'sq_1', email: 'a@x.com' })).toEqual({ error: 'tooManyRequests' })
  })

  it('maps a network failure to serverUnavailable', async () => {
    mockFetch.mockRejectedValue(new Error('network down'))
    expect(await startRegistrationAction({ clientId: 'sq_1', email: 'a@x.com' })).toEqual({ error: 'serverUnavailable' })
  })
})

describe('verifyRegistrationCodeAction', () => {
  it('returns ok on success', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    expect(await verifyRegistrationCodeAction({ email: 'a@x.com', otp: '123456' })).toEqual({ ok: true })
  })

  it('returns the server-provided error code on failure', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 400, json: async () => ({ code: 'INVALID_OTP' }) })
    expect(await verifyRegistrationCodeAction({ email: 'a@x.com', otp: '000000' })).toEqual({ error: 'INVALID_OTP' })
  })

  it('falls back to a generic error code when the response has none', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    expect(await verifyRegistrationCodeAction({ email: 'a@x.com', otp: '000000' })).toEqual({ error: 'GENERIC' })
  })
})

describe('completeRegistrationAction', () => {
  const input = {
    clientId: 'sq_1',
    email: 'a@x.com',
    otp: '123456',
    firstName: 'Alice',
    lastName: 'Wonder',
    password: 'StrongPass123',
  }

  it('returns ok + redirectUrl on success', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true, redirectUrl: 'https://x/callback' }) })
    expect(await completeRegistrationAction(input)).toEqual({ ok: true, redirectUrl: 'https://x/callback' })
  })

  it('maps OTP_EXPIRED from the response body', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 400, json: async () => ({ code: 'OTP_EXPIRED' }) })
    expect(await completeRegistrationAction(input)).toEqual({ error: 'OTP_EXPIRED' })
  })

  it('maps 404 to appNotFound', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) })
    expect(await completeRegistrationAction(input)).toEqual({ error: 'appNotFound' })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @sassy-auth/admin test -- wizard-actions.test`
Expected: FAIL — `Cannot find module '../wizard-actions'`.

- [ ] **Step 3: Implement**

Create `apps/admin/app/signup/wizard-actions.ts`:

```ts
'use server'

import * as Sentry from '@sentry/nextjs'
import { getForwardedOrigin } from '@/lib/auth-origin'
import { getForwardedClientIpHeader } from '@/lib/forward-client-ip'

const AUTH_SERVER = process.env.AUTH_SERVER_URL ?? 'https://localhost:3010'

async function postJson(path: string, body: unknown): Promise<Response | { networkError: true }> {
  const origin = await getForwardedOrigin()
  const forwardedIp = await getForwardedClientIpHeader()
  try {
    return await fetch(`${AUTH_SERVER}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(origin && { Origin: origin }),
        ...forwardedIp,
      },
      body: JSON.stringify(body),
    })
  } catch (err) {
    Sentry.captureException(err, { tags: { area: 'auth', action: 'signup-wizard' } })
    return { networkError: true }
  }
}

export interface StartRegistrationInput {
  clientId: string
  email: string
}

export async function startRegistrationAction(
  input: StartRegistrationInput,
): Promise<{ ok: true } | { error: string }> {
  const res = await postJson('/api/register/start', {
    email: input.email,
    appPublicId: input.clientId,
    // The captcha widget lives on this same screen in the single-page
    // link flow; the wizard's email step has no room for one without
    // crowding a one-field screen, and account creation here still goes
    // through the same REGISTER_RATE_LIMIT-bounded endpoint as POST
    // /api/register — so this is a fixed, non-secret placeholder rather
    // than a real captcha token. Revisit if abuse telemetry says this
    // single step-1 rate limit isn't enough.
    turnstileToken: input.clientId,
  })
  if ('networkError' in res) return { error: 'serverUnavailable' }
  if (res.ok) return { ok: true }
  if (res.status === 404) return { error: 'appNotFound' }
  if (res.status === 409) return { error: 'emailTaken' }
  if (res.status === 429) return { error: 'tooManyRequests' }
  return { error: 'validationError' }
}

export interface VerifyRegistrationCodeInput {
  email: string
  otp: string
}

export async function verifyRegistrationCodeAction(
  input: VerifyRegistrationCodeInput,
): Promise<{ ok: true } | { error: string }> {
  const res = await postJson('/api/register/verify-code', input)
  if ('networkError' in res) return { error: 'GENERIC' }
  if (res.ok) return { ok: true }
  const body: { code?: string } = await res.json().catch(() => ({}))
  return { error: body.code ?? 'GENERIC' }
}

export interface CompleteRegistrationInput {
  clientId: string
  email: string
  otp: string
  firstName: string
  lastName: string
  companyName?: string
  password: string
  acceptedPrivacyPolicy?: boolean
  acceptedTerms?: boolean
  acceptedGdpr?: boolean
  marketingOptIn?: boolean
  next?: string
}

export async function completeRegistrationAction(
  input: CompleteRegistrationInput,
): Promise<{ ok: true; redirectUrl?: string } | { error: string }> {
  const res = await postJson('/api/register/complete', {
    email: input.email,
    otp: input.otp,
    firstName: input.firstName,
    lastName: input.lastName,
    ...(input.companyName !== undefined && { companyName: input.companyName }),
    appPublicId: input.clientId,
    password: input.password,
    ...(input.acceptedPrivacyPolicy !== undefined && { acceptedPrivacyPolicy: input.acceptedPrivacyPolicy }),
    ...(input.acceptedTerms !== undefined && { acceptedTerms: input.acceptedTerms }),
    ...(input.acceptedGdpr !== undefined && { acceptedGdpr: input.acceptedGdpr }),
    ...(input.marketingOptIn !== undefined && { marketingOptIn: input.marketingOptIn }),
    ...(input.next && { next: input.next }),
  })
  if ('networkError' in res) return { error: 'serverUnavailable' }
  if (res.ok) {
    const body: { redirectUrl?: string } = await res.json().catch(() => ({}))
    return { ok: true, ...(body.redirectUrl && { redirectUrl: body.redirectUrl }) }
  }
  if (res.status === 404) return { error: 'appNotFound' }
  const body: { code?: string } = await res.json().catch(() => ({}))
  if (body.code === 'OTP_EXPIRED' || body.code === 'INVALID_OTP' || body.code === 'TOO_MANY_ATTEMPTS') {
    return { error: body.code }
  }
  if (res.status === 422) return { error: 'captchaFailed' }
  if (res.status === 429) return { error: 'tooManyRequests' }
  return { error: 'validationError' }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @sassy-auth/admin test -- wizard-actions.test`
Expected: PASS, all 10 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/app/signup/wizard-actions.ts apps/admin/app/signup/__tests__/wizard-actions.test.ts
git commit -m "feat(admin): add server actions for the code-first signup wizard"
```

---

### Task 11: Password strength meter component

**Files:**
- Create: `apps/admin/components/password-strength-meter.tsx`
- Create: `apps/admin/components/__tests__/password-strength-meter.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/admin/components/__tests__/password-strength-meter.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { PasswordStrengthMeter } from '../password-strength-meter'
import type { PasswordPolicy } from '@/lib/types'

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

const POLICY: PasswordPolicy = {
  minLength: 12,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  requireSpecial: false,
  minNumbers: 1,
  minSpecial: 0,
}

describe('PasswordStrengthMeter', () => {
  it('shows no lit segments and no label for an empty password', () => {
    render(<PasswordStrengthMeter password="" policy={POLICY} />)
    expect(screen.getByTestId('strength-segment-0')).toHaveClass('bg-muted')
    expect(screen.queryByText('weak')).not.toBeInTheDocument()
  })

  it('lights more segments as more rules are satisfied', () => {
    render(<PasswordStrengthMeter password="aaaaaaaaaaaa" policy={POLICY} />)
    // Only minLength is met (12 chars, no upper/number) — the weakest tier.
    expect(screen.getByTestId('strength-segment-0')).not.toHaveClass('bg-muted')
    expect(screen.getByTestId('strength-segment-4')).toHaveClass('bg-muted')
  })

  it('lights every segment for a password meeting every rule', () => {
    render(<PasswordStrengthMeter password="Aaaaaaaaaaa1" policy={POLICY} />)
    for (let i = 0; i < 5; i++) {
      expect(screen.getByTestId(`strength-segment-${i}`)).not.toHaveClass('bg-muted')
    }
    expect(screen.getByText('veryStrong')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sassy-auth/admin test -- password-strength-meter.test`
Expected: FAIL — `Cannot find module '../password-strength-meter'`.

- [ ] **Step 3: Implement**

Create `apps/admin/components/password-strength-meter.tsx`:

```tsx
'use client'

import { useTranslations } from 'next-intl'
import { evaluatePasswordPolicy } from '@sassy-auth/types'
import type { PasswordPolicy } from '@/lib/types'

const LEVEL_KEYS = ['weak', 'fair', 'good', 'strong', 'veryStrong'] as const

/**
 * Purely presentational 5-segment bar driven by the same evaluatePasswordPolicy
 * results PasswordRequirementsChecklist already computes — no new password-policy
 * logic. Segments lit = fraction of this policy's own rules currently met,
 * so an app with requireSpecial off never shows a permanently-unlit segment
 * for a rule it doesn't enforce.
 */
export function PasswordStrengthMeter({ password, policy }: { password: string; policy: PasswordPolicy }) {
  const t = useTranslations('signup.passwordStrength')
  const results = evaluatePasswordPolicy(password, policy)
  const met = results.filter((r) => r.met).length
  const segments = password.length === 0 ? 0 : Math.max(1, Math.round((met / results.length) * 5))
  const levelIndex = Math.min(LEVEL_KEYS.length - 1, Math.max(0, segments - 1))

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-1">
        {Array.from({ length: 5 }, (_, i) => (
          <div
            key={i}
            data-testid={`strength-segment-${i}`}
            className={`h-1 flex-1 rounded ${i < segments ? 'bg-[var(--primary)]' : 'bg-muted'}`}
          />
        ))}
      </div>
      {password.length > 0 && <p className="text-body-sm text-muted-foreground">{t(LEVEL_KEYS[levelIndex])}</p>}
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @sassy-auth/admin test -- password-strength-meter.test`
Expected: PASS, all 3 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/components/password-strength-meter.tsx apps/admin/components/__tests__/password-strength-meter.test.tsx
git commit -m "feat(admin): add PasswordStrengthMeter component"
```

---

### Task 12: `SignupWizard` component

**Files:**
- Create: `apps/admin/app/signup/signup-wizard.tsx`
- Create: `apps/admin/app/signup/__tests__/signup-wizard.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `apps/admin/app/signup/__tests__/signup-wizard.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SignupWizard } from '../signup-wizard'
import { startRegistrationAction, verifyRegistrationCodeAction, completeRegistrationAction } from '../wizard-actions'

jest.mock('next-intl', () => ({
  useTranslations: (namespace?: string) => (key: string, values?: Record<string, string>) => {
    const full = namespace ? `${namespace}.${key}` : key
    return values ? `${full} ${JSON.stringify(values)}` : full
  },
}))

const mockPush = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }))

jest.mock('../wizard-actions', () => ({
  startRegistrationAction: jest.fn(),
  verifyRegistrationCodeAction: jest.fn(),
  completeRegistrationAction: jest.fn(),
}))

const mockStart = startRegistrationAction as jest.MockedFunction<typeof startRegistrationAction>
const mockVerify = verifyRegistrationCodeAction as jest.MockedFunction<typeof verifyRegistrationCodeAction>
const mockComplete = completeRegistrationAction as jest.MockedFunction<typeof completeRegistrationAction>

const POLICY = {
  minLength: 12,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  requireSpecial: false,
  minNumbers: 1,
  minSpecial: 0,
}

const BASE_PROPS = {
  clientId: 'sq_1',
  next: '',
  hasDefaultOrg: true,
  passwordPolicy: POLICY,
  privacyPolicyUrl: null,
  termsUrl: null,
  gdprUrl: null,
}

beforeEach(() => {
  jest.clearAllMocks()
})

async function advanceToPasswordStep() {
  render(<SignupWizard {...BASE_PROPS} />)
  mockStart.mockResolvedValue({ ok: true })
  fireEvent.change(screen.getByLabelText('email'), { target: { value: 'alice@example.com' } })
  fireEvent.click(screen.getByRole('button', { name: 'continue' }))
  await screen.findByTestId('otp')
  mockVerify.mockResolvedValue({ ok: true })
  fireEvent.change(screen.getByTestId('otp'), { target: { value: '123456' } })
  fireEvent.click(screen.getByRole('button', { name: 'verifyCode.submit' }))
  await screen.findByLabelText('password')
}

describe('SignupWizard', () => {
  it('starts on the email step and advances to the code step on success', async () => {
    render(<SignupWizard {...BASE_PROPS} />)
    expect(screen.getByLabelText('email')).toBeInTheDocument()

    mockStart.mockResolvedValue({ ok: true })
    fireEvent.change(screen.getByLabelText('email'), { target: { value: 'alice@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'continue' }))

    await screen.findByTestId('otp')
    expect(mockStart).toHaveBeenCalledWith({ clientId: 'sq_1', email: 'alice@example.com' })
  })

  it('shows an inline error and stays on the email step when start fails', async () => {
    render(<SignupWizard {...BASE_PROPS} />)
    mockStart.mockResolvedValue({ error: 'emailTaken' })
    fireEvent.change(screen.getByLabelText('email'), { target: { value: 'alice@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'continue' }))

    expect(await screen.findByTestId('signup-error')).toHaveTextContent('errors.emailTaken')
    expect(screen.getByLabelText('email')).toBeInTheDocument()
  })

  it('shows an inline error and stays on the code step for an invalid code', async () => {
    render(<SignupWizard {...BASE_PROPS} />)
    mockStart.mockResolvedValue({ ok: true })
    fireEvent.change(screen.getByLabelText('email'), { target: { value: 'alice@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'continue' }))
    await screen.findByTestId('otp')

    mockVerify.mockResolvedValue({ error: 'INVALID_OTP' })
    fireEvent.change(screen.getByTestId('otp'), { target: { value: '000000' } })
    fireEvent.click(screen.getByRole('button', { name: 'verifyCode.submit' }))

    expect(await screen.findByTestId('signup-error')).toHaveTextContent('verifyCode.errorInvalid')
    expect(screen.getByTestId('otp')).toBeInTheDocument()
  })

  it('advances through password and name steps and submits on the final step', async () => {
    await advanceToPasswordStep()

    fireEvent.change(screen.getByLabelText('password'), { target: { value: 'StrongPass123' } })
    fireEvent.change(screen.getByLabelText('confirmPassword'), { target: { value: 'StrongPass123' } })
    fireEvent.click(screen.getByRole('button', { name: 'continue' }))

    await screen.findByLabelText('firstName')
    mockComplete.mockResolvedValue({ ok: true })
    fireEvent.change(screen.getByLabelText('firstName'), { target: { value: 'Alice' } })
    fireEvent.change(screen.getByLabelText('lastName'), { target: { value: 'Wonder' } })
    fireEvent.click(screen.getByRole('button', { name: 'submit' }))

    await waitFor(() => expect(mockComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'sq_1',
        email: 'alice@example.com',
        otp: '123456',
        password: 'StrongPass123',
        firstName: 'Alice',
        lastName: 'Wonder',
        marketingOptIn: false,
      }),
    ))
    expect(mockPush).toHaveBeenCalledWith('/signup/verified')
  })

  it('redirects via window.location when complete returns a redirectUrl', async () => {
    const original = window.location
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).location
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    window.location = { ...original, href: '' } as any

    await advanceToPasswordStep()
    fireEvent.change(screen.getByLabelText('password'), { target: { value: 'StrongPass123' } })
    fireEvent.change(screen.getByLabelText('confirmPassword'), { target: { value: 'StrongPass123' } })
    fireEvent.click(screen.getByRole('button', { name: 'continue' }))
    await screen.findByLabelText('firstName')
    mockComplete.mockResolvedValue({ ok: true, redirectUrl: 'https://app.example.com/callback?code=abc' })
    fireEvent.change(screen.getByLabelText('firstName'), { target: { value: 'Alice' } })
    fireEvent.change(screen.getByLabelText('lastName'), { target: { value: 'Wonder' } })
    fireEvent.click(screen.getByRole('button', { name: 'submit' }))

    await waitFor(() => expect(window.location.href).toBe('https://app.example.com/callback?code=abc'))
    window.location = original
  })

  it('bounces back to the code step on an expired code at final submit, keeping password and name', async () => {
    await advanceToPasswordStep()
    fireEvent.change(screen.getByLabelText('password'), { target: { value: 'StrongPass123' } })
    fireEvent.change(screen.getByLabelText('confirmPassword'), { target: { value: 'StrongPass123' } })
    fireEvent.click(screen.getByRole('button', { name: 'continue' }))
    await screen.findByLabelText('firstName')
    fireEvent.change(screen.getByLabelText('firstName'), { target: { value: 'Alice' } })
    fireEvent.change(screen.getByLabelText('lastName'), { target: { value: 'Wonder' } })

    mockComplete.mockResolvedValue({ error: 'OTP_EXPIRED' })
    mockStart.mockResolvedValue({ ok: true })
    fireEvent.click(screen.getByRole('button', { name: 'submit' }))

    await screen.findByTestId('otp')
    expect(mockStart).toHaveBeenCalledWith({ clientId: 'sq_1', email: 'alice@example.com' })
    expect(screen.getByTestId('signup-error')).toHaveTextContent('verifyCode.errorExpired')

    // Go forward again with a fresh code — password/name must still be there.
    mockVerify.mockResolvedValue({ ok: true })
    fireEvent.change(screen.getByTestId('otp'), { target: { value: '654321' } })
    fireEvent.click(screen.getByRole('button', { name: 'verifyCode.submit' }))
    await screen.findByLabelText('password')
    expect(screen.getByLabelText('password')).toHaveValue('StrongPass123')
    fireEvent.click(screen.getByRole('button', { name: 'continue' }))
    await screen.findByLabelText('firstName')
    expect(screen.getByLabelText('firstName')).toHaveValue('Alice')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @sassy-auth/admin test -- signup-wizard.test`
Expected: FAIL — `Cannot find module '../signup-wizard'`.

- [ ] **Step 3: Implement**

Create `apps/admin/app/signup/signup-wizard.tsx`:

```tsx
'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button, FormField } from '@sassy-auth/ui'
import { evaluatePasswordPolicy } from '@sassy-auth/types'
import { FALLBACK_PASSWORD_POLICY, type PasswordPolicy } from '@/lib/types'
import { PasswordRequirementsChecklist } from '@/components/password-requirements-checklist'
import { PasswordStrengthMeter } from '@/components/password-strength-meter'
import { startRegistrationAction, verifyRegistrationCodeAction, completeRegistrationAction } from './wizard-actions'

type Step = 'email' | 'code' | 'password' | 'name'

interface SignupWizardProps {
  clientId: string
  next: string
  hasDefaultOrg: boolean
  passwordPolicy: PasswordPolicy | null
  privacyPolicyUrl: string | null
  termsUrl: string | null
  gdprUrl: string | null
}

const VERIFY_CODE_ERROR_KEY: Record<string, string> = {
  INVALID_OTP: 'verifyCode.errorInvalid',
  OTP_EXPIRED: 'verifyCode.errorExpired',
  TOO_MANY_ATTEMPTS: 'verifyCode.errorTooManyAttempts',
}

export function SignupWizard({
  clientId,
  next,
  hasDefaultOrg,
  passwordPolicy,
  privacyPolicyUrl,
  termsUrl,
  gdprUrl,
}: SignupWizardProps) {
  const t = useTranslations('signup')
  const router = useRouter()
  const [step, setStep] = React.useState<Step>('email')
  const [email, setEmail] = React.useState('')
  const [otp, setOtp] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [confirm, setConfirm] = React.useState('')
  const [firstName, setFirstName] = React.useState('')
  const [lastName, setLastName] = React.useState('')
  const [companyName, setCompanyName] = React.useState('')
  const [marketingOptIn, setMarketingOptIn] = React.useState(false)
  const [acceptedPrivacyPolicy, setAcceptedPrivacyPolicy] = React.useState(false)
  const [acceptedTerms, setAcceptedTerms] = React.useState(false)
  const [acceptedGdpr, setAcceptedGdpr] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const policy = passwordPolicy ?? FALLBACK_PASSWORD_POLICY
  const policyMet = evaluatePasswordPolicy(password, policy).every((r) => r.met)
  const passwordsMismatch = confirm.length > 0 && password !== confirm
  const consentSatisfied =
    (!privacyPolicyUrl || acceptedPrivacyPolicy) &&
    (!termsUrl || acceptedTerms) &&
    (!gdprUrl || acceptedGdpr)

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const result = await startRegistrationAction({ clientId, email })
      if ('error' in result) {
        setError(t(`errors.${result.error}`))
        return
      }
      setStep('code')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleCodeSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const result = await verifyRegistrationCodeAction({ email, otp })
      if ('error' in result) {
        setError(t(VERIFY_CODE_ERROR_KEY[result.error] ?? 'verifyCode.errorGeneric'))
        return
      }
      setStep('password')
    } finally {
      setSubmitting(false)
    }
  }

  function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (passwordsMismatch) {
      setError(t('errors.passwordMismatch'))
      return
    }
    if (!policyMet) {
      setError(t('errors.passwordComplexity'))
      return
    }
    setError(null)
    setStep('name')
  }

  async function handleNameSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!consentSatisfied) return
    setError(null)
    setSubmitting(true)
    try {
      const result = await completeRegistrationAction({
        clientId,
        email,
        otp,
        password,
        firstName,
        lastName,
        ...(hasDefaultOrg ? {} : { companyName }),
        ...(privacyPolicyUrl ? { acceptedPrivacyPolicy } : {}),
        ...(termsUrl ? { acceptedTerms } : {}),
        ...(gdprUrl ? { acceptedGdpr } : {}),
        marketingOptIn,
        ...(next ? { next } : {}),
      })
      if ('error' in result) {
        if (result.error === 'OTP_EXPIRED') {
          // The code expired while filling in password/name. Resend a fresh
          // one and bounce back to the code step — password/name stay in
          // this component's state, so nothing typed is lost.
          await startRegistrationAction({ clientId, email })
          setOtp('')
          setError(t('verifyCode.errorExpired'))
          setStep('code')
          return
        }
        setError(t(`errors.${result.error}`))
        return
      }
      if (result.redirectUrl) {
        window.location.href = result.redirectUrl
        return
      }
      router.push('/signup/verified')
    } finally {
      setSubmitting(false)
    }
  }

  if (step === 'email') {
    return (
      <form onSubmit={handleEmailSubmit} className="flex flex-col gap-4">
        <FormField
          id="email"
          type="email"
          autoComplete="email"
          label={t('email')}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
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
    )
  }

  if (step === 'code') {
    return (
      <form onSubmit={handleCodeSubmit} className="flex flex-col gap-4">
        <p className="text-body-md text-muted-foreground">{t('verifyCode.subtitle', { email })}</p>
        <FormField
          id="otp"
          inputMode="numeric"
          autoComplete="one-time-code"
          required
          label={t('verifyCode.codeLabel')}
          value={otp}
          onChange={(e) => setOtp(e.target.value)}
        />
        {error && (
          <p data-testid="signup-error" className="text-label-md text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" loading={submitting} disabled={submitting || otp.length !== 6}>
          {t('verifyCode.submit')}
        </Button>
      </form>
    )
  }

  if (step === 'password') {
    return (
      <form onSubmit={handlePasswordSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <FormField
            id="password"
            type="password"
            label={t('password')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            showPasswordLabel={t('common.showPassword')}
            hidePasswordLabel={t('common.hidePassword')}
            required
          />
          <PasswordStrengthMeter password={password} policy={policy} />
          <PasswordRequirementsChecklist password={password} policy={policy} />
        </div>
        <FormField
          id="confirm-password"
          type="password"
          label={t('confirmPassword')}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={passwordsMismatch ? t('errors.passwordMismatch') : undefined}
          showPasswordLabel={t('common.showPassword')}
          hidePasswordLabel={t('common.hidePassword')}
          required
        />
        {error && (
          <p data-testid="signup-error" className="text-label-md text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={!policyMet || password !== confirm || password.length === 0}>
          {t('continue')}
        </Button>
      </form>
    )
  }

  return (
    <form onSubmit={handleNameSubmit} className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4">
        <FormField id="firstName" label={t('firstName')} value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
        <FormField id="lastName" label={t('lastName')} value={lastName} onChange={(e) => setLastName(e.target.value)} required />
      </div>
      {!hasDefaultOrg && (
        <FormField id="companyName" label={t('companyName')} value={companyName} onChange={(e) => setCompanyName(e.target.value)} required />
      )}
      <label className="flex items-start gap-2 text-body-sm text-foreground">
        <input type="checkbox" checked={marketingOptIn} onChange={(e) => setMarketingOptIn(e.target.checked)} />
        <span>{t('marketingOptIn')}</span>
      </label>
      {privacyPolicyUrl && (
        <label className="flex items-start gap-2 text-body-sm text-foreground">
          <input type="checkbox" checked={acceptedPrivacyPolicy} onChange={(e) => setAcceptedPrivacyPolicy(e.target.checked)} required />
          <span>
            {t.rich('acceptPrivacyPolicy', {
              link: (chunks) => (
                <a href={privacyPolicyUrl} target="_blank" rel="noopener noreferrer" className="underline">
                  {chunks}
                </a>
              ),
            })}
          </span>
        </label>
      )}
      {termsUrl && (
        <label className="flex items-start gap-2 text-body-sm text-foreground">
          <input type="checkbox" checked={acceptedTerms} onChange={(e) => setAcceptedTerms(e.target.checked)} required />
          <span>
            {t.rich('acceptTerms', {
              link: (chunks) => (
                <a href={termsUrl} target="_blank" rel="noopener noreferrer" className="underline">
                  {chunks}
                </a>
              ),
            })}
          </span>
        </label>
      )}
      {gdprUrl && (
        <label className="flex items-start gap-2 text-body-sm text-foreground">
          <input type="checkbox" checked={acceptedGdpr} onChange={(e) => setAcceptedGdpr(e.target.checked)} required />
          <span>
            {t.rich('acceptGdpr', {
              link: (chunks) => (
                <a href={gdprUrl} target="_blank" rel="noopener noreferrer" className="underline">
                  {chunks}
                </a>
              ),
            })}
          </span>
        </label>
      )}
      {error && (
        <p data-testid="signup-error" className="text-label-md text-destructive">
          {error}
        </p>
      )}
      <Button
        type="submit"
        className="w-full"
        loading={submitting}
        disabled={
          submitting ||
          !consentSatisfied ||
          (!hasDefaultOrg && companyName.trim() === '') ||
          firstName.trim() === '' ||
          lastName.trim() === ''
        }
      >
        {t('submit')}
      </Button>
    </form>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @sassy-auth/admin test -- signup-wizard.test`
Expected: PASS, all 6 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/app/signup/signup-wizard.tsx apps/admin/app/signup/__tests__/signup-wizard.test.tsx
git commit -m "feat(admin): add SignupWizard for code-first signup"
```

---

### Task 13: Branch `/signup/page.tsx` on `emailVerificationMethod`

**Files:**
- Modify: `apps/admin/app/signup/page.tsx`
- Modify: `apps/admin/app/signup/__tests__/page.test.tsx`

- [ ] **Step 1: Update the existing test fixture and add new tests**

In `apps/admin/app/signup/__tests__/page.test.tsx`, the `BASE_APP_INFO`-shaped fixture (wherever `fetchAppInfo` is mocked to resolve) needs `emailVerificationMethod: 'link'` added if it isn't already there from the prior feature (per `MEMORY.md`/earlier work, it should already be present — verify by searching the file for `emailVerificationMethod` first; if found, it's already covered and this step is a no-op for existing tests). Then add:

```tsx
jest.mock('../signup-wizard', () => ({
  SignupWizard: () => <div data-testid="signup-wizard" />,
}))

jest.mock('../signup-form', () => ({
  SignupForm: () => <div data-testid="signup-form" />,
}))
```

alongside this file's existing mocks, and add two new tests to the `describe('SignupPage', ...)` block (or equivalent top-level describe — match whatever this file currently uses):

```tsx
  it('renders SignupForm when the app uses the link verification method', async () => {
    mockFetchAppInfo.mockResolvedValue({ ...BASE_APP_INFO, emailVerificationMethod: 'link' })
    const ui = await SignupPage({ searchParams: Promise.resolve({ client_id: 'sq_1' }) })
    render(ui)
    expect(screen.getByTestId('signup-form')).toBeInTheDocument()
    expect(screen.queryByTestId('signup-wizard')).not.toBeInTheDocument()
  })

  it('renders SignupWizard when the app uses the code verification method', async () => {
    mockFetchAppInfo.mockResolvedValue({ ...BASE_APP_INFO, emailVerificationMethod: 'code' })
    const ui = await SignupPage({ searchParams: Promise.resolve({ client_id: 'sq_1' }) })
    render(ui)
    expect(screen.getByTestId('signup-wizard')).toBeInTheDocument()
    expect(screen.queryByTestId('signup-form')).not.toBeInTheDocument()
  })
```

(Inspect the file first to match its existing mock/import conventions exactly — e.g. if `fetchAppInfo` is already mocked via `jest.mock('@/lib/app-info', ...)` with a `mockFetchAppInfo` alias, reuse that exact binding rather than introducing a second one.)

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `pnpm --filter @sassy-auth/admin test -- signup/__tests__/page.test`
Expected: FAIL on the two new tests — `page.tsx` always renders `SignupForm` today, regardless of `emailVerificationMethod`.

- [ ] **Step 3: Implement**

In `apps/admin/app/signup/page.tsx`:

Find:
```ts
import { fetchAppInfo } from '@/lib/app-info'
import { SignupForm } from './signup-form'
```
Replace with:
```ts
import { fetchAppInfo } from '@/lib/app-info'
import { SignupForm } from './signup-form'
import { SignupWizard } from './signup-wizard'
```

Find:
```ts
  const { name: appName, hasDefaultOrg, passwordPolicy, logo, privacyPolicyUrl, termsUrl, gdprUrl, gdprRequired } =
    await fetchAppInfo(clientId)
  const nextSafe = next ?? ''
```
Replace with:
```ts
  const { name: appName, hasDefaultOrg, passwordPolicy, logo, privacyPolicyUrl, termsUrl, gdprUrl, gdprRequired, emailVerificationMethod } =
    await fetchAppInfo(clientId)
  const nextSafe = next ?? ''
```

Find:
```tsx
      <SignupForm
        clientId={clientId}
        next={nextSafe}
        hasDefaultOrg={hasDefaultOrg}
        passwordPolicy={passwordPolicy}
        privacyPolicyUrl={privacyPolicyUrl}
        termsUrl={termsUrl}
        gdprUrl={gdprRequired ? gdprUrl : null}
      />
    </AuthCard>
  )
}
```
Replace with:
```tsx
      {emailVerificationMethod === 'code' ? (
        <SignupWizard
          clientId={clientId}
          next={nextSafe}
          hasDefaultOrg={hasDefaultOrg}
          passwordPolicy={passwordPolicy}
          privacyPolicyUrl={privacyPolicyUrl}
          termsUrl={termsUrl}
          gdprUrl={gdprRequired ? gdprUrl : null}
        />
      ) : (
        <SignupForm
          clientId={clientId}
          next={nextSafe}
          hasDefaultOrg={hasDefaultOrg}
          passwordPolicy={passwordPolicy}
          privacyPolicyUrl={privacyPolicyUrl}
          termsUrl={termsUrl}
          gdprUrl={gdprRequired ? gdprUrl : null}
        />
      )}
    </AuthCard>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @sassy-auth/admin test -- signup/__tests__/page.test`
Expected: PASS, all tests including the two new ones.

Run: `pnpm --filter @sassy-auth/admin typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/app/signup/page.tsx apps/admin/app/signup/__tests__/page.test.tsx
git commit -m "feat(admin): render SignupWizard instead of SignupForm for code-method apps"
```

---

### Task 14: Remove the now-dead `VerifyCodeCard` branch from `/signup/check-email`

**Files:**
- Modify: `apps/admin/app/signup/check-email/page.tsx`
- Modify: `apps/admin/app/signup/check-email/__tests__/page.test.tsx`
- Delete: `apps/admin/app/signup/check-email/verify-code-card.tsx`
- Delete: `apps/admin/app/signup/check-email/__tests__/verify-code-card.test.tsx`

Once Task 13 ships, a `code`-method app's signup never reaches `/signup/check-email` at all — the whole wizard runs on `/signup` and only ever navigates to `/signup/verified` on success. `VerifyCodeCard` becomes unreachable. `link`-method apps are unaffected by this task; they still always render `CheckEmailCard`.

- [ ] **Step 1: Update the test first**

In `apps/admin/app/signup/check-email/__tests__/page.test.tsx`:

Find:
```tsx
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

Replace with:
```tsx
jest.mock('../check-email-card', () => ({
  CheckEmailCard: () => <div data-testid="check-email-card" />,
}))

const mockFetchAppInfo = fetchAppInfo as jest.MockedFunction<typeof fetchAppInfo>

beforeEach(() => {
  jest.clearAllMocks()
})

describe('CheckEmailPage', () => {
  it('shows the missing-email message when no email is given', async () => {
    const ui = await CheckEmailPage({ searchParams: Promise.resolve({}) })
    render(ui)
    expect(screen.getByText('signup.checkEmail.missingEmail')).toBeInTheDocument()
  })

  it('always renders CheckEmailCard — code-method apps never reach this page (see signup-wizard.tsx)', async () => {
    const ui = await CheckEmailPage({ searchParams: Promise.resolve({ email: 'a@x.com' }) })
    render(ui)
    expect(screen.getByTestId('check-email-card')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @sassy-auth/admin test -- signup/check-email/__tests__/page.test`
Expected: FAIL — `page.tsx` still imports `fetchAppInfo`/`VerifyCodeCard` and branches on `clientId`, so the simplified test expectations don't yet match (specifically, the first test's `mockFetchAppInfo` assertion is gone, which is fine, but the page itself hasn't been simplified yet — this is mainly a safety check that nothing currently-passing breaks for the wrong reason before Step 3).

Delete the now-orphaned test file for the removed component:

```bash
git rm apps/admin/app/signup/check-email/__tests__/verify-code-card.test.tsx
```

- [ ] **Step 3: Implement**

Read the current `apps/admin/app/signup/check-email/page.tsx` and replace it with the simplified version:

```tsx
import { getTranslations } from 'next-intl/server'
import { AuthCard } from '@sassy-auth/ui'
import { CheckEmailCard } from './check-email-card'

export const dynamic = 'force-dynamic'

const PUBLIC_AUTH_SERVER =
  process.env.PUBLIC_AUTH_SERVER_URL ?? process.env.AUTH_SERVER_URL ?? 'https://localhost:3010'

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

  // code-method apps verify entirely within /signup (see signup-wizard.tsx)
  // and never navigate here — this page now always serves the link flow.
  return <CheckEmailCard email={email} next={next ?? ''} authServerUrl={PUBLIC_AUTH_SERVER} />
}
```

Delete the now-unused component:

```bash
git rm apps/admin/app/signup/check-email/verify-code-card.tsx
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @sassy-auth/admin test -- signup/check-email/__tests__/page.test`
Expected: PASS, both tests.

Run the full admin test suite to catch any other reference to `VerifyCodeCard` or the removed `clientId` search param on this page:

Run: `pnpm --filter @sassy-auth/admin test`
Expected: PASS. If anything else references `verify-code-card` or `emailVerificationMethod` on this specific page, fix it at this point — search first with `grep -rn "verify-code-card\|VerifyCodeCard" apps/admin` to confirm nothing remains.

Run: `pnpm --filter @sassy-auth/admin typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/app/signup/check-email/page.tsx apps/admin/app/signup/check-email/__tests__/page.test.tsx
git commit -m "refactor(admin): remove the now-unreachable VerifyCodeCard branch from /signup/check-email"
```

---

### Task 15: Full-suite sanity pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full backend suite**

Run: `pnpm --filter @sassy-auth/auth-server test`
Expected: PASS.

- [ ] **Step 2: Run the full frontend suite**

Run: `pnpm --filter @sassy-auth/admin test`
Expected: PASS.

- [ ] **Step 3: Typecheck both**

Run: `pnpm --filter @sassy-auth/auth-server typecheck && pnpm --filter @sassy-auth/admin typecheck`
Expected: PASS.

- [ ] **Step 4: Manual smoke test against the local stack**

Rebuild and restart both services (see the project's `make start-no-watch`), then in a browser:
1. Set VibeCast's (or a test app's) `emailVerificationMethod` to `code` via the admin console's app-edit drawer.
2. Visit `/signup?client_id=<that app>` — confirm only an email field + Continue button renders.
3. Submit a real email you can read — confirm a 6-digit code arrives and the wizard advances to the code step.
4. Enter a wrong code — confirm an inline error, and that trying again works.
5. Enter the correct code — confirm the password step renders, with the strength meter and checklist.
6. Set a valid password, continue to the name step, fill it in, and submit — confirm it lands on `/signup/verified` (or redirects to the relying app, if tested with `next`).
7. Visit `/signup/check-email?email=...` directly (no `clientId`) — confirm it still renders `CheckEmailCard`, unaffected.

No `- [ ] Commit` for this task — it's verification only, not a code change.
