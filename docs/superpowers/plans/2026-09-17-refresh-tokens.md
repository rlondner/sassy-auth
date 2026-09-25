# Refresh Token Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add OAuth 2.0 refresh tokens to sassy-auth, issued via `authorization_code` (gated by a new `offline_access` scope + per-app `allowOfflineAccess` flag) and `direct/login` (always), with rotation, reuse detection, and revocation on logout / user deactivation.

**Architecture:** A new `SaRefreshToken` DB table (hashed opaque tokens, family-based rotation) is managed by a new `RefreshTokenService`, parallel to the existing `OauthService`/`SaOauthCode` split. `TokenController` gains a `grant_type=refresh_token` branch on `/api/token/oauth/token`, and calls into `RefreshTokenService` at the two issuance points (`oauthToken`'s `authorization_code` branch, `directLoginInner`) and the two revocation points (`handleOauthLogout`, `UsersService.updateUser`).

**Tech Stack:** NestJS, Prisma (Postgres), Jest + Supertest, Next.js admin console (React, next-intl).

**Design doc:** `docs/superpowers/specs/2026-09-17-refresh-tokens-design.md`

---

### Task 1: Database schema — `SaRefreshToken` table + `SaApp.allowOfflineAccess`

**Files:**
- Modify: `packages/db/schema.prisma:114-147` (add field to `SaApp`)
- Modify: `packages/db/schema.prisma:308-327` (add new model after `SaOauthCode`)
- Create: `packages/db/migrations/20260917090000_add_refresh_tokens/migration.sql`

- [ ] **Step 1: Add `allowOfflineAccess` to `SaApp`**

In `packages/db/schema.prisma`, inside `model SaApp { ... }`, add this line directly under `requireTwoFactor   Boolean        @default(false)` (schema.prisma:122):

```prisma
  allowOfflineAccess Boolean        @default(false)
```

- [ ] **Step 2: Add the `SaRefreshToken` model**

In `packages/db/schema.prisma`, immediately after the closing `}` of `model SaOauthCode` (schema.prisma:327), add:

```prisma
// Opaque, single-use refresh tokens (Task: refresh token support). Only the
// sha256 hash of the token is ever stored — the plaintext exists only in the
// token response handed to the client. Tokens rotate on every use
// (tokenHash is replaced by a new row sharing the same familyId); presenting
// an already-rotated token is treated as theft and burns the whole family.
model SaRefreshToken {
  tokenHash           String    @id
  familyId            String
  saUserId            Int
  userPublicId        String
  orgPublicId         String
  appId               Int
  appPublicId         String
  scope               String
  amr                 String
  idp                 String?
  // Original authentication time, carried unchanged through every rotation
  // in the family — used to set `auth_time` on an id_token minted from a
  // refreshed access token, matching how issueIdToken already treats it as
  // the moment the user actually authenticated, not the moment of refresh.
  authTime            DateTime
  createdAt           DateTime  @default(now())
  // Sliding window: reset to now()+30d on every successful rotation.
  expiresAt           DateTime
  // Fixed at family creation to now()+90d; never extended by rotation.
  absoluteExpiresAt   DateTime
  revokedAt           DateTime?
  replacedByTokenHash String?

  @@index([familyId])
  @@index([saUserId])
  @@index([expiresAt])
}
```

- [ ] **Step 3: Write the migration SQL by hand**

`prisma migrate dev` needs a live dev database, which may not be reachable in this environment — write the SQL directly, matching the style of `packages/db/migrations/20260707180500_bug_0039_saoauthcode_table/migration.sql`.

Create `packages/db/migrations/20260917090000_add_refresh_tokens/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "SaApp" ADD COLUMN     "allowOfflineAccess" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "SaRefreshToken" (
    "tokenHash" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "saUserId" INTEGER NOT NULL,
    "userPublicId" TEXT NOT NULL,
    "orgPublicId" TEXT NOT NULL,
    "appId" INTEGER NOT NULL,
    "appPublicId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "amr" TEXT NOT NULL,
    "idp" TEXT,
    "authTime" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "absoluteExpiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedByTokenHash" TEXT,

    CONSTRAINT "SaRefreshToken_pkey" PRIMARY KEY ("tokenHash")
);

-- CreateIndex
CREATE INDEX "SaRefreshToken_familyId_idx" ON "SaRefreshToken"("familyId");

-- CreateIndex
CREATE INDEX "SaRefreshToken_saUserId_idx" ON "SaRefreshToken"("saUserId");

-- CreateIndex
CREATE INDEX "SaRefreshToken_expiresAt_idx" ON "SaRefreshToken"("expiresAt");
```

- [ ] **Step 4: Regenerate the Prisma client and verify the migration applies**

Run:
```bash
cd packages/db && pnpm db:migrate:deploy
```
Expected: `SaRefreshToken` and the `SaApp.allowOfflineAccess` column are created with no errors, and `prisma migrate status` reports no pending migrations.

Then:
```bash
pnpm db:generate
```
Expected: succeeds, `packages/db/node_modules/.prisma/client` (or wherever the generated client lands per this repo's config) now exposes `prisma.saRefreshToken`.

- [ ] **Step 5: Commit**

```bash
git add packages/db/schema.prisma packages/db/migrations/20260917090000_add_refresh_tokens
git commit -m "feat(db): add SaRefreshToken table and SaApp.allowOfflineAccess"
```

---

### Task 2: `offline_access` scope

**Files:**
- Modify: `apps/auth-server/src/token/scopes.ts`
- Test: `apps/auth-server/src/token/scopes.spec.ts` (create if it doesn't already exist)

- [ ] **Step 1: Check for an existing scopes spec**

Run: `ls apps/auth-server/src/token/scopes.spec.ts`
If it exists, read it first and add to it instead of overwriting. If not, proceed to Step 2.

- [ ] **Step 2: Write the failing test**

Create/extend `apps/auth-server/src/token/scopes.spec.ts`:

```ts
import { parseScopes, SUPPORTED_SCOPES } from './scopes';

describe('parseScopes', () => {
  it('includes offline_access in the supported scope list', () => {
    expect(SUPPORTED_SCOPES).toContain('offline_access');
  });

  it('grants offline_access when requested', () => {
    expect(parseScopes('openid offline_access')).toEqual(['openid', 'offline_access']);
  });

  it('drops offline_access when not requested', () => {
    expect(parseScopes('openid profile')).toEqual(['openid', 'profile']);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/auth-server && npx jest src/token/scopes.spec.ts`
Expected: FAIL — `SUPPORTED_SCOPES` does not contain `'offline_access'`.

- [ ] **Step 4: Add the scope**

In `apps/auth-server/src/token/scopes.ts`, change:

```ts
export const SUPPORTED_SCOPES = ['openid', 'profile', 'email'] as const;
```

to:

```ts
export const SUPPORTED_SCOPES = ['openid', 'profile', 'email', 'offline_access'] as const;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/auth-server && npx jest src/token/scopes.spec.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/auth-server/src/token/scopes.ts apps/auth-server/src/token/scopes.spec.ts
git commit -m "feat(auth-server): add offline_access to supported OAuth scopes"
```

---

### Task 3: `RefreshTokenService` — issuance, rotation, reuse detection, revocation

**Files:**
- Create: `apps/auth-server/src/token/refresh-token.service.ts`
- Test: `apps/auth-server/src/token/refresh-token.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/auth-server/src/token/refresh-token.service.spec.ts`:

```ts
import { UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';
import { RefreshTokenService } from './refresh-token.service';

jest.mock('@sassy-auth/db', () => ({
  prisma: {
    saRefreshToken: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockPrisma = require('@sassy-auth/db').prisma as {
  saRefreshToken: {
    create: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
  $transaction: jest.Mock;
};

function hashOf(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

describe('RefreshTokenService', () => {
  let service: RefreshTokenService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new RefreshTokenService();
    mockPrisma.$transaction.mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops));
  });

  describe('issue', () => {
    it('creates a new family row and returns an opaque token whose hash matches the stored row', async () => {
      const token = await service.issue({
        saUserId: 1,
        userPublicId: 'usr-1',
        orgPublicId: 'org-1',
        appId: 10,
        appPublicId: 'app-10',
        scope: 'openid offline_access',
        amr: ['pwd'],
        authTime: new Date('2026-09-17T00:00:00Z'),
      });

      expect(typeof token).toBe('string');
      expect(mockPrisma.saRefreshToken.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tokenHash: hashOf(token),
          saUserId: 1,
          userPublicId: 'usr-1',
          orgPublicId: 'org-1',
          appId: 10,
          appPublicId: 'app-10',
          scope: 'openid offline_access',
          amr: JSON.stringify(['pwd']),
          idp: null,
        }),
      });
    });

    it('sets a 30-day sliding expiry and a 90-day absolute expiry', async () => {
      const now = new Date('2026-09-17T00:00:00Z');
      jest.useFakeTimers().setSystemTime(now);
      await service.issue({
        saUserId: 1, userPublicId: 'usr-1', orgPublicId: 'org-1',
        appId: 10, appPublicId: 'app-10', scope: '', amr: ['pwd'], authTime: now,
      });
      const data = mockPrisma.saRefreshToken.create.mock.calls[0][0].data;
      expect(data.expiresAt.toISOString()).toBe(new Date('2026-10-17T00:00:00Z').toISOString());
      expect(data.absoluteExpiresAt.toISOString()).toBe(new Date('2026-12-16T00:00:00Z').toISOString());
      jest.useRealTimers();
    });
  });

  describe('rotate', () => {
    const existingRow = {
      tokenHash: 'irrelevant',
      familyId: 'fam-1',
      saUserId: 1,
      userPublicId: 'usr-1',
      orgPublicId: 'org-1',
      appId: 10,
      appPublicId: 'app-10',
      scope: 'openid',
      amr: JSON.stringify(['pwd']),
      idp: null,
      authTime: new Date('2026-09-01T00:00:00Z'),
      expiresAt: new Date('2026-10-17T00:00:00Z'),
      absoluteExpiresAt: new Date('2026-12-16T00:00:00Z'),
      revokedAt: null,
      replacedByTokenHash: null,
    };

    it('rotates a valid token: revokes the old row and issues a new one in the same family', async () => {
      mockPrisma.saRefreshToken.findUnique.mockResolvedValue(existingRow);
      mockPrisma.saRefreshToken.update.mockResolvedValue({});
      mockPrisma.saRefreshToken.create.mockResolvedValue({});

      const result = await service.rotate('presented-token', 'app-10');

      expect(result).toEqual(expect.objectContaining({
        saUserId: 1, userPublicId: 'usr-1', orgPublicId: 'org-1',
        appId: 10, appPublicId: 'app-10', scope: 'openid', amr: ['pwd'],
        authTime: existingRow.authTime,
      }));
      expect(typeof result.token).toBe('string');
      expect(mockPrisma.saRefreshToken.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tokenHash: hashOf('presented-token') },
          data: expect.objectContaining({ replacedByTokenHash: hashOf(result.token) }),
        }),
      );
      expect(mockPrisma.saRefreshToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            familyId: 'fam-1',
            absoluteExpiresAt: existingRow.absoluteExpiresAt,
          }),
        }),
      );
    });

    it('rejects an unknown token with invalid_grant', async () => {
      mockPrisma.saRefreshToken.findUnique.mockResolvedValue(null);
      await expect(service.rotate('nope', 'app-10')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a token issued for a different app', async () => {
      mockPrisma.saRefreshToken.findUnique.mockResolvedValue(existingRow);
      await expect(service.rotate('presented-token', 'app-99')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects an expired (sliding) token', async () => {
      mockPrisma.saRefreshToken.findUnique.mockResolvedValue({
        ...existingRow, expiresAt: new Date('2020-01-01T00:00:00Z'),
      });
      await expect(service.rotate('presented-token', 'app-10')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a token past its absolute expiry', async () => {
      mockPrisma.saRefreshToken.findUnique.mockResolvedValue({
        ...existingRow, absoluteExpiresAt: new Date('2020-01-01T00:00:00Z'),
      });
      await expect(service.rotate('presented-token', 'app-10')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('reuse detection: presenting an already-rotated token burns the whole family', async () => {
      mockPrisma.saRefreshToken.findUnique.mockResolvedValue({
        ...existingRow, revokedAt: new Date('2026-09-10T00:00:00Z'), replacedByTokenHash: 'some-hash',
      });
      mockPrisma.saRefreshToken.updateMany.mockResolvedValue({ count: 2 });

      await expect(service.rotate('stolen-token', 'app-10')).rejects.toBeInstanceOf(UnauthorizedException);
      expect(mockPrisma.saRefreshToken.updateMany).toHaveBeenCalledWith({
        where: { familyId: 'fam-1', revokedAt: null },
        data: expect.objectContaining({ revokedAt: expect.any(Date) }),
      });
    });
  });

  describe('revokeForUserApp', () => {
    it('revokes all non-revoked tokens for that user+app', async () => {
      mockPrisma.saRefreshToken.updateMany.mockResolvedValue({ count: 1 });
      await service.revokeForUserApp('usr-1', 'app-10');
      expect(mockPrisma.saRefreshToken.updateMany).toHaveBeenCalledWith({
        where: { userPublicId: 'usr-1', appPublicId: 'app-10', revokedAt: null },
        data: expect.objectContaining({ revokedAt: expect.any(Date) }),
      });
    });
  });

  describe('revokeForUser', () => {
    it('revokes all non-revoked tokens for that user across every app', async () => {
      mockPrisma.saRefreshToken.updateMany.mockResolvedValue({ count: 3 });
      await service.revokeForUser(1);
      expect(mockPrisma.saRefreshToken.updateMany).toHaveBeenCalledWith({
        where: { saUserId: 1, revokedAt: null },
        data: expect.objectContaining({ revokedAt: expect.any(Date) }),
      });
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/auth-server && npx jest src/token/refresh-token.service.spec.ts`
Expected: FAIL — `Cannot find module './refresh-token.service'`.

- [ ] **Step 3: Implement `RefreshTokenService`**

Create `apps/auth-server/src/token/refresh-token.service.ts`:

```ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';
import { prisma } from '@sassy-auth/db';
import { TokenErrorCode } from '@sassy-auth/types';

const SLIDING_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const ABSOLUTE_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

export interface IssueRefreshTokenParams {
  saUserId: number;
  userPublicId: string;
  orgPublicId: string;
  appId: number;
  appPublicId: string;
  scope: string;
  amr: string[];
  idp?: string;
  authTime: Date;
}

export interface RotatedRefreshToken {
  token: string;
  saUserId: number;
  userPublicId: string;
  orgPublicId: string;
  appId: number;
  appPublicId: string;
  scope: string;
  amr: string[];
  idp?: string;
  authTime: Date;
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function safeParseAmr(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : ['pwd'];
  } catch {
    return ['pwd'];
  }
}

@Injectable()
export class RefreshTokenService {
  /** First issuance: starts a new rotation family. */
  async issue(params: IssueRefreshTokenParams): Promise<string> {
    const token = crypto.randomBytes(32).toString('hex');
    const familyId = crypto.randomBytes(16).toString('hex');
    const now = Date.now();
    await prisma.saRefreshToken.create({
      data: {
        tokenHash: hashToken(token),
        familyId,
        saUserId: params.saUserId,
        userPublicId: params.userPublicId,
        orgPublicId: params.orgPublicId,
        appId: params.appId,
        appPublicId: params.appPublicId,
        scope: params.scope,
        amr: JSON.stringify(params.amr),
        idp: params.idp ?? null,
        authTime: params.authTime,
        expiresAt: new Date(now + SLIDING_TTL_MS),
        absoluteExpiresAt: new Date(now + ABSOLUTE_TTL_MS),
      },
    });
    return token;
  }

  /**
   * Redeems a presented refresh token: rotates it (single-use) and returns
   * the claims needed to mint a fresh access token, plus the new refresh
   * token. Every failure mode — not found, wrong app, expired, or reuse of
   * an already-rotated token — throws the same invalid_grant so none of
   * them are distinguishable to the caller.
   *
   * Reuse detection: if the presented token has already been rotated
   * (revokedAt set), that token must have leaked — the entire family is
   * revoked so the whole rotation chain is burned, not just this token.
   */
  async rotate(presentedToken: string, appPublicId: string): Promise<RotatedRefreshToken> {
    const tokenHash = hashToken(presentedToken);
    const row = await prisma.saRefreshToken.findUnique({ where: { tokenHash } });
    if (!row || row.appPublicId !== appPublicId) {
      throw new UnauthorizedException(TokenErrorCode.INVALID_GRANT);
    }

    const now = new Date();
    if (row.revokedAt) {
      await prisma.saRefreshToken.updateMany({
        where: { familyId: row.familyId, revokedAt: null },
        data: { revokedAt: now },
      });
      throw new UnauthorizedException(TokenErrorCode.INVALID_GRANT);
    }
    if (row.expiresAt < now || row.absoluteExpiresAt < now) {
      throw new UnauthorizedException(TokenErrorCode.INVALID_GRANT);
    }

    const newToken = crypto.randomBytes(32).toString('hex');
    const newTokenHash = hashToken(newToken);
    await prisma.$transaction([
      prisma.saRefreshToken.update({
        where: { tokenHash },
        data: { revokedAt: now, replacedByTokenHash: newTokenHash },
      }),
      prisma.saRefreshToken.create({
        data: {
          tokenHash: newTokenHash,
          familyId: row.familyId,
          saUserId: row.saUserId,
          userPublicId: row.userPublicId,
          orgPublicId: row.orgPublicId,
          appId: row.appId,
          appPublicId: row.appPublicId,
          scope: row.scope,
          amr: row.amr,
          idp: row.idp,
          authTime: row.authTime,
          expiresAt: new Date(now.getTime() + SLIDING_TTL_MS),
          absoluteExpiresAt: row.absoluteExpiresAt,
        },
      }),
    ]);

    return {
      token: newToken,
      saUserId: row.saUserId,
      userPublicId: row.userPublicId,
      orgPublicId: row.orgPublicId,
      appId: row.appId,
      appPublicId: row.appPublicId,
      scope: row.scope,
      amr: safeParseAmr(row.amr),
      idp: row.idp ?? undefined,
      authTime: row.authTime,
    };
  }

  /** Revokes every outstanding refresh token for (userPublicId, appPublicId) — used on logout. */
  async revokeForUserApp(userPublicId: string, appPublicId: string): Promise<void> {
    await prisma.saRefreshToken.updateMany({
      where: { userPublicId, appPublicId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Revokes every outstanding refresh token for a user across all apps — used on deactivation. */
  async revokeForUser(saUserId: number): Promise<void> {
    await prisma.saRefreshToken.updateMany({
      where: { saUserId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/auth-server && npx jest src/token/refresh-token.service.spec.ts`
Expected: PASS (all cases)

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/token/refresh-token.service.ts apps/auth-server/src/token/refresh-token.service.spec.ts
git commit -m "feat(auth-server): add RefreshTokenService with rotation and reuse detection"
```

---

### Task 4: Wire `RefreshTokenService` into `TokenModule` and `TokenController`

**Files:**
- Modify: `apps/auth-server/src/token/token.module.ts`
- Modify: `apps/auth-server/src/token/token.controller.ts:75-81` (constructor)
- Modify: `apps/auth-server/src/token/token.controller.spec.ts` (all `TestingModule` blocks)

- [ ] **Step 1: Register the provider**

In `apps/auth-server/src/token/token.module.ts`, add the import and provider:

```ts
import { Module } from '@nestjs/common';
import { TokenController } from './token.controller';
import { DiscoveryController } from './discovery.controller';
import { TokenService } from './token.service';
import { OauthService } from './oauth.service';
import { OauthCodeCleanupService } from './oauth-code-cleanup.service';
import { RefreshTokenService } from './refresh-token.service';

@Module({
  controllers: [TokenController, DiscoveryController],
  providers: [TokenService, OauthService, OauthCodeCleanupService, RefreshTokenService],
  exports: [OauthService],
})
export class TokenModule {}
```

- [ ] **Step 2: Inject it into `TokenController`**

In `apps/auth-server/src/token/token.controller.ts`, add the import near the other token imports (after the `TokenService` import at line 50):

```ts
import { RefreshTokenService } from './refresh-token.service';
```

Change the constructor (`token.controller.ts:76-81`) from:

```ts
  constructor(
    private readonly tokenService: TokenService,
    private readonly oauthService: OauthService,
    private readonly sqidService: SqidService,
    private readonly logger: LoggerService,
  ) {}
```

to:

```ts
  constructor(
    private readonly tokenService: TokenService,
    private readonly oauthService: OauthService,
    private readonly sqidService: SqidService,
    private readonly logger: LoggerService,
    private readonly refreshTokenService: RefreshTokenService,
  ) {}
```

- [ ] **Step 3: Add the mock and register it in every `TestingModule` in the controller spec**

In `apps/auth-server/src/token/token.controller.spec.ts`, add near `mockOauthService` (spec.ts:93-96):

```ts
const mockRefreshTokenService = {
  issue: jest.fn(),
  rotate: jest.fn(),
  revokeForUserApp: jest.fn(),
  revokeForUser: jest.fn(),
};
```

Then add `{ provide: RefreshTokenService, useValue: mockRefreshTokenService },` to the `providers` array in each of the five `Test.createTestingModule({...})` calls in this file (lines 107, 1019, 1303, 1422, 1521 as of this writing — search for `Test.createTestingModule` to find all of them, there must be exactly five). Also add the import:

```ts
import { RefreshTokenService } from './refresh-token.service';
```

- [ ] **Step 4: Run the existing controller test suite to confirm nothing broke**

Run: `cd apps/auth-server && npx jest src/token/token.controller.spec.ts`
Expected: PASS — all pre-existing tests still pass (the new provider is a no-op for tests that never call the token endpoints exercising it).

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/token/token.module.ts apps/auth-server/src/token/token.controller.ts apps/auth-server/src/token/token.controller.spec.ts
git commit -m "feat(auth-server): wire RefreshTokenService into TokenModule and TokenController"
```

---

### Task 5: Gate `offline_access` on `SaApp.allowOfflineAccess` at `/authorize`

**Files:**
- Modify: `apps/auth-server/src/token/token.controller.ts:298-318`
- Test: `apps/auth-server/src/token/token.controller.spec.ts`

- [ ] **Step 1: Write the failing test**

Add to the `describe('oauthAuthorize', ...)` block in `token.controller.spec.ts` (near the existing `'parses granted scopes and passes nonce through to generateCode'` test at spec.ts:553):

```ts
    it('drops offline_access from the granted scope when the app has not opted in', async () => {
      mockGetSession.mockResolvedValue({
        user: { id: 'ba-1', twoFactorEnabled: false },
        session: { createdAt: new Date().toISOString() },
      });
      mockPrisma.saApp.findUnique.mockResolvedValue({
        id: 10, publicId: 'sqid-10', url: 'https://app.example.com',
        redirectUris: [{ uri: 'https://app.example.com/callback', kind: 'login' }],
        clientSecretHash: null, allowOfflineAccess: false,
      });
      mockPrisma.saUser.findFirst.mockResolvedValue({
        publicId: 'sqid-1', status: 'active', org: { appId: 10, publicId: 'sqid-5' },
      });
      mockOauthService.generateCode.mockResolvedValue('code-123');

      await controller.oauthAuthorize(
        'sqid-10', 'https://app.example.com/callback', 'x'.repeat(43), 'S256', '',
        {} as unknown as import('express').Request, 'openid offline_access', '', '', '',
      );

      expect(mockOauthService.generateCode).toHaveBeenCalledWith(
        'sqid-1', 'sqid-10', 'https://app.example.com/callback', 'x'.repeat(43), 'S256',
        expect.any(Array), null, 'openid', expect.any(Date), undefined,
      );
    });

    it('keeps offline_access in the granted scope when the app has opted in', async () => {
      mockGetSession.mockResolvedValue({
        user: { id: 'ba-1', twoFactorEnabled: false },
        session: { createdAt: new Date().toISOString() },
      });
      mockPrisma.saApp.findUnique.mockResolvedValue({
        id: 10, publicId: 'sqid-10', url: 'https://app.example.com',
        redirectUris: [{ uri: 'https://app.example.com/callback', kind: 'login' }],
        clientSecretHash: null, allowOfflineAccess: true,
      });
      mockPrisma.saUser.findFirst.mockResolvedValue({
        publicId: 'sqid-1', status: 'active', org: { appId: 10, publicId: 'sqid-5' },
      });
      mockOauthService.generateCode.mockResolvedValue('code-123');

      await controller.oauthAuthorize(
        'sqid-10', 'https://app.example.com/callback', 'x'.repeat(43), 'S256', '',
        {} as unknown as import('express').Request, 'openid offline_access', '', '', '',
      );

      expect(mockOauthService.generateCode).toHaveBeenCalledWith(
        'sqid-1', 'sqid-10', 'https://app.example.com/callback', 'x'.repeat(43), 'S256',
        expect.any(Array), null, 'openid offline_access', expect.any(Date), undefined,
      );
    });
```

Check the exact existing `generateCode` call-site test (spec.ts:553-583) for the argument order/shape before writing these — match it exactly rather than guessing.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/auth-server && npx jest src/token/token.controller.spec.ts -t "offline_access"`
Expected: FAIL — both tests currently receive `'openid offline_access'` regardless of `allowOfflineAccess`, so the first test's assertion (`'openid'`, no `offline_access`) fails.

- [ ] **Step 3: Apply the gate**

In `apps/auth-server/src/token/token.controller.ts`, change (token.controller.ts:298-303):

```ts
      const { amr, idp } = deriveAuthMethods({
        signInMethod: (session.session as { signInMethod?: string | null }).signInMethod ?? null,
        twoFactorEnabled: Boolean((session.user as { twoFactorEnabled?: boolean }).twoFactorEnabled),
      });
      const granted = parseScopes(scope);
```

to:

```ts
      const { amr, idp } = deriveAuthMethods({
        signInMethod: (session.session as { signInMethod?: string | null }).signInMethod ?? null,
        twoFactorEnabled: Boolean((session.user as { twoFactorEnabled?: boolean }).twoFactorEnabled),
      });
      // offline_access is only honored for apps explicitly opted in — an app
      // that never asked for the refresh-token feature shouldn't start
      // getting one just because a client requests the scope.
      const granted = parseScopes(scope).filter(
        (s) => s !== 'offline_access' || app.allowOfflineAccess,
      );
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/auth-server && npx jest src/token/token.controller.spec.ts`
Expected: PASS — new tests pass, all pre-existing `oauthAuthorize` tests still pass (they don't request `offline_access`, so the filter is a no-op for them).

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/token/token.controller.ts apps/auth-server/src/token/token.controller.spec.ts
git commit -m "feat(auth-server): gate offline_access scope on SaApp.allowOfflineAccess"
```

---

### Task 6: DTO — accept `grant_type=refresh_token`

**Files:**
- Modify: `apps/auth-server/src/token/dto/oauth-token-exchange.dto.ts`

- [ ] **Step 1: Update the DTO**

Replace the full contents of `apps/auth-server/src/token/dto/oauth-token-exchange.dto.ts` with:

```ts
import { IsString, IsNotEmpty, IsUrl, IsOptional, IsIn, ValidateIf } from 'class-validator';

export class OauthTokenExchangeDto {
  /** RFC 6749 §4.1.3 / §6 — every token request names its grant type.
   *  This server supports the authorization_code grant (matching
   *  `grant_types_supported` in the discovery documents) and refresh_token. */
  @IsIn(['authorization_code', 'refresh_token'])
  grant_type!: string;

  /** Required for grant_type=authorization_code; absent for refresh_token. */
  @ValidateIf((o: OauthTokenExchangeDto) => o.grant_type === 'authorization_code')
  @IsString()
  @IsNotEmpty()
  code?: string;

  /** sa_app.publicId — must match the app that requested the code, or that
   *  the refresh token was issued to. */
  @IsString()
  @IsNotEmpty()
  client_id!: string;

  /** PKCE code verifier — the plaintext that was used to derive the
   *  code_challenge sent on the authorize call. Optional: a confidential
   *  client may omit PKCE entirely and authenticate with a client secret
   *  instead (Task 9). Not used for grant_type=refresh_token. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  code_verifier?: string;

  /** Required for grant_type=authorization_code; absent for refresh_token. */
  @ValidateIf((o: OauthTokenExchangeDto) => o.grant_type === 'authorization_code')
  @IsUrl({ require_tld: false })
  redirect_uri?: string;

  /** `client_secret_post` — the plaintext client secret, when the client
   *  authenticates via the request body instead of an Authorization: Basic
   *  header (`client_secret_basic`). Applies to both grant types. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  client_secret?: string;

  /** Required for grant_type=refresh_token — the opaque refresh token to
   *  redeem and rotate. */
  @ValidateIf((o: OauthTokenExchangeDto) => o.grant_type === 'refresh_token')
  @IsString()
  @IsNotEmpty()
  refresh_token?: string;
}
```

- [ ] **Step 2: Run the existing DTO-adjacent tests to confirm nothing broke**

Run: `cd apps/auth-server && npx jest src/token/token.controller.spec.ts -t "confidential client"`
Expected: PASS — these tests exercise real `ValidationPipe` behavior via supertest with `grant_type: 'authorization_code'`, `code`, and `redirect_uri` always present, so the `ValidateIf` conditions still require them exactly as before.

- [ ] **Step 3: Commit**

```bash
git add apps/auth-server/src/token/dto/oauth-token-exchange.dto.ts
git commit -m "feat(auth-server): accept grant_type=refresh_token in the token exchange DTO"
```

---

### Task 7: Split `oauthToken` into grant-specific handlers; issue refresh tokens on `authorization_code`

**Files:**
- Modify: `apps/auth-server/src/token/token.controller.ts:375-546`
- Test: `apps/auth-server/src/token/token.controller.spec.ts`

- [ ] **Step 1: Write the failing tests**

Add to the `describe('oauthToken', ...)` block in `token.controller.spec.ts`, after the existing `'returns access_token when code is valid'` test:

```ts
    it('does not include refresh_token when offline_access was not granted', async () => {
      mockOauthService.exchangeCode.mockReturnValue({
        userId: 'sqid-1', appPublicId: 'sqid-10', scope: 'openid', hadChallenge: true,
        amr: ['pwd'], authTime: new Date('2026-09-17T00:00:00Z'),
      });
      mockPrisma.saUser.findFirst.mockResolvedValue({
        id: 1, publicId: 'sqid-1', status: 'active', orgId: 5, org: { publicId: 'sqid-5', appId: 10 },
      });
      mockPrisma.saApp.findUnique.mockResolvedValue({ id: 10, publicId: 'sqid-10', url: 'https://app.example.com' });
      mockTokenService.issueJwt.mockResolvedValue('oauth.jwt.token');
      mockTokenService.issueIdToken.mockResolvedValue('oauth.id.token');

      const result = await controller.oauthToken(
        {
          grant_type: 'authorization_code', code: 'valid-code', client_id: 'sqid-10',
          code_verifier: 'a'.repeat(64), redirect_uri: 'https://app.example.com/callback',
        },
        fakeTokenReq, fakeTokenRes,
      );

      expect(result).not.toHaveProperty('refresh_token');
      expect(mockRefreshTokenService.issue).not.toHaveBeenCalled();
    });

    it('includes refresh_token when offline_access was granted', async () => {
      mockOauthService.exchangeCode.mockReturnValue({
        userId: 'sqid-1', appPublicId: 'sqid-10', scope: 'openid offline_access', hadChallenge: true,
        amr: ['pwd'], authTime: new Date('2026-09-17T00:00:00Z'),
      });
      mockPrisma.saUser.findFirst.mockResolvedValue({
        id: 1, publicId: 'sqid-1', status: 'active', orgId: 5, org: { publicId: 'sqid-5', appId: 10 },
      });
      mockPrisma.saApp.findUnique.mockResolvedValue({ id: 10, publicId: 'sqid-10', url: 'https://app.example.com' });
      mockTokenService.issueJwt.mockResolvedValue('oauth.jwt.token');
      mockTokenService.issueIdToken.mockResolvedValue('oauth.id.token');
      mockRefreshTokenService.issue.mockResolvedValue('new-refresh-token');

      const result = await controller.oauthToken(
        {
          grant_type: 'authorization_code', code: 'valid-code', client_id: 'sqid-10',
          code_verifier: 'a'.repeat(64), redirect_uri: 'https://app.example.com/callback',
        },
        fakeTokenReq, fakeTokenRes,
      );

      expect(result).toEqual(expect.objectContaining({ refresh_token: 'new-refresh-token' }));
      expect(mockRefreshTokenService.issue).toHaveBeenCalledWith(
        expect.objectContaining({
          saUserId: 1, userPublicId: 'sqid-1', orgPublicId: 'sqid-5',
          appId: 10, appPublicId: 'sqid-10', scope: 'openid offline_access', amr: ['pwd'],
          authTime: new Date('2026-09-17T00:00:00Z'),
        }),
      );
    });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/auth-server && npx jest src/token/token.controller.spec.ts -t "offline_access was"`
Expected: FAIL — `refresh_token` is never returned yet, and `mockRefreshTokenService.issue` is never called.

- [ ] **Step 3: Add refresh-token issuance to the `authorization_code` branch**

In `apps/auth-server/src/token/token.controller.ts`, the exchanged-code's `authTime` needs to reach this point — it's already on `exchanged` (see `OauthService.exchangeCode`'s return type, `oauth.service.ts:81-88`). Change the response-building tail of `oauthToken` (token.controller.ts:504-546) from:

```ts
    const token = await this.tokenService.issueJwt({
      saUserId: saUser.id,
      userPublicId: saUser.publicId,
      orgPublicId: saUser.org.publicId,
      appPublicId,
      appId: app.id,
      scope: exchanged.scope,
      amr: exchangedAmr,
      idp: exchangedIdp,
    });

    const grantedOpenId = exchanged.scope.split(/\s+/).includes('openid');
    const idToken = grantedOpenId
      ? await this.tokenService.issueIdToken({
          saUserId: saUser.id,
          userPublicId: saUser.publicId,
          orgPublicId: saUser.org.publicId,
          appPublicId,
          scope: exchanged.scope,
          nonce: exchanged.nonce,
          authTime: exchanged.authTime,
          amr: exchangedAmr,
          accessToken: token,
        })
      : undefined;

    this.logger.getWinstonLogger().info('OAuth code exchanged, JWT issued', {
      context: 'TokenController',
      appId: appPublicId,
      userId: userPublicId,
      pkceMethod: 'S256',
    });

    const oauthTokenResponse = {
      access_token: token,
      token_type: 'Bearer',
      expires_in: 3600,
      scope: exchanged.scope,
      ...(idToken ? { id_token: idToken } : {}),
    };
    console.log('[oauth/token response]', oauthTokenResponse);
    return oauthTokenResponse;
  }
```

to:

```ts
    const token = await this.tokenService.issueJwt({
      saUserId: saUser.id,
      userPublicId: saUser.publicId,
      orgPublicId: saUser.org.publicId,
      appPublicId,
      appId: app.id,
      scope: exchanged.scope,
      amr: exchangedAmr,
      idp: exchangedIdp,
    });

    const grantedOpenId = exchanged.scope.split(/\s+/).includes('openid');
    const idToken = grantedOpenId
      ? await this.tokenService.issueIdToken({
          saUserId: saUser.id,
          userPublicId: saUser.publicId,
          orgPublicId: saUser.org.publicId,
          appPublicId,
          scope: exchanged.scope,
          nonce: exchanged.nonce,
          authTime: exchanged.authTime,
          amr: exchangedAmr,
          accessToken: token,
        })
      : undefined;

    // offline_access has already been dropped from `exchanged.scope` at
    // /authorize time for apps that never opted in (Task 5), so this check
    // alone is enough to decide whether a refresh token should exist.
    const grantedOffline = exchanged.scope.split(/\s+/).includes('offline_access');
    const refreshToken = grantedOffline
      ? await this.refreshTokenService.issue({
          saUserId: saUser.id,
          userPublicId: saUser.publicId,
          orgPublicId: saUser.org.publicId,
          appId: app.id,
          appPublicId,
          scope: exchanged.scope,
          amr: exchangedAmr,
          idp: exchangedIdp,
          authTime: exchanged.authTime,
        })
      : undefined;

    this.logger.getWinstonLogger().info('OAuth code exchanged, JWT issued', {
      context: 'TokenController',
      appId: appPublicId,
      userId: userPublicId,
      pkceMethod: 'S256',
    });

    const oauthTokenResponse = {
      access_token: token,
      token_type: 'Bearer',
      expires_in: 3600,
      scope: exchanged.scope,
      ...(idToken ? { id_token: idToken } : {}),
      ...(refreshToken ? { refresh_token: refreshToken } : {}),
    };
    console.log('[oauth/token response]', oauthTokenResponse);
    return oauthTokenResponse;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/auth-server && npx jest src/token/token.controller.spec.ts`
Expected: PASS — new tests pass; all pre-existing `oauthToken` tests still pass (`exchanged.scope` in those fixtures never contains `offline_access`, so `refreshToken` stays `undefined` and the response shape is unchanged).

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/token/token.controller.ts apps/auth-server/src/token/token.controller.spec.ts
git commit -m "feat(auth-server): issue a refresh token on authorization_code exchange when offline_access is granted"
```

---

### Task 8: `grant_type=refresh_token` — rotation endpoint

**Files:**
- Modify: `apps/auth-server/src/token/token.controller.ts` (`oauthToken` dispatch + new private method)
- Test: `apps/auth-server/src/token/token.controller.spec.ts`

- [ ] **Step 1: Write the failing tests**

Add a new `describe` block in `token.controller.spec.ts`, after the closing of `describe('oauthToken', ...)`:

```ts
  describe('oauthToken — grant_type=refresh_token', () => {
    const fakeReq = { headers: {} } as unknown as import('express').Request;
    const fakeRes = { setHeader: jest.fn() } as unknown as import('express').Response;

    it('rotates a valid refresh token and returns a new access+refresh token pair', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue({ id: 10, publicId: 'sqid-10', clientSecretHash: null });
      mockRefreshTokenService.rotate.mockResolvedValue({
        token: 'new-refresh-token',
        saUserId: 1, userPublicId: 'sqid-1', orgPublicId: 'sqid-5',
        appId: 10, appPublicId: 'sqid-10', scope: 'openid', amr: ['pwd'],
        authTime: new Date('2026-09-01T00:00:00Z'),
      });
      mockPrisma.saUser.findFirst.mockResolvedValue({ publicId: 'sqid-1', status: 'active' });
      mockTokenService.issueJwt.mockResolvedValue('new.jwt.token');
      mockTokenService.issueIdToken.mockResolvedValue('new.id.token');

      const result = await controller.oauthToken(
        { grant_type: 'refresh_token', client_id: 'sqid-10', refresh_token: 'old-refresh-token' },
        fakeReq, fakeRes,
      );

      expect(mockRefreshTokenService.rotate).toHaveBeenCalledWith('old-refresh-token', 'sqid-10');
      expect(result).toEqual({
        access_token: 'new.jwt.token', token_type: 'Bearer', expires_in: 3600,
        scope: 'openid', refresh_token: 'new-refresh-token', id_token: 'new.id.token',
      });
    });

    it('does not include id_token when openid was not in the rotated scope', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue({ id: 10, publicId: 'sqid-10', clientSecretHash: null });
      mockRefreshTokenService.rotate.mockResolvedValue({
        token: 'new-refresh-token', saUserId: 1, userPublicId: 'sqid-1', orgPublicId: 'sqid-5',
        appId: 10, appPublicId: 'sqid-10', scope: '', amr: ['pwd'], authTime: new Date(),
      });
      mockPrisma.saUser.findFirst.mockResolvedValue({ publicId: 'sqid-1', status: 'active' });
      mockTokenService.issueJwt.mockResolvedValue('new.jwt.token');

      const result = await controller.oauthToken(
        { grant_type: 'refresh_token', client_id: 'sqid-10', refresh_token: 'old-refresh-token' },
        fakeReq, fakeRes,
      );

      expect(result).not.toHaveProperty('id_token');
      expect(mockTokenService.issueIdToken).not.toHaveBeenCalled();
    });

    it('rejects when the rotated token belongs to a user who is no longer active', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue({ id: 10, publicId: 'sqid-10', clientSecretHash: null });
      mockRefreshTokenService.rotate.mockResolvedValue({
        token: 'new-refresh-token', saUserId: 1, userPublicId: 'sqid-1', orgPublicId: 'sqid-5',
        appId: 10, appPublicId: 'sqid-10', scope: '', amr: ['pwd'], authTime: new Date(),
      });
      mockPrisma.saUser.findFirst.mockResolvedValue({ publicId: 'sqid-1', status: 'inactive' });

      await expect(controller.oauthToken(
        { grant_type: 'refresh_token', client_id: 'sqid-10', refresh_token: 'old-refresh-token' },
        fakeReq, fakeRes,
      )).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('propagates rotate()\'s invalid_grant rejection unchanged (reuse detection, expiry, unknown token)', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue({ id: 10, publicId: 'sqid-10', clientSecretHash: null });
      mockRefreshTokenService.rotate.mockRejectedValue(new UnauthorizedException(TokenErrorCode.INVALID_GRANT));

      await expect(controller.oauthToken(
        { grant_type: 'refresh_token', client_id: 'sqid-10', refresh_token: 'stolen-token' },
        fakeReq, fakeRes,
      )).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a refresh grant for a confidential app with no client secret presented', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue({ id: 10, publicId: 'sqid-10', clientSecretHash: 'hashed' });

      await expect(controller.oauthToken(
        { grant_type: 'refresh_token', client_id: 'sqid-10', refresh_token: 'some-token' },
        fakeReq, fakeRes,
      )).rejects.toBeInstanceOf(UnauthorizedException);
      expect(mockRefreshTokenService.rotate).not.toHaveBeenCalled();
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/auth-server && npx jest src/token/token.controller.spec.ts -t "grant_type=refresh_token"`
Expected: FAIL — `oauthToken` doesn't yet branch on `grant_type === 'refresh_token'`, so it falls into the `authorization_code` path and throws on the missing `code`/`redirect_uri`.

- [ ] **Step 3: Add the dispatch and the new private method**

In `apps/auth-server/src/token/token.controller.ts`, change the start of `oauthToken` (token.controller.ts:383-403) from:

```ts
  @HttpCode(200)
  @Post(OAUTH_TOKEN_ROUTE)
  async oauthToken(
    @Body() dto: OauthTokenExchangeDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    let numericId: number;
    try {
      numericId = this.sqidService.decode(dto.client_id);
    } catch {
      throw new BadRequestException(TokenErrorCode.APP_NOT_FOUND);
    }
    const app = await prisma.saApp.findUnique({
      where: { id: numericId },
      include: { redirectUris: true },
    });
    if (!app) {
      throw new NotFoundException(TokenErrorCode.APP_NOT_FOUND);
    }
    const appClientSecretHash = app.clientSecretHash;
```

to:

```ts
  @HttpCode(200)
  @Post(OAUTH_TOKEN_ROUTE)
  async oauthToken(
    @Body() dto: OauthTokenExchangeDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (dto.grant_type === 'refresh_token') {
      return this.refreshTokenGrant(dto, req, res);
    }

    let numericId: number;
    try {
      numericId = this.sqidService.decode(dto.client_id);
    } catch {
      throw new BadRequestException(TokenErrorCode.APP_NOT_FOUND);
    }
    const app = await prisma.saApp.findUnique({
      where: { id: numericId },
      include: { redirectUris: true },
    });
    if (!app) {
      throw new NotFoundException(TokenErrorCode.APP_NOT_FOUND);
    }
    const appClientSecretHash = app.clientSecretHash;
```

Then add the new private method immediately after the closing `}` of `oauthToken` (right before the `/** * POST /api/token/direct/login` doc comment at token.controller.ts:548-553):

```ts
  /**
   * grant_type=refresh_token branch of /api/token/oauth/token. Rotates the
   * presented refresh token (RefreshTokenService.rotate handles reuse
   * detection and expiry) and mints a fresh access token — and id_token, if
   * the family's scope includes openid — from the rotated claims.
   */
  private async refreshTokenGrant(
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

    const presentedSecret = extractClientSecret(req, dto);
    const clientAuthenticated = await verifyClientSecret(presentedSecret, app.clientSecretHash ?? null);
    if (app.clientSecretHash && !clientAuthenticated) {
      res.setHeader('WWW-Authenticate', 'Basic realm="sassy-auth"');
      this.logger.getWinstonLogger().warn('oauth.client_auth.failed', {
        context: 'TokenController',
        appId: dto.client_id,
      });
      throw new UnauthorizedException(TokenErrorCode.INVALID_CLIENT);
    }

    // @ValidateIf on OauthTokenExchangeDto guarantees refresh_token is
    // present for this grant type.
    const rotated = await this.refreshTokenService.rotate(dto.refresh_token!, dto.client_id);

    const saUser = await prisma.saUser.findFirst({ where: { publicId: rotated.userPublicId } });
    if (!saUser || saUser.status !== 'active') {
      throw new ForbiddenException(TokenErrorCode.USER_NOT_FOUND);
    }

    const token = await this.tokenService.issueJwt({
      saUserId: rotated.saUserId,
      userPublicId: rotated.userPublicId,
      orgPublicId: rotated.orgPublicId,
      appPublicId: rotated.appPublicId,
      appId: rotated.appId,
      scope: rotated.scope,
      amr: rotated.amr,
      idp: rotated.idp,
    });

    const grantedOpenId = rotated.scope.split(/\s+/).includes('openid');
    const idToken = grantedOpenId
      ? await this.tokenService.issueIdToken({
          saUserId: rotated.saUserId,
          userPublicId: rotated.userPublicId,
          orgPublicId: rotated.orgPublicId,
          appPublicId: rotated.appPublicId,
          scope: rotated.scope,
          // A refreshed id_token carries no nonce — nonce only authenticates
          // the original authorize-time round trip, not later refreshes.
          nonce: null,
          authTime: rotated.authTime,
          amr: rotated.amr,
          accessToken: token,
        })
      : undefined;

    this.logger.getWinstonLogger().info('OAuth refresh token rotated, JWT issued', {
      context: 'TokenController',
      appId: rotated.appPublicId,
      userId: rotated.userPublicId,
    });

    return {
      access_token: token,
      token_type: 'Bearer',
      expires_in: 3600,
      scope: rotated.scope,
      refresh_token: rotated.token,
      ...(idToken ? { id_token: idToken } : {}),
    };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/auth-server && npx jest src/token/token.controller.spec.ts`
Expected: PASS — all new and pre-existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/token/token.controller.ts apps/auth-server/src/token/token.controller.spec.ts
git commit -m "feat(auth-server): implement grant_type=refresh_token rotation endpoint"
```

---

### Task 9: Issue a refresh token on `direct/login`

**Files:**
- Modify: `apps/auth-server/src/token/token.controller.ts:781-802`
- Test: `apps/auth-server/src/token/token.controller.spec.ts`

- [ ] **Step 1: Write the failing test**

Add to the `describe('directLogin', ...)` block in `token.controller.spec.ts`, after the existing `'bumps SaUser.lastLoginAt on successful directLogin'` test:

```ts
    it('always issues a refresh token, since direct/login has no /authorize step to gate offline_access', async () => {
      const saUser = {
        id: 1, publicId: 'usr-1', betterAuthUserId: 'ba-1', status: 'active',
        org: { publicId: 'org-1', appId: 10 }, betterAuthUser: { email: 'a@b.co' },
      };
      mockPrisma.saApp.findUnique.mockResolvedValue({ id: 10, publicId: 'app-10' });
      mockPrisma.saUser.findFirst.mockResolvedValue(saUser);
      mockPrisma.account.findFirst.mockResolvedValue({ password: 'hashed' });
      mockVerifyPassword.mockResolvedValue(true);
      mockTokenService.issueJwt.mockResolvedValue('direct.jwt.token');
      mockRefreshTokenService.issue.mockResolvedValue('direct-refresh-token');

      const result = await controller.directLogin({
        identifier: 'a@b.co', password: 'secret', appId: 'app-10',
      });

      expect(result).toEqual(expect.objectContaining({ refresh_token: 'direct-refresh-token' }));
      expect(mockRefreshTokenService.issue).toHaveBeenCalledWith(
        expect.objectContaining({
          saUserId: 1, userPublicId: 'usr-1', orgPublicId: 'org-1',
          appId: 10, appPublicId: 'app-10', scope: '',
        }),
      );
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/auth-server && npx jest src/token/token.controller.spec.ts -t "no /authorize step"`
Expected: FAIL — `result` has no `refresh_token` key, `mockRefreshTokenService.issue` is never called.

- [ ] **Step 3: Issue the refresh token**

In `apps/auth-server/src/token/token.controller.ts`, change the tail of `directLoginInner` (token.controller.ts:781-803) from:

```ts
    // 5. Issue JWT
    const token = await this.tokenService.issueJwt({
      saUserId: saUser.id,
      userPublicId: saUser.publicId,
      orgPublicId: saUser.org.publicId,
      appPublicId: app.publicId,
      appId: appNumericId,
      scope: '',
      amr,
    });

    this.logger.getWinstonLogger().info('Direct login successful, JWT issued', {
      context: 'TokenController',
      identifierType: detectIdentifierType(dto.identifier),
      appId: dto.appId,
      userId: saUser.publicId,
    });
    Sentry.setUser({ id: saUser.publicId });
    Sentry.setTag('authFlow', 'direct');
    Sentry.setTag('appId', dto.appId);

    return { access_token: token, token_type: 'Bearer', expires_in: 3600 };
  }
```

to:

```ts
    // 5. Issue JWT
    const token = await this.tokenService.issueJwt({
      saUserId: saUser.id,
      userPublicId: saUser.publicId,
      orgPublicId: saUser.org.publicId,
      appPublicId: app.publicId,
      appId: appNumericId,
      scope: '',
      amr,
    });

    // direct/login has no /authorize step to gate offline_access behind, so
    // (per design) a refresh token is always issued here.
    const refreshToken = await this.refreshTokenService.issue({
      saUserId: saUser.id,
      userPublicId: saUser.publicId,
      orgPublicId: saUser.org.publicId,
      appId: appNumericId,
      appPublicId: app.publicId,
      scope: '',
      amr,
      authTime: new Date(),
    });

    this.logger.getWinstonLogger().info('Direct login successful, JWT issued', {
      context: 'TokenController',
      identifierType: detectIdentifierType(dto.identifier),
      appId: dto.appId,
      userId: saUser.publicId,
    });
    Sentry.setUser({ id: saUser.publicId });
    Sentry.setTag('authFlow', 'direct');
    Sentry.setTag('appId', dto.appId);

    return {
      access_token: token,
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: refreshToken,
    };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/auth-server && npx jest src/token/token.controller.spec.ts`
Expected: PASS — new test passes; all pre-existing `directLogin` tests still pass (they assert on specific fields via `toEqual(expect.objectContaining(...))` or check status codes, not an exhaustive `toEqual` of the whole body — confirm this by reading the existing assertions before running; if any test does an exhaustive `toEqual` on the full response body without `refresh_token`, update it to use `expect.objectContaining` instead, since adding `refresh_token` is the intended behavior change).

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/token/token.controller.ts apps/auth-server/src/token/token.controller.spec.ts
git commit -m "feat(auth-server): always issue a refresh token from direct/login"
```

---

### Task 10: Revoke refresh tokens on logout

**Files:**
- Modify: `apps/auth-server/src/token/token.controller.ts:882-946`
- Test: `apps/auth-server/src/token/token.controller.spec.ts`

- [ ] **Step 1: Write the failing test**

Add to the `describe('GET /api/token/oauth/logout', ...)` block in `token.controller.spec.ts`, after `'terminates the session and redirects to a registered post_logout URI'`:

```ts
    it('revokes all refresh tokens for that user+app when id_token_hint resolves to a real app', async () => {
      const idToken = signTestIdToken({ sub: 'u_1', aud: 'a_7' });
      mockPrisma.saApp.findUnique.mockResolvedValue({
        id: 7, publicId: 'a_7', url: 'https://app.example.com',
        redirectUris: [{ uri: 'https://app.example.com/bye', kind: 'post_logout' }],
      });

      await request(app.getHttpServer())
        .get('/api/token/oauth/logout')
        .query({ id_token_hint: idToken, post_logout_redirect_uri: 'https://app.example.com/bye' });

      expect(mockRefreshTokenService.revokeForUserApp).toHaveBeenCalledWith('u_1', 'a_7');
    });

    it('does not attempt refresh-token revocation with no id_token_hint', async () => {
      await request(app.getHttpServer()).get('/api/token/oauth/logout');
      expect(mockRefreshTokenService.revokeForUserApp).not.toHaveBeenCalled();
    });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/auth-server && npx jest src/token/token.controller.spec.ts -t "revokes all refresh tokens"`
Expected: FAIL — `revokeForUserApp` is never called yet.

- [ ] **Step 3: Add the revocation call**

In `apps/auth-server/src/token/token.controller.ts`, change `handleOauthLogout` (token.controller.ts:918-933) from:

```ts
    let audience: string;
    try {
      const claims = this.tokenService.verifyAccessToken(idTokenHint);
      if (!claims.aud) return { url: loggedOut, statusCode: 302 };
      audience = claims.aud;
    } catch {
      return { url: loggedOut, statusCode: 302 };
    }

    const app = await prisma.saApp.findUnique({
      where: { publicId: audience },
      include: { redirectUris: true },
    });
    if (!app) return { url: loggedOut, statusCode: 302 };
```

to:

```ts
    let audience: string;
    let subject: string | undefined;
    try {
      const claims = this.tokenService.verifyAccessToken(idTokenHint);
      if (!claims.aud) return { url: loggedOut, statusCode: 302 };
      audience = claims.aud;
      subject = claims.sub;
    } catch {
      return { url: loggedOut, statusCode: 302 };
    }

    if (subject) {
      await this.refreshTokenService.revokeForUserApp(subject, audience);
    }

    const app = await prisma.saApp.findUnique({
      where: { publicId: audience },
      include: { redirectUris: true },
    });
    if (!app) return { url: loggedOut, statusCode: 302 };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/auth-server && npx jest src/token/token.controller.spec.ts`
Expected: PASS — new tests pass; all pre-existing logout tests still pass.

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/token/token.controller.ts apps/auth-server/src/token/token.controller.spec.ts
git commit -m "feat(auth-server): revoke refresh tokens for the audience app on OIDC logout"
```

---

### Task 11: Revoke refresh tokens on user deactivation

**Files:**
- Modify: `apps/auth-server/src/users/users.service.ts:61-65` (constructor), `:344-348` (deactivation block)
- Modify: `apps/auth-server/src/users/users.module.ts`
- Modify: `apps/auth-server/src/token/token.module.ts` (export `RefreshTokenService`)
- Test: `apps/auth-server/src/users/users.service.spec.ts`

`UsersService`'s constructor today (`users.service.ts:61-65`) is:

```ts
  constructor(
    private readonly sqids: SqidService,
    private readonly logger: LoggerService,
    private readonly email: EmailService,
  ) {}
```

and `UsersModule` (`users.module.ts`) is:

```ts
import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { CommonModule } from '../common/common.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [CommonModule, EmailModule],
  providers: [UsersService],
  controllers: [UsersController],
})
export class UsersModule {}
```

`RefreshTokenService` isn't exported from `TokenModule` yet (Task 4 only added it to `providers`) — it needs to be, and `UsersModule` needs to import `TokenModule` to see it.

- [ ] **Step 1: Export `RefreshTokenService` from `TokenModule`**

In `apps/auth-server/src/token/token.module.ts`, change:

```ts
  exports: [OauthService],
```

to:

```ts
  exports: [OauthService, RefreshTokenService],
```

- [ ] **Step 2: Write the failing tests**

Add to the `describe('updateUser status kill-switch', ...)` block in `users.service.spec.ts` (spec.ts:1047-1070):

```ts
    it('revokes the user refresh tokens when status becomes inactive', async () => {
      await service.updateUser('ba-caller', 'usr1', { status: 'inactive' });
      expect(mockRefreshTokenService.revokeForUser).toHaveBeenCalledWith(1);
    });

    it('does not revoke refresh tokens for a non-inactive update', async () => {
      await service.updateUser('ba-caller', 'usr1', { firstName: 'New' });
      expect(mockRefreshTokenService.revokeForUser).not.toHaveBeenCalled();
    });
```

Add the mock near the top of `users.service.spec.ts`, alongside `mockSend` (spec.ts:53):

```ts
const mockRefreshTokenService = { revokeForUser: jest.fn(), revokeForUserApp: jest.fn() };
```

and add `import { RefreshTokenService } from '../token/refresh-token.service';` to the spec file's imports (near the `EmailService` import, spec.ts:6).

Change the `Test.createTestingModule` block (`users.service.spec.ts:131-138`) from:

```ts
    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        SqidService,
        { provide: LoggerService, useValue: { log: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(), getWinstonLogger: () => ({ info: jest.fn(), warn: jest.fn(), child: jest.fn() }) } },
        { provide: EmailService, useValue: { send: mockSend } },
      ],
    }).compile();
```

to:

```ts
    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        SqidService,
        { provide: LoggerService, useValue: { log: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(), getWinstonLogger: () => ({ info: jest.fn(), warn: jest.fn(), child: jest.fn() }) } },
        { provide: EmailService, useValue: { send: mockSend } },
        { provide: RefreshTokenService, useValue: mockRefreshTokenService },
      ],
    }).compile();
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd apps/auth-server && npx jest src/users/users.service.spec.ts -t "revokes the user refresh tokens"`
Expected: FAIL — `RefreshTokenService` isn't injected into `UsersService` yet, so this either fails to compile/instantiate or the mock is never called.

- [ ] **Step 4: Inject `RefreshTokenService` and call it on deactivation**

In `apps/auth-server/src/users/users.service.ts`, add the import near the other service imports at the top of the file:

```ts
import { RefreshTokenService } from '../token/refresh-token.service';
```

Change the constructor (`users.service.ts:61-65`) from:

```ts
  constructor(
    private readonly sqids: SqidService,
    private readonly logger: LoggerService,
    private readonly email: EmailService,
  ) {}
```

to:

```ts
  constructor(
    private readonly sqids: SqidService,
    private readonly logger: LoggerService,
    private readonly email: EmailService,
    private readonly refreshTokenService: RefreshTokenService,
  ) {}
```

Change (`users.service.ts:344-348`):

```ts
    // On deactivation, revoke every active session so the user is logged out
    // everywhere at once (blocking new logins/tokens is enforced elsewhere).
    if (dto.status === 'inactive') {
      await prisma.session.deleteMany({ where: { userId: existing.betterAuthUserId } });
    }
```

to:

```ts
    // On deactivation, revoke every active session and refresh token so the
    // user is logged out everywhere at once and cannot silently mint a new
    // access token via refresh (blocking new logins/direct-token-issuance is
    // enforced elsewhere).
    if (dto.status === 'inactive') {
      await prisma.session.deleteMany({ where: { userId: existing.betterAuthUserId } });
      await this.refreshTokenService.revokeForUser(existing.id);
    }
```

- [ ] **Step 5: Wire the module**

In `apps/auth-server/src/users/users.module.ts`, change:

```ts
import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { CommonModule } from '../common/common.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [CommonModule, EmailModule],
  providers: [UsersService],
  controllers: [UsersController],
})
export class UsersModule {}
```

to:

```ts
import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { CommonModule } from '../common/common.module';
import { EmailModule } from '../email/email.module';
import { TokenModule } from '../token/token.module';

@Module({
  imports: [CommonModule, EmailModule, TokenModule],
  providers: [UsersService],
  controllers: [UsersController],
})
export class UsersModule {}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd apps/auth-server && npx jest src/users/users.service.spec.ts`
Expected: PASS — new tests pass, all pre-existing tests still pass.

Also run the full auth-server suite to catch any other spec that instantiates `UsersService` directly without the new constructor arg:

Run: `cd apps/auth-server && npx jest`
Expected: PASS. If any other spec file constructs `UsersService` manually (not via Nest's `TestingModule`), add the same `RefreshTokenService` mock there too.

- [ ] **Step 7: Commit**

```bash
git add apps/auth-server/src/users/users.service.ts apps/auth-server/src/users/users.module.ts apps/auth-server/src/users/users.service.spec.ts apps/auth-server/src/token/token.module.ts
git commit -m "feat(auth-server): revoke a user's refresh tokens on deactivation"
```

---

### Task 12: Admin console — `allowOfflineAccess` toggle

**Files:**
- Modify: `apps/auth-server/src/apps/dto/create-app.dto.ts`
- Modify: `apps/auth-server/src/apps/dto/update-app.dto.ts`
- Modify: `apps/auth-server/src/apps/apps.service.ts` (`AppRow`, `formatApp`, `listApps` select, `createApp`, `updateApp`)
- Modify: `apps/admin/lib/types.ts`
- Modify: `apps/admin/components/app-edit-drawer.tsx`
- Modify: `apps/admin/messages/en.json`, `apps/admin/messages/fr.json`
- Test: `apps/auth-server/src/apps/apps.service.spec.ts`, `apps/admin/components/__tests__/app-edit-drawer.test.tsx`

- [ ] **Step 1: Backend DTOs**

In `apps/auth-server/src/apps/dto/create-app.dto.ts`, add directly under the existing `requireTwoFactor` field:

```ts
  @IsOptional() @IsBoolean() allowOfflineAccess?: boolean;
```

In `apps/auth-server/src/apps/dto/update-app.dto.ts`, add the same line directly under its `requireTwoFactor` field.

- [ ] **Step 2: Write the failing backend test**

Find the existing `requireTwoFactor` round-trip test in `apps/auth-server/src/apps/apps.service.spec.ts` (search: `grep -n "requireTwoFactor" apps/auth-server/src/apps/apps.service.spec.ts`) and add an analogous pair of tests near it, matching its exact setup style once you've read it:

```ts
  it('persists allowOfflineAccess on create', async () => {
    // Mirror the requireTwoFactor create test's mock setup exactly, adding
    // allowOfflineAccess: true to both the dto and the expected tx.saApp.create data.
  });

  it('updates allowOfflineAccess', async () => {
    // Mirror the requireTwoFactor update test's mock setup exactly, adding
    // allowOfflineAccess: true to both the dto and the expected tx.saApp.update data.
  });
```

Read the actual neighboring tests before writing these — copy their mock shapes verbatim and only add the new field, so the tests use real fixtures rather than invented ones.

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd apps/auth-server && npx jest src/apps/apps.service.spec.ts -t "allowOfflineAccess"`
Expected: FAIL — `allowOfflineAccess` isn't read from the DTO or written to Prisma yet.

- [ ] **Step 4: Wire it through `AppsService`**

In `apps/auth-server/src/apps/apps.service.ts`:

Add to the `AppRow` type (apps.service.ts:17-19), directly after `requireTwoFactor: boolean;`:

```ts
  allowOfflineAccess: boolean;
```

Add to `formatApp` (apps.service.ts:33-37), directly after `requireTwoFactor: a.requireTwoFactor,`:

```ts
    allowOfflineAccess: a.allowOfflineAccess,
```

Add `allowOfflineAccess: true,` to the `select` block in `listApps` (apps.service.ts:203-215), directly after `requireTwoFactor: true,`.

In `createApp` (apps.service.ts:252-257), change the `data: { ... }` object to include, directly after `requireTwoFactor: dto.requireTwoFactor ?? false`:

```ts
allowOfflineAccess: dto.allowOfflineAccess ?? false,
```

In `updateApp`, add `dto.allowOfflineAccess === undefined &&` to the "nothing provided" guard (apps.service.ts:279-289) directly after the `dto.requireTwoFactor === undefined &&` line, and update the error message string to mention `allowOfflineAccess`. Then in the transaction's `data: { ... }` (apps.service.ts:318-321), add directly after the `requireTwoFactor` spread:

```ts
            ...(dto.allowOfflineAccess !== undefined && {
              allowOfflineAccess: dto.allowOfflineAccess,
            }),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/auth-server && npx jest src/apps/apps.service.spec.ts`
Expected: PASS

- [ ] **Step 6: Commit the backend half**

```bash
git add apps/auth-server/src/apps/dto/create-app.dto.ts apps/auth-server/src/apps/dto/update-app.dto.ts apps/auth-server/src/apps/apps.service.ts apps/auth-server/src/apps/apps.service.spec.ts
git commit -m "feat(auth-server): expose allowOfflineAccess on the apps admin API"
```

- [ ] **Step 7: Admin type + i18n**

In `apps/admin/lib/types.ts`, add `allowOfflineAccess: boolean;` to the `App` interface directly after `requireTwoFactor: boolean;` (types.ts:99), and `allowOfflineAccess?: boolean;` to both `CreateAppPayload` and `UpdateAppPayload` directly after their `requireTwoFactor?: boolean;` lines.

In `apps/admin/messages/en.json`, add directly after the `"requireTwoFactorHint"` key (see `apps.fields.requireTwoFactorHint` at en.json — found via `grep -n "requireTwoFactorHint" apps/admin/messages/en.json`):

```json
      "allowOfflineAccess": "Allow offline access",
      "allowOfflineAccessHint": "Lets this app request the offline_access scope and receive a refresh token so it can renew access without the user signing in again.",
```

Add the French equivalents at the same relative position in `apps/admin/messages/fr.json`:

```json
      "allowOfflineAccess": "Autoriser l'accès hors ligne",
      "allowOfflineAccessHint": "Permet à cette application de demander le scope offline_access et de recevoir un jeton de rafraîchissement afin de renouveler l'accès sans que l'utilisateur se reconnecte.",
```

Read both JSON files at the target location first to match indentation and comma placement exactly (JSON has no trailing commas).

- [ ] **Step 8: Write the failing admin component test**

Read `apps/admin/components/__tests__/app-edit-drawer.test.tsx` for its existing `requireTwoFactor` checkbox test (search: `grep -n "requireTwoFactor" apps/admin/components/__tests__/app-edit-drawer.test.tsx`) and add an analogous test for the new checkbox, copying that test's exact rendering/interaction pattern (fireEvent/userEvent, `screen.getByLabelText`, the mocked `updateAppAction`, etc.) — do not invent a different testing approach for this one field.

- [ ] **Step 9: Run the test to verify it fails**

Run: `cd apps/admin && npx jest components/__tests__/app-edit-drawer.test.tsx -t "offline"`
Expected: FAIL — the checkbox doesn't exist in the drawer yet.

- [ ] **Step 10: Add the toggle to `app-edit-drawer.tsx`**

In `apps/admin/components/app-edit-drawer.tsx`, add state directly after the `requireTwoFactor` state (app-edit-drawer.tsx:50):

```ts
  const [allowOfflineAccess, setAllowOfflineAccess] = React.useState<boolean>(app.allowOfflineAccess ?? false)
```

Add the reset-on-reopen line directly after the `requireTwoFactor` reset (app-edit-drawer.tsx:106):

```ts
    setAllowOfflineAccess(app.allowOfflineAccess ?? false)
```

Add to the `dirty` computation (app-edit-drawer.tsx:222), directly after `requireTwoFactor !== (app.requireTwoFactor ?? false)`:

```ts
 || allowOfflineAccess !== (app.allowOfflineAccess ?? false)
```

Add to the `patch` type and the `if (requireTwoFactor !== ...)` block (app-edit-drawer.tsx:235, 241):

```ts
    // in the patch type literal, alongside `requireTwoFactor?: boolean;`:
    allowOfflineAccess?: boolean;
```
```ts
    // alongside the requireTwoFactor patch-building line:
    if (allowOfflineAccess !== (app.allowOfflineAccess ?? false)) patch.allowOfflineAccess = allowOfflineAccess
```

Add the checkbox UI directly after the `requireTwoFactor` checkbox block (app-edit-drawer.tsx:347-361):

```tsx
            <div>
              <label className="flex items-center gap-2 text-label-md cursor-pointer">
                <input
                  type="checkbox"
                  id="allowOfflineAccess"
                  checked={allowOfflineAccess}
                  onChange={(e) => setAllowOfflineAccess(e.target.checked)}
                  className="h-4 w-4 rounded border-[var(--border)] accent-[var(--primary)]"
                />
                {t('apps.fields.allowOfflineAccess')}
              </label>
              <p className="mt-1 text-body-sm text-muted-foreground">
                {t('apps.fields.allowOfflineAccessHint')}
              </p>
            </div>
```

- [ ] **Step 11: Run the test to verify it passes**

Run: `cd apps/admin && npx jest components/__tests__/app-edit-drawer.test.tsx`
Expected: PASS — new test passes, all pre-existing tests still pass.

- [ ] **Step 12: Commit**

```bash
git add apps/admin/lib/types.ts apps/admin/messages/en.json apps/admin/messages/fr.json apps/admin/components/app-edit-drawer.tsx apps/admin/components/__tests__/app-edit-drawer.test.tsx
git commit -m "feat(admin): add allowOfflineAccess toggle to the app edit drawer"
```

---

### Task 13: Full-flow integration tests (authorize → refresh → rotation reuse)

**Files:**
- Modify: `apps/auth-server/src/token/token.controller.spec.ts` (extend the existing `describe('confidential client invariants', ...)`-style real-app supertest block)

This codebase's OAuth "e2e" coverage is the supertest-driven blocks already inside `token.controller.spec.ts` (e.g. `describe('confidential client invariants', ...)` at spec.ts:1015, which boots a real `INestApplication` with `TokenController`/mocked services and drives it through `request(app.getHttpServer())`). Add refresh-token full-flow coverage the same way rather than inventing a separate e2e project.

- [ ] **Step 1: Write the failing tests**

Add a new `describe` block after `describe('confidential client invariants', ...)` in `token.controller.spec.ts`, reusing that block's `beforeAll`/`afterAll` app-bootstrap pattern (read spec.ts:1015-1041 first and copy its `Test.createTestingModule` setup exactly, including the `RefreshTokenService` provider added in Task 4):

```ts
  describe('refresh token full flow (real HTTP)', () => {
    let app: INestApplication;
    const refreshTokenService = new RefreshTokenService();

    beforeAll(async () => {
      const moduleRef: TestingModule = await Test.createTestingModule({
        controllers: [TokenController],
        providers: [
          { provide: TokenService, useValue: mockTokenService },
          { provide: OauthService, useValue: mockOauthService },
          { provide: SqidService, useValue: mockSqidService },
          { provide: LoggerService, useValue: { log: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(), getWinstonLogger: () => ({ info: jest.fn(), warn: jest.fn(), child: jest.fn() }) } },
          { provide: RefreshTokenService, useValue: refreshTokenService },
        ],
      }).compile();
      app = moduleRef.createNestApplication();
      app.setGlobalPrefix('api');
      await app.init();
    });

    afterAll(async () => {
      await app.close();
    });

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('rotates a real refresh token issued by RefreshTokenService and rejects reuse of the old one', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue({ id: 10, publicId: 'sqid-10', clientSecretHash: null });
      const firstToken = await refreshTokenService.issue({
        saUserId: 1, userPublicId: 'usr-1', orgPublicId: 'org-1',
        appId: 10, appPublicId: 'sqid-10', scope: 'openid', amr: ['pwd'], authTime: new Date(),
      });
      mockPrisma.saUser.findFirst.mockResolvedValue({ publicId: 'usr-1', status: 'active' });
      mockTokenService.issueJwt.mockResolvedValue('jwt-1');
      mockTokenService.issueIdToken.mockResolvedValue('idt-1');

      const firstRotation = await request(app.getHttpServer())
        .post('/api/token/oauth/token')
        .send({ grant_type: 'refresh_token', client_id: 'sqid-10', refresh_token: firstToken });

      expect(firstRotation.status).toBe(200);
      expect(firstRotation.body.refresh_token).toBeDefined();
      expect(firstRotation.body.refresh_token).not.toBe(firstToken);

      // Reusing the now-rotated original token must fail.
      const reuse = await request(app.getHttpServer())
        .post('/api/token/oauth/token')
        .send({ grant_type: 'refresh_token', client_id: 'sqid-10', refresh_token: firstToken });
      expect(reuse.status).toBe(401);
      expect(reuse.body.message).toBe('invalid_grant');

      // Reuse detection burns the family — the rotated token from the first
      // call must ALSO be rejected now, even though it was never used again.
      const secondRotationAttempt = await request(app.getHttpServer())
        .post('/api/token/oauth/token')
        .send({ grant_type: 'refresh_token', client_id: 'sqid-10', refresh_token: firstRotation.body.refresh_token });
      expect(secondRotationAttempt.status).toBe(401);
    });
  });
```

Note: this test hits the real (test-database-backed) `prisma.saRefreshToken` calls inside `RefreshTokenService`, since it's instantiated directly rather than mocked — it therefore requires a live test database to be configured for `apps/auth-server`'s Jest run (check `apps/auth-server/package.json`'s test script / any `jest.setup` for how the existing suite handles this; if the auth-server unit suite has no DB access at all, mock `prisma.saRefreshToken` at the module level instead, matching how `mockPrisma` already covers `saUser`/`saApp` elsewhere in this file, and drop the `new RefreshTokenService()` real instantiation in favor of the existing `mockRefreshTokenService.rotate`/`issue` mocks driven through two sequential calls).

- [ ] **Step 2: Run the test, adjusting for DB availability per the note above**

Run: `cd apps/auth-server && npx jest src/token/token.controller.spec.ts -t "refresh token full flow"`
Expected: PASS once wired to match this repo's actual test-DB setup (or the mocked fallback).

- [ ] **Step 3: Commit**

```bash
git add apps/auth-server/src/token/token.controller.spec.ts
git commit -m "test(auth-server): add refresh token rotation + reuse-detection full-flow coverage"
```

---

### Task 14: Full suite verification

- [ ] **Step 1: Run the entire auth-server test suite**

Run: `cd apps/auth-server && npx jest`
Expected: PASS, no regressions.

- [ ] **Step 2: Run the entire admin test suite**

Run: `cd apps/admin && npx jest`
Expected: PASS, no regressions.

- [ ] **Step 3: Type-check both apps**

Run: `cd apps/auth-server && npx tsc --noEmit` and `cd apps/admin && npx tsc --noEmit`
Expected: no type errors (in particular, verify every call site touching `OauthTokenExchangeDto.code`/`.redirect_uri` — now optional — still type-checks; Task 8's `refreshTokenGrant` and Task 7's unchanged `code`/`redirect_uri` usages inside the `authorization_code` branch should be fine since that branch is only reached when `dto.grant_type !== 'refresh_token'`, but the compiler doesn't know that from control flow alone — if `tsc` complains about possibly-undefined `dto.code`/`dto.redirect_uri` in the pre-existing code path, add non-null assertions there with a one-line comment citing the DTO's `@ValidateIf` guarantee, same as done for `dto.refresh_token!` in Task 8).

- [ ] **Step 4: Commit any fixes from this task**

```bash
git add -A
git commit -m "fix(auth-server): resolve type-check fallout from optional grant-type DTO fields"
```

(Skip this commit if Steps 1-3 found nothing to fix.)
