# OIDC Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make standard OpenID Connect client libraries work against SassyAuth with no SassyAuth-specific configuration.

**Architecture:** Extend the existing NestJS `TokenModule`. Two discovery documents derive from one set of route constants in `oauth-metadata.ts`. Authorization codes gain `nonce`/`scope`/`authTime` so the token endpoint can mint an `id_token` beside the existing access token. Client type is derived from the presence of a client-secret hash on `SaApp`; redirect URIs move from a single column to a child table.

**Tech Stack:** NestJS 10, Prisma 5.14 + PostgreSQL, `jsonwebtoken` (RS256), BetterAuth, Jest + Supertest, Next.js 15 admin console, Playwright 1.62.1.

**Spec:** `docs/superpowers/specs/2026-08-21-oidc-compatibility-design.md`

## Global Constraints

- Node >= 20, pnpm >= 9, PostgreSQL >= 14.
- All JWTs are RS256 signed with `RSA_PRIVATE_KEY`, `kid` from `JWT_KEY_ID` (default `sassy-auth-1`). `id_token` uses the same key and `kid` as the access token.
- Issuer comes from `resolveIssuer()` in `apps/auth-server/src/token/oauth-metadata.ts`. Never read `BETTER_AUTH_URL` directly.
- Route paths are constants in `oauth-metadata.ts`. Never hardcode a route string in a controller or a discovery document.
- The app-scoped permission predicate is **`p.isSystem || p.appId === <audience app id>`**, matching `apps/auth-server/src/common/permissions/resolve-app-scoped-ids.ts:20`. System permissions (`org.*`) deliberately cross app boundaries.
- `client_id` == `SaApp.publicId` == `sqids.encode(SaApp.id)`. The access token `aud` already equals `client_id`; do not change it.
- Unit tests are `*.spec.ts` co-located with source. Run with `pnpm --filter @sassy-auth/auth-server test`.
- Migrations: `pnpm --filter @sassy-auth/db db:migrate --name <name>`, output lands in `packages/db/migrations/`.
- **Never reference README line numbers.** Another agent is editing `README.md` concurrently; anchor edits on headings and quoted text.
- No refresh tokens, no `offline_access`, no introspection, no revocation endpoint, no hybrid/implicit flows. These are explicit non-goals.
- Public claim wording, verbatim: **"Implements OpenID Connect Core 1.0 — works with standard OIDC clients. Not certified, not conformance-tested."** Do not write "OIDC-compliant" or "OIDC-certified" anywhere.

## Execution Environment

Work in an isolated worktree — the public-prep agent is active in the main checkout and edits `README.md`.

```bash
git worktree add .worktrees/oidc -b feat/oidc-compatibility master
cd .worktrees/oidc
```

---

### Task 1: Audience-filtered permissions and the new claim shape

Closes bug-0157 and changes the access token's claim shape. No schema change. `issueJwt` gains a required `scope` parameter; every caller passes `''` until Task 7 wires real scopes.

**Files:**
- Modify: `apps/auth-server/src/token/token.service.ts`
- Modify: `apps/auth-server/src/token/token.controller.ts` (both `issueJwt` call sites)
- Test: `apps/auth-server/src/token/token.service.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `TokenService.resolvePermissions(saUserId: number, audienceAppId: number): Promise<string[]>` and `TokenService.issueJwt(params: IssueJwtParams): Promise<string>` where `IssueJwtParams` is `{ saUserId: number; userPublicId: string; orgPublicId: string; appPublicId: string; appId: number; scope: string; amr?: string[] }`.

- [ ] **Step 1: Write the failing tests**

Add to `apps/auth-server/src/token/token.service.spec.ts`:

```typescript
describe('resolvePermissions — audience filtering (bug-0157)', () => {
  it('excludes non-system permissions belonging to another app', async () => {
    mockPrisma.saUser.findUnique.mockResolvedValue({
      id: 1,
      roles: [
        { role: { permissions: [
          { permission: { name: 'rs.properties.read', appId: 7, isSystem: false } },
          { permission: { name: 'other.secret.read', appId: 99, isSystem: false } },
        ] } },
      ],
      directPermissions: [],
    });

    const result = await service.resolvePermissions(1, 7);

    expect(result).toEqual(['rs.properties.read']);
  });

  it('keeps system permissions regardless of their owning app', async () => {
    mockPrisma.saUser.findUnique.mockResolvedValue({
      id: 1,
      roles: [],
      directPermissions: [
        { permission: { name: 'org.users.manage', appId: 99, isSystem: true } },
        { permission: { name: 'other.secret.read', appId: 99, isSystem: false } },
      ],
    });

    const result = await service.resolvePermissions(1, 7);

    expect(result).toEqual(['org.users.manage']);
  });
});

describe('issueJwt — claim shape', () => {
  beforeEach(() => {
    mockPrisma.saUser.findUnique.mockResolvedValue({
      id: 1,
      roles: [],
      directPermissions: [
        { permission: { name: 'rs.properties.read', appId: 7, isSystem: false } },
      ],
    });
  });

  it('puts granted scopes in `scope` and permissions in a `permissions` array', async () => {
    const token = await service.issueJwt({
      saUserId: 1,
      userPublicId: 'u_1',
      orgPublicId: 'o_1',
      appPublicId: 'a_7',
      appId: 7,
      scope: 'openid profile',
    });

    const decoded = jwt.decode(token) as Record<string, unknown>;
    expect(decoded.scope).toBe('openid profile');
    expect(decoded.permissions).toEqual(['rs.properties.read']);
  });

  it('emits an empty scope string when no scopes were granted', async () => {
    const token = await service.issueJwt({
      saUserId: 1,
      userPublicId: 'u_1',
      orgPublicId: 'o_1',
      appPublicId: 'a_7',
      appId: 7,
      scope: '',
    });

    const decoded = jwt.decode(token) as Record<string, unknown>;
    expect(decoded.scope).toBe('');
    expect(decoded.permissions).toEqual(['rs.properties.read']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @sassy-auth/auth-server test -- token.service.spec`
Expected: FAIL — `resolvePermissions` takes one argument; `decoded.permissions` is `undefined`.

- [ ] **Step 3: Implement the filtering and claim change**

In `apps/auth-server/src/token/token.service.ts`, change the `IssueJwtParams` interface:

```typescript
interface IssueJwtParams {
  saUserId: number;
  userPublicId: string;
  orgPublicId: string;
  appPublicId: string;
  /** Numeric SaApp.id of the audience, used to scope permissions (bug-0157). */
  appId: number;
  /** Space-delimited OIDC scopes granted for this token. '' for non-OIDC flows. */
  scope: string;
  amr?: string[];
}
```

Change `resolvePermissions` to take the audience and filter. The `include` must select `appId` and `isSystem`, which the nested `permission: true` already returns in full:

```typescript
  async resolvePermissions(saUserId: number, audienceAppId: number): Promise<string[]> {
    const user = await prisma.saUser.findUnique({
      where: { id: saUserId },
      include: {
        roles: {
          include: {
            role: { include: { permissions: { include: { permission: true } } } },
          },
        },
        directPermissions: { include: { permission: true } },
      },
    });

    if (!user) {
      throw new NotFoundException(TokenErrorCode.USER_NOT_FOUND);
    }

    // bug-0157: a token's permissions must describe only what its audience can
    // act on. Mirrors the predicate in common/permissions/resolve-app-scoped-ids.ts:
    // system permissions (org.*) deliberately cross app boundaries, everything
    // else must belong to the audience app.
    const inAudience = (p: { appId: number; isSystem: boolean }): boolean =>
      p.isSystem || p.appId === audienceAppId;

    const names = new Set<string>();

    for (const ur of user.roles) {
      for (const rp of ur.role.permissions) {
        if (inAudience(rp.permission)) names.add(rp.permission.name);
      }
    }

    for (const up of user.directPermissions) {
      if (inAudience(up.permission)) names.add(up.permission.name);
    }

    return Array.from(names).sort();
  }
```

Change the payload in `issueJwt`:

```typescript
  async issueJwt(params: IssueJwtParams): Promise<string> {
    const permissions = await this.resolvePermissions(params.saUserId, params.appId);
    const issuer = resolveIssuer();
    const now = Math.floor(Date.now() / 1000);

    const payload = {
      sub: params.userPublicId,
      aud: params.appPublicId,
      org: params.orgPublicId,
      iss: issuer,
      iat: now,
      exp: now + 3600,
      // OAuth `scope` means granted scopes. Effective permissions moved to
      // their own array claim in the OIDC compatibility work.
      scope: params.scope,
      permissions,
      ...(params.amr && params.amr.length ? { amr: params.amr } : {}),
    };

    return jwt.sign(payload, this.privateKey, { algorithm: 'RS256', keyid: this.kid });
  }
```

- [ ] **Step 4: Update both call sites in the controller**

In `apps/auth-server/src/token/token.controller.ts`, the `oauthToken` handler already has `app` in scope from the `client_id` lookup:

```typescript
    const token = await this.tokenService.issueJwt({
      saUserId: saUser.id,
      userPublicId: saUser.publicId,
      orgPublicId: saUser.org.publicId,
      appPublicId,
      appId: app.id,
      scope: '',
      amr: exchangedAmr,
    });
```

In `directLogin`, the app row is resolved from `appNumericId`; pass `appId: appNumericId` and `scope: ''` on that `issueJwt` call in the same shape.

- [ ] **Step 5: Run the full auth-server suite**

Run: `pnpm --filter @sassy-auth/auth-server test`
Expected: PASS. Any existing spec asserting `scope` contains permission names must be updated to assert on `permissions` instead — that is the intended breaking change, not a regression.

- [ ] **Step 6: Commit**

```bash
git add apps/auth-server/src/token/token.service.ts \
        apps/auth-server/src/token/token.service.spec.ts \
        apps/auth-server/src/token/token.controller.ts
git commit -m "feat(token): scope permissions to the audience app, move them to their own claim

Closes bug-0157. \`scope\` now carries granted OAuth scopes; effective
permissions move to a \`permissions\` array filtered to the token's audience.
System permissions (org.*) still cross app boundaries, matching
resolve-app-scoped-ids."
```

---

### Task 2: Schema migration

One migration adding the redirect-URI table, client-secret columns, and the code columns OIDC needs.

**Files:**
- Modify: `packages/db/schema.prisma`
- Create: `packages/db/migrations/<timestamp>_oidc_compatibility/migration.sql` (generated, then hand-edited for the backfill)

**Interfaces:**
- Produces: Prisma models `SaAppRedirectUri { id: Int; appId: Int; uri: String; kind: String }`; `SaApp.clientSecretHash: String | null`, `SaApp.clientSecretUpdatedAt: DateTime | null`, `SaApp.redirectUris: SaAppRedirectUri[]`, and `SaApp.callbackUrl` **removed**; `SaOauthCode.nonce: String | null`, `SaOauthCode.scope: String`, `SaOauthCode.authTime: DateTime`, `SaOauthCode.codeChallenge: String | null`, `SaOauthCode.codeChallengeMethod: String | null`.

- [ ] **Step 1: Edit the schema**

In `packages/db/schema.prisma`, replace the `callbackUrl` line in `SaApp` and add the secret columns:

```prisma
model SaApp {
  id          Int            @id @default(autoincrement())
  publicId    String         @unique
  name        String         @unique
  url         String
  twoFactorTrustDays Int?
  requireTwoFactor   Boolean        @default(false)
  isPlatform         Boolean        @default(false)
  // Presence of a secret hash is what makes a client confidential. There is no
  // separate client-type flag, so the two cannot contradict each other.
  clientSecretHash      String?
  clientSecretUpdatedAt DateTime?
  orgs        SaOrg[]
  permissions SaPermission[]
  roles       SaRole[]
  redirectUris SaAppRedirectUri[]
}

model SaAppRedirectUri {
  id    Int    @id @default(autoincrement())
  appId Int
  uri   String
  /// 'login' | 'post_logout'
  kind  String
  app   SaApp  @relation(fields: [appId], references: [id], onDelete: Cascade)

  @@unique([appId, uri, kind])
  @@index([appId, kind])
}
```

Update `SaOauthCode`:

```prisma
model SaOauthCode {
  code                String   @id
  userId              String
  appPublicId         String
  redirectUri         String
  // Nullable so confidential clients may omit PKCE. A code with no challenge is
  // only exchangeable by a request that authenticates with a client secret —
  // enforced at /authorize and again at /token.
  codeChallenge       String?
  codeChallengeMethod String?
  nonce               String?
  scope               String   @default("")
  authTime            DateTime @default(now())
  amr                 String   @default("[\"pwd\"]")
  expiresAt           DateTime
  createdAt           DateTime @default(now())

  @@index([expiresAt])
}
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm --filter @sassy-auth/db db:migrate --name oidc_compatibility`
Expected: a new directory under `packages/db/migrations/`. Prisma will propose dropping `callbackUrl`; accept it, then hand-edit for the backfill in the next step.

- [ ] **Step 3: Hand-edit the migration to backfill before the drop**

Open the generated `migration.sql` and move the backfill **above** the `ALTER TABLE ... DROP COLUMN "callbackUrl"` statement:

```sql
-- Backfill: every app with an explicit callbackUrl gets one registered login URI.
-- Apps with NULL callbackUrl intentionally get no rows, which preserves their
-- existing same-origin fallback matching (see redirect-uri.ts).
INSERT INTO "SaAppRedirectUri" ("appId", "uri", "kind")
SELECT "id", "callbackUrl", 'login'
FROM "SaApp"
WHERE "callbackUrl" IS NOT NULL AND "callbackUrl" <> '';

ALTER TABLE "SaApp" DROP COLUMN "callbackUrl";
```

- [ ] **Step 4: Apply and verify the backfill**

Run: `pnpm --filter @sassy-auth/db db:migrate`
Then verify against the dev database:

```bash
pnpm --filter @sassy-auth/db exec prisma studio
```

Expected: apps that previously had a `callbackUrl` each have exactly one `SaAppRedirectUri` row with `kind='login'` and the same URI; apps that had none have zero rows.

- [ ] **Step 5: Commit**

```bash
git add packages/db/schema.prisma packages/db/migrations
git commit -m "feat(db): add redirect-URI table, client secrets, and OIDC code columns

Backfills SaApp.callbackUrl into SaAppRedirectUri before dropping it. Apps
with no callbackUrl get no rows, preserving same-origin fallback matching."
```

---

### Task 3: Set-valued redirect URI matching

**Files:**
- Modify: `apps/auth-server/src/token/redirect-uri.ts`
- Modify: `apps/auth-server/src/token/token.controller.ts` (both `assertRedirectUriAllowed` call sites)
- Test: `apps/auth-server/src/token/redirect-uri.spec.ts`

**Interfaces:**
- Consumes: `SaAppRedirectUri` from Task 2.
- Produces: `assertRedirectUriAllowed(redirectUri: string, app: RedirectUriApp): void` where `RedirectUriApp` is `{ url: string; redirectUris?: Array<{ uri: string; kind: string }> | null }`. Also exports `assertPostLogoutRedirectUriAllowed(uri: string, app: RedirectUriApp): void` for Task 11.

- [ ] **Step 1: Write the failing tests**

Add to `apps/auth-server/src/token/redirect-uri.spec.ts`:

```typescript
describe('assertRedirectUriAllowed — set-valued matching', () => {
  it('accepts any registered login URI', () => {
    const app = {
      url: 'https://app.example.com',
      redirectUris: [
        { uri: 'https://app.example.com/cb', kind: 'login' },
        { uri: 'http://localhost:3000/cb', kind: 'login' },
      ],
    };

    expect(() => assertRedirectUriAllowed('http://localhost:3000/cb', app)).not.toThrow();
    expect(() => assertRedirectUriAllowed('https://app.example.com/cb', app)).not.toThrow();
  });

  it('rejects a same-origin path once URIs are registered', () => {
    const app = {
      url: 'https://app.example.com',
      redirectUris: [{ uri: 'https://app.example.com/cb', kind: 'login' }],
    };

    expect(() => assertRedirectUriAllowed('https://app.example.com/evil', app)).toThrow();
  });

  it('ignores post_logout URIs when matching a login redirect', () => {
    const app = {
      url: 'https://app.example.com',
      redirectUris: [
        { uri: 'https://app.example.com/cb', kind: 'login' },
        { uri: 'https://app.example.com/bye', kind: 'post_logout' },
      ],
    };

    expect(() => assertRedirectUriAllowed('https://app.example.com/bye', app)).toThrow();
  });

  it('falls back to same-origin matching when no login URIs are registered', () => {
    const app = { url: 'https://app.example.com', redirectUris: [] };

    expect(() => assertRedirectUriAllowed('https://app.example.com/anything', app)).not.toThrow();
    expect(() => assertRedirectUriAllowed('https://evil.example.com/cb', app)).toThrow();
  });
});

describe('assertPostLogoutRedirectUriAllowed', () => {
  it('accepts only registered post_logout URIs', () => {
    const app = {
      url: 'https://app.example.com',
      redirectUris: [
        { uri: 'https://app.example.com/cb', kind: 'login' },
        { uri: 'https://app.example.com/bye', kind: 'post_logout' },
      ],
    };

    expect(() => assertPostLogoutRedirectUriAllowed('https://app.example.com/bye', app)).not.toThrow();
    expect(() => assertPostLogoutRedirectUriAllowed('https://app.example.com/cb', app)).toThrow();
  });

  it('has no same-origin fallback — an unregistered URI is always rejected', () => {
    const app = { url: 'https://app.example.com', redirectUris: [] };

    expect(() => assertPostLogoutRedirectUriAllowed('https://app.example.com/bye', app)).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @sassy-auth/auth-server test -- redirect-uri.spec`
Expected: FAIL — `assertPostLogoutRedirectUriAllowed` is not exported; `redirectUris` is ignored.

- [ ] **Step 3: Implement**

Replace the exported functions in `apps/auth-server/src/token/redirect-uri.ts`, keeping `normalizePath` and `isExactMatch` unchanged:

```typescript
export interface RedirectUriApp {
  url: string;
  redirectUris?: Array<{ uri: string; kind: string }> | null;
}

function registered(app: RedirectUriApp, kind: string): string[] {
  return (app.redirectUris ?? []).filter((r) => r.kind === kind).map((r) => r.uri);
}

/**
 * Validates a login `redirect_uri` against an app.
 * - One or more registered `login` URIs: require an exact match against the set
 *   (protocol + host + port + path + query), tolerant of a single trailing slash.
 * - None registered: require the same origin as `app.url` (any path). This is the
 *   pre-OIDC fallback, preserved so the migration changes no app's behaviour.
 */
export function assertRedirectUriAllowed(redirectUri: string, app: RedirectUriApp): void {
  const allowed = registered(app, 'login');
  if (allowed.length > 0) {
    if (!allowed.some((uri) => isExactMatch(redirectUri, uri))) reject();
    return;
  }
  let redirectOrigin: string;
  let appOrigin: string;
  try {
    redirectOrigin = new URL(redirectUri).origin;
    appOrigin = new URL(app.url).origin;
  } catch {
    reject();
  }
  if (redirectOrigin !== appOrigin) reject();
}

/**
 * Validates a `post_logout_redirect_uri`. Unlike login redirects there is no
 * same-origin fallback: an unregistered URI is always rejected, because a
 * logout redirect has no pre-OIDC behaviour to preserve.
 */
export function assertPostLogoutRedirectUriAllowed(uri: string, app: RedirectUriApp): void {
  const allowed = registered(app, 'post_logout');
  if (!allowed.some((candidate) => isExactMatch(uri, candidate))) reject();
}
```

- [ ] **Step 4: Load redirect URIs at both call sites**

In `apps/auth-server/src/token/token.controller.ts`, both `prisma.saApp.findUnique({ where: { id: numericId } })` lookups (in `oauthAuthorize` and `oauthToken`) must include the relation:

```typescript
      const app = await prisma.saApp.findUnique({
        where: { id: numericId },
        include: { redirectUris: true },
      });
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @sassy-auth/auth-server test -- redirect-uri.spec token.controller.spec`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/auth-server/src/token/redirect-uri.ts \
        apps/auth-server/src/token/redirect-uri.spec.ts \
        apps/auth-server/src/token/token.controller.ts
git commit -m "feat(oauth): match redirect_uri against a registered set

Apps with no registered login URIs keep same-origin fallback matching, so
the migration is behaviour-preserving. Adds post-logout URI validation with
no fallback, for RP-initiated logout."
```

---

### Task 4: Admin console redirect-URI management

**Files:**
- Modify: `apps/auth-server/src/apps/apps.service.ts`
- Modify: `apps/auth-server/src/apps/dto/create-app.dto.ts` and `dto/update-app.dto.ts`
- Modify: `apps/admin/components/app-edit-drawer.tsx`, `app-create-drawer.tsx`, `app-view-drawer.tsx`
- Test: `apps/auth-server/src/apps/apps.service.spec.ts`, `apps/admin/components/__tests__/app-edit-drawer.test.tsx`

**Interfaces:**
- Consumes: `SaAppRedirectUri` (Task 2).
- Produces: app API rows expose `redirectUris: Array<{ uri: string; kind: 'login' | 'post_logout' }>` in place of `callbackUrl`. `CreateAppDto` / `UpdateAppDto` accept an optional `redirectUris` array of the same shape.

- [ ] **Step 1: Write the failing service test**

Add to `apps/auth-server/src/apps/apps.service.spec.ts`:

```typescript
it('replaces the redirect URI set on update', async () => {
  mockPrisma.saApp.findUnique.mockResolvedValue({ id: 7, publicId: 'a_7', isPlatform: false });

  await service.updateApp('admin-ba-id', 'a_7', {
    redirectUris: [
      { uri: 'https://app.example.com/cb', kind: 'login' },
      { uri: 'https://app.example.com/bye', kind: 'post_logout' },
    ],
  });

  expect(mockPrisma.saAppRedirectUri.deleteMany).toHaveBeenCalledWith({ where: { appId: 7 } });
  expect(mockPrisma.saAppRedirectUri.createMany).toHaveBeenCalledWith({
    data: [
      { appId: 7, uri: 'https://app.example.com/cb', kind: 'login' },
      { appId: 7, uri: 'https://app.example.com/bye', kind: 'post_logout' },
    ],
  });
});

it('rejects a redirect URI that is not an absolute http(s) URL', async () => {
  mockPrisma.saApp.findUnique.mockResolvedValue({ id: 7, publicId: 'a_7', isPlatform: false });

  await expect(
    service.updateApp('admin-ba-id', 'a_7', {
      redirectUris: [{ uri: 'javascript:alert(1)', kind: 'login' }],
    }),
  ).rejects.toThrow();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @sassy-auth/auth-server test -- apps.service.spec`
Expected: FAIL — `redirectUris` is not handled.

- [ ] **Step 3: Implement service and DTO changes**

In `apps/auth-server/src/apps/apps.service.ts`, drop `callbackUrl` from `AppRow` and `toApp`, adding the relation instead:

```typescript
type RedirectUriRow = { uri: string; kind: string };
type AppRow = {
  publicId: string; name: string; url: string; isPlatform: boolean;
  twoFactorTrustDays: number | null; requireTwoFactor: boolean;
  redirectUris?: RedirectUriRow[];
};

function toApp(a: AppRow) {
  return {
    publicId: a.publicId, name: a.name, url: a.url, isPlatform: a.isPlatform,
    twoFactorTrustDays: a.twoFactorTrustDays ?? null,
    requireTwoFactor: a.requireTwoFactor,
    redirectUris: (a.redirectUris ?? []).map((r) => ({ uri: r.uri, kind: r.kind })),
  };
}

/** Redirect URIs must be absolute http(s) URLs — no javascript:, data:, or relative paths. */
function assertValidRedirectUris(uris: Array<{ uri: string; kind: string }>): void {
  for (const r of uris) {
    let parsed: URL;
    try {
      parsed = new URL(r.uri);
    } catch {
      throw new BadRequestException(`Invalid redirect URI: ${r.uri}`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new BadRequestException(`Redirect URI must be http(s): ${r.uri}`);
    }
    if (r.kind !== 'login' && r.kind !== 'post_logout') {
      throw new BadRequestException(`Invalid redirect URI kind: ${r.kind}`);
    }
  }
}
```

In `updateApp`, after the existing permission checks and inside the existing transaction, replace the set wholesale when `dto.redirectUris` is present:

```typescript
      if (dto.redirectUris) {
        assertValidRedirectUris(dto.redirectUris);
        await tx.saAppRedirectUri.deleteMany({ where: { appId: existing.id } });
        await tx.saAppRedirectUri.createMany({
          data: dto.redirectUris.map((r) => ({ appId: existing.id, uri: r.uri, kind: r.kind })),
        });
      }
```

Apply the same block in `createApp` after the `publicId` update. Remove `callbackUrl` from both DTOs and add:

```typescript
  @ApiPropertyOptional({ type: [Object] })
  @IsOptional()
  @IsArray()
  redirectUris?: Array<{ uri: string; kind: 'login' | 'post_logout' }>;
```

Every `prisma.saApp.find*` in this service gains `include: { redirectUris: true }`.

- [ ] **Step 4: Update the admin drawers**

In `apps/admin/components/app-edit-drawer.tsx` and `app-create-drawer.tsx`, replace the single `callbackUrl` input with a repeatable list: an "Add redirect URI" button, a row per URI with a text input and a `login | post_logout` select, and a remove button per row. Submit `redirectUris` in the PATCH/POST body.

When the login list is empty, render this warning beneath it:

```tsx
{loginUris.length === 0 && (
  <p className="text-sm text-amber-600 dark:text-amber-500">
    No redirect URIs registered — any path on this app&apos;s origin is currently
    accepted. Register explicit URIs to restrict this.
  </p>
)}
```

In `app-view-drawer.tsx`, render the URIs grouped by kind in place of the `callbackUrl` field.

- [ ] **Step 5: Run both suites**

Run: `pnpm --filter @sassy-auth/auth-server test -- apps.service.spec && pnpm --filter @sassy-auth/admin test -- app-edit-drawer app-create-drawer app-view-drawer`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/auth-server/src/apps apps/admin/components
git commit -m "feat(admin): manage multiple redirect URIs per app

Replaces the single callbackUrl field with a typed login/post_logout list,
validated as absolute http(s) URLs. Warns when an app has no registered
login URIs and is relying on same-origin fallback matching."
```

---

### Task 5: The openid-configuration document

**Files:**
- Modify: `apps/auth-server/src/token/oauth-metadata.ts`
- Modify: `apps/auth-server/src/token/discovery.controller.ts`
- Test: `apps/auth-server/src/token/oauth-metadata.spec.ts`, `apps/auth-server/src/token/discovery.controller.spec.ts`

**Interfaces:**
- Produces: constants `OIDC_METADATA_PATH = '.well-known/openid-configuration'`, `OAUTH_USERINFO_ROUTE = 'oauth/userinfo'`, `OAUTH_LOGOUT_ROUTE = 'oauth/logout'`; `buildOpenIdConfiguration(issuer: string): OpenIdConfiguration`.

- [ ] **Step 1: Write the failing tests**

Add to `apps/auth-server/src/token/oauth-metadata.spec.ts`:

```typescript
describe('buildOpenIdConfiguration', () => {
  const doc = buildOpenIdConfiguration('http://localhost:3000');

  it('advertises the OIDC endpoints under the API prefix', () => {
    expect(doc.issuer).toBe('http://localhost:3000');
    expect(doc.authorization_endpoint).toBe('http://localhost:3000/api/token/oauth/authorize');
    expect(doc.token_endpoint).toBe('http://localhost:3000/api/token/oauth/token');
    expect(doc.userinfo_endpoint).toBe('http://localhost:3000/api/token/oauth/userinfo');
    expect(doc.end_session_endpoint).toBe('http://localhost:3000/api/token/oauth/logout');
    expect(doc.jwks_uri).toBe('http://localhost:3000/api/token/jwks');
  });

  it('advertises the supported OIDC capabilities', () => {
    expect(doc.scopes_supported).toEqual(['openid', 'profile', 'email']);
    expect(doc.response_types_supported).toEqual(['code']);
    expect(doc.grant_types_supported).toEqual(['authorization_code']);
    expect(doc.subject_types_supported).toEqual(['public']);
    expect(doc.id_token_signing_alg_values_supported).toEqual(['RS256']);
    expect(doc.code_challenge_methods_supported).toEqual(['S256']);
    expect(doc.token_endpoint_auth_methods_supported).toEqual([
      'none', 'client_secret_basic', 'client_secret_post',
    ]);
  });

  it('does not advertise offline_access — refresh tokens are unsupported', () => {
    expect(doc.scopes_supported).not.toContain('offline_access');
    expect(doc.grant_types_supported).not.toContain('refresh_token');
  });

  it('shares endpoint URLs with the RFC 8414 document', () => {
    const oauthDoc = buildOAuthAuthorizationServerMetadata('http://localhost:3000');
    expect(doc.authorization_endpoint).toBe(oauthDoc.authorization_endpoint);
    expect(doc.token_endpoint).toBe(oauthDoc.token_endpoint);
    expect(doc.jwks_uri).toBe(oauthDoc.jwks_uri);
  });
});
```

Add to `apps/auth-server/src/token/discovery.controller.spec.ts`:

```typescript
it('serves the OIDC metadata at /.well-known/openid-configuration (root, not /api/...)', async () => {
  const res = await request(app.getHttpServer()).get('/.well-known/openid-configuration');
  expect(res.status).toBe(200);
  expect(res.body.issuer).toBe('http://localhost:3000');
  expect(res.body.userinfo_endpoint).toBe('http://localhost:3000/api/token/oauth/userinfo');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @sassy-auth/auth-server test -- oauth-metadata.spec discovery.controller.spec`
Expected: FAIL — `buildOpenIdConfiguration` is not exported; the route 404s.

- [ ] **Step 3: Implement**

Append to `apps/auth-server/src/token/oauth-metadata.ts`:

```typescript
export const OAUTH_USERINFO_ROUTE = 'oauth/userinfo';
export const OAUTH_LOGOUT_ROUTE = 'oauth/logout';

// OIDC Discovery well-known URI. Like RFC 8414, served at the host root.
export const OIDC_METADATA_PATH = '.well-known/openid-configuration';

const SCOPES_SUPPORTED = ['openid', 'profile', 'email'] as const;
const SUBJECT_TYPES_SUPPORTED = ['public'] as const;
const ID_TOKEN_SIGNING_ALGS = ['RS256'] as const;
const CLAIMS_SUPPORTED = [
  'sub', 'iss', 'aud', 'exp', 'iat', 'auth_time', 'nonce', 'amr', 'at_hash',
  'org', 'name', 'given_name', 'family_name', 'email', 'email_verified',
] as const;

export interface OpenIdConfiguration {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  end_session_endpoint: string;
  jwks_uri: string;
  scopes_supported: readonly string[];
  response_types_supported: readonly string[];
  grant_types_supported: readonly string[];
  subject_types_supported: readonly string[];
  id_token_signing_alg_values_supported: readonly string[];
  code_challenge_methods_supported: readonly string[];
  token_endpoint_auth_methods_supported: readonly string[];
  claims_supported: readonly string[];
}

export function buildOpenIdConfiguration(issuer: string): OpenIdConfiguration {
  const oauth = buildOAuthAuthorizationServerMetadata(issuer);
  const base = stripTrailingSlash(issuer);
  const tokenRoot = `${base}/${NEST_GLOBAL_PREFIX}/${TOKEN_CONTROLLER_PATH}`;
  return {
    issuer: oauth.issuer,
    authorization_endpoint: oauth.authorization_endpoint,
    token_endpoint: oauth.token_endpoint,
    jwks_uri: oauth.jwks_uri,
    userinfo_endpoint: `${tokenRoot}/${OAUTH_USERINFO_ROUTE}`,
    end_session_endpoint: `${tokenRoot}/${OAUTH_LOGOUT_ROUTE}`,
    scopes_supported: [...SCOPES_SUPPORTED],
    response_types_supported: oauth.response_types_supported,
    grant_types_supported: oauth.grant_types_supported,
    subject_types_supported: [...SUBJECT_TYPES_SUPPORTED],
    id_token_signing_alg_values_supported: [...ID_TOKEN_SIGNING_ALGS],
    code_challenge_methods_supported: oauth.code_challenge_methods_supported,
    token_endpoint_auth_methods_supported: oauth.token_endpoint_auth_methods_supported,
    claims_supported: [...CLAIMS_SUPPORTED],
  };
}
```

Change `TOKEN_ENDPOINT_AUTH_METHODS_SUPPORTED` in the same file to:

```typescript
const TOKEN_ENDPOINT_AUTH_METHODS_SUPPORTED = [
  'none', 'client_secret_basic', 'client_secret_post',
] as const;
```

Add the handler to `apps/auth-server/src/token/discovery.controller.ts`:

```typescript
  @Get(OIDC_METADATA_PATH)
  getOpenIdConfiguration(): OpenIdConfiguration {
    return buildOpenIdConfiguration(resolveIssuer());
  }
```

Widen the constructor warning message to name both documents.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @sassy-auth/auth-server test -- oauth-metadata.spec discovery.controller.spec`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/token/oauth-metadata.ts \
        apps/auth-server/src/token/oauth-metadata.spec.ts \
        apps/auth-server/src/token/discovery.controller.ts \
        apps/auth-server/src/token/discovery.controller.spec.ts
git commit -m "feat(oidc): serve /.well-known/openid-configuration

Derives from the same route constants as the RFC 8414 document, so the two
cannot drift. Does not advertise offline_access — refresh is unsupported."
```

---

### Task 6: Carry nonce, scope, and auth_time on authorization codes

**Files:**
- Modify: `apps/auth-server/src/token/oauth.service.ts`
- Modify: `apps/auth-server/src/token/token.controller.ts` (`oauthAuthorize`)
- Create: `apps/auth-server/src/token/scopes.ts`
- Test: `apps/auth-server/src/token/oauth.service.spec.ts`, `apps/auth-server/src/token/scopes.spec.ts`

**Interfaces:**
- Produces: `parseScopes(requested: string | undefined): string[]` and `SUPPORTED_SCOPES` in `scopes.ts`. `OauthService.generateCode` gains parameters `(…, nonce: string | null, scope: string, authTime: Date)`; `exchangeCode` returns `{ userId, appPublicId, amr, nonce, scope, authTime, hadChallenge }`.

- [ ] **Step 1: Write the failing scope tests**

Create `apps/auth-server/src/token/scopes.spec.ts`:

```typescript
import { parseScopes } from './scopes';

describe('parseScopes', () => {
  it('keeps supported scopes in canonical order', () => {
    expect(parseScopes('email openid profile')).toEqual(['openid', 'profile', 'email']);
  });

  it('drops unrecognised scopes silently', () => {
    expect(parseScopes('openid wat offline_access')).toEqual(['openid']);
  });

  it('returns an empty list for undefined or blank input', () => {
    expect(parseScopes(undefined)).toEqual([]);
    expect(parseScopes('   ')).toEqual([]);
  });

  it('de-duplicates repeated scopes', () => {
    expect(parseScopes('openid openid profile')).toEqual(['openid', 'profile']);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @sassy-auth/auth-server test -- scopes.spec`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement scope parsing**

Create `apps/auth-server/src/token/scopes.ts`:

```typescript
// Canonical order so the `scope` claim and the token response are stable
// regardless of the order the client requested them in.
export const SUPPORTED_SCOPES = ['openid', 'profile', 'email'] as const;

export type SupportedScope = (typeof SUPPORTED_SCOPES)[number];

/**
 * Parses a space-delimited `scope` request. Unrecognised scopes are dropped
 * silently rather than rejected, per OAuth 2.0 — the token response echoes
 * only what was actually granted.
 */
export function parseScopes(requested: string | undefined): SupportedScope[] {
  if (!requested) return [];
  const asked = new Set(requested.split(/\s+/).filter(Boolean));
  return SUPPORTED_SCOPES.filter((s) => asked.has(s));
}
```

- [ ] **Step 4: Write the failing OauthService test**

Add to `apps/auth-server/src/token/oauth.service.spec.ts`:

```typescript
it('persists nonce, scope, and authTime with the code', async () => {
  const authTime = new Date('2026-08-21T10:00:00Z');
  await service.generateCode('u_1', 'a_7', 'https://app/cb', 'chal', 'S256', ['pwd'], 'n-123', 'openid profile', authTime);

  expect(mockPrisma.saOauthCode.create).toHaveBeenCalledWith({
    data: expect.objectContaining({
      nonce: 'n-123', scope: 'openid profile', authTime,
    }),
  });
});

it('returns nonce, scope, authTime, and hadChallenge on exchange', async () => {
  mockPrisma.saOauthCode.delete.mockResolvedValue({
    userId: 'u_1', appPublicId: 'a_7', redirectUri: 'https://app/cb',
    codeChallenge: 's256-of-verifier', codeChallengeMethod: 'S256',
    amr: '["pwd"]', nonce: 'n-123', scope: 'openid profile',
    authTime: new Date('2026-08-21T10:00:00Z'),
    expiresAt: new Date(Date.now() + 60_000),
  });

  const result = await service.exchangeCode('code', 'a_7', 'https://app/cb', 'verifier-matching-challenge');

  expect(result.nonce).toBe('n-123');
  expect(result.scope).toBe('openid profile');
  expect(result.hadChallenge).toBe(true);
});

it('reports hadChallenge false for a code stored without PKCE', async () => {
  mockPrisma.saOauthCode.delete.mockResolvedValue({
    userId: 'u_1', appPublicId: 'a_7', redirectUri: 'https://app/cb',
    codeChallenge: null, codeChallengeMethod: null,
    amr: '["pwd"]', nonce: null, scope: '',
    authTime: new Date(), expiresAt: new Date(Date.now() + 60_000),
  });

  const result = await service.exchangeCode('code', 'a_7', 'https://app/cb', undefined);

  expect(result.hadChallenge).toBe(false);
});
```

- [ ] **Step 5: Run to verify failure**

Run: `pnpm --filter @sassy-auth/auth-server test -- oauth.service.spec`
Expected: FAIL — extra arguments ignored, returned object lacks the new fields.

- [ ] **Step 6: Implement the service changes**

In `apps/auth-server/src/token/oauth.service.ts`, widen `generateCode`:

```typescript
  async generateCode(
    userId: string,
    appPublicId: string,
    redirectUri: string,
    codeChallenge: string | null,
    codeChallengeMethod: 'S256' | null,
    amr: string[],
    nonce: string | null,
    scope: string,
    authTime: Date,
  ): Promise<string> {
    const code = crypto.randomBytes(32).toString('hex');
    await prisma.saOauthCode.create({
      data: {
        code, userId, appPublicId, redirectUri,
        codeChallenge, codeChallengeMethod,
        amr: JSON.stringify(amr),
        nonce, scope, authTime,
        expiresAt: new Date(Date.now() + CODE_TTL_MS),
      },
    });
    return code;
  }
```

In `exchangeCode`, change the signature to `codeVerifier: string | undefined`, skip PKCE verification when `entry.codeChallenge` is null, and return the new fields:

```typescript
    // A challenge-less code is only reachable for confidential clients; the
    // caller (TokenController) is responsible for having authenticated them.
    // See the /token invariant test in Task 9.
    if (entry.codeChallenge) {
      if (!codeVerifier || s256(codeVerifier) !== entry.codeChallenge) {
        throw new UnauthorizedException(TokenErrorCode.INVALID_GRANT);
      }
    }

    return {
      userId: entry.userId,
      appPublicId: entry.appPublicId,
      amr: JSON.parse(entry.amr) as string[],
      nonce: entry.nonce,
      scope: entry.scope,
      authTime: entry.authTime,
      hadChallenge: entry.codeChallenge !== null,
    };
```

- [ ] **Step 7: Wire the authorize handler**

In `oauthAuthorize` in `apps/auth-server/src/token/token.controller.ts`, accept the new query parameters:

```typescript
    @Query('scope') scope: string = '',
    @Query('nonce') nonce: string = '',
```

Derive `auth_time` from the BetterAuth session and pass everything through — the existing `generateCode` call becomes:

```typescript
      const granted = parseScopes(scope);
      const authTime = session.session?.createdAt
        ? new Date(session.session.createdAt)
        : new Date();

      const code = await this.oauthService.generateCode(
        saUser.publicId,
        app.publicId,
        redirectUri,
        codeChallenge || null,
        codeChallenge ? 'S256' : null,
        amr,
        nonce || null,
        granted.join(' '),
        authTime,
      );
```

Carry `scope` and `nonce` through the forced-2FA enrollment `next=` round-trip by adding them to the existing `URLSearchParams` block, so the user lands back on an authorize request that still knows what was asked for.

- [ ] **Step 8: Run the tests**

Run: `pnpm --filter @sassy-auth/auth-server test -- oauth.service.spec scopes.spec token.controller.spec`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/auth-server/src/token/scopes.ts apps/auth-server/src/token/scopes.spec.ts \
        apps/auth-server/src/token/oauth.service.ts apps/auth-server/src/token/oauth.service.spec.ts \
        apps/auth-server/src/token/token.controller.ts
git commit -m "feat(oidc): carry nonce, granted scope, and auth_time on authorization codes

Unrecognised scopes are dropped silently per OAuth. scope and nonce survive
the forced-2FA enrollment round-trip."
```

---

### Task 7: Issue the id_token

**Files:**
- Modify: `apps/auth-server/src/token/token.service.ts`
- Modify: `apps/auth-server/src/token/token.controller.ts` (`oauthToken`)
- Test: `apps/auth-server/src/token/token.service.spec.ts`

**Interfaces:**
- Consumes: `parseScopes` (Task 6), `issueJwt` (Task 1).
- Produces: `TokenService.issueIdToken(params: IssueIdTokenParams): Promise<string>` where `IssueIdTokenParams` is `{ saUserId: number; userPublicId: string; orgPublicId: string; appPublicId: string; scope: string; nonce: string | null; authTime: Date; amr: string[]; accessToken: string }`. Also `TokenService.buildScopedClaims(saUserId: number, scope: string): Promise<Record<string, unknown>>`, reused by Task 8.

- [ ] **Step 1: Write the failing tests**

Add to `apps/auth-server/src/token/token.service.spec.ts`:

```typescript
describe('issueIdToken', () => {
  const baseParams = {
    saUserId: 1, userPublicId: 'u_1', orgPublicId: 'o_1', appPublicId: 'a_7',
    nonce: 'n-123', authTime: new Date('2026-08-21T10:00:00Z'),
    amr: ['pwd'], accessToken: 'header.payload.signature',
  };

  beforeEach(() => {
    mockPrisma.saUser.findUnique.mockResolvedValue({
      id: 1, firstName: 'Ada', lastName: 'Lovelace',
      org: { publicId: 'o_1' },
      betterAuthUser: { email: 'ada@example.com', emailVerified: true },
    });
  });

  it('always emits the core identity claims', async () => {
    const decoded = jwt.decode(await service.issueIdToken({ ...baseParams, scope: 'openid' })) as Record<string, unknown>;

    expect(decoded.sub).toBe('u_1');
    expect(decoded.aud).toBe('a_7');
    expect(decoded.org).toBe('o_1');
    expect(decoded.nonce).toBe('n-123');
    expect(decoded.amr).toEqual(['pwd']);
    expect(decoded.auth_time).toBe(Math.floor(baseParams.authTime.getTime() / 1000));
    expect(typeof decoded.at_hash).toBe('string');
    expect(decoded.azp).toBeUndefined();
  });

  it('omits profile and email claims when those scopes were not granted', async () => {
    const decoded = jwt.decode(await service.issueIdToken({ ...baseParams, scope: 'openid' })) as Record<string, unknown>;

    expect(decoded.name).toBeUndefined();
    expect(decoded.email).toBeUndefined();
  });

  it('includes profile claims for the profile scope', async () => {
    const decoded = jwt.decode(await service.issueIdToken({ ...baseParams, scope: 'openid profile' })) as Record<string, unknown>;

    expect(decoded.name).toBe('Ada Lovelace');
    expect(decoded.given_name).toBe('Ada');
    expect(decoded.family_name).toBe('Lovelace');
    expect(decoded.email).toBeUndefined();
  });

  it('includes email claims for the email scope', async () => {
    const decoded = jwt.decode(await service.issueIdToken({ ...baseParams, scope: 'openid email' })) as Record<string, unknown>;

    expect(decoded.email).toBe('ada@example.com');
    expect(decoded.email_verified).toBe(true);
    expect(decoded.name).toBeUndefined();
  });

  it('omits nonce when the client did not send one', async () => {
    const decoded = jwt.decode(await service.issueIdToken({ ...baseParams, nonce: null, scope: 'openid' })) as Record<string, unknown>;

    expect(decoded).not.toHaveProperty('nonce');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @sassy-auth/auth-server test -- token.service.spec`
Expected: FAIL — `issueIdToken` is not a function.

- [ ] **Step 3: Implement**

Add to `apps/auth-server/src/token/token.service.ts`:

```typescript
interface IssueIdTokenParams {
  saUserId: number;
  userPublicId: string;
  orgPublicId: string;
  appPublicId: string;
  scope: string;
  nonce: string | null;
  authTime: Date;
  amr: string[];
  accessToken: string;
}

/**
 * OIDC at_hash: base64url of the left-most half of the SHA-256 of the
 * access token's ASCII octets (RS256 → SHA-256 → 128 bits kept).
 */
function atHash(accessToken: string): string {
  const digest = crypto.createHash('sha256').update(accessToken, 'ascii').digest();
  return digest.subarray(0, digest.length / 2).toString('base64url');
}
```

Then the two methods on `TokenService`:

```typescript
  /**
   * Resolves the scope-gated identity claims. Single source of truth shared by
   * the id_token and /userinfo, so the two cannot disagree about what a scope
   * grants.
   */
  async buildScopedClaims(saUserId: number, scope: string): Promise<Record<string, unknown>> {
    const granted = new Set(scope.split(/\s+/).filter(Boolean));
    if (!granted.has('profile') && !granted.has('email')) return {};

    const user = await prisma.saUser.findUnique({
      where: { id: saUserId },
      include: { betterAuthUser: true },
    });
    if (!user) throw new NotFoundException(TokenErrorCode.USER_NOT_FOUND);

    const claims: Record<string, unknown> = {};
    if (granted.has('profile')) {
      claims.name = `${user.firstName} ${user.lastName}`.trim();
      claims.given_name = user.firstName;
      claims.family_name = user.lastName;
    }
    if (granted.has('email')) {
      claims.email = user.betterAuthUser.email;
      claims.email_verified = user.betterAuthUser.emailVerified;
    }
    return claims;
  }

  async issueIdToken(params: IssueIdTokenParams): Promise<string> {
    const issuer = resolveIssuer();
    const now = Math.floor(Date.now() / 1000);
    const scoped = await this.buildScopedClaims(params.saUserId, params.scope);

    const payload = {
      sub: params.userPublicId,
      aud: params.appPublicId,
      iss: issuer,
      iat: now,
      exp: now + 3600,
      auth_time: Math.floor(params.authTime.getTime() / 1000),
      amr: params.amr,
      at_hash: atHash(params.accessToken),
      // A SassyAuth identity is org-scoped; an id_token without `org` would
      // describe a user that does not exist.
      org: params.orgPublicId,
      ...(params.nonce ? { nonce: params.nonce } : {}),
      ...scoped,
    };

    return jwt.sign(payload, this.privateKey, { algorithm: 'RS256', keyid: this.kid });
  }
```

- [ ] **Step 4: Return it from the token endpoint**

In `oauthToken` in `apps/auth-server/src/token/token.controller.ts`, use the exchanged scope and add the `id_token` when `openid` was granted:

```typescript
    const token = await this.tokenService.issueJwt({
      saUserId: saUser.id,
      userPublicId: saUser.publicId,
      orgPublicId: saUser.org.publicId,
      appPublicId,
      appId: app.id,
      scope: exchanged.scope,
      amr: exchangedAmr,
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

    return {
      access_token: token,
      token_type: 'Bearer',
      expires_in: 3600,
      scope: exchanged.scope,
      ...(idToken ? { id_token: idToken } : {}),
    };
```

Keep the `exchanged` object in scope rather than destructuring only `userId`/`appPublicId`/`amr` as the current code does.

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @sassy-auth/auth-server test -- token.service.spec token.controller.spec`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/auth-server/src/token/token.service.ts \
        apps/auth-server/src/token/token.service.spec.ts \
        apps/auth-server/src/token/token.controller.ts
git commit -m "feat(oidc): issue an id_token when the openid scope is granted

Scope-gated claims come from one resolver shared with /userinfo. org is
always present — a SassyAuth identity is org-scoped."
```

---

### Task 8: The /userinfo endpoint

**Files:**
- Modify: `apps/auth-server/src/token/token.controller.ts`
- Test: `apps/auth-server/src/token/token.controller.spec.ts`

**Interfaces:**
- Consumes: `buildScopedClaims` (Task 7), `OAUTH_USERINFO_ROUTE` (Task 5).
- Produces: `GET /api/token/oauth/userinfo` returning `{ sub, ...scopedClaims }`.

- [ ] **Step 1: Write the failing tests**

Add to `apps/auth-server/src/token/token.controller.spec.ts`:

```typescript
describe('GET /api/token/oauth/userinfo', () => {
  it('returns sub plus the claims the token was granted', async () => {
    const token = signTestToken({ sub: 'u_1', aud: 'a_7', scope: 'openid profile' });
    mockTokenService.buildScopedClaims.mockResolvedValue({
      name: 'Ada Lovelace', given_name: 'Ada', family_name: 'Lovelace',
    });

    const res = await request(app.getHttpServer())
      .get('/api/token/oauth/userinfo')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.sub).toBe('u_1');
    expect(res.body.name).toBe('Ada Lovelace');
  });

  it('cannot return a claim the token did not grant', async () => {
    const token = signTestToken({ sub: 'u_1', aud: 'a_7', scope: 'openid' });
    mockTokenService.buildScopedClaims.mockResolvedValue({});

    const res = await request(app.getHttpServer())
      .get('/api/token/oauth/userinfo')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sub: 'u_1' });
    expect(mockTokenService.buildScopedClaims).toHaveBeenCalledWith(expect.any(Number), 'openid');
  });

  it('rejects a missing bearer token', async () => {
    const res = await request(app.getHttpServer()).get('/api/token/oauth/userinfo');
    expect(res.status).toBe(401);
  });

  it('rejects a token with a bad signature', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/token/oauth/userinfo')
      .set('Authorization', 'Bearer not.a.token');
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @sassy-auth/auth-server test -- token.controller.spec`
Expected: FAIL — 404 on the route.

- [ ] **Step 3: Implement**

Add to `apps/auth-server/src/token/token.controller.ts`:

```typescript
  /**
   * GET /api/token/oauth/userinfo
   *
   * Claims for the bearer token's subject, gated by that token's own `scope`
   * claim. Deriving the gate from the presented token means /userinfo can never
   * return more than was granted, with no second source of truth to drift.
   */
  @Get(OAUTH_USERINFO_ROUTE)
  async userinfo(@Req() req: Request) {
    const header = req.headers.authorization ?? '';
    const [scheme, raw] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !raw) {
      throw new UnauthorizedException(TokenErrorCode.INVALID_REQUEST);
    }

    let claims: { sub?: string; scope?: string };
    try {
      claims = this.tokenService.verifyAccessToken(raw);
    } catch {
      throw new UnauthorizedException(TokenErrorCode.INVALID_GRANT);
    }

    const saUser = await prisma.saUser.findFirst({ where: { publicId: claims.sub } });
    if (!saUser || saUser.status !== 'active') {
      throw new UnauthorizedException(TokenErrorCode.USER_NOT_FOUND);
    }

    const scoped = await this.tokenService.buildScopedClaims(saUser.id, claims.scope ?? '');
    return { sub: claims.sub, ...scoped };
  }
```

Add the verifier to `TokenService`, reusing the existing public key:

```typescript
  /** Verifies an access token this server issued. Throws on any failure. */
  verifyAccessToken(token: string): { sub?: string; scope?: string; aud?: string } {
    return jwt.verify(token, this.publicKey, {
      algorithms: ['RS256'],
      issuer: resolveIssuer(),
    }) as { sub?: string; scope?: string; aud?: string };
  }
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @sassy-auth/auth-server test -- token.controller.spec`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/token/token.controller.ts \
        apps/auth-server/src/token/token.controller.spec.ts \
        apps/auth-server/src/token/token.service.ts
git commit -m "feat(oidc): add the /userinfo endpoint

Claims are gated by the presented token's own scope claim, so /userinfo
cannot return more than the token was granted."
```

---

### Task 9: Confidential clients

**Files:**
- Create: `apps/auth-server/src/token/client-auth.ts`
- Modify: `apps/auth-server/src/token/token.controller.ts`, `apps/auth-server/src/token/dto/oauth-token-exchange.dto.ts`
- Modify: `apps/auth-server/src/apps/apps.service.ts`, `apps/admin/components/app-edit-drawer.tsx`
- Test: `apps/auth-server/src/token/client-auth.spec.ts`, `apps/auth-server/src/token/token.controller.spec.ts`

**Interfaces:**
- Consumes: `SaApp.clientSecretHash` (Task 2), `hadChallenge` (Task 6).
- Produces: `extractClientSecret(req: Request, body: { client_secret?: string }): string | null` and `verifyClientSecret(presented: string | null, hash: string | null): Promise<boolean>` in `client-auth.ts`. `AppsService.rotateClientSecret(callerBaId: string, publicId: string): Promise<{ clientSecret: string }>`.

- [ ] **Step 1: Write the failing client-auth tests**

Create `apps/auth-server/src/token/client-auth.spec.ts`:

```typescript
import { extractClientSecret, verifyClientSecret } from './client-auth';
import { hashPassword } from 'better-auth/crypto';

describe('extractClientSecret', () => {
  it('reads client_secret_basic from the Authorization header', () => {
    const encoded = Buffer.from('a_7:s3cr3t').toString('base64');
    const req = { headers: { authorization: `Basic ${encoded}` } } as never;
    expect(extractClientSecret(req, {})).toBe('s3cr3t');
  });

  it('reads client_secret_post from the body', () => {
    const req = { headers: {} } as never;
    expect(extractClientSecret(req, { client_secret: 's3cr3t' })).toBe('s3cr3t');
  });

  it('returns null when neither is present', () => {
    const req = { headers: {} } as never;
    expect(extractClientSecret(req, {})).toBeNull();
  });

  it('percent-decodes the basic credential per RFC 6749 §2.3.1', () => {
    const encoded = Buffer.from('a_7:s3%3Acr3t').toString('base64');
    const req = { headers: { authorization: `Basic ${encoded}` } } as never;
    expect(extractClientSecret(req, {})).toBe('s3:cr3t');
  });
});

describe('verifyClientSecret', () => {
  it('accepts the correct secret', async () => {
    const hash = await hashPassword('s3cr3t');
    expect(await verifyClientSecret('s3cr3t', hash)).toBe(true);
  });

  it('rejects a wrong secret', async () => {
    const hash = await hashPassword('s3cr3t');
    expect(await verifyClientSecret('nope', hash)).toBe(false);
  });

  it('rejects when no secret was presented', async () => {
    const hash = await hashPassword('s3cr3t');
    expect(await verifyClientSecret(null, hash)).toBe(false);
  });

  it('rejects when the app has no secret configured', async () => {
    expect(await verifyClientSecret('anything', null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @sassy-auth/auth-server test -- client-auth.spec`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement client-auth**

Create `apps/auth-server/src/token/client-auth.ts`:

```typescript
import { Request } from 'express';
// Reuse BetterAuth's scrypt so client secrets are stored the same way as
// passwords — one hashing primitive in the codebase, not two.
import { verifyPassword } from 'better-auth/crypto';

/**
 * Extracts a presented client secret from either supported method:
 * `client_secret_basic` (Authorization: Basic base64(id:secret)) or
 * `client_secret_post` (form/JSON body). Basic wins when both are present.
 */
export function extractClientSecret(
  req: Request,
  body: { client_secret?: string },
): string | null {
  const header = req.headers.authorization ?? '';
  const [scheme, encoded] = header.split(' ');
  if (scheme?.toLowerCase() === 'basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
    const separator = decoded.indexOf(':');
    if (separator !== -1) {
      // RFC 6749 §2.3.1: both halves are application/x-www-form-urlencoded.
      return decodeURIComponent(decoded.slice(separator + 1));
    }
  }
  return body.client_secret ?? null;
}

/**
 * Verifies a presented secret against a stored hash. Returns false rather than
 * throwing for every failure mode, so callers produce one indistinguishable
 * `invalid_client` response.
 */
export async function verifyClientSecret(
  presented: string | null,
  hash: string | null,
): Promise<boolean> {
  if (!presented || !hash) return false;
  try {
    return await verifyPassword({ password: presented, hash });
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Write the failing invariant tests**

Add to `apps/auth-server/src/token/token.controller.spec.ts`. These are the two halves of the §2 invariant and must be independent:

```typescript
describe('confidential client invariants', () => {
  it('/authorize refuses to omit PKCE for a public app', async () => {
    mockPrisma.saApp.findUnique.mockResolvedValue({
      id: 7, publicId: 'a_7', url: 'https://app.example.com',
      clientSecretHash: null, redirectUris: [],
    });

    const res = await request(app.getHttpServer())
      .get('/api/token/oauth/authorize')
      .query({ client_id: 'a_7', redirect_uri: 'https://app.example.com/cb', scope: 'openid' });

    expect(res.status).toBe(400);
  });

  it('/authorize allows omitting PKCE for a confidential app', async () => {
    mockPrisma.saApp.findUnique.mockResolvedValue({
      id: 7, publicId: 'a_7', url: 'https://app.example.com',
      clientSecretHash: 'scrypt-hash', redirectUris: [],
    });

    const res = await request(app.getHttpServer())
      .get('/api/token/oauth/authorize')
      .query({ client_id: 'a_7', redirect_uri: 'https://app.example.com/cb', scope: 'openid' });

    expect(res.status).not.toBe(400);
  });

  it('/token rejects a challenge-less code when the client did not authenticate', async () => {
    mockPrisma.saApp.findUnique.mockResolvedValue({
      id: 7, publicId: 'a_7', url: 'https://app.example.com',
      clientSecretHash: 'scrypt-hash', redirectUris: [],
    });
    mockOauthService.exchangeCode.mockResolvedValue({
      userId: 'u_1', appPublicId: 'a_7', amr: ['pwd'],
      nonce: null, scope: 'openid', authTime: new Date(), hadChallenge: false,
    });

    const res = await request(app.getHttpServer())
      .post('/api/token/oauth/token')
      .send({ code: 'c', client_id: 'a_7', redirect_uri: 'https://app.example.com/cb' });

    expect(res.status).toBe(401);
  });

  it('/token rejects a wrong client secret with invalid_client', async () => {
    mockPrisma.saApp.findUnique.mockResolvedValue({
      id: 7, publicId: 'a_7', url: 'https://app.example.com',
      clientSecretHash: await hashPassword('right'), redirectUris: [],
    });

    const res = await request(app.getHttpServer())
      .post('/api/token/oauth/token')
      .send({ code: 'c', client_id: 'a_7', redirect_uri: 'https://app.example.com/cb', client_secret: 'wrong' });

    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toContain('Basic');
  });
});
```

- [ ] **Step 5: Run to verify failure**

Run: `pnpm --filter @sassy-auth/auth-server test -- token.controller.spec`
Expected: FAIL — PKCE is unconditionally required; no client auth exists.

- [ ] **Step 6: Implement the controller changes**

In `oauthAuthorize`, replace the unconditional PKCE check. It must run **after** the app lookup, since it now depends on the app:

```typescript
      // PKCE is mandatory for public clients. Confidential clients may omit it —
      // the client secret provides the same protection — but a challenge, when
      // sent, must still be S256.
      const isConfidential = app.clientSecretHash !== null;
      if (codeChallenge) {
        if (codeChallengeMethod !== 'S256') {
          throw new BadRequestException(TokenErrorCode.INVALID_REQUEST);
        }
      } else if (!isConfidential) {
        throw new BadRequestException(TokenErrorCode.INVALID_REQUEST);
      }
```

In `oauthToken`, authenticate before exchanging the code:

```typescript
    const presentedSecret = extractClientSecret(req, dto);
    const clientAuthenticated = await verifyClientSecret(presentedSecret, app.clientSecretHash);

    // A confidential client must authenticate. Public clients must not present
    // a secret they were never issued.
    if (app.clientSecretHash && !clientAuthenticated) {
      throw new UnauthorizedException(TokenErrorCode.UNAUTHORIZED_CLIENT);
    }
```

And after the exchange, the second half of the invariant:

```typescript
    // §2 invariant, enforced independently of /authorize: a code carrying no
    // PKCE challenge is only exchangeable by an authenticated client.
    if (!exchanged.hadChallenge && !clientAuthenticated) {
      throw new UnauthorizedException(TokenErrorCode.UNAUTHORIZED_CLIENT);
    }
```

Add `@Req() req: Request` to the `oauthToken` signature, make `code_verifier` optional in `OauthTokenExchangeDto`, and add an optional `client_secret` string field to it. Set the `WWW-Authenticate` header on the 401 via an exception filter or by injecting `@Res({ passthrough: true })` and calling `res.setHeader('WWW-Authenticate', 'Basic realm="sassy-auth"')` before throwing.

- [ ] **Step 7: Add secret rotation to the admin API**

In `apps/auth-server/src/apps/apps.service.ts`:

```typescript
  /**
   * Generates a new client secret, returning the plaintext exactly once. The
   * stored hash is replaced immediately; there is no dual-secret grace window.
   */
  async rotateClientSecret(callerBaId: string, publicId: string): Promise<{ clientSecret: string }> {
    await this.assertCallerCanManageApps(callerBaId);
    const existing = await prisma.saApp.findUnique({ where: { publicId } });
    if (!existing) throw new NotFoundException(TokenErrorCode.APP_NOT_FOUND);

    const clientSecret = crypto.randomBytes(32).toString('base64url');
    await prisma.saApp.update({
      where: { publicId },
      data: { clientSecretHash: await hashPassword(clientSecret), clientSecretUpdatedAt: new Date() },
    });
    this.logger.getWinstonLogger().info('Client secret rotated', { context: 'AppsService', appId: publicId });
    return { clientSecret };
  }
```

Expose it as `POST /api/apps/:publicId/client-secret` on `AppsController`, guarded like the other mutating app routes. In `app-edit-drawer.tsx`, add a "Generate client secret" button that calls it, displays the returned value once in a copyable field with a "this will not be shown again" warning, and afterwards shows only `clientSecretUpdatedAt`.

Use the same `assertCallerCanManageApps` guard the existing `updateApp` uses — copy its exact call, do not invent a new authorization check.

- [ ] **Step 8: Run the suites**

Run: `pnpm --filter @sassy-auth/auth-server test && pnpm --filter @sassy-auth/admin test -- app-edit-drawer`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/auth-server/src/token/client-auth.ts apps/auth-server/src/token/client-auth.spec.ts \
        apps/auth-server/src/token/token.controller.ts apps/auth-server/src/token/token.controller.spec.ts \
        apps/auth-server/src/token/dto apps/auth-server/src/apps apps/admin/components
git commit -m "feat(oidc): support confidential clients

Client type is derived from the presence of a secret hash. PKCE stays
mandatory for public clients; a challenge-less code is only exchangeable by
an authenticated client, enforced at /authorize and /token independently."
```

---

### Task 10: prompt, max_age, and error redirects to the client

**Files:**
- Modify: `apps/auth-server/src/token/token.controller.ts`
- Modify: `apps/auth-server/src/token/oauth-error-redirect.ts`
- Test: `apps/auth-server/src/token/oauth-error-redirect.spec.ts`, `apps/auth-server/src/token/token.controller.spec.ts`

**Interfaces:**
- Produces: `buildClientErrorRedirectUrl(redirectUri: string, error: string, description: string, state: string): string`.

- [ ] **Step 1: Write the failing tests**

Add to `apps/auth-server/src/token/oauth-error-redirect.spec.ts`:

```typescript
describe('buildClientErrorRedirectUrl', () => {
  it('appends the OAuth error parameters to the client redirect URI', () => {
    const url = buildClientErrorRedirectUrl(
      'https://app.example.com/cb', 'login_required', 'No active session', 'xyz',
    );
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://app.example.com/cb');
    expect(parsed.searchParams.get('error')).toBe('login_required');
    expect(parsed.searchParams.get('error_description')).toBe('No active session');
    expect(parsed.searchParams.get('state')).toBe('xyz');
  });

  it('preserves an existing query string on the redirect URI', () => {
    const url = buildClientErrorRedirectUrl(
      'https://app.example.com/cb?tenant=acme', 'access_denied', 'Denied', '',
    );
    const parsed = new URL(url);
    expect(parsed.searchParams.get('tenant')).toBe('acme');
    expect(parsed.searchParams.get('error')).toBe('access_denied');
  });

  it('omits state when the client did not send one', () => {
    const url = buildClientErrorRedirectUrl('https://app.example.com/cb', 'access_denied', 'Denied', '');
    expect(new URL(url).searchParams.has('state')).toBe(false);
  });
});
```

Add to `apps/auth-server/src/token/token.controller.spec.ts`:

```typescript
describe('prompt and max_age', () => {
  it('returns login_required to the client for prompt=none with no session', async () => {
    mockPrisma.saApp.findUnique.mockResolvedValue({
      id: 7, publicId: 'a_7', url: 'https://app.example.com',
      clientSecretHash: null, redirectUris: [],
    });
    mockAuth.api.getSession.mockResolvedValue(null);

    const res = await request(app.getHttpServer())
      .get('/api/token/oauth/authorize')
      .query({
        client_id: 'a_7', redirect_uri: 'https://app.example.com/cb',
        code_challenge: 'c', code_challenge_method: 'S256',
        scope: 'openid', prompt: 'none', state: 'xyz',
      });

    expect(res.status).toBe(302);
    const target = new URL(res.headers.location);
    expect(target.origin + target.pathname).toBe('https://app.example.com/cb');
    expect(target.searchParams.get('error')).toBe('login_required');
    expect(target.searchParams.get('state')).toBe('xyz');
  });

  it('bounces to the login page when max_age is exceeded', async () => {
    mockPrisma.saApp.findUnique.mockResolvedValue({
      id: 7, publicId: 'a_7', url: 'https://app.example.com',
      clientSecretHash: null, redirectUris: [],
    });
    mockAuth.api.getSession.mockResolvedValue({
      user: { id: 'ba_1', twoFactorEnabled: true },
      session: { createdAt: new Date(Date.now() - 7200_000) },
    });

    const res = await request(app.getHttpServer())
      .get('/api/token/oauth/authorize')
      .query({
        client_id: 'a_7', redirect_uri: 'https://app.example.com/cb',
        code_challenge: 'c', code_challenge_method: 'S256',
        scope: 'openid', max_age: '3600',
      });

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/login');
  });

  it('sends an invalid redirect_uri to the admin error page, never a redirect', async () => {
    mockPrisma.saApp.findUnique.mockResolvedValue({
      id: 7, publicId: 'a_7', url: 'https://app.example.com',
      clientSecretHash: null,
      redirectUris: [{ uri: 'https://app.example.com/cb', kind: 'login' }],
    });

    const res = await request(app.getHttpServer())
      .get('/api/token/oauth/authorize')
      .query({
        client_id: 'a_7', redirect_uri: 'https://evil.example.com/cb',
        code_challenge: 'c', code_challenge_method: 'S256', scope: 'openid',
      });

    expect(res.headers.location).not.toContain('evil.example.com');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @sassy-auth/auth-server test -- oauth-error-redirect.spec token.controller.spec`
Expected: FAIL — `buildClientErrorRedirectUrl` not exported; `prompt`/`max_age` ignored.

- [ ] **Step 3: Implement the error builder**

Add to `apps/auth-server/src/token/oauth-error-redirect.ts`:

```typescript
/**
 * Builds the OAuth error redirect back to a client. Only ever called with a
 * `redirect_uri` that has already passed assertRedirectUriAllowed — redirecting
 * to an unvalidated URI is the open redirect that validation prevents.
 */
export function buildClientErrorRedirectUrl(
  redirectUri: string,
  error: string,
  description: string,
  state: string,
): string {
  const url = new URL(redirectUri);
  url.searchParams.set('error', error);
  url.searchParams.set('error_description', description);
  if (state) url.searchParams.set('state', state);
  return url.toString();
}
```

- [ ] **Step 4: Implement prompt and max_age**

In `oauthAuthorize`, accept the parameters:

```typescript
    @Query('prompt') prompt: string = '',
    @Query('max_age') maxAge: string = '',
```

Track whether the redirect URI validated, so the catch block knows where errors may go:

```typescript
      let redirectUriValidated = false;
      // ... after assertRedirectUriAllowed succeeds:
      redirectUriValidated = true;
```

Replace the session check with the prompt/max_age logic:

```typescript
      const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });

      const promptValues = new Set(prompt.split(/\s+/).filter(Boolean));
      const sessionAge = session?.session?.createdAt
        ? (Date.now() - new Date(session.session.createdAt).getTime()) / 1000
        : Infinity;
      const maxAgeSeconds = maxAge ? Number(maxAge) : null;
      const staleForMaxAge =
        maxAgeSeconds !== null && Number.isFinite(maxAgeSeconds) && sessionAge > maxAgeSeconds;

      const mustReauthenticate = !session || promptValues.has('login') || staleForMaxAge;

      if (mustReauthenticate) {
        // prompt=none forbids any interaction: report back rather than bounce.
        if (promptValues.has('none')) {
          return {
            url: buildClientErrorRedirectUrl(
              redirectUri, 'login_required', 'No active session satisfying the request', state,
            ),
            statusCode: 302,
          };
        }
        const adminUrl = process.env.ADMIN_URL;
        if (!adminUrl) throw new UnauthorizedException();
        const query = new URLSearchParams({
          client_id: clientId, redirect_uri: redirectUri, scope, ...(nonce ? { nonce } : {}),
          ...(codeChallenge ? { code_challenge: codeChallenge, code_challenge_method: 'S256' } : {}),
        });
        if (state) query.set('state', state);
        const nextPath = `${OAUTH_AUTHORIZE_ROUTE}?${query.toString()}`;
        return {
          url: `${adminUrl.replace(/\/$/, '')}/login?next=${encodeURIComponent(nextPath)}`,
          statusCode: 302,
        };
      }
```

Note the re-auth bounce deliberately drops `prompt` and `max_age` from `next`: carrying `prompt=login` would loop forever, and the fresh session satisfies `max_age` by construction.

- [ ] **Step 5: Route errors to the client when possible**

In the `catch` block of `oauthAuthorize`, prefer the client redirect once the URI is trusted:

```typescript
    } catch (err) {
      const code = extractTokenErrorCode(err);
      if (redirectUriValidated) {
        const oauthError =
          code === TokenErrorCode.USER_ORG_MISMATCH || code === TokenErrorCode.USER_NOT_FOUND
            ? 'access_denied'
            : 'invalid_request';
        return {
          url: buildClientErrorRedirectUrl(redirectUri, oauthError, code, state),
          statusCode: 302,
        };
      }
      const adminUrl = process.env.ADMIN_URL ?? '';
      return { url: buildOauthErrorRedirectUrl(adminUrl, code, clientId), statusCode: 302 };
    }
```

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @sassy-auth/auth-server test -- oauth-error-redirect.spec token.controller.spec`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/auth-server/src/token/oauth-error-redirect.ts \
        apps/auth-server/src/token/oauth-error-redirect.spec.ts \
        apps/auth-server/src/token/token.controller.ts \
        apps/auth-server/src/token/token.controller.spec.ts
git commit -m "feat(oidc): support prompt and max_age, return errors to the client

Authorize failures now redirect to the client once redirect_uri has been
validated, so OIDC libraries see the error instead of hanging on a callback
that never fires. Unvalidated URIs still route to the admin error page."
```

---

### Task 11: RP-initiated logout

**Files:**
- Modify: `apps/auth-server/src/token/token.controller.ts`
- Create: `apps/admin/app/logged-out/page.tsx`
- Test: `apps/auth-server/src/token/token.controller.spec.ts`

**Interfaces:**
- Consumes: `assertPostLogoutRedirectUriAllowed` (Task 3), `OAUTH_LOGOUT_ROUTE` (Task 5).

- [ ] **Step 1: Write the failing tests**

Add to `apps/auth-server/src/token/token.controller.spec.ts`:

```typescript
describe('GET /api/token/oauth/logout', () => {
  it('terminates the session and redirects to a registered post_logout URI', async () => {
    const idToken = signTestIdToken({ sub: 'u_1', aud: 'a_7' });
    mockPrisma.saApp.findUnique.mockResolvedValue({
      id: 7, publicId: 'a_7', url: 'https://app.example.com',
      redirectUris: [{ uri: 'https://app.example.com/bye', kind: 'post_logout' }],
    });

    const res = await request(app.getHttpServer())
      .get('/api/token/oauth/logout')
      .query({
        id_token_hint: idToken,
        post_logout_redirect_uri: 'https://app.example.com/bye',
        state: 'xyz',
      });

    expect(mockAuth.api.signOut).toHaveBeenCalled();
    expect(res.status).toBe(302);
    const target = new URL(res.headers.location);
    expect(target.origin + target.pathname).toBe('https://app.example.com/bye');
    expect(target.searchParams.get('state')).toBe('xyz');
  });

  it('refuses to redirect to an unregistered post_logout URI but still signs out', async () => {
    const idToken = signTestIdToken({ sub: 'u_1', aud: 'a_7' });
    mockPrisma.saApp.findUnique.mockResolvedValue({
      id: 7, publicId: 'a_7', url: 'https://app.example.com', redirectUris: [],
    });

    const res = await request(app.getHttpServer())
      .get('/api/token/oauth/logout')
      .query({ id_token_hint: idToken, post_logout_redirect_uri: 'https://evil.example.com/bye' });

    expect(mockAuth.api.signOut).toHaveBeenCalled();
    expect(res.headers.location).not.toContain('evil.example.com');
    expect(res.headers.location).toContain('/logged-out');
  });

  it('signs out and shows the logged-out page with no id_token_hint', async () => {
    const res = await request(app.getHttpServer()).get('/api/token/oauth/logout');

    expect(mockAuth.api.signOut).toHaveBeenCalled();
    expect(res.headers.location).toContain('/logged-out');
  });

  it('ignores an id_token_hint with a bad signature', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/token/oauth/logout')
      .query({ id_token_hint: 'not.a.token', post_logout_redirect_uri: 'https://app.example.com/bye' });

    expect(res.headers.location).toContain('/logged-out');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @sassy-auth/auth-server test -- token.controller.spec`
Expected: FAIL — 404 on the route.

- [ ] **Step 3: Implement**

Add to `apps/auth-server/src/token/token.controller.ts`:

```typescript
  /**
   * GET /api/token/oauth/logout — OIDC RP-Initiated Logout.
   *
   * Always terminates the SassyAuth session. Only redirects when the hint
   * identifies a client that has registered the requested URI: an unvalidated
   * post-logout redirect is an open redirect by another name.
   */
  @Get(OAUTH_LOGOUT_ROUTE)
  @Redirect()
  async oauthLogout(
    @Query('id_token_hint') idTokenHint: string = '',
    @Query('post_logout_redirect_uri') postLogoutRedirectUri: string = '',
    @Query('state') state: string = '',
    @Req() req: Request,
  ) {
    // Terminate first, unconditionally. A failure to validate the hint must
    // never leave the user still signed in.
    try {
      await auth.api.signOut({ headers: fromNodeHeaders(req.headers) });
    } catch {
      // Already signed out, or no session — logout is idempotent.
    }

    const adminUrl = (process.env.ADMIN_URL ?? '').replace(/\/$/, '');
    const loggedOut = `${adminUrl}/logged-out`;

    if (!idTokenHint || !postLogoutRedirectUri) {
      return { url: loggedOut, statusCode: 302 };
    }

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

    try {
      assertPostLogoutRedirectUriAllowed(postLogoutRedirectUri, app);
    } catch {
      this.logger.getWinstonLogger().warn('oauth.post_logout_redirect_uri.rejected', {
        context: 'TokenController', appId: audience,
      });
      return { url: loggedOut, statusCode: 302 };
    }

    const target = new URL(postLogoutRedirectUri);
    if (state) target.searchParams.set('state', state);
    return { url: target.toString(), statusCode: 302 };
  }
```

- [ ] **Step 4: Create the logged-out page**

Create `apps/admin/app/logged-out/page.tsx`:

```tsx
export default function LoggedOutPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-2xl font-semibold">You have been signed out</h1>
      <p className="text-muted-foreground">You can close this window or sign in again.</p>
      <a href="/login" className="underline">Sign in</a>
    </main>
  );
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @sassy-auth/auth-server test -- token.controller.spec`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/auth-server/src/token/token.controller.ts \
        apps/auth-server/src/token/token.controller.spec.ts \
        apps/admin/app/logged-out/page.tsx
git commit -m "feat(oidc): add RP-initiated logout

Always terminates the session; redirects only to a post_logout_redirect_uri
registered by the client the id_token_hint identifies."
```

---

### Task 12: The openid-client end-to-end proof

This is the acceptance criterion. If it needs a SassyAuth-specific workaround, the project has not met its goal.

**Files:**
- Create: `apps/admin-e2e/tests/oidc-round-trip.spec.ts`
- Modify: `apps/admin-e2e/package.json` (add `openid-client`)

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Add the dependency**

Run: `pnpm --filter @sassy-auth/admin-e2e add -D openid-client`

- [ ] **Step 2: Write the failing test**

Create `apps/admin-e2e/tests/oidc-round-trip.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';
import * as client from 'openid-client';
import { loginAsSeedAdmin } from '../lib/admins';

const AUTH_SERVER = process.env.AUTH_SERVER_URL ?? 'http://localhost:3000';

test('a stock openid-client completes the full OIDC round trip', async ({ page, request }) => {
  // Discovery — no hand-written endpoint URLs anywhere in this test.
  const config = await client.discovery(new URL(AUTH_SERVER), process.env.E2E_OIDC_CLIENT_ID!, {
    client_secret: process.env.E2E_OIDC_CLIENT_SECRET!,
  });

  const codeVerifier = client.randomPKCECodeVerifier();
  const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
  const nonce = client.randomNonce();
  const redirectUri = 'http://localhost:3002/callback';

  const authUrl = client.buildAuthorizationUrl(config, {
    redirect_uri: redirectUri,
    scope: 'openid profile email',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    nonce,
  });

  await loginAsSeedAdmin(page);
  await page.goto(authUrl.href);
  await page.waitForURL(/\/callback\?/);

  // Exchange — openid-client validates iss, aud, exp, nonce, and at_hash itself.
  const tokens = await client.authorizationCodeGrant(
    config,
    new URL(page.url()),
    { pkceCodeVerifier: codeVerifier, expectedNonce: nonce },
  );

  expect(tokens.id_token).toBeTruthy();
  const claims = tokens.claims()!;
  expect(claims.sub).toBeTruthy();
  expect(claims.aud).toBe(process.env.E2E_OIDC_CLIENT_ID);
  expect(claims.org).toBeTruthy();

  const userinfo = await client.fetchUserInfo(config, tokens.access_token, claims.sub);
  expect(userinfo.sub).toBe(claims.sub);
  expect(userinfo.email).toBeTruthy();
  expect(userinfo.name).toBeTruthy();

  // The access token carries granted scopes and audience-filtered permissions.
  const decoded = JSON.parse(
    Buffer.from(tokens.access_token.split('.')[1], 'base64url').toString('utf-8'),
  );
  expect(decoded.scope).toBe('openid profile email');
  expect(Array.isArray(decoded.permissions)).toBe(true);

  // Logout.
  const logoutUrl = client.buildEndSessionUrl(config, {
    id_token_hint: tokens.id_token!,
    post_logout_redirect_uri: 'http://localhost:3002/bye',
  });
  const logoutResponse = await request.get(logoutUrl.href, { maxRedirects: 0 });
  expect(logoutResponse.headers()['location']).toContain('http://localhost:3002/bye');
});
```

- [ ] **Step 3: Seed the OIDC test client**

In `apps/auth-server/src/seed/seed.ts`, behind the existing demo-seed flag pattern, create an app named `E2E OIDC Client` with `url: 'http://localhost:3002'`, registered login URI `http://localhost:3002/callback`, registered post_logout URI `http://localhost:3002/bye`, and a client secret hashed from a fixed dev value. Export the resulting `publicId` and secret to the Playwright environment as `E2E_OIDC_CLIENT_ID` and `E2E_OIDC_CLIENT_SECRET` via `apps/admin-e2e/playwright.config.ts`, following how existing seeded values reach the specs in `apps/admin-e2e/lib/admins.ts`.

- [ ] **Step 4: Run the round trip**

Run: `pnpm --filter @sassy-auth/admin-e2e test:e2e -- oidc-round-trip`
Expected: PASS, with **no `openid-client` option set to work around SassyAuth behaviour**. If any is needed, fix the server, not the test.

Other e2e specs may be red from concurrent work by another agent — do not fix them here, and do not treat them as a signal about this task.

- [ ] **Step 5: Commit**

```bash
git add apps/admin-e2e apps/auth-server/src/seed/seed.ts
git commit -m "test(e2e): prove the OIDC round trip with a stock openid-client

Discovery, authorize, exchange, id_token validation, userinfo, and logout,
with no SassyAuth-specific client configuration."
```

---

### Task 13: Documentation

**Files:**
- Modify: `README.md`
- Modify: `apps/resource-server-fastapi/app/` (scope gate), `apps/resource-server-fastapi/README.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Update the FastAPI sample to the new claim shape**

The sample currently gates on the `scope` claim. Change its check to read the `permissions` array:

```python
# The `scope` claim carries granted OIDC scopes; effective permissions live in
# their own array claim, filtered to this token's audience.
permissions = set(decoded.get("permissions", []))
if "rs.properties.read" not in permissions:
    raise HTTPException(status_code=403, detail="insufficient_permission")
```

- [ ] **Step 2: Run the sample's tests**

Run the sample's test command as documented in `apps/resource-server-fastapi/README.md`.
Expected: PASS.

- [ ] **Step 3: Update README**

Anchor every edit on headings and quoted text, never line numbers — another agent is editing this file.

- Under **"What SassyAuth is not"**, replace the bullet beginning *"Not a certified OpenID Connect provider"* with:

  > - **Implements OpenID Connect Core 1.0, but is not certified.** Discovery, `id_token`, `/userinfo`, and RP-initiated logout are supported, and standard OIDC client libraries work without SassyAuth-specific configuration. It has not been run against the OpenID Foundation conformance suite and is not certified.

- In the same section, keep the refresh-token bullet as-is — refresh remains unsupported.
- In the JWT claim table, replace the `scope` row and add a `permissions` row:

  | `scope` | Space-separated OIDC scopes granted for this token (`openid profile email`) |
  | `permissions` | Array of effective permission names, filtered to the token's audience app |

- Replace the verification example's `decoded.scope` parsing with `decoded.permissions`.
- Delete the `scope` claim entry from **Known Limitations** — bug-0157 is fixed.
- Update the *"`redirect_uri` validation granularity"* limitation: multiple redirect URIs per app are now supported; the same-origin fallback remains for apps with none registered.
- Add a short **OpenID Connect** section documenting the discovery URL, supported scopes, and the confidential/public client distinction.

- [ ] **Step 4: Update CHANGELOG.md**

Add an entry under Unreleased noting the breaking claim-shape change (`scope` → `permissions`), the OIDC surface, confidential clients, multiple redirect URIs, and RP-initiated logout, with an explicit upgrade note for resource servers reading `scope`.

- [ ] **Step 5: Verify no forbidden wording**

Run: `grep -rniE "oidc.compliant|openid.connect.compliant|oidc.certified" README.md CHANGELOG.md docs/`
Expected: no matches. If any appear, replace with the approved wording from Global Constraints.

- [ ] **Step 6: Commit**

```bash
git add README.md CHANGELOG.md apps/resource-server-fastapi
git commit -m "docs: document the OIDC surface and the breaking claim-shape change

States plainly that SassyAuth implements OpenID Connect Core 1.0 and is
neither certified nor conformance-tested."
```

---

## Self-Review

**Spec coverage.** Every spec section maps to a task: §1 surface → Tasks 5, 8, 9, 11; §2 data model → Tasks 2, 3, 4, 9; §3 claims → Tasks 1, 7, 8; §4 flows → Tasks 6, 9, 10, 11; §5 testing → distributed through every task plus Task 12; positioning → Task 13. The non-goals (refresh, back-channel logout, introspection, hybrid) appear only as things Task 5 must *not* advertise.

**Type consistency.** `issueJwt` takes `{ saUserId, userPublicId, orgPublicId, appPublicId, appId, scope, amr? }` in Tasks 1 and 7. `resolvePermissions(saUserId, audienceAppId)` in Task 1, called only from `issueJwt`. `exchangeCode` returns `{ userId, appPublicId, amr, nonce, scope, authTime, hadChallenge }` in Task 6 and is consumed with those exact names in Tasks 7 and 9. `buildScopedClaims(saUserId, scope)` is defined in Task 7 and consumed in Task 8. `RedirectUriApp.redirectUris` is `Array<{ uri, kind }>` in Task 3 and matches the Prisma model in Task 2.

**Known follow-ons, deliberately out of scope.** `verifyAccessToken` is reused in Task 11 to validate an `id_token_hint`; both are RS256 tokens from the same key with the same issuer, so this is sound, but if access tokens and ID tokens ever diverge in signing key or issuer, Task 11 needs its own verifier. Recorded here rather than pre-solved.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-21-oidc-compatibility.md`.
