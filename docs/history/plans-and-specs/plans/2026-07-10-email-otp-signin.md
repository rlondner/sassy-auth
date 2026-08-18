# Email-OTP Passwordless Sign-In Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add email one-time-code (OTP) sign-in to the admin console — existing/active users only, delivered via `EmailService` — plus a shared session-creation status gate that secures OTP and completes the deactivate kill-switch across all sign-in methods.

**Architecture:** In the auth-server, a new `databaseHooks.session.create.before` gate rejects any session for a non-`active` `SaUser` (throws `APIError('FORBIDDEN')`). The already-registered `emailOTP` plugin is configured (`otpLength`/`expiresIn`/`allowedAttempts`/`disableSignUp`/`rateLimit`) and its `sendVerificationOTP` routes through `getEmailer()` using a new `signInCodeEmail` template, skipping delivery to non-active users. The admin console gets two server actions (`requestOtp`, `verifyOtp`) and a two-step login form on a `/login/code` route. E2E reads the code through an env-guarded test-only endpoint.

**Tech Stack:** NestJS, BetterAuth 1.6.11 (`emailOTP`, `APIError` from `better-auth/api`), Prisma, Jest, Next.js App Router server actions, next-intl, Playwright, Winston.

## Global Constraints

- **bug-0163 invariant:** the OTP value is a bearer credential — NEVER log it in any log line, structured field, or Sentry event. Only the Console email transport renders it, and only when no SMTP/Resend transport is configured.
- **Existing-users-only:** `emailOTP` runs with `disableSignUp: true`. No auto-provisioning.
- **Enumeration-neutral:** the admin `requestOtp` action returns `{ sent: true }` for every non-transport outcome; it never reveals whether an account exists or is active.
- **OTP params (verbatim):** `otpLength: 6`, `expiresIn: 300`, `allowedAttempts: 3`, send `rateLimit: { window: 60, max: 5 }`.
- **Type scope:** only `type === 'sign-in'` OTP is used; the sender's status logic applies to `'sign-in'`.
- **i18n:** every new admin string key is added to **both** `apps/admin/messages/en.json` and `apps/admin/messages/fr.json`.
- **Gate hook runs outside Nest DI** (like the existing bug-0186 `session.create.after`): use a module-level `createAppLogger()` instance, not the injected `LoggerService`.
- **Commits:** end messages with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Build gate (env quirk):** before building/testing, shared packages must be generated/built:
  `pnpm --filter @sassy-auth/db exec prisma generate --schema=schema.prisma && pnpm --filter @sassy-auth/db --filter @sassy-auth/types build`
  (`pnpm` = `~/.bun/bin/pnpm` shim if bare `pnpm` is not on PATH.)

## File Structure

**auth-server (create):**
- `src/email/templates/sign-in-code.template.ts` — `signInCodeEmail({ otp, minutes })` → `EmailMessageParts`.
- `src/auth/session-gate.ts` — `evaluateSessionGate(db, userId)` pure gate decision.
- `src/auth/otp-test-store.ts` — module-level in-memory `Map<email, otp>` for test retrieval.
- `src/auth/otp-sender.ts` — `sendSignInOtp(deps, data)` testable OTP-send logic.
- `src/test-support/otp-test.controller.ts` — env-guarded `GET /test/last-otp`.
- `src/test-support/test-support.module.ts` — conditionally registered module.

**auth-server (modify):**
- `src/auth/auth.config.ts` — wire the `before` gate + configure `emailOTP` + route sender through `sendSignInOtp`.
- `src/app.module.ts` — conditionally import `TestSupportModule` when `NODE_ENV === 'test'`.

**admin (create):**
- `app/login/code/page.tsx` — OTP page.
- `app/login/login-otp-form.tsx` — two-step client form.

**admin (modify):**
- `app/login/actions.ts` — `requestOtp`, `verifyOtp`, extract `forwardSessionCookie` helper.
- `app/login/login-form.tsx` — link to `/login/code`.
- `messages/en.json`, `messages/fr.json` — new `login` keys.

**admin-e2e (create/modify):**
- `pages/login.page.ts` (or extend existing) — OTP flow helpers.
- `tests/…/otp-signin.spec.ts` — happy path + wrong code + deactivated blocked.

---

### Task 1: Sign-in code email template

**Files:**
- Create: `apps/auth-server/src/email/templates/sign-in-code.template.ts`
- Test: `apps/auth-server/src/email/templates/templates.spec.ts` (append)

**Interfaces:**
- Consumes: `EmailMessageParts` from `../email.types` (`{ subject, html, text }`).
- Produces: `signInCodeEmail(args: { otp: string; minutes: number }): EmailMessageParts`.

- [ ] **Step 1: Write the failing test**

Append to `apps/auth-server/src/email/templates/templates.spec.ts`:

```typescript
import { signInCodeEmail } from './sign-in-code.template';

describe('signInCodeEmail', () => {
  it('includes the code and expiry minutes in subject/text/html', () => {
    const parts = signInCodeEmail({ otp: '123456', minutes: 5 });
    expect(parts.subject).toMatch(/code|sign.?in/i);
    expect(parts.text).toContain('123456');
    expect(parts.html).toContain('123456');
    expect(parts.text).toContain('5');
    expect(parts.html).toContain('5');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sassy-auth/auth-server exec jest src/email/templates/templates.spec.ts -t signInCodeEmail`
Expected: FAIL — cannot find module `./sign-in-code.template`.

- [ ] **Step 3: Implement the template**

Create `apps/auth-server/src/email/templates/sign-in-code.template.ts`:

```typescript
import type { EmailMessageParts } from '../email.types';

export function signInCodeEmail(args: { otp: string; minutes: number }): EmailMessageParts {
  const { otp, minutes } = args;
  return {
    subject: 'Your Sassy Auth sign-in code',
    text: `Your sign-in code is ${otp}. It expires in ${minutes} minutes.\n\nIf you didn't request this, you can ignore this email.`,
    html: `<p>Your sign-in code is <strong>${otp}</strong>.</p><p>It expires in ${minutes} minutes.</p><p>If you didn't request this, you can ignore this email.</p>`,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sassy-auth/auth-server exec jest src/email/templates/templates.spec.ts -t signInCodeEmail`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/email/templates/sign-in-code.template.ts apps/auth-server/src/email/templates/templates.spec.ts
git commit -m "feat(email): sign-in code email template

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Session-creation status gate

**Files:**
- Create: `apps/auth-server/src/auth/session-gate.ts`
- Create: `apps/auth-server/src/auth/session-gate.spec.ts`
- Modify: `apps/auth-server/src/auth/auth.config.ts` (add `before` hook, imports, `authLogger`)

**Interfaces:**
- Produces: `evaluateSessionGate(db: GateClient, userId: string): Promise<{ allowed: boolean; status: string | null }>` where `GateClient = { saUser: { findUnique(args: { where: { betterAuthUserId: string }; select: { status: true } }): Promise<{ status: string } | null> } }`.
- Consumed by: `auth.config.ts` `session.create.before`.

- [ ] **Step 1: Write the failing test**

Create `apps/auth-server/src/auth/session-gate.spec.ts`:

```typescript
import { evaluateSessionGate } from './session-gate';

function dbWith(user: { status: string } | null) {
  return { saUser: { findUnique: jest.fn().mockResolvedValue(user) } };
}

describe('evaluateSessionGate', () => {
  it('allows an active user', async () => {
    const res = await evaluateSessionGate(dbWith({ status: 'active' }), 'ba-1');
    expect(res).toEqual({ allowed: true, status: 'active' });
  });

  it('blocks a pending user', async () => {
    const res = await evaluateSessionGate(dbWith({ status: 'pending' }), 'ba-1');
    expect(res).toEqual({ allowed: false, status: 'pending' });
  });

  it('blocks an inactive user', async () => {
    const res = await evaluateSessionGate(dbWith({ status: 'inactive' }), 'ba-1');
    expect(res).toEqual({ allowed: false, status: 'inactive' });
  });

  it('blocks (fail closed) when no SaUser exists', async () => {
    const res = await evaluateSessionGate(dbWith(null), 'ba-unknown');
    expect(res).toEqual({ allowed: false, status: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sassy-auth/auth-server exec jest src/auth/session-gate.spec.ts`
Expected: FAIL — cannot find module `./session-gate`.

- [ ] **Step 3: Implement the gate function**

Create `apps/auth-server/src/auth/session-gate.ts`:

```typescript
export interface GateClient {
  saUser: {
    findUnique(args: {
      where: { betterAuthUserId: string };
      select: { status: true };
    }): Promise<{ status: string } | null>;
  };
}

/**
 * Decide whether a session may be created for a BetterAuth user. A session is
 * allowed only when a matching SaUser exists AND its status is 'active'. An
 * unknown user fails closed. This gate is enforced for ALL sign-in methods
 * (password, OTP, social) via databaseHooks.session.create.before.
 */
export async function evaluateSessionGate(
  db: GateClient,
  userId: string,
): Promise<{ allowed: boolean; status: string | null }> {
  const saUser = await db.saUser.findUnique({
    where: { betterAuthUserId: userId },
    select: { status: true },
  });
  if (!saUser) return { allowed: false, status: null };
  return { allowed: saUser.status === 'active', status: saUser.status };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sassy-auth/auth-server exec jest src/auth/session-gate.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire the gate into `auth.config.ts`**

In `apps/auth-server/src/auth/auth.config.ts`, add these imports near the existing imports (top of file, after line 7):

```typescript
import { APIError } from 'better-auth/api';
import { evaluateSessionGate } from './session-gate';
import { createAppLogger } from '../common/logger/winston.config';
```

Immediately after the imports (module scope, before `export const auth`), add:

```typescript
// The session-create gate runs outside a Nest request context, so it uses a
// standalone Winston logger rather than the injected LoggerService (same
// rationale as the bug-0186 after-hook).
const authLogger = createAppLogger();
```

Then, inside `databaseHooks.session.create` (which currently holds only `after`), add a `before` sibling directly above `after:`:

```typescript
        before: async (session: { userId: string }) => {
          const gate = await evaluateSessionGate(prisma, session.userId);
          if (!gate.allowed) {
            // bug-0163-adjacent: no credential here, safe to log. This is the
            // security event — a non-active user attempted to create a session
            // (any method: password, OTP, social).
            authLogger.warn('Session creation blocked', {
              context: 'session-gate',
              betterAuthUserId: session.userId,
              status: gate.status,
            });
            throw new APIError('FORBIDDEN', {
              message: 'This account is not active.',
            });
          }
        },
```

- [ ] **Step 6: Build to verify wiring compiles**

Run: `pnpm --filter @sassy-auth/db exec prisma generate --schema=schema.prisma && pnpm --filter @sassy-auth/db --filter @sassy-auth/types build && pnpm --filter @sassy-auth/auth-server build`
Expected: build succeeds. (If `APIError`'s constructor signature differs in this version, adjust to `new APIError('FORBIDDEN', { message: '...' })` per `better-auth/api` — the 403 mapping is verified end-to-end by Task 7's "deactivated blocked" e2e.)

- [ ] **Step 7: Commit**

```bash
git add apps/auth-server/src/auth/session-gate.ts apps/auth-server/src/auth/session-gate.spec.ts apps/auth-server/src/auth/auth.config.ts
git commit -m "feat(auth): shared session-creation status gate (active users only)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: OTP config + sender routing through EmailService

**Files:**
- Create: `apps/auth-server/src/auth/otp-test-store.ts`
- Create: `apps/auth-server/src/auth/otp-sender.ts`
- Create: `apps/auth-server/src/auth/otp-sender.spec.ts`
- Modify: `apps/auth-server/src/auth/auth.config.ts` (configure `emailOTP`, route sender)

**Interfaces:**
- Consumes: `signInCodeEmail` (Task 1), `getEmailer` from `../email/email.singleton`, `evaluateSessionGate`'s `GateClient` shape is NOT reused here (this queries by email).
- Produces:
  - `otpTestStore` — `{ set(email: string, otp: string): void; get(email: string): string | undefined }`.
  - `sendSignInOtp(deps: SendOtpDeps, data: { email: string; otp: string; type: string }): Promise<void>` where
    `SendOtpDeps = { db: OtpSenderDb; emailer: { send(msg: { to: string; subject: string; html: string; text: string }): Promise<{ sent: boolean }> }; store: { set(email: string, otp: string): void }; logger: { info(msg: string, meta: Record<string, unknown>): void }; isTest: boolean }`
    and `OtpSenderDb = { saUser: { findFirst(args: { where: { betterAuthUser: { email: string } }; select: { status: true } }): Promise<{ status: string } | null> } }`.

- [ ] **Step 1: Create the test store**

Create `apps/auth-server/src/auth/otp-test-store.ts`:

```typescript
/**
 * In-memory store of the last OTP per recipient. ONLY written when
 * NODE_ENV === 'test' (see otp-sender). Read exclusively by the env-guarded
 * test-only endpoint (Task 4). Never used in production paths.
 */
const lastOtpByEmail = new Map<string, string>();

export const otpTestStore = {
  set(email: string, otp: string): void {
    lastOtpByEmail.set(email.toLowerCase(), otp);
  },
  get(email: string): string | undefined {
    return lastOtpByEmail.get(email.toLowerCase());
  },
};
```

- [ ] **Step 2: Write the failing sender test**

Create `apps/auth-server/src/auth/otp-sender.spec.ts`:

```typescript
import { sendSignInOtp } from './otp-sender';

function makeDeps(user: { status: string } | null) {
  const send = jest.fn().mockResolvedValue({ sent: true });
  const set = jest.fn();
  const info = jest.fn();
  const deps = {
    db: { saUser: { findFirst: jest.fn().mockResolvedValue(user) } },
    emailer: { send },
    store: { set },
    logger: { info },
    isTest: true,
  };
  return { deps, send, set, info };
}

describe('sendSignInOtp', () => {
  it('emails the code and logs sent for an active user', async () => {
    const { deps, send, set, info } = makeDeps({ status: 'active' });
    await sendSignInOtp(deps, { email: 'a@x.com', otp: '654321', type: 'sign-in' });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'a@x.com', subject: expect.stringMatching(/code|sign.?in/i) }),
    );
    expect(send.mock.calls[0][0].text).toContain('654321');
    expect(set).toHaveBeenCalledWith('a@x.com', '654321'); // test-store write
    expect(info).toHaveBeenCalledWith('Sign-in code requested', expect.objectContaining({ outcome: 'sent' }));
  });

  it('skips delivery and logs skipped_inactive for a non-active user', async () => {
    const { deps, send, info } = makeDeps({ status: 'inactive' });
    await sendSignInOtp(deps, { email: 'a@x.com', otp: '654321', type: 'sign-in' });
    expect(send).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith('Sign-in code requested', expect.objectContaining({ outcome: 'skipped_inactive' }));
  });

  it('skips delivery and logs skipped_unknown when no SaUser exists', async () => {
    const { deps, send, info } = makeDeps(null);
    await sendSignInOtp(deps, { email: 'a@x.com', otp: '654321', type: 'sign-in' });
    expect(send).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith('Sign-in code requested', expect.objectContaining({ outcome: 'skipped_unknown' }));
  });

  it('never logs the OTP value', async () => {
    const { deps, info } = makeDeps({ status: 'active' });
    await sendSignInOtp(deps, { email: 'a@x.com', otp: '654321', type: 'sign-in' });
    for (const call of info.mock.calls) {
      expect(JSON.stringify(call)).not.toContain('654321');
    }
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @sassy-auth/auth-server exec jest src/auth/otp-sender.spec.ts`
Expected: FAIL — cannot find module `./otp-sender`.

- [ ] **Step 4: Implement the sender**

Create `apps/auth-server/src/auth/otp-sender.ts`:

```typescript
import { signInCodeEmail } from '../email/templates/sign-in-code.template';

export interface OtpSenderDb {
  saUser: {
    findFirst(args: {
      where: { betterAuthUser: { email: string } };
      select: { status: true };
    }): Promise<{ status: string } | null>;
  };
}

export interface SendOtpDeps {
  db: OtpSenderDb;
  emailer: { send(msg: { to: string; subject: string; html: string; text: string }): Promise<{ sent: boolean }> };
  store: { set(email: string, otp: string): void };
  logger: { info(msg: string, meta: Record<string, unknown>): void };
  isTest: boolean;
}

const OTP_EXPIRY_MINUTES = 5;

/**
 * Deliver a sign-in OTP through EmailService, but only to existing, active
 * users. Non-active/unknown users get no email (the admin action keeps the
 * HTTP response neutral regardless). The OTP value is never logged (bug-0163).
 */
export async function sendSignInOtp(
  deps: SendOtpDeps,
  data: { email: string; otp: string; type: string },
): Promise<void> {
  const { db, emailer, store, logger, isTest } = deps;
  const { email, otp, type } = data;

  if (type === 'sign-in') {
    const saUser = await db.saUser.findFirst({
      where: { betterAuthUser: { email } },
      select: { status: true },
    });
    if (!saUser || saUser.status !== 'active') {
      logger.info('Sign-in code requested', {
        context: 'auth-otp',
        email,
        outcome: saUser ? 'skipped_inactive' : 'skipped_unknown',
      });
      return;
    }
  }

  // Test-only: record the code so the env-guarded endpoint (Task 4) can return
  // it to the e2e suite. Synchronous so it is readable the moment the
  // send-verification-otp request resolves.
  if (isTest) store.set(email, otp);

  // Fire-and-forget the delivery (BetterAuth recommends not awaiting to avoid
  // timing attacks). Delivery failures are reported to Sentry inside
  // EmailService; a rejected promise here must not crash the request.
  void emailer
    .send({ to: email, ...signInCodeEmail({ otp, minutes: OTP_EXPIRY_MINUTES }) })
    .catch(() => {});

  logger.info('Sign-in code requested', { context: 'auth-otp', email, outcome: 'sent' });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @sassy-auth/auth-server exec jest src/auth/otp-sender.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Configure `emailOTP` and route the sender in `auth.config.ts`**

In `apps/auth-server/src/auth/auth.config.ts`, add imports near the top (with the Task 2 imports):

```typescript
import { getEmailer } from '../email/email.singleton';
import { sendSignInOtp } from './otp-sender';
import { otpTestStore } from './otp-test-store';
```

(Note: `getEmailer` is already imported in this file — do not duplicate. Verify before adding.)

Replace the current `emailOTP({ ... })` block (the one whose `sendVerificationOTP` does the dev-only `console.log`) with:

```typescript
    emailOTP({
      otpLength: 6,
      expiresIn: 300,
      allowedAttempts: 3,
      disableSignUp: true,
      rateLimit: { window: 60, max: 5 },
      sendVerificationOTP: async ({ email, otp, type }: { email: string; otp: string; type: string }) => {
        await sendSignInOtp(
          {
            db: prisma,
            emailer: getEmailer(),
            store: otpTestStore,
            logger: authLogger,
            isTest: process.env.NODE_ENV === 'test',
          },
          { email, otp, type },
        );
      },
    }),
```

Leave the `magicLink({ ... })` block unchanged (out of scope).

- [ ] **Step 7: Build to verify**

Run: `pnpm --filter @sassy-auth/db exec prisma generate --schema=schema.prisma && pnpm --filter @sassy-auth/db --filter @sassy-auth/types build && pnpm --filter @sassy-auth/auth-server build`
Expected: build succeeds.

- [ ] **Step 8: Commit**

```bash
git add apps/auth-server/src/auth/otp-test-store.ts apps/auth-server/src/auth/otp-sender.ts apps/auth-server/src/auth/otp-sender.spec.ts apps/auth-server/src/auth/auth.config.ts
git commit -m "feat(auth): route email-OTP sign-in through EmailService; configure OTP params + rate limit

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Env-guarded test-only OTP retrieval endpoint

**Files:**
- Create: `apps/auth-server/src/test-support/otp-test.controller.ts`
- Create: `apps/auth-server/src/test-support/otp-test.controller.spec.ts`
- Create: `apps/auth-server/src/test-support/test-support.module.ts`
- Modify: `apps/auth-server/src/app.module.ts` (conditional import)

**Interfaces:**
- Consumes: `otpTestStore` (Task 3).
- Produces: `GET /test/last-otp?email=<email>` → `{ otp: string }` (200) or 404. Handler throws `NotFoundException` unless `NODE_ENV === 'test'`.

- [ ] **Step 1: Write the failing test**

Create `apps/auth-server/src/test-support/otp-test.controller.spec.ts`:

```typescript
import { NotFoundException } from '@nestjs/common';
import { OtpTestController } from './otp-test.controller';
import { otpTestStore } from '../auth/otp-test-store';

describe('OtpTestController', () => {
  const controller = new OtpTestController();
  const OLD_ENV = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = OLD_ENV;
  });

  it('returns the stored otp in test env', () => {
    process.env.NODE_ENV = 'test';
    otpTestStore.set('u@x.com', '111222');
    expect(controller.lastOtp('u@x.com')).toEqual({ otp: '111222' });
  });

  it('404s when the email has no stored otp', () => {
    process.env.NODE_ENV = 'test';
    expect(() => controller.lastOtp('nobody@x.com')).toThrow(NotFoundException);
  });

  it('404s in non-test env even if a code is stored', () => {
    process.env.NODE_ENV = 'production';
    otpTestStore.set('u@x.com', '111222');
    expect(() => controller.lastOtp('u@x.com')).toThrow(NotFoundException);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sassy-auth/auth-server exec jest src/test-support/otp-test.controller.spec.ts`
Expected: FAIL — cannot find module `./otp-test.controller`.

- [ ] **Step 3: Implement the controller**

Create `apps/auth-server/src/test-support/otp-test.controller.ts`:

```typescript
import { Controller, Get, NotFoundException, Query } from '@nestjs/common';
import { otpTestStore } from '../auth/otp-test-store';

/**
 * TEST-ONLY. Returns the last OTP issued to an email so the e2e suite can
 * complete a real passwordless sign-in. Every handler hard-fails with 404
 * unless NODE_ENV === 'test', and the module is only registered in test env
 * (Task 4 app.module wiring) — belt and suspenders so it can never exist in
 * production.
 */
@Controller('test')
export class OtpTestController {
  @Get('last-otp')
  lastOtp(@Query('email') email: string): { otp: string } {
    if (process.env.NODE_ENV !== 'test') throw new NotFoundException();
    const otp = email ? otpTestStore.get(email) : undefined;
    if (!otp) throw new NotFoundException();
    return { otp };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sassy-auth/auth-server exec jest src/test-support/otp-test.controller.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Create the module and register it conditionally**

Create `apps/auth-server/src/test-support/test-support.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { OtpTestController } from './otp-test.controller';

@Module({ controllers: [OtpTestController] })
export class TestSupportModule {}
```

In `apps/auth-server/src/app.module.ts`, add the conditional import. Near the top (after the other imports) add:

```typescript
import { TestSupportModule } from './test-support/test-support.module';
```

Then change the `imports` array so the test module is only present in test env. Replace the `imports: [ ... EmailModule, ]` array's closing so it reads:

```typescript
  imports: [
    SentryModule.forRoot(),
    ThrottlerModule.forRoot(throttlerConfig),
    CommonModule,
    AuthModule,
    TokenModule,
    UsersModule,
    InvitationsModule,
    OrgsModule,
    RolesModule,
    AppsModule,
    PermissionsModule,
    MeModule,
    RegistrationModule,
    EmailModule,
    ...(process.env.NODE_ENV === 'test' ? [TestSupportModule] : []),
  ],
```

- [ ] **Step 6: Build + run the module's tests**

Run: `pnpm --filter @sassy-auth/db exec prisma generate --schema=schema.prisma && pnpm --filter @sassy-auth/db --filter @sassy-auth/types build && pnpm --filter @sassy-auth/auth-server build`
Expected: build succeeds.
Run: `pnpm --filter @sassy-auth/auth-server exec jest src/test-support`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/auth-server/src/test-support/ apps/auth-server/src/app.module.ts
git commit -m "test(auth): env-guarded test-only endpoint to retrieve the last sign-in OTP

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Admin server actions (requestOtp + verifyOtp)

**Files:**
- Modify: `apps/admin/app/login/actions.ts`

**Interfaces:**
- Consumes: existing `parseSessionCookie`, `getForwardedOrigin`, `AUTH_SERVER_URL`, `validateNextUrl`, `cookies`, `redirect`, `Sentry` (all already imported in this file).
- Produces:
  - `forwardSessionCookie(res: Response): Promise<boolean>` — parses+sets the session cookie from a 2xx auth-server response; returns `false` if the header is missing/unparseable. (Extracted from the tail of `signIn`; `signIn` is refactored to call it.)
  - `requestOtp(formData: FormData): Promise<{ sent: true } | { error: string }>` — enumeration-neutral.
  - `verifyOtp(formData: FormData): Promise<{ error?: string }>` — sets cookie + `redirect` on success.

- [ ] **Step 1: Extract the shared cookie-forwarding helper**

In `apps/admin/app/login/actions.ts`, add this function above `signIn` (it captures the exact block `signIn` currently uses):

```typescript
async function forwardSessionCookie(res: Response): Promise<boolean> {
  const cookieStore = await cookies()
  const setCookieHeader = res.headers.get('set-cookie')
  if (!setCookieHeader) {
    Sentry.captureMessage('Auth server returned 200 but no Set-Cookie header', { level: 'error' })
    return false
  }
  const parsed = parseSessionCookie(setCookieHeader)
  if (!parsed) {
    Sentry.captureMessage('Failed to parse session cookie from auth server response', { level: 'error' })
    return false
  }
  cookieStore.set('better-auth.session_token', parsed.value, {
    httpOnly: parsed.httpOnly,
    secure: parsed.secure ?? process.env.NODE_ENV === 'production',
    sameSite: parsed.sameSite ?? 'lax',
    path: parsed.path ?? '/',
    ...(parsed.maxAge !== undefined && { maxAge: parsed.maxAge }),
    ...(parsed.expires !== undefined && { expires: parsed.expires }),
    ...(parsed.domain !== undefined && { domain: parsed.domain }),
  })
  return true
}
```

Then in `signIn`, replace everything from `const cookieStore = await cookies()` down to the `cookieStore.set(...)` call (the inline cookie block) with:

```typescript
  const ok = await forwardSessionCookie(res)
  if (!ok) return { error: 'invalidCredentials' }
```

Leave the subsequent `Sentry.addBreadcrumb('Admin login successful')` + `redirect(...)` lines in `signIn` unchanged.

- [ ] **Step 2: Add `requestOtp` (enumeration-neutral)**

Append to `apps/admin/app/login/actions.ts`:

```typescript
export async function requestOtp(formData: FormData): Promise<{ sent: true } | { error: string }> {
  const email = formData.get('email') as string
  if (!email) return { error: 'invalidCredentials' }

  const origin = await getForwardedOrigin()
  try {
    // Fire the request; the response status is intentionally ignored for the
    // client result. Whether the account exists/is active or not, the caller
    // gets a neutral { sent: true } (no user enumeration). Only a transport
    // failure is surfaced, so the operator knows to retry.
    await fetch(`${AUTH_SERVER_URL}/api/auth/email-otp/send-verification-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(origin && { Origin: origin }) },
      body: JSON.stringify({ email, type: 'sign-in' }),
    })
  } catch (err) {
    Sentry.captureException(err, { tags: { area: 'auth', action: 'otp-request' } })
    return { error: 'serverUnavailable' }
  }
  return { sent: true }
}
```

- [ ] **Step 3: Add `verifyOtp`**

Append to `apps/admin/app/login/actions.ts`:

```typescript
export async function verifyOtp(formData: FormData): Promise<{ error?: string }> {
  const email = formData.get('email') as string
  const otp = formData.get('otp') as string
  if (!email || !otp) return { error: 'invalidCode' }

  const origin = await getForwardedOrigin()
  let res: Response
  try {
    res = await fetch(`${AUTH_SERVER_URL}/api/auth/sign-in/email-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(origin && { Origin: origin }) },
      body: JSON.stringify({ email, otp }),
    })
  } catch (err) {
    Sentry.captureException(err, { tags: { area: 'auth', action: 'otp-verify' } })
    return { error: 'serverUnavailable' }
  }

  if (!res.ok) {
    Sentry.addBreadcrumb({ category: 'auth', message: 'Admin OTP login failed', level: 'warning' })
    // The session-creation gate rejects non-active users with 403 → inactive.
    if (res.status === 403) return { error: 'inactive' }
    return { error: 'invalidCode' }
  }

  const ok = await forwardSessionCookie(res)
  if (!ok) return { error: 'invalidCode' }

  Sentry.addBreadcrumb({ category: 'auth', message: 'Admin OTP login successful', level: 'info' })
  const nextRaw = formData.get('next')
  const nextSafe = typeof nextRaw === 'string' ? validateNextUrl(nextRaw) : null
  redirect(nextSafe ?? '/users')
}
```

- [ ] **Step 4: Build to verify types/compile**

Run: `pnpm --filter @sassy-auth/admin build`
Expected: build succeeds. (Server actions have no unit tests in this repo — functional coverage is the Task 7 e2e, matching how `signIn` is covered.)

- [ ] **Step 5: Commit**

```bash
git add apps/admin/app/login/actions.ts
git commit -m "feat(admin): requestOtp + verifyOtp server actions; extract shared cookie forwarder

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Admin OTP login form, route, link, and i18n

**Files:**
- Create: `apps/admin/app/login/login-otp-form.tsx`
- Create: `apps/admin/app/login/code/page.tsx`
- Modify: `apps/admin/app/login/login-form.tsx` (add link)
- Modify: `apps/admin/messages/en.json`, `apps/admin/messages/fr.json`

**Interfaces:**
- Consumes: `requestOtp`, `verifyOtp` (Task 5).
- Produces: `LoginOtpForm({ next }: { next: string })` default-exported-as-named client component; route `/login/code`.

- [ ] **Step 1: Add i18n keys (en)**

In `apps/admin/messages/en.json`, under `"login"`, add `"useCode"` and an `"otp"` block, and add `"invalidCode"` under `login.error`:

```json
    "useCode": "Sign in with a code instead",
    "otp": {
      "title": "Sign in with a code",
      "subtitle": "We'll email you a one-time code",
      "sendCode": "Send code",
      "codeLabel": "Verification code",
      "verify": "Verify",
      "resend": "Resend code",
      "changeEmail": "Use a different email",
      "sent": "If an account exists for that email, a code is on its way.",
      "usePassword": "Sign in with a password instead"
    }
```

And inside the existing `"login.error"` object add:

```json
      "invalidCode": "Invalid or expired code."
```

- [ ] **Step 2: Add i18n keys (fr)**

In `apps/admin/messages/fr.json`, under `"login"`, add the mirror keys:

```json
    "useCode": "Se connecter avec un code",
    "otp": {
      "title": "Connexion par code",
      "subtitle": "Nous vous enverrons un code à usage unique par e-mail",
      "sendCode": "Envoyer le code",
      "codeLabel": "Code de vérification",
      "verify": "Vérifier",
      "resend": "Renvoyer le code",
      "changeEmail": "Utiliser une autre adresse",
      "sent": "Si un compte existe pour cette adresse, un code est en route.",
      "usePassword": "Se connecter avec un mot de passe"
    }
```

And under `"login.error"`:

```json
      "invalidCode": "Code invalide ou expiré."
```

- [ ] **Step 3: Create the two-step OTP form**

Create `apps/admin/app/login/login-otp-form.tsx`:

```tsx
'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { useActionState } from 'react'
import { Button } from '@sassy-auth/ui'
import { requestOtp, verifyOtp } from './actions'

const inputClass =
  'flex h-9 w-full rounded border border-[var(--border)] bg-[var(--card)] px-3 text-body-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]'

export function LoginOtpForm({ next }: { next: string }) {
  const t = useTranslations('login')
  const [email, setEmail] = useState('')
  const [step, setStep] = useState<'email' | 'code'>('email')

  const [reqState, requestAction, reqPending] = useActionState(
    async (_prev: { sent?: true; error?: string }, formData: FormData) => {
      const res = await requestOtp(formData)
      if ('sent' in res) setStep('code')
      return res
    },
    {},
  )

  const [verifyState, verifyActionFn, verifyPending] = useActionState(
    async (_prev: { error?: string }, formData: FormData) => verifyOtp(formData),
    {},
  )

  const errKey = (e?: string) =>
    e === 'invalidCode' || e === 'inactive' || e === 'serverUnavailable' ? t(`error.${e}`) : e

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--background)]">
      <div className="w-full max-w-sm rounded-lg border border-[var(--border)] bg-[var(--card)] p-8 shadow-sm">
        <div className="mb-6 text-center">
          <h1 className="text-headline-sm text-[var(--foreground)]">{t('otp.title')}</h1>
          <p className="mt-1 text-body-sm text-[var(--muted-foreground)]">{t('otp.subtitle')}</p>
        </div>

        {step === 'email' ? (
          <form action={requestAction} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-label-md font-semibold" htmlFor="email">{t('email')}</label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
              />
            </div>
            {reqState?.error && (
              <p data-testid="otp-error" className="text-label-md text-[var(--destructive)]">{errKey(reqState.error)}</p>
            )}
            <Button type="submit" className="w-full" loading={reqPending}>{t('otp.sendCode')}</Button>
            <Link href="/login" className="text-label-md text-[var(--primary)] hover:underline self-center">
              {t('otp.usePassword')}
            </Link>
          </form>
        ) : (
          <form action={verifyActionFn} className="flex flex-col gap-4">
            <input type="hidden" name="next" value={next} />
            <input type="hidden" name="email" value={email} />
            <p data-testid="otp-sent" className="text-body-sm text-[var(--muted-foreground)]">{t('otp.sent')}</p>
            <div className="flex flex-col gap-1.5">
              <label className="text-label-md font-semibold" htmlFor="otp">{t('otp.codeLabel')}</label>
              <input
                id="otp"
                name="otp"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                className={inputClass}
              />
            </div>
            {verifyState?.error && (
              <p data-testid="otp-error" className="text-label-md text-[var(--destructive)]">{errKey(verifyState.error)}</p>
            )}
            <Button type="submit" className="w-full" loading={verifyPending}>{t('otp.verify')}</Button>
            <button
              type="button"
              onClick={() => setStep('email')}
              className="text-label-md text-[var(--primary)] hover:underline self-center"
            >
              {t('otp.changeEmail')}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Create the `/login/code` route**

Create `apps/admin/app/login/code/page.tsx`:

```tsx
import { validateNextUrl } from '@/lib/safe-next'
import { LoginOtpForm } from '../login-otp-form'

export const dynamic = 'force-dynamic'

export default async function LoginCodePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const params = await searchParams
  const nextSafe = validateNextUrl(params.next)
  return <LoginOtpForm next={nextSafe ?? ''} />
}
```

- [ ] **Step 5: Link to the OTP flow from the password form**

In `apps/admin/app/login/login-form.tsx`, directly after the existing `Forgot password?` `<Link>` (the one with `href="/forgot-password"`), add a second link:

```tsx
          <Link
            href={next ? `/login/code?next=${encodeURIComponent(next)}` : '/login/code'}
            className="text-label-md text-[var(--primary)] hover:underline self-end"
          >
            {t('useCode')}
          </Link>
```

- [ ] **Step 6: Build to verify**

Run: `pnpm --filter @sassy-auth/admin build`
Expected: build succeeds (no missing i18n keys, no type errors).

- [ ] **Step 7: Commit**

```bash
git add apps/admin/app/login/login-otp-form.tsx apps/admin/app/login/code/page.tsx apps/admin/app/login/login-form.tsx apps/admin/messages/en.json apps/admin/messages/fr.json
git commit -m "feat(admin): two-step email-OTP login form + /login/code route

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: E2E — happy path, wrong code, deactivated blocked

**Files:**
- Modify: `apps/admin-e2e/pages/login.page.ts` (create if absent — check first)
- Create: `apps/admin-e2e/tests/matrix/otp-signin.spec.ts` (place beside existing matrix specs; adjust dir to match repo layout)

**Interfaces:**
- Consumes: the auth-server test endpoint `GET /test/last-otp?email=` (Task 4), the `requestOtp`/`verifyOtp` UI (Tasks 5/6), existing e2e seed users + `t()` i18n helper.

- [ ] **Step 1: Inspect existing e2e conventions**

Run: `ls apps/admin-e2e/pages apps/admin-e2e/tests && sed -n '1,40p' apps/admin-e2e/tests/matrix/users.matrix.spec.ts`
Expected: learn the base-URL/fixture/auth-server-URL and seed-user conventions (e.g. how tests reach an active admin email + a deactivated email, and the env var holding the auth-server URL). Use those exact conventions below.

- [ ] **Step 2: Add a login page object with OTP helpers**

Create or extend `apps/admin-e2e/pages/login.page.ts`:

```typescript
import { expect, type Page } from '@playwright/test'
import { t } from '../lib/i18n'

// Auth-server base URL for the test-only OTP retrieval endpoint. Reuse the
// same env the suite already uses to reach the auth server (confirm the name
// in Step 1; AUTH_SERVER_URL shown here as the documented default).
const AUTH_SERVER = process.env.AUTH_SERVER_URL ?? 'http://localhost:3000'

export class LoginPage {
  constructor(private readonly page: Page) {}

  async gotoOtp(next = '') {
    await this.page.goto(next ? `/login/code?next=${encodeURIComponent(next)}` : '/login/code')
  }

  async requestCode(email: string) {
    await this.page.getByLabel(t('login.email')).fill(email)
    await this.page.getByRole('button', { name: t('login.otp.sendCode') }).click()
    // Step 2 renders once the neutral response returns.
    await expect(this.page.getByTestId('otp-sent')).toBeVisible()
  }

  async fetchOtp(email: string): Promise<string> {
    const res = await this.page.request.get(
      `${AUTH_SERVER}/test/last-otp?email=${encodeURIComponent(email)}`,
    )
    expect(res.ok(), 'test-only OTP endpoint should return the stored code').toBeTruthy()
    return ((await res.json()) as { otp: string }).otp
  }

  async submitCode(otp: string) {
    await this.page.getByLabel(t('login.otp.codeLabel')).fill(otp)
    await this.page.getByRole('button', { name: t('login.otp.verify') }).click()
  }
}
```

- [ ] **Step 3: Write the happy-path test (real end-to-end sign-in)**

Create `apps/admin-e2e/tests/matrix/otp-signin.spec.ts`:

```typescript
import { test, expect } from '@playwright/test'
import { LoginPage } from '../../pages/login.page'

// Replace ACTIVE_ADMIN_EMAIL / DEACTIVATED_EMAIL with the suite's seeded
// fixtures discovered in Step 1 (an active console admin, and a deactivated
// user). Keep this test independent of shared logged-in state.
const ACTIVE_ADMIN_EMAIL = 'admin@example.com'
const DEACTIVATED_EMAIL = 'deactivated@example.com'

test.describe('email-OTP sign-in', () => {
  test('active user signs in with an emailed code', async ({ page }) => {
    const login = new LoginPage(page)
    await login.gotoOtp()
    await login.requestCode(ACTIVE_ADMIN_EMAIL)
    const otp = await login.fetchOtp(ACTIVE_ADMIN_EMAIL)
    await login.submitCode(otp)
    // On success verifyOtp redirects to /users.
    await expect(page).toHaveURL(/\/users/)
  })
})
```

- [ ] **Step 4: Run the happy-path test**

Run: `pnpm --filter @sassy-auth/admin-e2e test:e2e -- otp-signin.spec.ts -g "active user signs in"`
Expected: PASS (code fetched via the test endpoint, redirected to `/users`).

- [ ] **Step 5: Add wrong-code + deactivated-blocked tests**

Append to `apps/admin-e2e/tests/matrix/otp-signin.spec.ts` inside the `describe`:

```typescript
  test('a wrong code is rejected', async ({ page }) => {
    const login = new LoginPage(page)
    await login.gotoOtp()
    await login.requestCode(ACTIVE_ADMIN_EMAIL)
    await login.submitCode('000000')
    await expect(page.getByTestId('otp-error')).toBeVisible()
    await expect(page).not.toHaveURL(/\/users/)
  })

  test('a deactivated user is blocked even with a correct code', async ({ page }) => {
    const login = new LoginPage(page)
    await login.gotoOtp()
    // Neutral UI: requesting a code always advances to step 2. The sender
    // skips delivery for non-active users, so no code is stored — assert the
    // block via the gate rather than a fetched code. If the suite exposes a
    // way to force a code for this case, submit it and assert the inactive
    // error; otherwise assert no code was issued (delivery was skipped).
    await login.requestCode(DEACTIVATED_EMAIL)
    const res = await page.request.get(
      `${process.env.AUTH_SERVER_URL ?? 'http://localhost:3000'}/test/last-otp?email=${encodeURIComponent(DEACTIVATED_EMAIL)}`,
    )
    expect(res.status(), 'no code should be issued to a deactivated user').toBe(404)
  })
```

- [ ] **Step 6: Run the full OTP e2e file**

Run: `pnpm --filter @sassy-auth/admin-e2e test:e2e -- otp-signin.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add apps/admin-e2e/pages/login.page.ts apps/admin-e2e/tests/matrix/otp-signin.spec.ts
git commit -m "test(e2e): email-OTP sign-in happy path, wrong code, deactivated blocked

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Notes for the executor (deliberate design decisions)

- **Verify-side observability** (spec Section 7 "Sign-in via code succeeded/rejected") is realized at the admin action layer as Sentry breadcrumbs (`verifyOtp`, Task 5), because the verify endpoint (`/api/auth/sign-in/email-otp`) is handled by BetterAuth outside Nest's DI/logging. The server-side Winston events that CAN be reliably emitted — the gate `warn` (Task 2) and the request `info` with `outcome` (Task 3) — are implemented as structured logs. This is a faithful adaptation, not a gap.
- **`skipped_unknown` vs `skipped_inactive`:** with `disableSignUp: true`, BetterAuth may reject unknown emails before calling `sendVerificationOTP`; the admin action's neutral response hides this from the client either way. The sender still handles both outcomes (Task 3 tests cover them) for the case where the sender is invoked.
- **Enumeration neutrality lives in the admin `requestOtp` action** (always `{ sent: true }`), not in BetterAuth — do not "fix" `requestOtp` to surface auth-server errors.
- **The 403→inactive mapping** depends on `APIError('FORBIDDEN')` propagating from the gate hook. Task 7's deactivated-blocked e2e is the end-to-end check; if BetterAuth surfaces a different status, adjust the `verifyOtp`/`signIn` status mapping accordingly (and note it), rather than weakening the gate.

## Self-Review

**Spec coverage:**
- Status gate (Section 1) → Task 2. ✅
- OTP email via EmailService (Section 2) → Tasks 1 + 3. ✅
- Admin actions + two-step form (Section 3) → Tasks 5 + 6. ✅
- OTP config: otpLength/expiresIn/allowedAttempts/disableSignUp (Section 4) → Task 3. ✅
- Rate limiting (Section 5) → Task 3 (`emailOTP.rateLimit`, since Nest throttler can't reach `/api/auth/*`). ✅
- Testing incl. env-guarded test-only endpoint (Section 6) → Task 4 + Task 7. ✅
- Observability table (Section 7) → gate warn (Task 2), request info/outcome (Task 3), verify breadcrumbs (Task 5); OTP value never logged (Task 3 test asserts it). ✅
- Non-goal: magic-link untouched → explicitly preserved (Task 3 Step 6). ✅

**Placeholder scan:** No TBD/TODO; every code step has complete code. E2E seed emails and the auth-server env-var name are flagged for confirmation in Task 7 Step 1 (repo-specific values the executor reads from existing specs), which is a discovery step, not a placeholder in logic.

**Type consistency:** `evaluateSessionGate(db, userId)` uses `findUnique` (betterAuthUserId is `@unique`); `sendSignInOtp` uses `findFirst` by `betterAuthUser.email`. `signInCodeEmail({ otp, minutes })` signature identical across Tasks 1 and 3. `forwardSessionCookie(res): Promise<boolean>` defined once (Task 5 Step 1) and consumed by `signIn` + `verifyOtp`. i18n keys referenced in Task 6 form (`login.otp.*`, `login.useCode`, `login.error.invalidCode`) all added in Steps 1–2.
