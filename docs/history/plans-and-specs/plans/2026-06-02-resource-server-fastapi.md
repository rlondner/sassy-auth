# Resource Server (FastAPI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Python/FastAPI resource server (`apps/resource-server-fastapi/`, port 8010, exposed via ngrok at `https://cheryl-crescentlike-monte.ngrok-free.dev`) that authenticates users against SassyAuth using OAuth 2.0 authorization-code with PKCE (S256), verifies the issued JWT via JWKS, and gates a dummy `/api/properties` endpoint on the `rs.properties.create` scope.

**Architecture:** Three apps participate. The browser hits the FastAPI RS; Sign In redirects to the admin (`localhost:3001`) login page with a validated `next=` URL pointing at the auth-server (`localhost:3000`) `/api/token/oauth/authorize`. After BetterAuth login, the browser follows `next` to the auth-server which mints a PKCE-bound authorization code and bounces back to the RS `/auth/callback`. The RS exchanges the code (with `code_verifier`) for an RS256 JWT and embeds it into a page that stashes it in `sessionStorage` and tests the protected endpoint via `Authorization: Bearer`. The JWT's `scope` claim (space-separated permissions) is what `/api/properties` checks.

**Tech Stack:** Node + NestJS + BetterAuth + Prisma (auth-server). Next.js (admin). Python 3.11 + FastAPI + uvicorn + httpx + PyJWT[crypto] + pydantic-settings + Jinja2 (RS). pytest for RS, Jest for auth-server and admin.

**Spec:** `docs/superpowers/specs/2026-06-02-resource-server-fastapi-design.md`

---

## File Structure

### Modified files

- `packages/types/index.ts` — replace `permissions: string[]` with `scope: string` on `SassyAuthJwtPayload`; swap `INVALID_CODE` + `CODE_EXPIRED` for `INVALID_REQUEST` + `INVALID_REDIRECT_URI` + `INVALID_GRANT` + `UNAUTHORIZED_CLIENT` in `TokenErrorCode`.
- `apps/auth-server/src/token/oauth.service.ts` — accept `codeChallenge`/`codeChallengeMethod` in `generateCode`; verify `codeVerifier` in `exchangeCode`. Codes now also store the PKCE challenge.
- `apps/auth-server/src/token/oauth.service.spec.ts` — new PKCE tests.
- `apps/auth-server/src/token/dto/oauth-token-exchange.dto.ts` — drop `client_secret`, add `code_verifier`.
- `apps/auth-server/src/token/token.controller.ts` — accept PKCE params on `/oauth/authorize`, accept `code_verifier` on `/oauth/token`, call `assertRedirectUriMatchesApp` in both.
- `apps/auth-server/src/token/token.service.ts` — replace `permissions: string[]` claim with `scope: string` (space-separated, sorted).
- `apps/auth-server/src/token/token.service.spec.ts` — assert new shape.
- `apps/auth-server/test/app.e2e-spec.ts` — replace the `Array.isArray(decoded.permissions)` assertion and add a PKCE auth-code round-trip test.
- `apps/auth-server/src/seed/seed.ts` — call demo seed when `SEED_DEMO=1`.
- `apps/admin/app/login/page.tsx` — surface `next` as a hidden form input.
- `apps/admin/app/login/actions.ts` — read `next`, validate, redirect.

### New files

- `apps/auth-server/src/token/redirect-uri.ts` + `redirect-uri.spec.ts` — origin-match helper.
- `apps/auth-server/src/seed/demo-resource-server.ts` — idempotent demo seed.
- `apps/admin/lib/safe-next.ts` + `safe-next.spec.ts` — URL allowlist.
- `apps/resource-server-fastapi/` — entire Python app (see Task 14 for layout).

---

## Task 1: Update `@sassy-auth/types` for the new JWT shape and error codes

**Files:**
- Modify: `packages/types/index.ts`

- [ ] **Step 1: Replace the file contents**

```typescript
/** Claims included in every RS256 JWT issued by SassyAuth. */
export interface SassyAuthJwtPayload {
  /** Issuer: base URL of the SassyAuth server */
  iss: string;
  /** Subject: sa_user.publicId (Sqid) */
  sub: string;
  /** Audience: sa_app.publicId (Sqid) of the target resource server */
  aud: string;
  /** Issued at (Unix seconds) */
  iat: number;
  /** Expires at (Unix seconds) */
  exp: number;
  /** Tenant: sa_org.publicId (Sqid) */
  org: string;
  /**
   * OAuth 2.0 scope claim — space-separated, sorted alphabetically. Union of
   * direct grants and all role permissions for the user, deduplicated.
   */
  scope: string;
}

/** Machine-readable codes returned as the `error` field in 4xx JWT responses. */
export enum TokenErrorCode {
  USER_ORG_MISMATCH = 'USER_ORG_MISMATCH',
  APP_NOT_FOUND = 'APP_NOT_FOUND',
  USER_NOT_FOUND = 'USER_NOT_FOUND',
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  INVALID_REQUEST = 'invalid_request',
  INVALID_REDIRECT_URI = 'invalid_redirect_uri',
  INVALID_GRANT = 'invalid_grant',
  UNAUTHORIZED_CLIENT = 'unauthorized_client',
}

/** Identifier type detected from the login identifier string. */
export type IdentifierType = 'email' | 'phone' | 'username';

/** Detects the type of a login identifier string. */
export function detectIdentifierType(identifier: string): IdentifierType {
  if (identifier.includes('@')) return 'email';
  if (/^\+?[\d\s\-().]{7,}$/.test(identifier)) return 'phone';
  return 'username';
}
```

- [ ] **Step 2: Confirm consumers compile after the type change**

Run from repo root:

```bash
pnpm --filter @sassy-auth/types build
pnpm --filter @sassy-auth/auth-server build
```

Expected: `@sassy-auth/auth-server` build FAILS — `oauth.service.ts` and `token.controller.ts` still reference `INVALID_CODE` / `CODE_EXPIRED`, and `token.service.ts` still writes `permissions`. That's exactly what later tasks fix. We're using the compile failures as a checklist.

- [ ] **Step 3: Note (do not commit yet)**

Do not commit. The repo is broken until Tasks 2–7 land. We'll commit at the end of Task 7 as one atomic auth-server change.

---

## Task 2: Add the `assertRedirectUriMatchesApp` helper (TDD)

**Files:**
- Create: `apps/auth-server/src/token/redirect-uri.ts`
- Test: `apps/auth-server/src/token/redirect-uri.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/auth-server/src/token/redirect-uri.spec.ts`:

```typescript
import { BadRequestException } from '@nestjs/common';
import { TokenErrorCode } from '@sassy-auth/types';
import { assertRedirectUriMatchesApp } from './redirect-uri';

describe('assertRedirectUriMatchesApp', () => {
  it('accepts exact origin with any path', () => {
    expect(() =>
      assertRedirectUriMatchesApp(
        'https://example.com/auth/callback',
        'https://example.com',
      ),
    ).not.toThrow();
  });

  it('accepts when the registered app.url has a trailing slash', () => {
    expect(() =>
      assertRedirectUriMatchesApp(
        'https://example.com/cb',
        'https://example.com/',
      ),
    ).not.toThrow();
  });

  it('rejects different hosts', () => {
    expect(() =>
      assertRedirectUriMatchesApp(
        'https://evil.example/cb',
        'https://example.com',
      ),
    ).toThrow(BadRequestException);
  });

  it('rejects different schemes', () => {
    expect(() =>
      assertRedirectUriMatchesApp(
        'http://example.com/cb',
        'https://example.com',
      ),
    ).toThrow(BadRequestException);
  });

  it('rejects different ports', () => {
    expect(() =>
      assertRedirectUriMatchesApp(
        'https://example.com:8443/cb',
        'https://example.com',
      ),
    ).toThrow(BadRequestException);
  });

  it('rejects malformed redirect_uri with TokenErrorCode.INVALID_REDIRECT_URI', () => {
    try {
      assertRedirectUriMatchesApp('not a url', 'https://example.com');
      fail('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      expect((e as Error).message).toContain(TokenErrorCode.INVALID_REDIRECT_URI);
    }
  });

  it('rejects malformed app.url with TokenErrorCode.INVALID_REDIRECT_URI', () => {
    expect(() =>
      assertRedirectUriMatchesApp('https://example.com/cb', 'not a url'),
    ).toThrow(/invalid_redirect_uri/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @sassy-auth/auth-server exec jest src/token/redirect-uri.spec.ts
```

Expected: FAIL — module `./redirect-uri` not found.

- [ ] **Step 3: Implement the helper**

Create `apps/auth-server/src/token/redirect-uri.ts`:

```typescript
import { BadRequestException } from '@nestjs/common';
import { TokenErrorCode } from '@sassy-auth/types';

/**
 * Asserts that `redirectUri` and `appUrl` share the same origin
 * (scheme + host + port). Paths under the registered origin are allowed.
 */
export function assertRedirectUriMatchesApp(
  redirectUri: string,
  appUrl: string,
): void {
  let redirectOrigin: string;
  let appOrigin: string;
  try {
    redirectOrigin = new URL(redirectUri).origin;
    appOrigin = new URL(appUrl).origin;
  } catch {
    throw new BadRequestException(TokenErrorCode.INVALID_REDIRECT_URI);
  }
  if (redirectOrigin !== appOrigin) {
    throw new BadRequestException(TokenErrorCode.INVALID_REDIRECT_URI);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @sassy-auth/auth-server exec jest src/token/redirect-uri.spec.ts
```

Expected: 7 tests PASS.

---

## Task 3: Rewrite `OauthService` for PKCE (TDD)

**Files:**
- Modify: `apps/auth-server/src/token/oauth.service.ts`
- Modify: `apps/auth-server/src/token/oauth.service.spec.ts`

- [ ] **Step 1: Replace the spec contents with the new PKCE tests**

Replace `apps/auth-server/src/token/oauth.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import * as crypto from 'crypto';
import { OauthService } from './oauth.service';

function s256(verifier: string): string {
  return crypto
    .createHash('sha256')
    .update(verifier)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

describe('OauthService', () => {
  let service: OauthService;
  const VERIFIER = 'a'.repeat(64);
  const CHALLENGE = s256(VERIFIER);

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [OauthService],
    }).compile();
    service = module.get(OauthService);
    jest.useRealTimers();
  });

  describe('generateCode', () => {
    it('returns a non-empty unique string code', () => {
      const a = service.generateCode('user-1', 'app-1', CHALLENGE, 'S256');
      const b = service.generateCode('user-1', 'app-1', CHALLENGE, 'S256');
      expect(typeof a).toBe('string');
      expect(a.length).toBeGreaterThan(10);
      expect(a).not.toBe(b);
    });
  });

  describe('exchangeCode', () => {
    it('returns userId and appPublicId when verifier matches', () => {
      const code = service.generateCode('user-99', 'app-55', CHALLENGE, 'S256');
      const result = service.exchangeCode(code, 'app-55', VERIFIER);
      expect(result).toEqual({ userId: 'user-99', appPublicId: 'app-55' });
    });

    it('throws invalid_grant when code does not exist', () => {
      expect(() => service.exchangeCode('nonexistent', 'app-1', VERIFIER)).toThrow(
        /invalid_grant/,
      );
    });

    it('throws unauthorized_client when client_id does not match', () => {
      const code = service.generateCode('user-1', 'app-correct', CHALLENGE, 'S256');
      expect(() => service.exchangeCode(code, 'app-wrong', VERIFIER)).toThrow(
        /unauthorized_client/,
      );
    });

    it('throws invalid_grant when verifier does not match challenge', () => {
      const code = service.generateCode('user-1', 'app-1', CHALLENGE, 'S256');
      expect(() => service.exchangeCode(code, 'app-1', 'wrong-verifier')).toThrow(
        /invalid_grant/,
      );
    });

    it('throws invalid_grant when code is expired', () => {
      jest.useFakeTimers();
      const code = service.generateCode('user-1', 'app-1', CHALLENGE, 'S256');
      jest.advanceTimersByTime(6 * 60 * 1000);
      expect(() => service.exchangeCode(code, 'app-1', VERIFIER)).toThrow(
        /invalid_grant/,
      );
    });

    it('invalidates a code after first use', () => {
      const code = service.generateCode('user-1', 'app-1', CHALLENGE, 'S256');
      service.exchangeCode(code, 'app-1', VERIFIER);
      expect(() => service.exchangeCode(code, 'app-1', VERIFIER)).toThrow(
        /invalid_grant/,
      );
    });
  });
});
```

- [ ] **Step 2: Run spec to confirm it fails**

```bash
pnpm --filter @sassy-auth/auth-server exec jest src/token/oauth.service.spec.ts
```

Expected: tests FAIL because `generateCode` doesn't accept extra args and `exchangeCode` doesn't accept a verifier.

- [ ] **Step 3: Replace the service with the PKCE implementation**

Replace `apps/auth-server/src/token/oauth.service.ts`:

```typescript
import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';
import { TokenErrorCode } from '@sassy-auth/types';

interface AuthCode {
  userId: string;
  appPublicId: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
  expiresAt: Date;
}

const CODE_TTL_MS = 5 * 60 * 1000;

function base64UrlEncode(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function s256(verifier: string): string {
  return base64UrlEncode(crypto.createHash('sha256').update(verifier).digest());
}

@Injectable()
export class OauthService {
  private readonly codes = new Map<string, AuthCode>();

  generateCode(
    userId: string,
    appPublicId: string,
    codeChallenge: string,
    codeChallengeMethod: 'S256',
  ): string {
    const code = crypto.randomBytes(32).toString('hex');
    this.codes.set(code, {
      userId,
      appPublicId,
      codeChallenge,
      codeChallengeMethod,
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    });
    return code;
  }

  exchangeCode(
    code: string,
    appPublicId: string,
    codeVerifier: string,
  ): { userId: string; appPublicId: string } {
    const entry = this.codes.get(code);

    if (!entry) {
      throw new UnauthorizedException(TokenErrorCode.INVALID_GRANT);
    }

    if (entry.appPublicId !== appPublicId) {
      this.codes.delete(code);
      throw new UnauthorizedException(TokenErrorCode.UNAUTHORIZED_CLIENT);
    }

    if (entry.expiresAt < new Date()) {
      this.codes.delete(code);
      throw new UnauthorizedException(TokenErrorCode.INVALID_GRANT);
    }

    const expected = Buffer.from(entry.codeChallenge, 'utf8');
    const actual = Buffer.from(s256(codeVerifier), 'utf8');
    if (
      expected.length !== actual.length ||
      !crypto.timingSafeEqual(expected, actual)
    ) {
      this.codes.delete(code);
      throw new UnauthorizedException(TokenErrorCode.INVALID_GRANT);
    }

    this.codes.delete(code);
    return { userId: entry.userId, appPublicId: entry.appPublicId };
  }
}
```

- [ ] **Step 4: Run the spec to confirm it passes**

```bash
pnpm --filter @sassy-auth/auth-server exec jest src/token/oauth.service.spec.ts
```

Expected: 7 tests PASS.

---

## Task 4: Update the token-exchange DTO

**Files:**
- Modify: `apps/auth-server/src/token/dto/oauth-token-exchange.dto.ts`

- [ ] **Step 1: Replace the file**

```typescript
import { IsString, IsNotEmpty, IsUrl } from 'class-validator';

export class OauthTokenExchangeDto {
  @IsString()
  @IsNotEmpty()
  code!: string;

  /** sa_app.publicId — must match the app that requested the code. */
  @IsString()
  @IsNotEmpty()
  client_id!: string;

  /** PKCE code verifier — the plaintext that was used to derive the
   *  code_challenge sent on the authorize call. */
  @IsString()
  @IsNotEmpty()
  code_verifier!: string;

  @IsUrl()
  redirect_uri!: string;
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm --filter @sassy-auth/auth-server exec tsc --noEmit
```

Expected: errors still in `token.controller.ts` and `token.service.ts` (those land in Tasks 5–7); the DTO file itself compiles.

---

## Task 5: Wire PKCE + redirect-uri match into `/oauth/authorize`

**Files:**
- Modify: `apps/auth-server/src/token/token.controller.ts` (the `oauthAuthorize` method, lines ~54–108)

- [ ] **Step 1: Update the method**

Replace the entire `oauthAuthorize` method with:

```typescript
@Get('oauth/authorize')
@Redirect()
async oauthAuthorize(
  @Query('client_id') clientId: string,
  @Query('redirect_uri') redirectUri: string,
  @Query('code_challenge') codeChallenge: string,
  @Query('code_challenge_method') codeChallengeMethod: string,
  @Query('state') state: string = '',
  @Req() req: Request,
) {
  if (!codeChallenge || codeChallengeMethod !== 'S256') {
    throw new BadRequestException(TokenErrorCode.INVALID_REQUEST);
  }

  let numericId: number;
  try {
    numericId = this.sqidService.decode(clientId);
  } catch {
    throw new BadRequestException(TokenErrorCode.APP_NOT_FOUND);
  }
  const app = await prisma.saApp.findUnique({ where: { id: numericId } });
  if (!app) {
    throw new NotFoundException(TokenErrorCode.APP_NOT_FOUND);
  }

  assertRedirectUriMatchesApp(redirectUri, app.url);

  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
  });
  if (!session) {
    throw new UnauthorizedException();
  }

  const saUser = await prisma.saUser.findFirst({
    where: { betterAuthUserId: session.user.id },
    include: { org: true },
  });
  if (!saUser) {
    throw new ForbiddenException(TokenErrorCode.USER_NOT_FOUND);
  }
  if (saUser.org.appId !== app.id) {
    throw new ForbiddenException(TokenErrorCode.USER_ORG_MISMATCH);
  }

  const code = this.oauthService.generateCode(
    saUser.publicId,
    app.publicId,
    codeChallenge,
    'S256',
  );
  const url = new URL(redirectUri);
  url.searchParams.set('code', code);
  if (state) url.searchParams.set('state', state);

  this.logger.getWinstonLogger().info('OAuth authorization code issued', {
    context: 'TokenController',
    appId: clientId,
    userId: saUser.publicId,
    pkceMethod: 'S256',
    redirectUriOrigin: new URL(redirectUri).origin,
  });
  Sentry.setTag('authFlow', 'oauth');
  Sentry.setTag('appId', clientId);

  return { url: url.toString(), statusCode: 302 };
}
```

- [ ] **Step 2: Add the import**

At the top of the file, add to the existing imports:

```typescript
import { assertRedirectUriMatchesApp } from './redirect-uri';
```

(Place it in the project-local import block, after `TokenService`.)

---

## Task 6: Wire PKCE verification + redirect-uri match into `/oauth/token`

**Files:**
- Modify: `apps/auth-server/src/token/token.controller.ts` (the `oauthToken` method)

- [ ] **Step 1: Update the method**

Replace the `oauthToken` method with:

```typescript
@Post('oauth/token')
async oauthToken(@Body() dto: OauthTokenExchangeDto) {
  let numericId: number;
  try {
    numericId = this.sqidService.decode(dto.client_id);
  } catch {
    throw new BadRequestException(TokenErrorCode.APP_NOT_FOUND);
  }
  const app = await prisma.saApp.findUnique({ where: { id: numericId } });
  if (!app) {
    throw new NotFoundException(TokenErrorCode.APP_NOT_FOUND);
  }

  assertRedirectUriMatchesApp(dto.redirect_uri, app.url);

  const { userId: userPublicId, appPublicId } = this.oauthService.exchangeCode(
    dto.code,
    dto.client_id,
    dto.code_verifier,
  );

  const saUser = await prisma.saUser.findFirst({
    where: { publicId: userPublicId },
    include: { org: true },
  });
  if (!saUser) {
    throw new ForbiddenException(TokenErrorCode.USER_NOT_FOUND);
  }

  const token = await this.tokenService.issueJwt({
    saUserId: saUser.id,
    userPublicId: saUser.publicId,
    orgPublicId: saUser.org.publicId,
    appPublicId,
  });

  this.logger.getWinstonLogger().info('OAuth code exchanged, JWT issued', {
    context: 'TokenController',
    appId: appPublicId,
    userId: userPublicId,
    pkceMethod: 'S256',
  });

  return { access_token: token, token_type: 'Bearer', expires_in: 3600 };
}
```

---

## Task 7: Switch `issueJwt` to emit a `scope` string + commit

**Files:**
- Modify: `apps/auth-server/src/token/token.service.ts`
- Modify: `apps/auth-server/src/token/token.service.spec.ts`

- [ ] **Step 1: Update `issueJwt`**

In `apps/auth-server/src/token/token.service.ts`, replace the `payload` block inside `issueJwt`:

```typescript
const permissions = await this.resolvePermissions(params.saUserId);
const issuer = process.env.BETTER_AUTH_URL ?? 'https://auth.example.com';
const now = Math.floor(Date.now() / 1000);

const payload = {
  sub: params.userPublicId,
  aud: params.appPublicId,
  org: params.orgPublicId,
  iss: issuer,
  iat: now,
  exp: now + 3600,
  scope: permissions.join(' '),
};

return jwt.sign(payload, this.privateKey, { algorithm: 'RS256' });
```

- [ ] **Step 2: Update the existing token.service spec**

Open `apps/auth-server/src/token/token.service.spec.ts`. For every test that asserts `expect(decoded.permissions).toEqual([...])`, change the assertion to:

```typescript
expect(decoded.scope).toBe([...].join(' '));
// and:
expect(typeof decoded.scope).toBe('string');
// and remove any `expect('permissions' in decoded)` style checks
```

If the spec inspects `permissions` for empty-array behavior, change it to `expect(decoded.scope).toBe('')`.

- [ ] **Step 3: Run all token unit tests**

```bash
pnpm --filter @sassy-auth/auth-server exec jest src/token
```

Expected: all of `oauth.service.spec.ts`, `redirect-uri.spec.ts`, `token.service.spec.ts`, `token.controller.spec.ts` PASS. If `token.controller.spec.ts` fails because mocks need updating, update them in this step to match the new `oauthService.generateCode(uid, appId, challenge, 'S256')` and `exchangeCode(code, appId, verifier)` signatures.

- [ ] **Step 4: Commit the auth-server PKCE + scope change**

```bash
git add packages/types/index.ts \
  apps/auth-server/src/token/oauth.service.ts \
  apps/auth-server/src/token/oauth.service.spec.ts \
  apps/auth-server/src/token/redirect-uri.ts \
  apps/auth-server/src/token/redirect-uri.spec.ts \
  apps/auth-server/src/token/dto/oauth-token-exchange.dto.ts \
  apps/auth-server/src/token/token.controller.ts \
  apps/auth-server/src/token/token.controller.spec.ts \
  apps/auth-server/src/token/token.service.ts \
  apps/auth-server/src/token/token.service.spec.ts
git commit -m "feat(auth): OAuth2 PKCE (S256), redirect_uri origin match, scope claim

- @sassy-auth/types: JWT now uses 'scope' (space-separated) instead of
  'permissions' (string[]). Adds invalid_request / invalid_redirect_uri /
  invalid_grant / unauthorized_client error codes; removes INVALID_CODE
  and CODE_EXPIRED (collapsed per RFC 6749 §5.2).
- OauthService: stores PKCE code_challenge with each code, verifies
  S256(code_verifier) in constant time on exchange.
- TokenController: /oauth/authorize requires code_challenge +
  code_challenge_method=S256; /oauth/token requires code_verifier and
  drops client_secret. Both validate redirect_uri origin against
  sa_app.url."
```

---

## Task 8: Update the auth-server e2e test for the PKCE round-trip

**Files:**
- Modify: `apps/auth-server/test/app.e2e-spec.ts`

- [ ] **Step 1: Find and update the existing `permissions` claim assertion**

Open `apps/auth-server/test/app.e2e-spec.ts`. The current direct-login test asserts (around line 148):

```typescript
expect(Array.isArray(decoded.permissions)).toBe(true);
```

Replace it with:

```typescript
expect(typeof decoded.scope).toBe('string');
```

- [ ] **Step 2: Update the existing "invalid code" test**

The block around line 186 ("`POST /api/token/oauth/token returns 401 for invalid code`") currently sends `{ code, client_id, client_secret, redirect_uri }`. Replace its request body shape with the new DTO. Example (adapt to the exact existing assertions in the file):

```typescript
const res = await request(httpServer)
  .post('/api/token/oauth/token')
  .send({
    code: 'definitely-not-a-real-code',
    client_id: '84LR',
    code_verifier: 'a'.repeat(64),
    redirect_uri: 'https://cheryl-crescentlike-monte.ngrok-free.dev/auth/callback',
  })
  .expect(401);
expect(res.body.message).toContain('invalid_grant');
```

If the test's app isn't registered yet in test DB, use an app `client_id` that IS registered in the existing seed (the platform app or whatever the file already uses). The key is the new request shape.

- [ ] **Step 3: Add a new full PKCE round-trip test**

Add this test inside the existing `describe('TokenController (e2e)', () => { ... })` (or whichever top-level describe block houses the oauth tests):

```typescript
describe('OAuth PKCE round-trip', () => {
  function s256(verifier: string): string {
    return require('crypto')
      .createHash('sha256')
      .update(verifier)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  it('authorize → token returns a JWT with scope (string)', async () => {
    // 1. Establish a BetterAuth session via direct sign-in (same pattern
    //    used elsewhere in this file).
    const signInRes = await request(httpServer)
      .post('/api/auth/sign-in/email')
      .send({ email: 's@sa.io', password: 'Pass@word1234' })
      .expect(200);
    const cookies = (signInRes.headers['set-cookie'] as unknown as string[]) || [];
    const sessionCookie = cookies.find((c) =>
      c.startsWith('better-auth.session_token='),
    );
    expect(sessionCookie).toBeTruthy();

    // 2. Look up the platform app's publicId from the seed.
    const app = await prisma.saApp.findFirstOrThrow({ where: { isPlatform: true } });

    // 3. Build PKCE pair and call /api/token/oauth/authorize.
    const verifier = 'a'.repeat(64);
    const challenge = s256(verifier);
    const redirectUri = `${app.url.replace(/\/$/, '')}/cb`;
    const authorizeRes = await request(httpServer)
      .get('/api/token/oauth/authorize')
      .query({
        client_id: app.publicId,
        redirect_uri: redirectUri,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state: 'xyz',
      })
      .set('Cookie', sessionCookie!.split(';')[0])
      .expect(302);
    const location = authorizeRes.headers.location as string;
    const code = new URL(location).searchParams.get('code');
    expect(code).toBeTruthy();

    // 4. Exchange the code.
    const tokenRes = await request(httpServer)
      .post('/api/token/oauth/token')
      .send({
        code,
        client_id: app.publicId,
        code_verifier: verifier,
        redirect_uri: redirectUri,
      })
      .expect(201);
    expect(tokenRes.body.access_token).toBeTruthy();

    // 5. Verify the JWT carries `scope` (string) and not `permissions`.
    const decoded = jwt.verify(tokenRes.body.access_token, publicPem, {
      algorithms: ['RS256'],
    }) as Record<string, unknown>;
    expect(typeof decoded.scope).toBe('string');
    expect('permissions' in decoded).toBe(false);
  });
});
```

(`publicPem` is the same variable used earlier in the file — reuse, don't redeclare.)

- [ ] **Step 4: Run the e2e suite**

```bash
pnpm --filter @sassy-auth/auth-server exec jest --config ./test/jest-e2e.json
```

Expected: all e2e tests PASS. If a previous test still references `decoded.permissions` somewhere we missed, fix in place.

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/test/app.e2e-spec.ts
git commit -m "test(auth): e2e PKCE authorize→token + scope claim"
```

---

## Task 9: Add the idempotent demo seed

**Files:**
- Create: `apps/auth-server/src/seed/demo-resource-server.ts`
- Modify: `apps/auth-server/src/seed/seed.ts` (call demo seed when `SEED_DEMO=1`)

- [ ] **Step 1: Create the demo seed module**

`apps/auth-server/src/seed/demo-resource-server.ts`:

```typescript
import { prisma } from '@sassy-auth/db';
import Sqids from 'sqids';
import { auth } from '../auth/auth.config';

const sqids = new Sqids({
  alphabet: process.env.SQIDS_ALPHABET || undefined,
  minLength: 4,
});

const APP_NAME = 'resourceserver01';
const APP_URL = 'https://cheryl-crescentlike-monte.ngrok-free.dev/';
const ORG_NAME = 'Citadel';

const PERMISSIONS = [
  'rs.properties.create',
  'rs.properties.read',
  'rs.properties.update',
  'rs.properties.delete',
  'rs.inspections.create',
  'rs.inspections.read',
  'rs.inspections.update',
  'rs.inspections.delete',
] as const;

const ROLE_PROPERTY_MANAGERS = 'Citadel Property Managers';
const ROLE_INSPECTORS = 'Citadel Inspectors';

const ROLE_PERMS: Record<string, readonly string[]> = {
  [ROLE_PROPERTY_MANAGERS]: PERMISSIONS, // all 8
  [ROLE_INSPECTORS]: [
    'rs.inspections.create',
    'rs.inspections.read',
    'rs.inspections.update',
    'rs.properties.read',
    'rs.properties.update',
  ],
};

const USERS = [
  {
    email: 'm@cpm.io',
    firstName: 'Citadel',
    lastName: 'Manager',
    role: ROLE_PROPERTY_MANAGERS,
  },
  {
    email: 'i@cpm.io',
    firstName: 'Citadel',
    lastName: 'Inspector',
    role: ROLE_INSPECTORS,
  },
] as const;

const PASSWORD = 'Pass@word1234';

async function ensureApp() {
  const found = await prisma.saApp.findUnique({ where: { name: APP_NAME } });
  if (found) return found;
  return prisma.$transaction(async (tx) => {
    const created = await tx.saApp.create({
      data: { publicId: 'placeholder', name: APP_NAME, url: APP_URL, isPlatform: false },
    });
    return tx.saApp.update({
      where: { id: created.id },
      data: { publicId: sqids.encode([created.id]) },
    });
  });
}

async function ensureOrg(appId: number) {
  const found = await prisma.saOrg.findFirst({ where: { appId, name: ORG_NAME } });
  if (found) return found;
  return prisma.$transaction(async (tx) => {
    const created = await tx.saOrg.create({
      data: { publicId: 'placeholder', name: ORG_NAME, appId, isPlatform: false },
    });
    return tx.saOrg.update({
      where: { id: created.id },
      data: { publicId: sqids.encode([created.id]) },
    });
  });
}

async function ensurePermissions(appId: number) {
  const out = new Map<string, { id: number }>();
  for (const name of PERMISSIONS) {
    let perm = await prisma.saPermission.findUnique({ where: { name } });
    if (!perm) {
      perm = await prisma.$transaction(async (tx) => {
        const c = await tx.saPermission.create({
          data: { publicId: 'placeholder', name, appId },
        });
        return tx.saPermission.update({
          where: { id: c.id },
          data: { publicId: sqids.encode([c.id]) },
        });
      });
    }
    out.set(name, { id: perm.id });
  }
  return out;
}

async function ensureRole(
  appId: number,
  roleName: string,
  permIds: number[],
) {
  let role = await prisma.saRole.findFirst({ where: { appId, name: roleName } });
  if (!role) {
    role = await prisma.$transaction(async (tx) => {
      const c = await tx.saRole.create({
        data: { publicId: 'placeholder', name: roleName, appId },
      });
      return tx.saRole.update({
        where: { id: c.id },
        data: { publicId: sqids.encode([c.id]) },
      });
    });
  }
  for (const permissionId of permIds) {
    await prisma.saRolePermission.upsert({
      where: { roleId_permissionId: { roleId: role.id, permissionId } },
      create: { roleId: role.id, permissionId },
      update: {},
    });
  }
  return role;
}

async function ensureUser(
  email: string,
  firstName: string,
  lastName: string,
  orgId: number,
  roleId: number,
) {
  const existing = await prisma.user.findUnique({ where: { email } });
  let baUserId: string;
  if (existing) {
    baUserId = existing.id;
  } else {
    const result = await auth.api.signUpEmail({
      body: { email, password: PASSWORD, name: `${firstName} ${lastName}` },
    });
    baUserId = result.user.id;
    await prisma.user.update({ where: { id: baUserId }, data: { emailVerified: true } });
  }

  let saUser = await prisma.saUser.findFirst({ where: { betterAuthUserId: baUserId } });
  if (!saUser) {
    saUser = await prisma.$transaction(async (tx) => {
      const c = await tx.saUser.create({
        data: {
          publicId: 'placeholder',
          betterAuthUserId: baUserId,
          orgId,
          firstName,
          lastName,
          status: 'active',
        },
      });
      return tx.saUser.update({
        where: { id: c.id },
        data: { publicId: sqids.encode([c.id]) },
      });
    });
  }

  await prisma.saUserRole.upsert({
    where: { userId_roleId: { userId: saUser.id, roleId } },
    create: { userId: saUser.id, roleId },
    update: {},
  });
}

export async function seedDemoResourceServer() {
  console.log('[demo] Seeding resourceserver01 demo data...');
  const app = await ensureApp();
  const org = await ensureOrg(app.id);
  const perms = await ensurePermissions(app.id);

  const rolePM = await ensureRole(
    app.id,
    ROLE_PROPERTY_MANAGERS,
    ROLE_PERMS[ROLE_PROPERTY_MANAGERS].map((n) => perms.get(n)!.id),
  );
  const roleIns = await ensureRole(
    app.id,
    ROLE_INSPECTORS,
    ROLE_PERMS[ROLE_INSPECTORS].map((n) => perms.get(n)!.id),
  );
  const rolesByName: Record<string, number> = {
    [ROLE_PROPERTY_MANAGERS]: rolePM.id,
    [ROLE_INSPECTORS]: roleIns.id,
  };

  for (const u of USERS) {
    await ensureUser(u.email, u.firstName, u.lastName, org.id, rolesByName[u.role]);
  }
  console.log('[demo] Done.');
}
```

- [ ] **Step 2: Wire into `seed.ts`**

Open `apps/auth-server/src/seed/seed.ts`. After the `main()` function's existing body — just before `console.log('Seed complete.')` — add:

```typescript
  if (process.env.SEED_DEMO === '1') {
    const { seedDemoResourceServer } = await import('./demo-resource-server');
    await seedDemoResourceServer();
  }
```

- [ ] **Step 3: Run the seed against the live DB (idempotency check)**

The live DB already has `resourceserver01`, `Citadel`, the 8 perms, the 2 roles, and m@/i@. Running the demo seed must be a no-op.

```bash
SEED_DEMO=1 pnpm --filter @sassy-auth/auth-server seed
```

Expected: no errors. Console prints `[demo] Done.` Existing rows (with UUID-style publicIds) untouched.

- [ ] **Step 4: Verify no rows were rewritten**

```bash
PGPASSWORD=betterauth psql -h localhost -p 5432 -U betterauth_admin -d sassyauth_0.1 -At -F'|' -c "SELECT \"publicId\", name FROM \"SaApp\" WHERE name='resourceserver01';"
```

Expected: `84LR|resourceserver01` (the existing publicId is preserved).

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/seed/demo-resource-server.ts apps/auth-server/src/seed/seed.ts
git commit -m "feat(seed): idempotent demo seed for resourceserver01 (SEED_DEMO=1)"
```

---

## Task 10: Add `validateNextUrl` (TDD) to the admin app

**Files:**
- Create: `apps/admin/lib/safe-next.ts`
- Test: `apps/admin/lib/safe-next.spec.ts`

- [ ] **Step 1: Write the failing test**

`apps/admin/lib/safe-next.spec.ts`:

```typescript
import { validateNextUrl } from './safe-next'

describe('validateNextUrl', () => {
  const ORIGINAL_ENV = process.env

  beforeEach(() => {
    process.env = {
      ...ORIGINAL_ENV,
      AUTH_SERVER_URL: 'http://localhost:3000',
      LOGIN_NEXT_ALLOWED_ORIGINS: '',
    }
  })

  afterAll(() => {
    process.env = ORIGINAL_ENV
  })

  it('returns null for empty/missing input', () => {
    expect(validateNextUrl(null)).toBeNull()
    expect(validateNextUrl(undefined)).toBeNull()
    expect(validateNextUrl('')).toBeNull()
  })

  it('accepts same-origin paths', () => {
    expect(validateNextUrl('/users')).toBe('/users')
    expect(validateNextUrl('/orgs/abc')).toBe('/orgs/abc')
  })

  it('rejects protocol-relative URLs disguised as paths', () => {
    expect(validateNextUrl('//evil.example.com/x')).toBeNull()
  })

  it('rejects backslash-disguised paths', () => {
    expect(validateNextUrl('/\\evil.example.com')).toBeNull()
  })

  it('accepts absolute URLs with allowed origin', () => {
    const url = 'http://localhost:3000/api/token/oauth/authorize?client_id=x'
    expect(validateNextUrl(url)).toBe(url)
  })

  it('rejects absolute URLs with disallowed origin', () => {
    expect(validateNextUrl('https://evil.example.com/auth')).toBeNull()
  })

  it('rejects userinfo URLs', () => {
    expect(
      validateNextUrl('http://attacker@localhost:3000/api/token/oauth/authorize'),
    ).toBeNull()
  })

  it('rejects malformed URLs', () => {
    expect(validateNextUrl('http://[not a url')).toBeNull()
  })

  it('honors LOGIN_NEXT_ALLOWED_ORIGINS env additions', () => {
    process.env.LOGIN_NEXT_ALLOWED_ORIGINS = 'https://other.example.com'
    expect(validateNextUrl('https://other.example.com/cb')).toBe(
      'https://other.example.com/cb',
    )
  })
})
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
pnpm --filter @sassy-auth/admin exec jest lib/safe-next.spec.ts
```

Expected: FAIL — `safe-next` not found.

- [ ] **Step 3: Implement**

`apps/admin/lib/safe-next.ts`:

```typescript
function allowlist(): string[] {
  const base = process.env.AUTH_SERVER_URL ?? 'http://localhost:3000'
  const extra = (process.env.LOGIN_NEXT_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return [base, ...extra]
}

export function validateNextUrl(next: string | null | undefined): string | null {
  if (!next) return null

  // Same-origin path: must start with "/" and not be a protocol-relative
  // URL ("//x") or contain backslashes.
  if (next.startsWith('/')) {
    if (next.startsWith('//')) return null
    if (next.includes('\\')) return null
    return next
  }

  let url: URL
  try {
    url = new URL(next)
  } catch {
    return null
  }

  if (url.username || url.password) return null

  if (allowlist().includes(url.origin)) {
    return url.toString()
  }
  return null
}
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
pnpm --filter @sassy-auth/admin exec jest lib/safe-next.spec.ts
```

Expected: all PASS.

---

## Task 11: Surface `next` on the login form

**Files:**
- Modify: `apps/admin/app/login/page.tsx`

- [ ] **Step 1: Replace the file**

```tsx
'use client'

import { useTranslations } from 'next-intl'
import { useActionState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Button } from '@sassy-auth/ui'
import { signIn } from './actions'

export default function LoginPage() {
  const t = useTranslations('login')
  const next = useSearchParams().get('next') ?? ''
  const [state, formAction, isPending] = useActionState(
    async (_prev: { error?: string }, formData: FormData) => signIn(formData),
    {},
  )

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--background)]">
      <div className="w-full max-w-sm rounded-lg border border-[var(--border)] bg-[var(--card)] p-8 shadow-sm">
        <div className="mb-6 text-center">
          <h1 className="text-headline-sm text-[var(--foreground)]">{t('title')}</h1>
          <p className="mt-1 text-body-sm text-[var(--muted-foreground)]">{t('subtitle')}</p>
        </div>

        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="next" value={next} />

          <div className="flex flex-col gap-1.5">
            <label className="text-label-md font-semibold" htmlFor="email">{t('email')}</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              className="flex h-9 w-full rounded border border-[var(--border)] bg-[var(--card)] px-3 text-body-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-label-md font-semibold" htmlFor="password">{t('password')}</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="flex h-9 w-full rounded border border-[var(--border)] bg-[var(--card)] px-3 text-body-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            />
          </div>

          {state?.error && (
            <p data-testid="login-error" className="text-label-md text-[var(--destructive)]">
              {state.error === 'invalidCredentials' ||
              state.error === 'inactive' ||
              state.error === 'serverUnavailable'
                ? t(`error.${state.error}`)
                : state.error}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={isPending}>
            {isPending ? '…' : t('submit')}
          </Button>
        </form>
      </div>
    </div>
  )
}
```

---

## Task 12: Consume `next` in the signIn action

**Files:**
- Modify: `apps/admin/app/login/actions.ts`

- [ ] **Step 1: Update the action**

In `actions.ts`, add the import at the top:

```typescript
import { validateNextUrl } from '@/lib/safe-next'
```

Then replace the very last line of `signIn` (`redirect('/users')`) with:

```typescript
  const nextRaw = formData.get('next')
  const nextSafe = typeof nextRaw === 'string' ? validateNextUrl(nextRaw) : null
  redirect(nextSafe ?? '/users')
```

(Place this AFTER the existing `Sentry.addBreadcrumb('Admin login successful')` block — same point where the existing `redirect('/users')` sits.)

- [ ] **Step 2: Build the admin app**

```bash
pnpm --filter @sassy-auth/admin build
```

Expected: build succeeds. (Next compiles the server action; if the `@/lib/safe-next` path alias doesn't resolve, fall back to the relative `'../../lib/safe-next'`.)

- [ ] **Step 3: Commit the admin changes**

```bash
git add apps/admin/lib/safe-next.ts apps/admin/lib/safe-next.spec.ts \
  apps/admin/app/login/page.tsx apps/admin/app/login/actions.ts
git commit -m "feat(admin): /login honors validated next= URL

Adds validateNextUrl() with an AUTH_SERVER_URL-rooted origin allowlist
(plus optional LOGIN_NEXT_ALLOWED_ORIGINS). page.tsx surfaces next as a
hidden input; signIn redirects to the validated URL after a successful
BetterAuth login. Same-origin paths, allowed absolute URLs, and bad
inputs are all explicitly tested."
```

---

## Task 13: Scaffold the Python project

**Files:**
- Create: `apps/resource-server-fastapi/pyproject.toml`
- Create: `apps/resource-server-fastapi/.env.example`
- Create: `apps/resource-server-fastapi/.gitignore`
- Create: `apps/resource-server-fastapi/README.md`
- Create: `apps/resource-server-fastapi/app/__init__.py` (empty)
- Create: `apps/resource-server-fastapi/app/oauth/__init__.py` (empty)
- Create: `apps/resource-server-fastapi/app/api/__init__.py` (empty)
- Create: `apps/resource-server-fastapi/app/web/__init__.py` (empty)
- Create: `apps/resource-server-fastapi/tests/__init__.py` (empty)

- [ ] **Step 1: Create the directory layout**

```bash
mkdir -p apps/resource-server-fastapi/app/oauth \
         apps/resource-server-fastapi/app/api \
         apps/resource-server-fastapi/app/web \
         apps/resource-server-fastapi/app/templates \
         apps/resource-server-fastapi/app/static \
         apps/resource-server-fastapi/tests
touch apps/resource-server-fastapi/app/__init__.py \
      apps/resource-server-fastapi/app/oauth/__init__.py \
      apps/resource-server-fastapi/app/api/__init__.py \
      apps/resource-server-fastapi/app/web/__init__.py \
      apps/resource-server-fastapi/tests/__init__.py
```

- [ ] **Step 2: `pyproject.toml`**

```toml
[project]
name = "resource-server-fastapi"
version = "0.1.0"
description = "Demo OAuth 2.0 resource server (PKCE) for SassyAuth"
requires-python = ">=3.11"
dependencies = [
  "fastapi>=0.115",
  "uvicorn[standard]>=0.32",
  "httpx>=0.27",
  "pyjwt[crypto]>=2.9",
  "pydantic-settings>=2.5",
  "jinja2>=3.1",
]

[project.optional-dependencies]
dev = [
  "pytest>=8",
  "pytest-asyncio>=0.24",
  "cryptography>=43",
]

[tool.uv]
package = false

[tool.pytest.ini_options]
testpaths = ["tests"]
asyncio_mode = "auto"
```

- [ ] **Step 3: `.env.example`**

```bash
# Auth server (NestJS) and admin UI (Next.js).
AUTH_SERVER_URL=http://localhost:3000
ADMIN_URL=http://localhost:3001

# sa_app.publicId for resourceserver01 in your local DB.
SASSY_CLIENT_ID=84LR

# Browser-facing base URL of this RS (ngrok or similar).
RS_BASE_URL=https://cheryl-crescentlike-monte.ngrok-free.dev
REDIRECT_URI=https://cheryl-crescentlike-monte.ngrok-free.dev/auth/callback

# JWT validation defaults to AUTH_SERVER_URL / SASSY_CLIENT_ID; override if needed.
# EXPECTED_ISSUER=http://localhost:3000
# EXPECTED_AUDIENCE=84LR

PKCE_STATE_TTL_SECONDS=600
LOG_LEVEL=info
```

- [ ] **Step 4: `.gitignore`**

```gitignore
.venv/
__pycache__/
*.pyc
.env
.pytest_cache/
uv.lock
```

- [ ] **Step 5: `README.md`**

```markdown
# resource-server-fastapi

A minimal Python/FastAPI OAuth 2.0 resource server demonstrating SassyAuth's
authorization-code + PKCE flow.

## Run

```bash
uv sync
cp .env.example .env  # set SASSY_CLIENT_ID etc.
uv run uvicorn app.main:app --port 8010 --reload
```

Requires the auth-server (`localhost:3000`) and admin (`localhost:3001`) to be
running, and the demo seed (`SEED_DEMO=1 pnpm --filter @sassy-auth/auth-server seed`)
to have populated `resourceserver01` + the two demo users.

## Demo users (from the seed)

- `m@cpm.io` / `Pass@word1234` → role `Citadel Property Managers` (has `rs.properties.create`)
- `i@cpm.io` / `Pass@word1234` → role `Citadel Inspectors` (does not)

After Sign In, the protected `/api/properties` endpoint returns
`{ "result": "Authorized" }` for the first user, `403` with
`{ "result": "Unauthorized", "reason": "insufficient_scope" }` for the second.

## Tests

```bash
uv run pytest
```
```

- [ ] **Step 6: Initialize the venv and lockfile**

```bash
cd apps/resource-server-fastapi
uv sync --extra dev
```

Expected: creates `.venv/`, resolves all deps, writes `uv.lock`.

- [ ] **Step 7: Commit the scaffold**

```bash
git add apps/resource-server-fastapi/pyproject.toml \
        apps/resource-server-fastapi/.env.example \
        apps/resource-server-fastapi/.gitignore \
        apps/resource-server-fastapi/README.md \
        apps/resource-server-fastapi/app \
        apps/resource-server-fastapi/tests
git commit -m "feat(rs): scaffold resource-server-fastapi"
```

(The `uv.lock` is gitignored above; if you'd rather commit it, drop the entry and add `uv.lock` to the staged set.)

---

## Task 14: `config.py` — pydantic-settings

**Files:**
- Create: `apps/resource-server-fastapi/app/config.py`

- [ ] **Step 1: Write the module**

```python
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    AUTH_SERVER_URL: str = "http://localhost:3000"
    ADMIN_URL: str = "http://localhost:3001"
    SASSY_CLIENT_ID: str
    RS_BASE_URL: str
    REDIRECT_URI: str

    EXPECTED_ISSUER: str | None = None
    EXPECTED_AUDIENCE: str | None = None
    PKCE_STATE_TTL_SECONDS: int = 600
    LOG_LEVEL: str = "info"

    @property
    def issuer(self) -> str:
        return self.EXPECTED_ISSUER or self.AUTH_SERVER_URL

    @property
    def audience(self) -> str:
        return self.EXPECTED_AUDIENCE or self.SASSY_CLIENT_ID


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
```

---

## Task 15: PKCE helper + test (TDD)

**Files:**
- Create: `apps/resource-server-fastapi/app/oauth/pkce.py`
- Test: `apps/resource-server-fastapi/tests/test_pkce.py`

- [ ] **Step 1: Write the failing test**

`tests/test_pkce.py`:

```python
import re
from app.oauth.pkce import generate_verifier, challenge_s256


def test_generate_verifier_returns_url_safe_string():
    v = generate_verifier()
    assert isinstance(v, str)
    assert 43 <= len(v) <= 128, "RFC 7636 §4.1 length window"
    assert re.fullmatch(r"[A-Za-z0-9_-]+", v)


def test_generate_verifier_is_unique():
    a = generate_verifier()
    b = generate_verifier()
    assert a != b


def test_challenge_s256_matches_rfc_7636_appendix_b():
    # Test vector from RFC 7636 Appendix B.
    verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
    expected = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    assert challenge_s256(verifier) == expected


def test_challenge_s256_no_padding():
    verifier = "a" * 64
    c = challenge_s256(verifier)
    assert "=" not in c
    assert "+" not in c
    assert "/" not in c
```

- [ ] **Step 2: Run, confirm fail**

```bash
cd apps/resource-server-fastapi
uv run pytest tests/test_pkce.py -v
```

Expected: FAIL — `app.oauth.pkce` not found.

- [ ] **Step 3: Implement**

`app/oauth/pkce.py`:

```python
import base64
import hashlib
import secrets


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def generate_verifier() -> str:
    """Generate a PKCE code_verifier per RFC 7636 §4.1.

    64 random bytes → 86-character base64url with no padding (within the
    43–128 length window).
    """
    return _b64url(secrets.token_bytes(64))


def challenge_s256(verifier: str) -> str:
    """Compute the S256 challenge for a verifier per RFC 7636 §4.2."""
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return _b64url(digest)
```

- [ ] **Step 4: Run, confirm pass**

```bash
uv run pytest tests/test_pkce.py -v
```

Expected: 4 PASS.

---

## Task 16: JWT verifier + test (TDD)

**Files:**
- Create: `apps/resource-server-fastapi/app/oauth/verifier.py`
- Test: `apps/resource-server-fastapi/tests/test_verifier.py`

- [ ] **Step 1: Write the failing test**

`tests/test_verifier.py`:

```python
import time
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives import serialization

from app.oauth.verifier import verify


@pytest.fixture
def rsa_keypair():
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    priv_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode("ascii")
    pub_pem = (
        private_key.public_key()
        .public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        .decode("ascii")
    )
    return priv_pem, pub_pem


def _sign(priv_pem: str, claims: dict) -> str:
    return jwt.encode(claims, priv_pem, algorithm="RS256", headers={"kid": "test-kid"})


def _stub_pyjwk(monkeypatch, pub_pem: str):
    from app.oauth import verifier as v

    class _Key:
        def __init__(self, pem: str):
            self.key = serialization.load_pem_public_key(pem.encode("ascii"))

    class _StubClient:
        def __init__(self, *args, **kwargs):
            pass

        def get_signing_key_from_jwt(self, _token):
            return _Key(pub_pem)

    monkeypatch.setattr(v, "_jwks_client", _StubClient())


def _claims(**overrides):
    now = int(time.time())
    base = {
        "iss": "http://localhost:3000",
        "sub": "user-1",
        "aud": "84LR",
        "iat": now,
        "exp": now + 3600,
        "org": "PwVN",
        "scope": "rs.properties.create rs.properties.read",
    }
    base.update(overrides)
    return base


def test_verify_accepts_valid_token(monkeypatch, rsa_keypair):
    priv, pub = rsa_keypair
    _stub_pyjwk(monkeypatch, pub)
    token = _sign(priv, _claims())
    claims = verify(token)
    assert claims["scope"].startswith("rs.properties.create")


def test_verify_rejects_wrong_audience(monkeypatch, rsa_keypair):
    priv, pub = rsa_keypair
    _stub_pyjwk(monkeypatch, pub)
    token = _sign(priv, _claims(aud="other-app"))
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as ei:
        verify(token)
    assert ei.value.status_code == 401


def test_verify_rejects_wrong_issuer(monkeypatch, rsa_keypair):
    priv, pub = rsa_keypair
    _stub_pyjwk(monkeypatch, pub)
    token = _sign(priv, _claims(iss="https://evil.example"))
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as ei:
        verify(token)
    assert ei.value.status_code == 401


def test_verify_rejects_expired(monkeypatch, rsa_keypair):
    priv, pub = rsa_keypair
    _stub_pyjwk(monkeypatch, pub)
    past = int(time.time()) - 10
    token = _sign(priv, _claims(iat=past - 3600, exp=past))
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as ei:
        verify(token)
    assert ei.value.status_code == 401


def test_verify_rejects_missing_scope(monkeypatch, rsa_keypair):
    priv, pub = rsa_keypair
    _stub_pyjwk(monkeypatch, pub)
    claims = _claims()
    claims.pop("scope")
    token = _sign(priv, claims)
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as ei:
        verify(token)
    assert ei.value.status_code == 401
```

Note: this test imports settings via the module. The fixture relies on `.env` providing `SASSY_CLIENT_ID=84LR` (matching the `aud` in `_claims`). Add a `tests/conftest.py` to set env if `.env` may be missing:

```python
import os
os.environ.setdefault("SASSY_CLIENT_ID", "84LR")
os.environ.setdefault("RS_BASE_URL", "http://localhost:8010")
os.environ.setdefault("REDIRECT_URI", "http://localhost:8010/auth/callback")
```

Create `tests/conftest.py` with the snippet above.

- [ ] **Step 2: Run, confirm fail**

```bash
uv run pytest tests/test_verifier.py -v
```

Expected: FAIL — `app.oauth.verifier` not found.

- [ ] **Step 3: Implement**

`app/oauth/verifier.py`:

```python
from typing import Callable
import jwt
from fastapi import Depends, Header, HTTPException

from app.config import get_settings

_settings = get_settings()
_jwks_client = jwt.PyJWKClient(
    f"{_settings.AUTH_SERVER_URL}/api/token/jwks",
    cache_keys=True,
    lifespan=600,
)


def verify(token: str) -> dict:
    try:
        signing_key = _jwks_client.get_signing_key_from_jwt(token).key
        claims = jwt.decode(
            token,
            signing_key,
            algorithms=["RS256"],
            audience=_settings.audience,
            issuer=_settings.issuer,
            options={"require": ["exp", "iat", "sub", "iss", "aud", "scope"]},
        )
        return claims
    except Exception:
        raise HTTPException(
            status_code=401,
            detail={"result": "Unauthorized", "reason": "invalid_token"},
        )


def require_scope(required: str) -> Callable[[str | None], dict]:
    def dep(authorization: str | None = Header(default=None)) -> dict:
        if not authorization or not authorization.lower().startswith("bearer "):
            raise HTTPException(
                status_code=401,
                detail={"result": "Unauthorized", "reason": "invalid_token"},
            )
        token = authorization.split(" ", 1)[1].strip()
        claims = verify(token)
        scopes = set(str(claims.get("scope", "")).split())
        if required not in scopes:
            raise HTTPException(
                status_code=403,
                detail={"result": "Unauthorized", "reason": "insufficient_scope"},
            )
        return claims
    return dep
```

- [ ] **Step 4: Run, confirm pass**

```bash
uv run pytest tests/test_verifier.py -v
```

Expected: 5 PASS.

---

## Task 17: OAuth routes (login + callback)

**Files:**
- Create: `apps/resource-server-fastapi/app/oauth/routes.py`

- [ ] **Step 1: Write the module**

```python
import logging
import secrets
import time
from urllib.parse import quote, urlencode

import httpx
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import RedirectResponse
from fastapi.templating import Jinja2Templates

from app.config import get_settings
from app.oauth.pkce import challenge_s256, generate_verifier

router = APIRouter()
log = logging.getLogger("rs")
templates = Jinja2Templates(directory="app/templates")

# Process-local PKCE state. Single-instance only.
# Maps state -> (verifier, created_at_unix).
_PENDING: dict[str, tuple[str, float]] = {}


def _purge_expired(now: float, ttl: float) -> None:
    expired = [s for s, (_, ts) in _PENDING.items() if now - ts > ttl]
    for s in expired:
        _PENDING.pop(s, None)


@router.get("/auth/login")
def auth_login() -> RedirectResponse:
    s = get_settings()
    state = secrets.token_urlsafe(32)
    verifier = generate_verifier()
    challenge = challenge_s256(verifier)

    now = time.time()
    _purge_expired(now, s.PKCE_STATE_TTL_SECONDS)
    _PENDING[state] = (verifier, now)

    authorize_qs = urlencode(
        {
            "client_id": s.SASSY_CLIENT_ID,
            "redirect_uri": s.REDIRECT_URI,
            "state": state,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        }
    )
    authorize_url = f"{s.AUTH_SERVER_URL}/api/token/oauth/authorize?{authorize_qs}"
    login_url = f"{s.ADMIN_URL}/login?next={quote(authorize_url, safe='')}"

    log.info("auth.login.start", extra={"state": state})
    return RedirectResponse(url=login_url, status_code=302)


@router.get("/auth/callback")
async def auth_callback(
    request: Request,
    code: str = Query(...),
    state: str = Query(...),
):
    s = get_settings()
    pending = _PENDING.pop(state, None)
    if pending is None:
        log.warning("auth.callback.error", extra={"state": state, "reason": "unknown_state"})
        return templates.TemplateResponse(
            request, "error.html",
            {"reason": "Authentication state expired or tampered."},
            status_code=400,
        )

    verifier, created = pending
    if time.time() - created > s.PKCE_STATE_TTL_SECONDS:
        log.warning("auth.callback.error", extra={"state": state, "reason": "state_expired"})
        return templates.TemplateResponse(
            request, "error.html",
            {"reason": "Authentication state expired."},
            status_code=400,
        )

    async with httpx.AsyncClient(timeout=5.0) as client:
        try:
            resp = await client.post(
                f"{s.AUTH_SERVER_URL}/api/token/oauth/token",
                json={
                    "code": code,
                    "client_id": s.SASSY_CLIENT_ID,
                    "code_verifier": verifier,
                    "redirect_uri": s.REDIRECT_URI,
                },
            )
        except httpx.HTTPError as e:
            log.warning("auth.callback.error", extra={"state": state, "reason": f"transport:{e!s}"})
            return templates.TemplateResponse(
                request, "error.html",
                {"reason": "Could not reach the auth server."},
                status_code=502,
            )

    if resp.status_code // 100 != 2:
        body = resp.json() if "json" in resp.headers.get("content-type", "") else {"message": resp.text}
        reason = body.get("message") or body.get("error") or "token_exchange_failed"
        log.warning("auth.callback.error", extra={"state": state, "reason": reason})
        return templates.TemplateResponse(
            request, "error.html",
            {"reason": f"Token exchange failed: {reason}"},
            status_code=400,
        )

    body = resp.json()
    token = body.get("access_token")
    if not token:
        return templates.TemplateResponse(
            request, "error.html",
            {"reason": "No access_token in token response."},
            status_code=400,
        )

    log.info("auth.callback.success", extra={"state": state})
    return templates.TemplateResponse(
        request,
        "authorized.html",
        {"access_token": token},
    )
```

---

## Task 18: Protected endpoint + test (TDD)

**Files:**
- Create: `apps/resource-server-fastapi/app/api/routes.py`
- Test: `apps/resource-server-fastapi/tests/test_api_properties.py`

- [ ] **Step 1: Write the failing test**

`tests/test_api_properties.py`:

```python
import time
import jwt
import pytest
from fastapi.testclient import TestClient
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives import serialization


@pytest.fixture
def rsa_keypair():
    pk = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    priv = pk.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode("ascii")
    pub = pk.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode("ascii")
    return priv, pub


@pytest.fixture
def app_with_stub_jwks(monkeypatch, rsa_keypair):
    from app.oauth import verifier as v

    class _Key:
        def __init__(self, pem: str):
            self.key = serialization.load_pem_public_key(pem.encode("ascii"))

    class _StubClient:
        def __init__(self, *args, **kwargs):
            pass

        def get_signing_key_from_jwt(self, _token):
            return _Key(rsa_keypair[1])

    monkeypatch.setattr(v, "_jwks_client", _StubClient())

    from app.main import app
    return app


def _mint(priv: str, scope: str) -> str:
    now = int(time.time())
    return jwt.encode(
        {
            "iss": "http://localhost:3000",
            "sub": "user-1",
            "aud": "84LR",
            "iat": now,
            "exp": now + 60,
            "org": "PwVN",
            "scope": scope,
        },
        priv,
        algorithm="RS256",
        headers={"kid": "test-kid"},
    )


def test_properties_returns_authorized_when_scope_present(app_with_stub_jwks, rsa_keypair):
    priv, _ = rsa_keypair
    token = _mint(priv, "rs.properties.create rs.properties.read")
    client = TestClient(app_with_stub_jwks)
    res = client.get("/api/properties", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    assert res.json()["result"] == "Authorized"


def test_properties_returns_unauthorized_when_scope_missing(app_with_stub_jwks, rsa_keypair):
    priv, _ = rsa_keypair
    token = _mint(priv, "rs.properties.read")
    client = TestClient(app_with_stub_jwks)
    res = client.get("/api/properties", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 403
    assert res.json()["detail"]["reason"] == "insufficient_scope"


def test_properties_rejects_missing_bearer(app_with_stub_jwks):
    client = TestClient(app_with_stub_jwks)
    res = client.get("/api/properties")
    assert res.status_code == 401
    assert res.json()["detail"]["reason"] == "invalid_token"
```

- [ ] **Step 2: Run, confirm fail**

```bash
uv run pytest tests/test_api_properties.py -v
```

Expected: FAIL — `app.main` not found.

- [ ] **Step 3: Implement the protected endpoint**

`app/api/routes.py`:

```python
import logging
from fastapi import APIRouter, Depends

from app.oauth.verifier import require_scope

router = APIRouter()
log = logging.getLogger("rs")


@router.get("/api/properties")
def list_properties(claims: dict = Depends(require_scope("rs.properties.create"))):
    log.info("api.properties.granted", extra={"sub": claims.get("sub")})
    return {
        "result": "Authorized",
        "sub": claims.get("sub"),
        "org": claims.get("org"),
    }
```

(Test for "granted" already passes once `app.main` exists; the next task creates that.)

---

## Task 19: Web (home) route

**Files:**
- Create: `apps/resource-server-fastapi/app/web/routes.py`

- [ ] **Step 1: Write the module**

```python
from fastapi import APIRouter, Request
from fastapi.templating import Jinja2Templates

router = APIRouter()
templates = Jinja2Templates(directory="app/templates")


@router.get("/")
def home(request: Request):
    return templates.TemplateResponse(request, "index.html", {})
```

---

## Task 20: `main.py` (FastAPI entry)

**Files:**
- Create: `apps/resource-server-fastapi/app/main.py`

- [ ] **Step 1: Write the module**

```python
import logging
import json

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.api.routes import router as api_router
from app.config import get_settings
from app.oauth.routes import router as oauth_router
from app.web.routes import router as web_router


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S"),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        # Merge any structured `extra` fields (filtered to JSON-safe types).
        for k, v in record.__dict__.items():
            if k in {
                "args", "msg", "levelname", "levelno", "pathname", "filename",
                "module", "exc_info", "exc_text", "stack_info", "lineno",
                "funcName", "created", "msecs", "relativeCreated", "thread",
                "threadName", "processName", "process", "name", "message",
            }:
                continue
            try:
                json.dumps(v)
                payload[k] = v
            except (TypeError, ValueError):
                payload[k] = str(v)
        return json.dumps(payload)


def _configure_logging() -> None:
    s = get_settings()
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(s.LOG_LEVEL.upper())


_configure_logging()

app = FastAPI(title="resource-server-fastapi")
app.mount("/static", StaticFiles(directory="app/static"), name="static")
app.include_router(web_router)
app.include_router(oauth_router)
app.include_router(api_router)
```

- [ ] **Step 2: Run the API tests now that `app.main` exists**

```bash
uv run pytest tests/test_api_properties.py -v
```

Expected: 3 PASS.

---

## Task 21: Templates and static assets

**Files:**
- Create: `apps/resource-server-fastapi/app/templates/index.html`
- Create: `apps/resource-server-fastapi/app/templates/authorized.html`
- Create: `apps/resource-server-fastapi/app/templates/error.html`
- Create: `apps/resource-server-fastapi/app/static/app.js`
- Create: `apps/resource-server-fastapi/app/static/app.css`

- [ ] **Step 1: `index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>resource-server-fastapi</title>
  <link rel="stylesheet" href="/static/app.css" />
</head>
<body>
  <main class="card">
    <h1>resourceserver01</h1>
    <p>A demo OAuth 2.0 resource server backed by SassyAuth.</p>
    <p><a class="btn primary" href="/auth/login">Sign In with SassyAuth</a></p>
    <p id="repeat" hidden>
      <button id="retest" class="btn">Re-test /api/properties</button>
    </p>
  </main>
  <script>
    if (sessionStorage.getItem('sa_access_token')) {
      document.getElementById('repeat').hidden = false;
      document.getElementById('retest').addEventListener('click', async () => {
        const token = sessionStorage.getItem('sa_access_token');
        const res = await fetch('/api/properties', {
          headers: { Authorization: 'Bearer ' + token },
        });
        const body = await res.json();
        alert(JSON.stringify(body, null, 2));
      });
    }
  </script>
</body>
</html>
```

- [ ] **Step 2: `authorized.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>resource-server-fastapi · result</title>
  <link rel="stylesheet" href="/static/app.css" />
</head>
<body>
  <main class="card">
    <h1>Signed in</h1>
    <script type="application/json" id="token-data">{{ access_token | tojson }}</script>
    <p>Calling <code>GET /api/properties</code> (requires <code>rs.properties.create</code>)…</p>
    <h2 id="result" data-pending>…</h2>
    <details>
      <summary>Decoded token</summary>
      <pre id="claims"></pre>
    </details>
    <p>
      <a class="btn" href="/" id="signout">Sign Out</a>
    </p>
  </main>
  <script src="/static/app.js"></script>
</body>
</html>
```

- [ ] **Step 3: `error.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>resource-server-fastapi · error</title>
  <link rel="stylesheet" href="/static/app.css" />
</head>
<body>
  <main class="card">
    <h1>Sign-in failed</h1>
    <p>{{ reason }}</p>
    <p><a class="btn" href="/">Back</a></p>
  </main>
</body>
</html>
```

- [ ] **Step 4: `app.js`**

```javascript
(function () {
  const tokenEl = document.getElementById('token-data');
  if (!tokenEl) return;
  let token;
  try {
    token = JSON.parse(tokenEl.textContent);
  } catch {
    return;
  }
  sessionStorage.setItem('sa_access_token', token);

  // Decode claims for display only (no validation — server already verified).
  function decodePayload(jwt) {
    const part = jwt.split('.')[1];
    const pad = '='.repeat((4 - (part.length % 4)) % 4);
    const b64 = (part + pad).replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(b64));
  }
  try {
    document.getElementById('claims').textContent =
      JSON.stringify(decodePayload(token), null, 2);
  } catch {}

  const resultEl = document.getElementById('result');
  fetch('/api/properties', { headers: { Authorization: 'Bearer ' + token } })
    .then(async (res) => {
      const body = await res.json();
      const status = res.ok ? 'Authorized' : 'Unauthorized';
      resultEl.textContent = status;
      resultEl.dataset.status = status.toLowerCase();
      resultEl.removeAttribute('data-pending');
      const note = document.createElement('p');
      note.textContent = `(${res.status} ${body.reason ?? ''})`.trim();
      resultEl.after(note);
    })
    .catch((err) => {
      resultEl.textContent = 'Unauthorized';
      resultEl.dataset.status = 'unauthorized';
      const note = document.createElement('p');
      note.textContent = String(err);
      resultEl.after(note);
    });

  document.getElementById('signout')?.addEventListener('click', (e) => {
    e.preventDefault();
    sessionStorage.removeItem('sa_access_token');
    window.location.href = '/';
  });
})();
```

- [ ] **Step 5: `app.css`**

```css
:root { color-scheme: light dark; }
body {
  margin: 0;
  font: 16px/1.5 system-ui, sans-serif;
  background: Canvas; color: CanvasText;
  display: grid; place-items: center; min-height: 100vh;
}
.card {
  max-width: 560px; padding: 2rem 2.5rem;
  border: 1px solid color-mix(in oklab, CanvasText 20%, transparent);
  border-radius: 12px; background: Canvas;
}
.btn {
  display: inline-block; padding: .5rem 1rem;
  border: 1px solid color-mix(in oklab, CanvasText 30%, transparent);
  border-radius: 8px; text-decoration: none; color: inherit;
  cursor: pointer; background: transparent;
}
.btn.primary {
  background: color-mix(in oklab, AccentColor 80%, Canvas);
  color: AccentColorText; border-color: transparent;
}
h2[data-status="authorized"] { color: SeaGreen; }
h2[data-status="unauthorized"] { color: IndianRed; }
pre { background: color-mix(in oklab, CanvasText 6%, Canvas); padding: 1rem; border-radius: 8px; overflow: auto; }
```

- [ ] **Step 6: Smoke run**

```bash
uv run uvicorn app.main:app --port 8010 &
sleep 1
curl -sf http://localhost:8010/ | grep -q "Sign In" && echo OK
kill %1
```

Expected: prints `OK`.

- [ ] **Step 7: Commit the FastAPI app**

```bash
git add apps/resource-server-fastapi/app apps/resource-server-fastapi/tests
git commit -m "feat(rs): FastAPI app with PKCE, JWKS verification, /api/properties

- /auth/login starts a PKCE flow and bounces through the admin /login
  with a validated next= URL pointing back at the auth-server's
  /api/token/oauth/authorize.
- /auth/callback exchanges the code with code_verifier and renders the
  JWT into a page that stashes it in sessionStorage and tests
  /api/properties via Authorization: Bearer.
- /api/properties requires the rs.properties.create scope and returns
  200 Authorized | 403 Unauthorized accordingly."
```

---

## Task 22: Full end-to-end manual validation

**Files:** none — operates against running services.

- [ ] **Step 1: Start everything**

In three terminals (or one tmux session):

```bash
# Terminal 1 — auth-server (port 3000)
pnpm --filter @sassy-auth/auth-server dev

# Terminal 2 — admin (port 3001)
pnpm --filter @sassy-auth/admin dev

# Terminal 3 — FastAPI RS (port 8010)
cd apps/resource-server-fastapi && uv run uvicorn app.main:app --port 8010 --reload
```

Confirm the ngrok tunnel `cheryl-crescentlike-monte.ngrok-free.dev → localhost:8010` is up. (Check with `curl -sf https://cheryl-crescentlike-monte.ngrok-free.dev/ | grep -q "Sign In" && echo OK`.)

- [ ] **Step 2: Run the seed (idempotency)**

```bash
SEED_DEMO=1 pnpm --filter @sassy-auth/auth-server seed
```

Expected: completes cleanly; `[demo] Done.` Existing rows untouched.

- [ ] **Step 3: Authorized path**

1. Open `https://cheryl-crescentlike-monte.ngrok-free.dev/` in a clean browser profile.
2. Click "Sign In with SassyAuth". Confirm browser address bar shows `http://localhost:3001/login?next=...` with the full encoded authorize URL.
3. Submit `m@cpm.io` / `Pass@word1234`.
4. Browser lands on `https://cheryl-crescentlike-monte.ngrok-free.dev/auth/callback?code=...`. Page renders `Authorized`.
5. Open DevTools → Application → sessionStorage → `sa_access_token` is present.
6. Network tab → request to `/api/properties` has `Authorization: Bearer ...`, response is `200`.
7. Decoded token (visible in the `<details>` block) shows `aud=84LR`, `org=PwVN`, `scope` includes `rs.properties.create`, no `permissions` key.

- [ ] **Step 4: Unauthorized path**

1. Click "Sign Out" (clears sessionStorage, returns to `/`).
2. Click "Sign In" again, sign in as `i@cpm.io` / `Pass@word1234`.
3. Page renders `Unauthorized`. Network tab shows `403` from `/api/properties`. Decoded token's `scope` does not contain `rs.properties.create`.

- [ ] **Step 5: Tamper tests**

1. After step 3, edit `sessionStorage.sa_access_token` (flip one char), reload → `Unauthorized`, network shows `401`.
2. Trigger a callback with a mutated code: copy a fresh authorize URL, intercept the redirect, modify the `code=` param → token endpoint returns `401 invalid_grant`, FastAPI shows the error page.
3. Direct hit: `curl -i "http://localhost:3000/api/token/oauth/authorize?client_id=84LR&redirect_uri=https://evil.example.com/cb&code_challenge=abc&code_challenge_method=S256"` → `400 invalid_redirect_uri`.

- [ ] **Step 6: Cookie share confirmation**

After step 3, navigate directly to `http://localhost:3001/users` in a new tab. Should land logged in. (Confirms the BetterAuth cookie set on `localhost:3001` is sent to `localhost:3000`, validating the architecture's load-bearing assumption.)

- [ ] **Step 7: Sign off**

If any check fails, do not proceed. Each failure points to a specific task to revisit (per the spec's section reference).

---

## Self-review notes (already applied)

- All spec requirements have task coverage (PKCE Tasks 3,5,6; redirect-uri Tasks 2,5,6; scope claim Tasks 1,7,8; types Task 1; demo seed Task 9; admin next= Tasks 10–12; FastAPI Tasks 13–21; validation Task 22).
- No placeholders; every code step contains the full snippet.
- Type names consistent: `assertRedirectUriMatchesApp` (not `assertRedirectMatches`); `validateNextUrl` (not `safeNext`); `generate_verifier` / `challenge_s256` (not `make_verifier`); `require_scope`; `_PENDING` / `_jwks_client`.
- Error codes line up across types, service, controller, and tests (`invalid_grant`, `invalid_redirect_uri`, `invalid_request`, `unauthorized_client`).
- Single auth-server commit at Task 7 covers a coherent unit (types + service + DTO + controller + service test + controller test); e2e test gets its own commit at Task 8 to keep the diff readable.
