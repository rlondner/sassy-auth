# 2FA setup-prompt enable/disable toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global env var and a per-`SaApp` nullable override that fully disable the optional "Secure your account" 2FA setup interstitial, independent of the existing re-prompt interval.

**Architecture:** Mirror the existing `twoFactorTrustDays` tri-state pattern (per-app nullable override falling back to a system-default env var) with a new boolean `twoFactorPromptEnabled` field, threaded through the same resolution helper, decision function, public endpoint, DTOs, service, and admin UI that already carry `twoFactorTrustDays`.

**Tech Stack:** NestJS + Prisma (auth-server), Next.js Server Actions (admin), Jest (both), Playwright (e2e).

**Spec:** `docs/superpowers/specs/2026-09-24-2fa-prompt-toggle-design.md`

---

### Task 1: Schema migration

**Files:**
- Modify: `packages/db/schema.prisma`
- Create: `packages/db/migrations/20260925000000_add_two_factor_prompt_enabled/migration.sql`

- [ ] **Step 1: Add the column to the Prisma schema**

In `packages/db/schema.prisma`, in the `SaApp` model, add the new field directly after `twoFactorTrustDays`:

```prisma
  twoFactorTrustDays Int?
  twoFactorPromptEnabled Boolean? // null = inherit system default (TWO_FACTOR_PROMPT_ENABLED)
  requireTwoFactor   Boolean        @default(false)
```

- [ ] **Step 2: Write the migration SQL by hand**

Create `packages/db/migrations/20260925000000_add_two_factor_prompt_enabled/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "SaApp" ADD COLUMN "twoFactorPromptEnabled" BOOLEAN;
```

(Mirrors `packages/db/migrations/20260712000000_2fa_schema/migration.sql:19`, which added the sibling nullable `twoFactorTrustDays` column the same way — no default, purely additive.)

- [ ] **Step 3: Regenerate the Prisma client**

Run from the repo root:
```bash
cd packages/db && npx prisma generate
```
Expected: completes without error, `@sassy-auth/db`'s generated types now include `twoFactorPromptEnabled: boolean | null` on `SaApp`.

- [ ] **Step 4: Apply the migration to the local dev database**

Run:
```bash
cd packages/db && npx prisma migrate deploy
```
Expected: `20260925000000_add_two_factor_prompt_enabled` is applied.

- [ ] **Step 5: Commit**

```bash
git add packages/db/schema.prisma packages/db/migrations/20260925000000_add_two_factor_prompt_enabled
git commit -m "feat(db): add SaApp.twoFactorPromptEnabled column"
```

---

### Task 2: System default + resolution helper (auth-server)

**Files:**
- Modify: `apps/auth-server/src/auth/resolve-trust-days.ts`
- Modify: `apps/auth-server/src/auth/resolve-trust-days.spec.ts`

- [ ] **Step 1: Write the failing tests**

Append to `apps/auth-server/src/auth/resolve-trust-days.spec.ts`:

```ts
describe('getSystemPromptEnabled', () => {
  const origEnv = process.env;

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it('returns true when TWO_FACTOR_PROMPT_ENABLED is not set', () => {
    delete process.env['TWO_FACTOR_PROMPT_ENABLED'];
    expect(getSystemPromptEnabled()).toBe(true);
  });

  it('returns true when TWO_FACTOR_PROMPT_ENABLED is the empty string', () => {
    process.env['TWO_FACTOR_PROMPT_ENABLED'] = '';
    expect(getSystemPromptEnabled()).toBe(true);
  });

  it('returns false when TWO_FACTOR_PROMPT_ENABLED is "false"', () => {
    process.env['TWO_FACTOR_PROMPT_ENABLED'] = 'false';
    expect(getSystemPromptEnabled()).toBe(false);
  });

  it('returns false when TWO_FACTOR_PROMPT_ENABLED is "FALSE" (case-insensitive)', () => {
    process.env['TWO_FACTOR_PROMPT_ENABLED'] = 'FALSE';
    expect(getSystemPromptEnabled()).toBe(false);
  });

  it('returns false when TWO_FACTOR_PROMPT_ENABLED is "0"', () => {
    process.env['TWO_FACTOR_PROMPT_ENABLED'] = '0';
    expect(getSystemPromptEnabled()).toBe(false);
  });

  it('returns true when TWO_FACTOR_PROMPT_ENABLED is "true"', () => {
    process.env['TWO_FACTOR_PROMPT_ENABLED'] = 'true';
    expect(getSystemPromptEnabled()).toBe(true);
  });

  it('returns true when TWO_FACTOR_PROMPT_ENABLED is an unrecognized string (fail open)', () => {
    process.env['TWO_FACTOR_PROMPT_ENABLED'] = 'yes-please';
    expect(getSystemPromptEnabled()).toBe(true);
  });
});

describe('resolvePromptEnabled', () => {
  it('returns the app override when it is explicitly true', () => {
    expect(resolvePromptEnabled({ twoFactorPromptEnabled: true }, false)).toBe(true);
  });

  it('returns the app override when it is explicitly false', () => {
    expect(resolvePromptEnabled({ twoFactorPromptEnabled: false }, true)).toBe(false);
  });

  it('returns systemDefault when app override is null', () => {
    expect(resolvePromptEnabled({ twoFactorPromptEnabled: null }, true)).toBe(true);
    expect(resolvePromptEnabled({ twoFactorPromptEnabled: null }, false)).toBe(false);
  });
});
```

Also update the top import line to pull in the new exports:

```ts
import { resolveTrustDays, getSystemTrustDays, resolvePromptEnabled, getSystemPromptEnabled } from './resolve-trust-days';
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `apps/auth-server`):
```bash
npx jest auth/resolve-trust-days.spec.ts
```
Expected: FAIL — `getSystemPromptEnabled` and `resolvePromptEnabled` are not exported.

- [ ] **Step 3: Implement the helpers**

In `apps/auth-server/src/auth/resolve-trust-days.ts`, append after `resolveTrustDays`:

```ts
/**
 * Read the system-wide default for whether the optional 2FA setup
 * interstitial is shown at all, from TWO_FACTOR_PROMPT_ENABLED. Fails open:
 * anything other than an explicit "false"/"0" (case-insensitive) is treated
 * as enabled, so a malformed env var never silently disables the prompt
 * fleet-wide.
 */
export function getSystemPromptEnabled(): boolean {
  const raw = process.env['TWO_FACTOR_PROMPT_ENABLED'];
  if (raw === undefined || raw === '') return true;
  return raw.toLowerCase() !== 'false' && raw !== '0';
}

/**
 * Resolve the effective prompt-enabled value for a specific app.
 *
 * @param app - Object containing the app's optional twoFactorPromptEnabled field.
 * @param systemDefault - The system-wide default, typically from getSystemPromptEnabled().
 */
export function resolvePromptEnabled(
  app: { twoFactorPromptEnabled: boolean | null },
  systemDefault: boolean,
): boolean {
  return app.twoFactorPromptEnabled ?? systemDefault;
}
```

Also update the file's doc comment header to mention the new pair, and keep the two concerns (trust-days, prompt-enabled) clearly separated — no shared internal state.

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
npx jest auth/resolve-trust-days.spec.ts
```
Expected: PASS, all tests including the new ones.

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/auth/resolve-trust-days.ts apps/auth-server/src/auth/resolve-trust-days.spec.ts
git commit -m "feat(auth-server): add getSystemPromptEnabled/resolvePromptEnabled"
```

---

### Task 3: Decision function short-circuit (auth-server, canonical)

**Files:**
- Modify: `apps/auth-server/src/auth/should-prompt-two-factor.ts`
- Modify: `apps/auth-server/src/auth/should-prompt-two-factor.spec.ts`

- [ ] **Step 1: Write the failing tests**

Append to `apps/auth-server/src/auth/should-prompt-two-factor.spec.ts`:

```ts
  it('returns false when promptEnabled is false, even if never prompted', () => {
    expect(
      shouldPromptTwoFactor({ twoFactorEnabled: false, promptedAt: null, now: NOW, intervalDays: INTERVAL_DAYS, promptEnabled: false }),
    ).toBe(false);
  });

  it('returns false when promptEnabled is false, even if the interval elapsed', () => {
    const longAgo = new Date(NOW.getTime() - (INTERVAL_DAYS + 1) * 24 * 60 * 60 * 1000);
    expect(
      shouldPromptTwoFactor({ twoFactorEnabled: false, promptedAt: longAgo, now: NOW, intervalDays: INTERVAL_DAYS, promptEnabled: false }),
    ).toBe(false);
  });

  it('returns true when promptEnabled is true and all other conditions are met', () => {
    expect(
      shouldPromptTwoFactor({ twoFactorEnabled: false, promptedAt: null, now: NOW, intervalDays: INTERVAL_DAYS, promptEnabled: true }),
    ).toBe(true);
  });
```

Update every existing call in that file to pass `promptEnabled: true` (they currently omit it, which will now be a TypeScript error since the param becomes required):

```ts
  it('returns true when twoFactorEnabled is false and promptedAt is null', () => {
    expect(
      shouldPromptTwoFactor({ twoFactorEnabled: false, promptedAt: null, now: NOW, intervalDays: INTERVAL_DAYS, promptEnabled: true }),
    ).toBe(true);
  });

  it('returns false when twoFactorEnabled is true (already enrolled)', () => {
    expect(
      shouldPromptTwoFactor({ twoFactorEnabled: true, promptedAt: null, now: NOW, intervalDays: INTERVAL_DAYS, promptEnabled: true }),
    ).toBe(false);
  });

  it('returns false when promptedAt is within the interval', () => {
    const recentlyPrompted = new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000); // 3 days ago
    expect(
      shouldPromptTwoFactor({ twoFactorEnabled: false, promptedAt: recentlyPrompted, now: NOW, intervalDays: INTERVAL_DAYS, promptEnabled: true }),
    ).toBe(false);
  });

  it('returns false when promptedAt is exactly at the interval boundary', () => {
    const exactBoundary = new Date(NOW.getTime() - INTERVAL_DAYS * 24 * 60 * 60 * 1000);
    expect(
      shouldPromptTwoFactor({ twoFactorEnabled: false, promptedAt: exactBoundary, now: NOW, intervalDays: INTERVAL_DAYS, promptEnabled: true }),
    ).toBe(false);
  });

  it('returns true when promptedAt is older than the interval', () => {
    const longAgo = new Date(NOW.getTime() - (INTERVAL_DAYS + 1) * 24 * 60 * 60 * 1000);
    expect(
      shouldPromptTwoFactor({ twoFactorEnabled: false, promptedAt: longAgo, now: NOW, intervalDays: INTERVAL_DAYS, promptEnabled: true }),
    ).toBe(true);
  });

  it('returns true when intervalDays is 0 (prompt every time)', () => {
    const justNow = new Date(NOW.getTime() - 1);
    expect(
      shouldPromptTwoFactor({ twoFactorEnabled: false, promptedAt: justNow, now: NOW, intervalDays: 0, promptEnabled: true }),
    ).toBe(true);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `apps/auth-server`):
```bash
npx jest auth/should-prompt-two-factor.spec.ts
```
Expected: FAIL — TypeScript compile error, `promptEnabled` missing from `ShouldPromptParams`... actually at this point `promptEnabled` isn't a recognized property yet, so the *new* tests fail with "argument of type ... is not assignable" / runtime `undefined` short-circuit not implemented. The pre-existing tests still pass unchanged (extra `promptEnabled: true` property is harmless until the param is added).

- [ ] **Step 3: Implement the short-circuit**

In `apps/auth-server/src/auth/should-prompt-two-factor.ts`, replace the whole file:

```ts
/**
 * Pure decision function: should the optional "Set up 2FA" interstitial be
 * shown to this user after a successful password login?
 *
 * Returns true only when:
 * - promptEnabled is true (the interstitial is not disabled globally or for
 *   this app), AND
 * - The user does NOT yet have 2FA enabled, AND
 * - They have never been prompted (promptedAt is null) OR the last prompt was
 *   strictly more than intervalDays ago. The boundary itself (elapsed === interval)
 *   returns false to avoid edge-case re-prompts at the exact expiry instant.
 *
 * intervalDays = 0 means "always prompt if not enrolled" (useful for testing).
 */
export interface ShouldPromptParams {
  twoFactorEnabled: boolean;
  promptedAt: Date | null;
  now: Date;
  intervalDays: number;
  promptEnabled: boolean;
}

export function shouldPromptTwoFactor({
  twoFactorEnabled,
  promptedAt,
  now,
  intervalDays,
  promptEnabled,
}: ShouldPromptParams): boolean {
  if (!promptEnabled) return false;
  if (twoFactorEnabled) return false;
  if (promptedAt === null) return true;
  const intervalMs = intervalDays * 24 * 60 * 60 * 1000;
  const elapsedMs = now.getTime() - promptedAt.getTime();
  return elapsedMs > intervalMs;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
npx jest auth/should-prompt-two-factor.spec.ts
```
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/auth/should-prompt-two-factor.ts apps/auth-server/src/auth/should-prompt-two-factor.spec.ts
git commit -m "feat(auth-server): add promptEnabled short-circuit to shouldPromptTwoFactor"
```

---

### Task 4: Decision function short-circuit (admin client-side copy)

**Files:**
- Modify: `apps/admin/lib/two-factor-prompt.ts`
- Modify: `apps/admin/lib/__tests__/two-factor-prompt.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `apps/admin/lib/__tests__/two-factor-prompt.test.ts`, inside the existing `describe('shouldPromptTwoFactor', ...)` block (add before its closing `})` at line 79):

```ts
  it('returns false when promptEnabled is false, even if never prompted', () => {
    const result = shouldPromptTwoFactor({
      twoFactorEnabled: false,
      promptedAt: null,
      now: new Date('2026-08-23T00:00:00Z'),
      intervalDays: 14,
      promptEnabled: false,
    })

    expect(result).toBe(false)
  })

  it('returns true when promptEnabled is true and all other conditions are met', () => {
    const result = shouldPromptTwoFactor({
      twoFactorEnabled: false,
      promptedAt: null,
      now: new Date('2026-08-23T00:00:00Z'),
      intervalDays: 14,
      promptEnabled: true,
    })

    expect(result).toBe(true)
  })
```

Add `promptEnabled: true` to every existing call in that describe block (the six calls at lines 5-77) — same mechanical update as Task 3.

Then append a new describe block after `getSystemTrustDaysClient`'s (after line 113):

```ts
describe('getSystemPromptEnabledClient', () => {
  const originalEnv = process.env['TWO_FACTOR_PROMPT_ENABLED']

  afterEach(() => {
    if (originalEnv === undefined) delete process.env['TWO_FACTOR_PROMPT_ENABLED']
    else process.env['TWO_FACTOR_PROMPT_ENABLED'] = originalEnv
  })

  it('defaults to true when unset', () => {
    delete process.env['TWO_FACTOR_PROMPT_ENABLED']
    expect(getSystemPromptEnabledClient()).toBe(true)
  })

  it('returns false when set to "false"', () => {
    process.env['TWO_FACTOR_PROMPT_ENABLED'] = 'false'
    expect(getSystemPromptEnabledClient()).toBe(false)
  })

  it('returns false when set to "0"', () => {
    process.env['TWO_FACTOR_PROMPT_ENABLED'] = '0'
    expect(getSystemPromptEnabledClient()).toBe(false)
  })

  it('returns true when set to "true"', () => {
    process.env['TWO_FACTOR_PROMPT_ENABLED'] = 'true'
    expect(getSystemPromptEnabledClient()).toBe(true)
  })
})
```

Update the import line:

```ts
import { shouldPromptTwoFactor, getSystemTrustDaysClient, getSystemPromptEnabledClient } from '../two-factor-prompt'
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `apps/admin`):
```bash
npx jest lib/__tests__/two-factor-prompt.test.ts
```
Expected: FAIL — `getSystemPromptEnabledClient` is not exported; `promptEnabled` not accepted.

- [ ] **Step 3: Implement**

Replace `apps/admin/lib/two-factor-prompt.ts` in full:

```ts
/**
 * Client-side copy of the shouldPromptTwoFactor logic.
 * The canonical version with full unit tests lives in:
 * apps/auth-server/src/auth/should-prompt-two-factor.ts
 * Keep these in sync.
 */
export function shouldPromptTwoFactor(params: {
  twoFactorEnabled: boolean;
  promptedAt: Date | null;
  now: Date;
  intervalDays: number;
  promptEnabled: boolean;
}): boolean {
  if (!params.promptEnabled) return false
  if (params.twoFactorEnabled) return false
  if (!params.promptedAt) return true
  const intervalMs = params.intervalDays * 24 * 60 * 60 * 1000
  return params.now.getTime() - params.promptedAt.getTime() > intervalMs
}

/**
 * Reads TWO_FACTOR_TRUST_DAYS from process.env (available in Server Actions).
 * Default: 14 days.
 */
export function getSystemTrustDaysClient(): number {
  const raw = process.env['TWO_FACTOR_TRUST_DAYS']
  if (!raw) return 14
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : 14
}

/**
 * Reads TWO_FACTOR_PROMPT_ENABLED from process.env (available in Server
 * Actions). Fails open: anything other than an explicit "false"/"0"
 * (case-insensitive) is treated as enabled. Default: true.
 */
export function getSystemPromptEnabledClient(): boolean {
  const raw = process.env['TWO_FACTOR_PROMPT_ENABLED']
  if (raw === undefined || raw === '') return true
  return raw.toLowerCase() !== 'false' && raw !== '0'
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
npx jest lib/__tests__/two-factor-prompt.test.ts
```
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/lib/two-factor-prompt.ts apps/admin/lib/__tests__/two-factor-prompt.test.ts
git commit -m "feat(admin): add promptEnabled short-circuit to client-side shouldPromptTwoFactor"
```

---

### Task 5: Wire into the public `app-trust-days` endpoint

**Files:**
- Modify: `apps/auth-server/src/token/token.controller.ts:66,107-116`

- [ ] **Step 1: Update the import**

At `apps/auth-server/src/token/token.controller.ts:66`, change:

```ts
import { resolveTrustDays, getSystemTrustDays } from '../auth/resolve-trust-days';
```

to:

```ts
import { resolveTrustDays, getSystemTrustDays, resolvePromptEnabled, getSystemPromptEnabled } from '../auth/resolve-trust-days';
```

- [ ] **Step 2: Update the doc comment and handler**

Replace the `appTrustDays` handler (lines 93-116) with:

```ts
  /**
   * GET /api/token/app-trust-days?client_id=<sqid>
   *
   * Public (unauthenticated) endpoint. Returns the effective 2FA trust interval
   * and whether the optional setup interstitial is enabled for the app
   * identified by client_id (a public sqid). Used by the admin console's
   * signIn server action to resolve both without duplicating
   * resolveTrustDays/resolvePromptEnabled logic client-side.
   *
   * Disclosure is safe: both values are non-sensitive configuration and
   * client_id is already public (displayed in the apps list, embedded in
   * OAuth authorize URLs). effectiveTrustDays is always a resolved positive
   * integer and promptEnabled is always a resolved boolean; the system
   * defaults are returned when client_id is missing, the app is not found,
   * or the app has no per-app override.
   */
  @Get('app-trust-days')
  async appTrustDays(@Query('client_id') clientId: string) {
    const systemTrustDays = getSystemTrustDays();
    const systemPromptEnabled = getSystemPromptEnabled();
    if (!clientId) return { effectiveTrustDays: systemTrustDays, promptEnabled: systemPromptEnabled };
    const app = await prisma.saApp.findUnique({
      where: { publicId: clientId },
      select: { twoFactorTrustDays: true, twoFactorPromptEnabled: true },
    });
    if (!app) return { effectiveTrustDays: systemTrustDays, promptEnabled: systemPromptEnabled };
    return {
      effectiveTrustDays: resolveTrustDays(app, systemTrustDays),
      promptEnabled: resolvePromptEnabled(app, systemPromptEnabled),
    };
  }
```

- [ ] **Step 3: Check for an existing controller test to extend**

Run:
```bash
cd apps/auth-server && grep -rn "appTrustDays\|app-trust-days" src/token/*.spec.ts
```
If a `token.controller.spec.ts` (or similar) test already covers `appTrustDays`, add cases mirroring the existing `effectiveTrustDays` assertions but for `promptEnabled` (app override true/false/null, no app found, no client_id). If no such test file exists, skip — this endpoint is covered end-to-end via Task 9's actions.ts wiring and the existing `resolve-trust-days.spec.ts` unit coverage from Task 2.

- [ ] **Step 4: Run the full auth-server test suite**

Run:
```bash
cd apps/auth-server && npx jest
```
Expected: PASS, no regressions (in particular, no existing test asserts the exact shape of the `appTrustDays` response in a way that would break from the added field).

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/token/token.controller.ts
git commit -m "feat(auth-server): return promptEnabled from GET /api/token/app-trust-days"
```

---

### Task 6: DTOs + validation tests

**Files:**
- Modify: `apps/auth-server/src/apps/dto/create-app.dto.ts`
- Modify: `apps/auth-server/src/apps/dto/update-app.dto.ts`
- Modify: `apps/auth-server/src/apps/dto/app-dto.spec.ts`

- [ ] **Step 1: Write the failing tests**

Append to `apps/auth-server/src/apps/dto/app-dto.spec.ts`:

```ts
describe('UpdateAppDto — twoFactorPromptEnabled validation', () => {
  async function check(value: unknown): Promise<string[]> {
    const dto = Object.assign(new UpdateAppDto(), { twoFactorPromptEnabled: value });
    const errors = validateSync(dto);
    return errors.flatMap((e) => Object.values(e.constraints ?? {}));
  }

  it('accepts null (inherit system default)', async () => expect(await check(null)).toHaveLength(0));
  it('accepts undefined (omit)', async () => expect(await check(undefined)).toHaveLength(0));
  it('accepts true', async () => expect(await check(true)).toHaveLength(0));
  it('accepts false', async () => expect(await check(false)).toHaveLength(0));
  it('rejects "true" (string)', async () => expect(await check('true')).not.toHaveLength(0));
  it('rejects 1 (number)', async () => expect(await check(1)).not.toHaveLength(0));
});

describe('CreateAppDto — twoFactorPromptEnabled validation', () => {
  async function check(value: unknown): Promise<string[]> {
    const dto = plainToInstance(CreateAppDto, { name: 'A', url: 'https://a.example.com', twoFactorPromptEnabled: value });
    const errors = validateSync(dto);
    return errors.flatMap((e) => Object.values(e.constraints ?? {}));
  }

  it('accepts null (inherit system default)', async () => expect(await check(null)).toHaveLength(0));
  it('accepts undefined (omit)', async () => expect(await check(undefined)).toHaveLength(0));
  it('accepts true', async () => expect(await check(true)).toHaveLength(0));
  it('accepts false', async () => expect(await check(false)).toHaveLength(0));
  it('rejects "true" (string)', async () => expect(await check('true')).not.toHaveLength(0));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `apps/auth-server`):
```bash
npx jest apps/dto/app-dto.spec.ts
```
Expected: FAIL — DTOs don't have `twoFactorPromptEnabled` yet, so `class-transformer`/`class-validator` either drop the field silently or errors don't match; the `rejects` assertions fail because there's no property to validate.

- [ ] **Step 3: Add the field to both DTOs**

In `apps/auth-server/src/apps/dto/create-app.dto.ts`, after the `twoFactorTrustDays` field (line 29), add:

```ts
  /**
   * Whether the optional post-login "Secure your account" 2FA setup
   * interstitial is shown for this app.
   * null → use system default (TWO_FACTOR_PROMPT_ENABLED env var, default true).
   */
  @IsOptional()
  @ValidateIf((o: CreateAppDto) => o.twoFactorPromptEnabled !== null)
  @IsBoolean()
  twoFactorPromptEnabled?: boolean | null;
```

In `apps/auth-server/src/apps/dto/update-app.dto.ts`, after the `twoFactorTrustDays` field (line 33), add:

```ts
  /**
   * Whether the optional post-login "Secure your account" 2FA setup
   * interstitial is shown for this app.
   * null → use system default (TWO_FACTOR_PROMPT_ENABLED env var, default true).
   */
  @IsOptional()
  @ValidateIf((o: UpdateAppDto) => o.twoFactorPromptEnabled !== null)
  @IsBoolean()
  twoFactorPromptEnabled?: boolean | null;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
npx jest apps/dto/app-dto.spec.ts
```
Expected: PASS, all tests including the existing `twoFactorTrustDays` ones (no regressions).

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/apps/dto/create-app.dto.ts apps/auth-server/src/apps/dto/update-app.dto.ts apps/auth-server/src/apps/dto/app-dto.spec.ts
git commit -m "feat(auth-server): add twoFactorPromptEnabled to app create/update DTOs"
```

---

### Task 7: AppsService wiring

**Files:**
- Modify: `apps/auth-server/src/apps/apps.service.ts`
- Modify: `apps/auth-server/src/apps/apps.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

In `apps/auth-server/src/apps/apps.service.spec.ts`, update the two fixture rows (lines 55-56) to include the new field:

```ts
const appRow = { id: 1, publicId: 'sq_1', name: 'Customer Portal', url: 'https://portal.example.com', isPlatform: false, twoFactorTrustDays: null, twoFactorPromptEnabled: null, requireTwoFactor: false };
const platformRow = { id: 2, publicId: 'sq_2', name: 'SassyAuth', url: 'https://auth', isPlatform: true, twoFactorTrustDays: null, twoFactorPromptEnabled: null, requireTwoFactor: false };
```

Update every `expect(result).toEqual({...})` / `expect(...).toEqual([{...}])` block that lists out an app's full shape (lines 85, 110-115, 175) to add `twoFactorPromptEnabled: null` alongside the existing `twoFactorTrustDays: null` entry in each.

Append new test cases after the existing `twoFactorTrustDays` tests (after line 366's block, before line 368's `updateApp omits...` test):

```ts
  it('createApp stores a provided twoFactorPromptEnabled', async () => {
    mockPrisma.$transaction.mockImplementation(async (cb: (tx: typeof mockPrisma) => unknown) => cb(mockPrisma));
    mockPrisma.saApp.create.mockResolvedValue({ ...appRow, publicId: 'placeholder' });
    mockPrisma.saApp.update.mockResolvedValue({ ...appRow, twoFactorPromptEnabled: false });
    const result = await service.createApp('ba-caller', {
      name: 'Customer Portal', url: 'https://portal.example.com', twoFactorPromptEnabled: false,
    });
    expect(mockPrisma.saApp.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ twoFactorPromptEnabled: false }),
    }));
    expect(result.twoFactorPromptEnabled).toBe(false);
  });

  it('updateApp sets twoFactorPromptEnabled when provided', async () => {
    mockPrisma.saApp.findUnique.mockResolvedValue(appRow);
    mockPrisma.saApp.update.mockResolvedValue({ ...appRow, twoFactorPromptEnabled: true });
    await service.updateApp('ba-caller', 'sq_1', { twoFactorPromptEnabled: true });
    expect(mockPrisma.saApp.update).toHaveBeenCalledWith({
      where: { publicId: 'sq_1' },
      data: { twoFactorPromptEnabled: true },
      include: { defaultOrg: { select: { publicId: true } }, defaultRole: { select: { publicId: true } } },
    });
  });

  it('updateApp clears twoFactorPromptEnabled when given null', async () => {
    mockPrisma.saApp.findUnique.mockResolvedValue(appRow);
    mockPrisma.saApp.update.mockResolvedValue({ ...appRow, twoFactorPromptEnabled: null });
    await service.updateApp('ba-caller', 'sq_1', { twoFactorPromptEnabled: null });
    expect(mockPrisma.saApp.update).toHaveBeenCalledWith({
      where: { publicId: 'sq_1' },
      data: { twoFactorPromptEnabled: null },
      include: { defaultOrg: { select: { publicId: true } }, defaultRole: { select: { publicId: true } } },
    });
  });

  it('updateApp omits twoFactorPromptEnabled from update data when DTO omits it', async () => {
    mockPrisma.saApp.findUnique.mockResolvedValue(appRow);
    mockPrisma.saApp.update.mockResolvedValue({ ...appRow, name: 'Renamed' });
    await service.updateApp('ba-caller', 'sq_1', { name: 'Renamed' });
    expect(mockPrisma.saApp.update).toHaveBeenCalledWith({
      where: { publicId: 'sq_1' },
      data: { name: 'Renamed' },
      include: { defaultOrg: { select: { publicId: true } }, defaultRole: { select: { publicId: true } } },
    });
  });
```

Note: the last test above duplicates the existing "omits twoFactorTrustDays" test's shape — only add it if `apps.service.spec.ts` doesn't already have an equivalent generic "omits absent fields" test covering this; check with:
```bash
grep -n "omits.*from update data when DTO omits" apps/auth-server/src/apps/apps.service.spec.ts
```
If one already exists for a similar field, skip adding a duplicate and rely on the existing one (the `updateApp` guard change in Step 3 below is what actually needs coverage — the "at least one field" `BadRequestException` guard).

Also add a guard test:

```ts
  it('updateApp does NOT throw when only twoFactorPromptEnabled is provided', async () => {
    mockPrisma.saApp.findUnique.mockResolvedValue(appRow);
    mockPrisma.saApp.update.mockResolvedValue({ ...appRow, twoFactorPromptEnabled: false });
    await expect(service.updateApp('ba-caller', 'sq_1', { twoFactorPromptEnabled: false })).resolves.toBeDefined();
    expect(mockPrisma.saApp.update).toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `apps/auth-server`):
```bash
npx jest apps/apps.service.spec.ts
```
Expected: FAIL — `formatApp` doesn't return `twoFactorPromptEnabled`, `createApp`/`updateApp` don't write it, and the `updateApp`-only-one-field guard throws `BadRequestException` for a DTO containing only `twoFactorPromptEnabled`.

- [ ] **Step 3: Implement in apps.service.ts**

In `apps/auth-server/src/apps/apps.service.ts`:

1. Extend `AppRow` (line 18-34) — add after `twoFactorTrustDays: number | null;`:
```ts
  twoFactorTrustDays: number | null; twoFactorPromptEnabled: boolean | null; requireTwoFactor: boolean;
```

2. Extend `formatApp` (line 35-55) — add after the `twoFactorTrustDays` line:
```ts
    twoFactorTrustDays: a.twoFactorTrustDays ?? null,
    twoFactorPromptEnabled: a.twoFactorPromptEnabled ?? null,
    requireTwoFactor: a.requireTwoFactor,
```

3. In `createApp` (line 262), add `twoFactorPromptEnabled: dto.twoFactorPromptEnabled ?? null` to the `data` object:
```ts
          data: { publicId: generatePendingPublicId(), name: dto.name, url: dto.url, logo: dto.logo ?? null, isPlatform: false, twoFactorTrustDays: dto.twoFactorTrustDays ?? null, twoFactorPromptEnabled: dto.twoFactorPromptEnabled ?? null, requireTwoFactor: dto.requireTwoFactor ?? false, allowOfflineAccess: dto.allowOfflineAccess ?? false },
```

4. In `updateApp`'s "at least one field" guard (lines 282-299), add `dto.twoFactorPromptEnabled === undefined &&` to the condition list (after the `twoFactorTrustDays` line) and add `twoFactorPromptEnabled` to the error message's field list:
```ts
    if (
      dto.name === undefined &&
      dto.url === undefined &&
      dto.logo === undefined &&
      dto.twoFactorTrustDays === undefined &&
      dto.twoFactorPromptEnabled === undefined &&
      dto.requireTwoFactor === undefined &&
      dto.allowOfflineAccess === undefined &&
      dto.redirectUris === undefined &&
      dto.defaultOrgId === undefined &&
      dto.defaultRoleId === undefined &&
      dto.passwordPolicyOverride === undefined &&
      dto.activationWebhookUrl === undefined &&
      dto.activationEmailOverride === undefined
    ) {
      throw new BadRequestException(
        'At least one of name, url, logo, twoFactorTrustDays, twoFactorPromptEnabled, requireTwoFactor, allowOfflineAccess, redirectUris, defaultOrgId, defaultRoleId, passwordPolicyOverride, activationWebhookUrl, or activationEmailOverride must be provided',
      );
    }
```

5. In `updateApp`'s `data` object (lines 317-355), add after the `twoFactorTrustDays` spread:
```ts
            ...(dto.twoFactorTrustDays !== undefined && {
              twoFactorTrustDays: dto.twoFactorTrustDays,
            }),
            ...(dto.twoFactorPromptEnabled !== undefined && {
              twoFactorPromptEnabled: dto.twoFactorPromptEnabled,
            }),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
npx jest apps/apps.service.spec.ts
```
Expected: PASS, all tests including the pre-existing ones.

- [ ] **Step 5: Run the full auth-server suite**

Run:
```bash
npx jest
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/auth-server/src/apps/apps.service.ts apps/auth-server/src/apps/apps.service.spec.ts
git commit -m "feat(auth-server): wire twoFactorPromptEnabled through AppsService"
```

---

### Task 8: Admin types

**Files:**
- Modify: `apps/admin/lib/types.ts`

- [ ] **Step 1: Update the `App`, `CreateAppPayload`, and `UpdateAppPayload` interfaces**

In `apps/admin/lib/types.ts`, add `twoFactorPromptEnabled?: boolean | null;` immediately after each existing `twoFactorTrustDays?: number | null;` line — there are three (lines 98, 121, 131):

```ts
export interface App {
  // ...
  twoFactorTrustDays?: number | null;
  twoFactorPromptEnabled?: boolean | null;
  requireTwoFactor: boolean;
  // ...
}

export interface CreateAppPayload {
  // ...
  twoFactorTrustDays?: number | null;
  twoFactorPromptEnabled?: boolean | null;
  requireTwoFactor?: boolean;
  // ...
}

export interface UpdateAppPayload {
  // ...
  twoFactorTrustDays?: number | null;
  twoFactorPromptEnabled?: boolean | null;
  requireTwoFactor?: boolean;
  // ...
}
```

- [ ] **Step 2: Type-check**

Run (from `apps/admin`):
```bash
npx tsc --noEmit
```
Expected: no new errors (this is a pure additive optional-field change; nothing currently constructs these interfaces exhaustively in a way that would break).

- [ ] **Step 3: Commit**

```bash
git add apps/admin/lib/types.ts
git commit -m "feat(admin): add twoFactorPromptEnabled to App/CreateAppPayload/UpdateAppPayload"
```

---

### Task 9: Wire into the admin login server action

**Files:**
- Modify: `apps/admin/app/login/actions.ts:12,333-360`

- [ ] **Step 1: Update the import**

At `apps/admin/app/login/actions.ts:12`, change:

```ts
import { shouldPromptTwoFactor, getSystemTrustDaysClient } from '@/lib/two-factor-prompt'
```

to:

```ts
import { shouldPromptTwoFactor, getSystemTrustDaysClient, getSystemPromptEnabledClient } from '@/lib/two-factor-prompt'
```

- [ ] **Step 2: Resolve `promptEnabled` alongside `intervalDays`**

Replace lines 333-360 (the "Resolve interval" block through the `shouldPromptTwoFactor` call and redirect) with:

```ts
  // Resolve interval + prompt-enabled: check if next contains a client_id for
  // per-app override.
  // validateNextUrl returns relative paths — parse with a base so both relative
  // and absolute values work without throwing.
  let intervalDays = getSystemTrustDaysClient()
  let promptEnabled = getSystemPromptEnabledClient()
  if (nextSafe) {
    try {
      const nextUrl = new URL(nextSafe, AUTH_SERVER_URL)
      const clientId = nextUrl.searchParams.get('client_id')
      if (clientId) {
        const trustRes = await fetch(
          `${AUTH_SERVER_URL}/api/token/app-trust-days?client_id=${encodeURIComponent(clientId)}`,
          { cache: 'no-store' },
        )
        if (trustRes.ok) {
          const data = (await trustRes.json()) as { effectiveTrustDays: number; promptEnabled: boolean }
          // FIX 8: guard against deployment-skew payloads
          if (typeof data.effectiveTrustDays === 'number' && data.effectiveTrustDays > 0) {
            intervalDays = data.effectiveTrustDays
          }
          if (typeof data.promptEnabled === 'boolean') {
            promptEnabled = data.promptEnabled
          }
        }
      }
    } catch { /* use system default */ }
  }

  if (twoFactorStateKnown && shouldPromptTwoFactor({ twoFactorEnabled, promptedAt: twoFactorPromptedAt ? new Date(twoFactorPromptedAt) : null, now: new Date(), intervalDays, promptEnabled })) {
    const encodedNext = nextSafe ? encodeURIComponent(nextSafe) : ''
    redirect(`/login/two-factor-prompt${encodedNext ? `?next=${encodedNext}` : ''}`)
  }

  redirect(nextSafe ?? '/users')
```

- [ ] **Step 3: Add tests to the existing `signIn` interstitial test file**

`apps/admin/app/login/__tests__/actions.signin.test.ts` has a
`describe('signIn optional two-factor interstitial', ...)` block (starting
around line 313) that mocks exactly 3 sequential `fetch` calls per test
(forward-session, get-session, two-factor-status) because none of its
existing cases pass a `next` with a `client_id`, so the `app-trust-days`
fetch never fires. Add these two cases inside that same `describe` block,
after the existing `'does not prompt a user who already has 2FA enabled'`
test (after line 358):

```ts
  it('does not prompt when TWO_FACTOR_PROMPT_ENABLED is false (system default, no client_id)', async () => {
    const originalEnv = process.env['TWO_FACTOR_PROMPT_ENABLED']
    process.env['TWO_FACTOR_PROMPT_ENABLED'] = 'false'
    try {
      const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>
      fetchMock
        .mockResolvedValueOnce(upstream(200, {}, SESSION_COOKIE))
        .mockResolvedValueOnce(
          upstream(200, { user: { twoFactorEnabled: false } }),
        )
        .mockResolvedValueOnce(upstream(200, { twoFactorPromptedAt: null }))

      const target = await callExpectingRedirect(
        formData({ email: 'a@b.io', password: 'pw' }),
      )

      expect(target).toBe('/users')
    } finally {
      if (originalEnv === undefined) delete process.env['TWO_FACTOR_PROMPT_ENABLED']
      else process.env['TWO_FACTOR_PROMPT_ENABLED'] = originalEnv
    }
  })

  it('does not prompt when the per-app app-trust-days lookup returns promptEnabled: false', async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>
    fetchMock
      .mockResolvedValueOnce(upstream(200, {}, SESSION_COOKIE))
      .mockResolvedValueOnce(
        upstream(200, { user: { twoFactorEnabled: false } }),
      )
      .mockResolvedValueOnce(upstream(200, { twoFactorPromptedAt: null }))
      .mockResolvedValueOnce(
        upstream(200, { effectiveTrustDays: 14, promptEnabled: false }),
      )

    const target = await callExpectingRedirect(
      formData({ email: 'a@b.io', password: 'pw', next: '/orgs?client_id=sq_1' }),
    )

    expect(target).toBe('/orgs?client_id=sq_1')
  })
```

`validateNextUrl` (`apps/admin/lib/safe-next.ts:10`) accepts any string
starting with `/` (that isn't protocol-relative or backslash-containing) as-is,
so `/orgs?client_id=sq_1` passes through unchanged — confirmed by reading its
implementation, no test-time surprises expected.

- [ ] **Step 4: Run the admin test suite**

Run:
```bash
npx jest app/login
```
Expected: PASS, no regressions in existing sign-in tests (the new `promptEnabled` variable defaults to `true` via `getSystemPromptEnabledClient()`, so every test that doesn't mock `TWO_FACTOR_PROMPT_ENABLED` or the `app-trust-days` response behaves exactly as before).

- [ ] **Step 5: Commit**

```bash
git add apps/admin/app/login/actions.ts apps/admin/app/login/__tests__/actions.signin.test.ts
git commit -m "feat(admin): resolve promptEnabled in the signIn server action"
```

---

### Task 10: i18n strings

**Files:**
- Modify: `apps/admin/messages/en.json`
- Modify: `apps/admin/messages/fr.json`

- [ ] **Step 1: Add English keys**

In `apps/admin/messages/en.json`, in the `apps.fields` object, add after `requireTwoFactorHint` (line 67):

```json
      "twoFactorPromptEnabled": "\"Secure your account\" prompt",
      "twoFactorPromptEnabledDefault": "Use system default",
      "twoFactorPromptEnabledOn": "Always show",
      "twoFactorPromptEnabledOff": "Never show",
      "twoFactorPromptEnabledHint": "Whether unenrolled users see an optional 2FA setup nudge after signing in. Does not affect Require two-factor authentication above, which is mandatory enrollment.",
```

- [ ] **Step 2: Add French keys**

In `apps/admin/messages/fr.json`, in the same object, add after `requireTwoFactorHint` (line 67):

```json
      "twoFactorPromptEnabled": "Invite « Sécurisez votre compte »",
      "twoFactorPromptEnabledDefault": "Valeur par défaut système",
      "twoFactorPromptEnabledOn": "Toujours afficher",
      "twoFactorPromptEnabledOff": "Ne jamais afficher",
      "twoFactorPromptEnabledHint": "Détermine si les utilisateurs non inscrits voient une invitation facultative à configurer la 2FA après connexion. N'affecte pas «Exiger l'authentification à deux facteurs» ci-dessus, qui est une inscription obligatoire.",
```

- [ ] **Step 3: Validate JSON syntax**

Run:
```bash
cd apps/admin && node -e "JSON.parse(require('fs').readFileSync('messages/en.json', 'utf8')); JSON.parse(require('fs').readFileSync('messages/fr.json', 'utf8')); console.log('OK')"
```
Expected: `OK`.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/messages/en.json apps/admin/messages/fr.json
git commit -m "feat(admin): add i18n strings for the 2FA prompt toggle"
```

---

### Task 11: App create drawer UI

**Files:**
- Modify: `apps/admin/components/app-create-drawer.tsx`
- Modify: `apps/admin/components/__tests__/app-create-drawer.test.tsx`

- [ ] **Step 1: Add the Select test shim**

`apps/admin/components/__tests__/app-create-drawer.test.tsx` currently has no
`jest.mock('@sassy-auth/ui', ...)` at all (it only mocks
`@/app/(admin)/apps/actions`, at lines 8-10) — the drawer has no `Select`
field today. Insert the same Radix-Select-to-native-`<select>` shim used by
`app-edit-drawer.test.tsx` (its full block, lines 25-115 of that file) into
this file, right after the existing `jest.mock('@/app/(admin)/apps/actions', ...)`
block (after line 10):

```tsx
// Radix Select is awkward to drive in JSDOM (it relies on pointer events that
// JSDOM does not implement). Swap it for a thin native <select> shim so tests
// can call fireEvent.change to pick a value. Mirrors the shim in
// app-edit-drawer.test.tsx.
jest.mock('@sassy-auth/ui', () => {
  const actual = jest.requireActual('@sassy-auth/ui')
  type ChildrenProps = { children?: React.ReactNode }
  type SelectProps = ChildrenProps & {
    value?: string
    onValueChange?: (value: string) => void
  }
  type SelectItemProps = ChildrenProps & { value: string }
  type SelectValueProps = { placeholder?: string }
  const SelectContext = React.createContext<{
    value: string
    onValueChange: (value: string) => void
    placeholder: string
  }>({ value: '', onValueChange: () => undefined, placeholder: '' })

  function Select({ value = '', onValueChange = () => undefined, children }: SelectProps) {
    const [placeholder, setPlaceholder] = React.useState('')
    return (
      <SelectContext.Provider value={{ value, onValueChange, placeholder }}>
        <select
          aria-label={placeholder || 'select'}
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
        >
          <option value="" disabled>{placeholder || 'Select'}</option>
          {React.Children.toArray(children).flatMap((child) => {
            if (!React.isValidElement(child)) return []
            const grandchildren = (child.props as ChildrenProps).children
            return React.Children.toArray(grandchildren)
          })}
        </select>
        <div hidden>{children}</div>
        <SelectPlaceholderSink onPlaceholder={setPlaceholder}>{children}</SelectPlaceholderSink>
      </SelectContext.Provider>
    )
  }

  function SelectPlaceholderSink({
    children,
    onPlaceholder,
  }: {
    children?: React.ReactNode
    onPlaceholder: (value: string) => void
  }) {
    React.useEffect(() => {
      let found = ''
      const walk = (nodes: React.ReactNode) => {
        React.Children.forEach(nodes, (node) => {
          if (!React.isValidElement(node)) return
          const props = node.props as Record<string, unknown> | undefined
          if (props && typeof props.placeholder === 'string') {
            found = props.placeholder
          }
          if (props && props.children) walk(props.children as React.ReactNode)
        })
      }
      walk(children)
      onPlaceholder(found)
    }, [children, onPlaceholder])
    return null
  }

  function SelectTrigger({ children }: ChildrenProps) {
    return <>{children}</>
  }
  function SelectContent({ children }: ChildrenProps) {
    return <>{children}</>
  }
  function SelectValue(_props: SelectValueProps) {
    return null
  }
  function SelectItem({ value, children }: SelectItemProps) {
    return <option value={value}>{children}</option>
  }

  return {
    ...actual,
    Select,
    SelectTrigger,
    SelectContent,
    SelectValue,
    SelectItem,
  }
})
```

- [ ] **Step 2: Write the failing test**

Append to `apps/admin/components/__tests__/app-create-drawer.test.tsx`, inside
the `describe('AppCreateDrawer', ...)` block, after the existing `'includes a
picked logo in the create payload'` test (after line 111):

```tsx
  it('includes twoFactorPromptEnabled in the create payload when set to "Never show"', async () => {
    ;(actions.createAppAction as jest.Mock).mockResolvedValue({
      app: { publicId: 'sq_1', name: 'X', url: 'https://x.example', isPlatform: false },
    })
    render(withIntl(<AppCreateDrawer open onOpenChange={() => undefined} />))
    fireEvent.change(screen.getByLabelText(en.apps.fields.name), { target: { value: 'X' } })
    fireEvent.change(screen.getByLabelText(en.apps.fields.url), { target: { value: 'https://x.example' } })
    fireEvent.change(screen.getByLabelText(en.apps.fields.twoFactorPromptEnabled), { target: { value: 'false' } })

    fireEvent.click(screen.getByRole('button', { name: en.apps.drawer.createTitle }))
    await waitFor(() =>
      expect(actions.createAppAction).toHaveBeenCalledWith(
        expect.objectContaining({ twoFactorPromptEnabled: false }),
      ),
    )
  })
```

The existing exact-match test (`'submits valid form and closes'`, lines
23-46) asserts a full literal payload object without `objectContaining`.
Jest's `toHaveBeenCalledWith` uses `toEqual` semantics, which treats a key
explicitly set to `undefined` as equivalent to that key being absent — so
once Step 4 below adds `twoFactorPromptEnabled: undefined` (unchanged/inherit
default) to the submitted payload, that existing test keeps passing
unmodified. No change needed there.

- [ ] **Step 3: Run the tests to verify they fail**

Run:
```bash
npx jest components/__tests__/app-create-drawer.test.tsx
```
Expected: FAIL — `apps.fields.twoFactorPromptEnabled` label not found (field doesn't exist yet); the "unchanged" test may pass vacuously since `createAppAction` is never called with the field either way, but the "Never show" test fails on `getByLabelText`.

- [ ] **Step 4: Implement the UI**

In `apps/admin/components/app-create-drawer.tsx`:

1. Add `Select, SelectContent, SelectItem, SelectTrigger, SelectValue` to the `@sassy-auth/ui` import (line 6-17).

2. Add state after `requireTwoFactor` (line 36):
```ts
  const [twoFactorPromptEnabled, setTwoFactorPromptEnabled] = React.useState<boolean | null>(null)
```

3. Reset it in the `useEffect` close-cleanup (after line 47):
```ts
      setTwoFactorPromptEnabled(null)
```

4. Include it in the submit payload (after line 66, inside `createAppAction({...})`):
```ts
        twoFactorTrustDays,
        twoFactorPromptEnabled: twoFactorPromptEnabled === null ? undefined : twoFactorPromptEnabled,
        requireTwoFactor,
```
(`undefined` is stripped by `JSON.stringify` in `createApp`'s `apiFetch` call, matching the DTO's "omitted = inherit" semantics — sending explicit `null` would also work per the DTO/service, but omitting keeps the create payload identical to today's when the admin never touches this field.)

5. Add the Select control in the JSX, directly after the `twoFactorTrustDays` `<div>` block (after line 140, before the `requireTwoFactor` checkbox `<div>`):
```tsx
            <div>
              <Label htmlFor="twoFactorPromptEnabled">{t('apps.fields.twoFactorPromptEnabled')}</Label>
              <Select
                value={twoFactorPromptEnabled === null ? '__default__' : String(twoFactorPromptEnabled)}
                onValueChange={(v) =>
                  setTwoFactorPromptEnabled(v === '__default__' ? null : v === 'true')
                }
              >
                <SelectTrigger id="twoFactorPromptEnabled">
                  <SelectValue placeholder={t('apps.fields.twoFactorPromptEnabled')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default__">{t('apps.fields.twoFactorPromptEnabledDefault')}</SelectItem>
                  <SelectItem value="true">{t('apps.fields.twoFactorPromptEnabledOn')}</SelectItem>
                  <SelectItem value="false">{t('apps.fields.twoFactorPromptEnabledOff')}</SelectItem>
                </SelectContent>
              </Select>
              <p className="mt-1 text-body-sm text-muted-foreground">
                {t('apps.fields.twoFactorPromptEnabledHint')}
              </p>
            </div>
```

- [ ] **Step 5: Run the tests to verify they pass**

Run:
```bash
npx jest components/__tests__/app-create-drawer.test.tsx
```
Expected: PASS, all tests including pre-existing ones.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/components/app-create-drawer.tsx apps/admin/components/__tests__/app-create-drawer.test.tsx
git commit -m "feat(admin): add 2FA prompt toggle to the app create drawer"
```

---

### Task 12: App edit drawer UI

**Files:**
- Modify: `apps/admin/components/app-edit-drawer.tsx`
- Modify: `apps/admin/components/__tests__/app-edit-drawer.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `apps/admin/components/__tests__/app-edit-drawer.test.tsx`, after the `allowOfflineAccess` test (after line 499):

```tsx
  it('changes twoFactorPromptEnabled and includes it in the patch when changed', async () => {
    ;(actions.updateAppAction as jest.Mock).mockResolvedValue({
      app: { ...app, twoFactorPromptEnabled: false },
    })
    const onOpenChange = jest.fn()
    render(withIntl(<AppEditDrawer app={app} open onOpenChange={onOpenChange} />))

    fireEvent.change(screen.getByLabelText(en.apps.fields.twoFactorPromptEnabled), { target: { value: 'false' } })

    const save = screen.getByRole('button', { name: en.apps.drawer.save })
    expect(save).toBeEnabled()
    fireEvent.click(save)

    await waitFor(() =>
      expect(actions.updateAppAction).toHaveBeenCalledWith('sq_1', { twoFactorPromptEnabled: false }),
    )
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('does not mark the form dirty when twoFactorPromptEnabled is left at inherit', () => {
    render(withIntl(<AppEditDrawer app={app} open onOpenChange={() => undefined} />))
    const save = screen.getByRole('button', { name: en.apps.drawer.save })
    expect(save).toBeDisabled()
  })
```

(`app` at line 129-139 has no `twoFactorPromptEnabled` field, so `app.twoFactorPromptEnabled ?? null` reads as `null` = inherit — the select's default state.)

- [ ] **Step 2: Run the test to verify it fails**

Run (from `apps/admin`):
```bash
npx jest components/__tests__/app-edit-drawer.test.tsx
```
Expected: FAIL — `apps.fields.twoFactorPromptEnabled` label not found.

- [ ] **Step 3: Implement the UI**

In `apps/admin/components/app-edit-drawer.tsx`:

1. State (after line 50):
```ts
  const [twoFactorPromptEnabled, setTwoFactorPromptEnabled] = React.useState<boolean | null>(app.twoFactorPromptEnabled ?? null)
```

2. Reset-on-`app`-change effect (after line 115):
```ts
    setTwoFactorPromptEnabled(app.twoFactorPromptEnabled ?? null)
```

3. `dirty` computation (line 240) — add a clause:
```ts
  const dirty = name !== app.name || url !== app.url || logo !== originalLogo || redirectUrisDirty || twoFactorTrustDays !== (app.twoFactorTrustDays ?? null) || twoFactorPromptEnabled !== (app.twoFactorPromptEnabled ?? null) || requireTwoFactor !== (app.requireTwoFactor ?? false) || allowOfflineAccess !== (app.allowOfflineAccess ?? false) || socialDirty || defaultOrgId !== (app.defaultOrgId ?? null) || defaultRoleId !== (app.defaultRoleId ?? null) || passwordPolicyDirty || webhookUrlDirty || activationDirty
```

4. `patch` type + population (lines 253-262) — add the field to the inline patch type and its conditional assignment:
```ts
    const patch: { name?: string; url?: string; logo?: string | null; redirectUris?: RedirectUri[]; twoFactorTrustDays?: number | null; twoFactorPromptEnabled?: boolean | null; requireTwoFactor?: boolean; allowOfflineAccess?: boolean; defaultOrgId?: string | null; defaultRoleId?: string | null; passwordPolicyOverride?: PasswordPolicy | null; activationWebhookUrl?: string | null; activationEmailOverride?: import('@/lib/types').ActivationEmailBranding | null } = {}
    if (name !== app.name) patch.name = name.trim()
    if (url !== app.url) patch.url = url.trim()
    if (logo !== originalLogo) patch.logo = logo
    if (redirectUrisDirty) patch.redirectUris = redirectUris
    if (twoFactorTrustDays !== (app.twoFactorTrustDays ?? null)) patch.twoFactorTrustDays = twoFactorTrustDays
    if (twoFactorPromptEnabled !== (app.twoFactorPromptEnabled ?? null)) patch.twoFactorPromptEnabled = twoFactorPromptEnabled
    if (requireTwoFactor !== (app.requireTwoFactor ?? false)) patch.requireTwoFactor = requireTwoFactor
```

5. JSX — add the Select directly after the `twoFactorTrustDays` `<div>` (after line 365, before the `requireTwoFactor` checkbox `<div>` at line 366):
```tsx
            <div>
              <Label htmlFor="twoFactorPromptEnabled">{t('apps.fields.twoFactorPromptEnabled')}</Label>
              <Select
                value={twoFactorPromptEnabled === null ? '__default__' : String(twoFactorPromptEnabled)}
                onValueChange={(v) =>
                  setTwoFactorPromptEnabled(v === '__default__' ? null : v === 'true')
                }
              >
                <SelectTrigger id="twoFactorPromptEnabled">
                  <SelectValue placeholder={t('apps.fields.twoFactorPromptEnabled')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default__">{t('apps.fields.twoFactorPromptEnabledDefault')}</SelectItem>
                  <SelectItem value="true">{t('apps.fields.twoFactorPromptEnabledOn')}</SelectItem>
                  <SelectItem value="false">{t('apps.fields.twoFactorPromptEnabledOff')}</SelectItem>
                </SelectContent>
              </Select>
              <p className="mt-1 text-body-sm text-muted-foreground">
                {t('apps.fields.twoFactorPromptEnabledHint')}
              </p>
            </div>
```

(`Select`/`SelectTrigger`/`SelectContent`/`SelectItem`/`SelectValue` are already imported in this file — line 16-20.)

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
npx jest components/__tests__/app-edit-drawer.test.tsx
```
Expected: PASS, all tests including pre-existing ones.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/components/app-edit-drawer.tsx apps/admin/components/__tests__/app-edit-drawer.test.tsx
git commit -m "feat(admin): add 2FA prompt toggle to the app edit drawer"
```

---

### Task 13: App view drawer UI (read-only display)

**Files:**
- Modify: `apps/admin/components/app-view-drawer.tsx`
- Modify: `apps/admin/components/__tests__/app-view-drawer.test.tsx`

- [ ] **Step 1: Write the failing test**

The file's `app` fixture (lines 32-42) has no `twoFactorTrustDays` or
`twoFactorPromptEnabled` field at all — its existing system-default test
(line 106-114) relies on that omission reading as `null` via
`displayApp.twoFactorTrustDays != null ? ... : ...`. Add these three cases in
`apps/admin/components/__tests__/app-view-drawer.test.tsx`, after that test
(after line 114):

```tsx
  it('shows "Use system default" for twoFactorPromptEnabled when unset', () => {
    render(withIntl(<AppViewDrawer app={app} open onOpenChange={() => undefined} onEdit={() => undefined} onDelete={() => undefined} />))
    expect(screen.getByText(en.apps.fields.twoFactorPromptEnabledDefault)).toBeInTheDocument()
  })

  it('shows "Always show" for twoFactorPromptEnabled when true', () => {
    const appWithPromptOn = { ...app, twoFactorPromptEnabled: true }
    render(withIntl(<AppViewDrawer app={appWithPromptOn} open onOpenChange={() => undefined} onEdit={() => undefined} onDelete={() => undefined} />))
    expect(screen.getByText(en.apps.fields.twoFactorPromptEnabledOn)).toBeInTheDocument()
  })

  it('shows "Never show" for twoFactorPromptEnabled when false', () => {
    const appWithPromptOff = { ...app, twoFactorPromptEnabled: false }
    render(withIntl(<AppViewDrawer app={appWithPromptOff} open onOpenChange={() => undefined} onEdit={() => undefined} onDelete={() => undefined} />))
    expect(screen.getByText(en.apps.fields.twoFactorPromptEnabledOff)).toBeInTheDocument()
  })
```

Note the first test's fixture is fetched via the mocked `getAppAction`
(`beforeEach` at line 62 resolves it to `{ app }`), which the component reads
into `displayApp` via its own `useEffect` — same as the existing
`twoFactorTrustDaysSystemDefault` test, so no extra mock wiring is needed for
the "unset" case. The `true`/`false` cases pass the override directly via the
`app` prop, which the component uses as its initial `displayApp` value before
that effect resolves — consistent with how `appWithUris` is used in the
existing `'renders registered redirect URIs...'` test (line 91-104).

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `apps/admin`):
```bash
npx jest components/__tests__/app-view-drawer.test.tsx
```
Expected: FAIL — the three new labels aren't rendered yet.

- [ ] **Step 3: Implement**

In `apps/admin/components/app-view-drawer.tsx`, add a new `TextRow` directly after the `requireTwoFactor` one (after line 138):

```tsx
          <TextRow
            label={t('apps.fields.twoFactorPromptEnabled')}
            value={
              displayApp.twoFactorPromptEnabled === null || displayApp.twoFactorPromptEnabled === undefined
                ? t('apps.fields.twoFactorPromptEnabledDefault')
                : displayApp.twoFactorPromptEnabled
                  ? t('apps.fields.twoFactorPromptEnabledOn')
                  : t('apps.fields.twoFactorPromptEnabledOff')
            }
          />
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
npx jest components/__tests__/app-view-drawer.test.tsx
```
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/components/app-view-drawer.tsx apps/admin/components/__tests__/app-view-drawer.test.tsx
git commit -m "feat(admin): show 2FA prompt setting in the app view drawer"
```

---

### Task 14: Env var documentation

**Files:**
- Modify: `.env.example`
- Modify: `README.md`

- [ ] **Step 1: Add to `.env.example`**

After line 192 (`TWO_FACTOR_TRUST_DAYS=14`), add:

```
# Whether the optional post-login "Secure your account" 2FA setup
# interstitial is shown at all, system-wide. Falls back to true if unset,
# empty, or not exactly "false"/"0" (case-insensitive). An individual app's
# twoFactorPromptEnabled field overrides this per-app.
TWO_FACTOR_PROMPT_ENABLED=true
```

- [ ] **Step 2: Add to `README.md`**

After line 502 (the `TWO_FACTOR_TRUST_DAYS` table row), add:

```
| `TWO_FACTOR_PROMPT_ENABLED` | System-wide default for whether the optional "Secure your account" 2FA setup interstitial is shown at all, independent of the re-prompt interval. Falls back to `true` if unset, empty, or not exactly `false`/`0` (case-insensitive). An individual app can override this via its `twoFactorPromptEnabled` field. |
```

- [ ] **Step 3: Commit**

```bash
git add .env.example README.md
git commit -m "docs: document TWO_FACTOR_PROMPT_ENABLED"
```

---

### Task 15: E2E coverage note

**Files:**
- Modify: `apps/admin-e2e/tests/two-factor.spec.ts`

- [ ] **Step 1: Add a skipped placeholder test documenting the seed dependency**

The existing interstitial e2e tests (`apps/admin-e2e/tests/two-factor.spec.ts`, `test.describe('2FA — interstitial', ...)` starting around line 387) drive the *system-default* path only — they sign in without a `client_id` in `next`, so they can't exercise a per-app `twoFactorPromptEnabled` override without a seeded app + its `publicId` exposed as a CI env var. `apps/admin-e2e/tests/2fa-enforcement.spec.ts` already has this exact situation for `requireTwoFactor` (see its `test.describe('2FA enforcement — forced enrollment (seed dependency)', ...)` block starting around line 319) and solves it with an explicit `test.skip(true, '...')` plus a comment explaining what's missing and what the test should do once seed plumbing exists. Mirror that pattern here rather than inventing new seed infrastructure (out of scope for this plan) or silently shipping with no per-app e2e coverage.

Append to `apps/admin-e2e/tests/two-factor.spec.ts`, after the closing `})` of `test.describe('2FA — interstitial', ...)`:

```ts
// ─────────────────────────────────────────────────────────────────────────────
// Per-app twoFactorPromptEnabled override (seed dependency).
//
// TODO: This test requires:
//   a) A SaApp seeded with twoFactorPromptEnabled:false (a dedicated non-platform app).
//   b) A fresh unenrolled user reachable via that app's authorize/next flow.
//   c) CI seed wiring to provision (a) and (b) and expose the app's publicId
//      as an env var (e.g. PROMPT_DISABLED_APP_CLIENT_ID).
//
// None of (a)-(c) exist in the current CI seed. Rather than ship a fragile
// test that depends on manual pre-conditions, this test is .skip'd with this
// explanatory comment — mirrors 2fa-enforcement.spec.ts's forced-enrollment
// seed-dependency test.
//
// When the seed is ready, the test body should:
//   1. Sign in as the unenrolled user with `next` carrying
//      client_id=PROMPT_DISABLED_APP_CLIENT_ID.
//   2. Assert the page lands on /users (or wherever `next` points), NOT
//      /login/two-factor-prompt.
// ─────────────────────────────────────────────────────────────────────────────
test.describe('2FA — interstitial disabled per-app (seed dependency)', () => {
  test.skip(
    true,
    'TODO: requires a seeded twoFactorPromptEnabled:false app + unenrolled user. ' +
    'Skipped until CI seed provides PROMPT_DISABLED_APP_CLIENT_ID.',
  )

  test('per-app disabled prompt does not redirect to the interstitial', async ({ page }) => {
    const PROMPT_DISABLED_APP_CLIENT_ID = process.env.PROMPT_DISABLED_APP_CLIENT_ID ?? ''
    expect(PROMPT_DISABLED_APP_CLIENT_ID, 'PROMPT_DISABLED_APP_CLIENT_ID must be set').toBeTruthy()
    // TODO: fill in sign-in flow with client_id once seed exists.
    await page.goto(`/login?next=${encodeURIComponent(`/some/app/path?client_id=${PROMPT_DISABLED_APP_CLIENT_ID}`)}`)
  })
})
```

- [ ] **Step 2: Run the e2e file's static check**

Run (from `apps/admin-e2e`):
```bash
npx tsc --noEmit
```
Expected: no errors (the new block is valid TypeScript even though it's skipped).

- [ ] **Step 3: Commit**

```bash
git add apps/admin-e2e/tests/two-factor.spec.ts
git commit -m "test(e2e): add seed-dependency placeholder for per-app prompt-disabled coverage"
```

---

### Task 16: Full verification pass

- [ ] **Step 1: Run the full auth-server suite**

```bash
cd apps/auth-server && npx jest
```
Expected: PASS.

- [ ] **Step 2: Run the full admin suite**

```bash
cd apps/admin && npx jest
```
Expected: PASS.

- [ ] **Step 3: Type-check both apps**

```bash
cd apps/auth-server && npx tsc --noEmit
cd apps/admin && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Manual smoke test**

Start the dev servers (`npm run dev` from the repo root, or however this repo's `dev` orchestration works), open the admin console, create or edit an app, set "'Secure your account' prompt" to "Never show", save, and confirm the view drawer shows "Never show". Then sign in as an unenrolled user through that app's flow and confirm no redirect to `/login/two-factor-prompt`. Set it back to "Use system default" and confirm the view drawer shows "Use system default" again.

- [ ] **Step 5: Final commit if any smoke-test fixes were needed**

If the manual smoke test surfaced any issue, fix it, re-run the relevant test file, and commit with a descriptive message before considering this plan complete.
