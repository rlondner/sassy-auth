# 2FA Per-App Enforcement (2b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a `SaApp` require 2FA, force enrollment at the OAuth authorize step, enforce 2FA on the non-interactive `direct/login` path, and signal 2FA to resource servers via a JWT `amr` claim.

**Architecture:** A single resolver `isTwoFactorRequired(app)` (per-app column OR a platform env flag) is the source of truth. The authorize handler redirects active-but-unenrolled users into the existing 2a enrollment page and back. The resolved `amr` is stamped onto the `SaOauthCode` row at authorize and read at token exchange, so the decoupled `issueJwt` can emit it. `direct/login` verifies an optional `totpCode` session-less using better-auth's own crypto primitives.

**Tech Stack:** NestJS (auth-server), Prisma, better-auth 1.6.11 (`twoFactor` plugin, `symmetricDecrypt` from `better-auth/crypto`, `createOTP` from `@better-auth/utils/otp`), Next.js App Router (admin), Jest, Playwright, `otplib` (test-only TOTP computation).

## Global Constraints

- TOTP params are fixed at **6 digits / 30s period / SHA1** (better-auth defaults; Google Authenticator/Authy/1Password compatibility). Copy these exact values wherever TOTP is verified or computed.
- **Never log** TOTP secrets, `otpauth` URIs, backup codes, or entered codes (including the `direct/login` `totpCode`). Same bearer-credential posture as the rest of the token controller.
- `amr` values use RFC 8176 tokens: `["pwd","otp","mfa"]` when 2FA satisfied, `["pwd"]` otherwise. When empty, **omit** the claim (never emit `[]`).
- "Required" always means the **effective** value: `app.requireTwoFactor || (app.isPlatform && PLATFORM_REQUIRE_2FA)`. Never read `app.requireTwoFactor` directly at an enforcement site — always go through `isTwoFactorRequired(app)`.
- Follow existing patterns: env resolvers mirror `apps/auth-server/src/auth/resolve-trust-days.ts`; Winston logging via `this.logger.getWinstonLogger()`; error codes from `@sassy-auth/types` `TokenErrorCode`.
- Prisma migrations: use `pnpm --filter @sassy-auth/db exec prisma migrate dev --name <name>` (matches how 2a's `twoFactorTrustDays` migration was produced).

---

### Task 1: Schema — `SaApp.requireTwoFactor` + `SaOauthCode.amr`

**Files:**
- Modify: `packages/db/schema.prisma` (SaApp model ~line 98–109; SaOauthCode model ~line 248–259)
- Migration: generated under `packages/db/prisma/migrations/`

**Interfaces:**
- Produces: `SaApp.requireTwoFactor: boolean` (default false); `SaOauthCode.amr: string` (JSON-encoded `string[]`, default `["pwd"]`).

- [ ] **Step 1: Add the SaApp column**

In `packages/db/schema.prisma`, inside `model SaApp`, add after the `twoFactorTrustDays` line:

```prisma
  requireTwoFactor   Boolean        @default(false)
```

- [ ] **Step 2: Add the SaOauthCode column**

In `model SaOauthCode`, add after `codeChallengeMethod String`:

```prisma
  amr                 String   @default("[\"pwd\"]")
```

(JSON string; existing/in-flight codes minted before the migration default to `["pwd"]`, i.e. no MFA — the safe default.)

- [ ] **Step 3: Generate the migration**

Run: `pnpm --filter @sassy-auth/db exec prisma migrate dev --name 2fa-enforcement-2b`
Expected: a new migration folder is created and `prisma generate` regenerates the client with the two new fields.

- [ ] **Step 4: Verify the client types**

Run: `pnpm --filter @sassy-auth/db exec prisma validate`
Expected: "The schema at packages/db/schema.prisma is valid 🚀"

- [ ] **Step 5: Commit**

```bash
git add packages/db/schema.prisma packages/db/prisma/migrations
git commit -m "feat(db): SaApp.requireTwoFactor + SaOauthCode.amr for 2FA enforcement (2b)"
```

---

### Task 2: `isTwoFactorRequired(app)` resolver + `PLATFORM_REQUIRE_2FA`

**Files:**
- Create: `apps/auth-server/src/auth/two-factor-required.ts`
- Test: `apps/auth-server/src/auth/two-factor-required.spec.ts`

**Interfaces:**
- Produces: `isTwoFactorRequired(app: { requireTwoFactor: boolean; isPlatform: boolean }): boolean` and `isPlatformTwoFactorRequired(): boolean`.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/auth-server/src/auth/two-factor-required.spec.ts
import { isTwoFactorRequired, isPlatformTwoFactorRequired } from './two-factor-required';

describe('isTwoFactorRequired', () => {
  const OLD = process.env.PLATFORM_REQUIRE_2FA;
  afterEach(() => { process.env.PLATFORM_REQUIRE_2FA = OLD; });

  it('honors the per-app flag for non-platform apps', () => {
    expect(isTwoFactorRequired({ requireTwoFactor: true, isPlatform: false })).toBe(true);
    expect(isTwoFactorRequired({ requireTwoFactor: false, isPlatform: false })).toBe(false);
  });

  it('requires 2FA for the platform app only when the env flag is on', () => {
    process.env.PLATFORM_REQUIRE_2FA = 'true';
    expect(isTwoFactorRequired({ requireTwoFactor: false, isPlatform: true })).toBe(true);
    process.env.PLATFORM_REQUIRE_2FA = 'false';
    expect(isTwoFactorRequired({ requireTwoFactor: false, isPlatform: true })).toBe(false);
    delete process.env.PLATFORM_REQUIRE_2FA;
    expect(isTwoFactorRequired({ requireTwoFactor: false, isPlatform: true })).toBe(false);
  });

  it('isPlatformTwoFactorRequired reads only the env flag', () => {
    process.env.PLATFORM_REQUIRE_2FA = '1';
    expect(isPlatformTwoFactorRequired()).toBe(false); // only "true" (case-insensitive) counts
    process.env.PLATFORM_REQUIRE_2FA = 'TRUE';
    expect(isPlatformTwoFactorRequired()).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @sassy-auth/auth-server exec jest two-factor-required -c jest.config.js`
Expected: FAIL — "Cannot find module './two-factor-required'".

- [ ] **Step 3: Implement the resolver**

```typescript
// apps/auth-server/src/auth/two-factor-required.ts
/**
 * Effective 2FA-required resolution for an app.
 *
 * Non-platform apps use their own SaApp.requireTwoFactor column. The platform
 * app is immutable through the app UI, so its enforcement is an out-of-band
 * operational decision via the PLATFORM_REQUIRE_2FA env flag (default off).
 *
 * Only the exact string "true" (case-insensitive) enables it — any other value
 * is treated as off, so a stray "1"/"yes" never silently locks out operators.
 */
export function isPlatformTwoFactorRequired(): boolean {
  return (process.env['PLATFORM_REQUIRE_2FA'] ?? '').toLowerCase() === 'true';
}

export function isTwoFactorRequired(app: {
  requireTwoFactor: boolean;
  isPlatform: boolean;
}): boolean {
  if (app.requireTwoFactor) return true;
  return app.isPlatform && isPlatformTwoFactorRequired();
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @sassy-auth/auth-server exec jest two-factor-required -c jest.config.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/auth/two-factor-required.ts apps/auth-server/src/auth/two-factor-required.spec.ts
git commit -m "feat(2fa): isTwoFactorRequired resolver + PLATFORM_REQUIRE_2FA flag"
```

---

### Task 3: `verifyUserTotp` — session-less TOTP verification

**Files:**
- Create: `apps/auth-server/src/auth/verify-user-totp.ts`
- Test: `apps/auth-server/src/auth/verify-user-totp.spec.ts`
- Modify: `apps/auth-server/package.json` (add `otplib` to `devDependencies`)

**Interfaces:**
- Consumes: `prisma.twoFactor` (from Task 1's client), `BETTER_AUTH_SECRET` env.
- Produces: `verifyUserTotp(betterAuthUserId: string, code: string): Promise<boolean>`.

- [ ] **Step 1: Add the test-only TOTP dependency**

Run: `pnpm --filter @sassy-auth/auth-server add -D otplib`
Expected: `otplib` appears under `devDependencies` in `apps/auth-server/package.json`.

- [ ] **Step 2: Write the failing test**

**Hermetic unit test (no DB).** The auth-server unit suite mocks Prisma and has no database, so do NOT enroll via live better-auth here. Instead, encrypt a known base32 secret with better-auth's own `symmetricEncrypt` under `BETTER_AUTH_SECRET` (exactly how the plugin stores it), stub `prisma.twoFactor.findUnique` to return that row, and compute the code with `otplib`. This exercises the real `symmetricDecrypt` → `createOTP().verify()` round-trip and the base32-secret compatibility between `otplib` and `@better-auth/utils`, all in-process. (The remaining assumption — that `BETTER_AUTH_SECRET` equals better-auth's runtime `secretConfig` for a *genuinely* enrolled user — is guarded by the direct/login e2e in Task 12.)

Follow the repo's existing Prisma-mock pattern (the auth-server specs already mock `@sassy-auth/db`; reuse that mock style rather than inventing one).

```typescript
// apps/auth-server/src/auth/verify-user-totp.spec.ts
import { authenticator } from 'otplib';
import { symmetricEncrypt } from 'better-auth/crypto';
import { prisma } from '@sassy-auth/db';
import { verifyUserTotp } from './verify-user-totp';

jest.mock('@sassy-auth/db', () => ({
  prisma: { twoFactor: { findUnique: jest.fn() } },
}));

const findUnique = prisma.twoFactor.findUnique as jest.Mock;

describe('verifyUserTotp', () => {
  const OLD = process.env.BETTER_AUTH_SECRET;
  beforeAll(() => { process.env.BETTER_AUTH_SECRET = 'test-secret-32-chars-min-aaaaaaaa'; });
  afterAll(() => { process.env.BETTER_AUTH_SECRET = OLD; });

  it('accepts a valid code and rejects a wrong one', async () => {
    const secret = authenticator.generateSecret(); // base32
    const stored = await symmetricEncrypt({ key: process.env.BETTER_AUTH_SECRET!, data: secret });
    findUnique.mockResolvedValue({ userId: 'ba_1', secret: stored, backupCodes: '', verified: true });

    const good = authenticator.generate(secret);
    expect(await verifyUserTotp('ba_1', good)).toBe(true);
    expect(await verifyUserTotp('ba_1', '000000')).toBe(false);
  });

  it('returns false when the user has no TwoFactor row', async () => {
    findUnique.mockResolvedValue(null);
    expect(await verifyUserTotp('ba_missing', '123456')).toBe(false);
  });
});
```

> The assertion `verifyUserTotp('ba_1', good) === true` proves the `symmetricEncrypt`/`symmetricDecrypt` round-trip and that `otplib`'s base32 secret verifies under `@better-auth/utils`'s `createOTP`. If it fails on secret encoding, do not weaken the assertion — adjust how the secret is generated to match what better-auth's enrollment stores (base32), and confirm against Task 12's live e2e.

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter @sassy-auth/auth-server exec jest verify-user-totp -c jest.config.js`
Expected: FAIL — "Cannot find module './verify-user-totp'".

- [ ] **Step 4: Implement the helper**

```typescript
// apps/auth-server/src/auth/verify-user-totp.ts
import { prisma } from '@sassy-auth/db';
import { symmetricDecrypt } from 'better-auth/crypto';
import { createOTP } from '@better-auth/utils/otp';

/**
 * Session-less TOTP verification for the direct/login path.
 *
 * Mirrors better-auth's own /two-factor/verify-totp endpoint internals: read the
 * user's TwoFactor row, decrypt the secret with the app secret, and verify the
 * code with the same 6-digit / 30s parameters. No session or temp cookie needed.
 *
 * Never logs the secret or the entered code.
 */
export async function verifyUserTotp(betterAuthUserId: string, code: string): Promise<boolean> {
  const tf = await prisma.twoFactor.findUnique({ where: { userId: betterAuthUserId } });
  if (!tf) return false;
  const secret = await symmetricDecrypt({
    key: process.env.BETTER_AUTH_SECRET!,
    data: tf.secret,
  });
  return createOTP(secret, { period: 30, digits: 6 }).verify(code);
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `pnpm --filter @sassy-auth/auth-server exec jest verify-user-totp -c jest.config.js`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/auth-server/src/auth/verify-user-totp.ts apps/auth-server/src/auth/verify-user-totp.spec.ts apps/auth-server/package.json ../../pnpm-lock.yaml
git commit -m "feat(2fa): session-less verifyUserTotp helper for direct/login"
```

---

### Task 4: OauthService carries `amr` on the code

**Files:**
- Modify: `apps/auth-server/src/token/oauth.service.ts` (`generateCode` ~line 40–60; `exchangeCode` ~line 62–113)
- Test: `apps/auth-server/src/token/oauth.service.spec.ts` (existing)

**Interfaces:**
- Consumes: `SaOauthCode.amr` (Task 1).
- Produces: `generateCode(userId, appPublicId, redirectUri, codeChallenge, method, amr: string[])`; `exchangeCode(...)` return type gains `amr: string[]`.

- [ ] **Step 1: Write the failing test**

Add to `apps/auth-server/src/token/oauth.service.spec.ts`:

```typescript
it('round-trips amr from generateCode to exchangeCode', async () => {
  const svc = new OauthService();
  const verifier = 'a'.repeat(64);
  const challenge = require('crypto').createHash('sha256').update(verifier)
    .digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const code = await svc.generateCode('u_pub', 'a_pub', 'https://rs.example/cb', challenge, 'S256', ['pwd', 'otp', 'mfa']);
  const out = await svc.exchangeCode(code, 'a_pub', 'https://rs.example/cb', verifier);
  expect(out.amr).toEqual(['pwd', 'otp', 'mfa']);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @sassy-auth/auth-server exec jest oauth.service -c jest.config.js`
Expected: FAIL — `generateCode` expects 5 args / `out.amr` is undefined.

- [ ] **Step 3: Implement — generateCode**

In `generateCode`, add the parameter and persist it:

```typescript
  async generateCode(
    userId: string,
    appPublicId: string,
    redirectUri: string,
    codeChallenge: string,
    codeChallengeMethod: 'S256',
    amr: string[],
  ): Promise<string> {
    const code = crypto.randomBytes(32).toString('hex');
    await prisma.saOauthCode.create({
      data: {
        code,
        userId,
        appPublicId,
        redirectUri,
        codeChallenge,
        codeChallengeMethod,
        amr: JSON.stringify(amr),
        expiresAt: new Date(Date.now() + CODE_TTL_MS),
      },
    });
    return code;
  }
```

- [ ] **Step 4: Implement — exchangeCode**

Add `amr: string` to the destructured `entry` type, and return the parsed array. At the `return` (line ~112):

```typescript
    return {
      userId: entry.userId,
      appPublicId: entry.appPublicId,
      amr: safeParseAmr(entry.amr),
    };
```

Add the type field (in the `entry` type annotation add `amr: string;`) and a private helper at the bottom of the file:

```typescript
function safeParseAmr(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : ['pwd'];
  } catch {
    return ['pwd'];
  }
}
```

Update the method's return type to `Promise<{ userId: string; appPublicId: string; amr: string[] }>`.

- [ ] **Step 5: Run it to verify it passes**

Run: `pnpm --filter @sassy-auth/auth-server exec jest oauth.service -c jest.config.js`
Expected: PASS (existing tests + the new round-trip).

- [ ] **Step 6: Commit**

```bash
git add apps/auth-server/src/token/oauth.service.ts apps/auth-server/src/token/oauth.service.spec.ts
git commit -m "feat(2fa): carry amr on the OAuth authorization code"
```

---

### Task 5: `issueJwt` emits the `amr` claim

**Files:**
- Modify: `apps/auth-server/src/token/token.service.ts` (`IssueJwtParams` line 8–13; payload line 73–81)
- Test: `apps/auth-server/src/token/token.service.spec.ts` (existing)

**Interfaces:**
- Consumes: nothing new.
- Produces: `IssueJwtParams` gains `amr?: string[]`; JWT payload includes top-level `amr` when non-empty, omitted otherwise.

- [ ] **Step 1: Write the failing test**

Add to `apps/auth-server/src/token/token.service.spec.ts` (follow the existing decode pattern in that file — it already constructs a `TokenService` and decodes with the public key):

```typescript
it('includes amr when provided and omits it when empty', async () => {
  const svc = makeTokenService(); // existing helper/pattern in this spec file
  jest.spyOn(svc as any, 'resolvePermissions').mockResolvedValue([]);

  const withMfa = jwtDecode(await svc.issueJwt({ saUserId: 1, userPublicId: 'u', orgPublicId: 'o', appPublicId: 'a', amr: ['pwd', 'otp', 'mfa'] }));
  expect(withMfa.amr).toEqual(['pwd', 'otp', 'mfa']);

  const none = jwtDecode(await svc.issueJwt({ saUserId: 1, userPublicId: 'u', orgPublicId: 'o', appPublicId: 'a', amr: [] }));
  expect('amr' in none).toBe(false);

  const undef = jwtDecode(await svc.issueJwt({ saUserId: 1, userPublicId: 'u', orgPublicId: 'o', appPublicId: 'a' }));
  expect('amr' in undef).toBe(false);
});
```

(Use the same decode utility the existing tests use; if they use `jsonwebtoken`'s `decode`, reuse it rather than adding `jwt-decode`.)

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @sassy-auth/auth-server exec jest token.service -c jest.config.js`
Expected: FAIL — `amr` is not on the payload / type error on the extra param.

- [ ] **Step 3: Implement**

Extend the interface:

```typescript
interface IssueJwtParams {
  saUserId: number;
  userPublicId: string;
  orgPublicId: string;
  appPublicId: string;
  amr?: string[];
}
```

In `issueJwt`, build the payload with a conditional spread:

```typescript
    const payload = {
      sub: params.userPublicId,
      aud: params.appPublicId,
      org: params.orgPublicId,
      iss: issuer,
      iat: now,
      exp: now + 3600,
      scope: permissions.join(' '),
      ...(params.amr && params.amr.length ? { amr: params.amr } : {}),
    };
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @sassy-auth/auth-server exec jest token.service -c jest.config.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/token/token.service.ts apps/auth-server/src/token/token.service.spec.ts
git commit -m "feat(2fa): emit amr claim on issued JWTs"
```

---

### Task 6: Authorize forced-enrollment gate + `amr` stamping

**Files:**
- Modify: `apps/auth-server/src/token/token.controller.ts` (`oauthAuthorize` ~line 104–225; `oauthToken` ~line 232–305)

**Interfaces:**
- Consumes: `isTwoFactorRequired` (Task 2), `generateCode(..., amr)` (Task 4), `exchangeCode(...).amr` (Task 4), `issueJwt({..., amr})` (Task 5).
- Produces: authorize redirect to `/account/security?enroll=1&next=<authorizeUrl>` for required+unenrolled; `amr` flows code → JWT.

- [ ] **Step 1: Add the imports**

At the top of `token.controller.ts`, add:

```typescript
import { isTwoFactorRequired } from '../auth/two-factor-required';
```

- [ ] **Step 2: Insert the forced-enrollment gate**

In `oauthAuthorize`, after the `saUser.org.appId !== app.id` check (line ~165) and **before** `generateCode`, add:

```typescript
      // 2b: forced 2FA enrollment. If the app requires 2FA (per-app flag, or the
      // platform env flag for the platform app) and this active user has not yet
      // enrolled, bounce them into the self-service enrollment page carrying the
      // full authorize URL as `next`, so they return here and get a code only
      // after enrolling. `enroll=1` puts the page in forced (no-skip) mode.
      if (isTwoFactorRequired(app) && !session.user.twoFactorEnabled) {
        const adminUrl = process.env.ADMIN_URL;
        if (adminUrl) {
          const query = new URLSearchParams({
            client_id: clientId,
            redirect_uri: redirectUri,
            code_challenge: codeChallenge,
            code_challenge_method: codeChallengeMethod,
          });
          if (state) query.set('state', state);
          const nextPath = `${OAUTH_AUTHORIZE_ROUTE}?${query.toString()}`;
          const enrollUrl = `${adminUrl.replace(/\/$/, '')}/account/security?enroll=1&next=${encodeURIComponent(nextPath)}`;
          this.logger.getWinstonLogger().info('OAuth authorize: forced 2FA enrollment', {
            context: 'TokenController', appId: clientId, userId: saUser.publicId,
          });
          return { url: enrollUrl, statusCode: 302 };
        }
        // No ADMIN_URL (dev): fail closed rather than minting a non-2FA code.
        throw new ForbiddenException(TokenErrorCode.USER_NOT_FOUND);
      }
```

> `session.user.twoFactorEnabled` is present on the better-auth session user (2a added the column and it is surfaced on the session). If TypeScript does not type it, read it as `(session.user as { twoFactorEnabled?: boolean }).twoFactorEnabled === true`.

- [ ] **Step 3: Stamp `amr` when generating the code**

Replace the `generateCode` call (line ~167) with an `amr`-carrying version:

```typescript
      const amr = session.user.twoFactorEnabled ? ['pwd', 'otp', 'mfa'] : ['pwd'];
      const code = await this.oauthService.generateCode(
        saUser.publicId,
        app.publicId,
        redirectUri,
        codeChallenge,
        'S256',
        amr,
      );
```

- [ ] **Step 4: Thread `amr` through token exchange**

In `oauthToken`, declare `let exchangedAmr: string[] = ['pwd'];` alongside the existing `let userPublicId` / `let appPublicId` declarations (before the `try`), then assign it inside the `try` next to the other two:

```typescript
      userPublicId = exchanged.userId;
      appPublicId = exchanged.appPublicId;
      exchangedAmr = exchanged.amr;
```

Then update the `issueJwt` call (line ~290):

```typescript
    const token = await this.tokenService.issueJwt({
      saUserId: saUser.id,
      userPublicId: saUser.publicId,
      orgPublicId: saUser.org.publicId,
      appPublicId,
      amr: exchangedAmr,
    });
```

- [ ] **Step 5: Add the unit test (gate behavior)**

Add to `apps/auth-server/src/token/token.controller.spec.ts` (follow the existing controller-spec mocking of `oauthService`/`prisma`/`auth.api.getSession`):

```typescript
it('redirects required+unenrolled users to forced enrollment', async () => {
  process.env.ADMIN_URL = 'https://admin.example';
  mockApp({ requireTwoFactor: true, isPlatform: false });
  mockSession({ twoFactorEnabled: false });
  mockSaUser({ status: 'active' });
  const res = await controller.oauthAuthorize('cid', 'https://rs.example/cb', 'chal', 'S256', '', req);
  expect(res.url).toContain('/account/security?enroll=1&next=');
  expect(oauthService.generateCode).not.toHaveBeenCalled();
});

it('issues a code with mfa amr for enrolled users', async () => {
  mockApp({ requireTwoFactor: true, isPlatform: false });
  mockSession({ twoFactorEnabled: true });
  mockSaUser({ status: 'active' });
  await controller.oauthAuthorize('cid', 'https://rs.example/cb', 'chal', 'S256', '', req);
  expect(oauthService.generateCode).toHaveBeenCalledWith('u_pub', 'a_pub', 'https://rs.example/cb', 'chal', 'S256', ['pwd', 'otp', 'mfa']);
});
```

(Reuse whatever `mockApp`/`mockSession`/`mockSaUser` helpers the existing spec defines; if it inlines mocks, follow that style.)

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @sassy-auth/auth-server exec jest token.controller -c jest.config.js`
Expected: PASS (existing + 2 new).

- [ ] **Step 7: Commit**

```bash
git add apps/auth-server/src/token/token.controller.ts apps/auth-server/src/token/token.controller.spec.ts
git commit -m "feat(2fa): authorize forced-enrollment gate + amr stamping"
```

---

### Task 7: `direct/login` — optional `totpCode` enforcement

**Files:**
- Modify: `apps/auth-server/src/token/dto/direct-login.dto.ts`
- Modify: `apps/auth-server/src/token/token.controller.ts` (`directLogin` ~line 320–486)
- Modify: `packages/types` (or wherever `TokenErrorCode` is defined) — add `TWO_FACTOR_REQUIRED`
- Test: `apps/auth-server/src/token/token.controller.spec.ts`

**Interfaces:**
- Consumes: `isTwoFactorRequired` (Task 2), `verifyUserTotp` (Task 3), `issueJwt({..., amr})` (Task 5).
- Produces: `DirectLoginDto.totpCode?: string`; `403 TWO_FACTOR_REQUIRED` when a required/enrolled user omits or fails the code; `amr=["pwd","otp","mfa"]` on success with a valid code.

- [ ] **Step 1: Add the error code**

Find the `TokenErrorCode` enum (imported from `@sassy-auth/types`) and add:

```typescript
  TWO_FACTOR_REQUIRED = 'two_factor_required',
```

Run: `grep -rn "INVALID_CREDENTIALS" packages/types/src` to locate the exact file, add the member alongside it.

- [ ] **Step 2: Add the DTO field**

In `direct-login.dto.ts`, add after `appId`:

```typescript
  /**
   * Optional 6-digit TOTP code. Required when the target app enforces 2FA or the
   * user has 2FA enabled. Bounded to 6 chars; never logged.
   */
  @IsOptional()
  @IsString()
  @MinLength(6)
  @MaxLength(6)
  totpCode?: string;
```

Add `IsOptional`, `MinLength` to the `class-validator` import line.

- [ ] **Step 3: Write the failing tests**

Add to `token.controller.spec.ts`:

```typescript
describe('directLogin 2FA enforcement', () => {
  it('rejects with 403 two_factor_required when required and no code supplied', async () => {
    mockApp({ requireTwoFactor: true, isPlatform: false });
    mockDirectUser({ status: 'active', twoFactorEnabled: true, passwordOk: true });
    await expect(controller.directLogin({ identifier: 'a@b.co', password: 'pw', appId: 'aid' } as any))
      .rejects.toMatchObject({ status: 403 });
  });

  it('issues an mfa JWT when a valid totpCode is supplied', async () => {
    mockApp({ requireTwoFactor: true, isPlatform: false });
    mockDirectUser({ status: 'active', twoFactorEnabled: true, passwordOk: true });
    (verifyUserTotp as jest.Mock).mockResolvedValue(true);
    await controller.directLogin({ identifier: 'a@b.co', password: 'pw', appId: 'aid', totpCode: '123456' } as any);
    expect(tokenService.issueJwt).toHaveBeenCalledWith(expect.objectContaining({ amr: ['pwd', 'otp', 'mfa'] }));
  });

  it('rejects with 403 when the totpCode is wrong', async () => {
    mockApp({ requireTwoFactor: true, isPlatform: false });
    mockDirectUser({ status: 'active', twoFactorEnabled: true, passwordOk: true });
    (verifyUserTotp as jest.Mock).mockResolvedValue(false);
    await expect(controller.directLogin({ identifier: 'a@b.co', password: 'pw', appId: 'aid', totpCode: '000000' } as any))
      .rejects.toMatchObject({ status: 403 });
  });

  it('issues a pwd-only JWT for a non-required app with a non-2FA user', async () => {
    mockApp({ requireTwoFactor: false, isPlatform: false });
    mockDirectUser({ status: 'active', twoFactorEnabled: false, passwordOk: true });
    await controller.directLogin({ identifier: 'a@b.co', password: 'pw', appId: 'aid' } as any);
    expect(tokenService.issueJwt).toHaveBeenCalledWith(expect.objectContaining({ amr: ['pwd'] }));
  });
});
```

Mock `verifyUserTotp` at the top of the spec: `jest.mock('../auth/verify-user-totp')`.

- [ ] **Step 4: Run to verify failure**

Run: `pnpm --filter @sassy-auth/auth-server exec jest token.controller -c jest.config.js -t "directLogin 2FA"`
Expected: FAIL — no enforcement / `amr` not passed.

- [ ] **Step 5: Implement the gate**

Add the import at top of `token.controller.ts`:

```typescript
import { verifyUserTotp } from '../auth/verify-user-totp';
```

Between the active-status check (line ~449, after the `saUser.status !== 'active'` block) and the `lastLoginAt` update (line ~457), insert:

```typescript
    // 2b: enforce 2FA on the non-interactive path. When the app requires 2FA or
    // the user has enrolled, a valid TOTP code is mandatory. We never emit a
    // pwd-only JWT for a 2FA-enrolled user. The totpCode is never logged.
    const twoFactorEnabled = await prisma.user
      .findUnique({ where: { id: saUser.betterAuthUserId }, select: { twoFactorEnabled: true } })
      .then((u) => u?.twoFactorEnabled ?? false);

    let amr = ['pwd'];
    if (isTwoFactorRequired(app) || twoFactorEnabled) {
      if (!twoFactorEnabled) {
        // Required app, user not enrolled: cannot self-enroll non-interactively.
        this.logger.getWinstonLogger().warn('Direct login blocked: 2FA required, user not enrolled', {
          context: 'TokenController', appId: dto.appId, userId: saUser.publicId,
        });
        throw new ForbiddenException(TokenErrorCode.TWO_FACTOR_REQUIRED);
      }
      if (!dto.totpCode || !(await verifyUserTotp(saUser.betterAuthUserId, dto.totpCode))) {
        this.logger.getWinstonLogger().warn('Direct login blocked: missing/invalid 2FA code', {
          context: 'TokenController', appId: dto.appId, userId: saUser.publicId,
        });
        throw new ForbiddenException(TokenErrorCode.TWO_FACTOR_REQUIRED);
      }
      amr = ['pwd', 'otp', 'mfa'];
    }
```

Then pass `amr` to the `issueJwt` call (line ~468):

```typescript
    const token = await this.tokenService.issueJwt({
      saUserId: saUser.id,
      userPublicId: saUser.publicId,
      orgPublicId: saUser.org.publicId,
      appPublicId: app.publicId,
      amr,
    });
```

> `saUser.betterAuthUserId` is already selected in the `SaUserWithOrg` type used by `directLogin` (line ~338). Confirm it is included in the three `include` queries; it is a scalar column so Prisma returns it by default.

- [ ] **Step 6: Run to verify pass**

Run: `pnpm --filter @sassy-auth/auth-server exec jest token.controller -c jest.config.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/auth-server/src/token/dto/direct-login.dto.ts apps/auth-server/src/token/token.controller.ts packages/types
git commit -m "feat(2fa): enforce optional totpCode on direct/login"
```

---

### Task 8: `requireTwoFactor` in app DTOs, service, and response

**Files:**
- Modify: `apps/auth-server/src/apps/dto/create-app.dto.ts`, `dto/update-app.dto.ts`
- Modify: `apps/auth-server/src/apps/apps.service.ts` (`AppRow` type line 11; `formatApp` line 13; `createApp` line 73; `updateApp` line 85–113)
- Test: `apps/auth-server/src/apps/apps.service.spec.ts` (existing)

**Interfaces:**
- Produces: `CreateAppDto.requireTwoFactor?: boolean`, `UpdateAppDto.requireTwoFactor?: boolean`; `formatApp` output gains `requireTwoFactor: boolean`.

- [ ] **Step 1: Write the failing test**

Add to `apps/auth-server/src/apps/apps.service.spec.ts`:

```typescript
it('persists requireTwoFactor on create and update for non-platform apps', async () => {
  const created = await service.createApp(adminBaId, { name: 'X', url: 'https://x.example', requireTwoFactor: true });
  expect(created.requireTwoFactor).toBe(true);

  const updated = await service.updateApp(adminBaId, created.publicId, { requireTwoFactor: false });
  expect(updated.requireTwoFactor).toBe(false);
});

it('still rejects requireTwoFactor updates on the platform app', async () => {
  await expect(service.updateApp(adminBaId, platformPublicId, { requireTwoFactor: true }))
    .rejects.toThrow('Platform app cannot be modified');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @sassy-auth/auth-server exec jest apps.service -c jest.config.js`
Expected: FAIL — `requireTwoFactor` unknown on DTO / not returned.

- [ ] **Step 3: Add DTO fields**

In both `create-app.dto.ts` and `update-app.dto.ts`, add:

```typescript
  @IsOptional() @IsBoolean() requireTwoFactor?: boolean;
```

Add `IsBoolean` to the `class-validator` imports in both files.

- [ ] **Step 4: Update the service**

- `AppRow` type (line 11): add `requireTwoFactor: boolean`.
- `formatApp` (line 13): add `requireTwoFactor: a.requireTwoFactor`.
- `createApp` data (line 73): add `requireTwoFactor: dto.requireTwoFactor ?? false`.
- `updateApp` "at least one field" guard (line ~90): include `dto.requireTwoFactor === undefined` in the all-undefined check.
- `updateApp` data (line ~103): add the conditional spread:

```typescript
          ...(dto.requireTwoFactor !== undefined && {
            requireTwoFactor: dto.requireTwoFactor,
          }),
```

The existing `if (existing.isPlatform) throw new ForbiddenException(...)` at line ~99 already blocks the platform app — no change needed there.

- [ ] **Step 5: Run to verify pass**

Run: `pnpm --filter @sassy-auth/auth-server exec jest apps.service -c jest.config.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/auth-server/src/apps
git commit -m "feat(2fa): requireTwoFactor field on app create/update (non-platform)"
```

---

### Task 9: Admin UI — `requireTwoFactor` checkbox

**Files:**
- Modify: `apps/admin/lib/types.ts` (App / CreateAppPayload / UpdateAppPayload)
- Modify: `apps/admin/components/app-create-drawer.tsx`, `app-edit-drawer.tsx`
- Modify: `apps/admin/messages/en.json`, `messages/fr.json`
- Test: `apps/admin` component test alongside the existing drawer tests (if present)

**Interfaces:**
- Consumes: `updateAppAction`/`createAppAction` (unchanged signatures; payloads gain `requireTwoFactor`).

- [ ] **Step 1: Extend the types**

In `apps/admin/lib/types.ts`, add `requireTwoFactor: boolean` to `App`, and `requireTwoFactor?: boolean` to `CreateAppPayload` and `UpdateAppPayload`.

- [ ] **Step 2: Add copy**

In `messages/en.json` under `apps.fields`, add:

```json
"requireTwoFactor": "Require two-factor authentication",
"requireTwoFactorHint": "Users signing in to this app must enroll in 2FA before they can continue."
```

Add the French equivalents in `messages/fr.json`:

```json
"requireTwoFactor": "Exiger l'authentification à deux facteurs",
"requireTwoFactorHint": "Les utilisateurs se connectant à cette application devront activer la 2FA avant de continuer."
```

- [ ] **Step 3: Add the checkbox to the edit drawer**

In `app-edit-drawer.tsx`, mirror the existing `twoFactorTrustDays` wiring (state at line ~33, dirty check at line ~47, patch at line ~60–64). Add:

```tsx
const [requireTwoFactor, setRequireTwoFactor] = React.useState<boolean>(app.requireTwoFactor ?? false)
// in the reset effect: setRequireTwoFactor(app.requireTwoFactor ?? false)
// dirty: || requireTwoFactor !== (app.requireTwoFactor ?? false)
// patch: if (requireTwoFactor !== (app.requireTwoFactor ?? false)) patch.requireTwoFactor = requireTwoFactor
```

And a checkbox control near the trust-days field (use the same `Checkbox`/`Switch` component the codebase already uses elsewhere — check `apps/admin/components/ui`):

```tsx
<div className="flex items-center gap-2">
  <Checkbox id="requireTwoFactor" checked={requireTwoFactor} onCheckedChange={(v) => setRequireTwoFactor(v === true)} />
  <Label htmlFor="requireTwoFactor">{t('apps.fields.requireTwoFactor')}</Label>
</div>
<p className="text-sm text-muted-foreground">{t('apps.fields.requireTwoFactorHint')}</p>
```

- [ ] **Step 4: Add the checkbox to the create drawer**

Apply the same control and state in `app-create-drawer.tsx`, defaulting to `false`, and include `requireTwoFactor` in the create payload.

- [ ] **Step 5: Typecheck + lint**

Run: `pnpm --filter @sassy-auth/admin exec tsc --noEmit`
Expected: no errors.
Run: `pnpm --filter @sassy-auth/admin lint`
Expected: passes.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/lib/types.ts apps/admin/components/app-create-drawer.tsx apps/admin/components/app-edit-drawer.tsx apps/admin/messages/en.json apps/admin/messages/fr.json
git commit -m "feat(2fa): requireTwoFactor checkbox on app drawers"
```

---

### Task 10: Enroll page forced mode (`enroll=1` + `next`)

**Files:**
- Modify: `apps/admin/app/account/security/page.tsx`
- Modify: `apps/admin/app/account/security/SecurityClient.tsx`

**Interfaces:**
- Consumes: authorize redirect `/account/security?enroll=1&next=<url>` (Task 6).
- Produces: `SecurityClient` accepts `forced: boolean` and `next: string | null`; on successful enable+confirm in forced mode it navigates to `next`.

- [ ] **Step 1: Read the params in the page**

In `page.tsx`, accept `searchParams` and pass them down. Validate `next` with the existing `validateNextUrl` helper (`apps/admin/lib/safe-next.ts`, used by login actions) so an attacker can't redirect off-site:

```tsx
export default async function SecurityPage({ searchParams }: { searchParams: Promise<{ enroll?: string; next?: string }> }) {
  const sp = await searchParams
  const forced = sp.enroll === '1'
  const next = typeof sp.next === 'string' ? validateNextUrl(sp.next) : null
  // ...existing session fetch...
  return <SecurityClient twoFactorEnabled={twoFactorEnabled} forced={forced} next={next} />
}
```

Import `validateNextUrl` from `@/lib/safe-next`.

- [ ] **Step 2: Thread props + post-enroll redirect in the client**

In `SecurityClient.tsx`, extend `Props` with `forced?: boolean` and `next?: string | null`. On the step where enrollment is confirmed (TOTP verify succeeds and `enabled` flips true), if `forced && next`, redirect:

```tsx
// after successful verify-totp confirmation:
if (forced && next) {
  window.location.href = next
  return
}
```

In forced mode, hide the "Skip"/dismiss affordance and show a short banner: "This application requires two-factor authentication. Finish setup to continue." (Add `apps.security.forcedBanner` copy to `en.json`/`fr.json`.)

> The forced banner and redirect only affect the forced path; the normal self-service `/account/security` visit (no `enroll`/`next`) is unchanged.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @sassy-auth/admin exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/app/account/security/page.tsx apps/admin/app/account/security/SecurityClient.tsx apps/admin/messages/en.json apps/admin/messages/fr.json
git commit -m "feat(2fa): forced-enrollment mode on /account/security"
```

---

### Task 11: Docs — `PLATFORM_REQUIRE_2FA`

**Files:**
- Modify: `.env.example`
- Modify: `README.md`

- [ ] **Step 1: Document the env flag**

In `.env.example`, near the existing `TWO_FACTOR_TRUST_DAYS` entry, add:

```bash
# Force 2FA for ALL operators of the platform admin app. The platform app is
# immutable via the app UI, so its 2FA requirement is set here. Only the exact
# value "true" enables it. Enable your own 2FA first (see /account/security);
# recovery from lockout is the admin "Reset 2FA" action.
PLATFORM_REQUIRE_2FA=false
```

- [ ] **Step 2: README note**

In `README.md`, in the 2FA / security section, add a short paragraph describing per-app `requireTwoFactor` (set on non-platform apps via the app drawer) and `PLATFORM_REQUIRE_2FA` for the platform app, plus the `amr` claim now present on JWTs (`["pwd"]` or `["pwd","otp","mfa"]`).

- [ ] **Step 3: Commit**

```bash
git add .env.example README.md
git commit -m "docs(2fa): document PLATFORM_REQUIRE_2FA and requireTwoFactor"
```

---

### Task 12: e2e — enforcement matrix + live-RS `amr`

**Files:**
- Create: `apps/admin-e2e/tests/2fa-enforcement.spec.ts`
- Modify: the live-RS spec added in 2a (add an `amr` assertion) — locate via `grep -rl "authorized.html" apps/admin-e2e`
- Reuse: `apps/admin-e2e/lib/oauth-fixtures.ts` (`buildAuthorizeUrl`, `newPkce`), seeded accounts, in-test `otplib`

**Interfaces:**
- Consumes: everything above, end to end.

- [ ] **Step 1: Seed a required app + accounts**

Add a seeded non-platform `SaApp` with `requireTwoFactor: true` to the e2e seed (follow how 2a seeded its 2FA app / `tfa@sa.io` account). Provide two users: one enrolled (`tfa@sa.io`), one fresh unenrolled account for the forced-enrollment case.

- [ ] **Step 2: Forced-enrollment test**

```typescript
test('required app forces enrollment for an unenrolled user, then issues an mfa JWT', async ({ page }) => {
  const { url, verifier } = buildAuthorizeUrl({ client_id: REQUIRED_APP_CLIENT_ID });
  await page.goto(url);
  // bounced to /login (no session) → sign in with the fresh unenrolled user
  await signInViaLoginForm(page, FRESH_USER);
  // authorize now redirects to forced enrollment
  await expect(page).toHaveURL(/\/account\/security\?enroll=1/);
  await completeEnrollment(page); // scan secret, compute otplib code, confirm
  // returns to authorize → redirect_uri?code=...
  const code = await extractCodeFromRedirect(page);
  const jwt = await exchangeCodeForJwt(code, verifier, REQUIRED_APP_CLIENT_ID);
  expect(decodeJwt(jwt).amr).toContain('mfa');
});
```

- [ ] **Step 3: Enrolled-user test**

```typescript
test('required app challenges an enrolled user and stamps mfa amr', async ({ page }) => {
  const { url, verifier } = buildAuthorizeUrl({ client_id: REQUIRED_APP_CLIENT_ID });
  await page.goto(url);
  await signInViaLoginForm(page, ENROLLED_USER); // password
  await completeTotpChallenge(page); // otplib code at the TOTP step
  const code = await extractCodeFromRedirect(page);
  const jwt = await exchangeCodeForJwt(code, verifier, REQUIRED_APP_CLIENT_ID);
  expect(decodeJwt(jwt).amr).toEqual(expect.arrayContaining(['pwd', 'otp', 'mfa']));
});
```

Reuse `completeEnrollment`/`completeTotpChallenge`/`decodeJwt` helpers from 2a's suite; add any missing helper to `oauth-fixtures.ts`.

- [ ] **Step 3b: direct/login real-key guard**

This is the definitive check that `verifyUserTotp`'s `BETTER_AUTH_SECRET` key matches better-auth's runtime `secretConfig` for a genuinely-enrolled user (Task 3's unit test is hermetic and cannot cover this). Using the enrolled `tfa@sa.io` account and its known TOTP secret from the seed/enrollment, POST to `direct/login` with a live `otplib` code and assert a `mfa` JWT; and assert a `403 two_factor_required` when the code is omitted:

```typescript
test('direct/login enforces 2FA and issues an mfa JWT with a valid code', async ({ request }) => {
  const noCode = await request.post(`${AUTH_SERVER_URL}/api/token/direct/login`, {
    data: { identifier: 'tfa@sa.io', password: TFA_PASSWORD, appId: REQUIRED_APP_CLIENT_ID },
  });
  expect(noCode.status()).toBe(403);

  const totpCode = authenticator.generate(TFA_TOTP_SECRET); // otplib, seed secret
  const ok = await request.post(`${AUTH_SERVER_URL}/api/token/direct/login`, {
    data: { identifier: 'tfa@sa.io', password: TFA_PASSWORD, appId: REQUIRED_APP_CLIENT_ID, totpCode },
  });
  expect(ok.status()).toBe(201);
  const jwt = (await ok.json()).access_token;
  expect(decodeJwt(jwt).amr).toEqual(expect.arrayContaining(['pwd', 'otp', 'mfa']));
});
```

> The enrolled account's TOTP secret must be captured at enrollment time and exposed to the test (mirror how 2a's suite computes live TOTP from the enrollment secret). If `tfa@sa.io` is enrolled via a UI step rather than a fixed seed secret, capture the secret during that enrollment and reuse it here.

- [ ] **Step 4: Live-RS amr assertion**

In the 2a live FastAPI-RS round-trip spec, after the RS renders `authorized.html`, assert the decoded JWT the RS received contains `amr` including `mfa` (the RS test already surfaces claims; if not, extend the RS test page to echo `amr`, mirroring how it echoes other claims).

- [ ] **Step 5: Run the enforcement suite**

Run: `pnpm --filter @sassy-auth/admin-e2e exec playwright test 2fa-enforcement`
Expected: PASS (both authorize-sim tests).

- [ ] **Step 6: Run the live-RS slice**

Run: `pnpm --filter @sassy-auth/admin-e2e exec playwright test --grep "@live-rs"` (or the tag/name the 2a RS spec uses)
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/admin-e2e
git commit -m "test(2fa): e2e enforcement matrix + live-RS amr assertion"
```

---

## Final verification

- [ ] **Full auth-server unit suite**

Run: `pnpm --filter @sassy-auth/auth-server test`
Expected: all green.

- [ ] **Admin typecheck + lint**

Run: `pnpm --filter @sassy-auth/admin exec tsc --noEmit && pnpm --filter @sassy-auth/admin lint`
Expected: no errors.

- [ ] **e2e (both suites)**

Run: `pnpm --filter @sassy-auth/admin-e2e test`
Expected: all green, including 2a's existing matrix (no regression).

---

## Self-Review notes (coverage map)

| Spec section | Task(s) |
|---|---|
| §1 data model + `isTwoFactorRequired` | 1, 2 |
| §2 forced-enrollment gate | 6, 10 |
| §3 `amr` on JWT (code → token) | 4, 5, 6 |
| §4 `direct/login` totpCode + `verifyUserTotp` | 3, 7 |
| §5 admin UI (non-platform) + platform env | 8, 9, 11 |
| §6 testing (unit + authorize-sim + live-RS) | 2, 3, 4, 5, 6, 7, 8, 12 |

**Security Contract coverage:** fail-closed authorize gate (Task 6, incl. no-`ADMIN_URL` fallback), fail-closed direct/login (Task 7), truthful `amr` (Tasks 5/6/7), never-log totpCode (Tasks 3/7), platform immutability preserved (Task 8).
