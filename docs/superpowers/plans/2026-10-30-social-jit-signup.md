# Just-in-time Social Signup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a first-time social sign-in (Google, Microsoft, Apple, and the e2e stub) auto-provision an active `SaUser` for any `SaApp` — platform included — that has both `defaultOrgId` and `defaultRoleId` set, while apps without both fields keep today's invite-only refusal with no orphan rows.

**Architecture:** Flip `disableSignUp` to `false` so BetterAuth always creates a `User`/`Account` row on a first-time identity, then decide eligibility and provision (or compensate-delete + redirect) inside a new `databaseHooks.user.create.after` hook. Two small `AsyncLocalStorage`-based capture points — mirroring the existing `apple-private-relay-context.ts`/`social-consent-context.ts` pattern — hand that hook the data it has no other way to see: which app this signup targets, and the provider's `given_name`/`family_name` claims.

**Tech Stack:** NestJS (auth-server), better-auth 1.6.11 + `@better-auth/core` 1.6.11, Prisma, Next.js (admin), Jest, Playwright.

**Design doc:** `docs/superpowers/specs/2026-10-30-social-jit-signup-design.md` — read this first; every task below implements a specific section of it.

---

### Task 1: Eligibility check — pure function

**Files:**
- Create: `apps/auth-server/src/social/resolve-social-signup-eligibility.ts`
- Test: `apps/auth-server/src/social/resolve-social-signup-eligibility.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { resolveSocialSignupEligibility } from './resolve-social-signup-eligibility';

describe('resolveSocialSignupEligibility', () => {
  it('is eligible when both defaultOrgId and defaultRoleId are set', () => {
    expect(resolveSocialSignupEligibility({ defaultOrgId: 1, defaultRoleId: 2 })).toBe(true);
  });

  it('is ineligible when defaultOrgId is null', () => {
    expect(resolveSocialSignupEligibility({ defaultOrgId: null, defaultRoleId: 2 })).toBe(false);
  });

  it('is ineligible when defaultRoleId is null', () => {
    expect(resolveSocialSignupEligibility({ defaultOrgId: 1, defaultRoleId: null })).toBe(false);
  });

  it('is ineligible when both are null', () => {
    expect(resolveSocialSignupEligibility({ defaultOrgId: null, defaultRoleId: null })).toBe(false);
  });

  // Design §1: no isPlatform carve-out — eligibility is identical for the
  // platform app and every other app.
  it('does not treat isPlatform specially', () => {
    expect(
      resolveSocialSignupEligibility({ defaultOrgId: 1, defaultRoleId: 2, isPlatform: true }),
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest resolve-social-signup-eligibility --silent`
Expected: FAIL with "Cannot find module './resolve-social-signup-eligibility'"

- [ ] **Step 3: Write minimal implementation**

```typescript
export interface SocialSignupEligibilityInput {
  defaultOrgId: number | null;
  defaultRoleId: number | null;
  /** Accepted but deliberately ignored — see the design doc §1: no
   * isPlatform carve-out. Present only so callers can pass a full SaApp row
   * without picking fields first. */
  isPlatform?: boolean;
}

/**
 * Whether a first-time social identity against this app may be
 * auto-provisioned, instead of refused. Reuses the exact signal self-serve
 * email signup already relies on (registration.service.ts) — no separate
 * flag, no isPlatform carve-out. See design doc §1.
 */
export function resolveSocialSignupEligibility(app: SocialSignupEligibilityInput): boolean {
  return app.defaultOrgId !== null && app.defaultRoleId !== null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest resolve-social-signup-eligibility --silent`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/social/resolve-social-signup-eligibility.ts apps/auth-server/src/social/resolve-social-signup-eligibility.spec.ts
git commit -m "feat(social): add pure eligibility check for JIT social signup"
```

---

### Task 2: Name derivation — pure function

**Files:**
- Create: `apps/auth-server/src/social/derive-signup-name.ts`
- Test: `apps/auth-server/src/social/derive-signup-name.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { deriveSignupName } from './derive-signup-name';

describe('deriveSignupName', () => {
  it('uses givenName/familyName when both are present', () => {
    expect(
      deriveSignupName({ name: 'ignored', givenName: 'Ada', familyName: 'Lovelace' }),
    ).toEqual({ firstName: 'Ada', lastName: 'Lovelace' });
  });

  it('falls back to splitting name on the first space when givenName is missing', () => {
    expect(
      deriveSignupName({ name: 'Grace Hopper', givenName: null, familyName: 'Hopper' }),
    ).toEqual({ firstName: 'Grace', lastName: 'Hopper' });
  });

  it('falls back to splitting name on the first space when familyName is missing', () => {
    expect(
      deriveSignupName({ name: 'Grace Hopper', givenName: 'Grace', familyName: null }),
    ).toEqual({ firstName: 'Grace', lastName: 'Hopper' });
  });

  it('splits a multi-word name on only the first space — everything after goes to lastName', () => {
    expect(
      deriveSignupName({ name: 'Mary Jane Watson', givenName: null, familyName: null }),
    ).toEqual({ firstName: 'Mary', lastName: 'Jane Watson' });
  });

  it('yields an empty lastName for a single-word name', () => {
    expect(deriveSignupName({ name: 'Prince', givenName: null, familyName: null })).toEqual({
      firstName: 'Prince',
      lastName: '',
    });
  });

  it('yields an empty firstName and lastName for an empty name', () => {
    expect(deriveSignupName({ name: '', givenName: null, familyName: null })).toEqual({
      firstName: '',
      lastName: '',
    });
  });

  it('trims surrounding whitespace before splitting', () => {
    expect(deriveSignupName({ name: '  Ada Lovelace  ', givenName: null, familyName: null })).toEqual({
      firstName: 'Ada',
      lastName: 'Lovelace',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest derive-signup-name --silent`
Expected: FAIL with "Cannot find module './derive-signup-name'"

- [ ] **Step 3: Write minimal implementation**

```typescript
export interface DeriveSignupNameInput {
  /** The BetterAuth User row's single name field — always present, may be ''. */
  name: string;
  /** Captured out-of-band via mapProfileToUser — see social-signup-context.ts.
   * null for Apple (no capture wired) or when the provider omitted the claim. */
  givenName: string | null;
  familyName: string | null;
}

export interface DerivedSignupName {
  firstName: string;
  lastName: string;
}

/**
 * Design doc §4: given_name/family_name when the provider supplied them
 * (captured out-of-band — see social-signup-context.ts, since better-auth
 * discards these claims before the hook that calls this function ever
 * runs), else split the single `name` field on the first space.
 */
export function deriveSignupName(input: DeriveSignupNameInput): DerivedSignupName {
  if (input.givenName && input.familyName) {
    return { firstName: input.givenName, lastName: input.familyName };
  }
  const trimmed = input.name.trim();
  const spaceIndex = trimmed.indexOf(' ');
  if (spaceIndex === -1) return { firstName: trimmed, lastName: '' };
  return { firstName: trimmed.slice(0, spaceIndex), lastName: trimmed.slice(spaceIndex + 1) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest derive-signup-name --silent`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/social/derive-signup-name.ts apps/auth-server/src/social/derive-signup-name.spec.ts
git commit -m "feat(social): add pure name-derivation helper for JIT social signup"
```

---

### Task 3: Shared AsyncLocalStorage capture — client_id and profile name

**Files:**
- Create: `apps/auth-server/src/social/social-signup-context.ts`
- Test: `apps/auth-server/src/social/social-signup-context.spec.ts`

This mirrors `apps/auth-server/src/social/social-consent-context.ts` exactly (same file, same `{ ip, userId }`-style multi-field store) — read that file first.

- [ ] **Step 1: Write the failing test**

```typescript
import {
  runWithSocialSignupContext,
  captureSocialSignupClientId,
  captureSocialSignupProfileName,
  readSocialSignupContext,
} from './social-signup-context';

describe('social-signup-context', () => {
  it('returns all-null outside any capture scope', () => {
    expect(readSocialSignupContext()).toEqual({ clientId: null, givenName: null, familyName: null });
  });

  it('captures and reads back clientId within a scope', () => {
    runWithSocialSignupContext(() => {
      captureSocialSignupClientId('sq_abc');
      expect(readSocialSignupContext()).toEqual({ clientId: 'sq_abc', givenName: null, familyName: null });
    });
  });

  it('captures and reads back givenName/familyName within a scope', () => {
    runWithSocialSignupContext(() => {
      captureSocialSignupProfileName('Ada', 'Lovelace');
      expect(readSocialSignupContext()).toEqual({ clientId: null, givenName: 'Ada', familyName: 'Lovelace' });
    });
  });

  it('capture calls outside any scope are no-ops, not throws', () => {
    expect(() => captureSocialSignupClientId('sq_abc')).not.toThrow();
    expect(() => captureSocialSignupProfileName('Ada', 'Lovelace')).not.toThrow();
    expect(readSocialSignupContext()).toEqual({ clientId: null, givenName: null, familyName: null });
  });

  it('two concurrent scopes do not cross-contaminate', async () => {
    const results: unknown[] = [];
    await Promise.all([
      runWithSocialSignupContext(async () => {
        captureSocialSignupClientId('sq_1');
        await new Promise((r) => setTimeout(r, 10));
        results.push(readSocialSignupContext());
      }),
      runWithSocialSignupContext(async () => {
        captureSocialSignupClientId('sq_2');
        await new Promise((r) => setTimeout(r, 1));
        results.push(readSocialSignupContext());
      }),
    ]);
    expect(results).toEqual(
      expect.arrayContaining([
        { clientId: 'sq_1', givenName: null, familyName: null },
        { clientId: 'sq_2', givenName: null, familyName: null },
      ]),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest social-signup-context --silent`
Expected: FAIL with "Cannot find module './social-signup-context'"

- [ ] **Step 3: Write minimal implementation**

```typescript
import { AsyncLocalStorage } from 'node:async_hooks';

interface SocialSignupStore {
  clientId: string | null;
  givenName: string | null;
  familyName: string | null;
}

const storage = new AsyncLocalStorage<SocialSignupStore>();

/**
 * Hands two pieces of data captured mid-request — by auth.config.ts's
 * hooks.before matcher (clientId, see design doc §3a) and by Google/
 * Microsoft's mapProfileToUser (givenName/familyName, see design doc §4) —
 * forward to the later databaseHooks.user.create.after hook, which has no
 * direct access to either. Mirrors apple-private-relay-context.ts and
 * social-consent-context.ts's identical use of AsyncLocalStorage for the
 * same shape of problem: this scope must wrap the entire request (see
 * main.ts, where it joins the other two runWith...Capture wrappers around
 * toNodeHandler(auth)).
 */
export function runWithSocialSignupContext<T>(fn: () => T): T {
  return storage.run({ clientId: null, givenName: null, familyName: null }, fn);
}

/** Called from auth.config.ts's hooks.before matcher on /callback/:id. */
export function captureSocialSignupClientId(clientId: string | null): void {
  const store = storage.getStore();
  if (store) store.clientId = clientId;
}

/** Called from Google's/Microsoft's mapProfileToUser (build-social-providers.ts). */
export function captureSocialSignupProfileName(givenName: string | null, familyName: string | null): void {
  const store = storage.getStore();
  if (store) {
    store.givenName = givenName;
    store.familyName = familyName;
  }
}

/** Read what this request has captured so far. All fields null outside any
 * capture scope. */
export function readSocialSignupContext(): SocialSignupStore {
  const store = storage.getStore();
  return { clientId: store?.clientId ?? null, givenName: store?.givenName ?? null, familyName: store?.familyName ?? null };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest social-signup-context --silent`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/social/social-signup-context.ts apps/auth-server/src/social/social-signup-context.spec.ts
git commit -m "feat(social): add AsyncLocalStorage capture for JIT signup client_id and profile name"
```

---

### Task 4: Wire main.ts's request wrapper

**Files:**
- Modify: `apps/auth-server/src/main.ts`

- [ ] **Step 1: Add the import**

Add alongside the two existing `runWith...Capture` imports (around line 22-23):

```typescript
import { runWithSocialSignupContext } from './social/social-signup-context';
```

- [ ] **Step 2: Nest it around the existing wrappers**

Find the existing block (around line 180-184):

```typescript
  expressApp.all('/api/auth/*', authCors, createDefaultAuthRateLimiter(), (req, res) =>
    runWithPrivateRelayCapture(() =>
      runWithSocialConsentCapture(resolveClientIp(req), () => authNodeHandler(req, res)),
    ),
  );
```

Replace with:

```typescript
  expressApp.all('/api/auth/*', authCors, createDefaultAuthRateLimiter(), (req, res) =>
    runWithPrivateRelayCapture(() =>
      runWithSocialConsentCapture(resolveClientIp(req), () =>
        runWithSocialSignupContext(() => authNodeHandler(req, res)),
      ),
    ),
  );
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/auth-server && npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 4: Commit**

```bash
git add apps/auth-server/src/main.ts
git commit -m "feat(social): wrap auth requests in the JIT signup capture scope"
```

---

### Task 5: `classify-callback-outcome.ts` — new `social_signup_unavailable` code

**Files:**
- Modify: `apps/auth-server/src/social/classify-callback-outcome.ts`
- Modify: `apps/auth-server/src/social/classify-callback-outcome.spec.ts`

Design doc §3a: this code is unconditional (no `classifyRejection` matchedUser/emailVerified nuance applies), unlike `signup_disabled`/`account_not_linked`.

- [ ] **Step 1: Write the failing test**

Add to `classify-callback-outcome.spec.ts`, inside the top-level `describe('classifyCallbackOutcome', ...)` block, alongside the existing `signup_disabled`/`account_not_linked` tests:

```typescript
  it('maps social_signup_unavailable (ineligible app) to its own code, unconditionally', () => {
    expect(
      classifyCallbackOutcome(redirectError('https://auth.example/error?error=social_signup_unavailable')),
    ).toEqual({ reason: 'social_signup_unavailable', code: 'social_signup_unavailable', canRedirect: true });
  });

  it('maps social_signup_unavailable the same way regardless of isPrivateEmail', () => {
    expect(
      classifyCallbackOutcome(
        redirectError('https://auth.example/error?error=social_signup_unavailable'),
        true,
      ),
    ).toEqual({ reason: 'social_signup_unavailable', code: 'social_signup_unavailable', canRedirect: true });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest classify-callback-outcome --silent`
Expected: FAIL — `classifyCallbackOutcome(...)` returns `null` for both new cases (no mapping entry yet)

- [ ] **Step 3: Write minimal implementation**

In `classify-callback-outcome.ts`, add a direct, unconditional branch BEFORE the existing `BETTER_AUTH_ERROR_TO_INPUT`/`classifyRejection` lookup (that pipeline stays untouched — it's for the two pre-existing codes only):

```typescript
  if (betterAuthError === 'social_signup_unavailable') {
    return { reason: 'social_signup_unavailable', code: 'social_signup_unavailable', canRedirect: true };
  }

  const input = BETTER_AUTH_ERROR_TO_INPUT[betterAuthError];
```

(The second line is the existing line right after where this is inserted — this just shows where the new branch goes relative to it.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest classify-callback-outcome --silent`
Expected: PASS (all tests, including the 2 new ones)

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/social/classify-callback-outcome.ts apps/auth-server/src/social/classify-callback-outcome.spec.ts
git commit -m "feat(social): classify social_signup_unavailable as its own unconditional code"
```

---

### Task 6: Audit event type — `social.signup.created`

**Files:**
- Modify: `apps/auth-server/src/social/record-federation-event.ts`

No new test needed — this is a type-union widening with no new branching logic; `record-federation-event.spec.ts`'s existing tests already cover `recordFederationEvent`'s behavior for any `type` value.

- [ ] **Step 1: Widen the type**

In `record-federation-event.ts`, change:

```typescript
export type FederationEventType =
  | 'social.link.created'
  | 'social.signin.ok'
  | 'social.signin.rejected'
  | 'social.link.removed';
```

to:

```typescript
export type FederationEventType =
  | 'social.link.created'
  | 'social.signin.ok'
  | 'social.signin.rejected'
  | 'social.link.removed'
  | 'social.signup.created';
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/auth-server && npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 3: Commit**

```bash
git add apps/auth-server/src/social/record-federation-event.ts
git commit -m "feat(social): add social.signup.created audit event type"
```

---

### Task 7: Provisioning service — the core of the feature

**Files:**
- Create: `apps/auth-server/src/social/provision-social-signup-user.ts`
- Test: `apps/auth-server/src/social/provision-social-signup-user.spec.ts`

This is the function `databaseHooks.user.create.after` (Task 9) calls. It takes the already-created BetterAuth user + the captured context, resolves the app, and either provisions (eligible) or deletes + throws (ineligible) — design doc §2-§4.

- [ ] **Step 1: Write the failing test**

```typescript
import { APIError } from 'better-auth/api';
import { provisionSocialSignupUser } from './provision-social-signup-user';

function makeDb(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    saApp: { findUnique: jest.fn() },
    saUser: { create: jest.fn() },
    saUserRole: { create: jest.fn() },
    user: { delete: jest.fn() },
    saAuditEvent: { create: jest.fn() },
    ...overrides,
  } as any;
}

const BASE_INPUT = {
  betterAuthUserId: 'ba-user-1',
  email: 'jane@example.com',
  name: 'Jane Doe',
  provider: 'google',
  clientId: 'sq_app1',
  givenName: null as string | null,
  familyName: null as string | null,
};

describe('provisionSocialSignupUser', () => {
  it('provisions an active SaUser into the app default org/role when eligible', async () => {
    const db = makeDb();
    db.saApp.findUnique.mockResolvedValue({
      id: 1, publicId: 'sq_app1', defaultOrgId: 10, defaultRoleId: 20,
    });
    db.saUser.create.mockResolvedValue({ id: 100, publicId: 'ba-user-1'.slice(0, 12) });

    await provisionSocialSignupUser(db, BASE_INPUT);

    expect(db.saUser.create).toHaveBeenCalledWith({
      data: {
        publicId: 'ba-user-1'.slice(0, 12),
        betterAuthUserId: 'ba-user-1',
        orgId: 10,
        firstName: 'Jane',
        lastName: 'Doe',
        status: 'active',
      },
    });
    expect(db.saUserRole.create).toHaveBeenCalledWith({ data: { userId: 100, roleId: 20 } });
    expect(db.user.delete).not.toHaveBeenCalled();
    expect(db.saAuditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'social.signup.created',
        provider: 'google',
        betterAuthUserId: 'ba-user-1',
        appPublicId: 'sq_app1',
      }),
    });
  });

  it('uses givenName/familyName when both are captured', async () => {
    const db = makeDb();
    db.saApp.findUnique.mockResolvedValue({ id: 1, publicId: 'sq_app1', defaultOrgId: 10, defaultRoleId: 20 });
    db.saUser.create.mockResolvedValue({ id: 100, publicId: 'x' });

    await provisionSocialSignupUser(db, { ...BASE_INPUT, givenName: 'Ada', familyName: 'Lovelace' });

    expect(db.saUser.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ firstName: 'Ada', lastName: 'Lovelace' }) }),
    );
  });

  it('deletes the User row and throws an APIError when the app has no defaultOrgId', async () => {
    const db = makeDb();
    db.saApp.findUnique.mockResolvedValue({ id: 1, publicId: 'sq_app1', defaultOrgId: null, defaultRoleId: 20 });

    await expect(provisionSocialSignupUser(db, BASE_INPUT)).rejects.toThrow(APIError);
    expect(db.user.delete).toHaveBeenCalledWith({ where: { id: 'ba-user-1' } });
    expect(db.saUser.create).not.toHaveBeenCalled();
  });

  it('deletes the User row and throws an APIError when the app has no defaultRoleId', async () => {
    const db = makeDb();
    db.saApp.findUnique.mockResolvedValue({ id: 1, publicId: 'sq_app1', defaultOrgId: 10, defaultRoleId: null });

    await expect(provisionSocialSignupUser(db, BASE_INPUT)).rejects.toThrow(APIError);
    expect(db.user.delete).toHaveBeenCalledWith({ where: { id: 'ba-user-1' } });
  });

  it('deletes the User row and throws an APIError when clientId is null (unresolvable)', async () => {
    const db = makeDb();

    await expect(provisionSocialSignupUser(db, { ...BASE_INPUT, clientId: null })).rejects.toThrow(APIError);
    expect(db.saApp.findUnique).not.toHaveBeenCalled();
    expect(db.user.delete).toHaveBeenCalledWith({ where: { id: 'ba-user-1' } });
  });

  it('deletes the User row and throws an APIError when clientId does not resolve to any app', async () => {
    const db = makeDb();
    db.saApp.findUnique.mockResolvedValue(null);

    await expect(provisionSocialSignupUser(db, BASE_INPUT)).rejects.toThrow(APIError);
    expect(db.user.delete).toHaveBeenCalledWith({ where: { id: 'ba-user-1' } });
  });

  it('the thrown APIError message is exactly social_signup_unavailable (survives split/join unchanged)', async () => {
    const db = makeDb();
    await expect(provisionSocialSignupUser(db, { ...BASE_INPUT, clientId: null })).rejects.toThrow(
      'social_signup_unavailable',
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest provision-social-signup-user --silent`
Expected: FAIL with "Cannot find module './provision-social-signup-user'"

- [ ] **Step 3: Write minimal implementation**

```typescript
import { APIError } from 'better-auth/api';
import { randomBytes } from 'node:crypto';
import { resolveSocialSignupEligibility } from './resolve-social-signup-eligibility';
import { deriveSignupName } from './derive-signup-name';
import { recordFederationEvent } from './record-federation-event';
import { createAppLogger } from '../common/logger/winston.config';

export interface ProvisionSocialSignupDb {
  saApp: {
    findUnique(args: { where: { publicId: string } }): Promise<{
      id: number; publicId: string; defaultOrgId: number | null; defaultRoleId: number | null;
    } | null>;
  };
  saUser: {
    create(args: { data: Record<string, unknown> }): Promise<{ id: number; publicId: string }>;
  };
  saUserRole: {
    create(args: { data: { userId: number; roleId: number } }): Promise<unknown>;
  };
  user: {
    delete(args: { where: { id: string } }): Promise<unknown>;
  };
  saAuditEvent: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
}

export interface ProvisionSocialSignupInput {
  betterAuthUserId: string;
  email: string;
  name: string;
  provider: string;
  /** From social-signup-context.ts — null means unresolvable, treated as ineligible. */
  clientId: string | null;
  givenName: string | null;
  familyName: string | null;
}

const logger = createAppLogger();

/**
 * Design doc §2-§4: the databaseHooks.user.create.after hook's eligibility
 * decision and the two outcomes it drives. Called once per first-time
 * social identity, AFTER BetterAuth has already committed the User/Account
 * row (see design doc §3a) — a delete here is a compensating delete, never
 * a rollback.
 *
 * Throws an APIError('BAD_REQUEST', { message: 'social_signup_unavailable' })
 * on the ineligible path — see design doc §3a for why this specific message
 * string, unchanged by better-auth's callback.mjs error-code transform,
 * reaches classify-callback-outcome.ts as a real FOUND redirect rather than
 * a raw error status.
 */
export async function provisionSocialSignupUser(
  db: ProvisionSocialSignupDb,
  input: ProvisionSocialSignupInput,
): Promise<void> {
  const app = input.clientId ? await db.saApp.findUnique({ where: { publicId: input.clientId } }) : null;

  if (!app || !resolveSocialSignupEligibility(app)) {
    await db.user.delete({ where: { id: input.betterAuthUserId } }).catch((err: unknown) => {
      logger.warn('Compensating delete failed for an ineligible social signup', {
        context: 'provision-social-signup-user',
        betterAuthUserId: input.betterAuthUserId,
        err: String(err),
      });
    });
    throw new APIError('BAD_REQUEST', { message: 'social_signup_unavailable' });
  }

  const { firstName, lastName } = deriveSignupName({
    name: input.name,
    givenName: input.givenName,
    familyName: input.familyName,
  });

  const saUser = await db.saUser.create({
    data: {
      publicId: input.betterAuthUserId.slice(0, 12),
      betterAuthUserId: input.betterAuthUserId,
      orgId: app.defaultOrgId!,
      firstName,
      lastName,
      status: 'active',
    },
  });

  await db.saUserRole.create({ data: { userId: saUser.id, roleId: app.defaultRoleId! } });

  await recordFederationEvent(
    { db, logger },
    {
      type: 'social.signup.created',
      provider: input.provider,
      saUserId: saUser.id,
      saUserPublicId: saUser.publicId,
      betterAuthUserId: input.betterAuthUserId,
      appPublicId: app.publicId,
      email: input.email,
    },
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest provision-social-signup-user --silent`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/social/provision-social-signup-user.ts apps/auth-server/src/social/provision-social-signup-user.spec.ts
git commit -m "feat(social): add provisioning service for JIT social signup"
```

---

### Task 8: Flip `disableSignUp` on Google, Microsoft, Apple, and the e2e stub

**Files:**
- Modify: `apps/auth-server/src/social/build-social-providers.ts`
- Modify: `apps/auth-server/src/social/build-social-providers.spec.ts`
- Modify: `apps/auth-server/src/social/stub-provider.ts`
- Modify: `apps/auth-server/src/social/stub-provider.spec.ts`

Also adds the `mapProfileToUser` capture for Google/Microsoft (design doc §4 mechanism). The stub flips too — design doc §7 testing requires exercising the real JIT path through it; its fixture apps have no `defaultOrgId`/`defaultRoleId` by default, so the existing "unknown identity creates no User row" e2e assertion (`rs-social-round-trip.spec.ts`) stays true via the new compensating-delete path.

- [ ] **Step 1: Update the two failing assertions in `build-social-providers.spec.ts`**

Change:

```typescript
  it('sets disableSignUp on every provider so federation stays invite-only', () => {
    const built = buildSocialProviders(GOOGLE) as Record<string, { disableSignUp: boolean }>;
    expect(built.google.disableSignUp).toBe(true);
```

to:

```typescript
  it('leaves disableSignUp off on every provider so JIT social signup can run', () => {
    const built = buildSocialProviders(GOOGLE) as Record<string, { disableSignUp: boolean }>;
    expect(built.google.disableSignUp).toBe(false);
```

And the Apple block:

```typescript
    expect(built.apple.disableSignUp).toBe(true);
```

to:

```typescript
    expect(built.apple.disableSignUp).toBe(false);
```

- [ ] **Step 2: Update `stub-provider.spec.ts`'s assertion**

Change:

```typescript
    expect(config.disableSignUp).toBe(true);
```

to:

```typescript
    expect(config.disableSignUp).toBe(false);
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx jest build-social-providers stub-provider --silent`
Expected: FAIL — both now expect `false`, implementation still returns `true`

- [ ] **Step 4: Flip the three provider flags and add the name-capture `mapProfileToUser`**

In `build-social-providers.ts`, update the import line to add the new context module:

```typescript
import { captureSocialSignupProfileName } from './social-signup-context';
```

Change the Google block:

```typescript
  if (available.includes('google')) {
    providers.google = {
      clientId: env.GOOGLE_CLIENT_ID!,
      clientSecret: env.GOOGLE_CLIENT_SECRET!,
      disableSignUp: true,
    };
  }
```

to:

```typescript
  if (available.includes('google')) {
    providers.google = {
      clientId: env.GOOGLE_CLIENT_ID!,
      clientSecret: env.GOOGLE_CLIENT_SECRET!,
      // JIT social signup (design doc 2026-10-30): BetterAuth now always
      // creates a User row for a first-time identity; the real eligibility
      // decision — and, when ineligible, the compensating delete — happens
      // in auth.config.ts's databaseHooks.user.create.after hook.
      disableSignUp: false,
      // Design doc §4: given_name/family_name never survive onto the User
      // row BetterAuth hands that hook — capture them here, from the raw
      // decoded profile, the same way Apple's config already captures
      // is_private_email below.
      mapProfileToUser: (profile: { given_name?: string; family_name?: string }) => {
        captureSocialSignupProfileName(profile.given_name ?? null, profile.family_name ?? null);
        return {};
      },
    };
  }
```

Change the Microsoft block the same way:

```typescript
  if (available.includes('microsoft')) {
    providers.microsoft = {
      clientId: env.MICROSOFT_CLIENT_ID!,
      clientSecret: env.MICROSOFT_CLIENT_SECRET!,
      tenantId: env.MICROSOFT_TENANT_ID ?? 'common',
      disableSignUp: false,
      mapProfileToUser: (profile: { given_name?: string; family_name?: string }) => {
        captureSocialSignupProfileName(profile.given_name ?? null, profile.family_name ?? null);
        return {};
      },
    };
  }
```

Change only the Apple block's `disableSignUp` line — its existing `mapProfileToUser` (the `is_private_email` capture) stays untouched:

```typescript
      disableSignUp: false,
```

- [ ] **Step 5: Flip the stub's flag**

In `stub-provider.ts`, change:

```typescript
      disableSignUp: true,
```

to:

```typescript
      // JIT social signup (design doc 2026-10-30): the e2e suite needs to
      // exercise the real provisioning path through the stub. Fixture apps
      // without a defaultOrgId/defaultRoleId stay ineligible exactly as
      // before — now via the compensating-delete path instead of a refusal
      // before creation.
      disableSignUp: false,
```

- [ ] **Step 6: Update the header comments that describe `disableSignUp: true`**

In `build-social-providers.ts`, the `buildSocialProviders` doc comment currently says `disableSignUp: true` on every provider "is what makes federation invite-only". Replace that paragraph:

```typescript
/**
 * Build BetterAuth's `socialProviders` config.
 *
 * As of the JIT social signup feature (design doc 2026-10-30),
 * `disableSignUp` is false on every provider — BetterAuth always creates a
 * User/Account row for a first-time identity, and auth.config.ts's
 * databaseHooks.user.create.after hook decides, per-request, whether that
 * identity's target app is eligible (has defaultOrgId + defaultRoleId) to
 * keep it, or must compensate-delete it and redirect to
 * social_signup_unavailable. See provision-social-signup-user.ts.
 *
 * DELIBERATE NON-ACTION: none of these providers is added to
 * `trustedProviders`. Implicit linking requires `userInfo.emailVerified`
 * only while a provider is untrusted (link-account.mjs:20-22). Trusting one
 * silently removes the single rule this feature's security rests on.
 */
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx jest build-social-providers stub-provider --silent`
Expected: PASS (all tests)

- [ ] **Step 8: Commit**

```bash
git add apps/auth-server/src/social/build-social-providers.ts apps/auth-server/src/social/build-social-providers.spec.ts apps/auth-server/src/social/stub-provider.ts apps/auth-server/src/social/stub-provider.spec.ts
git commit -m "feat(social): enable signup on every provider, capture given_name/family_name"
```

---

### Task 9: Wire the hooks in `auth.config.ts`

**Files:**
- Modify: `apps/auth-server/src/auth/auth.config.ts`

Two additions to the existing single `hooks` object and a new `databaseHooks.user.create.after` — design doc §3/§3a.

- [ ] **Step 1: Add the imports**

Alongside the existing social imports near the top of the file:

```typescript
import { readSocialSignupContext, captureSocialSignupClientId } from '../social/social-signup-context';
import { provisionSocialSignupUser } from '../social/provision-social-signup-user';
```

- [ ] **Step 2: Add the client_id capture to the existing `hooks.before` matcher**

The existing `hooks.before` (around line 304) has two `if` branches (`/sign-in/email` logging, `/reset-password` policy check). Add a third branch for `/callback/:id`, BEFORE the existing `if (ctx.path !== '/reset-password') return;` line (that line returns early, so anything meant to also run for other paths must come first):

```typescript
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === '/sign-in/email') {
        const email = (ctx.body as { email?: string } | undefined)?.email;
        console.log(`[auth-server] Sign-in attempt for ${email ?? 'unknown'}`);
      }

      // JIT social signup (design doc 2026-10-30, §3a): recover which app
      // this callback targets, so the later databaseHooks.user.create.after
      // hook (which has no direct access to ctx.query/ctx.body) can decide
      // eligibility. MUST be read-only — this deployment's
      // storeStateStrategy resolves to "database" (set whenever
      // options.database is set and options.account.storeStateStrategy
      // isn't overridden, per @better-auth/core's create-context.mjs; true
      // here), and that strategy's own parseState call (made later, by
      // BetterAuth's real /callback/:id handler) DELETES the Verification
      // row it reads — calling parseState ourselves a second time here
      // would delete it first and break every social sign-in on the second,
      // real call. findVerificationValue is a plain read.
      if (ctx.path === '/callback/:id') {
        const state = (ctx.query as { state?: string } | undefined)?.state
          ?? (ctx.body as { state?: string } | undefined)?.state;
        let clientId: string | null = null;
        if (state) {
          try {
            const row = await ctx.context.internalAdapter.findVerificationValue(state);
            if (row) {
              const parsed = JSON.parse(row.value) as { callbackURL?: string };
              if (parsed.callbackURL) {
                clientId = new URL(parsed.callbackURL).searchParams.get('client_id');
              }
            }
          } catch {
            clientId = null;
          }
        }
        captureSocialSignupClientId(clientId);
      }

      // task-7: /reset-password has no server-side complexity check by
      // default — BetterAuth only enforces minPasswordLength/
      // maxPasswordLength (the top-level `password` option above). This
      // matcher resolves the app that owns the reset token (via the
      // Verification row BetterAuth itself wrote — see
      // resolve-app-for-reset-token.ts) and enforces that app's full
      // PasswordPolicy before BetterAuth's own handler ever runs.
      if (ctx.path !== '/reset-password') return;
```

(Everything after that line is unchanged.)

- [ ] **Step 3: Add the new `databaseHooks.user.create.after` hook**

The existing `databaseHooks` object (around line 223) has only a `session` key. Add a sibling `user` key:

```typescript
  databaseHooks: {
    user: {
      create: {
        after: async (user: { id: string; email: string; name: string }) => {
          const { clientId, givenName, familyName } = readSocialSignupContext();
          // Only a social-provider signup reaches this with a non-null
          // clientId (captured in hooks.before above, scoped to
          // /callback/:id). Email/password signup provisions its SaUser
          // itself (registration.service.ts) and never goes through this
          // path with a captured clientId, so this hook is a no-op for it.
          if (!clientId) return;
          await provisionSocialSignupUser(prisma, {
            betterAuthUserId: user.id,
            email: user.email,
            name: user.name,
            // The real per-provider label ('google'/'microsoft'/'apple'/
            // 'stub') is only derived later, in session.create.before, via
            // resolveHookRoutePath(ctx) — a ctx shape confirmed available
            // there (task-4), not here. This hook's second argument
            // (context: GenericEndpointContext | null) was NOT checked for
            // the same path/params shape before this plan was written.
            // 'social' only affects the audit event's specificity, never
            // eligibility or provisioning — check during implementation
            // whether resolveHookRoutePath works unchanged against this
            // hook's context and use its result instead if so; 'social'
            // is the safe fallback either way.
            provider: 'social',
            clientId,
            givenName,
            familyName,
          });
        },
      },
    },
    session: {
      create: {
```

(The rest of the `session.create` block is unchanged — this just shows where the new `user` key is inserted relative to it.)

- [ ] **Step 4: Typecheck**

Run: `cd apps/auth-server && npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 5: Run the existing social test suite to catch regressions**

Run: `npx jest apps/auth-server/src/social apps/auth-server/src/auth --silent`
Expected: PASS — no existing test should have changed behavior (email/password signup never sets a `clientId` in this context, so the new hook is a no-op for it)

- [ ] **Step 6: Commit**

```bash
git add apps/auth-server/src/auth/auth.config.ts
git commit -m "feat(social): wire JIT social signup into auth.config hooks"
```

**Note for the implementer:** Step 3's inline comment flags a real open question — whether the provider name (`google`/`microsoft`/`apple`/`stub`) is cheaply available inside `databaseHooks.user.create.after` for a more specific audit-event label than the generic `'social'`. `resolveHookRoutePath`/`signInMethodFromPath` (used by `session.create.before`) rely on a `ctx` shape with `path`/`params` — check whether `user.create.after`'s second argument (`context: GenericEndpointContext | null`) carries the same `path`/`params`, and if so, thread the real provider id through instead of the `'social'` placeholder before merging this task. If it does not, leave `'social'` — it does not affect eligibility, provisioning, or security, only the audit event's `provider` field's specificity.

---

### Task 10: Add the `social_signup_unavailable` error page copy

**Files:**
- Modify: `apps/admin/messages/en.json`
- Modify: `apps/admin/messages/fr.json`

No code change needed — `apps/admin/app/oauth-error/page.tsx` derives its `KNOWN_CODES` set from `Object.keys(en.oauthError.codes)` automatically.

- [ ] **Step 1: Add the English copy**

In `apps/admin/messages/en.json`, inside `oauthError.codes`, add a new entry alongside `social_no_account` (around line 872):

```json
      "social_signup_unavailable": {
        "heading": "Sign-up isn't available for this app",
        "body": "This application doesn't support creating a new account this way.",
        "hint": "Ask an administrator to invite you, or sign in with an existing account instead."
      },
```

- [ ] **Step 2: Add the French copy**

In `apps/admin/messages/fr.json`, find the equivalent `social_no_account` entry under `oauthError.codes` and add the matching key alongside it:

```json
      "social_signup_unavailable": {
        "heading": "L'inscription n'est pas disponible pour cette application",
        "body": "Cette application ne permet pas de créer un nouveau compte de cette façon.",
        "hint": "Demandez à un administrateur de vous inviter, ou connectez-vous avec un compte existant."
      },
```

- [ ] **Step 3: Verify both JSON files still parse**

Run: `node -e "require('./apps/admin/messages/en.json'); require('./apps/admin/messages/fr.json'); console.log('ok')"`
Expected: `ok`

- [ ] **Step 4: Commit**

```bash
git add apps/admin/messages/en.json apps/admin/messages/fr.json
git commit -m "feat(admin): add social_signup_unavailable oauth-error copy"
```

---

### Task 11: `registration.service.ts` — expose `canSocialSignup`

**Files:**
- Modify: `apps/auth-server/src/registration/registration.service.ts`
- Modify: `apps/auth-server/src/registration/registration.service.spec.ts`

Design doc §5a: `/signup` needs to know eligibility the same way `/login` already learns `hasDefaultOrg`.

- [ ] **Step 1: Write the failing test**

Add to the existing `describe('getAppName', ...)` block in `registration.service.spec.ts`:

```typescript
    it('reports canSocialSignup: true when both defaultOrgId and defaultRoleId are set', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue({
        name: 'MyApp', defaultOrgId: 5, defaultRoleId: 9, passwordPolicyOverride: null, logo: null, favicon: null,
      });
      const result = await service.getAppName('sq_1');
      expect(result.canSocialSignup).toBe(true);
    });

    it('reports canSocialSignup: false when defaultRoleId is missing', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue({
        name: 'MyApp', defaultOrgId: 5, defaultRoleId: null, passwordPolicyOverride: null, logo: null, favicon: null,
      });
      const result = await service.getAppName('sq_1');
      expect(result.canSocialSignup).toBe(false);
    });

    it('selects defaultRoleId from the database', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue({
        name: 'MyApp', defaultOrgId: null, defaultRoleId: null, passwordPolicyOverride: null, logo: null, favicon: null,
      });
      await service.getAppName('sq_1');
      expect(mockPrisma.saApp.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ select: expect.objectContaining({ defaultRoleId: true }) }),
      );
    });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest registration.service --silent -t getAppName`
Expected: FAIL — `canSocialSignup` is `undefined`, `defaultRoleId` isn't selected

- [ ] **Step 3: Update the implementation**

In `registration.service.ts`'s `getAppName` method, add `defaultRoleId: true` to the `select` object (alongside the existing `defaultOrgId: true`), add `canSocialSignup: boolean` to the return type, and compute it in the return statement:

```typescript
  async getAppName(
    appPublicId: string,
    ip: string = 'unknown',
  ): Promise<{
    name: string;
    hasDefaultOrg: boolean;
    canSocialSignup: boolean;
    passwordPolicy: PasswordPolicy;
    logo: string | null;
    favicon: string | null;
    privacyPolicyUrl: string | null;
    termsUrl: string | null;
    gdprUrl: string | null;
    gdprRequired: boolean;
    emailVerificationMethod: 'link' | 'code';
    pageLightBackgroundColor: string | null;
    pageDarkBackgroundColor: string | null;
    cardLightBackgroundColor: string | null;
    cardDarkBackgroundColor: string | null;
  }> {
    if (!appPublicId) throw new NotFoundException('App not found');
    const app = await prisma.saApp.findUnique({
      where: { publicId: appPublicId },
      select: {
        name: true,
        defaultOrgId: true,
        defaultRoleId: true,
        passwordPolicyOverride: true,
        logo: true,
        favicon: true,
        privacyPolicyUrl: true,
        termsUrl: true,
        gdprUrl: true,
        emailVerificationMethod: true,
        pageLightBackgroundColor: true,
        pageDarkBackgroundColor: true,
        cardLightBackgroundColor: true,
        cardDarkBackgroundColor: true,
      },
    });
    if (!app) throw new NotFoundException('App not found');
    const country = resolveCountryFromIp(ip);
    return {
      name: app.name,
      hasDefaultOrg: app.defaultOrgId !== null,
      // Design doc §5a: the same signal /signup uses to decide whether to
      // show social buttons at all — not just the login page's "do we skip
      // the companyName field" question hasDefaultOrg already answers.
      canSocialSignup: app.defaultOrgId !== null && app.defaultRoleId !== null,
      passwordPolicy: resolvePasswordPolicy(app),
      logo: app.logo ?? null,
      favicon: app.favicon ?? null,
      privacyPolicyUrl: app.privacyPolicyUrl ?? null,
      termsUrl: app.termsUrl ?? null,
      gdprUrl: app.gdprUrl ?? null,
      gdprRequired: resolveRequiredConsent(app, country).some((d) => d.documentType === 'gdpr'),
      emailVerificationMethod: (app.emailVerificationMethod ?? 'link') as 'link' | 'code',
      pageLightBackgroundColor: app.pageLightBackgroundColor ?? null,
      pageDarkBackgroundColor: app.pageDarkBackgroundColor ?? null,
      cardLightBackgroundColor: app.cardLightBackgroundColor ?? null,
      cardDarkBackgroundColor: app.cardDarkBackgroundColor ?? null,
    };
  }
```

- [ ] **Step 4: Fix the now-failing pre-existing `getAppName` assertions**

The existing tests in `registration.service.spec.ts` that assert exact equality on `getAppName`'s return value (`.resolves.toEqual({...})`, lines ~825-840 and ~864-880) will now fail because the actual result includes a `canSocialSignup` field they don't expect. Add `canSocialSignup: false` to each of those two expected objects (both fixtures set no `defaultRoleId`, so it resolves to `false`):

```typescript
      await expect(service.getAppName('sq_1')).resolves.toEqual({
        name: 'MyApp',
        hasDefaultOrg: false,
        canSocialSignup: false,
        passwordPolicy: expect.any(Object),
        logo: 'data:image/png;base64,AAA=',
        favicon: 'data:image/png;base64,FFF=',
        privacyPolicyUrl: null,
        termsUrl: null,
        gdprUrl: null,
        gdprRequired: false,
        emailVerificationMethod: 'link',
        pageLightBackgroundColor: null,
        pageDarkBackgroundColor: null,
        cardLightBackgroundColor: null,
        cardDarkBackgroundColor: null,
      });
```

(Apply the same single-line addition — `canSocialSignup: false,` right after `hasDefaultOrg: false,` — to the second `.resolves.toEqual({...})` block as well.) Also add `defaultRoleId: true` to the existing `expect(mockPrisma.saApp.findUnique).toHaveBeenCalledWith({ ..., select: {...} })` assertion's `select` object, alongside `defaultOrgId: true`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest registration.service --silent -t getAppName`
Expected: PASS (all `getAppName` tests, including the 3 new ones)

- [ ] **Step 6: Commit**

```bash
git add apps/auth-server/src/registration/registration.service.ts apps/auth-server/src/registration/registration.service.spec.ts
git commit -m "feat(registration): expose canSocialSignup on getAppName"
```

---

### Task 12: Extract `SocialButtons` into a shared component

**Files:**
- Create: `apps/admin/components/social-buttons.tsx` (move from `apps/admin/app/login/social-buttons.tsx`)
- Modify: `apps/admin/app/login/login-form.tsx` (update the import)
- Modify: `apps/admin/components/__tests__/social-buttons.test.tsx` (update the import — it already lives at the component's new sibling `__tests__` location)
- Delete: `apps/admin/app/login/social-buttons.tsx`

Design doc §5a: `/signup` needs the identical component; `/login` keeps using it unchanged. This is a pure move — no behavior change.

- [ ] **Step 1: Create the moved file**

Copy the full, unmodified contents of `apps/admin/app/login/social-buttons.tsx` to `apps/admin/components/social-buttons.tsx` verbatim (same `'use client'`, same imports, same `SocialButtons` export — only the file's location changes, not a single line of its content).

- [ ] **Step 2: Update the test's import**

In `apps/admin/components/__tests__/social-buttons.test.tsx`, change:

```typescript
import { SocialButtons } from '@/app/login/social-buttons'
```

to:

```typescript
import { SocialButtons } from '@/components/social-buttons'
```

- [ ] **Step 3: Update `login-form.tsx`'s import**

In `apps/admin/app/login/login-form.tsx`, change:

```typescript
import { SocialButtons } from './social-buttons'
```

to:

```typescript
import { SocialButtons } from '@/components/social-buttons'
```

- [ ] **Step 4: Delete the old file**

```bash
git rm apps/admin/app/login/social-buttons.tsx
```

- [ ] **Step 5: Run the test suite to verify nothing broke**

Run: `cd apps/admin && npx jest social-buttons login-form --silent`
Expected: PASS — same tests as before, now resolving the component from its new location

- [ ] **Step 6: Commit**

```bash
git add apps/admin/components/social-buttons.tsx apps/admin/components/__tests__/social-buttons.test.tsx apps/admin/app/login/login-form.tsx
git commit -m "refactor(admin): move SocialButtons to a shared location for reuse on /signup"
```

---

### Task 13: `apps/admin/lib/app-info.ts` — surface `canSocialSignup`

**Files:**
- Modify: `apps/admin/lib/app-info.ts`
- Test: `apps/admin/lib/__tests__/app-info.test.ts` (create if it doesn't exist; check first)

- [ ] **Step 1: Check for an existing test file**

Run: `ls apps/admin/lib/__tests__/app-info.test.ts 2>/dev/null || echo "none"`

If `none`, create `apps/admin/lib/__tests__/app-info.test.ts` with:

```typescript
import { fetchAppInfo } from '../app-info'

describe('fetchAppInfo', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('passes through canSocialSignup: true from the auth-server response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ name: 'MyApp', hasDefaultOrg: true, canSocialSignup: true }),
    }) as unknown as typeof fetch

    const result = await fetchAppInfo('sq_1')
    expect(result.canSocialSignup).toBe(true)
  })

  it('defaults canSocialSignup to false on a non-boolean or missing value', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ name: 'MyApp', hasDefaultOrg: true }),
    }) as unknown as typeof fetch

    const result = await fetchAppInfo('sq_1')
    expect(result.canSocialSignup).toBe(false)
  })

  it('fails safe to canSocialSignup: false on a non-ok response', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false }) as unknown as typeof fetch

    const result = await fetchAppInfo('sq_1')
    expect(result.canSocialSignup).toBe(false)
  })
})
```

If the file already exists, add these three `it` blocks to its existing `describe('fetchAppInfo', ...)` instead of creating a new file.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/admin && npx jest app-info --silent`
Expected: FAIL — `result.canSocialSignup` is `undefined`, not `false`/`true`

- [ ] **Step 3: Update `app-info.ts`**

Add `canSocialSignup: boolean` to the `AppInfo` interface, `false` to `FAILSAFE`, and pass it through in the parsed response:

```typescript
export interface AppInfo {
  name: string | null; hasDefaultOrg: boolean; canSocialSignup: boolean; passwordPolicy: PasswordPolicy | null; logo: string | null;
  favicon: string | null;
  privacyPolicyUrl: string | null; termsUrl: string | null; gdprUrl: string | null; gdprRequired: boolean;
  emailVerificationMethod: 'link' | 'code';
  pageLightBackgroundColor: string | null;
  pageDarkBackgroundColor: string | null;
  cardLightBackgroundColor: string | null;
  cardDarkBackgroundColor: string | null;
}

const FAILSAFE: AppInfo = {
  name: null, hasDefaultOrg: false, canSocialSignup: false, passwordPolicy: null, logo: null, favicon: null,
  privacyPolicyUrl: null, termsUrl: null, gdprUrl: null, gdprRequired: false,
  emailVerificationMethod: 'link',
  pageLightBackgroundColor: null, pageDarkBackgroundColor: null,
  cardLightBackgroundColor: null, cardDarkBackgroundColor: null,
}
```

In the body, add `canSocialSignup?: boolean` to the inline response-shape type, and add this line to the returned object right after `hasDefaultOrg`:

```typescript
      canSocialSignup: body.canSocialSignup === true,
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/admin && npx jest app-info --silent`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/admin/lib/app-info.ts apps/admin/lib/__tests__/app-info.test.ts
git commit -m "feat(admin): surface canSocialSignup through fetchAppInfo"
```

---

### Task 14: Show `SocialButtons` on `/signup` (email/password flow)

**Files:**
- Modify: `apps/admin/app/signup/page.tsx`
- Modify: `apps/admin/app/signup/signup-form.tsx`
- Modify: `apps/admin/app/signup/__tests__/signup-form.test.tsx`

Design doc §5a: shown only when `canSocialSignup` is true AND the provider discovery list is non-empty — reusing `fetchSocialProviders`, the exact call `/login` already makes.

- [ ] **Step 1: Write the failing test**

Add to `apps/admin/app/signup/__tests__/signup-form.test.tsx` (check its existing render helper/props shape first and match it — the shape below assumes the component takes the same props `login-form.tsx`'s render tests use for `SocialButtons`):

```typescript
  it('renders SocialButtons when canSocialSignup is true and providers are non-empty', () => {
    renderForm({ canSocialSignup: true, providers: ['google'], authServerUrl: 'https://auth.example.com' })
    expect(screen.getByRole('button', { name: /google/i })).toBeInTheDocument()
  })

  it('does not render SocialButtons when canSocialSignup is false', () => {
    renderForm({ canSocialSignup: false, providers: ['google'], authServerUrl: 'https://auth.example.com' })
    expect(screen.queryByRole('button', { name: /google/i })).not.toBeInTheDocument()
  })

  it('does not render SocialButtons when the provider list is empty', () => {
    renderForm({ canSocialSignup: true, providers: [], authServerUrl: 'https://auth.example.com' })
    expect(screen.queryByRole('button', { name: /google/i })).not.toBeInTheDocument()
  })
```

(Adapt `renderForm`'s signature to however this test file's existing helper passes props to `SignupForm` — add `canSocialSignup`, `providers`, `authServerUrl` as new optional args defaulting to `false`, `[]`, `''` respectively, so every pre-existing call site in this file keeps compiling unchanged.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/admin && npx jest signup-form --silent`
Expected: FAIL — `SignupForm` doesn't accept these props yet, no button renders

- [ ] **Step 3: Update `signup-form.tsx`**

Add three props and render `SocialButtons` above the form, gated:

```typescript
import { SocialButtons } from '@/components/social-buttons'

interface SignupFormProps {
  clientId: string
  next: string
  hasDefaultOrg: boolean
  canSocialSignup: boolean
  providers: string[]
  authServerUrl: string
  passwordPolicy: PasswordPolicy | null
  privacyPolicyUrl: string | null
  termsUrl: string | null
  gdprUrl: string | null
}
```

```typescript
export function SignupForm({
  clientId, next, hasDefaultOrg, canSocialSignup, providers, authServerUrl,
  passwordPolicy, privacyPolicyUrl, termsUrl, gdprUrl,
}: SignupFormProps) {
```

Right before the existing `return (<form ...>` (i.e. `SignupForm` now returns a fragment containing both), wrap the existing return value:

```typescript
  return (
    <>
      {canSocialSignup && providers.length > 0 && (
        <SocialButtons providers={providers} next={next} authServerUrl={authServerUrl} />
      )}
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {/* ...unchanged existing form body... */}
      </form>
    </>
  )
```

- [ ] **Step 4: Wire `page.tsx` to fetch providers and pass the new props**

In `apps/admin/app/signup/page.tsx`, add the import:

```typescript
import { fetchSocialProviders } from '@/lib/social-providers'
```

In the non-wizard branch (the `return (<AuthCard ...><SignupForm .../></AuthCard>)` block, NOT the `emailVerificationMethod === 'code'` wizard branch — this task only covers the plain form), fetch providers alongside `fetchAppInfo` and pass them through:

```typescript
  const {
    name: appName, hasDefaultOrg, canSocialSignup, passwordPolicy, logo, privacyPolicyUrl, termsUrl, gdprUrl, gdprRequired,
    emailVerificationMethod,
    pageLightBackgroundColor, pageDarkBackgroundColor, cardLightBackgroundColor, cardDarkBackgroundColor,
  } = await fetchAppInfo(clientId)
  const { providers } = await fetchSocialProviders(`/signup?client_id=${encodeURIComponent(clientId)}`)
```

Note: `fetchSocialProviders` expects a `next`-shaped URL whose `client_id` query param it reads — passing a synthetic `/signup?client_id=...` URL here (rather than the real `next`) matches that contract since this call only needs the provider list, not branding (branding already comes from `fetchAppInfo` above). Then in the `SignupForm` JSX:

```typescript
      <SignupForm
        clientId={clientId}
        next={nextSafe}
        hasDefaultOrg={hasDefaultOrg}
        canSocialSignup={canSocialSignup}
        providers={providers}
        authServerUrl={process.env.AUTH_SERVER_URL ?? 'https://localhost:3010'}
        passwordPolicy={passwordPolicy}
        privacyPolicyUrl={privacyPolicyUrl}
        termsUrl={termsUrl}
        gdprUrl={gdprRequired ? gdprUrl : null}
      />
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/admin && npx jest signup-form signup page.test --silent`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/admin/app/signup/page.tsx apps/admin/app/signup/signup-form.tsx apps/admin/app/signup/__tests__/signup-form.test.tsx
git commit -m "feat(admin): show social buttons on /signup when JIT signup is eligible"
```

---

### Task 15: Show `SocialButtons` on the code-verification signup wizard

**Files:**
- Modify: `apps/admin/app/signup/page.tsx`
- Modify: `apps/admin/app/signup/signup-wizard-card.tsx`
- Modify: `apps/admin/app/signup/signup-wizard.tsx`
- Modify: `apps/admin/app/signup/__tests__/signup-wizard.test.tsx`

Only the wizard's first (`'email'`) step shows the buttons — later steps are mid-flow and shouldn't offer a competing sign-up path.

- [ ] **Step 1: Write the failing test**

Add to `apps/admin/app/signup/__tests__/signup-wizard.test.tsx` (match its existing render helper's prop-passing convention):

```typescript
  it('renders SocialButtons on the email step when canSocialSignup is true and providers are non-empty', () => {
    renderWizard({ canSocialSignup: true, providers: ['google'], authServerUrl: 'https://auth.example.com' })
    expect(screen.getByRole('button', { name: /google/i })).toBeInTheDocument()
  })

  it('does not render SocialButtons on the email step when canSocialSignup is false', () => {
    renderWizard({ canSocialSignup: false, providers: ['google'], authServerUrl: 'https://auth.example.com' })
    expect(screen.queryByRole('button', { name: /google/i })).not.toBeInTheDocument()
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/admin && npx jest signup-wizard --silent`
Expected: FAIL — `SignupWizard` doesn't accept these props yet

- [ ] **Step 3: Update `signup-wizard.tsx`**

Add the import and three props:

```typescript
import { SocialButtons } from '@/components/social-buttons'

interface SignupWizardProps {
  clientId: string
  next: string
  hasDefaultOrg: boolean
  canSocialSignup: boolean
  providers: string[]
  authServerUrl: string
  passwordPolicy: PasswordPolicy | null
  privacyPolicyUrl: string | null
  termsUrl: string | null
  gdprUrl: string | null
  onStepChange?: (step: Step) => void
}
```

```typescript
export function SignupWizard({
  clientId, next, hasDefaultOrg, canSocialSignup, providers, authServerUrl,
  passwordPolicy, privacyPolicyUrl, termsUrl, gdprUrl, onStepChange,
}: SignupWizardProps) {
```

In the `if (step === 'email') { return ( ... ) }` block, wrap the existing `<form>` so the buttons render above it, only on this step:

```typescript
  if (step === 'email') {
    return (
      <>
        {canSocialSignup && providers.length > 0 && (
          <SocialButtons providers={providers} next={next} authServerUrl={authServerUrl} />
        )}
        <form onSubmit={handleEmailSubmit} className="flex flex-col gap-4">
          {/* ...unchanged existing email-step form body... */}
        </form>
      </>
    )
  }
```

- [ ] **Step 4: Update `signup-wizard-card.tsx`**

Thread the three new props through to `SignupWizard`:

```typescript
interface SignupWizardCardProps {
  clientId: string
  next: string
  hasDefaultOrg: boolean
  canSocialSignup: boolean
  providers: string[]
  authServerUrl: string
  passwordPolicy: PasswordPolicy | null
  privacyPolicyUrl: string | null
  termsUrl: string | null
  gdprUrl: string | null
  appName: string | null
  logo: string | null
  pageLightBackgroundColor: string | null
  pageDarkBackgroundColor: string | null
  cardLightBackgroundColor: string | null
  cardDarkBackgroundColor: string | null
  footer: React.ReactNode
}

export function SignupWizardCard({
  clientId, next, hasDefaultOrg, canSocialSignup, providers, authServerUrl,
  passwordPolicy, privacyPolicyUrl, termsUrl, gdprUrl, appName, logo,
  pageLightBackgroundColor, pageDarkBackgroundColor, cardLightBackgroundColor, cardDarkBackgroundColor, footer,
}: SignupWizardCardProps) {
```

and in its `<SignupWizard ... />` call:

```typescript
      <SignupWizard
        clientId={clientId}
        next={next}
        hasDefaultOrg={hasDefaultOrg}
        canSocialSignup={canSocialSignup}
        providers={providers}
        authServerUrl={authServerUrl}
        passwordPolicy={passwordPolicy}
        privacyPolicyUrl={privacyPolicyUrl}
        termsUrl={termsUrl}
        gdprUrl={gdprUrl}
        onStepChange={setStep}
      />
```

- [ ] **Step 5: Update `page.tsx`'s wizard branch**

In the `emailVerificationMethod === 'code'` branch (the one rendering `<SignupWizardCard>`), pass the same `canSocialSignup`/`providers`/`authServerUrl` computed in Task 14's Step 4:

```typescript
      <SignupWizardCard
        clientId={clientId}
        next={nextSafe}
        hasDefaultOrg={hasDefaultOrg}
        canSocialSignup={canSocialSignup}
        providers={providers}
        authServerUrl={process.env.AUTH_SERVER_URL ?? 'https://localhost:3010'}
        passwordPolicy={passwordPolicy}
        privacyPolicyUrl={privacyPolicyUrl}
        termsUrl={termsUrl}
        gdprUrl={gdprRequired ? gdprUrl : null}
        appName={appName}
        logo={logo}
        pageLightBackgroundColor={pageLightBackgroundColor}
        pageDarkBackgroundColor={pageDarkBackgroundColor}
        cardLightBackgroundColor={cardLightBackgroundColor}
        cardDarkBackgroundColor={cardDarkBackgroundColor}
        footer={footer}
      />
```

Move the `fetchSocialProviders` call from Task 14 (which currently sits only above the non-wizard `return`) to before the `if (emailVerificationMethod === 'code')` branch, so both branches can use `providers`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd apps/admin && npx jest signup-wizard signup-wizard-card page.test --silent`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/admin/app/signup/page.tsx apps/admin/app/signup/signup-wizard-card.tsx apps/admin/app/signup/signup-wizard.tsx apps/admin/app/signup/__tests__/signup-wizard.test.tsx
git commit -m "feat(admin): show social buttons on the signup wizard's email step"
```

---

### Task 16: Playwright e2e — JIT provisioning and the ineligible-app redirect

**Files:**
- Modify: `apps/admin-e2e/tests/rs-social-round-trip.spec.ts`

**Correction from an earlier draft of this plan:** this task originally pointed at `apps/auth-server/test/app.e2e-spec.ts` and invented helper names
(`createTestAppWithDefaultOrgAndRole`, `setStubIdentity`, `startStubSignIn`).
Checked against the real file: `app.e2e-spec.ts` has no stub-IdP or social
coverage at all (confirmed — `grep -n "describe" apps/auth-server/test/app.e2e-spec.ts`
lists JWKS/direct-login/OAuth2/invitation/lifecycle blocks, nothing
social-related). The actual, only existing stub-IdP suite — the one the
original social-authentication design added, and the one design doc §7
means by "extends the existing stub-IdP suite" — is this Playwright file.
Everything below uses ONLY helpers already confirmed present in it:
`SocialLoginPage` (`social.setIdentity`, `social.clickTestIdp`),
`countUsersWithEmail`, `countAccountsForEmail`, `resetStubIdentity`,
`configured()`, `AUTH_SERVER_URL`, `RS_BASE_URL`, `STUB_IDP_URL`,
`SOCIAL_EMAIL`.

- [ ] **Step 1: Write the new tests**

Add inside the existing `test.describe('FastAPI RS federated round-trip', ...)` block, after the existing tests (`beforeEach`/`afterEach` already call `resetStubIdentity` and skip via `configured()` for every test in this file, including these new ones):

```typescript
  test('a first-time unknown identity JIT-provisions and completes sign-in for an eligible app', async ({ page, request }) => {
    const rsClientId = process.env.RS_CLIENT_ID ?? process.env.SASSY_CLIENT_ID ?? ''
    expect(rsClientId, 'RS_CLIENT_ID / SASSY_CLIENT_ID must be set').toBeTruthy()

    const superCtx = await page.context().browser()!.newContext({ storageState: '.auth/super-admin.json' })
    const orgsRes = await superCtx.request.get(`${AUTH_SERVER_URL}/api/orgs`)
    expect(orgsRes.ok(), `GET /api/orgs failed: ${orgsRes.status()}`).toBeTruthy()
    const { orgs } = (await orgsRes.json()) as { orgs: Array<{ publicId: string; name: string }> }
    const citadelOrg = orgs.find((o) => o.name === 'Citadel')
    expect(citadelOrg, 'Citadel org (seeded by demo-resource-server.ts) must exist').toBeTruthy()

    const rolesRes = await superCtx.request.get(`${AUTH_SERVER_URL}/api/roles`)
    expect(rolesRes.ok(), `GET /api/roles failed: ${rolesRes.status()}`).toBeTruthy()
    const { roles } = (await rolesRes.json()) as { roles: Array<{ publicId: string; name: string }> }
    const inspectorsRole = roles.find((r) => r.name === 'Citadel Inspectors')
    expect(inspectorsRole, 'Citadel Inspectors role (seeded by demo-resource-server.ts) must exist').toBeTruthy()

    const email = `jit-e2e-${Date.now()}@example.com`
    const before = countUsersWithEmail(email)
    expect(before, 'precondition: no leftover row from a previous run').toBe(0)

    try {
      const patchRes = await superCtx.request.patch(`${AUTH_SERVER_URL}/api/apps/${rsClientId}`, {
        data: { defaultOrgId: citadelOrg!.publicId, defaultRoleId: inspectorsRole!.publicId },
      })
      expect(patchRes.ok(), `failed to set default org/role: ${patchRes.status()}`).toBeTruthy()

      const social = new SocialLoginPage(page)
      await social.setIdentity(request, { sub: `jit-e2e-sub-${Date.now()}`, email, email_verified: true })

      await page.goto(`${RS_BASE_URL}/auth/login`)
      await social.clickTestIdp()

      await expect(page).toHaveURL(new RegExp(`^${RS_BASE_URL}/auth/callback`))
      await expect(page.getByRole('heading', { name: 'Signed in' })).toBeVisible()
      await expect(page.getByTestId('claim-amr')).toHaveText('ext')

      const after = countUsersWithEmail(email)
      expect(after, 'JIT signup must create exactly one User row').toBe(1)
    } finally {
      const restoreRes = await superCtx.request.patch(`${AUTH_SERVER_URL}/api/apps/${rsClientId}`, {
        data: { defaultOrgId: null, defaultRoleId: null },
      })
      expect(restoreRes.ok(), `failed to restore default org/role: ${restoreRes.status()}`).toBeTruthy()
      await superCtx.close()
    }
  })

  test('an unknown identity against an ineligible app is redirected to social_signup_unavailable and creates no user', async ({ page, request }) => {
    // No RS_CLIENT_ID mutation here — the RS demo app has no defaultOrgId/
    // defaultRoleId by default (confirmed: this is the same app the existing
    // "an unknown identity is refused generically and creates no user" test
    // above already exercises while ineligible), so this exercises the new
    // compensating-delete path directly, with no setup/teardown needed.
    const social = new SocialLoginPage(page)
    const email = `nojit-e2e-${Date.now()}@example.com`
    const before = countUsersWithEmail(email)
    expect(before, 'precondition: no leftover row from a previous run').toBe(0)

    await social.setIdentity(request, { sub: `nojit-e2e-sub-${Date.now()}`, email, email_verified: true })

    await page.goto(`${RS_BASE_URL}/auth/login`)
    await social.clickTestIdp()

    await expect(page).toHaveURL(/\/oauth-error\?code=social_signup_unavailable/)
    await expect(page.getByText("Sign-up isn't available for this app")).toBeVisible()

    const after = countUsersWithEmail(email)
    expect(after, 'the compensating delete must leave no User row behind').toBe(0)
  })
```

- [ ] **Step 2: Run the tests**

Run: `cd apps/admin-e2e && npx playwright test rs-social-round-trip -g "JIT-provisions|social_signup_unavailable"`
Expected: PASS (requires the full e2e stack per this file's existing module-comment preconditions — `E2E_STUB_IDP_URL`, the stub IdP server, the RS, and `RS_CLIENT_ID`/`SASSY_CLIENT_ID` all running/set)

- [ ] **Step 3: Commit**

```bash
git add apps/admin-e2e/tests/rs-social-round-trip.spec.ts
git commit -m "test(e2e): cover JIT social signup provisioning and the ineligible-app redirect"
```

---

### Task 17: Admin e2e — `/signup` page button visibility

**Files:**
- Modify: `apps/admin-e2e/tests/rs-social-round-trip.spec.ts`

Design doc §5a/§7: this is the one piece of coverage for a surface that is genuinely new in this feature (the admin `/signup` page gaining buttons at all), as opposed to Task 16, which proves the backend provisioning/redirect behavior through the RS's own login flow. Reuses `ADMIN_URL` (`apps/admin-e2e/lib/oauth-fixtures.ts`) and the same `rsClientId`/super-admin PATCH pattern Task 16 and the file's existing "provider disabled" test already establish.

- [ ] **Step 1: Write the new tests**

Add inside the existing `test.describe('FastAPI RS federated round-trip', ...)` block, after the tests Task 16 added. Add the import at the top of the file alongside the existing ones:

```typescript
import { ADMIN_URL } from '../lib/oauth-fixtures'
```

```typescript
  test('/signup shows the social button only once the app is JIT-signup-eligible', async ({ page }) => {
    const rsClientId = process.env.RS_CLIENT_ID ?? process.env.SASSY_CLIENT_ID ?? ''
    expect(rsClientId, 'RS_CLIENT_ID / SASSY_CLIENT_ID must be set').toBeTruthy()

    // No defaultOrgId/defaultRoleId set on the RS demo app by default (same
    // precondition Task 16's ineligible-app test relies on) — the button
    // must be absent.
    await page.goto(`${ADMIN_URL}/signup?client_id=${encodeURIComponent(rsClientId)}`)
    await expect(page.getByRole('button', { name: /test idp/i })).toHaveCount(0)

    const superCtx = await page.context().browser()!.newContext({ storageState: '.auth/super-admin.json' })
    const orgsRes = await superCtx.request.get(`${AUTH_SERVER_URL}/api/orgs`)
    expect(orgsRes.ok(), `GET /api/orgs failed: ${orgsRes.status()}`).toBeTruthy()
    const { orgs } = (await orgsRes.json()) as { orgs: Array<{ publicId: string; name: string }> }
    const citadelOrg = orgs.find((o) => o.name === 'Citadel')
    expect(citadelOrg, 'Citadel org (seeded by demo-resource-server.ts) must exist').toBeTruthy()

    const rolesRes = await superCtx.request.get(`${AUTH_SERVER_URL}/api/roles`)
    expect(rolesRes.ok(), `GET /api/roles failed: ${rolesRes.status()}`).toBeTruthy()
    const { roles } = (await rolesRes.json()) as { roles: Array<{ publicId: string; name: string }> }
    const inspectorsRole = roles.find((r) => r.name === 'Citadel Inspectors')
    expect(inspectorsRole, 'Citadel Inspectors role (seeded by demo-resource-server.ts) must exist').toBeTruthy()

    try {
      const patchRes = await superCtx.request.patch(`${AUTH_SERVER_URL}/api/apps/${rsClientId}`, {
        data: { defaultOrgId: citadelOrg!.publicId, defaultRoleId: inspectorsRole!.publicId },
      })
      expect(patchRes.ok(), `failed to set default org/role: ${patchRes.status()}`).toBeTruthy()

      await page.goto(`${ADMIN_URL}/signup?client_id=${encodeURIComponent(rsClientId)}`)
      await expect(page.getByRole('button', { name: /test idp/i })).toBeVisible()
    } finally {
      const restoreRes = await superCtx.request.patch(`${AUTH_SERVER_URL}/api/apps/${rsClientId}`, {
        data: { defaultOrgId: null, defaultRoleId: null },
      })
      expect(restoreRes.ok(), `failed to restore default org/role: ${restoreRes.status()}`).toBeTruthy()
      await superCtx.close()
    }
  })
```

**Note for the implementer:** confirm `GET /api/orgs` / `GET /api/roles`'s exact response shape (`orgs`/`roles` top-level key names, whether they need an `appId` filter query param) against `orgs.controller.ts`/`roles.controller.ts` before running this — adjust the destructuring above to match if they differ. The PATCH body field names (`defaultOrgId`/`defaultRoleId` as Sqid strings) are confirmed against `apps/auth-server/src/apps/dto/update-app.dto.ts`. The button's accessible name (`/test idp/i`) is copied from this same file's existing "a provider disabled for the app renders no button" test.

- [ ] **Step 2: Run the test**

Run: `cd apps/admin-e2e && npx playwright test rs-social-round-trip -g "signup shows the social button"`
Expected: PASS (requires the full e2e stack per this file's existing module-comment preconditions)

- [ ] **Step 3: Commit**

```bash
git add apps/admin-e2e/tests/rs-social-round-trip.spec.ts
git commit -m "test(e2e): cover /signup social button visibility against JIT eligibility"
```

---

## Post-implementation checklist

- [ ] Run the full auth-server unit suite: `cd apps/auth-server && npm test`
- [ ] Run the full admin unit suite: `cd apps/admin && npm test`
- [ ] Run `npx tsc --noEmit` in both `apps/auth-server` and `apps/admin`
- [ ] Update `docs/social-auth-setup.md` — its "invite-only... never a signup method" framing (lines 12-18) needs a note that this is now conditional on `defaultOrgId`/`defaultRoleId`, pointing at the new design doc
- [ ] Update the README's token/claims documentation if `amr`/`idp` examples reference invite-only assumptions (confirm during review — design doc §6 states these are unchanged, so this may be a no-op)
