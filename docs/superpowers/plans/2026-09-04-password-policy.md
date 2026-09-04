# Configurable Password Complexity Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded, triplicated password-complexity rule (12 chars + upper/lower/digit) with a policy that's configurable via `.env` globally and fully overridable per `SaApp`, enforced identically across self-serve signup, accept-invitation, and forgot-password reset — closing the existing gap where BetterAuth's `/reset-password` endpoint has no server-side complexity enforcement at all.

**Architecture:** A dependency-free `PasswordPolicy` type and `evaluatePasswordPolicy()` pure function live in `packages/types`, shared by `apps/auth-server` (enforcement) and `apps/admin` (live requirements checklist). `apps/auth-server` adds a `password-policy.ts` module that reads the global env-driven default and resolves a per-app override (`SaApp.passwordPolicyOverride`, a nullable JSON column — null means "inherit global"). All three password-setting code paths (register, accept-invite, BetterAuth's `/reset-password` via a new `hooks.before` matcher) funnel through the same `validatePasswordOrThrow`. The admin console gets a collapsible "Password Policy" section in the existing app-edit drawer, and a new shared `PasswordRequirementsChecklist` component replaces the three duplicated inline regex checks in the signup/accept-invite/reset-password forms.

**Tech Stack:** NestJS (auth-server), Next.js 15 / React (admin), Prisma, class-validator, Jest, next-intl.

---

## Spec

Full design: `docs/superpowers/specs/2026-09-04-password-policy-design.md`

## Task Dependency Order

1. Shared type + pure evaluator (`packages/types`)
2. Server-side policy module (`apps/auth-server`) — env parsing, resolution, enforcement
3. Prisma schema + migration
4. Env files
5. Self-serve signup enforcement
6. Accept-invitation enforcement
7. Forgot-password reset enforcement (the gap-closer) + new public policy endpoint
8. Admin API: per-app override (DTO, service, formatting)
9. Admin UI: shared types, checklist component, drawer section
10. Admin UI: wire the three password-setting forms to the checklist
11. i18n
12. E2E

Each numbered item below is one task with its own tests-first steps.

---

### Task 1: Shared `PasswordPolicy` type and pure evaluator

**Files:**
- Modify: `packages/types/index.ts`
- Test: `apps/auth-server/src/auth/password-policy-evaluator.spec.ts` (packages/types has no Jest config of its own; auth-server already depends on `@sassy-auth/types` and has Jest wired, so the pure function is exercised from there — see Task 2 for why the resolver/enforcement tests live alongside it in the same file's sibling)

- [ ] **Step 1: Add the type and function to `packages/types/index.ts`**

Append to the end of the file:

```ts
/** The complete set of password-complexity knobs. An app either inherits the
 * global policy or defines a complete override — there is no per-field mix. */
export interface PasswordPolicy {
  minLength: number
  requireUppercase: boolean
  requireLowercase: boolean
  requireNumber: boolean
  requireSpecial: boolean
  /** Only meaningful when requireNumber is true. */
  minNumbers: number
  /** Only meaningful when requireSpecial is true. */
  minSpecial: number
}

export type PasswordRuleKey =
  | 'minLength'
  | 'requireUppercase'
  | 'requireLowercase'
  | 'requireNumber'
  | 'requireSpecial'
  | 'minNumbers'
  | 'minSpecial'

export interface PasswordRuleResult {
  rule: PasswordRuleKey
  met: boolean
}

const SPECIAL_CHAR_PATTERN = /[!"#$%&'()*+,\-./:;<=>?@[\]^_`{|}~]/g

function countMatches(password: string, pattern: RegExp): number {
  return (password.match(pattern) ?? []).length
}

/**
 * Pure, dependency-free. Evaluates every rule (does not short-circuit) so
 * callers can report or render every failure, not just the first one hit.
 */
export function evaluatePasswordPolicy(
  password: string,
  policy: PasswordPolicy,
): PasswordRuleResult[] {
  const numberCount = countMatches(password, /[0-9]/g);
  const specialCount = countMatches(password, SPECIAL_CHAR_PATTERN);

  const results: PasswordRuleResult[] = [
    { rule: 'minLength', met: password.length >= policy.minLength },
  ];
  if (policy.requireUppercase) {
    results.push({ rule: 'requireUppercase', met: /[A-Z]/.test(password) });
  }
  if (policy.requireLowercase) {
    results.push({ rule: 'requireLowercase', met: /[a-z]/.test(password) });
  }
  if (policy.requireNumber) {
    results.push({ rule: 'requireNumber', met: numberCount >= 1 });
    if (policy.minNumbers > 1) {
      results.push({ rule: 'minNumbers', met: numberCount >= policy.minNumbers });
    }
  }
  if (policy.requireSpecial) {
    results.push({ rule: 'requireSpecial', met: specialCount >= 1 });
    if (policy.minSpecial > 1) {
      results.push({ rule: 'minSpecial', met: specialCount >= policy.minSpecial });
    }
  }
  return results;
}
```

- [ ] **Step 2: Build `packages/types` so the compiled `dist/` picks up the new exports**

Run: `pnpm --filter @sassy-auth/types build`
Expected: exits 0, `packages/types/dist/index.d.ts` now contains `PasswordPolicy`.

- [ ] **Step 3: Write the failing test for `evaluatePasswordPolicy`**

Create `apps/auth-server/src/auth/password-policy-evaluator.spec.ts`:

```ts
import { evaluatePasswordPolicy, PasswordPolicy } from '@sassy-auth/types';

const DEFAULT_POLICY: PasswordPolicy = {
  minLength: 12,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  requireSpecial: false,
  minNumbers: 1,
  minSpecial: 0,
};

function failedRules(password: string, policy: PasswordPolicy): string[] {
  return evaluatePasswordPolicy(password, policy)
    .filter((r) => !r.met)
    .map((r) => r.rule);
}

describe('evaluatePasswordPolicy', () => {
  it('passes a password meeting every default-policy rule', () => {
    expect(failedRules('Str0ngPassword', DEFAULT_POLICY)).toEqual([]);
  });

  it('fails minLength for a short password', () => {
    expect(failedRules('Sh0rt', DEFAULT_POLICY)).toContain('minLength');
  });

  it('fails requireUppercase when there is no uppercase letter', () => {
    expect(failedRules('alllowercase123', DEFAULT_POLICY)).toContain('requireUppercase');
  });

  it('fails requireLowercase when there is no lowercase letter', () => {
    expect(failedRules('ALLUPPERCASE123', DEFAULT_POLICY)).toContain('requireLowercase');
  });

  it('fails requireNumber when there is no digit', () => {
    expect(failedRules('NoDigitsHereABC', DEFAULT_POLICY)).toContain('requireNumber');
  });

  it('does not require special characters when requireSpecial is false', () => {
    expect(failedRules('NoSpecialChars123', DEFAULT_POLICY)).toEqual([]);
  });

  it('fails requireSpecial when the policy requires one and none is present', () => {
    const policy: PasswordPolicy = { ...DEFAULT_POLICY, requireSpecial: true };
    expect(failedRules('NoSpecialChars123', policy)).toContain('requireSpecial');
  });

  it('passes requireSpecial when a special character is present', () => {
    const policy: PasswordPolicy = { ...DEFAULT_POLICY, requireSpecial: true };
    expect(failedRules('HasSpecial123!', policy)).toEqual([]);
  });

  it('fails minNumbers when fewer digits than required are present', () => {
    const policy: PasswordPolicy = { ...DEFAULT_POLICY, minNumbers: 3 };
    expect(failedRules('OnlyOneDigit1', policy)).toContain('minNumbers');
  });

  it('passes minNumbers when enough digits are present', () => {
    const policy: PasswordPolicy = { ...DEFAULT_POLICY, minNumbers: 3 };
    expect(failedRules('ThreeDigits123', policy)).toEqual([]);
  });

  it('fails minSpecial when fewer special characters than required are present', () => {
    const policy: PasswordPolicy = { ...DEFAULT_POLICY, requireSpecial: true, minSpecial: 2 };
    expect(failedRules('OnlyOneSpecial1!', policy)).toContain('minSpecial');
  });

  it('reports every failed rule at once, not just the first', () => {
    const policy: PasswordPolicy = { ...DEFAULT_POLICY, requireSpecial: true };
    const failed = failedRules('short', policy);
    expect(failed).toEqual(
      expect.arrayContaining(['minLength', 'requireUppercase', 'requireNumber', 'requireSpecial']),
    );
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm --filter @sassy-auth/auth-server test -- password-policy-evaluator.spec.ts`
Expected: FAIL — `evaluatePasswordPolicy` does not exist (before Step 1) or module resolution error if `@sassy-auth/types` wasn't rebuilt. If Step 1–2 are already done, this step instead confirms PASS; run it before Step 1 in your working copy if you want to see the true red state.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @sassy-auth/auth-server test -- password-policy-evaluator.spec.ts`
Expected: PASS, 12 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/types/index.ts packages/types/dist apps/auth-server/src/auth/password-policy-evaluator.spec.ts
git commit -m "feat(types): add PasswordPolicy type and evaluatePasswordPolicy"
```

---

### Task 2: Server-side policy resolution and enforcement module

**Files:**
- Create: `apps/auth-server/src/auth/password-policy.ts`
- Test: `apps/auth-server/src/auth/password-policy.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/auth-server/src/auth/password-policy.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { PasswordPolicy } from '@sassy-auth/types';
import {
  MAX_PASSWORD_LENGTH,
  getGlobalPasswordPolicy,
  resolvePasswordPolicy,
  validatePasswordOrThrow,
} from './password-policy';

describe('getGlobalPasswordPolicy', () => {
  it('returns the bug-0280-compatible defaults when no env vars are set', () => {
    expect(getGlobalPasswordPolicy({})).toEqual<PasswordPolicy>({
      minLength: 12,
      requireUppercase: true,
      requireLowercase: true,
      requireNumber: true,
      requireSpecial: false,
      minNumbers: 1,
      minSpecial: 0,
    });
  });

  it('reads every knob from its env var when set', () => {
    const env = {
      PASSWORD_MIN_LENGTH: '16',
      PASSWORD_REQUIRE_UPPERCASE: 'false',
      PASSWORD_REQUIRE_LOWERCASE: 'true',
      PASSWORD_REQUIRE_NUMBER: 'true',
      PASSWORD_REQUIRE_SPECIAL: 'true',
      PASSWORD_MIN_NUMBERS: '2',
      PASSWORD_MIN_SPECIAL: '1',
    };
    expect(getGlobalPasswordPolicy(env)).toEqual<PasswordPolicy>({
      minLength: 16,
      requireUppercase: false,
      requireLowercase: true,
      requireNumber: true,
      requireSpecial: true,
      minNumbers: 2,
      minSpecial: 1,
    });
  });
});

describe('resolvePasswordPolicy', () => {
  const env = {};

  it('returns the global policy when passwordPolicyOverride is null', () => {
    const app = { passwordPolicyOverride: null };
    expect(resolvePasswordPolicy(app, env)).toEqual(getGlobalPasswordPolicy(env));
  });

  it('returns the override verbatim when present', () => {
    const override: PasswordPolicy = {
      minLength: 20,
      requireUppercase: false,
      requireLowercase: false,
      requireNumber: false,
      requireSpecial: true,
      minNumbers: 0,
      minSpecial: 3,
    };
    const app = { passwordPolicyOverride: override };
    expect(resolvePasswordPolicy(app, env)).toEqual(override);
  });
});

describe('validatePasswordOrThrow', () => {
  const policy: PasswordPolicy = {
    minLength: 12,
    requireUppercase: true,
    requireLowercase: true,
    requireNumber: true,
    requireSpecial: false,
    minNumbers: 1,
    minSpecial: 0,
  };

  it('does not throw for a password that satisfies the policy', () => {
    expect(() => validatePasswordOrThrow('Str0ngPassword', policy)).not.toThrow();
  });

  it('throws BadRequestException with every failed rule when the policy is violated', () => {
    try {
      validatePasswordOrThrow('short', policy);
      fail('expected validatePasswordOrThrow to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      const response = (e as BadRequestException).getResponse() as {
        errorKey: string;
        failedRules: string[];
      };
      expect(response.errorKey).toBe('password.policyViolation');
      expect(response.failedRules).toEqual(
        expect.arrayContaining(['minLength', 'requireUppercase', 'requireNumber']),
      );
    }
  });

  it('throws when the password exceeds MAX_PASSWORD_LENGTH regardless of policy', () => {
    const longPassword = 'Aa1'.repeat(100); // 300 chars, satisfies every complexity rule
    expect(longPassword.length).toBeGreaterThan(MAX_PASSWORD_LENGTH);
    try {
      validatePasswordOrThrow(longPassword, policy);
      fail('expected validatePasswordOrThrow to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      const response = (e as BadRequestException).getResponse() as { failedRules: string[] };
      expect(response.failedRules).toContain('maxLength');
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @sassy-auth/auth-server test -- password-policy.spec.ts`
Expected: FAIL — `./password-policy` module not found.

- [ ] **Step 3: Implement `apps/auth-server/src/auth/password-policy.ts`**

```ts
import { BadRequestException } from '@nestjs/common';
import { evaluatePasswordPolicy, PasswordPolicy, PasswordRuleKey } from '@sassy-auth/types';

/**
 * Fixed security floor, not a policy knob — bounds the scrypt hashing cost
 * an unauthenticated caller can force per request (bug-0184's rationale,
 * now applied uniformly across every password-setting surface instead of
 * only accept-invite).
 */
export const MAX_PASSWORD_LENGTH = 256;

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value.toLowerCase() === 'true';
}

function parseInt10(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

/**
 * Global default policy, read from env. Defaults reproduce the exact
 * bug-0280 policy (12/upper/lower/number required, no special-char
 * requirement) so this change is behavior-neutral for any app that never
 * opts into an override.
 */
export function getGlobalPasswordPolicy(env: NodeJS.ProcessEnv | Record<string, string | undefined>): PasswordPolicy {
  return {
    minLength: parseInt10(env['PASSWORD_MIN_LENGTH'], 12),
    requireUppercase: parseBool(env['PASSWORD_REQUIRE_UPPERCASE'], true),
    requireLowercase: parseBool(env['PASSWORD_REQUIRE_LOWERCASE'], true),
    requireNumber: parseBool(env['PASSWORD_REQUIRE_NUMBER'], true),
    requireSpecial: parseBool(env['PASSWORD_REQUIRE_SPECIAL'], false),
    minNumbers: parseInt10(env['PASSWORD_MIN_NUMBERS'], 1),
    minSpecial: parseInt10(env['PASSWORD_MIN_SPECIAL'], 0),
  };
}

/**
 * null passwordPolicyOverride → inherit the global policy. Non-null → a
 * complete PasswordPolicy that fully replaces the global one — no
 * per-field mix (see design spec §4).
 */
export function resolvePasswordPolicy(
  app: { passwordPolicyOverride: unknown },
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): PasswordPolicy {
  if (app.passwordPolicyOverride) {
    return app.passwordPolicyOverride as PasswordPolicy;
  }
  return getGlobalPasswordPolicy(env);
}

/** Throws BadRequestException({ errorKey, failedRules }) listing every
 * violated rule (plus 'maxLength' as a synthetic rule key) if the password
 * fails. Every password-setting surface calls this exactly once. */
export function validatePasswordOrThrow(password: string, policy: PasswordPolicy): void {
  const failedRules: Array<PasswordRuleKey | 'maxLength'> = evaluatePasswordPolicy(password, policy)
    .filter((r) => !r.met)
    .map((r) => r.rule);
  if (password.length > MAX_PASSWORD_LENGTH) {
    failedRules.push('maxLength');
  }
  if (failedRules.length > 0) {
    throw new BadRequestException({ errorKey: 'password.policyViolation', failedRules });
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @sassy-auth/auth-server test -- password-policy.spec.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/auth/password-policy.ts apps/auth-server/src/auth/password-policy.spec.ts
git commit -m "feat(auth-server): add password policy resolution and enforcement"
```

---

### Task 3: Prisma schema — `SaApp.passwordPolicyOverride`

**Files:**
- Modify: `packages/db/schema.prisma:113-130`
- Create: migration under `packages/db/migrations/`

- [ ] **Step 1: Add the column to the schema**

In `packages/db/schema.prisma`, inside `model SaApp { ... }` (currently lines 113–130), add after `isPlatform`:

```prisma
model SaApp {
  id          Int            @id @default(autoincrement())
  publicId    String         @unique
  name        String         @unique
  url         String
  twoFactorTrustDays Int?
  requireTwoFactor   Boolean        @default(false)
  isPlatform         Boolean        @default(false)
  /// Complete PasswordPolicy JSON override (see @sassy-auth/types). null
  /// means "inherit the global env-derived policy" — never partial.
  passwordPolicyOverride Json?
  // Presence of a secret hash is what makes a client confidential. There is no
  // separate client-type flag, so the two cannot contradict each other.
  clientSecretHash      String?
  clientSecretUpdatedAt DateTime?
  orgs        SaOrg[]
  permissions SaPermission[]
  roles       SaRole[]
  redirectUris    SaAppRedirectUri[]
  socialProviders SaSocialProvider[]
}
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm --filter @sassy-auth/db exec prisma migrate dev --name add_password_policy_override`
Expected: exits 0; a new folder `packages/db/migrations/<timestamp>_add_password_policy_override/migration.sql` is created containing `ALTER TABLE "SaApp" ADD COLUMN "passwordPolicyOverride" JSONB;`.

- [ ] **Step 3: Verify the Prisma client regenerated with the new field**

Run: `pnpm --filter @sassy-auth/db exec prisma generate`
Expected: exits 0. Confirm by grepping the generated client types:

Run: `grep -n "passwordPolicyOverride" node_modules/.pnpm/@prisma+client*/node_modules/.prisma/client/index.d.ts | head -3`
Expected: at least one match referencing `SaApp`.

- [ ] **Step 4: Commit**

```bash
git add packages/db/schema.prisma packages/db/migrations
git commit -m "feat(db): add SaApp.passwordPolicyOverride nullable JSON column"
```

---

### Task 4: Env files

**Files:**
- Modify: `.env.example`
- Modify: `.env.local`
- Modify: `apps/auth-server/.env`

- [ ] **Step 1: Add the seven new vars to `.env.example`**

Find the existing password-related block (near `SEED_ADMIN_PASSWORD` / `E2E_ADMIN_PASSWORD`, around line 146) and add a new section immediately before it:

```
# Global password complexity policy for every self-serve signup,
# accept-invitation, and forgot-password reset. Any SaApp can fully override
# this via the admin console's app edit drawer (Password Policy section).
# Defaults below reproduce the policy hardcoded prior to this feature.
PASSWORD_MIN_LENGTH=12
PASSWORD_REQUIRE_UPPERCASE=true
PASSWORD_REQUIRE_LOWERCASE=true
PASSWORD_REQUIRE_NUMBER=true
PASSWORD_REQUIRE_SPECIAL=false
PASSWORD_MIN_NUMBERS=1
PASSWORD_MIN_SPECIAL=0

```

- [ ] **Step 2: Add the same block to `.env.local` and `apps/auth-server/.env`**

Insert the identical seven-line block (values may match `.env.example`'s defaults) into both files, in the same relative position (near any existing password/seed-related vars). These are real local dev env files, not templates — the auth server reads `PASSWORD_MIN_LENGTH` etc. directly via `process.env`, so without this the local dev server would only see `undefined` and fall back to the in-code defaults (which happen to match, but every other env var in this repo is set explicitly in these files rather than relying on code fallback — follow that convention).

- [ ] **Step 3: Verify no other real `.env`/`.env.example` files were missed**

Run: `git status --short | grep -i '\.env'`
Expected: only `.env.example`, `.env.local`, and `apps/auth-server/.env` show as modified. (`apps/resource-server-fastapi/.env*` is a separate service unrelated to auth-server's password policy — leave untouched. Anything under `.worktrees/` is a separate checkout — leave untouched.)

- [ ] **Step 4: Commit**

```bash
git add .env.example .env.local apps/auth-server/.env
git commit -m "chore(env): add PASSWORD_* password policy config vars"
```

---

### Task 5: Self-serve signup enforcement

**Files:**
- Modify: `apps/auth-server/src/registration/register.dto.ts`
- Modify: `apps/auth-server/src/registration/register.dto.spec.ts`
- Modify: `apps/auth-server/src/registration/registration.service.ts`
- Modify: `apps/auth-server/src/registration/registration.service.spec.ts`
- Modify: `apps/auth-server/src/registration/registration.controller.ts`
- Modify: `apps/auth-server/src/registration/registration.controller.spec.ts`

- [ ] **Step 1: Replace the DTO's hardcoded complexity test with a shape-only test**

Replace `apps/auth-server/src/registration/register.dto.spec.ts` entirely:

```ts
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { RegisterDto } from './register.dto';

const BASE = {
  email: 'alice@example.com',
  firstName: 'Alice',
  lastName: 'Wonder',
  companyName: 'Acme Inc',
  appPublicId: 'sq_1',
};

function validate(password: unknown) {
  const dto = plainToInstance(RegisterDto, { ...BASE, password });
  return validateSync(dto).filter((e) => e.property === 'password');
}

// Complexity (length/upper/lower/digit/special) is now policy-driven and
// resolved per-app in RegistrationService — see registration.service.spec.ts.
// The DTO only guards shape and the fixed DoS-prevention length cap.
describe('RegisterDto password field', () => {
  it('accepts any non-empty string up to the max length', () => {
    expect(validate('a')).toHaveLength(0);
  });

  it('rejects an empty password', () => {
    expect(validate('').length).toBeGreaterThan(0);
  });

  it('rejects a password over 256 characters', () => {
    expect(validate('a'.repeat(257)).length).toBeGreaterThan(0);
  });

  it('accepts a password at exactly 256 characters', () => {
    expect(validate('a'.repeat(256))).toHaveLength(0);
  });

  it('rejects a non-string password', () => {
    expect(validate(12345678901234).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @sassy-auth/auth-server test -- register.dto.spec.ts`
Expected: FAIL — the `MaxLength(256)`/`MinLength(1)` combination doesn't exist yet on `password` (current DTO has `@MinLength(12)` and `@Matches`, no `@MaxLength`), so "accepts any non-empty string up to the max length" and "rejects a password over 256 characters" fail.

- [ ] **Step 3: Update `register.dto.ts`**

Replace the file:

```ts
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail() email!: string;
  // Complexity (length/upper/lower/digit/special) is policy-driven — resolved
  // per-app and enforced in RegistrationService via validatePasswordOrThrow.
  // MaxLength(256) is the fixed DoS-prevention cap shared by every
  // password-setting surface (see password-policy.ts's MAX_PASSWORD_LENGTH).
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  password!: string;
  @IsString() @MinLength(1) firstName!: string;
  @IsString() @MinLength(1) lastName!: string;
  @IsString() @MinLength(1) companyName!: string;
  @IsString() @MinLength(1) appPublicId!: string;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @sassy-auth/auth-server test -- register.dto.spec.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write the failing service-level policy test**

In `apps/auth-server/src/registration/registration.service.spec.ts`, find the existing mock setup for `prisma.saApp.findUnique` (used to resolve the app in `register()`) and add:

```ts
import { resolvePasswordPolicy } from '../auth/password-policy';

// ...within the existing describe block, alongside other register() tests:

it('rejects a password that fails the resolved policy before creating any account', async () => {
  mockPrisma.saApp.findUnique.mockResolvedValue({ id: 1, publicId: 'sq_1', passwordPolicyOverride: null });

  await expect(
    service.register({
      email: 'weak@example.com',
      password: 'short',
      firstName: 'A',
      lastName: 'B',
      companyName: 'Acme',
      appPublicId: 'sq_1',
    }),
  ).rejects.toMatchObject({ response: { errorKey: 'password.policyViolation' } });

  expect(mockAuth.api.signUpEmail).not.toHaveBeenCalled();
});

it('accepts a password satisfying an app-level override that the global policy would reject', async () => {
  mockPrisma.saApp.findUnique.mockResolvedValue({
    id: 1,
    publicId: 'sq_1',
    passwordPolicyOverride: {
      minLength: 6, requireUppercase: false, requireLowercase: false,
      requireNumber: false, requireSpecial: false, minNumbers: 0, minSpecial: 0,
    },
  });
  mockAuth.api.signUpEmail.mockResolvedValue({ user: { id: 'ba-1' } });
  mockPrisma.user.findUnique.mockResolvedValue({ id: 'ba-1' });
  mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(mockPrisma));
  mockPrisma.saOrg.create.mockResolvedValue({ id: 1 });
  mockPrisma.saOrg.update.mockResolvedValue({ id: 1, publicId: 'sq_org_1' });
  mockPrisma.saUser.create.mockResolvedValue({});

  const result = await service.register({
    email: 'weak@example.com',
    password: 'abc123', // 6 chars, satisfies the override, would fail the global default
    firstName: 'A',
    lastName: 'B',
    companyName: 'Acme',
    appPublicId: 'sq_1',
  });

  expect(result).toEqual({ ok: true, orgPublicId: 'sq_org_1' });
});
```

Adapt the exact mock variable names (`mockPrisma`, `mockAuth`, `service`) to whatever this spec file's existing setup already uses — read the file's top-of-describe `beforeEach`/`jest.mock` block first and match it; do not introduce a second mocking style alongside the existing one.

- [ ] **Step 6: Run the test to verify it fails**

Run: `pnpm --filter @sassy-auth/auth-server test -- registration.service.spec.ts`
Expected: FAIL — `register()` doesn't yet call `validatePasswordOrThrow`, so the weak password isn't rejected before `signUpEmail`.

- [ ] **Step 7: Update `registration.service.ts`**

Add the import and call, right after the existing app-resolution step:

```ts
import { resolvePasswordPolicy, validatePasswordOrThrow } from '../auth/password-policy';
```

In `register()`, immediately after:
```ts
    const app = await prisma.saApp.findUnique({ where: { publicId: dto.appPublicId } });
    if (!app) throw new NotFoundException('App not found');
```
add:
```ts

    // Resolve and enforce the app's effective password policy before ever
    // touching BetterAuth — a rejected password must not create any account.
    validatePasswordOrThrow(dto.password, resolvePasswordPolicy(app));
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm --filter @sassy-auth/auth-server test -- registration.service.spec.ts`
Expected: PASS (all existing tests plus the two new ones).

- [ ] **Step 9: Expose the resolved policy from `GET /api/register/app`**

The signup page fetches app info before the user types anything — it needs the effective policy for the live checklist. Update `registration.service.ts`'s `getAppName`:

```ts
  async getAppName(appPublicId: string): Promise<{ name: string; passwordPolicy: PasswordPolicy }> {
    if (!appPublicId) throw new NotFoundException('App not found');
    const app = await prisma.saApp.findUnique({
      where: { publicId: appPublicId },
      select: { name: true, passwordPolicyOverride: true },
    });
    if (!app) throw new NotFoundException('App not found');
    return { name: app.name, passwordPolicy: resolvePasswordPolicy(app) };
  }
```

Add `import { PasswordPolicy } from '@sassy-auth/types';` to the top of the file.

- [ ] **Step 10: Update `registration.controller.spec.ts`'s `getAppName` test to expect the new field**

Find the existing assertion on `getAppName`'s return value (something like `expect(result).toEqual({ name: 'Acme' })`) and widen it:

```ts
expect(result).toEqual({
  name: 'Acme',
  passwordPolicy: {
    minLength: 12, requireUppercase: true, requireLowercase: true,
    requireNumber: true, requireSpecial: false, minNumbers: 1, minSpecial: 0,
  },
});
```

Adjust the mocked `prisma.saApp.findUnique` return value in that same test to include `passwordPolicyOverride: null`.

- [ ] **Step 11: Run the full registration test suite**

Run: `pnpm --filter @sassy-auth/auth-server test -- registration`
Expected: PASS across `register.dto.spec.ts`, `registration.service.spec.ts`, `registration.controller.spec.ts`.

- [ ] **Step 12: Commit**

```bash
git add apps/auth-server/src/registration
git commit -m "feat(auth-server): enforce configurable password policy on signup"
```

---

### Task 6: Accept-invitation enforcement

**Files:**
- Modify: `apps/auth-server/src/invitations/dto/accept-invitation.dto.ts`
- Modify: `apps/auth-server/src/invitations/dto/accept-invitation.dto.spec.ts`
- Modify: `apps/auth-server/src/invitations/invitations.service.ts`
- Modify: `apps/auth-server/src/invitations/invitations.service.spec.ts`

- [ ] **Step 1: Replace the DTO spec with a shape-only test**

Replace `apps/auth-server/src/invitations/dto/accept-invitation.dto.spec.ts` entirely:

```ts
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { AcceptInvitationDto } from './accept-invitation.dto';

function validate(password: unknown) {
  const dto = plainToInstance(AcceptInvitationDto, { password });
  return validateSync(dto).filter((e) => e.property === 'password');
}

// Complexity is now policy-driven and resolved per-invitation's app in
// InvitationsService — see invitations.service.spec.ts. The DTO only guards
// shape and the fixed DoS-prevention length cap (bug-0184).
describe('AcceptInvitationDto password field', () => {
  it('accepts any non-empty string up to the max length', () => {
    expect(validate('a')).toHaveLength(0);
  });

  it('rejects an empty password', () => {
    expect(validate('').length).toBeGreaterThan(0);
  });

  it('rejects a password over 256 characters', () => {
    expect(validate('a'.repeat(257)).length).toBeGreaterThan(0);
  });

  it('accepts a password at exactly 256 characters', () => {
    expect(validate('a'.repeat(256))).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @sassy-auth/auth-server test -- accept-invitation.dto.spec.ts`
Expected: FAIL — current DTO still has `@MinLength(12)` and `@Matches`, so a 1-char password is rejected.

- [ ] **Step 3: Update `accept-invitation.dto.ts`**

Replace the file:

```ts
import { IsString, MaxLength, MinLength } from 'class-validator';

// Complexity is policy-driven — resolved per-invitation's app and enforced
// in InvitationsService via validatePasswordOrThrow. MaxLength(256) is the
// fixed DoS-prevention cap (bug-0184), shared by every password-setting
// surface (see password-policy.ts's MAX_PASSWORD_LENGTH).
export class AcceptInvitationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  password!: string;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @sassy-auth/auth-server test -- accept-invitation.dto.spec.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write the failing service-level tests**

In `apps/auth-server/src/invitations/invitations.service.spec.ts`, find the existing `describe('acceptInvitation'` block's mock for `prisma.saInvitation.findUnique` (it returns a row shaped by `INVITATION_INCLUDE`) and add app data to the org chain, plus two new tests:

```ts
// Extend INVITATION_INCLUDE's mocked shape wherever it's built in this spec's
// existing tests to also include user.org.appId and a resolvable app, e.g.:
//   user: { ..., org: { appId: 1 } }
// and mock prisma.saApp.findUnique to return { id: 1, passwordPolicyOverride: null }.

it('rejects a password that fails the resolved policy and does not touch any table', async () => {
  mockPrisma.saInvitation.findUnique.mockResolvedValue({
    id: 1, usedAt: null, expiresAt: new Date(Date.now() + 60_000),
    user: { id: 1, publicId: 'sq_u1', org: { appId: 1 }, betterAuthUser: { id: 'ba-1', email: 'a@b.com' } },
  });
  mockPrisma.saApp.findUnique.mockResolvedValue({ id: 1, passwordPolicyOverride: null });

  await expect(service.acceptInvitation('tok', 'short')).rejects.toMatchObject({
    response: { errorKey: 'password.policyViolation' },
  });
  expect(mockPrisma.$transaction).not.toHaveBeenCalled();
});

it('accepts a password satisfying the invitation app\'s override', async () => {
  mockPrisma.saInvitation.findUnique.mockResolvedValue({
    id: 1, usedAt: null, expiresAt: new Date(Date.now() + 60_000),
    user: { id: 1, publicId: 'sq_u1', org: { appId: 1 }, betterAuthUser: { id: 'ba-1', email: 'a@b.com' } },
  });
  mockPrisma.saApp.findUnique.mockResolvedValue({
    id: 1,
    passwordPolicyOverride: {
      minLength: 6, requireUppercase: false, requireLowercase: false,
      requireNumber: false, requireSpecial: false, minNumbers: 0, minSpecial: 0,
    },
  });
  mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(mockPrisma));
  mockPrisma.saInvitation.updateMany.mockResolvedValue({ count: 1 });

  await expect(service.acceptInvitation('tok', 'abc123')).resolves.toBeUndefined();
});
```

Match these to the exact mock/setup names already used at the top of `invitations.service.spec.ts` (read that file's existing `beforeEach` first) rather than introducing a parallel mocking convention.

- [ ] **Step 6: Run the test to verify it fails**

Run: `pnpm --filter @sassy-auth/auth-server test -- invitations.service.spec.ts`
Expected: FAIL — `acceptInvitation` doesn't resolve an app or call `validatePasswordOrThrow` yet, and `INVITATION_INCLUDE` doesn't select `org.appId`.

- [ ] **Step 7: Update `invitations.service.ts`**

Add the app relation to the include, and enforce the policy in both `validateToken` (to expose it) and `acceptInvitation` (to enforce it):

```ts
import { hashPassword } from 'better-auth/crypto';
import * as crypto from 'crypto';
import { PasswordPolicy } from '@sassy-auth/types';
import { resolvePasswordPolicy, validatePasswordOrThrow } from '../auth/password-policy';
import { LoggerService } from '../common/logger/logger.service';

const INVITATION_INCLUDE = {
  user: {
    include: {
      betterAuthUser: { select: { id: true, email: true } },
      org: { select: { appId: true } },
    },
  },
} as const;
```

Update `validateToken` to also resolve and return the policy:

```ts
  async validateToken(token: string): Promise<{ firstName: string; email: string; expired: boolean; passwordPolicy: PasswordPolicy }> {
    const inv = await prisma.saInvitation.findUnique({
      where: { token },
      include: INVITATION_INCLUDE,
    });
    if (!inv) throw new NotFoundException('Invitation not found');

    const expired = inv.usedAt !== null || inv.expiresAt < new Date();
    const app = await prisma.saApp.findUnique({
      where: { id: inv.user.org.appId },
      select: { passwordPolicyOverride: true },
    });
    return {
      firstName: inv.user.firstName,
      email: inv.user.betterAuthUser.email,
      expired,
      passwordPolicy: resolvePasswordPolicy(app ?? { passwordPolicyOverride: null }),
    };
  }
```

Update `acceptInvitation` to enforce before the transaction:

```ts
  async acceptInvitation(token: string, password: string): Promise<void> {
    const inv = await prisma.saInvitation.findUnique({
      where: { token },
      include: INVITATION_INCLUDE,
    });
    if (!inv) throw new NotFoundException('Invitation not found');
    if (inv.usedAt) throw new BadRequestException('Invitation already used');
    if (inv.expiresAt < new Date()) throw new BadRequestException('Invitation expired');

    const app = await prisma.saApp.findUnique({
      where: { id: inv.user.org.appId },
      select: { passwordPolicyOverride: true },
    });
    validatePasswordOrThrow(password, resolvePasswordPolicy(app ?? { passwordPolicyOverride: null }));

    const hashed = await hashPassword(password);
    // ...rest of the method unchanged...
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm --filter @sassy-auth/auth-server test -- invitations.service.spec.ts`
Expected: PASS (all existing tests, updated for the new `org.appId` include, plus the two new tests).

- [ ] **Step 9: Commit**

```bash
git add apps/auth-server/src/invitations
git commit -m "feat(auth-server): enforce configurable password policy on invitation accept"
```

---

### Task 7: Forgot-password reset enforcement + public policy endpoint

This is the gap-closer: today `/reset-password` has no server-side complexity check at all.

**Files:**
- Modify: `apps/auth-server/src/auth/auth.config.ts`
- Modify: `apps/auth-server/src/auth/auth.config.spec.ts`
- Create: `apps/auth-server/src/auth/resolve-app-for-reset-token.ts`
- Create: `apps/auth-server/src/auth/resolve-app-for-reset-token.spec.ts`
- Create: `apps/auth-server/src/auth/password-policy.controller.ts`
- Create: `apps/auth-server/src/auth/password-policy.controller.spec.ts`
- Modify: `apps/auth-server/src/auth/auth.module.ts` (or wherever `AppsController`-style controllers are registered — confirm exact module file by grepping for an existing controller's registration)

- [ ] **Step 1: Write the failing test for token → app resolution**

Create `apps/auth-server/src/auth/resolve-app-for-reset-token.spec.ts`:

```ts
import { resolveAppForResetToken } from './resolve-app-for-reset-token';

describe('resolveAppForResetToken', () => {
  function mockPrisma(overrides: Partial<{
    verification: { value: string } | null;
    user: { id: number; org: { appId: number } } | null;
    app: { id: number; passwordPolicyOverride: unknown } | null;
  }>) {
    return {
      verification: { findFirst: jest.fn().mockResolvedValue(overrides.verification ?? null) },
      saUser: { findFirst: jest.fn().mockResolvedValue(overrides.user ?? null) },
      saApp: { findUnique: jest.fn().mockResolvedValue(overrides.app ?? null) },
    };
  }

  it('returns null when the verification token does not exist', async () => {
    const prisma = mockPrisma({ verification: null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await resolveAppForResetToken(prisma as any, 'bad-token')).toBeNull();
  });

  it('returns null when the verification value has no matching SaUser', async () => {
    const prisma = mockPrisma({ verification: { value: 'ba-1' }, user: null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await resolveAppForResetToken(prisma as any, 'tok')).toBeNull();
  });

  it('queries Verification by the reset-password: identifier prefix', async () => {
    const prisma = mockPrisma({ verification: { value: 'ba-1' }, user: { id: 1, org: { appId: 7 } }, app: { id: 7, passwordPolicyOverride: null } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await resolveAppForResetToken(prisma as any, 'tok-abc');
    expect(prisma.verification.findFirst).toHaveBeenCalledWith({ where: { identifier: 'reset-password:tok-abc' } });
  });

  it('resolves the app via SaUser.org.appId when the chain is intact', async () => {
    const prisma = mockPrisma({ verification: { value: 'ba-1' }, user: { id: 1, org: { appId: 7 } }, app: { id: 7, passwordPolicyOverride: null } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const app = await resolveAppForResetToken(prisma as any, 'tok');
    expect(app).toEqual({ id: 7, passwordPolicyOverride: null });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @sassy-auth/auth-server test -- resolve-app-for-reset-token.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `resolve-app-for-reset-token.ts`**

```ts
import type { PrismaClient } from '@prisma/client';

/**
 * BetterAuth's /reset-password flow stores the token as a Verification row
 * with identifier `reset-password:<token>` and `value` = the BetterAuth
 * user id (confirmed against the installed better-auth@1.6.11's
 * dist/api/routes/password.mjs). Resolves through SaUser.org.appId to find
 * which app's password policy governs this reset. Returns null for any
 * broken link in the chain (unknown/expired token, orphaned SaUser) —
 * callers treat null as "defer to BetterAuth's own token-validity error,
 * don't invent a different one here."
 */
export async function resolveAppForResetToken(
  prisma: Pick<PrismaClient, 'verification' | 'saUser' | 'saApp'>,
  token: string,
): Promise<{ id: number; passwordPolicyOverride: unknown } | null> {
  const verification = await prisma.verification.findFirst({
    where: { identifier: `reset-password:${token}` },
  });
  if (!verification) return null;

  const user = await prisma.saUser.findFirst({
    where: { betterAuthUserId: verification.value },
    select: { org: { select: { appId: true } } },
  });
  if (!user) return null;

  return prisma.saApp.findUnique({
    where: { id: user.org.appId },
    select: { id: true, passwordPolicyOverride: true },
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @sassy-auth/auth-server test -- resolve-app-for-reset-token.spec.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write the failing test for the `hooks.before` matcher**

In `apps/auth-server/src/auth/auth.config.spec.ts`, following the exact pattern of the existing `hooks.after handler body` describe block (identity-mock `createAuthMiddleware`, dynamic-import `auth`, hand-built `ctx`), add:

```ts
jest.mock('./resolve-app-for-reset-token', () => ({
  resolveAppForResetToken: jest.fn(),
}));

describe('auth.config — hooks.before (reset-password policy enforcement)', () => {
  async function loadBeforeHook() {
    const { auth } = await import('./auth.config');
    const options = (auth as unknown as { options: Record<string, unknown> }).options;
    const hooks = options['hooks'] as Record<string, unknown>;
    return hooks['before'] as (ctx: {
      path?: string;
      body?: { token?: string; newPassword?: string };
      query?: { token?: string };
    }) => Promise<void>;
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('ignores a non-reset-password path', async () => {
    const before = await loadBeforeHook();
    const { resolveAppForResetToken } = require('./resolve-app-for-reset-token');
    await before({ path: '/sign-in/email' });
    expect(resolveAppForResetToken).not.toHaveBeenCalled();
  });

  it('does nothing when the token resolves to no app (defers to BetterAuth\'s own INVALID_TOKEN)', async () => {
    const { resolveAppForResetToken } = require('./resolve-app-for-reset-token');
    resolveAppForResetToken.mockResolvedValue(null);
    const before = await loadBeforeHook();
    await expect(before({ path: '/reset-password', body: { token: 'tok', newPassword: 'x' } })).resolves.toBeUndefined();
  });

  it('throws when the new password violates the resolved app\'s policy', async () => {
    const { resolveAppForResetToken } = require('./resolve-app-for-reset-token');
    resolveAppForResetToken.mockResolvedValue({ id: 1, passwordPolicyOverride: null });
    const before = await loadBeforeHook();
    await expect(
      before({ path: '/reset-password', body: { token: 'tok', newPassword: 'short' } }),
    ).rejects.toMatchObject({ body: { code: 'BAD_REQUEST' } });
  });

  it('does not throw when the new password satisfies the resolved policy', async () => {
    const { resolveAppForResetToken } = require('./resolve-app-for-reset-token');
    resolveAppForResetToken.mockResolvedValue({ id: 1, passwordPolicyOverride: null });
    const before = await loadBeforeHook();
    await expect(
      before({ path: '/reset-password', body: { token: 'tok', newPassword: 'Str0ngPassword' } }),
    ).resolves.toBeUndefined();
  });
});
```

Note: `APIError.from('BAD_REQUEST', ...)` (BetterAuth's own error type, not Nest's `BadRequestException`) must be what the hook throws, since it runs inside BetterAuth's own request pipeline — see Step 6.

- [ ] **Step 6: Run the test to verify it fails**

Run: `pnpm --filter @sassy-auth/auth-server test -- auth.config.spec.ts`
Expected: FAIL — no `hooks.before` exists yet.

- [ ] **Step 7: Add the `hooks.before` matcher and top-level `password` config to `auth.config.ts`**

Add the import near the other local imports:

```ts
import { resolveAppForResetToken } from './resolve-app-for-reset-token';
import { getGlobalPasswordPolicy, resolvePasswordPolicy, MAX_PASSWORD_LENGTH } from './password-policy';
import { evaluatePasswordPolicy } from '@sassy-auth/types';
```

Add a top-level `password` option (belt-and-braces baseline for any BetterAuth-native path), right after `advanced: { ... }` and before `rateLimit: { ... }`:

```ts
  // Belt-and-braces baseline matching the global policy's length bounds.
  // The hooks.before matcher below is the actual complexity enforcement for
  // /reset-password; this covers any other BetterAuth-native path that
  // consults these two options directly (e.g. its own length pre-check in
  // password.mjs, which runs before hooks.before's throw would matter for
  // messaging but not for security — either check failing is a correct 400).
  password: {
    minPasswordLength: getGlobalPasswordPolicy(process.env).minLength,
    maxPasswordLength: MAX_PASSWORD_LENGTH,
  },
```

Replace the single `hooks: { after: ... }` block with `before` added alongside it (per the file's own task-8 comment: exactly one `hooks.after` may exist — `before` is a separate field on the same object, not a second `hooks` block):

```ts
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== '/reset-password') return;
      const token = (ctx.body as { token?: string } | undefined)?.token
        ?? (ctx.query as { token?: string } | undefined)?.token;
      if (!token) return; // BetterAuth's own handler throws INVALID_TOKEN for this
      const app = await resolveAppForResetToken(prisma, token);
      if (!app) return; // defer to BetterAuth's own token-validity check
      const newPassword = (ctx.body as { newPassword?: string } | undefined)?.newPassword ?? '';
      const policy = resolvePasswordPolicy(app);
      const failedRules = evaluatePasswordPolicy(newPassword, policy)
        .filter((r) => !r.met)
        .map((r) => r.rule);
      if (newPassword.length > MAX_PASSWORD_LENGTH) failedRules.push('maxLength' as never);
      if (failedRules.length > 0) {
        throw new APIError('BAD_REQUEST', {
          message: 'Password does not meet the required policy.',
          code: 'PASSWORD_POLICY_VIOLATION',
        });
      }
    }),
    after: createAuthMiddleware(async (ctx) => {
      // ...unchanged, existing task-8 body...
    }),
  },
```

(Keep the existing `after` body byte-for-byte — only `before` is new.)

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm --filter @sassy-auth/auth-server test -- auth.config.spec.ts`
Expected: PASS (all existing tests plus the four new ones).

- [ ] **Step 9: Write the failing test for the new public policy endpoint**

The controller takes no injected service — it calls `resolveAppForResetToken(prisma, token)` directly, matching the plain-function style already used by `registration.service.ts` and `invitations.service.ts` for policy resolution, rather than wrapping it in a NestJS provider that would need its own module wiring for a single one-line call.

Create `apps/auth-server/src/auth/password-policy.controller.spec.ts`:

```ts
jest.mock('./resolve-app-for-reset-token', () => ({
  resolveAppForResetToken: jest.fn(),
}));

describe('PasswordPolicyController', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the global policy when resetToken is omitted', async () => {
    const controller = new PasswordPolicyController();
    const result = await controller.get(undefined);
    expect(result.passwordPolicy.minLength).toBe(12);
  });

  it('returns the app-resolved policy for a valid resetToken', async () => {
    const { resolveAppForResetToken } = require('./resolve-app-for-reset-token');
    resolveAppForResetToken.mockResolvedValue({
      id: 1,
      passwordPolicyOverride: { minLength: 20, requireUppercase: false, requireLowercase: false, requireNumber: false, requireSpecial: false, minNumbers: 0, minSpecial: 0 },
    });
    const controller = new PasswordPolicyController();
    const result = await controller.get('tok');
    expect(result.passwordPolicy.minLength).toBe(20);
  });

  it('falls back to the global policy for an unresolvable resetToken', async () => {
    const { resolveAppForResetToken } = require('./resolve-app-for-reset-token');
    resolveAppForResetToken.mockResolvedValue(null);
    const controller = new PasswordPolicyController();
    const result = await controller.get('bad-tok');
    expect(result.passwordPolicy.minLength).toBe(12);
  });
});
```

Delete the earlier placeholder `makeController` helper and first two draft tests — this final version replaces them.

- [ ] **Step 10: Run the test to verify it fails**

Run: `pnpm --filter @sassy-auth/auth-server test -- password-policy.controller.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 11: Implement `password-policy.controller.ts`**

```ts
import { Controller, Get, Query } from '@nestjs/common';
import { prisma } from '@sassy-auth/db';
import { PasswordPolicy } from '@sassy-auth/types';
import { getGlobalPasswordPolicy, resolvePasswordPolicy } from './password-policy';
import { resolveAppForResetToken } from './resolve-app-for-reset-token';

/**
 * Public (no auth guard), unauthenticated by design — the forgot-password
 * page needs the effective policy for its live requirements checklist
 * before the user has proven they control the account. Returns the GLOBAL
 * policy (never a 404/error) for a missing or unresolvable resetToken: the
 * page still needs something to render, and the hooks.before matcher in
 * auth.config.ts is the actual enforcement at submit time regardless of
 * what this endpoint showed beforehand.
 */
@Controller('password-policy')
export class PasswordPolicyController {
  @Get()
  async get(@Query('resetToken') resetToken?: string): Promise<{ passwordPolicy: PasswordPolicy }> {
    if (!resetToken) {
      return { passwordPolicy: getGlobalPasswordPolicy(process.env) };
    }
    const app = await resolveAppForResetToken(prisma, resetToken);
    return { passwordPolicy: resolvePasswordPolicy(app ?? { passwordPolicyOverride: null }) };
  }
}
```

- [ ] **Step 12: Run the test to verify it passes**

Run: `pnpm --filter @sassy-auth/auth-server test -- password-policy.controller.spec.ts`
Expected: PASS, 3 tests.

- [ ] **Step 13: Register the controller**

Find the NestJS module that currently declares `RegistrationController`/`InvitationsController` (or, if apps/auth-server registers top-level controllers directly in `app.module.ts`, use that file instead — check both before editing). Add `PasswordPolicyController` to that module's `controllers` array and import it at the top of the file.

- [ ] **Step 14: Run the full auth module test suite and a manual smoke check**

Run: `pnpm --filter @sassy-auth/auth-server test`
Expected: PASS, no regressions.

Run: `pnpm --filter @sassy-auth/auth-server dev` (in one terminal), then in another:
`curl http://localhost:3000/api/password-policy`
Expected: `{"passwordPolicy":{"minLength":12,"requireUppercase":true,"requireLowercase":true,"requireNumber":true,"requireSpecial":false,"minNumbers":1,"minSpecial":0}}`

- [ ] **Step 15: Commit**

```bash
git add apps/auth-server/src/auth
git commit -m "feat(auth-server): enforce password policy on reset-password, add public policy endpoint"
```

---

### Task 8: Admin API — per-app policy override

**Files:**
- Modify: `apps/auth-server/src/apps/dto/update-app.dto.ts`
- Modify: `apps/auth-server/src/apps/apps.service.ts`
- Modify: `apps/auth-server/src/apps/apps.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

In `apps/auth-server/src/apps/apps.service.spec.ts`, add (matching this file's existing mock-setup style — read its top before writing):

```ts
describe('updateApp — passwordPolicyOverride', () => {
  const VALID_OVERRIDE = {
    minLength: 16, requireUppercase: true, requireLowercase: true,
    requireNumber: true, requireSpecial: true, minNumbers: 2, minSpecial: 1,
  };

  it('rejects minLength below 8', async () => {
    mockPrisma.saApp.findUnique.mockResolvedValue({ id: 1, publicId: 'sq_1', isPlatform: false, redirectUris: [] });
    await expect(
      service.updateApp('caller-ba-id', 'sq_1', { passwordPolicyOverride: { ...VALID_OVERRIDE, minLength: 4 } }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects minLength above 128', async () => {
    mockPrisma.saApp.findUnique.mockResolvedValue({ id: 1, publicId: 'sq_1', isPlatform: false, redirectUris: [] });
    await expect(
      service.updateApp('caller-ba-id', 'sq_1', { passwordPolicyOverride: { ...VALID_OVERRIDE, minLength: 200 } }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects minNumbers greater than minLength', async () => {
    mockPrisma.saApp.findUnique.mockResolvedValue({ id: 1, publicId: 'sq_1', isPlatform: false, redirectUris: [] });
    await expect(
      service.updateApp('caller-ba-id', 'sq_1', { passwordPolicyOverride: { ...VALID_OVERRIDE, minLength: 8, minNumbers: 20 } }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a negative minSpecial', async () => {
    mockPrisma.saApp.findUnique.mockResolvedValue({ id: 1, publicId: 'sq_1', isPlatform: false, redirectUris: [] });
    await expect(
      service.updateApp('caller-ba-id', 'sq_1', { passwordPolicyOverride: { ...VALID_OVERRIDE, minSpecial: -1 } }),
    ).rejects.toThrow(BadRequestException);
  });

  it('persists a valid override and returns it in the formatted app', async () => {
    mockPrisma.saApp.findUnique.mockResolvedValue({ id: 1, publicId: 'sq_1', isPlatform: false, redirectUris: [] });
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(mockPrisma));
    mockPrisma.saApp.update.mockResolvedValue({
      publicId: 'sq_1', name: 'Acme', url: 'https://acme.test', isPlatform: false,
      twoFactorTrustDays: null, requireTwoFactor: false, passwordPolicyOverride: VALID_OVERRIDE,
    });

    const result = await service.updateApp('caller-ba-id', 'sq_1', { passwordPolicyOverride: VALID_OVERRIDE });

    expect(result.passwordPolicyOverride).toEqual(VALID_OVERRIDE);
    expect(result.effectivePasswordPolicy).toEqual(VALID_OVERRIDE);
  });

  it('clears an existing override when passed null', async () => {
    mockPrisma.saApp.findUnique.mockResolvedValue({ id: 1, publicId: 'sq_1', isPlatform: false, redirectUris: [] });
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(mockPrisma));
    mockPrisma.saApp.update.mockResolvedValue({
      publicId: 'sq_1', name: 'Acme', url: 'https://acme.test', isPlatform: false,
      twoFactorTrustDays: null, requireTwoFactor: false, passwordPolicyOverride: null,
    });

    const result = await service.updateApp('caller-ba-id', 'sq_1', { passwordPolicyOverride: null });

    expect(result.passwordPolicyOverride).toBeNull();
    expect(result.effectivePasswordPolicy.minLength).toBe(12); // global default
  });
});
```

Add `import { BadRequestException } from '@nestjs/common';` to the spec file's imports if not already present.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @sassy-auth/auth-server test -- apps.service.spec.ts`
Expected: FAIL — `UpdateAppDto` has no `passwordPolicyOverride` field and `updateApp` doesn't handle or validate it.

- [ ] **Step 3: Add the field to `UpdateAppDto`**

In `apps/auth-server/src/apps/dto/update-app.dto.ts`, add after `requireTwoFactor`:

```ts
  /**
   * Complete PasswordPolicy override for this app's users (register,
   * accept-invite, forgot-password reset). null clears the override,
   * reverting to the global env-derived policy. Deep-validated in
   * AppsService.assertValidPasswordPolicyOverride, following the same
   * manual-validation-in-service pattern as redirectUris above.
   */
  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  passwordPolicyOverride?: PasswordPolicy | null;
```

Add `import { PasswordPolicy } from '@sassy-auth/types';` at the top.

- [ ] **Step 4: Add validation and persistence to `apps.service.ts`**

Add near `assertValidRedirectUris`:

```ts
import { PasswordPolicy } from '@sassy-auth/types';
import { getGlobalPasswordPolicy, resolvePasswordPolicy } from '../auth/password-policy';

/** Bounds an app's password policy override to sane values — mirrors
 * assertValidRedirectUris's manual-validation-in-service pattern. */
function assertValidPasswordPolicyOverride(policy: PasswordPolicy): void {
  if (policy.minLength < 8 || policy.minLength > 128) {
    throw new BadRequestException('passwordPolicyOverride.minLength must be between 8 and 128');
  }
  if (policy.minNumbers < 0 || policy.minNumbers > policy.minLength) {
    throw new BadRequestException('passwordPolicyOverride.minNumbers must be between 0 and minLength');
  }
  if (policy.minSpecial < 0 || policy.minSpecial > policy.minLength) {
    throw new BadRequestException('passwordPolicyOverride.minSpecial must be between 0 and minLength');
  }
}
```

Update `formatApp` to include both the raw override and the computed effective policy:

```ts
type AppRow = {
  publicId: string; name: string; url: string; isPlatform: boolean;
  twoFactorTrustDays: number | null; requireTwoFactor: boolean;
  redirectUris?: RedirectUriRow[];
  passwordPolicyOverride?: unknown;
  clientSecretHash?: string | null;
  clientSecretUpdatedAt?: Date | null;
};
function formatApp(a: AppRow) {
  return {
    publicId: a.publicId, name: a.name, url: a.url, isPlatform: a.isPlatform,
    twoFactorTrustDays: a.twoFactorTrustDays ?? null,
    requireTwoFactor: a.requireTwoFactor,
    redirectUris: (a.redirectUris ?? []).map((r) => ({ uri: r.uri, kind: r.kind })),
    passwordPolicyOverride: (a.passwordPolicyOverride ?? null) as PasswordPolicy | null,
    effectivePasswordPolicy: resolvePasswordPolicy({ passwordPolicyOverride: a.passwordPolicyOverride ?? null }),
    isConfidential: Boolean(a.clientSecretHash),
    clientSecretUpdatedAt: a.clientSecretUpdatedAt ? a.clientSecretUpdatedAt.toISOString() : null,
  };
}
```

Update `updateApp`'s "nothing to update" guard and its transaction body:

```ts
  async updateApp(callerBaId: string, publicId: string, dto: UpdateAppDto) {
    if (
      dto.name === undefined &&
      dto.url === undefined &&
      dto.twoFactorTrustDays === undefined &&
      dto.requireTwoFactor === undefined &&
      dto.redirectUris === undefined &&
      dto.passwordPolicyOverride === undefined
    ) {
      throw new BadRequestException(
        'At least one of name, url, twoFactorTrustDays, requireTwoFactor, redirectUris, or passwordPolicyOverride must be provided',
      );
    }
    await checkPermission(callerBaId, 'platform.apps.manage');
    const existing = await prisma.saApp.findUnique({ where: { publicId }, include: { redirectUris: true } });
    if (!existing) throw new NotFoundException();
    if (existing.isPlatform) throw new ForbiddenException('Platform app cannot be modified');
    if (dto.redirectUris) assertValidRedirectUris(dto.redirectUris);
    if (dto.passwordPolicyOverride) assertValidPasswordPolicyOverride(dto.passwordPolicyOverride);
    try {
      type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
      const updated = await prisma.$transaction(async (tx: Tx) => {
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
            ...(dto.passwordPolicyOverride !== undefined && {
              passwordPolicyOverride: dto.passwordPolicyOverride as object | null,
            }),
          },
        });
        if (dto.redirectUris) {
          await tx.saAppRedirectUri.deleteMany({ where: { appId: existing.id } });
          await tx.saAppRedirectUri.createMany({
            data: dto.redirectUris.map((r) => ({ appId: existing.id, uri: r.uri, kind: r.kind })),
          });
        }
        return updatedApp;
      });
      this.logger.getWinstonLogger().info('App updated', { context: 'AppsService', appId: publicId });
      return formatApp({ ...updated, redirectUris: dto.redirectUris ?? existing.redirectUris });
    } catch (e: unknown) {
      if (isPrismaCode(e, 'P2002')) throw new ConflictException('App with this name already exists');
      throw e;
    }
  }
```

(`getGlobalPasswordPolicy` import above is unused directly in this file if `resolvePasswordPolicy` alone suffices for `formatApp` — remove the unused import if the linter flags it.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @sassy-auth/auth-server test -- apps.service.spec.ts`
Expected: PASS (all existing tests plus the six new ones).

- [ ] **Step 6: Run the full auth-server suite for a regression check**

Run: `pnpm --filter @sassy-auth/auth-server test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/auth-server/src/apps
git commit -m "feat(auth-server): add per-app password policy override to update-app API"
```

---

### Task 9: Admin shared types and API client

**Files:**
- Modify: `apps/admin/lib/types.ts`
- Modify: `apps/admin/lib/api-public.ts`
- Modify: `apps/admin/package.json` (add `@sassy-auth/types` dependency if not already present — check first)

- [ ] **Step 1: Confirm whether `apps/admin` already depends on `@sassy-auth/types`**

Run: `grep -n "@sassy-auth/types" apps/admin/package.json`
Expected: either a match (skip Step 2) or no output (do Step 2).

- [ ] **Step 2: Add the workspace dependency if missing**

In `apps/admin/package.json`'s `dependencies`, add (matching the version range style already used for `@sassy-auth/db`/`@sassy-auth/ui` in that same file):

```json
    "@sassy-auth/types": "workspace:*",
```

Run: `pnpm install`
Expected: exits 0, no lockfile conflicts.

- [ ] **Step 3: Extend `apps/admin/lib/types.ts`**

Add the import at the top:

```ts
import type { PasswordPolicy } from '@sassy-auth/types'

export type { PasswordPolicy }
```

Extend `App`, `UpdateAppPayload`, and `InvitationInfo`:

```ts
export interface App {
  publicId: string;
  name: string;
  url: string;
  redirectUris?: RedirectUri[];
  isPlatform: boolean;
  twoFactorTrustDays?: number | null;
  requireTwoFactor: boolean;
  passwordPolicyOverride: PasswordPolicy | null;
  effectivePasswordPolicy: PasswordPolicy;
  isConfidential?: boolean;
  clientSecretUpdatedAt?: string | null;
}
```

```ts
export interface UpdateAppPayload {
  name?: string;
  url?: string;
  redirectUris?: RedirectUri[];
  twoFactorTrustDays?: number | null;
  requireTwoFactor?: boolean;
  passwordPolicyOverride?: PasswordPolicy | null;
}
```

```ts
export interface InvitationInfo {
  firstName: string
  email: string
  expired: boolean
  passwordPolicy: PasswordPolicy
}
```

- [ ] **Step 4: Add the reset-password policy fetch to `apps/admin/lib/api-public.ts`**

```ts
import type { InvitationInfo, PasswordPolicy } from './types'

const BASE = process.env.AUTH_SERVER_URL ?? 'http://localhost:3000'

export async function validateInvitation(token: string): Promise<InvitationInfo> {
  const res = await fetch(`${BASE}/api/invitations/${encodeURIComponent(token)}`)
  if (!res.ok) throw new Error(`API error ${res.status}: fetching invitation`)
  return res.json()
}

export async function acceptInvitation(token: string, password: string): Promise<void> {
  const res = await fetch(`${BASE}/api/invitations/${encodeURIComponent(token)}/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  if (!res.ok) throw new Error(`API error ${res.status}: accept invitation`)
}

export async function getPasswordPolicyForResetToken(token: string): Promise<PasswordPolicy> {
  const res = await fetch(`${BASE}/api/password-policy?resetToken=${encodeURIComponent(token)}`)
  if (!res.ok) throw new Error(`API error ${res.status}: fetching password policy`)
  const body = (await res.json()) as { passwordPolicy: PasswordPolicy }
  return body.passwordPolicy
}
```

- [ ] **Step 5: Type-check the admin app**

Run: `pnpm --filter @sassy-auth/admin exec tsc --noEmit`
Expected: exits 0. (This will surface any call sites still using the old `App`/`InvitationInfo` shapes without the new required fields — fix those now if any appear; they'll be addressed properly in Tasks 10–11 regardless, but this step catches the mechanical ones early.)

- [ ] **Step 6: Commit**

```bash
git add apps/admin/lib/types.ts apps/admin/lib/api-public.ts apps/admin/package.json pnpm-lock.yaml
git commit -m "feat(admin): add PasswordPolicy to shared types and public API client"
```

---

### Task 10: Shared `PasswordRequirementsChecklist` component

**Files:**
- Create: `apps/admin/components/password-requirements-checklist.tsx`
- Create: `apps/admin/components/__tests__/password-requirements-checklist.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/admin/components/__tests__/password-requirements-checklist.test.tsx`, following this codebase's existing React Testing Library + `next-intl` test-wrapping convention (check `app-edit-drawer.test.tsx`'s top-of-file provider wrapper and copy its exact pattern):

```tsx
import { render, screen } from '@testing-library/react'
import { PasswordRequirementsChecklist } from '../password-requirements-checklist'
import type { PasswordPolicy } from '@/lib/types'

const POLICY: PasswordPolicy = {
  minLength: 12, requireUppercase: true, requireLowercase: true,
  requireNumber: true, requireSpecial: false, minNumbers: 1, minSpecial: 0,
}

describe('PasswordRequirementsChecklist', () => {
  it('renders one item per active rule', () => {
    render(<PasswordRequirementsChecklist password="" policy={POLICY} />)
    expect(screen.getByTestId('rule-minLength')).toBeInTheDocument()
    expect(screen.getByTestId('rule-requireUppercase')).toBeInTheDocument()
    expect(screen.getByTestId('rule-requireLowercase')).toBeInTheDocument()
    expect(screen.getByTestId('rule-requireNumber')).toBeInTheDocument()
    expect(screen.queryByTestId('rule-requireSpecial')).not.toBeInTheDocument()
  })

  it('marks a rule as met once the password satisfies it', () => {
    render(<PasswordRequirementsChecklist password="Str0ngPassword" policy={POLICY} />)
    expect(screen.getByTestId('rule-minLength')).toHaveAttribute('data-met', 'true')
    expect(screen.getByTestId('rule-requireUppercase')).toHaveAttribute('data-met', 'true')
  })

  it('marks a rule as unmet when the password fails it', () => {
    render(<PasswordRequirementsChecklist password="alllowercase" policy={POLICY} />)
    expect(screen.getByTestId('rule-requireUppercase')).toHaveAttribute('data-met', 'false')
  })
})
```

(Wrap `render(...)` in whatever `NextIntlClientProvider`/messages fixture `app-edit-drawer.test.tsx` already uses, so the `t('password.rules.*')` calls inside the component resolve real strings during the test rather than throwing on a missing provider.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @sassy-auth/admin test -- password-requirements-checklist.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

```tsx
'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { evaluatePasswordPolicy } from '@sassy-auth/types'
import type { PasswordPolicy } from '@/lib/types'

interface Props {
  password: string
  policy: PasswordPolicy
}

export function PasswordRequirementsChecklist({ password, policy }: Props) {
  const t = useTranslations()
  const results = evaluatePasswordPolicy(password, policy)

  return (
    <ul className="mt-2 space-y-1">
      {results.map(({ rule, met }) => {
        const count = rule === 'minLength' ? policy.minLength
          : rule === 'minNumbers' ? policy.minNumbers
          : rule === 'minSpecial' ? policy.minSpecial
          : undefined
        return (
          <li
            key={rule}
            data-testid={`rule-${rule}`}
            data-met={met}
            className={`flex items-center gap-1.5 text-body-sm ${met ? 'text-[var(--primary)]' : 'text-muted-foreground'}`}
          >
            <span className="material-symbols-outlined text-[16px]" style={met ? { fontVariationSettings: "'FILL' 1" } : undefined}>
              {met ? 'check_circle' : 'radio_button_unchecked'}
            </span>
            {count !== undefined
              ? t(`password.rules.${rule}` as 'password.rules.minLength', { count })
              : t(`password.rules.${rule}` as 'password.rules.requireUppercase')}
          </li>
        )
      })}
    </ul>
  )
}
```

- [ ] **Step 4: Add the `password.rules.*` i18n keys needed for this test to pass**

This is deferred to Task 11 (i18n), but the test in Step 1 will fail on missing keys until then — run Task 11's Step 1 before Step 5 below if working strictly in file order, or add a minimal inline test-only messages fixture now if `app-edit-drawer.test.tsx`'s existing convention already stubs `useTranslations` with a passthrough (check that file: many test suites in this codebase mock `next-intl`'s `useTranslations` to return the key itself, in which case no real messages file is needed for this test to pass — match whichever convention is actually in use before assuming).

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @sassy-auth/admin test -- password-requirements-checklist.test.tsx`
Expected: PASS, 3 tests (after Task 11's i18n keys exist, or after confirming Step 4's mock convention already satisfies `t()` calls).

- [ ] **Step 6: Commit**

```bash
git add apps/admin/components/password-requirements-checklist.tsx apps/admin/components/__tests__/password-requirements-checklist.test.tsx
git commit -m "feat(admin): add shared PasswordRequirementsChecklist component"
```

---

### Task 11: i18n — `password.rules.*` and drawer field labels

**Files:**
- Modify: `apps/admin/messages/en.json`
- Modify: `apps/admin/messages/fr.json`

- [ ] **Step 1: Add the `password` namespace to `en.json`**

Add as a new top-level key (alphabetical placement isn't enforced elsewhere in this file — insert near `"resetPassword"` for locality):

```json
  "password": {
    "rules": {
      "minLength": "At least {count} characters",
      "requireUppercase": "One uppercase letter",
      "requireLowercase": "One lowercase letter",
      "requireNumber": "One number",
      "requireSpecial": "One special character",
      "minNumbers": "At least {count} numbers",
      "minSpecial": "At least {count} special characters"
    }
  },
```

- [ ] **Step 2: Add the mirrored `password` namespace to `fr.json`**

```json
  "password": {
    "rules": {
      "minLength": "Au moins {count} caractères",
      "requireUppercase": "Une lettre majuscule",
      "requireLowercase": "Une lettre minuscule",
      "requireNumber": "Un chiffre",
      "requireSpecial": "Un caractère spécial",
      "minNumbers": "Au moins {count} chiffres",
      "minSpecial": "Au moins {count} caractères spéciaux"
    }
  },
```

- [ ] **Step 3: Add the app-edit-drawer field labels to `en.json`'s existing `"apps"` namespace**

Find `"apps": { "fields": { ... } }` in `en.json` and add:

```json
      "passwordPolicy": "Password Policy",
      "passwordPolicyOverrideToggle": "Override global password policy for this app",
      "passwordPolicyInherited": "Inheriting the global policy: {summary}",
      "passwordPolicyMinLength": "Minimum length",
      "passwordPolicyRequireUppercase": "Require an uppercase letter",
      "passwordPolicyRequireLowercase": "Require a lowercase letter",
      "passwordPolicyRequireNumber": "Require a number",
      "passwordPolicyRequireSpecial": "Require a special character",
      "passwordPolicyMinNumbers": "Minimum numbers",
      "passwordPolicyMinSpecial": "Minimum special characters"
```

- [ ] **Step 4: Mirror the same keys into `fr.json`'s `"apps"` namespace**

```json
      "passwordPolicy": "Politique de mot de passe",
      "passwordPolicyOverrideToggle": "Remplacer la politique globale pour cette application",
      "passwordPolicyInherited": "Politique globale héritée : {summary}",
      "passwordPolicyMinLength": "Longueur minimale",
      "passwordPolicyRequireUppercase": "Exiger une lettre majuscule",
      "passwordPolicyRequireLowercase": "Exiger une lettre minuscule",
      "passwordPolicyRequireNumber": "Exiger un chiffre",
      "passwordPolicyRequireSpecial": "Exiger un caractère spécial",
      "passwordPolicyMinNumbers": "Nombre minimum de chiffres",
      "passwordPolicyMinSpecial": "Nombre minimum de caractères spéciaux"
```

- [ ] **Step 5: Verify both files are still valid JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('apps/admin/messages/en.json','utf8')); JSON.parse(require('fs').readFileSync('apps/admin/messages/fr.json','utf8')); console.log('ok')"`
Expected: prints `ok`.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/messages/en.json apps/admin/messages/fr.json
git commit -m "feat(admin): add i18n for password policy checklist and drawer fields"
```

---

### Task 12: App-edit-drawer — collapsible Password Policy section

**Files:**
- Modify: `apps/admin/components/app-edit-drawer.tsx`
- Modify: `apps/admin/components/__tests__/app-edit-drawer.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `apps/admin/components/__tests__/app-edit-drawer.test.tsx`, following the existing tests' render/setup pattern for this drawer, add:

```tsx
const APP_WITH_GLOBAL_POLICY = {
  ...BASE_APP, // reuse whatever base fixture this file's existing tests already build
  passwordPolicyOverride: null,
  effectivePasswordPolicy: {
    minLength: 12, requireUppercase: true, requireLowercase: true,
    requireNumber: true, requireSpecial: false, minNumbers: 1, minSpecial: 0,
  },
}

describe('AppEditDrawer — password policy section', () => {
  it('renders collapsed with the override toggle off by default', () => {
    render(<AppEditDrawer app={APP_WITH_GLOBAL_POLICY} open onOpenChange={jest.fn()} />)
    expect(screen.getByLabelText(/override global password policy/i)).not.toBeChecked()
    expect(screen.queryByLabelText(/minimum length/i)).not.toBeInTheDocument()
  })

  it('expands the policy fields when the override toggle is turned on', async () => {
    const user = userEvent.setup()
    render(<AppEditDrawer app={APP_WITH_GLOBAL_POLICY} open onOpenChange={jest.fn()} />)
    await user.click(screen.getByLabelText(/override global password policy/i))
    expect(screen.getByLabelText(/minimum length/i)).toBeInTheDocument()
  })

  it('marks the form dirty and includes passwordPolicyOverride in the save payload when enabled and edited', async () => {
    const user = userEvent.setup()
    render(<AppEditDrawer app={APP_WITH_GLOBAL_POLICY} open onOpenChange={jest.fn()} />)
    await user.click(screen.getByLabelText(/override global password policy/i))
    await user.clear(screen.getByLabelText(/minimum length/i))
    await user.type(screen.getByLabelText(/minimum length/i), '16')
    await user.click(screen.getByRole('button', { name: /save/i }))
    expect(updateAppActionMock).toHaveBeenCalledWith(
      APP_WITH_GLOBAL_POLICY.publicId,
      expect.objectContaining({ passwordPolicyOverride: expect.objectContaining({ minLength: 16 }) }),
    )
  })

  it('sends null to clear an existing override when the toggle is turned back off', async () => {
    const user = userEvent.setup()
    const appWithOverride = {
      ...APP_WITH_GLOBAL_POLICY,
      passwordPolicyOverride: { minLength: 16, requireUppercase: true, requireLowercase: true, requireNumber: true, requireSpecial: false, minNumbers: 1, minSpecial: 0 },
    }
    render(<AppEditDrawer app={appWithOverride} open onOpenChange={jest.fn()} />)
    await user.click(screen.getByLabelText(/override global password policy/i))
    await user.click(screen.getByRole('button', { name: /save/i }))
    expect(updateAppActionMock).toHaveBeenCalledWith(
      appWithOverride.publicId,
      expect.objectContaining({ passwordPolicyOverride: null }),
    )
  })
})
```

Match `updateAppActionMock`, `BASE_APP`, and the render/import setup to whatever this file's existing tests already establish (its top-of-file `jest.mock('@/app/(admin)/apps/actions', ...)` and base fixture) rather than inventing new names.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @sassy-auth/admin test -- app-edit-drawer.test.tsx`
Expected: FAIL — no password-policy UI exists yet.

- [ ] **Step 3: Add the section to `app-edit-drawer.tsx`**

Add state, following the file's existing `React.useState`/`React.useEffect` pattern:

```tsx
  const [passwordPolicyOverrideEnabled, setPasswordPolicyOverrideEnabled] = React.useState(
    app.passwordPolicyOverride !== null,
  )
  const [passwordPolicy, setPasswordPolicy] = React.useState<PasswordPolicy>(
    app.passwordPolicyOverride ?? app.effectivePasswordPolicy,
  )
```

In the `React.useEffect` that resets state on `app`/`open` change, add:

```tsx
    setPasswordPolicyOverrideEnabled(app.passwordPolicyOverride !== null)
    setPasswordPolicy(app.passwordPolicyOverride ?? app.effectivePasswordPolicy)
```

Add to the `dirty` computation:

```tsx
  const passwordPolicyDirty =
    passwordPolicyOverrideEnabled !== (app.passwordPolicyOverride !== null)
    || (passwordPolicyOverrideEnabled && JSON.stringify(passwordPolicy) !== JSON.stringify(app.passwordPolicyOverride))
  const dirty = name !== app.name || url !== app.url || redirectUrisDirty || twoFactorTrustDays !== (app.twoFactorTrustDays ?? null) || requireTwoFactor !== (app.requireTwoFactor ?? false) || socialDirty || passwordPolicyDirty
```

Add to the `patch` object built in `handleSubmit`:

```tsx
    if (passwordPolicyDirty) {
      patch.passwordPolicyOverride = passwordPolicyOverrideEnabled ? passwordPolicy : null
    }
```

(Widen the `patch` type declaration in `handleSubmit` to include `passwordPolicyOverride?: PasswordPolicy | null`.)

Add the import: `import type { App, RedirectUri, PasswordPolicy } from '@/lib/types'`.

Add the JSX section after the existing `requireTwoFactor` block and before the `socialProviders` block:

```tsx
            <div>
              <label className="flex items-center gap-2 text-label-md cursor-pointer">
                <input
                  type="checkbox"
                  aria-label={t('apps.fields.passwordPolicyOverrideToggle')}
                  checked={passwordPolicyOverrideEnabled}
                  onChange={(e) => setPasswordPolicyOverrideEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-[var(--border)] accent-[var(--primary)]"
                />
                {t('apps.fields.passwordPolicyOverrideToggle')}
              </label>
              {!passwordPolicyOverrideEnabled && (
                <p className="mt-1 text-body-sm text-muted-foreground">
                  {t('apps.fields.passwordPolicyInherited', {
                    summary: `${app.effectivePasswordPolicy.minLength}+ chars`,
                  })}
                </p>
              )}
              {passwordPolicyOverrideEnabled && (
                <div className="mt-3 space-y-3 rounded border border-[var(--border)] p-3">
                  <div>
                    <Label htmlFor="pwMinLength">{t('apps.fields.passwordPolicyMinLength')}</Label>
                    <Input
                      id="pwMinLength"
                      type="number"
                      min={8}
                      max={128}
                      value={passwordPolicy.minLength}
                      onChange={(e) => setPasswordPolicy((p) => ({ ...p, minLength: Number(e.target.value) }))}
                    />
                  </div>
                  <label className="flex items-center gap-2 text-label-md cursor-pointer">
                    <input
                      type="checkbox"
                      checked={passwordPolicy.requireUppercase}
                      onChange={(e) => setPasswordPolicy((p) => ({ ...p, requireUppercase: e.target.checked }))}
                      className="h-4 w-4 rounded border-[var(--border)] accent-[var(--primary)]"
                    />
                    {t('apps.fields.passwordPolicyRequireUppercase')}
                  </label>
                  <label className="flex items-center gap-2 text-label-md cursor-pointer">
                    <input
                      type="checkbox"
                      checked={passwordPolicy.requireLowercase}
                      onChange={(e) => setPasswordPolicy((p) => ({ ...p, requireLowercase: e.target.checked }))}
                      className="h-4 w-4 rounded border-[var(--border)] accent-[var(--primary)]"
                    />
                    {t('apps.fields.passwordPolicyRequireLowercase')}
                  </label>
                  <label className="flex items-center gap-2 text-label-md cursor-pointer">
                    <input
                      type="checkbox"
                      checked={passwordPolicy.requireNumber}
                      onChange={(e) => setPasswordPolicy((p) => ({ ...p, requireNumber: e.target.checked }))}
                      className="h-4 w-4 rounded border-[var(--border)] accent-[var(--primary)]"
                    />
                    {t('apps.fields.passwordPolicyRequireNumber')}
                  </label>
                  <div>
                    <Label htmlFor="pwMinNumbers">{t('apps.fields.passwordPolicyMinNumbers')}</Label>
                    <Input
                      id="pwMinNumbers"
                      type="number"
                      min={0}
                      max={passwordPolicy.minLength}
                      disabled={!passwordPolicy.requireNumber}
                      value={passwordPolicy.minNumbers}
                      onChange={(e) => setPasswordPolicy((p) => ({ ...p, minNumbers: Number(e.target.value) }))}
                    />
                  </div>
                  <label className="flex items-center gap-2 text-label-md cursor-pointer">
                    <input
                      type="checkbox"
                      checked={passwordPolicy.requireSpecial}
                      onChange={(e) => setPasswordPolicy((p) => ({ ...p, requireSpecial: e.target.checked }))}
                      className="h-4 w-4 rounded border-[var(--border)] accent-[var(--primary)]"
                    />
                    {t('apps.fields.passwordPolicyRequireSpecial')}
                  </label>
                  <div>
                    <Label htmlFor="pwMinSpecial">{t('apps.fields.passwordPolicyMinSpecial')}</Label>
                    <Input
                      id="pwMinSpecial"
                      type="number"
                      min={0}
                      max={passwordPolicy.minLength}
                      disabled={!passwordPolicy.requireSpecial}
                      value={passwordPolicy.minSpecial}
                      onChange={(e) => setPasswordPolicy((p) => ({ ...p, minSpecial: Number(e.target.value) }))}
                    />
                  </div>
                </div>
              )}
            </div>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @sassy-auth/admin test -- app-edit-drawer.test.tsx`
Expected: PASS (all existing tests plus the four new ones).

- [ ] **Step 5: Commit**

```bash
git add apps/admin/components/app-edit-drawer.tsx apps/admin/components/__tests__/app-edit-drawer.test.tsx
git commit -m "feat(admin): add collapsible per-app password policy section to app edit drawer"
```

---

### Task 13: Wire the checklist into signup, accept-invite, and reset-password forms

**Files:**
- Modify: `apps/admin/app/signup/page.tsx`
- Modify: `apps/admin/app/signup/signup-form.tsx`
- Modify: `apps/admin/app/signup/__tests__/signup-form.test.tsx`
- Modify: `apps/admin/app/accept-invite/page.tsx`
- Modify: `apps/admin/app/accept-invite/accept-invite-form.tsx`
- Modify: `apps/admin/app/accept-invite/__tests__/accept-invite-form.test.tsx`
- Modify: `apps/admin/app/reset-password/reset-password-form.tsx`
- Modify: `apps/admin/app/reset-password/__tests__/reset-password-form.test.tsx`

- [ ] **Step 1: `signup/page.tsx` — fetch and pass down the policy**

```tsx
import type { PasswordPolicy } from '@/lib/types'

async function fetchAppInfo(clientId: string): Promise<{ name: string | null; passwordPolicy: PasswordPolicy | null }> {
  try {
    const res = await fetch(`${AUTH_SERVER}/api/register/app?appPublicId=${encodeURIComponent(clientId)}`, {
      cache: 'no-store',
    })
    if (!res.ok) return { name: null, passwordPolicy: null }
    const body = (await res.json()) as { name?: string; passwordPolicy?: PasswordPolicy }
    return {
      name: typeof body.name === 'string' ? body.name : null,
      passwordPolicy: body.passwordPolicy ?? null,
    }
  } catch {
    return { name: null, passwordPolicy: null }
  }
}
```

Replace `const appName = await fetchAppName(clientId)` with:

```tsx
  const { name: appName, passwordPolicy } = await fetchAppInfo(clientId)
```

And pass it down:

```tsx
        <SignupForm clientId={clientId} next={nextSafe} passwordPolicy={passwordPolicy} />
```

- [ ] **Step 2: Update `signup-form.tsx`'s tests first**

In `apps/admin/app/signup/__tests__/signup-form.test.tsx`, find where `<SignupForm ... />` is rendered in each test and add a `passwordPolicy` prop:

```tsx
const POLICY = {
  minLength: 12, requireUppercase: true, requireLowercase: true,
  requireNumber: true, requireSpecial: false, minNumbers: 1, minSpecial: 0,
}
// ...
render(<SignupForm clientId="sq_1" next="" passwordPolicy={POLICY} />)
```

Add a new test:

```tsx
it('disables submit until every policy rule is satisfied', async () => {
  const user = userEvent.setup()
  render(<SignupForm clientId="sq_1" next="" passwordPolicy={POLICY} />)
  await user.type(screen.getByLabelText(/^password/i), 'short')
  expect(screen.getByRole('button', { name: /create account/i })).toBeDisabled()
  await user.clear(screen.getByLabelText(/^password/i))
  await user.type(screen.getByLabelText(/^password/i), 'Str0ngPassword')
  await user.type(screen.getByLabelText(/confirm password/i), 'Str0ngPassword')
  expect(screen.getByRole('button', { name: /create account/i })).toBeEnabled()
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @sassy-auth/admin test -- signup-form.test.tsx`
Expected: FAIL — `SignupForm` doesn't accept `passwordPolicy` yet and the submit button isn't gated on it.

- [ ] **Step 4: Update `signup-form.tsx`**

```tsx
'use client'

import * as React from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Button } from '@sassy-auth/ui'
import { evaluatePasswordPolicy } from '@sassy-auth/types'
import type { PasswordPolicy } from '@/lib/types'
import { PasswordRequirementsChecklist } from '@/components/password-requirements-checklist'
import { registerAction } from './actions'

interface SignupFormProps {
  clientId: string
  next: string
  passwordPolicy: PasswordPolicy | null
}

const KNOWN_ERRORS = [
  'appNotFound',
  'emailTaken',
  'tooManyRequests',
  'serverUnavailable',
  'validationError',
] as const

const FALLBACK_POLICY: PasswordPolicy = {
  minLength: 12, requireUppercase: true, requireLowercase: true,
  requireNumber: true, requireSpecial: false, minNumbers: 1, minSpecial: 0,
}

export function SignupForm({ clientId, next, passwordPolicy }: SignupFormProps) {
  const t = useTranslations()
  const policy = passwordPolicy ?? FALLBACK_POLICY
  const [firstName, setFirstName] = React.useState('')
  const [lastName, setLastName] = React.useState('')
  const [companyName, setCompanyName] = React.useState('')
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [confirm, setConfirm] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const [success, setSuccess] = React.useState(false)

  const policyMet = evaluatePasswordPolicy(password, policy).every((r) => r.met)
  const canSubmit = policyMet && password === confirm && password.length > 0

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) { setError(t('signup.errors.passwordMismatch')); return }
    if (!policyMet) { setError(t('signup.errors.passwordComplexity')); return }
    setError(null)
    setSubmitting(true)
    try {
      const result = await registerAction({ clientId, firstName, lastName, companyName, email, password })
      if ('error' in result) {
        const key = (KNOWN_ERRORS as readonly string[]).includes(result.error) ? result.error : 'validationError'
        setError(t(`signup.errors.${key as (typeof KNOWN_ERRORS)[number]}`))
        return
      }
      setSuccess(true)
    } catch {
      setError(t('signup.errors.validationError'))
    } finally {
      setSubmitting(false)
    }
  }

  if (success) {
    const loginHref = next ? `/login?next=${encodeURIComponent(next)}` : '/login'
    return (
      <div className="text-center">
        <div className="mb-4 flex justify-center">
          <span className="material-symbols-outlined text-[48px] text-[var(--primary)]" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
        </div>
        <p className="text-body-md text-[var(--foreground)]">{t('signup.success')}</p>
        <div className="mt-4">
          <Link href={loginHref} className="text-label-md text-[var(--primary)] hover:underline">
            {t('signup.continueToLogin')}
          </Link>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="firstName" className="text-label-md font-semibold">{t('signup.firstName')}</label>
          <input
            id="firstName"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            required
            className="flex h-9 rounded border border-[var(--border)] px-3 text-body-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="lastName" className="text-label-md font-semibold">{t('signup.lastName')}</label>
          <input
            id="lastName"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            required
            className="flex h-9 rounded border border-[var(--border)] px-3 text-body-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          />
        </div>
      </div>
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
      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-label-md font-semibold">{t('signup.email')}</label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="flex h-9 rounded border border-[var(--border)] px-3 text-body-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-label-md font-semibold">{t('signup.password')}</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="flex h-9 rounded border border-[var(--border)] px-3 text-body-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        />
        <PasswordRequirementsChecklist password={password} policy={policy} />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="confirm-password" className="text-label-md font-semibold">{t('signup.confirmPassword')}</label>
        <input
          id="confirm-password"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          className="flex h-9 rounded border border-[var(--border)] px-3 text-body-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        />
      </div>
      {error && <p data-testid="signup-error" className="text-label-md text-[var(--destructive)]">{error}</p>}
      <Button type="submit" className="w-full" loading={submitting} disabled={!canSubmit}>
        {t('signup.submit')}
      </Button>
    </form>
  )
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @sassy-auth/admin test -- signup-form.test.tsx`
Expected: PASS.

- [ ] **Step 6: Repeat the same pattern for `accept-invite-form.tsx`**

Update `apps/admin/app/accept-invite/__tests__/accept-invite-form.test.tsx` first: add a `passwordPolicy` prop to every `<AcceptInviteForm ... />` render call, and add a submit-gating test mirroring Step 2 above (adapted to `acceptInvite.submit`'s button label).

Run: `pnpm --filter @sassy-auth/admin test -- accept-invite-form.test.tsx` → confirm FAIL.

Update `accept-invite-form.tsx`: add `passwordPolicy: PasswordPolicy` to `AcceptInviteFormProps`, remove the three inline `if (password.length < 12)` / regex checks from `handleSubmit`, add `const policyMet = evaluatePasswordPolicy(password, passwordPolicy).every((r) => r.met)`, gate the submit button with `disabled={!policyMet || password !== confirm || submitting}`, and render `<PasswordRequirementsChecklist password={password} policy={passwordPolicy} />` under the password field — following the exact same shape as Step 4's `signup-form.tsx` changes.

Update `apps/admin/app/accept-invite/page.tsx`: widen the local `info` type to include `passwordPolicy: PasswordPolicy`, and pass `passwordPolicy={info.passwordPolicy}` to `<AcceptInviteForm>`.

Run: `pnpm --filter @sassy-auth/admin test -- accept-invite-form.test.tsx` → confirm PASS.

- [ ] **Step 7: Repeat the same pattern for `reset-password-form.tsx`**

This one fetches its policy client-side (no server component wraps it — `reset-password/page.tsx` renders `<ResetPasswordForm token={token} />` directly with no server-side token validation today). Update `apps/admin/app/reset-password/__tests__/reset-password-form.test.tsx` first: mock `@/lib/api-public`'s `getPasswordPolicyForResetToken` to resolve a fixed policy, and add a submit-gating test.

Run: `pnpm --filter @sassy-auth/admin test -- reset-password-form.test.tsx` → confirm FAIL.

Update `reset-password-form.tsx`:

```tsx
'use client'

import * as React from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Button } from '@sassy-auth/ui'
import { evaluatePasswordPolicy } from '@sassy-auth/types'
import type { PasswordPolicy } from '@/lib/types'
import { getPasswordPolicyForResetToken } from '@/lib/api-public'
import { PasswordRequirementsChecklist } from '@/components/password-requirements-checklist'
import { resetPasswordSubmitAction } from './actions'

const FALLBACK_POLICY: PasswordPolicy = {
  minLength: 12, requireUppercase: true, requireLowercase: true,
  requireNumber: true, requireSpecial: false, minNumbers: 1, minSpecial: 0,
}

export function ResetPasswordForm({ token }: { token: string }) {
  const t = useTranslations('resetPassword')
  const [policy, setPolicy] = React.useState<PasswordPolicy>(FALLBACK_POLICY)
  const [password, setPassword] = React.useState('')
  const [confirm, setConfirm] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const [success, setSuccess] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    getPasswordPolicyForResetToken(token).then((p) => {
      if (!cancelled) setPolicy(p)
    }).catch(() => {
      // Keep FALLBACK_POLICY — the hooks.before enforcement server-side is
      // the real gate; this checklist is a UX convenience.
    })
    return () => { cancelled = true }
  }, [token])

  const policyMet = evaluatePasswordPolicy(password, policy).every((r) => r.met)
  const canSubmit = policyMet && password === confirm && password.length > 0

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password !== confirm) { setError(t('mismatch')); return }
    if (!policyMet) { setError(t('complexity')); return }
    setSubmitting(true)
    const res = await resetPasswordSubmitAction(token, password)
    setSubmitting(false)
    if ('error' in res) {
      const known = ['serverUnavailable', 'tooManyRequests'] as const
      const key = (known as readonly string[]).includes(res.error) ? res.error : 'invalidToken'
      setError(t(key as 'serverUnavailable' | 'tooManyRequests' | 'invalidToken'))
      return
    }
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
                <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
                  className="flex h-9 rounded border border-[var(--border)] px-3 text-body-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]" />
                <PasswordRequirementsChecklist password={password} policy={policy} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="confirm-password" className="text-label-md font-semibold">{t('confirmPassword')}</label>
                <input id="confirm-password" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required
                  className="flex h-9 rounded border border-[var(--border)] px-3 text-body-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]" />
              </div>
              {error && <p data-testid="reset-error" className="text-label-md text-[var(--destructive)]">{error}</p>}
              <Button type="submit" className="w-full" disabled={submitting || !canSubmit}>{submitting ? '…' : t('submit')}</Button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
```

Run: `pnpm --filter @sassy-auth/admin test -- reset-password-form.test.tsx` → confirm PASS.

- [ ] **Step 8: Run the full admin test suite for a regression check**

Run: `pnpm --filter @sassy-auth/admin test`
Expected: PASS, no regressions.

- [ ] **Step 9: Type-check the admin app**

Run: `pnpm --filter @sassy-auth/admin exec tsc --noEmit`
Expected: exits 0.

- [ ] **Step 10: Commit**

```bash
git add apps/admin/app/signup apps/admin/app/accept-invite apps/admin/app/reset-password
git commit -m "feat(admin): live password requirements checklist on signup, accept-invite, reset-password"
```

---

### Task 14: E2E — per-app override actually changes what's accepted

**Files:**
- Modify: `apps/admin-e2e/tests/signup.spec.ts`
- Modify: `apps/admin-e2e/pages/signup.page.ts` (only if a new selector is needed for the policy checklist)

- [ ] **Step 1: Read the existing signup e2e spec and page object**

Open `apps/admin-e2e/tests/signup.spec.ts` and `apps/admin-e2e/pages/signup.page.ts` to match their existing setup helpers (how a test app is created/seeded for the e2e run) before writing the new test — do not duplicate a parallel setup convention.

- [ ] **Step 2: Add a new e2e test**

Append to `apps/admin-e2e/tests/signup.spec.ts`, using whatever this suite's existing convention is for creating a test `SaApp` via the admin API before navigating (mirror an existing test in the same file that already needs a fresh app):

```ts
test('a per-app password policy override changes what password signup accepts', async ({ page, request }) => {
  // Create a test app with a relaxed override (6 chars, no complexity) via
  // whatever authenticated admin API helper this suite's other tests already
  // use for app setup — see an existing test above for the exact call shape.
  const app = await createTestApp(request, {
    passwordPolicyOverride: {
      minLength: 6, requireUppercase: false, requireLowercase: false,
      requireNumber: false, requireSpecial: false, minNumbers: 0, minSpecial: 0,
    },
  })

  await page.goto(`/signup?client_id=${app.publicId}`)
  await page.getByLabel(/first name/i).fill('Test')
  await page.getByLabel(/last name/i).fill('User')
  await page.getByLabel(/company name/i).fill('Acme')
  await page.getByLabel(/email/i).fill(`e2e-policy-${Date.now()}@example.com`)
  // 6-char password: would fail the global 12-char default, satisfies this app's override.
  await page.getByLabel(/^password/i).fill('abc123')
  await page.getByLabel(/confirm password/i).fill('abc123')
  await page.getByRole('button', { name: /create account/i }).click()

  await expect(page.getByText(/account created/i)).toBeVisible()
})
```

Replace `createTestApp(request, ...)` with the actual helper name/signature already present in this test file or its imported fixtures (e.g. `apps/admin-e2e/lib/admins.ts` has a similar precedent for user setup — check for an app-equivalent helper, and if none exists, add a minimal one there following that file's existing style rather than inlining raw `request.post` calls into the spec).

- [ ] **Step 3: Run the e2e test**

Run: `pnpm --filter @sassy-auth/admin-e2e exec playwright test signup.spec.ts -g "per-app password policy"`
Expected: PASS against a locally running stack (auth-server + admin + Postgres, per this repo's existing e2e setup docs).

- [ ] **Step 4: Commit**

```bash
git add apps/admin-e2e
git commit -m "test(e2e): verify per-app password policy override changes signup acceptance"
```

---

## Final Verification

- [ ] Run the full monorepo test suite: `pnpm -r test`
- [ ] Run type-checking across all packages: `pnpm -r exec tsc --noEmit`
- [ ] Manually walk through: signup with a weak password (rejected, checklist shows unmet rules) → signup with a strong password (accepted) → set a relaxed override on that app in the admin console → repeat signup with a password that only satisfies the override → confirm accept-invite and forgot-password reset both show the live checklist and reject a policy-violating password server-side (test by disabling JS or calling the API directly with curl to confirm server-side enforcement, not just client-side).
