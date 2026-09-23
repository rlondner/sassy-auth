# Signup PKCE Redirect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the immediate-signup-redirect feature (`RegistrationService.register()`) work for public (PKCE) OAuth clients, and fix a `state`/`nonce` passthrough gap for confidential clients — per `docs/superpowers/specs/2026-09-23-signup-pkce-redirect-design.md`.

**Architecture:** `RegistrationService.register()` gains a private helper, `recoverAuthorizeParams`, that recovers `redirect_uri`/`code_challenge`/`code_challenge_method`/`state`/`nonce` from the `next` query param (the original `/authorize` URL) when the admin `/signup` form forwards one. The existing redirect-minting block is rewritten to validate that recovered `redirect_uri` with the same `assertRedirectUriAllowed` helper `/authorize` itself uses, require a valid PKCE challenge for public clients, and fall back to today's challenge-less/no-redirect behavior whenever anything doesn't check out. The admin app threads its existing `next` prop through `registerAction` into the `/api/register` POST body — no new redirect logic on the frontend, since `signup-form.tsx` already redirects to `redirectUrl` whenever the backend returns one.

**Tech Stack:** NestJS (auth-server), Next.js Server Actions (admin), Jest + `class-validator`.

---

### Task 1: Add `next` to `RegisterDto`

**Files:**
- Modify: `apps/auth-server/src/registration/register.dto.ts`

- [ ] **Step 1: Add the optional field**

In `apps/auth-server/src/registration/register.dto.ts`, add `next` alongside the other optional fields:

```ts
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail() email!: string;
  // Complexity is policy-driven and enforced by RegistrationService via
  // resolvePasswordPolicy/validatePasswordOrThrow (see ../auth/password-policy)
  // — the DTO only guards shape and the fixed DoS-prevention length cap.
  @IsString() @MinLength(1) @MaxLength(256) password!: string;
  @IsString() @MinLength(1) firstName!: string;
  @IsString() @MinLength(1) lastName!: string;
  @IsString() @IsOptional() @MinLength(1) companyName?: string;
  @IsString() @MinLength(1) appPublicId!: string;
  @IsString() @MinLength(1) turnstileToken!: string;
  // The original /authorize URL the admin /signup page was bounced here
  // from, when there was one. Recovered (never trusted blindly) by
  // RegistrationService to bind the signup-flow redirect code to the same
  // PKCE challenge/state/nonce the relying party is waiting on — see
  // docs/superpowers/specs/2026-09-23-signup-pkce-redirect-design.md.
  @IsString() @IsOptional() next?: string;
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/auth-server && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/auth-server/src/registration/register.dto.ts
git commit -m "feat(auth-server): accept optional next on RegisterDto"
```

---

### Task 2: Update registration.service.spec.ts fixtures and existing redirect tests (write failing tests first)

**Files:**
- Modify: `apps/auth-server/src/registration/registration.service.spec.ts`

This task only touches the test file. It intentionally leaves the three existing redirect tests failing against the *current* implementation (which still calls `saAppRedirectUri.findFirst`, not `findMany`) — Task 3 makes them pass.

- [ ] **Step 1: Add `findMany` to the Prisma mock and give `appRow` a `url`**

In `apps/auth-server/src/registration/registration.service.spec.ts`, update the `jest.mock('@sassy-auth/db', ...)` block:

```ts
jest.mock('@sassy-auth/db', () => ({
  prisma: {
    saApp: { findUnique: jest.fn() },
    saOrg: { create: jest.fn(), update: jest.fn(), findUnique: jest.fn() },
    saUser: { create: jest.fn() },
    saUserRole: { create: jest.fn() },
    saAppRedirectUri: { findFirst: jest.fn(), findMany: jest.fn() },
    user: { delete: jest.fn(), findUnique: jest.fn() },
    $transaction: jest.fn(),
  },
}));
```

(`findFirst` stays in the mock even though production code will stop calling it — harmless, and avoids touching an unrelated line later if some other test still references it.)

Update the typed `mockPrisma` const's type annotation the same way:

```ts
const mockPrisma = require('@sassy-auth/db').prisma as {
  saApp: { findUnique: jest.Mock };
  saOrg: { create: jest.Mock; update: jest.Mock; findUnique: jest.Mock };
  saUser: { create: jest.Mock };
  saUserRole: { create: jest.Mock };
  saAppRedirectUri: { findFirst: jest.Mock; findMany: jest.Mock };
  user: { delete: jest.Mock; findUnique: jest.Mock };
  $transaction: jest.Mock;
};
```

Update `appRow` to include the `url` field every real `SaApp` row has (needed by `assertRedirectUriAllowed`, which the new code path calls):

```ts
const appRow = {
  id: 1,
  publicId: 'sq_1',
  name: 'MyApp',
  isPlatform: false,
  passwordPolicyOverride: null,
  url: 'https://myapp.example.com',
};
```

Add an import for the `/authorize` path constant, used to build realistic `next` URLs in the new tests:

```ts
import { OAUTH_AUTHORIZE_PATH } from '../token/oauth-metadata';
```

Add a small helper near the top of the file (after `baUserId`, before `describe('RegistrationService', ...)`):

```ts
const AUTHORIZE_ORIGIN = 'https://localhost:3010';
function nextUrl(params: Record<string, string>): string {
  return `${AUTHORIZE_ORIGIN}${OAUTH_AUTHORIZE_PATH}?${new URLSearchParams(params).toString()}`;
}
```

- [ ] **Step 2: Update the three existing redirect tests to use `findMany`**

Replace the `'returns a redirectUrl with a signup code when the app is confidential and has a login redirect URI'` test's mock line:

```ts
      mockPrisma.saAppRedirectUri.findMany.mockResolvedValue([
        { uri: 'https://relying-party.example.com/callback', kind: 'login' },
      ]);
```

(replacing `mockPrisma.saAppRedirectUri.findFirst.mockResolvedValue({ uri: 'https://relying-party.example.com/callback', kind: 'login' });`)

Replace the `'omits redirectUrl when the app has no registered login redirect URI'` test's mock line:

```ts
      mockPrisma.saAppRedirectUri.findMany.mockResolvedValue([]);
```

(replacing `mockPrisma.saAppRedirectUri.findFirst.mockResolvedValue(null);`)

Replace the `'omits redirectUrl when the app is a public client (no clientSecretHash), even with a login redirect URI registered'` test's assertion:

```ts
      expect(mockPrisma.saAppRedirectUri.findMany).not.toHaveBeenCalled();
```

(replacing `expect(mockPrisma.saAppRedirectUri.findFirst).not.toHaveBeenCalled();`)

- [ ] **Step 3: Add the six new tests**

Add these inside the `describe('register', ...)` block, after the three tests just updated:

```ts
    it("mints a PKCE-bound signup code and passes state/nonce through when a public app's next names a registered redirect_uri with a valid challenge", async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue({ ...appRow, clientSecretHash: null });
      mockPrisma.saOrg.create.mockResolvedValue(draftOrgRow);
      mockPrisma.saOrg.update.mockResolvedValue(finalOrgRow);
      mockSignUpEmail.mockResolvedValue({ user: { id: baUserId } });
      mockPrisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
        cb({
          saOrg: mockPrisma.saOrg,
          saUser: { create: jest.fn().mockResolvedValue({ id: 42, publicId: 'ba-user-id-a' }) },
          saUserRole: mockPrisma.saUserRole,
        }),
      );
      mockPrisma.saAppRedirectUri.findMany.mockResolvedValue([
        { uri: 'https://relying-party.example.com/callback', kind: 'login' },
      ]);
      mockOauthService.generateCode.mockResolvedValue('signup-code-123');

      const dto: RegisterDto = {
        ...baseDto,
        next: nextUrl({
          client_id: 'sq_1',
          redirect_uri: 'https://relying-party.example.com/callback',
          response_type: 'code',
          code_challenge: 'test-challenge',
          code_challenge_method: 'S256',
          state: 'test-state',
          nonce: 'test-nonce',
        }),
      };

      const result = await service.register(dto);

      expect(mockOauthService.generateCode).toHaveBeenCalledWith(
        'ba-user-id-a',
        'sq_1',
        'https://relying-party.example.com/callback',
        'test-challenge',
        'S256',
        ['signup'],
        'test-nonce',
        'openid profile email',
        expect.any(Date),
      );
      expect(result.redirectUrl).toBe(
        'https://relying-party.example.com/callback?code=signup-code-123&state=test-state',
      );
    });

    it("omits redirectUrl for a public app when next has no code_challenge", async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue({ ...appRow, clientSecretHash: null });
      mockPrisma.saOrg.create.mockResolvedValue(draftOrgRow);
      mockPrisma.saOrg.update.mockResolvedValue(finalOrgRow);
      mockSignUpEmail.mockResolvedValue({ user: { id: baUserId } });
      mockPrisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
        cb({
          saOrg: mockPrisma.saOrg,
          saUser: { create: jest.fn().mockResolvedValue({ id: 42, publicId: 'ba-user-id-a' }) },
          saUserRole: mockPrisma.saUserRole,
        }),
      );
      mockPrisma.saAppRedirectUri.findMany.mockResolvedValue([
        { uri: 'https://relying-party.example.com/callback', kind: 'login' },
      ]);

      const dto: RegisterDto = {
        ...baseDto,
        next: nextUrl({
          client_id: 'sq_1',
          redirect_uri: 'https://relying-party.example.com/callback',
          response_type: 'code',
          state: 'test-state',
        }),
      };

      const result = await service.register(dto);

      expect(mockOauthService.generateCode).not.toHaveBeenCalled();
      expect(result.redirectUrl).toBeUndefined();
    });

    it("omits redirectUrl for a public app when next's redirect_uri is not registered", async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue({ ...appRow, clientSecretHash: null });
      mockPrisma.saOrg.create.mockResolvedValue(draftOrgRow);
      mockPrisma.saOrg.update.mockResolvedValue(finalOrgRow);
      mockSignUpEmail.mockResolvedValue({ user: { id: baUserId } });
      mockPrisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
        cb({
          saOrg: mockPrisma.saOrg,
          saUser: { create: jest.fn().mockResolvedValue({ id: 42, publicId: 'ba-user-id-a' }) },
          saUserRole: mockPrisma.saUserRole,
        }),
      );
      mockPrisma.saAppRedirectUri.findMany.mockResolvedValue([
        { uri: 'https://relying-party.example.com/callback', kind: 'login' },
      ]);

      const dto: RegisterDto = {
        ...baseDto,
        next: nextUrl({
          client_id: 'sq_1',
          redirect_uri: 'https://evil.example.com/callback',
          response_type: 'code',
          code_challenge: 'test-challenge',
          code_challenge_method: 'S256',
        }),
      };

      const result = await service.register(dto);

      expect(mockOauthService.generateCode).not.toHaveBeenCalled();
      expect(result.redirectUrl).toBeUndefined();
    });

    it("omits redirectUrl for a public app when next's client_id does not match the app, without querying redirect URIs", async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue({ ...appRow, clientSecretHash: null });
      mockPrisma.saOrg.create.mockResolvedValue(draftOrgRow);
      mockPrisma.saOrg.update.mockResolvedValue(finalOrgRow);
      mockSignUpEmail.mockResolvedValue({ user: { id: baUserId } });
      mockPrisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
        cb({
          saOrg: mockPrisma.saOrg,
          saUser: { create: jest.fn().mockResolvedValue({ id: 42, publicId: 'ba-user-id-a' }) },
          saUserRole: mockPrisma.saUserRole,
        }),
      );

      const dto: RegisterDto = {
        ...baseDto,
        next: nextUrl({
          client_id: 'sq_OTHER',
          redirect_uri: 'https://relying-party.example.com/callback',
          response_type: 'code',
          code_challenge: 'test-challenge',
          code_challenge_method: 'S256',
        }),
      };

      const result = await service.register(dto);

      expect(mockPrisma.saAppRedirectUri.findMany).not.toHaveBeenCalled();
      expect(mockOauthService.generateCode).not.toHaveBeenCalled();
      expect(result.redirectUrl).toBeUndefined();
    });

    it("honors next's PKCE challenge and passes state/nonce through for a confidential app", async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue({ ...appRow, clientSecretHash: 'hashed-secret' });
      mockPrisma.saOrg.create.mockResolvedValue(draftOrgRow);
      mockPrisma.saOrg.update.mockResolvedValue(finalOrgRow);
      mockSignUpEmail.mockResolvedValue({ user: { id: baUserId } });
      mockPrisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
        cb({
          saOrg: mockPrisma.saOrg,
          saUser: { create: jest.fn().mockResolvedValue({ id: 42, publicId: 'ba-user-id-a' }) },
          saUserRole: mockPrisma.saUserRole,
        }),
      );
      mockPrisma.saAppRedirectUri.findMany.mockResolvedValue([
        { uri: 'https://relying-party.example.com/callback', kind: 'login' },
      ]);
      mockOauthService.generateCode.mockResolvedValue('signup-code-123');

      const dto: RegisterDto = {
        ...baseDto,
        next: nextUrl({
          client_id: 'sq_1',
          redirect_uri: 'https://relying-party.example.com/callback',
          response_type: 'code',
          code_challenge: 'test-challenge',
          code_challenge_method: 'S256',
          state: 'test-state',
          nonce: 'test-nonce',
        }),
      };

      const result = await service.register(dto);

      expect(mockOauthService.generateCode).toHaveBeenCalledWith(
        'ba-user-id-a',
        'sq_1',
        'https://relying-party.example.com/callback',
        'test-challenge',
        'S256',
        ['signup'],
        'test-nonce',
        'openid profile email',
        expect.any(Date),
      );
      expect(result.redirectUrl).toBe(
        'https://relying-party.example.com/callback?code=signup-code-123&state=test-state',
      );
    });

    it("uses the redirect_uri named by next, not the oldest registered one, when an app has more than one", async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue({ ...appRow, clientSecretHash: 'hashed-secret' });
      mockPrisma.saOrg.create.mockResolvedValue(draftOrgRow);
      mockPrisma.saOrg.update.mockResolvedValue(finalOrgRow);
      mockSignUpEmail.mockResolvedValue({ user: { id: baUserId } });
      mockPrisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
        cb({
          saOrg: mockPrisma.saOrg,
          saUser: { create: jest.fn().mockResolvedValue({ id: 42, publicId: 'ba-user-id-a' }) },
          saUserRole: mockPrisma.saUserRole,
        }),
      );
      mockPrisma.saAppRedirectUri.findMany.mockResolvedValue([
        { uri: 'https://relying-party.example.com/web-callback', kind: 'login' },
        { uri: 'https://mobile.example.com/callback', kind: 'login' },
      ]);
      mockOauthService.generateCode.mockResolvedValue('signup-code-123');

      const dto: RegisterDto = {
        ...baseDto,
        next: nextUrl({
          client_id: 'sq_1',
          redirect_uri: 'https://mobile.example.com/callback',
          response_type: 'code',
        }),
      };

      const result = await service.register(dto);

      expect(mockOauthService.generateCode).toHaveBeenCalledWith(
        'ba-user-id-a',
        'sq_1',
        'https://mobile.example.com/callback',
        null,
        null,
        ['signup'],
        null,
        'openid profile email',
        expect.any(Date),
      );
      expect(result.redirectUrl).toBe('https://mobile.example.com/callback?code=signup-code-123');
    });
```

- [ ] **Step 4: Run the suite and confirm the expected failures**

Run: `cd apps/auth-server && npx jest src/registration/registration.service.spec.ts --silent`
Expected: FAIL — the three modified existing tests fail (production code still calls `findFirst`, which now returns `undefined` from the unmocked default), and the six new tests fail (production code doesn't read `dto.next` yet). Other tests in the file still pass.

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/registration/registration.service.spec.ts
git commit -m "test(auth-server): cover PKCE-bound signup redirect for public clients"
```

---

### Task 3: Implement the PKCE-aware redirect logic

**Files:**
- Modify: `apps/auth-server/src/registration/registration.service.ts`

- [ ] **Step 1: Add imports and the `recoverAuthorizeParams` helper**

Add to the import block at the top of `apps/auth-server/src/registration/registration.service.ts`:

```ts
import { assertRedirectUriAllowed } from '../token/redirect-uri';
import { OAUTH_AUTHORIZE_PATH } from '../token/oauth-metadata';
```

Add this helper after `isDuplicateEmailError` and before the `@Injectable()` class declaration:

```ts
interface RecoveredAuthorizeParams {
  redirectUri: string;
  codeChallenge: string | null;
  codeChallengeMethod: string | null;
  state: string | null;
  nonce: string | null;
}

/**
 * Recovers the original /authorize request's parameters from the `next` URL
 * the admin signup page was bounced here with, so a signup-flow code can be
 * bound to the same PKCE challenge (public clients) and carry the same
 * state/nonce (both client types) the relying party is waiting on. Returns
 * null for anything that doesn't look like our own /authorize URL naming
 * this app — every caller must treat that as "no redirect is possible",
 * never as an error worth failing registration over.
 */
function recoverAuthorizeParams(
  next: string | undefined,
  appPublicId: string,
): RecoveredAuthorizeParams | null {
  if (!next) return null;
  let url: URL;
  try {
    url = new URL(next);
  } catch {
    return null;
  }
  if (url.pathname !== OAUTH_AUTHORIZE_PATH) return null;
  if (url.searchParams.get('client_id') !== appPublicId) return null;
  const redirectUri = url.searchParams.get('redirect_uri');
  if (!redirectUri) return null;
  return {
    redirectUri,
    codeChallenge: url.searchParams.get('code_challenge'),
    codeChallengeMethod: url.searchParams.get('code_challenge_method'),
    state: url.searchParams.get('state'),
    nonce: url.searchParams.get('nonce'),
  };
}
```

- [ ] **Step 2: Replace the redirect-minting block**

In `RegistrationService.register()`, replace this block:

```ts
      // Authenticate the new (still-pending) user against the target app
      // immediately, so it can redirect back with a working access token
      // instead of waiting for email verification. Only possible when the
      // app is confidential (has a client secret) and has a registered
      // login redirect URI: a code minted here carries no PKCE challenge
      // (there was no /authorize request to negotiate one), and /api/token
      // refuses a challenge-less code from a public client.
      let redirectUrl: string | undefined;
      if (app.clientSecretHash) {
        // When an app has multiple registered login redirect URIs, there's no
        // per-request way to indicate which one signup should target — pick
        // the oldest-registered one deterministically.
        const loginRedirect = await prisma.saAppRedirectUri.findFirst({
          where: { appId: app.id, kind: 'login' },
          orderBy: { id: 'asc' },
        });
        if (loginRedirect) {
          const code = await this.oauthService.generateCode(
            saUserPublicId,
            app.publicId,
            loginRedirect.uri,
            null,
            null,
            ['signup'],
            null,
            'openid profile email',
            new Date(),
          );
          const url = new URL(loginRedirect.uri);
          url.searchParams.set('code', code);
          redirectUrl = url.toString();
        }
      }
```

with:

```ts
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
```

(The `return { ok: true as const, orgPublicId: org.publicId, ...(redirectUrl !== undefined && { redirectUrl }) };` line right after this block is unchanged.)

- [ ] **Step 3: Run the registration service spec and confirm everything passes**

Run: `cd apps/auth-server && npx jest src/registration/registration.service.spec.ts --silent`
Expected: PASS — all tests, including the 9 redirect-related ones (3 updated + 6 new).

- [ ] **Step 4: Typecheck and run the full auth-server suite**

Run: `cd apps/auth-server && npx tsc --noEmit`
Expected: no errors.

Run: `cd apps/auth-server && npx jest --silent 2>&1 | tail -20`
Expected: all suites pass, no regressions outside `registration.service.spec.ts`.

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/registration/registration.service.ts
git commit -m "feat(auth-server): bind signup redirect code to next's PKCE challenge for public clients"
```

---

### Task 4: Thread `next` from the admin signup form through to `/api/register`

**Files:**
- Modify: `apps/admin/app/signup/actions.ts`
- Test: `apps/admin/app/signup/__tests__/actions.test.ts`
- Modify: `apps/admin/app/signup/signup-form.tsx`
- Test: `apps/admin/app/signup/__tests__/signup-form.test.tsx`

- [ ] **Step 1: Write the failing actions.test.ts case**

In `apps/admin/app/signup/__tests__/actions.test.ts`, add this test after the existing `'omits companyName from the request body when not provided'` test:

```ts
  it('includes next in the request body when provided', async () => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(upstream(201))

    await registerAction({ ...INPUT, next: 'https://localhost:3010/api/token/oauth/authorize?client_id=sq_1' })

    const call = (global.fetch as jest.MockedFunction<typeof fetch>).mock.calls[0]
    const body = JSON.parse(call[1]!.body as string)
    expect(body.next).toBe('https://localhost:3010/api/token/oauth/authorize?client_id=sq_1')
  })

  it('omits next from the request body when not provided', async () => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(upstream(201))

    await registerAction(INPUT)

    const call = (global.fetch as jest.MockedFunction<typeof fetch>).mock.calls[0]
    const body = JSON.parse(call[1]!.body as string)
    expect(body).not.toHaveProperty('next')
  })
```

- [ ] **Step 2: Run and confirm both new tests fail**

Run: `cd apps/admin && npx jest app/signup/__tests__/actions.test.ts --silent`
Expected: FAIL on both new tests — `RegisterInput` has no `next` field yet (TypeScript will also flag the test file itself once you try to run it, since `next` isn't a known property of `RegisterInput`), and the request body never includes `next`.

- [ ] **Step 3: Add `next` to `RegisterInput` and forward it**

In `apps/admin/app/signup/actions.ts`, update the interface and the fetch body:

```ts
export interface RegisterInput {
  clientId: string
  firstName: string
  lastName: string
  companyName?: string
  email: string
  password: string
  turnstileToken: string
  next?: string
}
```

```ts
      body: JSON.stringify({
        email: input.email,
        password: input.password,
        firstName: input.firstName,
        lastName: input.lastName,
        ...(input.companyName !== undefined && { companyName: input.companyName }),
        appPublicId: input.clientId,
        turnstileToken: input.turnstileToken,
        ...(input.next && { next: input.next }),
      }),
```

- [ ] **Step 4: Run and confirm the new tests pass**

Run: `cd apps/admin && npx jest app/signup/__tests__/actions.test.ts --silent`
Expected: PASS — all tests, including the two new ones.

- [ ] **Step 5: Pass `next` from `SignupForm` into `registerAction`**

In `apps/admin/app/signup/signup-form.tsx`, update the `registerAction` call inside `handleSubmit`:

```ts
      const result = await registerAction({
        clientId, firstName, lastName, email, password, turnstileToken: captchaToken,
        ...(hasDefaultOrg ? {} : { companyName }),
        ...(next ? { next } : {}),
      })
```

- [ ] **Step 6: Extend the existing "carries next forward" test to assert it reaches registerAction**

In `apps/admin/app/signup/__tests__/signup-form.test.tsx`, update the `'carries next forward into the check-email redirect'` test to also assert the call into `registerAction`:

```ts
  it('carries next forward into the check-email redirect', async () => {
    render(<SignupForm clientId="sq_1" next="/orgs" hasDefaultOrg={false} passwordPolicy={POLICY} />)
    fillValidForm()
    completeCaptcha()
    fireEvent.click(screen.getByText('signup.submit'))

    await waitFor(() =>
      expect(mockRegisterAction).toHaveBeenCalledWith(
        expect.objectContaining({ next: '/orgs' }),
      ),
    )
    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith(
        '/signup/check-email?email=alice%40example.com&next=%2Forgs',
      ),
    )
  })
```

- [ ] **Step 7: Run the full admin signup test suite**

Run: `cd apps/admin && npx jest app/signup/__tests__/ --silent`
Expected: PASS — all tests in both `actions.test.ts` and `signup-form.test.tsx`.

- [ ] **Step 8: Typecheck**

Run: `cd apps/admin && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add apps/admin/app/signup/actions.ts apps/admin/app/signup/signup-form.tsx apps/admin/app/signup/__tests__/actions.test.ts apps/admin/app/signup/__tests__/signup-form.test.tsx
git commit -m "feat(admin): forward next to /api/register so public clients get a PKCE-bound signup redirect"
```

---

### Task 5: Manual end-to-end check against vibecast

**Files:** none (verification only)

- [ ] **Step 1: Sign up through the real flow**

With the auth-server and admin dev servers running, open the same signup URL from the bug report (adjust `state`/`code_challenge` to a fresh one from the running vibecast app, since codes and challenges aren't reusable):

```
https://localhost:3001/signup?client_id=p5sV&next=https%3A%2F%2Flocalhost%3A3010%2Fapi%2Ftoken%2Foauth%2Fauthorize%3Fclient_id%3Dp5sV%26redirect_uri%3Dhttps%253A%252F%252F127.0.0.1%253A3030%252Fapi%252Fauth%252Fcallback%26response_type%3Dcode%26code_challenge%3D...%26code_challenge_method%3DS256%26state%3D...%26scope%3Dopenid%2Bemail%2Bprofile
```

Register a new (previously unused) email address.

- [ ] **Step 2: Confirm the redirect**

Expected: the browser lands on `https://127.0.0.1:3030/api/auth/callback?code=...&state=...` (vibecast's own callback) instead of `/signup/check-email`, and the `state` matches what vibecast sent.

If it still lands on check-email, check the auth-server logs for which validation step in `recoverAuthorizeParams`/`assertRedirectUriAllowed` rejected the `next` — most likely the `redirect_uri` in `next` not exactly matching a registered `login` URI (protocol/host/port/path must match exactly).
