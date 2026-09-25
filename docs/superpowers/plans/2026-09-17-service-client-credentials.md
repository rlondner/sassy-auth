# Service Client Credentials Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an OAuth 2.0 `client_credentials` grant so a confidential app can authenticate to sassy-auth as itself and assign/remove roles for its own users through a narrow, app-scoped endpoint — no end user, no access to the general admin surface.

**Architecture:** A new `client_credentials` branch in the existing `POST /api/token/oauth/token` endpoint mints a short-lived "service token" (no `sub`, `aud: 'sassy-auth-management-api'`, `token_use: 'service'`) gated by a new `SaApp.canManageOwnRoles` flag and a small `roles:write` scope vocabulary separate from OIDC scopes. A new `ServiceTokenGuard` + `ServiceUsersController`/`ServiceUsersService` (mounted at `/api/service/users`) accept that token and assign/remove roles, enforcing that both the target user and the target role belong to the calling app — never going through `checkPermission`, which is for human callers.

**Tech Stack:** NestJS, Prisma (Postgres), `jsonwebtoken`, `class-validator`, Jest + `supertest` for e2e.

Spec: `docs/superpowers/specs/2026-09-17-service-client-credentials-design.md`

---

## Task 1: Data model — `SaApp.canManageOwnRoles`

**Files:**
- Modify: `packages/db/schema.prisma:114-152` (`SaApp` model)
- Create: `packages/db/migrations/20260917120000_add_can_manage_own_roles/migration.sql`

- [ ] **Step 1: Add the field to the Prisma schema**

In `packages/db/schema.prisma`, inside `model SaApp { ... }`, add the new boolean next to the other boolean opt-in flags (after `requireTwoFactor`):

```prisma
  requireTwoFactor   Boolean        @default(false)
  isPlatform         Boolean        @default(false)
  // Confidential-app-only gate for the client_credentials grant (RFC 6749
  // §4.4). A valid client secret is necessary but not sufficient — this
  // flag is the explicit admin opt-in for whether the app may be granted
  // `roles:write` at all. See docs/superpowers/specs/2026-09-17-service-client-credentials-design.md §1.
  canManageOwnRoles  Boolean        @default(false)
```

- [ ] **Step 2: Generate and apply the migration**

Run (from repo root):

```bash
pnpm --filter @sassy-auth/db db:migrate -- --name add_can_manage_own_roles
```

This creates `packages/db/migrations/20260917120000_add_can_manage_own_roles/migration.sql` (timestamp will be whatever Prisma assigns) containing:

```sql
-- AlterTable
ALTER TABLE "SaApp" ADD COLUMN "canManageOwnRoles" BOOLEAN NOT NULL DEFAULT false;
```

Expected: command exits 0, prints `Your database is now in sync with your schema.`

- [ ] **Step 3: Regenerate the Prisma client**

```bash
pnpm --filter @sassy-auth/db db:generate
```

Expected: exits 0, no errors. The generated `SaApp` type now has `canManageOwnRoles: boolean`.

- [ ] **Step 4: Commit**

```bash
git add packages/db/schema.prisma packages/db/migrations
git commit -m "feat(db): add SaApp.canManageOwnRoles for client_credentials role management"
```

---

## Task 2: Service-scope vocabulary

**Files:**
- Create: `apps/auth-server/src/token/service-scopes.ts`
- Test: `apps/auth-server/src/token/service-scopes.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/auth-server/src/token/service-scopes.spec.ts
import { parseServiceScopes, SUPPORTED_SERVICE_SCOPES } from './service-scopes';

describe('SUPPORTED_SERVICE_SCOPES', () => {
  it('contains exactly roles:write', () => {
    expect(SUPPORTED_SERVICE_SCOPES).toEqual(['roles:write']);
  });
});

describe('parseServiceScopes', () => {
  it('keeps recognised service scopes', () => {
    expect(parseServiceScopes('roles:write')).toEqual(['roles:write']);
  });

  it('drops unrecognised scopes silently', () => {
    expect(parseServiceScopes('roles:write openid wat')).toEqual(['roles:write']);
  });

  it('returns an empty list for undefined or blank input', () => {
    expect(parseServiceScopes(undefined)).toEqual([]);
    expect(parseServiceScopes('   ')).toEqual([]);
  });

  it('de-duplicates repeated scopes', () => {
    expect(parseServiceScopes('roles:write roles:write')).toEqual(['roles:write']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter auth-server test -- service-scopes.spec.ts`
Expected: FAIL — `Cannot find module './service-scopes'`

- [ ] **Step 3: Write the implementation**

```typescript
// apps/auth-server/src/token/service-scopes.ts
// Deliberately separate from token/scopes.ts (SUPPORTED_SCOPES): those are
// OIDC identity scopes granted to a user access token; these gate API
// capabilities on a service token that has no user in the loop at all. See
// docs/superpowers/specs/2026-09-17-service-client-credentials-design.md §3.
export const SUPPORTED_SERVICE_SCOPES = ['roles:write'] as const;

export type SupportedServiceScope = (typeof SUPPORTED_SERVICE_SCOPES)[number];

/**
 * Parses a space-delimited `scope` request against the service-scope
 * vocabulary. Unrecognised scopes are dropped silently rather than
 * rejected, per OAuth 2.0 — the token response echoes only what was
 * actually granted.
 */
export function parseServiceScopes(requested: string | undefined): SupportedServiceScope[] {
  if (!requested) return [];
  const asked = new Set(requested.split(/\s+/).filter(Boolean));
  return SUPPORTED_SERVICE_SCOPES.filter((s) => asked.has(s));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter auth-server test -- service-scopes.spec.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/token/service-scopes.ts apps/auth-server/src/token/service-scopes.spec.ts
git commit -m "feat(token): add service-scope vocabulary for client_credentials"
```

---

## Task 3: `TokenService.issueServiceJwt` / `verifyServiceAccessToken`

**Files:**
- Modify: `apps/auth-server/src/token/token.service.ts`
- Test: `apps/auth-server/src/token/token.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

Add to `apps/auth-server/src/token/token.service.spec.ts` (new `describe` blocks, after the existing `getJwks` block, before the closing `});` of the outer `describe('TokenService', ...)`):

```typescript
  // ── Service tokens (client_credentials) ─────────────────────────────────

  describe('issueServiceJwt', () => {
    it('mints a token with azp, fixed aud, token_use=service, and no sub', async () => {
      const token = await service.issueServiceJwt({
        appId: 7,
        appPublicId: 'app-7',
        scope: 'roles:write',
      });

      const decoded = jwt.verify(token, publicPem, { algorithms: ['RS256'] }) as jwt.JwtPayload;

      expect(decoded.azp).toBe('app-7');
      expect(decoded.aud).toBe('sassy-auth-management-api');
      expect(decoded.token_use).toBe('service');
      expect(decoded.scope).toBe('roles:write');
      expect(decoded.sub).toBeUndefined();
      expect(decoded.exp! - decoded.iat!).toBe(300);
    });

    it('emits an empty scope string when nothing was granted', async () => {
      const token = await service.issueServiceJwt({ appId: 7, appPublicId: 'app-7', scope: '' });
      const decoded = jwt.decode(token) as Record<string, unknown>;
      expect(decoded.scope).toBe('');
    });
  });

  describe('verifyServiceAccessToken', () => {
    it('returns the claims for a valid service token', async () => {
      const token = await service.issueServiceJwt({ appId: 7, appPublicId: 'app-7', scope: 'roles:write' });
      const claims = service.verifyServiceAccessToken(token);
      expect(claims.azp).toBe('app-7');
      expect(claims.scope).toBe('roles:write');
    });

    it('rejects a user access token (wrong aud, no token_use)', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue(saUserWithPermissions);
      const userToken = await service.issueJwt({
        saUserId: 1, userPublicId: 'u', orgPublicId: 'o', appPublicId: 'app-7', appId: 5, scope: '',
      });
      expect(() => service.verifyServiceAccessToken(userToken)).toThrow();
    });

    it('rejects a token signed with the wrong key', () => {
      const forged = jwt.sign(
        { azp: 'app-7', aud: 'sassy-auth-management-api', token_use: 'service', scope: 'roles:write' },
        'not-the-real-key',
      );
      expect(() => service.verifyServiceAccessToken(forged)).toThrow();
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter auth-server test -- token.service.spec.ts`
Expected: FAIL — `service.issueServiceJwt is not a function`

- [ ] **Step 3: Implement in `token.service.ts`**

Add these constants after `TOKEN_TTL_SECONDS` (`apps/auth-server/src/token/token.service.ts:13`):

```typescript
/** Service-token lifetime in seconds — short, since it's minted on demand
 *  right before use rather than held open like a user session. */
export const SERVICE_TOKEN_TTL_SECONDS = 300;

/** Fixed audience for every service token, regardless of the calling app's
 *  own publicId. Marks the token as "for calling sassy-auth's own API" and
 *  ensures a user access token (whose `aud` is always some app's publicId)
 *  can never satisfy ServiceTokenGuard's audience check. */
export const SERVICE_TOKEN_AUDIENCE = 'sassy-auth-management-api';
```

Add this interface near `IssueJwtParams` (after `apps/auth-server/src/token/token.service.ts:26`):

```typescript
interface IssueServiceJwtParams {
  /** Numeric SaApp.id of the calling app — carried for parity with
   *  IssueJwtParams and future audit/telemetry use; not embedded in the
   *  token payload (appPublicId, via `azp`, is what a verifier needs). */
  appId: number;
  appPublicId: string;
  /** Space-delimited granted service scopes. '' if none were granted. */
  scope: string;
}
```

Add these two methods to the `TokenService` class, after `getJwks()` (end of the class, `apps/auth-server/src/token/token.service.ts:228-241`):

```typescript
  /** Mints a service token for the client_credentials grant. Structurally
   *  distinct from a user access token: no `sub` (no end user), fixed
   *  short TTL, and `aud` fixed to SERVICE_TOKEN_AUDIENCE rather than the
   *  calling app's own publicId. See design spec §4. */
  async issueServiceJwt(params: IssueServiceJwtParams): Promise<string> {
    const issuer = resolveIssuer();
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      azp: params.appPublicId,
      aud: SERVICE_TOKEN_AUDIENCE,
      iss: issuer,
      iat: now,
      exp: now + SERVICE_TOKEN_TTL_SECONDS,
      scope: params.scope,
      token_use: 'service',
    };
    return jwt.sign(payload, this.privateKey, { algorithm: 'RS256', keyid: this.kid });
  }

  /** Verifies a service token this server issued. Throws on any failure,
   *  including a structurally valid RS256 token that simply isn't a
   *  service token (wrong `aud` or missing `token_use: 'service'`) — this
   *  is what makes user and service tokens non-interchangeable. */
  verifyServiceAccessToken(token: string): { azp?: string; scope?: string; aud?: string } {
    const claims = jwt.verify(token, this.publicKey, {
      algorithms: ['RS256'],
      issuer: resolveIssuer(),
      audience: SERVICE_TOKEN_AUDIENCE,
    }) as { azp?: string; scope?: string; aud?: string; token_use?: string };
    if (claims.token_use !== 'service') {
      throw new Error('Not a service access token');
    }
    return claims;
  }
```

Note: passing `audience: SERVICE_TOKEN_AUDIENCE` to `jwt.verify` makes `jsonwebtoken` itself reject any token whose `aud` isn't `SERVICE_TOKEN_AUDIENCE` — this is what makes the "wrong aud" test above throw before the `token_use` check even runs.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter auth-server test -- token.service.spec.ts`
Expected: PASS (all tests, including the new ones)

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/token/token.service.ts apps/auth-server/src/token/token.service.spec.ts
git commit -m "feat(token): add issueServiceJwt/verifyServiceAccessToken for service tokens"
```

---

## Task 4: `OauthTokenExchangeDto` — `client_credentials` branch

**Files:**
- Modify: `apps/auth-server/src/token/dto/oauth-token-exchange.dto.ts`
- Test: `apps/auth-server/src/token/dto/oauth-token-exchange.dto.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/auth-server/src/token/dto/oauth-token-exchange.dto.spec.ts
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { OauthTokenExchangeDto } from './oauth-token-exchange.dto';

async function validateDto(payload: Record<string, unknown>) {
  const dto = plainToInstance(OauthTokenExchangeDto, payload);
  return validate(dto);
}

describe('OauthTokenExchangeDto', () => {
  it('requires code and redirect_uri for authorization_code', async () => {
    const errors = await validateDto({
      grant_type: 'authorization_code',
      client_id: 'app-1',
    });
    const properties = errors.map((e) => e.property);
    expect(properties).toEqual(expect.arrayContaining(['code', 'redirect_uri']));
  });

  it('passes for a well-formed authorization_code request', async () => {
    const errors = await validateDto({
      grant_type: 'authorization_code',
      client_id: 'app-1',
      code: 'abc',
      redirect_uri: 'https://example.com/cb',
    });
    expect(errors).toHaveLength(0);
  });

  it('does not require code or redirect_uri for client_credentials', async () => {
    const errors = await validateDto({
      grant_type: 'client_credentials',
      client_id: 'app-1',
    });
    expect(errors).toHaveLength(0);
  });

  it('accepts an optional scope for client_credentials', async () => {
    const errors = await validateDto({
      grant_type: 'client_credentials',
      client_id: 'app-1',
      scope: 'roles:write',
    });
    expect(errors).toHaveLength(0);
  });

  it('rejects an unrecognised grant_type', async () => {
    const errors = await validateDto({ grant_type: 'password', client_id: 'app-1' });
    expect(errors.some((e) => e.property === 'grant_type')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter auth-server test -- oauth-token-exchange.dto.spec.ts`
Expected: FAIL — `client_credentials` request errors on `code/redirect_uri` being missing (the "does not require" test fails), and `password` is currently accepted only for the wrong reason (grant_type not in list — actually this one already passes). The two `client_credentials` tests fail.

- [ ] **Step 3: Update the DTO**

Replace the full contents of `apps/auth-server/src/token/dto/oauth-token-exchange.dto.ts`:

```typescript
import { IsString, IsNotEmpty, IsUrl, IsOptional, IsIn, ValidateIf } from 'class-validator';

export class OauthTokenExchangeDto {
  /** RFC 6749 §4.1.3 / §4.4 requires every token request to name its grant
   *  type. `client_credentials` (RFC 6749 §4.4) mints a service token for a
   *  confidential app acting as itself — see
   *  docs/superpowers/specs/2026-09-17-service-client-credentials-design.md §4. */
  @IsIn(['authorization_code', 'client_credentials'])
  grant_type!: string;

  /** Required for authorization_code; meaningless for client_credentials
   *  (ValidateIf skips validation entirely for the other grant type, so an
   *  omitted field there is not an error). */
  @ValidateIf((o: OauthTokenExchangeDto) => o.grant_type === 'authorization_code')
  @IsString()
  @IsNotEmpty()
  code?: string;

  /** sa_app.publicId — must match the app that requested the code, or (for
   *  client_credentials) the app authenticating itself. */
  @IsString()
  @IsNotEmpty()
  client_id!: string;

  /** PKCE code verifier — the plaintext that was used to derive the
   *  code_challenge sent on the authorize call. Optional: a confidential
   *  client may omit PKCE entirely and authenticate with a client secret
   *  instead (Task 9). Not used by client_credentials. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  code_verifier?: string;

  /** Required for authorization_code; meaningless for client_credentials. */
  @ValidateIf((o: OauthTokenExchangeDto) => o.grant_type === 'authorization_code')
  @IsUrl({ require_tld: false })
  redirect_uri?: string;

  /** `client_secret_post` — the plaintext client secret, when the client
   *  authenticates via the request body instead of an Authorization: Basic
   *  header (`client_secret_basic`). Used by both authorization_code
   *  (confidential clients) and client_credentials (always confidential). */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  client_secret?: string;

  /** Space-delimited requested scopes. Only meaningful for
   *  client_credentials — parsed against the service-scope vocabulary
   *  (token/service-scopes.ts), not the OIDC SUPPORTED_SCOPES. */
  @IsOptional()
  @IsString()
  scope?: string;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter auth-server test -- oauth-token-exchange.dto.spec.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Run the full existing e2e suite's DTO-adjacent test to check for regressions**

Run: `pnpm --filter auth-server test -- token.controller.spec.ts`
Expected: PASS (unaffected — DTO validation happens in Nest's `ValidationPipe`, not in the controller unit tests, which construct the DTO object directly)

- [ ] **Step 6: Commit**

```bash
git add apps/auth-server/src/token/dto/oauth-token-exchange.dto.ts apps/auth-server/src/token/dto/oauth-token-exchange.dto.spec.ts
git commit -m "feat(token): make code/redirect_uri conditionally required for client_credentials"
```

---

## Task 5: `TokenController` — `client_credentials` branch

**Files:**
- Modify: `apps/auth-server/src/token/token.controller.ts`
- Test: `apps/auth-server/src/token/token.controller.spec.ts`

- [ ] **Step 1: Write the failing tests**

Add these imports to the top of `apps/auth-server/src/token/token.controller.spec.ts` (alongside the existing imports):

```typescript
import { SERVICE_TOKEN_TTL_SECONDS } from './token.service';
```

Add `issueServiceJwt: jest.fn()` to the `mockTokenService` object (`apps/auth-server/src/token/token.controller.spec.ts:82-91`):

```typescript
const mockTokenService = {
  issueJwt: jest.fn(),
  issueIdToken: jest.fn(),
  issueServiceJwt: jest.fn(),
  getJwks: jest.fn(),
  resolvePermissions: jest.fn(),
  buildScopedClaims: jest.fn(),
  verifyAccessToken: jest.fn((token: string) =>
    jwt.verify(token, testPublicPem, { algorithms: ['RS256'], issuer: resolveIssuer() }),
  ),
};
```

Add a new nested `describe` block **inside** the existing `describe('oauthToken', () => { ... })` block (`apps/auth-server/src/token/token.controller.spec.ts:681`), reusing that block's own `fakeTokenReq`/`fakeTokenRes` (defined at lines 687-688) rather than redefining them — place it right after the closing `});` of the `it('returns id_token when the openid scope was granted', ...)` test:

```typescript
    describe('client_credentials', () => {
      const dto = {
        grant_type: 'client_credentials',
        client_id: 'sqid-9',
        client_secret: 'correct-secret',
        scope: 'roles:write',
      } as unknown as import('./dto/oauth-token-exchange.dto').OauthTokenExchangeDto;

      it('rejects a non-confidential app (invalid_client)', async () => {
        mockPrisma.saApp.findUnique.mockResolvedValue({ id: 9, publicId: 'sqid-9', clientSecretHash: null, canManageOwnRoles: true });

        const promise = controller.oauthToken(dto, fakeTokenReq, fakeTokenRes);
        await expect(promise).rejects.toBeInstanceOf(UnauthorizedException);
        await expect(promise).rejects.toThrow(TokenErrorCode.INVALID_CLIENT);
      });

      it('rejects a bad client secret (invalid_client)', async () => {
        mockPrisma.saApp.findUnique.mockResolvedValue({ id: 9, publicId: 'sqid-9', clientSecretHash: 'hashed', canManageOwnRoles: true });
        mockVerifyPassword.mockResolvedValueOnce(false);

        const promise = controller.oauthToken(dto, fakeTokenReq, fakeTokenRes);
        await expect(promise).rejects.toBeInstanceOf(UnauthorizedException);
        await expect(promise).rejects.toThrow(TokenErrorCode.INVALID_CLIENT);
      });

      it('grants an empty scope when canManageOwnRoles is false, even with a valid secret', async () => {
        mockPrisma.saApp.findUnique.mockResolvedValue({ id: 9, publicId: 'sqid-9', clientSecretHash: 'hashed', canManageOwnRoles: false });
        mockVerifyPassword.mockResolvedValueOnce(true);
        mockTokenService.issueServiceJwt.mockResolvedValue('service.jwt.token');

        const res = await controller.oauthToken(dto, fakeTokenReq, fakeTokenRes);

        expect(mockTokenService.issueServiceJwt).toHaveBeenCalledWith({ appId: 9, appPublicId: 'sqid-9', scope: '' });
        expect(res).toEqual({
          access_token: 'service.jwt.token',
          token_type: 'Bearer',
          expires_in: SERVICE_TOKEN_TTL_SECONDS,
          scope: '',
        });
      });

      it('grants roles:write when canManageOwnRoles is true and the secret is valid', async () => {
        mockPrisma.saApp.findUnique.mockResolvedValue({ id: 9, publicId: 'sqid-9', clientSecretHash: 'hashed', canManageOwnRoles: true });
        mockVerifyPassword.mockResolvedValueOnce(true);
        mockTokenService.issueServiceJwt.mockResolvedValue('service.jwt.token');

        const res = await controller.oauthToken(dto, fakeTokenReq, fakeTokenRes);

        expect(mockTokenService.issueServiceJwt).toHaveBeenCalledWith({ appId: 9, appPublicId: 'sqid-9', scope: 'roles:write' });
        expect(res.scope).toBe('roles:write');
      });

      it('returns 404 APP_NOT_FOUND for an unknown client_id', async () => {
        mockPrisma.saApp.findUnique.mockResolvedValue(null);

        const promise = controller.oauthToken(dto, fakeTokenReq, fakeTokenRes);
        await expect(promise).rejects.toBeInstanceOf(NotFoundException);
        await expect(promise).rejects.toThrow(TokenErrorCode.APP_NOT_FOUND);
      });
    });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter auth-server test -- token.controller.spec.ts`
Expected: FAIL — `grant_type` currently falls through to the `authorization_code` logic and throws for unrelated reasons (e.g. `dto.redirect_uri` being undefined, or `oauthService.exchangeCode` never being mocked to resolve).

- [ ] **Step 3: Implement the branch in `token.controller.ts`**

Add imports at the top of `apps/auth-server/src/token/token.controller.ts` (alongside the existing `import { parseScopes } from './scopes';` at line 68):

```typescript
import { parseServiceScopes } from './service-scopes';
import { SERVICE_TOKEN_TTL_SECONDS } from './token.service';
```

In `oauthToken` (`apps/auth-server/src/token/token.controller.ts:385-389`), insert the branch immediately as the first statement in the method body, before the existing `let numericId: number;`:

```typescript
  async oauthToken(
    @Body() dto: OauthTokenExchangeDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (dto.grant_type === 'client_credentials') {
      return this.handleClientCredentials(dto, req, res);
    }

    let numericId: number;
    // ...unchanged authorization_code logic below...
```

Since `dto.code` and `dto.redirect_uri` are now typed `string | undefined` (Task 4) but are only reached past the `client_credentials` early return — i.e. only when `grant_type === 'authorization_code'`, where the DTO's `@ValidateIf` guarantees they're non-empty strings — add non-null assertions at their four existing use sites in the unchanged `authorization_code` logic:

- `apps/auth-server/src/token/token.controller.ts:406`: `assertRedirectUriAllowed(dto.redirect_uri, app);` → `assertRedirectUriAllowed(dto.redirect_uri!, app);`
- `apps/auth-server/src/token/token.controller.ts:411`: `new URL(dto.redirect_uri).origin` → `new URL(dto.redirect_uri!).origin`
- `apps/auth-server/src/token/token.controller.ts:445`: `dto.code,` (first arg to `exchangeCode`) → `dto.code!,`
- `apps/auth-server/src/token/token.controller.ts:447`: `dto.redirect_uri,` (third arg to `exchangeCode`) → `dto.redirect_uri!,`

Add the new private method at the end of the `TokenController` class, after `oauthToken` and before `directLogin` (`apps/auth-server/src/token/token.controller.ts:546-548`):

```typescript
  /**
   * client_credentials branch (RFC 6749 §4.4) of oauthToken. Mints a
   * service token for a confidential app authenticating as itself — no end
   * user, gated by SaApp.canManageOwnRoles. See design spec §4.
   */
  private async handleClientCredentials(
    dto: OauthTokenExchangeDto,
    req: Request,
    res: Response,
  ) {
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

    // client_credentials is for confidential clients only (RFC 6749 §4.4) —
    // a public app has no secret to prove it's really the app it claims to
    // be, so it can never hold this grant regardless of canManageOwnRoles.
    if (!app.clientSecretHash) {
      this.logger.getWinstonLogger().warn('oauth.client_credentials.not_confidential', {
        context: 'TokenController',
        appId: dto.client_id,
      });
      throw new UnauthorizedException(TokenErrorCode.INVALID_CLIENT);
    }

    const presentedSecret = extractClientSecret(req, dto);
    const clientAuthenticated = await verifyClientSecret(presentedSecret, app.clientSecretHash);
    if (!clientAuthenticated) {
      res.setHeader('WWW-Authenticate', 'Basic realm="sassy-auth"');
      this.logger.getWinstonLogger().warn('oauth.client_credentials.auth_failed', {
        context: 'TokenController',
        appId: dto.client_id,
      });
      throw new UnauthorizedException(TokenErrorCode.INVALID_CLIENT);
    }

    // Scope is never self-granted: canManageOwnRoles is the explicit
    // admin-configured gate. A confidential client with a valid secret but
    // no opt-in still gets a token — just with nothing granted — so a
    // reasonable client sees an empty scope rather than an opaque error.
    const requested = parseServiceScopes(dto.scope);
    const granted = app.canManageOwnRoles ? requested : [];

    const token = await this.tokenService.issueServiceJwt({
      appId: app.id,
      appPublicId: app.publicId,
      scope: granted.join(' '),
    });

    this.logger.getWinstonLogger().info('Service token issued', {
      context: 'TokenController',
      appId: dto.client_id,
      scope: granted.join(' '),
    });

    return {
      access_token: token,
      token_type: 'Bearer',
      expires_in: SERVICE_TOKEN_TTL_SECONDS,
      scope: granted.join(' '),
    };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter auth-server test -- token.controller.spec.ts`
Expected: PASS (all tests, including the 6 new ones)

- [ ] **Step 5: Run the full auth-server unit test suite to check for regressions**

Run: `pnpm --filter auth-server test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/auth-server/src/token/token.controller.ts apps/auth-server/src/token/token.controller.spec.ts
git commit -m "feat(token): handle client_credentials grant in /oauth/token"
```

---

## Task 6: Export `TokenService` from `TokenModule`

**Files:**
- Modify: `apps/auth-server/src/token/token.module.ts`

`ServiceTokenGuard` (Task 7) needs `TokenService` injected outside the `TokenModule`. No test needed — this is a one-line DI wiring change verified by Task 7's guard test compiling and passing.

- [ ] **Step 1: Add `TokenService` to the module's exports**

```typescript
// apps/auth-server/src/token/token.module.ts
import { Module } from '@nestjs/common';
import { TokenController } from './token.controller';
import { DiscoveryController } from './discovery.controller';
import { TokenService } from './token.service';
import { OauthService } from './oauth.service';
import { OauthCodeCleanupService } from './oauth-code-cleanup.service';

@Module({
  controllers: [TokenController, DiscoveryController],
  // bug-0220: OauthCodeCleanupService is not injected anywhere — it is a
  // lifecycle-only provider whose OnModuleInit starts the expired-code sweep.
  providers: [TokenService, OauthService, OauthCodeCleanupService],
  exports: [OauthService, TokenService],
})
export class TokenModule {}
```

- [ ] **Step 2: Commit**

```bash
git add apps/auth-server/src/token/token.module.ts
git commit -m "chore(token): export TokenService for use by ServiceUsersModule"
```

---

## Task 7: `ServiceTokenGuard`

**Files:**
- Create: `apps/auth-server/src/service-users/service-token.guard.ts`
- Test: `apps/auth-server/src/service-users/service-token.guard.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/auth-server/src/service-users/service-token.guard.spec.ts
import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ServiceTokenGuard } from './service-token.guard';
import { TokenService } from '../token/token.service';
import { SqidService } from '../common/sqid/sqid.service';

function contextWith(headers: Record<string, string>): ExecutionContext {
  const request: Record<string, unknown> = { headers };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('ServiceTokenGuard', () => {
  const mockTokenService = { verifyServiceAccessToken: jest.fn() };
  const mockSqidService = { decode: jest.fn((s: string) => parseInt(s.replace('app-', ''), 10)) };
  let guard: ServiceTokenGuard;

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new ServiceTokenGuard(
      mockTokenService as unknown as TokenService,
      mockSqidService as unknown as SqidService,
    );
  });

  it('rejects a missing Authorization header', async () => {
    const ctx = contextWith({});
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a non-Bearer scheme', async () => {
    const ctx = contextWith({ authorization: 'Basic abc' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a token that fails verification (e.g. a user access token)', async () => {
    mockTokenService.verifyServiceAccessToken.mockImplementation(() => {
      throw new Error('Not a service access token');
    });
    const ctx = contextWith({ authorization: 'Bearer user.jwt.token' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a valid service token missing roles:write', async () => {
    mockTokenService.verifyServiceAccessToken.mockReturnValue({ azp: 'app-9', scope: '' });
    const ctx = contextWith({ authorization: 'Bearer service.jwt.token' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('accepts a valid service token with roles:write and attaches serviceApp', async () => {
    mockTokenService.verifyServiceAccessToken.mockReturnValue({ azp: 'app-9', scope: 'roles:write' });
    const request: Record<string, unknown> = { headers: { authorization: 'Bearer service.jwt.token' } };
    const ctx = { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.serviceApp).toEqual({ appId: 9, appPublicId: 'app-9' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter auth-server test -- service-token.guard.spec.ts`
Expected: FAIL — `Cannot find module './service-token.guard'`

- [ ] **Step 3: Implement the guard**

```typescript
// apps/auth-server/src/service-users/service-token.guard.ts
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { TokenErrorCode } from '@sassy-auth/types';
import { TokenService } from '../token/token.service';
import { SqidService } from '../common/sqid/sqid.service';

/**
 * Guards /api/service/users/*. Parallel to BetterAuthGuard, but for service
 * tokens instead of a human session cookie: proves the caller holds a valid
 * service token carrying roles:write, and attaches which app it belongs to.
 * See design spec §5.
 */
@Injectable()
export class ServiceTokenGuard implements CanActivate {
  constructor(
    private readonly tokenService: TokenService,
    private readonly sqidService: SqidService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization ?? '';
    const [scheme, raw] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !raw) {
      throw new UnauthorizedException(TokenErrorCode.INVALID_REQUEST);
    }

    let claims: { azp?: string; scope?: string };
    try {
      claims = this.tokenService.verifyServiceAccessToken(raw);
    } catch {
      throw new UnauthorizedException(TokenErrorCode.INVALID_GRANT);
    }

    const grantedScopes = new Set((claims.scope ?? '').split(/\s+/).filter(Boolean));
    if (!grantedScopes.has('roles:write')) {
      throw new ForbiddenException();
    }

    if (!claims.azp) {
      throw new UnauthorizedException(TokenErrorCode.INVALID_GRANT);
    }
    let appId: number;
    try {
      appId = this.sqidService.decode(claims.azp);
    } catch {
      throw new UnauthorizedException(TokenErrorCode.INVALID_GRANT);
    }

    (request as unknown as Record<string, unknown>)['serviceApp'] = {
      appId,
      appPublicId: claims.azp,
    };
    return true;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter auth-server test -- service-token.guard.spec.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/service-users/service-token.guard.ts apps/auth-server/src/service-users/service-token.guard.spec.ts
git commit -m "feat(service-users): add ServiceTokenGuard for service-token-authenticated routes"
```

---

## Task 8: `ServiceUsersService`

**Files:**
- Create: `apps/auth-server/src/service-users/service-users.service.ts`
- Test: `apps/auth-server/src/service-users/service-users.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/auth-server/src/service-users/service-users.service.spec.ts
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ServiceUsersService } from './service-users.service';

jest.mock('@sassy-auth/db', () => ({
  prisma: {
    saUser: { findUnique: jest.fn() },
    saRole: { findUnique: jest.fn() },
    saUserRole: { create: jest.fn(), delete: jest.fn() },
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockPrisma = require('@sassy-auth/db').prisma as {
  saUser: { findUnique: jest.Mock };
  saRole: { findUnique: jest.Mock };
  saUserRole: { create: jest.Mock; delete: jest.Mock };
};

const CALLING_APP_ID = 7;
const OTHER_APP_ID = 99;

function makeUser(orgAppId: number) {
  return { id: 1, publicId: 'usr1', org: { appId: orgAppId } };
}
function makeRole(appId: number, isSystem = false) {
  return { id: 5, publicId: 'role1', appId, permissions: [{ permission: { isSystem } }] };
}

describe('ServiceUsersService', () => {
  let service: ServiceUsersService;

  beforeEach(() => {
    service = new ServiceUsersService();
    jest.clearAllMocks();
  });

  describe('assignRole', () => {
    it('creates the SaUserRole link when user and role both belong to the calling app', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue(makeUser(CALLING_APP_ID));
      mockPrisma.saRole.findUnique.mockResolvedValue(makeRole(CALLING_APP_ID));
      mockPrisma.saUserRole.create.mockResolvedValue(undefined);

      await expect(service.assignRole(CALLING_APP_ID, 'usr1', 'role1')).resolves.toBeUndefined();
      expect(mockPrisma.saUserRole.create).toHaveBeenCalledWith({ data: { userId: 1, roleId: 5 } });
    });

    it('is idempotent when the role is already assigned (Prisma P2002)', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue(makeUser(CALLING_APP_ID));
      mockPrisma.saRole.findUnique.mockResolvedValue(makeRole(CALLING_APP_ID));
      mockPrisma.saUserRole.create.mockImplementationOnce(() => {
        const err = new Error('Unique constraint failed');
        (err as Error & { code?: string }).code = 'P2002';
        return Promise.reject(err);
      });

      await expect(service.assignRole(CALLING_APP_ID, 'usr1', 'role1')).resolves.toBeUndefined();
    });

    it('re-throws unexpected errors', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue(makeUser(CALLING_APP_ID));
      mockPrisma.saRole.findUnique.mockResolvedValue(makeRole(CALLING_APP_ID));
      mockPrisma.saUserRole.create.mockRejectedValue(new Error('DB timeout'));

      await expect(service.assignRole(CALLING_APP_ID, 'usr1', 'role1')).rejects.toThrow('DB timeout');
    });

    it('404s when the user does not exist', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue(null);
      await expect(service.assignRole(CALLING_APP_ID, 'missing', 'role1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('404s when the user belongs to a different app', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue(makeUser(OTHER_APP_ID));
      await expect(service.assignRole(CALLING_APP_ID, 'usr1', 'role1')).rejects.toBeInstanceOf(NotFoundException);
      expect(mockPrisma.saUserRole.create).not.toHaveBeenCalled();
    });

    it('404s when the role does not exist', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue(makeUser(CALLING_APP_ID));
      mockPrisma.saRole.findUnique.mockResolvedValue(null);
      await expect(service.assignRole(CALLING_APP_ID, 'usr1', 'missing')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('404s when the role belongs to a different app', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue(makeUser(CALLING_APP_ID));
      mockPrisma.saRole.findUnique.mockResolvedValue(makeRole(OTHER_APP_ID));
      await expect(service.assignRole(CALLING_APP_ID, 'usr1', 'role1')).rejects.toBeInstanceOf(NotFoundException);
      expect(mockPrisma.saUserRole.create).not.toHaveBeenCalled();
    });

    it('rejects a role carrying a system permission regardless of app match', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue(makeUser(CALLING_APP_ID));
      mockPrisma.saRole.findUnique.mockResolvedValue(makeRole(CALLING_APP_ID, true));
      await expect(service.assignRole(CALLING_APP_ID, 'usr1', 'role1')).rejects.toBeInstanceOf(ForbiddenException);
      expect(mockPrisma.saUserRole.create).not.toHaveBeenCalled();
    });
  });

  describe('removeRole', () => {
    it('deletes the SaUserRole link when user and role both belong to the calling app', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue(makeUser(CALLING_APP_ID));
      mockPrisma.saRole.findUnique.mockResolvedValue(makeRole(CALLING_APP_ID));
      mockPrisma.saUserRole.delete.mockResolvedValue(undefined);

      await expect(service.removeRole(CALLING_APP_ID, 'usr1', 'role1')).resolves.toBeUndefined();
      expect(mockPrisma.saUserRole.delete).toHaveBeenCalledWith({
        where: { userId_roleId: { userId: 1, roleId: 5 } },
      });
    });

    it('is idempotent when the role is not currently assigned (Prisma P2025)', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue(makeUser(CALLING_APP_ID));
      mockPrisma.saRole.findUnique.mockResolvedValue(makeRole(CALLING_APP_ID));
      mockPrisma.saUserRole.delete.mockImplementationOnce(() => {
        const err = new Error('Record not found');
        (err as Error & { code?: string }).code = 'P2025';
        return Promise.reject(err);
      });

      await expect(service.removeRole(CALLING_APP_ID, 'usr1', 'role1')).resolves.toBeUndefined();
    });

    it('404s when the role belongs to a different app', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue(makeUser(CALLING_APP_ID));
      mockPrisma.saRole.findUnique.mockResolvedValue(makeRole(OTHER_APP_ID));
      await expect(service.removeRole(CALLING_APP_ID, 'usr1', 'role1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter auth-server test -- service-users.service.spec.ts`
Expected: FAIL — `Cannot find module './service-users.service'`

- [ ] **Step 3: Implement the service**

```typescript
// apps/auth-server/src/service-users/service-users.service.ts
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '@sassy-auth/db';

/**
 * Role assign/remove for a calling app's own users, authenticated by a
 * service token (ServiceTokenGuard already proved *which app* is calling —
 * this is where the app-boundary property that actually matters is
 * enforced). Deliberately does not use checkPermission: that resolves
 * permissions for a human identity, and a service token has none. See
 * design spec §5.
 */
@Injectable()
export class ServiceUsersService {
  async assignRole(callingAppId: number, userPublicId: string, rolePublicId: string): Promise<void> {
    const { user, role } = await this.resolveAndAuthorize(callingAppId, userPublicId, rolePublicId);

    try {
      await prisma.saUserRole.create({ data: { userId: user.id, roleId: role.id } });
    } catch (e: unknown) {
      // P2002 = unique-constraint violation: the role is already assigned.
      // Assignment is idempotent — swallow and treat as success, matching
      // UsersService.assignRole.
      if (typeof e === 'object' && e !== null && 'code' in e && (e as { code?: string }).code === 'P2002') {
        return;
      }
      throw e;
    }
  }

  async removeRole(callingAppId: number, userPublicId: string, rolePublicId: string): Promise<void> {
    const { user, role } = await this.resolveAndAuthorize(callingAppId, userPublicId, rolePublicId);

    try {
      await prisma.saUserRole.delete({ where: { userId_roleId: { userId: user.id, roleId: role.id } } });
    } catch (e: unknown) {
      // P2025 = record not found: the role wasn't assigned. Idempotent —
      // matches UsersService.removeRole.
      if (typeof e === 'object' && e !== null && 'code' in e && (e as { code?: string }).code === 'P2025') {
        return;
      }
      throw e;
    }
  }

  /**
   * Both checks are required and independent: without them a service token
   * could assign a role belonging to some *other* app to the calling app's
   * user, or assign the calling app's own role to some *other* app's user.
   * 404 (not 403) on either mismatch matches the existing "don't confirm
   * existence you're not authorized to know about" posture for cross-org
   * access elsewhere in this codebase.
   */
  private async resolveAndAuthorize(callingAppId: number, userPublicId: string, rolePublicId: string) {
    const user = await prisma.saUser.findUnique({
      where: { publicId: userPublicId },
      include: { org: true },
    });
    if (!user || user.org.appId !== callingAppId) {
      throw new NotFoundException();
    }

    const role = await prisma.saRole.findUnique({
      where: { publicId: rolePublicId },
      include: { permissions: { include: { permission: { select: { isSystem: true } } } } },
    });
    if (!role || role.appId !== callingAppId) {
      throw new NotFoundException();
    }

    // A role carrying a system permission must only ever be grantable
    // through the human-admin path (assertCallerCanGrantSystemPerms in
    // UsersService) — the app-boundary check above does not substitute for
    // that guard, so it's re-asserted here independent of callingAppId.
    if (role.permissions.some((rp) => rp.permission.isSystem)) {
      throw new ForbiddenException('Cannot assign a role carrying a system permission via a service token');
    }

    return { user, role };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter auth-server test -- service-users.service.spec.ts`
Expected: PASS (11 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/service-users/service-users.service.ts apps/auth-server/src/service-users/service-users.service.spec.ts
git commit -m "feat(service-users): add ServiceUsersService for app-scoped role assign/remove"
```

---

## Task 9: `ServiceUsersController` + `ServiceUsersModule`, wired into `AppModule`

**Files:**
- Create: `apps/auth-server/src/service-users/service-users.controller.ts`
- Create: `apps/auth-server/src/service-users/service-users.module.ts`
- Test: `apps/auth-server/src/service-users/service-users.controller.spec.ts`
- Modify: `apps/auth-server/src/app.module.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/auth-server/src/service-users/service-users.controller.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { Request } from 'express';
import { ServiceUsersController } from './service-users.controller';
import { ServiceUsersService } from './service-users.service';

function reqWith(appId: number): Request {
  return { serviceApp: { appId, appPublicId: `app-${appId}` } } as unknown as Request;
}

describe('ServiceUsersController', () => {
  let controller: ServiceUsersController;
  const mockService = { assignRole: jest.fn(), removeRole: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ServiceUsersController],
      providers: [{ provide: ServiceUsersService, useValue: mockService }],
    }).compile();
    controller = module.get(ServiceUsersController);
    jest.clearAllMocks();
  });

  it('assignRole delegates to the service with the calling app id from the request', async () => {
    mockService.assignRole.mockResolvedValue(undefined);
    await controller.assignRole(reqWith(7), 'usr1', 'role1');
    expect(mockService.assignRole).toHaveBeenCalledWith(7, 'usr1', 'role1');
  });

  it('removeRole delegates to the service with the calling app id from the request', async () => {
    mockService.removeRole.mockResolvedValue(undefined);
    await controller.removeRole(reqWith(7), 'usr1', 'role1');
    expect(mockService.removeRole).toHaveBeenCalledWith(7, 'usr1', 'role1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter auth-server test -- service-users.controller.spec.ts`
Expected: FAIL — `Cannot find module './service-users.controller'`

- [ ] **Step 3: Implement the controller**

```typescript
// apps/auth-server/src/service-users/service-users.controller.ts
import { Controller, Delete, HttpCode, Param, Put, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { ServiceTokenGuard } from './service-token.guard';
import { ServiceUsersService } from './service-users.service';

function callingAppId(req: Request): number {
  return (req as unknown as Record<string, { appId: number }>)['serviceApp'].appId;
}

/**
 * PUT/DELETE on a specific role — not the human-admin AssignRoleDto-with-body
 * shape, since there's no ambiguity to carry in a body for a machine caller.
 * Idempotent PUT/DELETE matches REST convention for "this edge should
 * exist / not exist". Mounted separately from UsersController: a fully
 * separate surface with a smaller blast radius. See design spec §5.
 */
@ApiTags('Service Users')
@UseGuards(ServiceTokenGuard)
@Controller('service/users')
export class ServiceUsersController {
  constructor(private readonly service: ServiceUsersService) {}

  @Put(':userPublicId/roles/:rolePublicId')
  @HttpCode(204)
  assignRole(
    @Req() req: Request,
    @Param('userPublicId') userPublicId: string,
    @Param('rolePublicId') rolePublicId: string,
  ) {
    return this.service.assignRole(callingAppId(req), userPublicId, rolePublicId);
  }

  @Delete(':userPublicId/roles/:rolePublicId')
  @HttpCode(204)
  removeRole(
    @Req() req: Request,
    @Param('userPublicId') userPublicId: string,
    @Param('rolePublicId') rolePublicId: string,
  ) {
    return this.service.removeRole(callingAppId(req), userPublicId, rolePublicId);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter auth-server test -- service-users.controller.spec.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Create the module**

```typescript
// apps/auth-server/src/service-users/service-users.module.ts
import { Module } from '@nestjs/common';
import { ServiceUsersController } from './service-users.controller';
import { ServiceUsersService } from './service-users.service';
import { ServiceTokenGuard } from './service-token.guard';
import { CommonModule } from '../common/common.module';
import { TokenModule } from '../token/token.module';

@Module({
  imports: [CommonModule, TokenModule],
  controllers: [ServiceUsersController],
  providers: [ServiceUsersService, ServiceTokenGuard],
})
export class ServiceUsersModule {}
```

- [ ] **Step 6: Wire into `AppModule`**

In `apps/auth-server/src/app.module.ts`, add the import (alongside the other feature module imports, after `import { SocialModule } from './social/social.module';`):

```typescript
import { ServiceUsersModule } from './service-users/service-users.module';
```

And add `ServiceUsersModule` to the `imports` array (after `SocialModule`):

```typescript
    SocialModule,
    ServiceUsersModule,
    ...(isTest ? [TestSupportModule] : []),
```

- [ ] **Step 7: Verify the app still boots**

Run: `pnpm --filter auth-server build`
Expected: exits 0, no TypeScript errors (this catches any DI wiring mistakes — e.g. `ServiceTokenGuard` unable to resolve `TokenService` — since Nest's DI graph is checked at `app.init()` time, not compile time, so also run:)

Run: `pnpm --filter auth-server test -- app.e2e-spec.ts` (existing suite must still boot the full `AppModule` in its `beforeAll`)
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add apps/auth-server/src/service-users/service-users.controller.ts apps/auth-server/src/service-users/service-users.controller.spec.ts apps/auth-server/src/service-users/service-users.module.ts apps/auth-server/src/app.module.ts
git commit -m "feat(service-users): wire ServiceUsersController at PUT/DELETE /api/service/users/:id/roles/:id"
```

---

## Task 10: End-to-end proof

**Files:**
- Create: `apps/auth-server/test/matrix/service-credentials.e2e-spec.ts`

This exercises the real HTTP stack (real DB, real JWT signing/verification, real Nest DI graph) end to end: client_credentials exchange → service token → role assignment/removal via `/api/service/users`, plus the confidentiality and app-boundary error cases. It reuses the shared bootstrap in `test/matrix/harness.ts` (already runs migrations + seed once per process) and the `superAdmin`/`createTempApp` factories in `test/matrix/factories.ts`.

- [ ] **Step 1: Write the e2e test**

```typescript
// apps/auth-server/test/matrix/service-credentials.e2e-spec.ts
import request from 'supertest';
import { prisma } from '@sassy-auth/db';
import { bootApp, closeApp, as } from './harness';
import { createTempApp, superAdmin } from './factories';

describe('Service client_credentials → /api/service/users', () => {
  let httpServer: Awaited<ReturnType<typeof bootApp>>['httpServer'];
  let appPublicId: string;
  let clientSecret: string;
  let orgPublicId: string;
  let userPublicId: string;
  let rolePublicId: string;
  let otherAppPublicId: string;
  let otherRolePublicId: string;

  beforeAll(async () => {
    const booted = await bootApp();
    httpServer = booted.httpServer;
    const admin = as(superAdmin());

    const app = await createTempApp();
    appPublicId = app.publicId;

    // No @HttpCode override on AppsController.rotateClientSecret
    // (apps.controller.ts:44-47), so this is Nest's default 201 for POST.
    const secretRes = await admin.post(`/api/apps/${appPublicId}/client-secret`, {});
    if (secretRes.status !== 201) {
      throw new Error(`rotate client-secret failed (${secretRes.status}): ${JSON.stringify(secretRes.body)}`);
    }
    clientSecret = secretRes.body.clientSecret;

    const orgRes = await admin.post('/api/orgs', { name: `svc-org-${appPublicId}`, appId: appPublicId });
    orgPublicId = orgRes.body.publicId;

    const userRes = await admin.post('/api/users', {
      firstName: 'Svc', lastName: 'Target',
      email: `svc-target-${appPublicId}@example.com`,
      orgId: orgPublicId,
    });
    userPublicId = userRes.body.user.id;

    const roleRes = await admin.post('/api/roles', {
      name: `svc-role-${appPublicId}`, appId: appPublicId, permissionIds: [],
    });
    rolePublicId = roleRes.body.publicId;

    const otherApp = await createTempApp();
    otherAppPublicId = otherApp.publicId;
    const otherRoleRes = await admin.post('/api/roles', {
      name: `other-role-${otherAppPublicId}`, appId: otherAppPublicId, permissionIds: [],
    });
    otherRolePublicId = otherRoleRes.body.publicId;
  });

  afterAll(async () => {
    await closeApp();
  });

  async function exchangeServiceToken(clientId: string, secret: string) {
    return request(httpServer)
      .post('/api/token/oauth/token')
      .send({ grant_type: 'client_credentials', client_id: clientId, client_secret: secret, scope: 'roles:write' });
  }

  it('rejects a wrong client secret with invalid_client', async () => {
    const res = await exchangeServiceToken(appPublicId, 'not-the-secret');
    expect(res.status).toBe(401);
    expect(res.body.message).toContain('invalid_client');
  });

  it('grants an empty scope when canManageOwnRoles is false (the default)', async () => {
    const res = await exchangeServiceToken(appPublicId, clientSecret);
    expect(res.status).toBe(200);
    expect(res.body.scope).toBe('');

    // A token with no roles:write scope must be rejected by the guard.
    const putRes = await request(httpServer)
      .put(`/api/service/users/${userPublicId}/roles/${rolePublicId}`)
      .set('Authorization', `Bearer ${res.body.access_token}`);
    expect(putRes.status).toBe(403);
  });

  it('assigns and removes a role once canManageOwnRoles is enabled', async () => {
    await prisma.saApp.update({ where: { publicId: appPublicId }, data: { canManageOwnRoles: true } });

    const tokenRes = await exchangeServiceToken(appPublicId, clientSecret);
    expect(tokenRes.status).toBe(200);
    expect(tokenRes.body.scope).toBe('roles:write');
    const serviceToken = tokenRes.body.access_token;

    const assignRes = await request(httpServer)
      .put(`/api/service/users/${userPublicId}/roles/${rolePublicId}`)
      .set('Authorization', `Bearer ${serviceToken}`);
    expect(assignRes.status).toBe(204);

    // Immediately reflected for a human admin reading the same user's roles
    // — resolveRoles/resolvePermissions re-query on every issueJwt call, so
    // there's no separate cache to invalidate.
    const rolesRes = await as(superAdmin()).get(`/api/users/${userPublicId}/roles`);
    expect(rolesRes.body.some((r: { publicId: string }) => r.publicId === rolePublicId)).toBe(true);

    const removeRes = await request(httpServer)
      .delete(`/api/service/users/${userPublicId}/roles/${rolePublicId}`)
      .set('Authorization', `Bearer ${serviceToken}`);
    expect(removeRes.status).toBe(204);

    const rolesAfterRes = await as(superAdmin()).get(`/api/users/${userPublicId}/roles`);
    expect(rolesAfterRes.body.some((r: { publicId: string }) => r.publicId === rolePublicId)).toBe(false);
  });

  it('404s assigning a role that belongs to a different app', async () => {
    await prisma.saApp.update({ where: { publicId: appPublicId }, data: { canManageOwnRoles: true } });
    const tokenRes = await exchangeServiceToken(appPublicId, clientSecret);
    const serviceToken = tokenRes.body.access_token;

    const res = await request(httpServer)
      .put(`/api/service/users/${userPublicId}/roles/${otherRolePublicId}`)
      .set('Authorization', `Bearer ${serviceToken}`);
    expect(res.status).toBe(404);
  });

  it('rejects client_credentials entirely for a non-confidential (no secret rotated) app', async () => {
    const publicApp = await createTempApp();
    const res = await exchangeServiceToken(publicApp.publicId, 'anything');
    expect(res.status).toBe(401);
    expect(res.body.message).toContain('invalid_client');
  });
});
```

- [ ] **Step 2: Run the new e2e test**

Run: `pnpm --filter auth-server test:e2e -- service-credentials.e2e-spec.ts` (check `apps/auth-server/package.json` for the exact e2e test script name/config if this differs — mirror whatever `apps.matrix.e2e-spec.ts` etc. are run with)

Expected: PASS (5 tests).

- [ ] **Step 3: Run the full e2e matrix suite to check for regressions**

Run: `pnpm --filter auth-server test:e2e`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/auth-server/test/matrix/service-credentials.e2e-spec.ts
git commit -m "test(e2e): cover client_credentials exchange through service role assign/remove"
```

---

## Task 11: Full regression pass

**Files:** none (verification only)

- [ ] **Step 1: Run the complete auth-server test suite**

```bash
pnpm --filter auth-server test
pnpm --filter auth-server test:e2e
```

Expected: PASS, 0 failures.

- [ ] **Step 2: Run the build**

```bash
pnpm --filter auth-server build
```

Expected: exits 0, no TypeScript errors.

- [ ] **Step 3: Manual smoke check against a running dev server (optional but recommended)**

Start the auth-server (`pnpm --filter auth-server dev`), then:

```bash
curl -X POST http://localhost:3000/api/apps/<some-app-publicId>/client-secret \
  -H "Cookie: <admin session cookie>"
# → { "clientSecret": "..." }

curl -X POST http://localhost:3000/api/token/oauth/token \
  -d grant_type=client_credentials \
  -d client_id=<app-publicId> \
  -d client_secret=<secret-from-above> \
  -d scope=roles:write
# → { "access_token": "...", "token_type": "Bearer", "expires_in": 300, "scope": "" }
#   (empty scope until canManageOwnRoles is flipped true directly in the DB —
#   no admin UI for it yet, see design spec §9)
```

This step is exploratory/manual — no commit.

---

## Notes on what's intentionally NOT in this plan

Per the design spec's §9 "Out of scope" and this plan's task scope:

- No admin-console UI to toggle `canManageOwnRoles` — set it directly via `prisma.saApp.update(...)` (as Task 10's e2e test does) until that ships separately.
- No new `TokenErrorCode` values — every client_credentials failure reuses `INVALID_CLIENT` / `APP_NOT_FOUND`, matching the existing `authorization_code` error shape.
- No changes to the `prompt=none` re-authorization flow (spec §6 step 4) — it already recomputes `roles`/`permissions` on every `issueJwt` call and needs no new work; Task 10 confirms the new role is visible via the admin `GET /api/users/:id/roles` endpoint instead of driving a full re-authorization round-trip, since prompt=none itself is pre-existing, untouched functionality with its own coverage.
- No per-role or per-scope granularity on `canManageOwnRoles`, and no additional service scopes beyond `roles:write` — both explicitly deferred in the spec.
