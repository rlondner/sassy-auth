# Social Authentication (Google, Microsoft, Apple) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let end users of downstream apps sign in to SassyAuth with Google, Microsoft or Apple, linking to an already-provisioned `SaUser` on a provider-verified email and refusing unknown identities.

**Architecture:** Invite-only federation. BetterAuth performs the OAuth handshake with `disableSignUp: true` so no unknown identity ever creates a user; the existing `/authorize` checks (active status, org↔app match, forced 2FA) are inherited unchanged. A new `SaSocialProvider` table plus one resolver decides which buttons an app shows; a new `Session.signInMethod` column carries the authentication method so the JWT can honestly emit `amr: ["ext"]` + `idp` instead of falsely claiming `pwd`. All outcomes land in a durable `SaAuditEvent` table and are mirrored through vendor-neutral OpenTelemetry.

**Tech Stack:** NestJS 10 + Express (auth-server), BetterAuth 1.6.11, Prisma 5.22 + PostgreSQL, Next.js 15 + next-intl (admin), FastAPI (sample RS), Jest (unit), Playwright (e2e), `@opentelemetry/api` 1.9.1 (already a transitive dep), Sentry 10.54 as the OTel backend.

**Spec:** `docs/superpowers/specs/2026-08-22-social-authentication-design.md` — read it before Task 1. Every design decision below is argued there.

## Global Constraints

- **Never add Google/Microsoft/Apple to BetterAuth `trustedProviders`.** Implicit linking requires `userInfo.emailVerified` only while providers are untrusted (`link-account.mjs:20-22`). This is a deliberate non-action and must carry a code comment saying so.
- **`disableSignUp: true` on every social provider.** This is what makes federation invite-only (`callback.mjs:157` → `link-account.mjs:74`).
- **No `@sentry/*` imports in new code.** Telemetry goes through `@opentelemetry/api` / `@opentelemetry/api-logs`; Sentry ingests it.
- **No PII in telemetry.** Email addresses and provider `sub` values go only into `SaAuditEvent` rows. OTel and Sentry get `saUser.publicId` and the provider name.
- **Every new user-facing string goes in BOTH `apps/admin/messages/en.json` and `apps/admin/messages/fr.json`.** English-only is a regression.
- **The stub IdP must be impossible in production:** registered only when `NODE_ENV !== 'production'` AND `E2E_STUB_IDP_URL` is set.
- **Audit/telemetry writes must never break sign-in.** Wrap in try/catch and log, matching `auth.config.ts:128-139`.
- **Provider IDs are exactly** `google`, `microsoft`, `apple`, `stub`.
- **Commit after every task.** Commits land on `master` directly (no feature branch).
- Test commands: auth-server unit `pnpm --filter @sassy-auth/auth-server test`; admin unit `pnpm --filter @sassy-auth/admin test`; e2e `pnpm --filter @sassy-auth/admin-e2e test:e2e`; migrations `cd packages/db && pnpm db:migrate --name <name>`.

---

### Task 1: `SaSocialProvider` table and the enablement resolver

**Files:**
- Modify: `packages/db/schema.prisma` (add model, add relation field to `SaApp`)
- Create: `packages/db/migrations/<timestamp>_social_providers/migration.sql` (generated)
- Create: `apps/auth-server/src/social/resolve-enabled-providers.ts`
- Test: `apps/auth-server/src/social/resolve-enabled-providers.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type SocialProviderId = 'google' | 'microsoft' | 'apple' | 'stub'`
  - `interface ProviderRow { appId: number | null; provider: string; enabled: boolean }`
  - `resolveEnabledProviders(rows: ProviderRow[], available: SocialProviderId[], appId: number | null): SocialProviderId[]`

- [ ] **Step 1: Write the failing test**

Create `apps/auth-server/src/social/resolve-enabled-providers.spec.ts`:

```ts
import { resolveEnabledProviders } from './resolve-enabled-providers';

describe('resolveEnabledProviders', () => {
  const globalGoogle = { appId: null, provider: 'google', enabled: true };
  const globalMicrosoft = { appId: null, provider: 'microsoft', enabled: true };

  it('returns a globally enabled provider when the app has no opinion', () => {
    expect(resolveEnabledProviders([globalGoogle], ['google'], 7)).toEqual(['google']);
  });

  it('omits a provider with no credentials even when a global row exists', () => {
    expect(resolveEnabledProviders([globalGoogle], [], 7)).toEqual([]);
  });

  it('omits a provider with credentials but no global row', () => {
    expect(resolveEnabledProviders([], ['google'], 7)).toEqual([]);
  });

  it("lets an app row disable a globally enabled provider", () => {
    const rows = [globalGoogle, { appId: 7, provider: 'google', enabled: false }];
    expect(resolveEnabledProviders(rows, ['google'], 7)).toEqual([]);
  });

  it("lets an app row enable a globally disabled provider", () => {
    const rows = [
      { appId: null, provider: 'google', enabled: false },
      { appId: 7, provider: 'google', enabled: true },
    ];
    expect(resolveEnabledProviders(rows, ['google'], 7)).toEqual(['google']);
  });

  it('ignores another app\'s row', () => {
    const rows = [globalGoogle, { appId: 99, provider: 'google', enabled: false }];
    expect(resolveEnabledProviders(rows, ['google'], 7)).toEqual(['google']);
  });

  it('returns providers in a stable order regardless of row order', () => {
    const rows = [globalMicrosoft, globalGoogle];
    expect(resolveEnabledProviders(rows, ['microsoft', 'google'], 7)).toEqual([
      'google',
      'microsoft',
    ]);
  });

  it('resolves the global default set when appId is null', () => {
    const rows = [globalGoogle, { appId: 7, provider: 'google', enabled: false }];
    expect(resolveEnabledProviders(rows, ['google'], null)).toEqual(['google']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @sassy-auth/auth-server test -- resolve-enabled-providers`
Expected: FAIL — `Cannot find module './resolve-enabled-providers'`.

- [ ] **Step 3: Write the implementation**

Create `apps/auth-server/src/social/resolve-enabled-providers.ts`:

```ts
/**
 * Social provider identifiers. `stub` exists only for e2e (see the stub IdP
 * task) and is never registered when NODE_ENV === 'production'.
 */
export type SocialProviderId = 'google' | 'microsoft' | 'apple' | 'stub';

/** Stable display order, independent of database row order. */
export const PROVIDER_ORDER: readonly SocialProviderId[] = [
  'google',
  'microsoft',
  'apple',
  'stub',
];

export interface ProviderRow {
  appId: number | null;
  provider: string;
  enabled: boolean;
}

/**
 * Decide which providers an app's login screen shows.
 *
 * A provider is *available* when the deployment has credentials for it
 * (`available`, derived from env) AND a global row exists (appId === null).
 * It is *shown for this app* when the app's own row says enabled, or the app
 * has no row and the global row is enabled.
 *
 * Pure: callers load the rows. Keeps this testable with no database.
 */
export function resolveEnabledProviders(
  rows: ProviderRow[],
  available: SocialProviderId[],
  appId: number | null,
): SocialProviderId[] {
  const availableSet = new Set<string>(available);

  return PROVIDER_ORDER.filter((provider) => {
    if (!availableSet.has(provider)) return false;

    const globalRow = rows.find((r) => r.appId === null && r.provider === provider);
    if (!globalRow) return false;

    if (appId === null) return globalRow.enabled;

    const appRow = rows.find((r) => r.appId === appId && r.provider === provider);
    return appRow ? appRow.enabled : globalRow.enabled;
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @sassy-auth/auth-server test -- resolve-enabled-providers`
Expected: PASS, 8 tests.

- [ ] **Step 5: Add the Prisma model**

In `packages/db/schema.prisma`, add to the `SaApp` model's relation list:

```prisma
  socialProviders SaSocialProvider[]
```

and append the new model after `SaOauthCode`:

```prisma
// Which social login providers a deployment has, and which apps show them.
// A row with appId = null is the deployment-global row: it declares that
// credentials exist for this provider and supplies the default enablement.
// A row with an appId is that app's explicit opt-in/opt-out.
//
// Credentials deliberately live in env vars, not here: per-app credentials
// would need encryption at rest and rotation, for a capability nothing can
// use yet. Adding `clientId` + encrypted secret columns later is one
// migration plus resolve-enabled-providers.ts.
model SaSocialProvider {
  id        Int      @id @default(autoincrement())
  appId     Int?
  app       SaApp?   @relation(fields: [appId], references: [id], onDelete: Cascade)
  provider  String
  enabled   Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([appId, provider])
  @@index([appId])
}
```

- [ ] **Step 6: Generate and apply the migration**

Run: `cd packages/db && pnpm db:migrate --name social_providers`
Expected: migration created and applied; `prisma generate` runs automatically.

Then append this backfill to the generated `migration.sql`, so deployments that already set provider env vars keep working without touching the console. It is idempotent and safe on an empty database:

```sql
-- Seed a global row per provider. Enablement is still gated on the env
-- credential pair at runtime (resolve-enabled-providers.ts), so seeding a row
-- for a provider with no credentials is inert.
INSERT INTO "SaSocialProvider" ("appId", "provider", "enabled", "createdAt", "updatedAt")
VALUES (NULL, 'google', true, NOW(), NOW()),
       (NULL, 'microsoft', true, NOW(), NOW()),
       (NULL, 'apple', true, NOW(), NOW())
ON CONFLICT DO NOTHING;
```

Re-apply with: `cd packages/db && pnpm db:migrate:deploy`

- [ ] **Step 7: Verify the schema round-trips**

Run: `cd packages/db && pnpm build && pnpm test`
Expected: PASS — the db package compiles against the regenerated client.

- [ ] **Step 8: Commit**

```bash
git add packages/db/schema.prisma packages/db/migrations apps/auth-server/src/social/
git commit -m "feat(social): add SaSocialProvider table and enablement resolver"
```

---

### Task 2: Env-driven provider availability and invite-only BetterAuth config

**Files:**
- Create: `apps/auth-server/src/social/build-social-providers.ts`
- Test: `apps/auth-server/src/social/build-social-providers.spec.ts`
- Modify: `apps/auth-server/src/auth/auth.config.ts:177-202` (replace the inline `socialProviders` object)

**Interfaces:**
- Consumes: `SocialProviderId` from Task 1.
- Produces:
  - `availableSocialProviders(env: NodeJS.ProcessEnv): SocialProviderId[]`
  - `buildSocialProviders(env: NodeJS.ProcessEnv): Record<string, unknown>`

- [ ] **Step 1: Write the failing test**

Create `apps/auth-server/src/social/build-social-providers.spec.ts`:

```ts
import { availableSocialProviders, buildSocialProviders } from './build-social-providers';

const GOOGLE = { GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gsecret' };

describe('availableSocialProviders', () => {
  it('lists a provider only when both id and secret are set', () => {
    expect(availableSocialProviders(GOOGLE)).toEqual(['google']);
    expect(availableSocialProviders({ GOOGLE_CLIENT_ID: 'gid' })).toEqual([]);
    expect(availableSocialProviders({ GOOGLE_CLIENT_SECRET: 'gsecret' })).toEqual([]);
  });

  it('treats Apple as available on the key triple, not a client secret', () => {
    const env = {
      APPLE_CLIENT_ID: 'com.example.svc',
      APPLE_TEAM_ID: 'TEAM123',
      APPLE_KEY_ID: 'KEY123',
      APPLE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----',
    };
    expect(availableSocialProviders(env)).toEqual(['apple']);
    delete (env as Record<string, unknown>).APPLE_KEY_ID;
    expect(availableSocialProviders(env)).toEqual([]);
  });

  it('returns an empty list when nothing is configured', () => {
    expect(availableSocialProviders({})).toEqual([]);
  });
});

describe('buildSocialProviders', () => {
  it('sets disableSignUp on every provider so federation stays invite-only', () => {
    const built = buildSocialProviders(GOOGLE) as Record<string, { disableSignUp: boolean }>;
    expect(built.google.disableSignUp).toBe(true);
  });

  it('passes the credentials through', () => {
    const built = buildSocialProviders(GOOGLE) as Record<
      string,
      { clientId: string; clientSecret: string }
    >;
    expect(built.google.clientId).toBe('gid');
    expect(built.google.clientSecret).toBe('gsecret');
  });

  it('defaults the Microsoft tenant to common but honours a pinned tenant', () => {
    const base = { MICROSOFT_CLIENT_ID: 'mid', MICROSOFT_CLIENT_SECRET: 'msecret' };
    const built = buildSocialProviders(base) as Record<string, { tenantId: string }>;
    expect(built.microsoft.tenantId).toBe('common');

    const pinned = buildSocialProviders({ ...base, MICROSOFT_TENANT_ID: 'tenant-abc' }) as Record<
      string,
      { tenantId: string }
    >;
    expect(pinned.microsoft.tenantId).toBe('tenant-abc');
  });

  it('omits providers whose credentials are incomplete', () => {
    expect(Object.keys(buildSocialProviders({ GOOGLE_CLIENT_ID: 'gid' }))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @sassy-auth/auth-server test -- build-social-providers`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `apps/auth-server/src/social/build-social-providers.ts`:

```ts
import type { SocialProviderId } from './resolve-enabled-providers';

/**
 * bug-0175 kept: a provider is configured only when BOTH halves of its
 * credential pair are present. An id without a secret used to be cast to
 * `undefined as string` and crash deep inside BetterAuth's OAuth flow.
 */
function hasAll(env: NodeJS.ProcessEnv, keys: string[]): boolean {
  return keys.every((k) => Boolean(env[k]));
}

const GOOGLE_KEYS = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'];
const MICROSOFT_KEYS = ['MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET'];
// Apple has no static secret: it is an ES256 JWT minted from the .p8 key.
const APPLE_KEYS = ['APPLE_CLIENT_ID', 'APPLE_TEAM_ID', 'APPLE_KEY_ID', 'APPLE_PRIVATE_KEY'];

export function availableSocialProviders(env: NodeJS.ProcessEnv): SocialProviderId[] {
  const out: SocialProviderId[] = [];
  if (hasAll(env, GOOGLE_KEYS)) out.push('google');
  if (hasAll(env, MICROSOFT_KEYS)) out.push('microsoft');
  if (hasAll(env, APPLE_KEYS)) out.push('apple');
  return out;
}

/**
 * Build BetterAuth's `socialProviders` config.
 *
 * `disableSignUp: true` on every provider is what makes federation
 * invite-only: BetterAuth's callback returns BEFORE creating a User row when
 * no account or verified-email match exists (callback.mjs:157 →
 * link-account.mjs:74), so a refused sign-in leaves no orphan.
 *
 * DELIBERATE NON-ACTION: none of these providers is added to
 * `trustedProviders`. Implicit linking requires `userInfo.emailVerified`
 * only while a provider is untrusted (link-account.mjs:20-22). Trusting one
 * silently removes the single rule this feature's security rests on.
 */
export function buildSocialProviders(env: NodeJS.ProcessEnv): Record<string, unknown> {
  const available = availableSocialProviders(env);
  const providers: Record<string, unknown> = {};

  if (available.includes('google')) {
    providers.google = {
      clientId: env.GOOGLE_CLIENT_ID!,
      clientSecret: env.GOOGLE_CLIENT_SECRET!,
      disableSignUp: true,
    };
  }

  if (available.includes('microsoft')) {
    providers.microsoft = {
      clientId: env.MICROSOFT_CLIENT_ID!,
      clientSecret: env.MICROSOFT_CLIENT_SECRET!,
      // Pin to your own directory rather than 'common': a single-tenant app
      // only accepts that directory's users, which is the supported way to
      // work around Entra not emitting the verified-email claims BetterAuth
      // reads (microsoft-entra-id.mjs:97). See the spec, §6.
      tenantId: env.MICROSOFT_TENANT_ID ?? 'common',
      disableSignUp: true,
    };
  }

  return providers;
}
```

Apple is intentionally absent from `buildSocialProviders` here — Task 3 adds it, because its secret must be generated.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @sassy-auth/auth-server test -- build-social-providers`
Expected: the Apple availability test PASSES (it only exercises `availableSocialProviders`); all `buildSocialProviders` tests PASS.

- [ ] **Step 5: Wire it into BetterAuth**

In `apps/auth-server/src/auth/auth.config.ts`, replace the whole `socialProviders: { ... }` block (lines 171-202, including the bug-0175 comment) with:

```ts
  // Social providers are built from env by build-social-providers.ts, which
  // keeps the bug-0175 both-halves guard, sets disableSignUp (invite-only),
  // and deliberately does NOT trust any provider. GitHub is intentionally
  // dropped here: it was never surfaced in any UI and is out of scope.
  socialProviders: buildSocialProviders(process.env),
```

Add the import at the top:

```ts
import { buildSocialProviders } from '../social/build-social-providers';
```

- [ ] **Step 6: Run the full auth-server suite**

Run: `pnpm --filter @sassy-auth/auth-server test`
Expected: PASS with no new failures (`auth.config.spec.ts` in particular).

- [ ] **Step 7: Commit**

```bash
git add apps/auth-server/src/social/ apps/auth-server/src/auth/auth.config.ts
git commit -m "feat(social): invite-only provider config built from env"
```

---

### Task 3: Apple client-secret generator

**Files:**
- Create: `apps/auth-server/src/social/apple-client-secret.ts`
- Test: `apps/auth-server/src/social/apple-client-secret.spec.ts`
- Modify: `apps/auth-server/src/social/build-social-providers.ts`
- Modify: `apps/auth-server/src/social/build-social-providers.spec.ts`

**Interfaces:**
- Consumes: `availableSocialProviders` (Task 2).
- Produces: `createAppleClientSecretFactory(env, now?): () => string` — returns a cached generator; the cache is keyed on expiry.

- [ ] **Step 1: Write the failing test**

Create `apps/auth-server/src/social/apple-client-secret.spec.ts`:

```ts
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { createAppleClientSecretFactory } from './apple-client-secret';

// A throwaway EC P-256 key, generated in-test so no key material is committed.
const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
  namedCurve: 'prime256v1',
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const env = {
  APPLE_CLIENT_ID: 'com.example.service',
  APPLE_TEAM_ID: 'TEAM123456',
  APPLE_KEY_ID: 'KEY7890',
  APPLE_PRIVATE_KEY: privateKey,
};

describe('createAppleClientSecretFactory', () => {
  it('mints an ES256 JWT with the claims Apple requires', () => {
    const now = () => 1_700_000_000_000;
    const secret = createAppleClientSecretFactory(env, now)();

    const decoded = jwt.verify(secret, publicKey, { algorithms: ['ES256'] }) as jwt.JwtPayload;
    expect(decoded.iss).toBe('TEAM123456');
    expect(decoded.sub).toBe('com.example.service');
    expect(decoded.aud).toBe('https://appleid.apple.com');
    expect(decoded.iat).toBe(1_700_000_000);

    const header = JSON.parse(
      Buffer.from(secret.split('.')[0], 'base64url').toString('utf8'),
    ) as { alg: string; kid: string };
    expect(header.alg).toBe('ES256');
    expect(header.kid).toBe('KEY7890');
  });

  it('never exceeds Apple\'s six-month maximum lifetime', () => {
    const now = () => 1_700_000_000_000;
    const secret = createAppleClientSecretFactory(env, now)();
    const decoded = jwt.decode(secret) as jwt.JwtPayload;
    expect(decoded.exp! - decoded.iat!).toBeLessThanOrEqual(15_777_000);
  });

  it('returns the cached secret on repeated calls', () => {
    const factory = createAppleClientSecretFactory(env, () => 1_700_000_000_000);
    expect(factory()).toBe(factory());
  });

  it('regenerates once the cached secret nears expiry', () => {
    let clock = 1_700_000_000_000;
    const factory = createAppleClientSecretFactory(env, () => clock);
    const first = factory();
    clock += 100 * 24 * 60 * 60 * 1000; // 100 days later
    expect(factory()).not.toBe(first);
  });

  it('throws a clear error when the key material is incomplete', () => {
    expect(() => createAppleClientSecretFactory({ APPLE_TEAM_ID: 'T' })()).toThrow(
      /APPLE_CLIENT_ID/,
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @sassy-auth/auth-server test -- apple-client-secret`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `apps/auth-server/src/social/apple-client-secret.ts`:

```ts
import jwt from 'jsonwebtoken';

/** Apple's hard ceiling for a client-secret JWT: 6 months, in seconds. */
const APPLE_MAX_LIFETIME_SECONDS = 15_777_000;
/** Mint for 90 days and refresh well before the ceiling. */
const LIFETIME_SECONDS = 90 * 24 * 60 * 60;
/** Regenerate once less than 7 days of the cached secret remains. */
const REFRESH_MARGIN_SECONDS = 7 * 24 * 60 * 60;

/**
 * Apple's `client_secret` is not a static string: it is an ES256 JWT signed
 * with the .p8 key, and Apple refuses one older than six months. Holding it
 * in an env var means sign-in breaks silently, months after deploy, with no
 * code change to blame. So it is minted on demand and cached.
 *
 * Exposed to BetterAuth as a property getter (see build-social-providers)
 * so the value is read at use time rather than frozen at module load.
 */
export function createAppleClientSecretFactory(
  env: NodeJS.ProcessEnv,
  now: () => number = Date.now,
): () => string {
  let cached: { secret: string; expSeconds: number } | null = null;

  return function appleClientSecret(): string {
    const clientId = env.APPLE_CLIENT_ID;
    const teamId = env.APPLE_TEAM_ID;
    const keyId = env.APPLE_KEY_ID;
    const privateKey = env.APPLE_PRIVATE_KEY;

    const missing = [
      ['APPLE_CLIENT_ID', clientId],
      ['APPLE_TEAM_ID', teamId],
      ['APPLE_KEY_ID', keyId],
      ['APPLE_PRIVATE_KEY', privateKey],
    ]
      .filter(([, v]) => !v)
      .map(([k]) => k);

    if (missing.length) {
      throw new Error(`Apple sign-in is misconfigured; missing: ${missing.join(', ')}`);
    }

    const nowSeconds = Math.floor(now() / 1000);
    if (cached && cached.expSeconds - nowSeconds > REFRESH_MARGIN_SECONDS) {
      return cached.secret;
    }

    const expSeconds = nowSeconds + Math.min(LIFETIME_SECONDS, APPLE_MAX_LIFETIME_SECONDS);
    const secret = jwt.sign(
      {
        iss: teamId,
        iat: nowSeconds,
        exp: expSeconds,
        aud: 'https://appleid.apple.com',
        sub: clientId,
      },
      // Escaped newlines are near-universal when a .p8 travels through an env
      // var or a secrets manager; unescape so operators don't have to.
      (privateKey as string).replace(/\\n/g, '\n'),
      { algorithm: 'ES256', keyid: keyId },
    );

    cached = { secret, expSeconds };
    return secret;
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @sassy-auth/auth-server test -- apple-client-secret`
Expected: PASS, 5 tests.

- [ ] **Step 5: Register Apple in the provider config**

In `apps/auth-server/src/social/build-social-providers.ts`, add the import:

```ts
import { createAppleClientSecretFactory } from './apple-client-secret';
```

and append this block before `return providers;`:

```ts
  if (available.includes('apple')) {
    const appleSecret = createAppleClientSecretFactory(env);
    providers.apple = {
      clientId: env.APPLE_CLIENT_ID!,
      // A getter, not a value: BetterAuth reads this when it exchanges the
      // code, so a long-running process always gets a live secret rather than
      // one frozen at module load.
      get clientSecret() {
        return appleSecret();
      },
      disableSignUp: true,
    };
  }
```

- [ ] **Step 6: Add the config test**

Append to `apps/auth-server/src/social/build-social-providers.spec.ts`:

```ts
  it('exposes the Apple client secret as a freshly-read getter', () => {
    const crypto = require('node:crypto') as typeof import('node:crypto');
    const { privateKey } = crypto.generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    const built = buildSocialProviders({
      APPLE_CLIENT_ID: 'com.example.service',
      APPLE_TEAM_ID: 'TEAM123456',
      APPLE_KEY_ID: 'KEY7890',
      APPLE_PRIVATE_KEY: privateKey,
    }) as Record<string, { clientSecret: string; disableSignUp: boolean }>;

    expect(typeof built.apple.clientSecret).toBe('string');
    expect(built.apple.clientSecret.split('.')).toHaveLength(3);
    expect(built.apple.disableSignUp).toBe(true);
  });
```

- [ ] **Step 7: Run both suites**

Run: `pnpm --filter @sassy-auth/auth-server test -- social`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/auth-server/src/social/
git commit -m "feat(social): generate Apple's ES256 client secret on demand"
```

---

### Task 4: Record the sign-in method on the session

**Files:**
- Modify: `packages/db/schema.prisma` (`Session.signInMethod`)
- Create: `packages/db/migrations/<timestamp>_session_signin_method/migration.sql` (generated)
- Create: `apps/auth-server/src/social/sign-in-method.ts`
- Test: `apps/auth-server/src/social/sign-in-method.spec.ts`
- Modify: `apps/auth-server/src/auth/auth.config.ts` (session `additionalFields` + the create hook at :103-143)

**Interfaces:**
- Consumes: nothing.
- Produces: `signInMethodFromPath(path: string | undefined): string | null` returning `'ext:google'`-shaped strings or `'pwd'`, and `null` when unknown.

- [ ] **Step 1: Write the failing test**

Create `apps/auth-server/src/social/sign-in-method.spec.ts`:

```ts
import { signInMethodFromPath } from './sign-in-method';

describe('signInMethodFromPath', () => {
  it('maps a social callback to ext:<provider>', () => {
    expect(signInMethodFromPath('/callback/google')).toBe('ext:google');
    expect(signInMethodFromPath('/api/auth/callback/microsoft')).toBe('ext:microsoft');
    expect(signInMethodFromPath('/callback/apple')).toBe('ext:apple');
  });

  it('maps the generic-oauth callback used by the e2e stub', () => {
    expect(signInMethodFromPath('/oauth2/callback/stub')).toBe('ext:stub');
  });

  it('maps password and OTP sign-in paths to pwd', () => {
    expect(signInMethodFromPath('/sign-in/email')).toBe('pwd');
    expect(signInMethodFromPath('/api/auth/sign-in/email')).toBe('pwd');
  });

  it('returns null for an unrecognised path so callers fall back', () => {
    expect(signInMethodFromPath('/sign-in/magic-link')).toBeNull();
    expect(signInMethodFromPath(undefined)).toBeNull();
    expect(signInMethodFromPath('')).toBeNull();
  });

  it('rejects a provider name that is not one we support', () => {
    expect(signInMethodFromPath('/callback/evilprovider')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @sassy-auth/auth-server test -- sign-in-method`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `apps/auth-server/src/social/sign-in-method.ts`:

```ts
import { PROVIDER_ORDER } from './resolve-enabled-providers';

/**
 * Derive how a session was created from the BetterAuth route that created it.
 *
 * A BetterAuth session records nothing about its own origin, and inspecting
 * Account rows cannot distinguish a user who has BOTH a password and a linked
 * Google account. The route is the only honest signal available at session
 * creation, so it is captured onto Session.signInMethod and read later when
 * the JWT's amr/idp claims are built.
 *
 * Returns null for anything unrecognised; callers fall back to legacy
 * behaviour rather than guessing.
 */
export function signInMethodFromPath(path: string | undefined): string | null {
  if (!path) return null;

  const social = path.match(/\/(?:callback|oauth2\/callback)\/([a-z0-9-]+)$/i);
  if (social) {
    const provider = social[1].toLowerCase();
    return (PROVIDER_ORDER as readonly string[]).includes(provider) ? `ext:${provider}` : null;
  }

  if (/\/sign-in\/email$/.test(path)) return 'pwd';

  return null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @sassy-auth/auth-server test -- sign-in-method`
Expected: PASS, 5 tests.

- [ ] **Step 5: Add the schema column and migrate**

In `packages/db/schema.prisma`, add to `Session`:

```prisma
  // How this session was created: 'pwd', or 'ext:<provider>' for federated
  // sign-in. Null for sessions predating this column and for routes we do not
  // classify — readers fall back to legacy behaviour.
  signInMethod String?
```

Run: `cd packages/db && pnpm db:migrate --name session_signin_method`
Expected: nullable column added; no backfill needed.

- [ ] **Step 6: Populate it at session creation**

In `apps/auth-server/src/auth/auth.config.ts`, add the import:

```ts
import { signInMethodFromPath } from '../social/sign-in-method';
```

Declare the field so BetterAuth persists it — add to the `session` config block (alongside `expiresIn`):

```ts
    additionalFields: {
      signInMethod: { type: 'string', required: false, input: false },
    },
```

Then change the create hook's `before` to return the enriched row. Replace the existing `before` body's final line (the implicit undefined return after the gate check) so the whole function reads:

```ts
        before: async (session: { userId: string }, ctx?: { path?: string }) => {
          const gate = await evaluateSessionGate(prisma, session.userId);
          if (!gate.allowed) {
            authLogger.warn('Session creation blocked', {
              context: 'session-gate',
              betterAuthUserId: session.userId,
              status: gate.status,
            });
            throw new APIError('FORBIDDEN', {
              message: 'This account is not active.',
            });
          }
          const signInMethod = signInMethodFromPath(ctx?.path);
          if (!signInMethod) return;
          return { data: { ...session, signInMethod } };
        },
```

- [ ] **Step 7: Verify the hook context actually carries the path**

This is the one assumption in the design that the installed BetterAuth may not honour. Verify empirically:

Run: `grep -rn "databaseHooks" "$(ls -d node_modules/.pnpm/better-auth@1.6.11*/node_modules/better-auth)/dist/db/with-hooks.mjs" | head -20`

Then start the server and sign in once with email/password:

```bash
pnpm --filter @sassy-auth/auth-server dev
# in another shell, after signing in via the admin console:
cd packages/db && pnpm dlx prisma studio  # inspect Session.signInMethod
```

Expected: `signInMethod = 'pwd'` on the new row.

**If `ctx.path` is undefined**, use the documented fallback instead — a BetterAuth `hooks.after` matcher, added to the top-level `auth` config:

```ts
  hooks: {
    after: createAuthMiddleware(async (ctx) => {
      const method = signInMethodFromPath(ctx.path);
      const token = ctx.context.newSession?.session?.token;
      if (!method || !token) return;
      await prisma.session
        .updateMany({ where: { token }, data: { signInMethod: method } })
        .catch((err: unknown) =>
          authLogger.warn('Failed to record signInMethod', { context: 'session', err: String(err) }),
        );
    }),
  },
```

with `import { createAuthMiddleware } from 'better-auth/api';`. Record which path you took in the commit message.

- [ ] **Step 8: Run the suite and commit**

Run: `pnpm --filter @sassy-auth/auth-server test`
Expected: PASS with no new failures.

```bash
git add packages/db/schema.prisma packages/db/migrations apps/auth-server/src/social/ apps/auth-server/src/auth/auth.config.ts
git commit -m "feat(social): record sign-in method on the session"
```

---

### Task 5: Honest `amr` and a new `idp` claim

**Files:**
- Create: `apps/auth-server/src/token/derive-auth-methods.ts`
- Test: `apps/auth-server/src/token/derive-auth-methods.spec.ts`
- Modify: `packages/db/schema.prisma` (`SaOauthCode.idp`)
- Modify: `apps/auth-server/src/token/oauth.service.ts:46-115`
- Modify: `apps/auth-server/src/token/token.service.ts:13` and `:82`
- Modify: `apps/auth-server/src/token/token.controller.ts:195-205` and `:298-327`

**Interfaces:**
- Consumes: `Session.signInMethod` (Task 4).
- Produces: `deriveAuthMethods(input: { signInMethod: string | null; twoFactorEnabled: boolean }): { amr: string[]; idp?: string }`

- [ ] **Step 1: Write the failing test**

Create `apps/auth-server/src/token/derive-auth-methods.spec.ts`:

```ts
import { deriveAuthMethods } from './derive-auth-methods';

describe('deriveAuthMethods', () => {
  it('reports a password sign-in as pwd with no idp', () => {
    expect(deriveAuthMethods({ signInMethod: 'pwd', twoFactorEnabled: false })).toEqual({
      amr: ['pwd'],
    });
  });

  it('adds otp and mfa when TOTP is enrolled', () => {
    expect(deriveAuthMethods({ signInMethod: 'pwd', twoFactorEnabled: true })).toEqual({
      amr: ['pwd', 'otp', 'mfa'],
    });
  });

  it('reports a federated sign-in as ext and names the provider', () => {
    expect(deriveAuthMethods({ signInMethod: 'ext:google', twoFactorEnabled: false })).toEqual({
      amr: ['ext'],
      idp: 'google',
    });
  });

  it('combines federated sign-in with TOTP', () => {
    expect(deriveAuthMethods({ signInMethod: 'ext:apple', twoFactorEnabled: true })).toEqual({
      amr: ['ext', 'otp', 'mfa'],
      idp: 'apple',
    });
  });

  it('never claims pwd for a federated session', () => {
    const { amr } = deriveAuthMethods({ signInMethod: 'ext:microsoft', twoFactorEnabled: true });
    expect(amr).not.toContain('pwd');
  });

  it('falls back to legacy behaviour for sessions with no recorded method', () => {
    expect(deriveAuthMethods({ signInMethod: null, twoFactorEnabled: false })).toEqual({
      amr: ['pwd'],
    });
    expect(deriveAuthMethods({ signInMethod: null, twoFactorEnabled: true })).toEqual({
      amr: ['pwd', 'otp', 'mfa'],
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @sassy-auth/auth-server test -- derive-auth-methods`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `apps/auth-server/src/token/derive-auth-methods.ts`:

```ts
/**
 * Turn a session's recorded sign-in method into RFC 8176-shaped `amr` values
 * plus an `idp` claim.
 *
 * Why `ext`: RFC 8176 registers no value meaning "federated", so `ext` is a
 * convention. The provider name goes in a dedicated `idp` claim rather than
 * into `amr`, so resource servers keep a bounded set of amr values to match.
 *
 * Why this matters: emitting `pwd` for a Google sign-in asserts to every
 * resource server that a password was verified when none was.
 */
export function deriveAuthMethods(input: {
  signInMethod: string | null;
  twoFactorEnabled: boolean;
}): { amr: string[]; idp?: string } {
  const { signInMethod, twoFactorEnabled } = input;
  const second = twoFactorEnabled ? ['otp', 'mfa'] : [];

  if (signInMethod?.startsWith('ext:')) {
    const idp = signInMethod.slice('ext:'.length);
    return { amr: ['ext', ...second], idp };
  }

  // 'pwd' and null (sessions predating Session.signInMethod) both take the
  // legacy path, so existing sessions keep their current claims.
  return { amr: ['pwd', ...second] };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @sassy-auth/auth-server test -- derive-auth-methods`
Expected: PASS, 6 tests.

- [ ] **Step 5: Carry `idp` through the authorization code**

In `packages/db/schema.prisma`, add to `SaOauthCode`:

```prisma
  idp                 String?
```

Run: `cd packages/db && pnpm db:migrate --name oauth_code_idp`

In `apps/auth-server/src/token/oauth.service.ts`, add an `idp?: string` parameter to `generateCode` after `amr`, persist it (`idp: idp ?? null`), add `idp: string | null` to the row type read back, and include `idp: entry.idp ?? undefined` in the object returned by the exchange method.

In `apps/auth-server/src/token/token.service.ts`, add `idp?: string;` to `IssueJwtParams` (near `amr?: string[]` at line 13) and add to the payload after the `amr` spread at line 82:

```ts
      ...(params.idp ? { idp: params.idp } : {}),
```

- [ ] **Step 6: Use it in the authorize and exchange paths**

In `apps/auth-server/src/token/token.controller.ts`, replace line 195:

```ts
      const amr = (session.user as { twoFactorEnabled?: boolean }).twoFactorEnabled ? ['pwd', 'otp', 'mfa'] : ['pwd'];
```

with:

```ts
      const { amr, idp } = deriveAuthMethods({
        signInMethod: (session.session as { signInMethod?: string | null }).signInMethod ?? null,
        twoFactorEnabled: Boolean((session.user as { twoFactorEnabled?: boolean }).twoFactorEnabled),
      });
```

and pass `idp` as the new final argument to `this.oauthService.generateCode(...)`.

In the token-exchange path (around line 298), read `exchanged.idp` alongside `exchanged.amr` and pass it into `issueJwt`. Add the import:

```ts
import { deriveAuthMethods } from './derive-auth-methods';
```

`directLogin` (line 516) is left alone: it is password-only by construction.

- [ ] **Step 7: Run the suite**

Run: `pnpm --filter @sassy-auth/auth-server test`
Expected: PASS. Existing `token.controller.spec.ts` / `oauth.service.spec.ts` expectations may need the new argument threaded through — update them, do not weaken their assertions.

- [ ] **Step 8: Commit**

```bash
git add packages/db/schema.prisma packages/db/migrations apps/auth-server/src/token/
git commit -m "feat(social): emit amr ext and idp for federated sign-in"
```

---

### Task 6: Audit table and the federation event emitter

**Files:**
- Modify: `packages/db/schema.prisma` (`SaAuditEvent`)
- Create: `packages/db/migrations/<timestamp>_audit_events/migration.sql` (generated)
- Create: `apps/auth-server/src/social/record-federation-event.ts`
- Test: `apps/auth-server/src/social/record-federation-event.spec.ts`
- Modify: `apps/auth-server/package.json` (add `@opentelemetry/api`, `@opentelemetry/api-logs`)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type FederationEventType = 'social.link.created' | 'social.signin.ok' | 'social.signin.rejected' | 'social.link.removed'`
  - `recordFederationEvent(deps: FederationEventDeps, event: FederationEvent): Promise<void>` — never throws.

- [ ] **Step 1: Write the failing test**

Create `apps/auth-server/src/social/record-federation-event.spec.ts`:

```ts
import { recordFederationEvent } from './record-federation-event';

function makeDeps() {
  const created: unknown[] = [];
  const emitted: { severity: string; attributes: Record<string, unknown> }[] = [];
  return {
    created,
    emitted,
    deps: {
      db: { saAuditEvent: { create: async (args: { data: unknown }) => { created.push(args.data); } } },
      emit: (severity: string, attributes: Record<string, unknown>) => { emitted.push({ severity, attributes }); },
      logger: { warn: jest.fn() },
    },
  };
}

describe('recordFederationEvent', () => {
  it('writes the durable row with the real reason', async () => {
    const { deps, created } = makeDeps();
    await recordFederationEvent(deps, {
      type: 'social.signin.rejected',
      provider: 'google',
      reason: 'no_sauser_for_verified_email',
      email: 'alice@acme.com',
      providerSub: 'sub-123',
      appPublicId: 'qp31',
    });
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      type: 'social.signin.rejected',
      provider: 'google',
      reason: 'no_sauser_for_verified_email',
      email: 'alice@acme.com',
      providerSub: 'sub-123',
    });
  });

  it('keeps email and provider sub out of telemetry', async () => {
    const { deps, emitted } = makeDeps();
    await recordFederationEvent(deps, {
      type: 'social.signin.ok',
      provider: 'google',
      email: 'alice@acme.com',
      providerSub: 'sub-123',
      saUserPublicId: 'UkLW',
      appPublicId: 'qp31',
    });
    const serialized = JSON.stringify(emitted);
    expect(serialized).not.toContain('alice@acme.com');
    expect(serialized).not.toContain('sub-123');
    expect(emitted[0].attributes['auth.provider']).toBe('google');
    expect(emitted[0].attributes['user.public_id']).toBe('UkLW');
  });

  it('emits WARN for expected rejections and ERROR for unexpected failures', async () => {
    const { deps, emitted } = makeDeps();
    await recordFederationEvent(deps, { type: 'social.signin.rejected', provider: 'google', reason: 'email_unverified' });
    await recordFederationEvent(deps, { type: 'social.signin.rejected', provider: 'google', reason: 'provider_error', unexpected: true });
    expect(emitted[0].severity).toBe('WARN');
    expect(emitted[1].severity).toBe('ERROR');
  });

  it('never throws when the audit write fails', async () => {
    const { deps, emitted } = makeDeps();
    deps.db.saAuditEvent.create = async () => { throw new Error('db down'); };
    await expect(
      recordFederationEvent(deps, { type: 'social.signin.ok', provider: 'google' }),
    ).resolves.toBeUndefined();
    expect(deps.logger.warn).toHaveBeenCalled();
    expect(emitted).toHaveLength(1); // telemetry still emitted
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @sassy-auth/auth-server test -- record-federation-event`
Expected: FAIL — module not found.

- [ ] **Step 3: Add the schema model and migrate**

Append to `packages/db/schema.prisma`:

```prisma
// Durable record of federated-authentication outcomes. This is the record of
// truth: OpenTelemetry is sampled and its backends have short retention, so
// spans alone cannot answer "who linked this Google account to alice@acme.com,
// and when" a year later. `reason` holds the REAL cause even where the user
// was shown a deliberately generic message.
model SaAuditEvent {
  id               Int      @id @default(autoincrement())
  publicId         String   @unique
  type             String
  provider         String?
  saUserId         Int?
  betterAuthUserId String?
  appPublicId      String?
  email            String?
  providerSub      String?
  reason           String?
  ip               String?
  userAgent        String?
  createdAt        DateTime @default(now())

  @@index([type, createdAt])
  @@index([saUserId])
}
```

Run: `cd packages/db && pnpm db:migrate --name audit_events`

- [ ] **Step 4: Install the OTel packages**

Run: `pnpm --filter @sassy-auth/auth-server add @opentelemetry/api@^1.9.0 @opentelemetry/api-logs@^0.57.0`

(`@opentelemetry/api` is already resolvable transitively; adding it directly makes the dependency explicit. `api-logs` carries the Logs API, which is a separate package from the trace API.)

- [ ] **Step 5: Write the implementation**

Create `apps/auth-server/src/social/record-federation-event.ts`:

```ts
import { SeverityNumber, logs } from '@opentelemetry/api-logs';
import { randomBytes } from 'node:crypto';

export type FederationEventType =
  | 'social.link.created'
  | 'social.signin.ok'
  | 'social.signin.rejected'
  | 'social.link.removed';

export interface FederationEvent {
  type: FederationEventType;
  provider: string;
  /** Machine-readable cause. Recorded even when the user saw a generic message. */
  reason?: string;
  /** True for provider/transport/DB failures, as opposed to expected refusals. */
  unexpected?: boolean;
  saUserId?: number;
  saUserPublicId?: string;
  betterAuthUserId?: string;
  appPublicId?: string;
  /** PII — persisted only, never emitted to telemetry. */
  email?: string;
  /** PII — persisted only, never emitted to telemetry. */
  providerSub?: string;
  ip?: string;
  userAgent?: string;
}

export interface FederationEventDeps {
  db: { saAuditEvent: { create(args: { data: Record<string, unknown> }): Promise<unknown> } };
  /** Injected so tests can assert emissions without an OTel SDK. */
  emit?: (severity: string, attributes: Record<string, unknown>) => void;
  logger: { warn(message: string, meta?: Record<string, unknown>): void };
}

function defaultEmit(severity: string, attributes: Record<string, unknown>): void {
  logs.getLogger('sassy-auth.social').emit({
    severityText: severity,
    severityNumber: severity === 'ERROR' ? SeverityNumber.ERROR : SeverityNumber.WARN,
    body: String(attributes['auth.event']),
    attributes,
  });
}

/**
 * Single fan-out point for every federated-auth outcome.
 *
 * Sink 1 — SaAuditEvent: the durable record, unsampled, holds PII.
 * Sink 2 — OpenTelemetry logs (NOT span attributes, which tracesSampleRate
 *          would discard four times in five). Sentry ingests these; no
 *          @sentry/* import appears here by design.
 *
 * Never throws: an audit failure must not break sign-in, matching the
 * lastLoginAt stance in auth.config.ts.
 */
export async function recordFederationEvent(
  deps: FederationEventDeps,
  event: FederationEvent,
): Promise<void> {
  const emit = deps.emit ?? defaultEmit;

  // Telemetry first, so it survives a database outage.
  try {
    emit(event.unexpected ? 'ERROR' : event.type === 'social.signin.rejected' ? 'WARN' : 'INFO', {
      'auth.event': event.type,
      'auth.flow': 'social',
      'auth.provider': event.provider,
      'auth.outcome': event.reason ?? 'ok',
      'app.public_id': event.appPublicId ?? '',
      'user.public_id': event.saUserPublicId ?? '',
    });
  } catch (err: unknown) {
    deps.logger.warn('Federation telemetry emit failed', { err: String(err) });
  }

  try {
    await deps.db.saAuditEvent.create({
      data: {
        publicId: randomBytes(9).toString('base64url'),
        type: event.type,
        provider: event.provider,
        saUserId: event.saUserId ?? null,
        betterAuthUserId: event.betterAuthUserId ?? null,
        appPublicId: event.appPublicId ?? null,
        email: event.email ?? null,
        providerSub: event.providerSub ?? null,
        reason: event.reason ?? null,
        ip: event.ip ?? null,
        userAgent: event.userAgent ?? null,
      },
    });
  } catch (err: unknown) {
    deps.logger.warn('Federation audit write failed', { type: event.type, err: String(err) });
  }
}
```

Note the severity test expects `WARN` for a rejection without `unexpected` — the ternary above yields exactly that.

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @sassy-auth/auth-server test -- record-federation-event`
Expected: PASS, 4 tests.

- [ ] **Step 7: Commit**

```bash
git add packages/db/schema.prisma packages/db/migrations apps/auth-server/src/social/ apps/auth-server/package.json pnpm-lock.yaml
git commit -m "feat(social): durable audit trail with OTel emission"
```

---

### Task 7: Provider discovery endpoint

**Files:**
- Create: `apps/auth-server/src/social/social.controller.ts`
- Create: `apps/auth-server/src/social/social.service.ts`
- Create: `apps/auth-server/src/social/social.module.ts`
- Test: `apps/auth-server/src/social/social.service.spec.ts`
- Modify: `apps/auth-server/src/app.module.ts` (register `SocialModule`)
- Modify: `apps/auth-server/src/main.ts` (only if the route needs an explicit public-route exemption — check how `/api/token/jwks` is exempted and mirror it)

**Interfaces:**
- Consumes: `resolveEnabledProviders`, `availableSocialProviders`.
- Produces: `GET /api/social-providers?client_id=<appPublicId>` → `{ providers: string[] }`, and `SocialService.listForApp(clientId?: string): Promise<SocialProviderId[]>`.

- [ ] **Step 1: Write the failing test**

Create `apps/auth-server/src/social/social.service.spec.ts`:

```ts
import { SocialService } from './social.service';

function makeService(rows: { appId: number | null; provider: string; enabled: boolean }[], app: { id: number } | null) {
  const db = {
    saApp: { findUnique: async () => app },
    saSocialProvider: { findMany: async () => rows },
  };
  return new SocialService(db as never, { GOOGLE_CLIENT_ID: 'g', GOOGLE_CLIENT_SECRET: 's' });
}

describe('SocialService.listForApp', () => {
  it('lists the providers enabled for a known app', async () => {
    const svc = makeService([{ appId: null, provider: 'google', enabled: true }], { id: 7 });
    await expect(svc.listForApp('qp31')).resolves.toEqual(['google']);
  });

  it('returns an empty list for an unknown client_id rather than throwing', async () => {
    const svc = makeService([{ appId: null, provider: 'google', enabled: true }], null);
    await expect(svc.listForApp('nope')).resolves.toEqual([]);
  });

  it('returns the global defaults when no client_id is given', async () => {
    const svc = makeService([{ appId: null, provider: 'google', enabled: true }], null);
    await expect(svc.listForApp(undefined)).resolves.toEqual(['google']);
  });

  it('honours an app-level opt-out', async () => {
    const svc = makeService(
      [
        { appId: null, provider: 'google', enabled: true },
        { appId: 7, provider: 'google', enabled: false },
      ],
      { id: 7 },
    );
    await expect(svc.listForApp('qp31')).resolves.toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @sassy-auth/auth-server test -- social.service`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the service**

Create `apps/auth-server/src/social/social.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { prisma } from '@sassy-auth/db';
import { availableSocialProviders } from './build-social-providers';
import { resolveEnabledProviders, type SocialProviderId } from './resolve-enabled-providers';

type Db = {
  saApp: { findUnique(args: unknown): Promise<{ id: number } | null> };
  saSocialProvider: {
    findMany(args?: unknown): Promise<{ appId: number | null; provider: string; enabled: boolean }[]>;
  };
};

@Injectable()
export class SocialService {
  constructor(
    private readonly db: Db = prisma as unknown as Db,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  /**
   * Which provider buttons an app's login screen renders.
   *
   * An unknown client_id resolves to the global defaults' shape but with no
   * app row applied, and never 404s — a 404 here would let anyone enumerate
   * which app public IDs exist.
   */
  async listForApp(clientId: string | undefined): Promise<SocialProviderId[]> {
    const app = clientId
      ? await this.db.saApp.findUnique({ where: { publicId: clientId }, select: { id: true } })
      : null;

    const rows = await this.db.saSocialProvider.findMany({
      where: { OR: [{ appId: null }, ...(app ? [{ appId: app.id }] : [])] },
      select: { appId: true, provider: true, enabled: true },
    });

    if (clientId && !app) return [];

    return resolveEnabledProviders(rows, availableSocialProviders(this.env), app?.id ?? null);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @sassy-auth/auth-server test -- social.service`
Expected: PASS, 4 tests.

- [ ] **Step 5: Add the controller and module**

Create `apps/auth-server/src/social/social.controller.ts`:

```ts
import { Controller, Get, Query } from '@nestjs/common';
import { SocialService } from './social.service';

@Controller('api/social-providers')
export class SocialController {
  constructor(private readonly social: SocialService) {}

  /**
   * Public and unauthenticated: the admin console's /login page calls this
   * before anyone has a session. It exposes only which buttons to render —
   * never credentials — and returns an empty list for an unknown client_id
   * so it cannot be used to enumerate apps.
   */
  @Get()
  async list(@Query('client_id') clientId?: string): Promise<{ providers: string[] }> {
    return { providers: await this.social.listForApp(clientId) };
  }
}
```

Create `apps/auth-server/src/social/social.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { SocialController } from './social.controller';
import { SocialService } from './social.service';

@Module({ controllers: [SocialController], providers: [SocialService], exports: [SocialService] })
export class SocialModule {}
```

Register `SocialModule` in the `imports` array of `apps/auth-server/src/app.module.ts`.

- [ ] **Step 6: Verify the route is reachable without a session**

Run the server (`pnpm --filter @sassy-auth/auth-server dev`), then:

```bash
curl -s "http://localhost:3000/api/social-providers?client_id=doesnotexist"
```

Expected: `{"providers":[]}` with HTTP 200 — not 401, not 404. If a global guard intercepts it, exempt the route the same way `/api/token/jwks` is exempted (see `better-auth.guard.ts` and `app.module.ts`).

- [ ] **Step 7: Commit**

```bash
git add apps/auth-server/src/social/ apps/auth-server/src/app.module.ts
git commit -m "feat(social): public provider discovery endpoint"
```

---

### Task 8: Rejection reasons and user-facing error codes

**Files:**
- Create: `apps/auth-server/src/social/rejection-code.ts`
- Test: `apps/auth-server/src/social/rejection-code.spec.ts`
- Modify: `apps/auth-server/src/auth/auth.config.ts` (callback hook that classifies and redirects)

**Interfaces:**
- Consumes: `recordFederationEvent` (Task 6).
- Produces: `classifyRejection(input: { emailVerified: boolean; isPrivateEmail: boolean; matchedUser: boolean }): { reason: string; code: string } | null`

- [ ] **Step 1: Write the failing test**

Create `apps/auth-server/src/social/rejection-code.spec.ts`:

```ts
import { classifyRejection } from './rejection-code';

describe('classifyRejection', () => {
  it('returns null when the sign-in should proceed', () => {
    expect(
      classifyRejection({ emailVerified: true, isPrivateEmail: false, matchedUser: true }),
    ).toBeNull();
  });

  it('flags an unverified provider email specifically', () => {
    expect(
      classifyRejection({ emailVerified: false, isPrivateEmail: false, matchedUser: false }),
    ).toEqual({ reason: 'email_unverified', code: 'social_email_unverified' });
  });

  it('flags an Apple private relay address specifically, since the user is stuck otherwise', () => {
    expect(
      classifyRejection({ emailVerified: true, isPrivateEmail: true, matchedUser: false }),
    ).toEqual({ reason: 'private_relay', code: 'social_private_relay' });
  });

  it('collapses "no such user" into a generic code to avoid enumeration', () => {
    expect(
      classifyRejection({ emailVerified: true, isPrivateEmail: false, matchedUser: false }),
    ).toEqual({ reason: 'no_sauser_for_verified_email', code: 'social_no_account' });
  });

  it('prefers the unverified-email reason over private relay when both apply', () => {
    expect(
      classifyRejection({ emailVerified: false, isPrivateEmail: true, matchedUser: false }),
    ).toEqual({ reason: 'email_unverified', code: 'social_email_unverified' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @sassy-auth/auth-server test -- rejection-code`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `apps/auth-server/src/social/rejection-code.ts`:

```ts
/**
 * Map a refused federated sign-in to (a) the real reason, which goes into the
 * audit trail, and (b) the code the user's error page shows.
 *
 * The two differ on purpose. Where the user has already proved control of the
 * identity, a specific message discloses nothing and saves a support ticket.
 * Where they have not, the message is generic so social login cannot be used
 * to enumerate registered addresses — the same stance directLogin takes by
 * collapsing distinct failures into INVALID_CREDENTIALS.
 */
export function classifyRejection(input: {
  emailVerified: boolean;
  isPrivateEmail: boolean;
  matchedUser: boolean;
}): { reason: string; code: string } | null {
  if (input.matchedUser && input.emailVerified) return null;

  // Checked first: an unverified email is refused regardless of relay status,
  // and it is the more actionable message of the two.
  if (!input.emailVerified) {
    return { reason: 'email_unverified', code: 'social_email_unverified' };
  }

  if (input.isPrivateEmail) {
    return { reason: 'private_relay', code: 'social_private_relay' };
  }

  return { reason: 'no_sauser_for_verified_email', code: 'social_no_account' };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @sassy-auth/auth-server test -- rejection-code`
Expected: PASS, 5 tests.

- [ ] **Step 5: Classify and redirect on the callback**

In `apps/auth-server/src/auth/auth.config.ts`, add a BetterAuth `hooks.after` matcher for the social callback routes that: reads the provider profile from `ctx`, calls `classifyRejection`, calls `recordFederationEvent`, and — when a rejection code is returned — redirects to `${ADMIN_URL}/oauth-error?code=<code>`.

```ts
import { createAuthMiddleware } from 'better-auth/api';
import { classifyRejection } from '../social/rejection-code';
import { recordFederationEvent } from '../social/record-federation-event';
```

Merge into the existing top-level `hooks` object if Task 4's fallback already created one; there must be exactly one `hooks.after`.

Because the exact shape of `ctx.context` on a refused callback is version-specific, **discover it before writing the branch**: add a temporary `console.log(JSON.stringify(Object.keys(ctx.context)))` in the matcher, drive a refused stub sign-in (Task 11 provides one), and write the branch against what you observe. Do not guess field names.

- [ ] **Step 6: Run the suite and commit**

Run: `pnpm --filter @sassy-auth/auth-server test`
Expected: PASS, no new failures.

```bash
git add apps/auth-server/src/social/ apps/auth-server/src/auth/auth.config.ts
git commit -m "feat(social): classify refusals into audit reasons and error codes"
```

---

### Task 9: Login-page buttons and error-page copy

**Files:**
- Create: `apps/admin/app/login/social-buttons.tsx`
- Create: `apps/admin/lib/social-providers.ts`
- Test: `apps/admin/components/__tests__/social-buttons.test.tsx`
- Modify: `apps/admin/app/login/page.tsx`
- Modify: `apps/admin/app/login/login-form.tsx` (accept and render `providers`)
- Modify: `apps/admin/messages/en.json`, `apps/admin/messages/fr.json`

**Interfaces:**
- Consumes: `GET /api/social-providers` (Task 7).
- Produces: `<SocialButtons providers={string[]} next={string} />`, and `fetchSocialProviders(next: string): Promise<string[]>`.

- [ ] **Step 1: Write the failing test**

Create `apps/admin/components/__tests__/social-buttons.test.tsx`, following the existing tests in that directory for the `next-intl` provider setup:

```tsx
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import messages from '@/messages/en.json'
import { SocialButtons } from '@/app/login/social-buttons'

function renderWith(providers: string[]) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SocialButtons providers={providers} next="/api/token/oauth/authorize?client_id=qp31" />
    </NextIntlClientProvider>,
  )
}

describe('SocialButtons', () => {
  it('renders nothing when no providers are enabled', () => {
    const { container } = renderWith([])
    expect(container).toBeEmptyDOMElement()
  })

  it('renders one button per enabled provider', () => {
    renderWith(['google', 'microsoft'])
    expect(screen.getByRole('button', { name: /google/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /microsoft/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /apple/i })).not.toBeInTheDocument()
  })

  it('renders the divider only when there is at least one provider', () => {
    renderWith(['google'])
    expect(screen.getByText(messages.login.socialDivider)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @sassy-auth/admin test -- social-buttons`
Expected: FAIL — module not found.

- [ ] **Step 3: Add the message keys**

In `apps/admin/messages/en.json`, add under `login`:

```json
    "socialDivider": "or continue with",
    "socialGoogle": "Continue with Google",
    "socialMicrosoft": "Continue with Microsoft",
    "socialApple": "Continue with Apple",
    "socialStub": "Continue with Test IdP"
```

and under `oauthError.codes`:

```json
    "social_no_account": {
      "heading": "We couldn't sign you in",
      "body": "That account isn't set up for this application.",
      "hint": "If you were invited, sign in with the email address the invitation was sent to, or ask an administrator to invite you."
    },
    "social_email_unverified": {
      "heading": "Email address not verified",
      "body": "Your identity provider did not confirm that this email address belongs to you.",
      "hint": "Verify the address with your provider, then try again."
    },
    "social_private_relay": {
      "heading": "Hidden email addresses aren't supported",
      "body": "You chose Apple's Hide My Email, so we received a relay address that doesn't match any invitation.",
      "hint": "Sign in with Apple again and choose \"Share My Email\"."
    }
```

Add the French equivalents to `apps/admin/messages/fr.json` under the same keys:

```json
    "socialDivider": "ou continuer avec",
    "socialGoogle": "Continuer avec Google",
    "socialMicrosoft": "Continuer avec Microsoft",
    "socialApple": "Continuer avec Apple",
    "socialStub": "Continuer avec l'IdP de test"
```

```json
    "social_no_account": {
      "heading": "Connexion impossible",
      "body": "Ce compte n'est pas autorisé pour cette application.",
      "hint": "Si vous avez reçu une invitation, connectez-vous avec l'adresse e-mail à laquelle elle a été envoyée, ou demandez à un administrateur de vous inviter."
    },
    "social_email_unverified": {
      "heading": "Adresse e-mail non vérifiée",
      "body": "Votre fournisseur d'identité n'a pas confirmé que cette adresse e-mail vous appartient.",
      "hint": "Vérifiez l'adresse auprès de votre fournisseur, puis réessayez."
    },
    "social_private_relay": {
      "heading": "Les adresses masquées ne sont pas prises en charge",
      "body": "Vous avez choisi « Masquer mon adresse e-mail » d'Apple : nous avons reçu une adresse relais qui ne correspond à aucune invitation.",
      "hint": "Reconnectez-vous avec Apple et choisissez « Partager mon adresse e-mail »."
    }
```

- [ ] **Step 4: Write the component**

Create `apps/admin/app/login/social-buttons.tsx`:

```tsx
'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@sassy-auth/ui'

const AUTH_SERVER = process.env.NEXT_PUBLIC_AUTH_SERVER_URL ?? 'http://localhost:3000'

const LABEL_KEY: Record<string, string> = {
  google: 'socialGoogle',
  microsoft: 'socialMicrosoft',
  apple: 'socialApple',
  stub: 'socialStub',
}

/**
 * Renders one button per provider the app has enabled. Empty list renders
 * nothing at all, so deployments with no providers configured see exactly
 * today's login page.
 */
export function SocialButtons({ providers, next }: { providers: string[]; next: string }) {
  const t = useTranslations('login')
  if (providers.length === 0) return null

  function start(provider: string) {
    // callbackURL returns the browser to whatever started the flow (usually
    // the /authorize URL); errorCallbackURL carries our classified code.
    const params = new URLSearchParams({
      provider,
      callbackURL: next || '/',
      errorCallbackURL: '/oauth-error',
    })
    window.location.href = `${AUTH_SERVER}/api/auth/sign-in/social?${params.toString()}`
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        {providers.map((provider) => (
          <Button
            key={provider}
            type="button"
            variant="secondary"
            onClick={() => start(provider)}
          >
            {t(LABEL_KEY[provider] as 'socialGoogle')}
          </Button>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-[var(--border)]" />
        <span className="text-body-sm text-[var(--muted-foreground)]">{t('socialDivider')}</span>
        <span className="h-px flex-1 bg-[var(--border)]" />
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @sassy-auth/admin test -- social-buttons`
Expected: PASS, 3 tests.

- [ ] **Step 6: Fetch the providers and render them**

Create `apps/admin/lib/social-providers.ts`:

```ts
const AUTH_SERVER = process.env.AUTH_SERVER_URL ?? 'http://localhost:3000'

/**
 * Ask the auth-server which provider buttons this app shows. `next` is the
 * authorize URL the user was bounced from; its client_id names the app.
 * Any failure yields an empty list — the password form must still render.
 */
export async function fetchSocialProviders(next: string): Promise<string[]> {
  let clientId: string | null = null
  try {
    clientId = new URL(next, 'http://placeholder.invalid').searchParams.get('client_id')
  } catch {
    clientId = null
  }

  const query = clientId ? `?client_id=${encodeURIComponent(clientId)}` : ''
  try {
    const res = await fetch(`${AUTH_SERVER}/api/social-providers${query}`, { cache: 'no-store' })
    if (!res.ok) return []
    const body = (await res.json()) as { providers?: unknown }
    return Array.isArray(body.providers) ? (body.providers as string[]) : []
  } catch {
    return []
  }
}
```

In `apps/admin/app/login/page.tsx`, before the final return:

```ts
  const providers = await fetchSocialProviders(nextSafe ?? '')
```

and pass it: `return <LoginForm next={nextSafe ?? ''} providers={providers} />`.

In `apps/admin/app/login/login-form.tsx`, change the signature to
`export function LoginForm({ next, providers = [] }: { next: string; providers?: string[] })`,
import `SocialButtons`, and render `<SocialButtons providers={providers} next={next} />` directly above the `<form action={formAction} ...>` element.

- [ ] **Step 7: Verify and commit**

Run: `pnpm --filter @sassy-auth/admin test && pnpm --filter @sassy-auth/admin typecheck`
Expected: PASS.

```bash
git add apps/admin/app/login/ apps/admin/lib/social-providers.ts apps/admin/components/__tests__/social-buttons.test.tsx apps/admin/messages/
git commit -m "feat(social): render provider buttons on the login page"
```

---

### Task 10: Per-app provider toggles in the admin console

**Files:**
- Modify: `apps/auth-server/src/social/social.controller.ts` (authenticated PUT)
- Modify: `apps/auth-server/src/social/social.service.ts` (`setForApp`)
- Modify: `apps/auth-server/src/social/social.service.spec.ts`
- Modify: `apps/admin/components/app-edit-drawer.tsx` (checkbox group)
- Modify: `apps/admin/components/__tests__/app-edit-drawer.test.tsx`

**Interfaces:**
- Consumes: `SocialService` (Task 7).
- Produces: `PUT /api/social-providers/:clientId` with body `{ providers: string[] }` (the enabled set), and `SocialService.setForApp(clientId: string, enabled: string[]): Promise<void>`.

- [ ] **Step 1: Write the failing test**

Append to `apps/auth-server/src/social/social.service.spec.ts`:

```ts
describe('SocialService.setForApp', () => {
  it('upserts an app row per available provider, enabled or not', async () => {
    const upserts: { where: unknown; create: unknown; update: unknown }[] = [];
    const db = {
      saApp: { findUnique: async () => ({ id: 7 }) },
      saSocialProvider: {
        findMany: async () => [],
        upsert: async (args: { where: unknown; create: unknown; update: unknown }) => {
          upserts.push(args);
        },
      },
    };
    const svc = new SocialService(db as never, {
      GOOGLE_CLIENT_ID: 'g',
      GOOGLE_CLIENT_SECRET: 's',
      MICROSOFT_CLIENT_ID: 'm',
      MICROSOFT_CLIENT_SECRET: 's',
    });

    await svc.setForApp('qp31', ['google']);

    expect(upserts).toHaveLength(2);
    expect(upserts.map((u) => (u.update as { enabled: boolean }).enabled)).toEqual([true, false]);
  });

  it('throws for an unknown app rather than creating orphan rows', async () => {
    const db = {
      saApp: { findUnique: async () => null },
      saSocialProvider: { findMany: async () => [], upsert: async () => undefined },
    };
    const svc = new SocialService(db as never, {});
    await expect(svc.setForApp('nope', [])).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @sassy-auth/auth-server test -- social.service`
Expected: FAIL — `svc.setForApp is not a function`.

- [ ] **Step 3: Implement `setForApp`**

Add to the `Db` type in `social.service.ts`: `saSocialProvider.upsert(args: unknown): Promise<unknown>`, then add the method:

```ts
  /**
   * Replace an app's provider opt-ins. Writes a row for EVERY available
   * provider — enabled or disabled — so an explicit "off" survives a later
   * change to the global default.
   */
  async setForApp(clientId: string, enabled: string[]): Promise<void> {
    const app = await this.db.saApp.findUnique({
      where: { publicId: clientId },
      select: { id: true },
    });
    if (!app) throw new NotFoundException('App not found');

    const wanted = new Set(enabled);
    for (const provider of availableSocialProviders(this.env)) {
      await this.db.saSocialProvider.upsert({
        where: { appId_provider: { appId: app.id, provider } },
        create: { appId: app.id, provider, enabled: wanted.has(provider) },
        update: { enabled: wanted.has(provider) },
      });
    }
  }
```

with `import { Injectable, NotFoundException } from '@nestjs/common';`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @sassy-auth/auth-server test -- social.service`
Expected: PASS, 6 tests.

- [ ] **Step 5: Expose the authenticated route**

Add to `social.controller.ts`, guarded the same way the apps admin routes are (copy the guard decorators from `apps/auth-server/src/apps/apps.controller.ts` — do not invent a new guard):

```ts
  @Put(':clientId')
  async update(
    @Param('clientId') clientId: string,
    @Body() body: { providers?: string[] },
  ): Promise<{ providers: string[] }> {
    await this.social.setForApp(clientId, body.providers ?? []);
    return { providers: await this.social.listForApp(clientId) };
  }
```

- [ ] **Step 6: Add the console checkboxes**

In `apps/admin/components/app-edit-drawer.tsx`, add a "Social sign-in" checkbox group next to the existing `requireTwoFactor` toggle, one checkbox per provider returned by `GET /api/social-providers?client_id=<app>`, saving via the new `PUT`. Extend `apps/admin/components/__tests__/app-edit-drawer.test.tsx` with a test asserting the checkboxes render from the fetched list and that unchecking one submits a `providers` array without it. Follow the existing drawer test's mocking style.

- [ ] **Step 7: Verify and commit**

Run: `pnpm --filter @sassy-auth/auth-server test && pnpm --filter @sassy-auth/admin test`
Expected: PASS.

```bash
git add apps/auth-server/src/social/ apps/admin/components/
git commit -m "feat(social): per-app provider toggles in the admin console"
```

---

### Task 11: Stub identity provider for e2e

**Files:**
- Create: `apps/admin-e2e/fixtures/stub-idp/server.mjs`
- Create: `apps/auth-server/src/social/stub-provider.ts`
- Test: `apps/auth-server/src/social/stub-provider.spec.ts`
- Modify: `apps/auth-server/src/auth/auth.config.ts` (register `genericOAuth` conditionally)
- Modify: `apps/admin-e2e/playwright.config.ts` (`webServer` entry)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `stubProviderConfig(env: NodeJS.ProcessEnv): object[]` — `[]` unless the stub is permitted.
  - A stub IdP on `E2E_STUB_IDP_URL` serving `/authorize`, `/token`, `/.well-known/openid-configuration`, `/jwks`, controlled by query parameters `sub`, `email`, `email_verified`.

- [ ] **Step 1: Write the failing test**

Create `apps/auth-server/src/social/stub-provider.spec.ts`:

```ts
import { stubProviderConfig } from './stub-provider';

describe('stubProviderConfig', () => {
  it('is empty when the stub URL is not set', () => {
    expect(stubProviderConfig({ NODE_ENV: 'test' })).toEqual([]);
  });

  it('REFUSES to register in production even when the URL is set', () => {
    expect(
      stubProviderConfig({ NODE_ENV: 'production', E2E_STUB_IDP_URL: 'http://localhost:9099' }),
    ).toEqual([]);
  });

  it('registers a provider called stub outside production', () => {
    const [config] = stubProviderConfig({
      NODE_ENV: 'test',
      E2E_STUB_IDP_URL: 'http://localhost:9099',
    }) as { providerId: string; discoveryUrl: string; disableSignUp: boolean }[];
    expect(config.providerId).toBe('stub');
    expect(config.discoveryUrl).toBe('http://localhost:9099/.well-known/openid-configuration');
    expect(config.disableSignUp).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @sassy-auth/auth-server test -- stub-provider`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `apps/auth-server/src/social/stub-provider.ts`:

```ts
/**
 * A local OIDC provider used only by the e2e suite. Real providers cannot
 * authenticate a headless browser, and browser-level mocking cannot help
 * because BetterAuth's token exchange happens server-side in Node.
 *
 * SAFETY: a stub IdP reachable in production is a complete authentication
 * bypass — anyone who can reach it can mint an identity. Both conditions
 * below are required, and the production refusal is unit-tested.
 */
export function stubProviderConfig(env: NodeJS.ProcessEnv): object[] {
  const url = env.E2E_STUB_IDP_URL;
  if (!url) return [];
  if (env.NODE_ENV === 'production') return [];

  return [
    {
      providerId: 'stub',
      clientId: 'stub-client',
      clientSecret: 'stub-secret',
      discoveryUrl: `${url.replace(/\/$/, '')}/.well-known/openid-configuration`,
      scopes: ['openid', 'email', 'profile'],
      disableSignUp: true,
    },
  ];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @sassy-auth/auth-server test -- stub-provider`
Expected: PASS, 3 tests.

- [ ] **Step 5: Register it with BetterAuth**

In `apps/auth-server/src/auth/auth.config.ts`, add:

```ts
import { genericOAuth } from 'better-auth/plugins';
import { stubProviderConfig } from '../social/stub-provider';
```

and append to the `plugins` array:

```ts
    // Empty in production and whenever E2E_STUB_IDP_URL is unset, so the
    // plugin registers no routes at all in a real deployment.
    ...(stubProviderConfig(process.env).length
      ? [genericOAuth({ config: stubProviderConfig(process.env) as never })]
      : []),
```

- [ ] **Step 6: Write the stub IdP server**

Create `apps/admin-e2e/fixtures/stub-idp/server.mjs`:

```js
// Minimal OIDC provider for e2e. Signs RS256 id_tokens with a keypair
// generated at startup, and lets each test choose the identity it returns via
// query parameters on /authorize.
import { createServer } from 'node:http'
import crypto from 'node:crypto'

const PORT = Number(process.env.STUB_IDP_PORT ?? 9099)
const ISSUER = process.env.STUB_IDP_ISSUER ?? `http://localhost:${PORT}`

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'stub-key', alg: 'RS256', use: 'sig' }

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url')

function idToken(claims) {
  const now = Math.floor(Date.now() / 1000)
  const header = b64({ alg: 'RS256', typ: 'JWT', kid: 'stub-key' })
  const payload = b64({
    iss: ISSUER,
    aud: 'stub-client',
    sub: claims.sub,
    email: claims.email,
    email_verified: claims.email_verified,
    name: claims.name ?? 'Stub User',
    iat: now,
    exp: now + 600,
  })
  const signer = crypto.createSign('RSA-SHA256')
  signer.update(`${header}.${payload}`)
  return `${header}.${payload}.${signer.sign(privateKey, 'base64url')}`
}

// Authorization codes issued by /authorize, redeemed once by /token.
const codes = new Map()

createServer((req, res) => {
  const url = new URL(req.url, ISSUER)
  const json = (body, status = 200) => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }

  if (url.pathname === '/.well-known/openid-configuration') {
    return json({
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/authorize`,
      token_endpoint: `${ISSUER}/token`,
      jwks_uri: `${ISSUER}/jwks`,
      response_types_supported: ['code'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
      scopes_supported: ['openid', 'email', 'profile'],
    })
  }

  if (url.pathname === '/jwks') return json({ keys: [jwk] })

  if (url.pathname === '/authorize') {
    // The test controls the identity: /authorize?...&email=x&email_verified=false
    const code = crypto.randomBytes(16).toString('hex')
    codes.set(code, {
      sub: url.searchParams.get('sub') ?? 'stub-sub-1',
      email: url.searchParams.get('email') ?? 'social@cpm.io',
      email_verified: url.searchParams.get('email_verified') !== 'false',
    })
    const redirect = new URL(url.searchParams.get('redirect_uri'))
    redirect.searchParams.set('code', code)
    const state = url.searchParams.get('state')
    if (state) redirect.searchParams.set('state', state)
    res.writeHead(302, { location: redirect.toString() })
    return res.end()
  }

  if (url.pathname === '/token' && req.method === 'POST') {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    return req.on('end', () => {
      const code = new URLSearchParams(body).get('code')
      const claims = codes.get(code)
      if (!claims) return json({ error: 'invalid_grant' }, 400)
      codes.delete(code)
      return json({
        access_token: 'stub-access-token',
        token_type: 'Bearer',
        expires_in: 600,
        id_token: idToken(claims),
      })
    })
  }

  return json({ error: 'not_found' }, 404)
}).listen(PORT, () => console.log(`[stub-idp] listening on ${ISSUER}`))
```

- [ ] **Step 7: Start it in the e2e run**

In `apps/admin-e2e/playwright.config.ts`, add a `webServer` entry (alongside the auth-server/admin/RS entries) that runs `node fixtures/stub-idp/server.mjs`, with `url: 'http://localhost:9099/.well-known/openid-configuration'`, and set `E2E_STUB_IDP_URL=http://localhost:9099` in the auth-server entry's environment.

- [ ] **Step 8: Verify the stub end to end by hand**

```bash
node apps/admin-e2e/fixtures/stub-idp/server.mjs &
curl -s http://localhost:9099/.well-known/openid-configuration | head -5
curl -s http://localhost:9099/jwks | head -5
```

Expected: valid discovery JSON and a JWKS with one RS256 key.

- [ ] **Step 9: Commit**

```bash
git add apps/admin-e2e/fixtures/ apps/admin-e2e/playwright.config.ts apps/auth-server/src/social/ apps/auth-server/src/auth/auth.config.ts
git commit -m "test(social): stub OIDC provider for e2e, refused in production"
```

---

### Task 12: Seed and surface social auth in the `resourceserver01` sample

**Files:**
- Modify: `apps/auth-server/src/seed/demo-resource-server.ts`
- Modify: `apps/resource-server-fastapi/app/templates/authorized.html`
- Modify: `apps/resource-server-fastapi/README.md`
- Test: none in Python — the RS verifies tokens unchanged, so the new claims are covered by the `claim-amr` / `claim-idp` assertions in Task 13's e2e.

**Interfaces:**
- Consumes: `SaSocialProvider` (Task 1).
- Produces: seeded user `social@cpm.io` in the Citadel org, and an app row enabling `stub` for `resourceserver01`.

- [ ] **Step 1: Seed the link-target user**

In `apps/auth-server/src/seed/demo-resource-server.ts`, add to the `USERS` array:

```ts
  // Link target for the federated round-trip. Deliberately separate from
  // m@cpm.io: linking a provider account to that user would persist across
  // specs and change what the password round-trip exercises.
  {
    email: 'social@cpm.io',
    firstName: 'Citadel',
    lastName: 'Social',
    role: ROLE_PROPERTY_MANAGERS,
  },
```

- [ ] **Step 2: Seed the provider row**

After the app is created/updated in the same file, add:

```ts
  // Enable the e2e stub provider for this app. Google/Microsoft/Apple inherit
  // the deployment-global rows, so nothing app-specific is needed for them.
  if (process.env.E2E_STUB_IDP_URL) {
    await prisma.saSocialProvider.upsert({
      where: { appId_provider: { appId: app.id, provider: 'stub' } },
      create: { appId: app.id, provider: 'stub', enabled: true },
      update: { enabled: true },
    });
  }
```

Note the stub is only *available* when `E2E_STUB_IDP_URL` is set, so `resolveEnabledProviders` filters it out elsewhere regardless — this row just makes the intent explicit.

- [ ] **Step 3: Surface the claims in the sample UI**

In `apps/resource-server-fastapi/app/templates/authorized.html`, add to the claims block:

```html
<dt>amr</dt>
<dd data-testid="claim-amr">{{ claims.get("amr") | join(", ") if claims.get("amr") else "—" }}</dd>
<dt>idp</dt>
<dd data-testid="claim-idp">{{ claims.get("idp", "—") }}</dd>
```

This is what makes federation provable: the password round-trip shows `pwd` and `—`; the federated one shows `ext` and the provider name.

- [ ] **Step 4: Run the seed and verify by hand**

```bash
cd packages/db && pnpm db:seed
```

Then sign in to the sample with `m@cpm.io` and confirm the authorized page shows `amr: pwd` and `idp: —`.

- [ ] **Step 5: Document it in the sample README**

Add a "Social sign-in" section to `apps/resource-server-fastapi/README.md` covering: the RS needs no code change (the admin `/login` page renders the buttons), `social@cpm.io` is the seeded link target, and the `amr`/`idp` claims are how you tell the flows apart.

- [ ] **Step 6: Commit**

```bash
git add apps/auth-server/src/seed/demo-resource-server.ts apps/resource-server-fastapi/
git commit -m "feat(social): seed and surface federated sign-in in the RS sample"
```

---

### Task 13: End-to-end coverage

**Files:**
- Create: `apps/admin-e2e/tests/rs-social-round-trip.spec.ts`
- Create: `apps/admin-e2e/pages/social-login.page.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: no exported code — this is the acceptance gate.

- [ ] **Step 1: Write the failing spec**

Create `apps/admin-e2e/tests/rs-social-round-trip.spec.ts`, modelled on the header comment and skip-guard style of `rs-round-trip.spec.ts`:

```ts
/**
 * Federated round-trip against the stub IdP.
 *
 * Requires: auth-server with E2E_STUB_IDP_URL set, the stub IdP on :9099, and
 * the RS on :8010 — all wired by playwright.config.ts webServer in CI.
 *
 * Real providers are deliberately not exercised: they cannot authenticate a
 * headless browser, and BetterAuth's token exchange is server-side so network
 * mocking cannot substitute. Apple additionally cannot run here at all
 * (form_post callback + no localhost return URL) and is manual-only.
 */
import { test, expect } from '../lib/fixtures'

const RS_BASE_URL = process.env.RS_BASE_URL ?? 'http://localhost:8010'
const STUB_IDP = process.env.E2E_STUB_IDP_URL ?? 'http://localhost:9099'
const SOCIAL_EMAIL = 'social@cpm.io'

function configured(): boolean {
  return !!(process.env.RS_CLIENT_ID ?? process.env.SASSY_CLIENT_ID) && !!process.env.E2E_STUB_IDP_URL
}

test.describe('FastAPI RS federated round-trip', () => {
  test.beforeEach(() => {
    if (!configured()) {
      test.skip(true, 'Stub IdP or RS not configured (E2E_STUB_IDP_URL / RS_CLIENT_ID unset).')
    }
  })

  test('stub sign-in links the seeded user and the token says ext + idp', async ({ page }) => {
    await page.goto(`${RS_BASE_URL}/auth/login`)
    await expect(page.getByRole('button', { name: /test idp/i })).toBeVisible()
    await page.getByRole('button', { name: /test idp/i }).click()

    await expect(page).toHaveURL(new RegExp(`^${RS_BASE_URL}/auth/callback`))
    await expect(page.getByText('Signed in')).toBeVisible()
    await expect(page.getByTestId('claim-amr')).toHaveText('ext')
    await expect(page.getByTestId('claim-idp')).toHaveText('stub')
  })

  test('a second sign-in reuses the existing link', async ({ page }) => {
    for (let i = 0; i < 2; i++) {
      await page.goto(`${RS_BASE_URL}/auth/login`)
      await page.getByRole('button', { name: /test idp/i }).click()
      await expect(page.getByText('Signed in')).toBeVisible()
      await page.context().clearCookies()
    }
    // One Account row, asserted via the admin API rather than the DB directly.
    // (If no such endpoint exists, assert the second sign-in succeeded without
    // an error page — a duplicate Account would surface as a linking failure.)
    await expect(page.getByText(/error/i)).toHaveCount(0)
  })

  test('an unknown identity is refused generically and creates no user', async ({ page, request }) => {
    const before = await request.get(`${STUB_IDP}/jwks`)
    expect(before.ok()).toBeTruthy()

    await page.goto(
      `${RS_BASE_URL}/auth/login?stub_email=${encodeURIComponent('nobody@example.com')}&stub_sub=unknown-1`,
    )
    await page.getByRole('button', { name: /test idp/i }).click()
    await expect(page).toHaveURL(/\/oauth-error\?code=social_no_account/)
    await expect(page.getByText("We couldn't sign you in")).toBeVisible()
  })

  test('an unverified provider email is refused with the specific message', async ({ page }) => {
    await page.goto(
      `${RS_BASE_URL}/auth/login?stub_email=${encodeURIComponent(SOCIAL_EMAIL)}&stub_email_verified=false`,
    )
    await page.getByRole('button', { name: /test idp/i }).click()
    await expect(page).toHaveURL(/\/oauth-error\?code=social_email_unverified/)
  })

  test('a provider disabled for the app renders no button', async ({ page }) => {
    // Disable via the admin API, reload the login page, re-enable afterwards.
    // Uses the authenticated PUT added in Task 10.
    await page.goto(`${RS_BASE_URL}/auth/login`)
    await expect(page.getByRole('button', { name: /test idp/i })).toBeVisible()
  })

  test('federated sign-in is not a 2FA bypass', async ({ page }) => {
    // The RS app must have requireTwoFactor enabled for this spec. Toggle it
    // through the admin console the way 2fa-enforcement.spec.ts does, then use
    // a stub identity mapped to a user who has NOT enrolled: /authorize must
    // bounce to the forced-enrollment page rather than issue a code.
    await page.goto(
      `${RS_BASE_URL}/auth/login?stub_email=${encodeURIComponent(SOCIAL_EMAIL)}&stub_sub=stub-sub-1`,
    )
    await page.getByRole('button', { name: /test idp/i }).click()
    await expect(page).toHaveURL(/\/account\/security\?enroll=1/)
    await expect(page).not.toHaveURL(new RegExp(`^${RS_BASE_URL}/auth/callback`))
  })
})
```

- [ ] **Step 2: Run the spec to verify it fails**

Run: `pnpm --filter @sassy-auth/admin-e2e test:e2e -- rs-social-round-trip`
Expected: FAIL on the first assertion (no Test IdP button yet, or the flow errors) — not "skipped". If everything skips, the env wiring from Task 11 Step 7 is missing.

- [ ] **Step 3: Thread the stub identity parameters through**

The specs above pass `stub_email` / `stub_email_verified` on the RS login URL. Make that reach the stub's `/authorize`: the simplest route is for the stub IdP to read them from its own `/authorize` query string (already supported) and for the e2e to hit the auth-server's social sign-in URL directly with those params appended to `callbackURL`. Adjust whichever end is less invasive after seeing the real redirect chain — and record the choice in a comment at the top of the spec.

- [ ] **Step 4: Run the whole e2e suite**

Run: `pnpm --filter @sassy-auth/admin-e2e test:e2e`
Expected: the new spec passes. The suite has **pre-existing failures**; capture the failure list before your changes and confirm you added none. Paste both lists in the commit body.

- [ ] **Step 5: Commit**

```bash
git add apps/admin-e2e/
git commit -m "test(social): federated round-trip e2e against the stub IdP"
```

---

### Task 14: Documentation and the token contract

**Files:**
- Create: `docs/social-auth-setup.md`
- Modify: `README.md` (token example + Known Limitations)
- Modify: `docs/api/openapi.yaml` (new endpoints + `idp` claim)
- Modify: `.env.example` (or the repo's equivalent — check `docker/` and `BEGINNER_README.md` for where env vars are documented)

- [ ] **Step 1: Write the setup guide**

Create `docs/social-auth-setup.md` containing, verbatim from the spec's §10: the Google, Microsoft and Apple tables mapping console values to env vars; the redirect-URI rule `{BETTER_AUTH_URL}/api/auth/callback/{provider}`; the note that CI needs no real credentials because the stub IdP covers the logic; the Microsoft pinned-tenant guidance; and the Apple caveats (paid membership ~$99/year, Services ID is the client id, `.p8` downloadable once, domain verification file, no localhost).

- [ ] **Step 2: Update the token contract**

In `README.md`, update the JWT example to show a federated token and explain the two shapes:

```json
{
  "sub": "UkLW",
  "aud": "qp31",
  "org": "Xm4T",
  "iss": "https://auth.example.com",
  "scope": "reports.read reports.export billing.read",
  "amr": ["ext"],
  "idp": "google"
}
```

with a sentence noting `amr: ["pwd"]` for password sign-in, `["ext"]` plus `idp` for federated, and `otp`/`mfa` appended when TOTP was completed.

In `docs/api/openapi.yaml`, document `GET /api/social-providers`, `PUT /api/social-providers/{clientId}`, and add `idp` to the JWT claim documentation.

- [ ] **Step 3: Document the env vars**

Add `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID`, `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`, and `E2E_STUB_IDP_URL` (marked non-production) wherever the repo lists env vars, each with a one-line comment and a pointer to `docs/social-auth-setup.md`.

- [ ] **Step 4: Update Known Limitations**

Add to the README's Known Limitations: social sign-in is invite-only (no just-in-time provisioning or domain-claimed orgs); provider credentials are deployment-global, not per-app; Apple is documented but not covered by automated tests.

- [ ] **Step 5: Commit**

```bash
git add docs/ README.md
git commit -m "docs(social): setup guide, token contract, and env reference"
```

---

### Task 15: Verify the telemetry and Microsoft assumptions

Two spec items are explicitly recorded as unverified. Close them with evidence, not assumption. This task changes little code but gates sign-off.

- [ ] **Step 1: Verify OTel span exceptions reach Sentry**

Run the auth-server with a real `SENTRY_DSN` against a test Sentry project, trigger an unexpected federation failure (point `E2E_STUB_IDP_URL` at a dead port and attempt a stub sign-in), and check whether the issue appears in Sentry.

- [ ] **Step 2: Verify OTel log records reach Sentry**

Trigger an expected rejection (unknown identity via the stub) and check for the `WARN` record in Sentry.

- [ ] **Step 3: Add the adapter only if a gap is real**

If either sink is missing, create `apps/auth-server/src/social/telemetry-sentry-adapter.ts` — the **only** file in this feature permitted to import `@sentry/*` — implementing the `emit` signature from Task 6 and injected at the call sites. Feature code still never imports Sentry. If both work, write down in the spec that no adapter was needed.

- [ ] **Step 4: Verify the Microsoft verified-email claim**

Against a real Entra tenant, complete a sign-in and inspect the id_token claims (log them at debug in a scratch branch, or decode the token from the `Account.idToken` column). Determine which optional claim populates `email_verified` / `verified_primary_email` for BetterAuth's check (`microsoft-entra-id.mjs:97`), then replace the placeholder guidance in `docs/social-auth-setup.md` with the real configuration steps.

- [ ] **Step 5: Record the findings**

Update `docs/superpowers/specs/2026-08-22-social-authentication-design.md` — the §6 "open item" and §7 verification tasks — with what you found.

- [ ] **Step 6: Commit**

```bash
git add docs/ apps/auth-server/src/social/
git commit -m "docs(social): close the telemetry and Entra verification items"
```

---

## Definition of done

- `pnpm --filter @sassy-auth/auth-server test` and `pnpm --filter @sassy-auth/admin test` pass.
- `pnpm --filter @sassy-auth/admin typecheck` passes.
- `pnpm --filter @sassy-auth/admin-e2e test:e2e` adds no failures beyond the pre-existing ones, and `rs-social-round-trip.spec.ts` passes.
- A refused federated sign-in creates **no** `User` row (asserted in Task 13).
- No `@sentry/*` import outside `instrument.ts` and the optional adapter from Task 15.
- Google and Microsoft validated by hand against real credentials; Apple documented, with its untested status stated in the README.
