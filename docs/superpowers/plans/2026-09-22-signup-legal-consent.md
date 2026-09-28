# Signup/Login Legal Consent (Privacy Policy / Terms / GDPR) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an app owner optionally require a Privacy Policy, Terms and Conditions, and/or GDPR disclosure acceptance, enforced both at self-serve signup and at every other login path (existing accounts, admin-invited accounts, social sign-in).

**Architecture:** Three new optional URL fields on `SaApp`; a new `SaUserConsent` join table scoped by `(user, app, document)`; a small shared "consent domain" module (`resolveRequiredConsent` / `resolveOutstandingConsent` / `recordConsent`) used from three call sites — self-serve registration, a new session-authenticated `/api/me/consent` endpoint, and BetterAuth's social-callback `after` hook. A local MaxMind GeoLite2-Country lookup (fail-closed) decides GDPR applicability. A new, non-skippable `/login/consent` page in the admin console is the universal interstitial for every non-signup path.

**Tech Stack:** NestJS + Prisma (auth-server), Next.js App Router server actions (admin), Jest, Playwright (admin-e2e), `maxmind` npm package.

## Global Constraints

- All new/changed URL fields use the existing `@IsAppUrl()` decorator (`apps/auth-server/src/common/config/is-app-url.decorator.ts`) — same http(s)/public-host policy as `webhookUrl`.
- GDPR country list (fixed constant): EU27 (`AT, BE, BG, HR, CY, CZ, DK, EE, FI, FR, DE, GR, HU, IE, IT, LV, LT, LU, MT, NL, PL, PT, RO, SK, SI, ES, SE`) + EEA (`IS, LI, NO`) + UK (`GB`) + Switzerland (`CH`) — 31 ISO 3166-1 alpha-2 codes.
- GeoIP resolution fails closed: an unresolved country is treated as GDPR-applicable.
- No re-consent on URL change — a `SaUserConsent` row's mere existence for `(saUserId, appId, documentType)` is permanent acceptance, regardless of later `SaApp` URL edits.
- Every new backend field/endpoint follows the existing `platform.apps.manage` / `BetterAuthGuard` + `callerBaId(req)` patterns already used throughout `apps/auth-server/src`.
- Every admin-console string goes in both `apps/admin/messages/en.json` and `apps/admin/messages/fr.json`.
- Run `pnpm --filter @sassy-auth/auth-server test`, `pnpm --filter @sassy-auth/admin test`, or a narrower `-- <pattern>` per task — never skip the run-and-verify steps.

---

## Task 1: Shared type + database schema

**Files:**
- Modify: `packages/types/index.ts`
- Modify: `packages/db/schema.prisma`
- Test: `packages/types/*.spec.ts` (none needed — this task only adds a type alias, no logic)

**Interfaces:**
- Produces: `ConsentDocumentType = 'privacy_policy' | 'terms' | 'gdpr'` and `CONSENT_DOCUMENT_TYPES: readonly ConsentDocumentType[]`, exported from `@sassy-auth/types`, used by every later task.
- Produces: `SaApp.privacyPolicyUrl`, `SaApp.termsUrl`, `SaApp.gdprUrl` (all `String?`).
- Produces: `SaUserConsent` model (`id`, `saUserId`, `appId`, `documentType`, `url`, `acceptedAt`), unique on `(saUserId, appId, documentType)`.

- [ ] **Step 1: Add the shared `ConsentDocumentType` type**

Open `packages/types/index.ts` and add, near the other small shared types (after the `IdentifierType` block, before `PasswordPolicy`):

```ts
/** The three optional legal documents an app can require acceptance of. */
export type ConsentDocumentType = 'privacy_policy' | 'terms' | 'gdpr';

export const CONSENT_DOCUMENT_TYPES: readonly ConsentDocumentType[] = [
  'privacy_policy',
  'terms',
  'gdpr',
];
```

- [ ] **Step 2: Add the new `SaApp` fields**

In `packages/db/schema.prisma`, inside `model SaApp`, right after the existing `activationEmailOverride` field and before the `orgs` relation line, add:

```prisma
  /// URL to this app's Privacy Policy. When set, self-serve signup and
  /// login both require the user to accept it (see SaUserConsent).
  privacyPolicyUrl String?
  /// URL to this app's Terms and Conditions. Same acceptance rule as
  /// privacyPolicyUrl.
  termsUrl         String?
  /// URL to this app's GDPR disclosure. Acceptance is additionally
  /// conditional on the signup/login being geo-detected as EU/EEA/UK/CH
  /// (see common/geoip) — see docs/superpowers/specs/2026-09-22-signup-legal-consent-design.md.
  gdprUrl          String?
  consents         SaUserConsent[]
```

- [ ] **Step 3: Add the `SaUserConsent` model**

In `packages/db/schema.prisma`, add a new model directly after `model SaApp` (before `model SaAppRedirectUri`):

```prisma
model SaUserConsent {
  id           Int      @id @default(autoincrement())
  saUserId     Int
  saUser       SaUser   @relation(fields: [saUserId], references: [id], onDelete: Cascade)
  appId        Int
  app          SaApp    @relation(fields: [appId], references: [id], onDelete: Cascade)
  /// 'privacy_policy' | 'terms' | 'gdpr' — see ConsentDocumentType in
  /// @sassy-auth/types. Stored as a plain String (not a Prisma enum) to
  /// match the rest of this schema's convention for small closed string
  /// sets (see SaAppRedirectUri.kind).
  documentType String
  /// Snapshot of the URL as it existed at the moment of acceptance — a
  /// later change to SaApp's URL must not retroactively change what an
  /// already-accepted record claims the user agreed to.
  url          String
  acceptedAt   DateTime @default(now())

  @@unique([saUserId, appId, documentType])
  @@index([appId])
}
```

- [ ] **Step 4: Add the inverse relation on `SaUser`**

In `packages/db/schema.prisma`, inside `model SaUser`, add a line after the existing `invitations SaInvitation[]` field:

```prisma
  consents          SaUserConsent[]
```

- [ ] **Step 5: Generate the migration and Prisma client**

Run:

```bash
pnpm --filter @sassy-auth/db db:migrate -- --name add_saapp_consent_fields
```

Expected: Prisma prompts/creates a new folder under `packages/db/migrations/` (timestamp-prefixed, e.g. `2026092...._add_saapp_consent_fields`) containing the generated SQL, then regenerates the Prisma client. Confirm the migration file contains `ALTER TABLE "SaApp" ADD COLUMN "privacyPolicyUrl" ...`, `... "termsUrl" ...`, `... "gdprUrl" ...`, and a `CREATE TABLE "SaUserConsent" (...)` with a unique index on `("saUserId", "appId", "documentType")`.

- [ ] **Step 6: Commit**

```bash
git add packages/types/index.ts packages/db/schema.prisma packages/db/migrations
git commit -m "feat(db): add SaApp consent-document fields and SaUserConsent table"
```

---

## Task 2: GDPR country list

**Files:**
- Create: `apps/auth-server/src/common/geoip/gdpr-countries.ts`
- Test: `apps/auth-server/src/common/geoip/gdpr-countries.spec.ts`

**Interfaces:**
- Produces: `isGdprCountry(countryCode: string): boolean`, consumed by Task 3 (GeoIP service is IP→country only) and Task 4 (`resolveRequiredConsent`).

- [ ] **Step 1: Write the failing test**

```ts
// apps/auth-server/src/common/geoip/gdpr-countries.spec.ts
import { isGdprCountry } from './gdpr-countries';

describe('isGdprCountry', () => {
  it('returns true for an EU member state', () => {
    expect(isGdprCountry('DE')).toBe(true);
    expect(isGdprCountry('FR')).toBe(true);
  });

  it('returns true for EEA-but-not-EU countries', () => {
    expect(isGdprCountry('NO')).toBe(true);
    expect(isGdprCountry('IS')).toBe(true);
    expect(isGdprCountry('LI')).toBe(true);
  });

  it('returns true for the UK and Switzerland', () => {
    expect(isGdprCountry('GB')).toBe(true);
    expect(isGdprCountry('CH')).toBe(true);
  });

  it('returns false for a non-applicable country', () => {
    expect(isGdprCountry('US')).toBe(false);
    expect(isGdprCountry('CA')).toBe(false);
    expect(isGdprCountry('JP')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isGdprCountry('de')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sassy-auth/auth-server test -- gdpr-countries`
Expected: FAIL with "Cannot find module './gdpr-countries'"

- [ ] **Step 3: Write the implementation**

```ts
// apps/auth-server/src/common/geoip/gdpr-countries.ts
/**
 * Fixed set of ISO 3166-1 alpha-2 country codes GDPR-equivalent consent
 * applies to: the 27 EU member states, the non-EU EEA states (Iceland,
 * Liechtenstein, Norway), the United Kingdom (UK GDPR), and Switzerland
 * (FADP, commonly bundled with GDPR handling in practice). Not
 * admin-configurable in this iteration — see
 * docs/superpowers/specs/2026-09-22-signup-legal-consent-design.md.
 */
const GDPR_COUNTRIES: ReadonlySet<string> = new Set([
  // EU27
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR',
  'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK',
  'SI', 'ES', 'SE',
  // EEA (non-EU)
  'IS', 'LI', 'NO',
  // UK + Switzerland
  'GB', 'CH',
]);

export function isGdprCountry(countryCode: string): boolean {
  return GDPR_COUNTRIES.has(countryCode.toUpperCase());
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sassy-auth/auth-server test -- gdpr-countries`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/common/geoip/gdpr-countries.ts apps/auth-server/src/common/geoip/gdpr-countries.spec.ts
git commit -m "feat(auth-server): add fixed GDPR-applicable country list"
```

---

## Task 3: Client IP resolution + GeoIP country lookup

**Files:**
- Create: `apps/auth-server/src/common/net/resolve-client-ip.ts`
- Create: `apps/auth-server/src/common/net/resolve-client-ip.spec.ts`
- Create: `apps/auth-server/src/common/geoip/geoip.service.ts`
- Create: `apps/auth-server/src/common/geoip/geoip.service.spec.ts`
- Modify: `apps/auth-server/src/auth/auth-rate-limit.ts` (reuse the extracted helper — DRY)
- Modify: `apps/auth-server/package.json` (add `maxmind` dependency)
- Modify: `DEPLOYMENT.md` (document `GEOIP_DB_PATH`)

**Interfaces:**
- Consumes: nothing new.
- Produces: `resolveClientIp(req: { ips?: string[]; ip?: string }): string`, consumed by Task 9 (registration), Task 11 (`/api/me/consent`).
- Produces: `resolveCountryFromIp(ip: string): string | null`, consumed by Task 4 (`resolveRequiredConsent` call sites).

- [ ] **Step 1: Write the failing test for `resolveClientIp`**

```ts
// apps/auth-server/src/common/net/resolve-client-ip.spec.ts
import { resolveClientIp } from './resolve-client-ip';

describe('resolveClientIp', () => {
  it('prefers the left-most X-Forwarded-For entry when trust proxy populated req.ips', () => {
    expect(resolveClientIp({ ips: ['203.0.113.7', '10.0.0.1'], ip: '10.0.0.1' })).toBe('203.0.113.7');
  });

  it('falls back to req.ip when req.ips is empty', () => {
    expect(resolveClientIp({ ips: [], ip: '203.0.113.7' })).toBe('203.0.113.7');
  });

  it('falls back to "unknown" when neither is present', () => {
    expect(resolveClientIp({})).toBe('unknown');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sassy-auth/auth-server test -- resolve-client-ip`
Expected: FAIL with "Cannot find module './resolve-client-ip'"

- [ ] **Step 3: Write the implementation**

```ts
// apps/auth-server/src/common/net/resolve-client-ip.ts
/**
 * Resolve the real client IP behind Render's one proxy hop. `req.ips` is
 * populated by Express only when `trust proxy` is configured (main.ts's
 * bootstrap() does this) — in which case its left-most entry is the
 * original client; otherwise fall back to the socket address. Mirrors
 * auth-rate-limit.ts's (now-shared) clientKey logic.
 */
export function resolveClientIp(req: { ips?: string[]; ip?: string }): string {
  const forwarded = Array.isArray(req.ips) && req.ips.length > 0 ? req.ips[0] : undefined;
  return forwarded ?? req.ip ?? 'unknown';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sassy-auth/auth-server test -- resolve-client-ip`
Expected: PASS (3 tests)

- [ ] **Step 5: Replace `auth-rate-limit.ts`'s private `clientKey` with the shared helper**

In `apps/auth-server/src/auth/auth-rate-limit.ts`, replace:

```ts
function clientKey(req: Request): string {
  const forwarded = Array.isArray(req.ips) && req.ips.length > 0 ? req.ips[0] : undefined;
  return forwarded ?? req.ip ?? 'unknown';
}
```

with:

```ts
import { resolveClientIp } from '../common/net/resolve-client-ip';

function clientKey(req: Request): string {
  return resolveClientIp(req);
}
```

(add the import at the top of the file alongside the existing imports).

- [ ] **Step 6: Run the existing auth-rate-limit tests to confirm no regression**

Run: `pnpm --filter @sassy-auth/auth-server test -- auth-rate-limit`
Expected: PASS (all existing tests, unchanged)

- [ ] **Step 7: Add the `maxmind` dependency**

```bash
pnpm --filter @sassy-auth/auth-server add maxmind
```

Expected: `apps/auth-server/package.json`'s `dependencies` gains a `"maxmind": "^..."` entry and `pnpm-lock.yaml` updates.

- [ ] **Step 8: Write the failing test for `resolveCountryFromIp`**

```ts
// apps/auth-server/src/common/geoip/geoip.service.spec.ts
import { resolveCountryFromIp, __resetGeoipReaderForTests } from './geoip.service';

describe('resolveCountryFromIp', () => {
  const ORIGINAL_ENV = process.env.GEOIP_DB_PATH;

  afterEach(() => {
    process.env.GEOIP_DB_PATH = ORIGINAL_ENV;
    __resetGeoipReaderForTests();
  });

  it('returns null (fail closed) when GEOIP_DB_PATH is unset', () => {
    delete process.env.GEOIP_DB_PATH;
    __resetGeoipReaderForTests();
    expect(resolveCountryFromIp('203.0.113.7')).toBeNull();
  });

  it('returns null (fail closed) when GEOIP_DB_PATH points at a nonexistent file', () => {
    process.env.GEOIP_DB_PATH = '/nonexistent/path/GeoLite2-Country.mmdb';
    __resetGeoipReaderForTests();
    expect(resolveCountryFromIp('203.0.113.7')).toBeNull();
  });

  it('returns null (fail closed) for a private/unresolvable IP even with a valid DB configured', () => {
    // No real .mmdb file is checked into the repo (MaxMind requires a
    // licensed download) — this asserts the fail-closed behavior that
    // holds regardless of whether a database is configured, using an
    // address that can never resolve to a country either way.
    expect(resolveCountryFromIp('unknown')).toBeNull();
  });
});
```

- [ ] **Step 9: Run test to verify it fails**

Run: `pnpm --filter @sassy-auth/auth-server test -- geoip.service`
Expected: FAIL with "Cannot find module './geoip.service'"

- [ ] **Step 10: Write the implementation**

```ts
// apps/auth-server/src/common/geoip/geoip.service.ts
import { existsSync } from 'fs';
import { Reader, type CountryResponse } from 'maxmind';

/**
 * Local MaxMind GeoLite2-Country lookup, consistent with this project's
 * self-hosted stance (no per-request call to an external geo-IP API — see
 * docs/superpowers/specs/2026-09-22-signup-legal-consent-design.md).
 *
 * No database ships with the repo (MaxMind requires a free account to
 * download GeoLite2) — GEOIP_DB_PATH is an optional, deploy-time opt-in
 * (see DEPLOYMENT.md). Every caller of resolveCountryFromIp MUST treat a
 * null return as "assume applicable" (fail closed) for whatever policy
 * consumes it — this module only resolves IP → country, it does not decide
 * applicability itself.
 */
let cachedReader: Reader<CountryResponse> | null | undefined;

function getReader(): Reader<CountryResponse> | null {
  if (cachedReader !== undefined) return cachedReader;
  const dbPath = process.env.GEOIP_DB_PATH;
  if (!dbPath || !existsSync(dbPath)) {
    cachedReader = null;
    return null;
  }
  try {
    cachedReader = new Reader<CountryResponse>(require('fs').readFileSync(dbPath));
  } catch {
    cachedReader = null;
  }
  return cachedReader;
}

/** Resolve an IP to an ISO 3166-1 alpha-2 country code, or null if it can't
 * be resolved (no database configured, lookup miss, or invalid/private IP). */
export function resolveCountryFromIp(ip: string): string | null {
  const reader = getReader();
  if (!reader) return null;
  try {
    const result = reader.get(ip);
    return result?.country?.iso_code ?? null;
  } catch {
    return null;
  }
}

/** Test-only: force the next resolveCountryFromIp call to re-read
 * GEOIP_DB_PATH and reconstruct the Reader, instead of reusing the cache. */
export function __resetGeoipReaderForTests(): void {
  cachedReader = undefined;
}
```

- [ ] **Step 11: Run test to verify it passes**

Run: `pnpm --filter @sassy-auth/auth-server test -- geoip.service`
Expected: PASS (3 tests)

- [ ] **Step 12: Document `GEOIP_DB_PATH` in `DEPLOYMENT.md`**

Find the existing environment-variable table in `DEPLOYMENT.md` (the block containing `AUTH_SERVER_URL` rows around line 270) and add a row plus a short explanatory paragraph directly below that table:

```markdown
| `GEOIP_DB_PATH` | *(unset)* |
```

```markdown
**GDPR geo-detection (`GEOIP_DB_PATH`, optional).** When an app configures
a GDPR disclosure URL, signup/login must additionally gate on whether the
request looks like it originates from the EU/EEA, UK, or Switzerland. This
deployment resolves that locally via a MaxMind GeoLite2-Country database —
no per-request external API call. Download the free `GeoLite2-Country.mmdb`
file from a MaxMind account (https://www.maxmind.com/en/geolite2/signup)
and point `GEOIP_DB_PATH` at its path on disk. If `GEOIP_DB_PATH` is unset,
or the file can't be read, the feature fails closed: every signup/login is
treated as GDPR-applicable rather than silently skipping the check.
```

- [ ] **Step 13: Commit**

```bash
git add apps/auth-server/src/common/net apps/auth-server/src/common/geoip apps/auth-server/src/auth/auth-rate-limit.ts apps/auth-server/package.json pnpm-lock.yaml DEPLOYMENT.md
git commit -m "feat(auth-server): add local GeoLite2 country lookup for GDPR gating"
```

---

## Task 4: `resolveRequiredConsent`

**Files:**
- Create: `apps/auth-server/src/consent/resolve-required-consent.ts`
- Create: `apps/auth-server/src/consent/resolve-required-consent.spec.ts`

**Interfaces:**
- Consumes: `isGdprCountry` (Task 2), `ConsentDocumentType` (Task 1).
- Produces: `ConsentAppUrls` interface and `resolveRequiredConsent(app, countryCode): Array<{ documentType: ConsentDocumentType; url: string }>`, consumed by Task 5, Task 9, Task 11, Task 14.

- [ ] **Step 1: Write the failing test**

```ts
// apps/auth-server/src/consent/resolve-required-consent.spec.ts
import { resolveRequiredConsent } from './resolve-required-consent';

describe('resolveRequiredConsent', () => {
  it('returns nothing when the app configures no documents', () => {
    const app = { privacyPolicyUrl: null, termsUrl: null, gdprUrl: null };
    expect(resolveRequiredConsent(app, 'US')).toEqual([]);
  });

  it('includes privacy_policy and terms whenever their URL is set, regardless of country', () => {
    const app = { privacyPolicyUrl: 'https://a.example.com/privacy', termsUrl: 'https://a.example.com/terms', gdprUrl: null };
    expect(resolveRequiredConsent(app, 'US')).toEqual([
      { documentType: 'privacy_policy', url: 'https://a.example.com/privacy' },
      { documentType: 'terms', url: 'https://a.example.com/terms' },
    ]);
  });

  it('includes gdpr when its URL is set and the country is GDPR-applicable', () => {
    const app = { privacyPolicyUrl: null, termsUrl: null, gdprUrl: 'https://a.example.com/gdpr' };
    expect(resolveRequiredConsent(app, 'DE')).toEqual([{ documentType: 'gdpr', url: 'https://a.example.com/gdpr' }]);
  });

  it('excludes gdpr when its URL is set but the country is not GDPR-applicable', () => {
    const app = { privacyPolicyUrl: null, termsUrl: null, gdprUrl: 'https://a.example.com/gdpr' };
    expect(resolveRequiredConsent(app, 'US')).toEqual([]);
  });

  it('fails closed: includes gdpr when its URL is set and the country is unresolved (null)', () => {
    const app = { privacyPolicyUrl: null, termsUrl: null, gdprUrl: 'https://a.example.com/gdpr' };
    expect(resolveRequiredConsent(app, null)).toEqual([{ documentType: 'gdpr', url: 'https://a.example.com/gdpr' }]);
  });

  it('excludes gdpr regardless of country when gdprUrl is not set', () => {
    const app = { privacyPolicyUrl: null, termsUrl: null, gdprUrl: null };
    expect(resolveRequiredConsent(app, null)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sassy-auth/auth-server test -- resolve-required-consent`
Expected: FAIL with "Cannot find module './resolve-required-consent'"

- [ ] **Step 3: Write the implementation**

```ts
// apps/auth-server/src/consent/resolve-required-consent.ts
import type { ConsentDocumentType } from '@sassy-auth/types';
import { isGdprCountry } from '../common/geoip/gdpr-countries';

export interface ConsentAppUrls {
  privacyPolicyUrl: string | null;
  termsUrl: string | null;
  gdprUrl: string | null;
}

export interface RequiredConsentDocument {
  documentType: ConsentDocumentType;
  url: string;
}

/**
 * Which documents this app currently requires acceptance of, for a request
 * resolved to `countryCode` (or `null` if it could not be resolved).
 * Privacy Policy and Terms are geo-independent — outstanding whenever their
 * URL is configured. GDPR additionally requires the country to be
 * GDPR-applicable; a `null` countryCode (unresolved) fails closed and is
 * treated as applicable — see geoip.service.ts and
 * docs/superpowers/specs/2026-09-22-signup-legal-consent-design.md.
 */
export function resolveRequiredConsent(
  app: ConsentAppUrls,
  countryCode: string | null,
): RequiredConsentDocument[] {
  const required: RequiredConsentDocument[] = [];
  if (app.privacyPolicyUrl) required.push({ documentType: 'privacy_policy', url: app.privacyPolicyUrl });
  if (app.termsUrl) required.push({ documentType: 'terms', url: app.termsUrl });
  if (app.gdprUrl && (countryCode === null || isGdprCountry(countryCode))) {
    required.push({ documentType: 'gdpr', url: app.gdprUrl });
  }
  return required;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sassy-auth/auth-server test -- resolve-required-consent`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/consent/resolve-required-consent.ts apps/auth-server/src/consent/resolve-required-consent.spec.ts
git commit -m "feat(auth-server): add resolveRequiredConsent"
```

---

## Task 5: `resolveOutstandingConsent`

**Files:**
- Create: `apps/auth-server/src/consent/resolve-outstanding-consent.ts`
- Create: `apps/auth-server/src/consent/resolve-outstanding-consent.spec.ts`

**Interfaces:**
- Consumes: `resolveRequiredConsent`, `ConsentAppUrls`, `RequiredConsentDocument` (Task 4).
- Produces: `ConsentReadClient` interface and `resolveOutstandingConsent(db, saUserId, appId, app, countryCode): Promise<RequiredConsentDocument[]>`, consumed by Task 9, Task 11, Task 14.

- [ ] **Step 1: Write the failing test**

```ts
// apps/auth-server/src/consent/resolve-outstanding-consent.spec.ts
import { resolveOutstandingConsent } from './resolve-outstanding-consent';

describe('resolveOutstandingConsent', () => {
  function fakeDb(existingDocumentTypes: string[]) {
    return {
      saUserConsent: {
        findMany: jest.fn().mockResolvedValue(existingDocumentTypes.map((documentType) => ({ documentType }))),
      },
    };
  }

  const app = {
    privacyPolicyUrl: 'https://a.example.com/privacy',
    termsUrl: 'https://a.example.com/terms',
    gdprUrl: 'https://a.example.com/gdpr',
  };

  it('returns every required document when none have been accepted yet', async () => {
    const db = fakeDb([]);
    const result = await resolveOutstandingConsent(db, 1, 10, app, 'DE');
    expect(result).toEqual([
      { documentType: 'privacy_policy', url: 'https://a.example.com/privacy' },
      { documentType: 'terms', url: 'https://a.example.com/terms' },
      { documentType: 'gdpr', url: 'https://a.example.com/gdpr' },
    ]);
    expect(db.saUserConsent.findMany).toHaveBeenCalledWith({
      where: { saUserId: 1, appId: 10 },
      select: { documentType: true },
    });
  });

  it('excludes documents that already have a SaUserConsent row', async () => {
    const db = fakeDb(['privacy_policy']);
    const result = await resolveOutstandingConsent(db, 1, 10, app, 'DE');
    expect(result).toEqual([
      { documentType: 'terms', url: 'https://a.example.com/terms' },
      { documentType: 'gdpr', url: 'https://a.example.com/gdpr' },
    ]);
  });

  it('returns an empty array once every required document has been accepted', async () => {
    const db = fakeDb(['privacy_policy', 'terms', 'gdpr']);
    const result = await resolveOutstandingConsent(db, 1, 10, app, 'DE');
    expect(result).toEqual([]);
  });

  it('never requires gdpr for a non-applicable country, regardless of existing rows', async () => {
    const db = fakeDb([]);
    const result = await resolveOutstandingConsent(db, 1, 10, app, 'US');
    expect(result).toEqual([
      { documentType: 'privacy_policy', url: 'https://a.example.com/privacy' },
      { documentType: 'terms', url: 'https://a.example.com/terms' },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sassy-auth/auth-server test -- resolve-outstanding-consent`
Expected: FAIL with "Cannot find module './resolve-outstanding-consent'"

- [ ] **Step 3: Write the implementation**

```ts
// apps/auth-server/src/consent/resolve-outstanding-consent.ts
import type { ConsentDocumentType } from '@sassy-auth/types';
import { resolveRequiredConsent, type ConsentAppUrls, type RequiredConsentDocument } from './resolve-required-consent';

export interface ConsentReadClient {
  saUserConsent: {
    findMany(args: {
      where: { saUserId: number; appId: number };
      select: { documentType: true };
    }): Promise<Array<{ documentType: string }>>;
  };
}

/**
 * Which of this app's currently-required documents this SaUser has NOT yet
 * accepted for this app. A document's mere presence in SaUserConsent means
 * permanent acceptance — see resolveRequiredConsent's countryCode handling
 * for how GDPR applicability is decided per-request.
 */
export async function resolveOutstandingConsent(
  db: ConsentReadClient,
  saUserId: number,
  appId: number,
  app: ConsentAppUrls,
  countryCode: string | null,
): Promise<RequiredConsentDocument[]> {
  const required = resolveRequiredConsent(app, countryCode);
  if (required.length === 0) return [];
  const existing = await db.saUserConsent.findMany({
    where: { saUserId, appId },
    select: { documentType: true },
  });
  const acceptedTypes = new Set(existing.map((e) => e.documentType as ConsentDocumentType));
  return required.filter((doc) => !acceptedTypes.has(doc.documentType));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sassy-auth/auth-server test -- resolve-outstanding-consent`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/consent/resolve-outstanding-consent.ts apps/auth-server/src/consent/resolve-outstanding-consent.spec.ts
git commit -m "feat(auth-server): add resolveOutstandingConsent"
```

---

## Task 6: `recordConsent`

**Files:**
- Create: `apps/auth-server/src/consent/record-consent.ts`
- Create: `apps/auth-server/src/consent/record-consent.spec.ts`

**Interfaces:**
- Consumes: `RequiredConsentDocument` (Task 4).
- Produces: `ConsentWriteClient` interface and `recordConsent(db, saUserId, appId, documents): Promise<void>`, consumed by Task 9, Task 11.

- [ ] **Step 1: Write the failing test**

```ts
// apps/auth-server/src/consent/record-consent.spec.ts
import { recordConsent } from './record-consent';

describe('recordConsent', () => {
  it('does nothing when there are no documents to record', async () => {
    const db = { saUserConsent: { createMany: jest.fn() } };
    await recordConsent(db, 1, 10, []);
    expect(db.saUserConsent.createMany).not.toHaveBeenCalled();
  });

  it('writes one row per accepted document, carrying its url snapshot', async () => {
    const db = { saUserConsent: { createMany: jest.fn().mockResolvedValue({ count: 2 }) } };
    await recordConsent(db, 1, 10, [
      { documentType: 'privacy_policy', url: 'https://a.example.com/privacy' },
      { documentType: 'gdpr', url: 'https://a.example.com/gdpr' },
    ]);
    expect(db.saUserConsent.createMany).toHaveBeenCalledWith({
      data: [
        { saUserId: 1, appId: 10, documentType: 'privacy_policy', url: 'https://a.example.com/privacy' },
        { saUserId: 1, appId: 10, documentType: 'gdpr', url: 'https://a.example.com/gdpr' },
      ],
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sassy-auth/auth-server test -- record-consent`
Expected: FAIL with "Cannot find module './record-consent'"

- [ ] **Step 3: Write the implementation**

```ts
// apps/auth-server/src/consent/record-consent.ts
import type { RequiredConsentDocument } from './resolve-required-consent';

export interface ConsentWriteClient {
  saUserConsent: {
    createMany(args: {
      data: Array<{ saUserId: number; appId: number; documentType: string; url: string }>;
    }): Promise<unknown>;
  };
}

/**
 * Write one SaUserConsent row per accepted document. Accepts any client
 * that implements ConsentWriteClient — a plain `prisma` for a standalone
 * write, or a `tx` client inside a `prisma.$transaction` callback (see
 * registration.service.ts's use of the same pattern for SaUser creation).
 */
export async function recordConsent(
  db: ConsentWriteClient,
  saUserId: number,
  appId: number,
  documents: RequiredConsentDocument[],
): Promise<void> {
  if (documents.length === 0) return;
  await db.saUserConsent.createMany({
    data: documents.map((doc) => ({ saUserId, appId, documentType: doc.documentType, url: doc.url })),
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sassy-auth/auth-server test -- record-consent`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/consent/record-consent.ts apps/auth-server/src/consent/record-consent.spec.ts
git commit -m "feat(auth-server): add recordConsent"
```

---

## Task 7: Admin app config — backend (`UpdateAppDto` + `AppsService`)

**Files:**
- Modify: `apps/auth-server/src/apps/dto/update-app.dto.ts`
- Modify: `apps/auth-server/src/apps/apps.service.ts`
- Modify: `apps/auth-server/src/apps/apps.service.spec.ts`

**Interfaces:**
- Produces: `UpdateAppDto.privacyPolicyUrl / termsUrl / gdprUrl` (`string | null`, optional), `formatApp()`'s output gains the same three fields (consumed by Task 8's admin frontend and by Task 9/14's app lookups elsewhere in auth-server, which read the raw Prisma row directly, not `formatApp`'s output).

- [ ] **Step 1: Write the failing tests**

Add to `apps/auth-server/src/apps/apps.service.spec.ts`, in the `describe('updateApp', ...)` block (find it near the existing `'updateApp sets webhookUrl when provided'` test around line 388, and add these alongside it):

```ts
  it('updateApp sets privacyPolicyUrl, termsUrl, and gdprUrl when provided', async () => {
    mockPrisma.saApp.findUnique.mockResolvedValue({ ...appRow, redirectUris: [] });
    mockPrisma.$transaction.mockImplementation(async (cb) => cb({
      saApp: { update: jest.fn().mockResolvedValue({
        ...appRow,
        privacyPolicyUrl: 'https://portal.example.com/privacy',
        termsUrl: 'https://portal.example.com/terms',
        gdprUrl: 'https://portal.example.com/gdpr',
      }) },
      saAppRedirectUri: mockPrisma.saAppRedirectUri,
    }));

    const result = await service.updateApp('caller', 'sq_1', {
      privacyPolicyUrl: 'https://portal.example.com/privacy',
      termsUrl: 'https://portal.example.com/terms',
      gdprUrl: 'https://portal.example.com/gdpr',
    } as never);

    expect(result.privacyPolicyUrl).toBe('https://portal.example.com/privacy');
    expect(result.termsUrl).toBe('https://portal.example.com/terms');
    expect(result.gdprUrl).toBe('https://portal.example.com/gdpr');
  });

  it('updateApp clears privacyPolicyUrl/termsUrl/gdprUrl when set to null', async () => {
    mockPrisma.saApp.findUnique.mockResolvedValue({
      ...appRow,
      redirectUris: [],
      privacyPolicyUrl: 'https://old.example.com/privacy',
      termsUrl: 'https://old.example.com/terms',
      gdprUrl: 'https://old.example.com/gdpr',
    });
    const updateFn = jest.fn().mockResolvedValue({ ...appRow, privacyPolicyUrl: null, termsUrl: null, gdprUrl: null });
    mockPrisma.$transaction.mockImplementation(async (cb) => cb({
      saApp: { update: updateFn },
      saAppRedirectUri: mockPrisma.saAppRedirectUri,
    }));

    await service.updateApp('caller', 'sq_1', {
      privacyPolicyUrl: null,
      termsUrl: null,
      gdprUrl: null,
    } as never);

    expect(updateFn).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ privacyPolicyUrl: null, termsUrl: null, gdprUrl: null }),
    }));
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sassy-auth/auth-server test -- apps.service`
Expected: FAIL — `result.privacyPolicyUrl` is `undefined` (the DTO/service don't know this field yet).

- [ ] **Step 3: Add the DTO fields**

In `apps/auth-server/src/apps/dto/update-app.dto.ts`, add after the existing `webhookUrl` field:

```ts
  /**
   * URL to this app's Privacy Policy. When set, self-serve signup and every
   * login path require the user to accept it before reaching the app (see
   * consent/resolve-required-consent.ts). null clears it.
   */
  @IsOptional() @IsAppUrl() @MaxLength(2048) privacyPolicyUrl?: string | null;

  /** URL to this app's Terms and Conditions. Same acceptance rule as privacyPolicyUrl. */
  @IsOptional() @IsAppUrl() @MaxLength(2048) termsUrl?: string | null;

  /**
   * URL to this app's GDPR disclosure. Acceptance is additionally
   * conditional on geo-detected applicability — see
   * consent/resolve-required-consent.ts.
   */
  @IsOptional() @IsAppUrl() @MaxLength(2048) gdprUrl?: string | null;
```

- [ ] **Step 4: Wire the fields into `formatApp` and `updateApp`**

In `apps/auth-server/src/apps/apps.service.ts`:

Add to the `AppRow` type (after `webhookSecret?: string | null;`):

```ts
  privacyPolicyUrl?: string | null;
  termsUrl?: string | null;
  gdprUrl?: string | null;
```

Add to `formatApp`'s returned object (after `hasWebhookSecret: Boolean(a.webhookSecret),`):

```ts
    privacyPolicyUrl: a.privacyPolicyUrl ?? null,
    termsUrl: a.termsUrl ?? null,
    gdprUrl: a.gdprUrl ?? null,
```

In `updateApp`'s "at least one field" guard, add the three new checks alongside the existing `dto.webhookUrl === undefined` line:

```ts
      dto.webhookUrl === undefined &&
      dto.privacyPolicyUrl === undefined &&
      dto.termsUrl === undefined &&
      dto.gdprUrl === undefined &&
      dto.activationEmailOverride === undefined
```

(and extend the accompanying error message string to mention `privacyPolicyUrl, termsUrl, gdprUrl`).

In the `tx.saApp.update` call's `data` object, add after the `webhookUrl` block:

```ts
            ...(dto.privacyPolicyUrl !== undefined && { privacyPolicyUrl: dto.privacyPolicyUrl }),
            ...(dto.termsUrl !== undefined && { termsUrl: dto.termsUrl }),
            ...(dto.gdprUrl !== undefined && { gdprUrl: dto.gdprUrl }),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @sassy-auth/auth-server test -- apps.service`
Expected: PASS (all existing tests plus the 2 new ones)

- [ ] **Step 6: Commit**

```bash
git add apps/auth-server/src/apps/dto/update-app.dto.ts apps/auth-server/src/apps/apps.service.ts apps/auth-server/src/apps/apps.service.spec.ts
git commit -m "feat(auth-server): add privacyPolicyUrl/termsUrl/gdprUrl to app config"
```

---

## Task 8: Admin app config — frontend (edit drawer)

**Files:**
- Modify: `apps/admin/lib/types.ts`
- Modify: `apps/admin/components/app-edit-drawer.tsx`
- Modify: `apps/admin/messages/en.json`
- Modify: `apps/admin/messages/fr.json`
- Test: `apps/admin/components/__tests__/app-edit-drawer.test.tsx` (find the existing test file for this component and extend it)

**Interfaces:**
- Consumes: `App.privacyPolicyUrl / termsUrl / gdprUrl` (Task 7's response shape).
- Produces: nothing new consumed by later tasks — this is a leaf UI task.

- [ ] **Step 1: Add the fields to the `App`/payload types**

In `apps/admin/lib/types.ts`, add to `interface App` (after `hasWebhookSecret?: boolean;`):

```ts
  privacyPolicyUrl?: string | null;
  termsUrl?: string | null;
  gdprUrl?: string | null;
```

Add to `interface UpdateAppPayload` (after `webhookUrl?: string | null;`):

```ts
  privacyPolicyUrl?: string | null;
  termsUrl?: string | null;
  gdprUrl?: string | null;
```

- [ ] **Step 2: Add i18n strings**

In `apps/admin/messages/en.json`, inside `apps.fields`, add (near the existing `webhookUrl*` keys):

```json
    "privacyPolicyUrl": "Privacy Policy URL",
    "privacyPolicyUrlPlaceholder": "https://example.com/privacy",
    "privacyPolicyUrlHint": "When set, users must accept this before signing up or logging in.",
    "termsUrl": "Terms and Conditions URL",
    "termsUrlPlaceholder": "https://example.com/terms",
    "termsUrlHint": "When set, users must accept this before signing up or logging in.",
    "gdprUrl": "GDPR Disclosure URL",
    "gdprUrlPlaceholder": "https://example.com/gdpr",
    "gdprUrlHint": "When set, users signing up or logging in from the EU/EEA, UK, or Switzerland must accept this."
```

In `apps/admin/messages/fr.json`, inside `apps.fields`, add:

```json
    "privacyPolicyUrl": "URL de la politique de confidentialité",
    "privacyPolicyUrlPlaceholder": "https://example.com/confidentialite",
    "privacyPolicyUrlHint": "Si renseignée, les utilisateurs doivent l'accepter avant de s'inscrire ou de se connecter.",
    "termsUrl": "URL des conditions générales",
    "termsUrlPlaceholder": "https://example.com/conditions",
    "termsUrlHint": "Si renseignée, les utilisateurs doivent l'accepter avant de s'inscrire ou de se connecter.",
    "gdprUrl": "URL de la déclaration RGPD",
    "gdprUrlPlaceholder": "https://example.com/rgpd",
    "gdprUrlHint": "Si renseignée, les utilisateurs qui s'inscrivent ou se connectent depuis l'UE/EEE, le Royaume-Uni ou la Suisse doivent l'accepter."
```

- [ ] **Step 3: Write the failing component test**

Find the existing edit-drawer test file (run `find apps/admin -iname "*app-edit-drawer*" -path "*__tests__*"` to locate it) and add a test near its other field-persistence tests:

```tsx
  it('saves privacyPolicyUrl, termsUrl, and gdprUrl when edited', async () => {
    const onSuccess = jest.fn()
    mockUpdateAppAction.mockResolvedValue({ app: { ...baseApp, privacyPolicyUrl: 'https://x.example.com/privacy' } })
    render(<AppEditDrawer app={baseApp} open onOpenChange={jest.fn()} onSuccess={onSuccess} />)

    await userEvent.type(screen.getByLabelText('Privacy Policy URL'), 'https://x.example.com/privacy')
    await userEvent.type(screen.getByLabelText('Terms and Conditions URL'), 'https://x.example.com/terms')
    await userEvent.type(screen.getByLabelText('GDPR Disclosure URL'), 'https://x.example.com/gdpr')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(mockUpdateAppAction).toHaveBeenCalledWith('sq_1', expect.objectContaining({
        privacyPolicyUrl: 'https://x.example.com/privacy',
        termsUrl: 'https://x.example.com/terms',
        gdprUrl: 'https://x.example.com/gdpr',
      }))
    })
  })
```

(Match this test's exact imports/mocks/`baseApp` fixture/`mockUpdateAppAction` name to whatever the existing file in that directory already uses — every other field-persistence test in that file follows the same shape; copy its setup verbatim.)

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter @sassy-auth/admin test -- app-edit-drawer`
Expected: FAIL — `screen.getByLabelText('Privacy Policy URL')` throws (no such field rendered yet)

- [ ] **Step 5: Add the three fields to the drawer component**

In `apps/admin/components/app-edit-drawer.tsx`, add state (near the existing `webhookUrl` state declaration):

```tsx
  const [privacyPolicyUrl, setPrivacyPolicyUrl] = React.useState<string>(app.privacyPolicyUrl ?? '')
  const [termsUrl, setTermsUrl] = React.useState<string>(app.termsUrl ?? '')
  const [gdprUrl, setGdprUrl] = React.useState<string>(app.gdprUrl ?? '')
```

Add to the `useEffect` that resets state when `app` changes (the one containing `setWebhookUrl(app.webhookUrl ?? '')`):

```tsx
    setPrivacyPolicyUrl(app.privacyPolicyUrl ?? '')
    setTermsUrl(app.termsUrl ?? '')
    setGdprUrl(app.gdprUrl ?? '')
```

Add dirty-tracking constants (near `webhookUrlDirty`):

```tsx
  const privacyPolicyUrlDirty = privacyPolicyUrl.trim() !== (app.privacyPolicyUrl ?? '')
  const termsUrlDirty = termsUrl.trim() !== (app.termsUrl ?? '')
  const gdprUrlDirty = gdprUrl.trim() !== (app.gdprUrl ?? '')
```

Add them to the overall `dirty` boolean (append `|| privacyPolicyUrlDirty || termsUrlDirty || gdprUrlDirty` to its existing expression).

Widen the `patch` type declaration (the object typed inline before the save handler builds it) to add:

```tsx
privacyPolicyUrl?: string | null; termsUrl?: string | null; gdprUrl?: string | null;
```

Add the patch-building logic (mirroring the existing `if (webhookUrlDirty) { ... }` block):

```tsx
    if (privacyPolicyUrlDirty) {
      const trimmed = privacyPolicyUrl.trim()
      patch.privacyPolicyUrl = trimmed === '' ? null : trimmed
    }
    if (termsUrlDirty) {
      const trimmed = termsUrl.trim()
      patch.termsUrl = trimmed === '' ? null : trimmed
    }
    if (gdprUrlDirty) {
      const trimmed = gdprUrl.trim()
      patch.gdprUrl = trimmed === '' ? null : trimmed
    }
```

Add the three input fields to the JSX, directly after the existing `webhookUrl` `<div>` block (around line 620, right before the `webhookSecret` block):

```tsx
            <div>
              <Label htmlFor="privacyPolicyUrl">{t('apps.fields.privacyPolicyUrl')}</Label>
              <Input
                id="privacyPolicyUrl"
                type="url"
                value={privacyPolicyUrl}
                onChange={(e) => setPrivacyPolicyUrl(e.target.value)}
                placeholder={t('apps.fields.privacyPolicyUrlPlaceholder')}
              />
              <p className="mt-1 text-body-sm text-muted-foreground">
                {t('apps.fields.privacyPolicyUrlHint')}
              </p>
            </div>
            <div>
              <Label htmlFor="termsUrl">{t('apps.fields.termsUrl')}</Label>
              <Input
                id="termsUrl"
                type="url"
                value={termsUrl}
                onChange={(e) => setTermsUrl(e.target.value)}
                placeholder={t('apps.fields.termsUrlPlaceholder')}
              />
              <p className="mt-1 text-body-sm text-muted-foreground">
                {t('apps.fields.termsUrlHint')}
              </p>
            </div>
            <div>
              <Label htmlFor="gdprUrl">{t('apps.fields.gdprUrl')}</Label>
              <Input
                id="gdprUrl"
                type="url"
                value={gdprUrl}
                onChange={(e) => setGdprUrl(e.target.value)}
                placeholder={t('apps.fields.gdprUrlPlaceholder')}
              />
              <p className="mt-1 text-body-sm text-muted-foreground">
                {t('apps.fields.gdprUrlHint')}
              </p>
            </div>
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @sassy-auth/admin test -- app-edit-drawer`
Expected: PASS (all existing tests plus the new one)

- [ ] **Step 7: Commit**

```bash
git add apps/admin/lib/types.ts apps/admin/components/app-edit-drawer.tsx apps/admin/messages/en.json apps/admin/messages/fr.json apps/admin/components/__tests__
git commit -m "feat(admin): add Privacy Policy/Terms/GDPR URL fields to the app edit drawer"
```

---

## Task 9: Registration flow — backend

**Files:**
- Modify: `apps/auth-server/src/registration/register.dto.ts`
- Modify: `apps/auth-server/src/registration/registration.service.ts`
- Modify: `apps/auth-server/src/registration/registration.service.spec.ts`
- Modify: `apps/auth-server/src/registration/registration.controller.ts`

**Interfaces:**
- Consumes: `resolveRequiredConsent` (Task 4), `resolveOutstandingConsent`/not needed here (registration is pre-account, there's nothing to be "outstanding" against yet — only `resolveRequiredConsent` applies), `recordConsent` (Task 6), `resolveCountryFromIp` (Task 3), `resolveClientIp` (Task 3).
- Produces: `GET /api/register/app` response gains `privacyPolicyUrl`, `termsUrl`, `gdprUrl`, `gdprRequired`; `POST /api/register` accepts `acceptedPrivacyPolicy?`, `acceptedTerms?`, `acceptedGdpr?`.

- [ ] **Step 1: Write the failing tests**

Add to `apps/auth-server/src/registration/registration.service.spec.ts`. First extend the `appRow` fixture at the top of the file to include the new columns:

```ts
const appRow = { id: 1, publicId: 'sq_1', name: 'MyApp', isPlatform: false, passwordPolicyOverride: null, privacyPolicyUrl: null, termsUrl: null, gdprUrl: null };
```

And extend `mockPrisma.saUser.create` usage isn't needed to change signature, but add a `saUserConsent: { createMany: jest.fn() }` entry to the `jest.mock('@sassy-auth/db', ...)` block's `prisma` object (alongside the existing `saUserRole: { create: jest.fn() }` line).

Then add, inside `describe('register', ...)`:

```ts
    it('rejects with 400 when the app requires privacyPolicy acceptance and it was not accepted', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue({ ...appRow, privacyPolicyUrl: 'https://myapp.example.com/privacy' });
      await expect(service.register({ ...baseDto })).rejects.toThrow('privacyPolicy');
    });

    it('rejects with 400 when the app requires terms acceptance and it was not accepted', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue({ ...appRow, termsUrl: 'https://myapp.example.com/terms' });
      await expect(service.register({ ...baseDto, acceptedPrivacyPolicy: true })).rejects.toThrow('terms');
    });

    it('creates the account and records SaUserConsent rows when all required documents are accepted', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue({
        ...appRow,
        privacyPolicyUrl: 'https://myapp.example.com/privacy',
        termsUrl: 'https://myapp.example.com/terms',
      });
      mockSignUpEmail.mockResolvedValue({ user: { id: baUserId } });
      const createManyMock = jest.fn().mockResolvedValue({ count: 2 });
      const saUserCreateMock = jest.fn().mockResolvedValue({ id: 100, publicId: baUserId.slice(0, 12) });
      mockPrisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb({
        saOrg: mockPrisma.saOrg,
        saUser: { create: saUserCreateMock },
        saUserRole: mockPrisma.saUserRole,
        saUserConsent: { createMany: createManyMock },
      }));
      mockPrisma.saOrg.create.mockResolvedValue(draftOrgRow);
      mockPrisma.saOrg.update.mockResolvedValue(finalOrgRow);

      await service.register({
        ...baseDto,
        acceptedPrivacyPolicy: true,
        acceptedTerms: true,
      });

      expect(createManyMock).toHaveBeenCalledWith({
        data: [
          { saUserId: 100, appId: 1, documentType: 'privacy_policy', url: 'https://myapp.example.com/privacy' },
          { saUserId: 100, appId: 1, documentType: 'terms', url: 'https://myapp.example.com/terms' },
        ],
      });
    });

    it('creates the account without any SaUserConsent rows when the app requires no documents', async () => {
      mockSignUpEmail.mockResolvedValue({ user: { id: baUserId } });
      const createManyMock = jest.fn();
      const saUserCreateMock = jest.fn().mockResolvedValue({ id: 100, publicId: baUserId.slice(0, 12) });
      mockPrisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb({
        saOrg: mockPrisma.saOrg,
        saUser: { create: saUserCreateMock },
        saUserRole: mockPrisma.saUserRole,
        saUserConsent: { createMany: createManyMock },
      }));
      mockPrisma.saOrg.create.mockResolvedValue(draftOrgRow);
      mockPrisma.saOrg.update.mockResolvedValue(finalOrgRow);

      await service.register({ ...baseDto });

      expect(createManyMock).not.toHaveBeenCalled();
    });
```

Add, inside `describe('getAppName', ...)` (create the describe block if it doesn't already exist, alongside `register`):

```ts
  describe('getAppName', () => {
    it('includes privacyPolicyUrl, termsUrl, gdprUrl, and gdprRequired in the response', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue({
        name: 'MyApp',
        defaultOrgId: null,
        passwordPolicyOverride: null,
        logo: null,
        privacyPolicyUrl: 'https://myapp.example.com/privacy',
        termsUrl: null,
        gdprUrl: 'https://myapp.example.com/gdpr',
      });
      const result = await service.getAppName('sq_1', 'unknown');
      expect(result.privacyPolicyUrl).toBe('https://myapp.example.com/privacy');
      expect(result.termsUrl).toBeNull();
      expect(result.gdprUrl).toBe('https://myapp.example.com/gdpr');
      // 'unknown' IP resolves to no country → fail-closed → gdprRequired true
      expect(result.gdprRequired).toBe(true);
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sassy-auth/auth-server test -- registration.service`
Expected: FAIL — `service.register`/`service.getAppName` don't know about the new fields/params yet, and `getAppName` doesn't take a second `ip` argument.

- [ ] **Step 3: Add the DTO fields**

In `apps/auth-server/src/registration/register.dto.ts`, add:

```ts
import { IsBoolean, IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
```

(add `IsBoolean` to the existing import), and add to the class:

```ts
  /** Required (must be `true`) iff the target app has privacyPolicyUrl set. */
  @IsOptional() @IsBoolean() acceptedPrivacyPolicy?: boolean;
  /** Required (must be `true`) iff the target app has termsUrl set. */
  @IsOptional() @IsBoolean() acceptedTerms?: boolean;
  /** Required (must be `true`) iff the target app has gdprUrl set AND the
   * request is geo-detected as GDPR-applicable. */
  @IsOptional() @IsBoolean() acceptedGdpr?: boolean;
```

- [ ] **Step 4: Update `RegistrationService`**

In `apps/auth-server/src/registration/registration.service.ts`, add imports:

```ts
import { resolveRequiredConsent } from '../consent/resolve-required-consent';
import { recordConsent } from '../consent/record-consent';
import { resolveCountryFromIp } from '../common/geoip/geoip.service';
import { isGdprCountry } from '../common/geoip/gdpr-countries';
```

After the password-policy check (`validatePasswordOrThrow(...)`) and before the `defaultOrg` resolution block, add:

```ts
    // Resolve required consent against THIS request's IP — never trust
    // whatever the earlier GET /api/register/app call computed.
    const country = resolveCountryFromIp(ip);
    const requiredConsent = resolveRequiredConsent(app, country);
    for (const doc of requiredConsent) {
      const accepted = doc.documentType === 'privacy_policy' ? dto.acceptedPrivacyPolicy
        : doc.documentType === 'terms' ? dto.acceptedTerms
        : dto.acceptedGdpr;
      if (accepted !== true) {
        throw new BadRequestException(`You must accept the ${doc.documentType} before signing up`);
      }
    }
```

Change the `register` method's signature to accept the request IP:

```ts
  async register(dto: RegisterDto, ip: string): Promise<{ ok: true; orgPublicId: string; redirectUrl?: string }> {
```

Inside the `prisma.$transaction` callback, after the existing `if (app.defaultRoleId) { ... }` block and before the `return { org: targetOrg, saUserPublicId: ... }` line, add:

```ts
        await recordConsent(tx, createdSaUser.id, app.id, requiredConsent);
```

Update `getAppName` to accept an IP and return the new fields:

```ts
  async getAppName(
    appPublicId: string,
    ip: string,
  ): Promise<{
    name: string; hasDefaultOrg: boolean; passwordPolicy: PasswordPolicy; logo: string | null;
    privacyPolicyUrl: string | null; termsUrl: string | null; gdprUrl: string | null; gdprRequired: boolean;
  }> {
    if (!appPublicId) throw new NotFoundException('App not found');
    const app = await prisma.saApp.findUnique({
      where: { publicId: appPublicId },
      select: {
        name: true, defaultOrgId: true, passwordPolicyOverride: true, logo: true,
        privacyPolicyUrl: true, termsUrl: true, gdprUrl: true,
      },
    });
    if (!app) throw new NotFoundException('App not found');
    const country = resolveCountryFromIp(ip);
    return {
      name: app.name,
      hasDefaultOrg: app.defaultOrgId !== null,
      passwordPolicy: resolvePasswordPolicy(app),
      logo: app.logo ?? null,
      privacyPolicyUrl: app.privacyPolicyUrl ?? null,
      termsUrl: app.termsUrl ?? null,
      gdprUrl: app.gdprUrl ?? null,
      // Advisory only — the POST /api/register call re-resolves this
      // itself against its own request's IP (see register() above).
      gdprRequired: Boolean(app.gdprUrl) && (country === null || isGdprCountry(country)),
    };
  }
```

No change is needed to the `app.id` lookup inside `register()` itself: the existing `prisma.saApp.findUnique({ where: { publicId: dto.appPublicId } })` call there has no `select`, so it already returns `id`, `privacyPolicyUrl`, `termsUrl`, and `gdprUrl` on the full row.

- [ ] **Step 5: Update the controller to pass the request IP**

In `apps/auth-server/src/registration/registration.controller.ts`, add imports:

```ts
import { Req } from '@nestjs/common';
import { Request } from 'express';
import { resolveClientIp } from '../common/net/resolve-client-ip';
```

Update both handlers:

```ts
  @Post()
  @UseGuards(RateLimitGuard)
  register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.service.register(dto, resolveClientIp(req));
  }

  @Get('app')
  @UseGuards(AppLookupRateLimitGuard)
  getAppName(@Query('appPublicId') appPublicId: string, @Req() req: Request) {
    return this.service.getAppName(appPublicId, resolveClientIp(req));
  }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @sassy-auth/auth-server test -- registration.service`
Expected: PASS (all existing tests plus the new ones)

Also run the controller spec to catch any signature drift:

Run: `pnpm --filter @sassy-auth/auth-server test -- registration.controller`
Expected: PASS (update the controller spec's `service.register`/`service.getAppName` mock call assertions to include the new second `ip` argument if that spec asserts exact call arguments — check it and adjust as needed to keep it passing.)

- [ ] **Step 7: Commit**

```bash
git add apps/auth-server/src/registration
git commit -m "feat(auth-server): enforce required consent on self-serve signup"
```

---

## Task 10: Registration flow — frontend (`/signup`)

**Files:**
- Modify: `apps/admin/lib/app-info.ts`
- Modify: `apps/admin/app/signup/signup-form.tsx`
- Modify: `apps/admin/app/signup/actions.ts`
- Modify: `apps/admin/messages/en.json`
- Modify: `apps/admin/messages/fr.json`
- Modify: `apps/admin/app/signup/__tests__/signup-form.test.tsx`

**Interfaces:**
- Consumes: `GET /api/register/app`'s new fields (Task 9).
- Produces: nothing new consumed by later tasks — this is a leaf UI task.

- [ ] **Step 1: Extend `fetchAppInfo`**

In `apps/admin/lib/app-info.ts`, update the return type and parsing:

```ts
export async function fetchAppInfo(
  clientId: string,
): Promise<{
  name: string | null; hasDefaultOrg: boolean; passwordPolicy: PasswordPolicy | null; logo: string | null;
  privacyPolicyUrl: string | null; termsUrl: string | null; gdprUrl: string | null; gdprRequired: boolean;
}> {
  try {
    const res = await fetch(`${AUTH_SERVER}/api/register/app?appPublicId=${encodeURIComponent(clientId)}`, {
      cache: 'no-store',
    })
    if (!res.ok) {
      return {
        name: null, hasDefaultOrg: false, passwordPolicy: null, logo: null,
        privacyPolicyUrl: null, termsUrl: null, gdprUrl: null, gdprRequired: false,
      }
    }
    const body = (await res.json()) as {
      name?: string; hasDefaultOrg?: boolean; passwordPolicy?: PasswordPolicy; logo?: string | null;
      privacyPolicyUrl?: string | null; termsUrl?: string | null; gdprUrl?: string | null; gdprRequired?: boolean;
    }
    return {
      name: typeof body.name === 'string' ? body.name : null,
      hasDefaultOrg: body.hasDefaultOrg === true,
      passwordPolicy: body.passwordPolicy ?? null,
      logo: typeof body.logo === 'string' ? body.logo : null,
      privacyPolicyUrl: typeof body.privacyPolicyUrl === 'string' ? body.privacyPolicyUrl : null,
      termsUrl: typeof body.termsUrl === 'string' ? body.termsUrl : null,
      gdprUrl: typeof body.gdprUrl === 'string' ? body.gdprUrl : null,
      gdprRequired: body.gdprRequired === true,
    }
  } catch {
    return {
      name: null, hasDefaultOrg: false, passwordPolicy: null, logo: null,
      privacyPolicyUrl: null, termsUrl: null, gdprUrl: null, gdprRequired: false,
    }
  }
}
```

- [ ] **Step 2: Update `SignupPage` to pass the new props through**

In `apps/admin/app/signup/page.tsx`, destructure the new fields from `fetchAppInfo`'s result and pass them to `SignupForm`:

```tsx
  const { name: appName, hasDefaultOrg, passwordPolicy, logo, privacyPolicyUrl, termsUrl, gdprUrl, gdprRequired } = await fetchAppInfo(clientId)
```

```tsx
      <SignupForm
        clientId={clientId}
        next={nextSafe}
        hasDefaultOrg={hasDefaultOrg}
        passwordPolicy={passwordPolicy}
        privacyPolicyUrl={privacyPolicyUrl}
        termsUrl={termsUrl}
        gdprUrl={gdprRequired ? gdprUrl : null}
      />
```

- [ ] **Step 3: Add i18n strings**

In `apps/admin/messages/en.json`, inside `signup`, add:

```json
    "acceptPrivacyPolicy": "I have read and accept the <link>Privacy Policy</link>",
    "acceptTerms": "I have read and accept the <link>Terms and Conditions</link>",
    "acceptGdpr": "I have read and accept the <link>GDPR Disclosure</link>",
```

In `apps/admin/messages/fr.json`, inside `signup`, add:

```json
    "acceptPrivacyPolicy": "J'ai lu et j'accepte la <link>politique de confidentialité</link>",
    "acceptTerms": "J'ai lu et j'accepte les <link>conditions générales</link>",
    "acceptGdpr": "J'ai lu et j'accepte la <link>déclaration RGPD</link>",
```

- [ ] **Step 4: Write the failing component test**

Add to `apps/admin/app/signup/__tests__/signup-form.test.tsx`:

```tsx
  it('renders a checkbox for each configured document and requires it before submit is enabled', () => {
    render(
      <SignupForm
        clientId="sq_1"
        next=""
        hasDefaultOrg
        passwordPolicy={null}
        privacyPolicyUrl="https://x.example.com/privacy"
        termsUrl="https://x.example.com/terms"
        gdprUrl={null}
      />,
    )
    expect(screen.getByRole('checkbox', { name: /Privacy Policy/i })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /Terms and Conditions/i })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: /GDPR/i })).not.toBeInTheDocument()
  })

  it('passes only the accepted flags for checkboxes that were actually rendered', async () => {
    render(
      <SignupForm
        clientId="sq_1"
        next=""
        hasDefaultOrg
        passwordPolicy={null}
        privacyPolicyUrl="https://x.example.com/privacy"
        termsUrl={null}
        gdprUrl={null}
      />,
    )
    await userEvent.type(screen.getByLabelText('First Name'), 'Ada')
    await userEvent.type(screen.getByLabelText('Last Name'), 'Lovelace')
    await userEvent.type(screen.getByLabelText('Email Address'), 'ada@example.com')
    await userEvent.type(screen.getByLabelText('Password', { exact: true }), 'StrongPass123')
    await userEvent.type(screen.getByLabelText('Confirm Password'), 'StrongPass123')
    await userEvent.click(screen.getByRole('checkbox', { name: /Privacy Policy/i }))

    expect(screen.getByRole('button', { name: 'Create account' })).toBeDisabled()
  })
```

(Match this test file's existing imports/setup exactly — every other test in this file already renders `<SignupForm>` with a similar prop set; add `privacyPolicyUrl`/`termsUrl`/`gdprUrl` props to those existing render calls too, defaulting to `null`, so the file still compiles under the new required props.)

- [ ] **Step 5: Run test to verify it fails**

Run: `pnpm --filter @sassy-auth/admin test -- signup-form`
Expected: FAIL — `SignupForm` doesn't accept/render these props yet, and TypeScript compilation fails on the existing render calls missing the new required props.

- [ ] **Step 6: Update `SignupForm`**

In `apps/admin/app/signup/signup-form.tsx`, update the props interface:

```tsx
interface SignupFormProps {
  clientId: string
  next: string
  hasDefaultOrg: boolean
  passwordPolicy: PasswordPolicy | null
  privacyPolicyUrl: string | null
  termsUrl: string | null
  gdprUrl: string | null
}
```

```tsx
export function SignupForm({ clientId, next, hasDefaultOrg, passwordPolicy, privacyPolicyUrl, termsUrl, gdprUrl }: SignupFormProps) {
```

Add state for the three checkboxes (near the other `useState` calls):

```tsx
  const [acceptedPrivacyPolicy, setAcceptedPrivacyPolicy] = React.useState(false)
  const [acceptedTerms, setAcceptedTerms] = React.useState(false)
  const [acceptedGdpr, setAcceptedGdpr] = React.useState(false)
```

Add a derived "every rendered checkbox is checked" flag, right after `passwordsMismatch`:

```tsx
  const consentSatisfied =
    (!privacyPolicyUrl || acceptedPrivacyPolicy) &&
    (!termsUrl || acceptedTerms) &&
    (!gdprUrl || acceptedGdpr)
```

Update `handleSubmit`'s `registerAction` call to include the accepted flags only for rendered checkboxes:

```tsx
      const result = await registerAction({
        clientId, firstName, lastName, email, password, turnstileToken: captchaToken,
        ...(hasDefaultOrg ? {} : { companyName }),
        ...(privacyPolicyUrl ? { acceptedPrivacyPolicy } : {}),
        ...(termsUrl ? { acceptedTerms } : {}),
        ...(gdprUrl ? { acceptedGdpr } : {}),
      })
```

Add the checkboxes to the JSX, directly after the `confirm-password` `<FormField>` and before the `{error && ...}` line:

```tsx
      {privacyPolicyUrl && (
        <label className="flex items-start gap-2 text-body-sm text-foreground">
          <input
            type="checkbox"
            checked={acceptedPrivacyPolicy}
            onChange={(e) => setAcceptedPrivacyPolicy(e.target.checked)}
            required
          />
          <span>
            {t.rich('signup.acceptPrivacyPolicy', {
              link: (chunks) => (
                <a href={privacyPolicyUrl} target="_blank" rel="noopener noreferrer" className="underline">
                  {chunks}
                </a>
              ),
            })}
          </span>
        </label>
      )}
      {termsUrl && (
        <label className="flex items-start gap-2 text-body-sm text-foreground">
          <input
            type="checkbox"
            checked={acceptedTerms}
            onChange={(e) => setAcceptedTerms(e.target.checked)}
            required
          />
          <span>
            {t.rich('signup.acceptTerms', {
              link: (chunks) => (
                <a href={termsUrl} target="_blank" rel="noopener noreferrer" className="underline">
                  {chunks}
                </a>
              ),
            })}
          </span>
        </label>
      )}
      {gdprUrl && (
        <label className="flex items-start gap-2 text-body-sm text-foreground">
          <input
            type="checkbox"
            checked={acceptedGdpr}
            onChange={(e) => setAcceptedGdpr(e.target.checked)}
            required
          />
          <span>
            {t.rich('signup.acceptGdpr', {
              link: (chunks) => (
                <a href={gdprUrl} target="_blank" rel="noopener noreferrer" className="underline">
                  {chunks}
                </a>
              ),
            })}
          </span>
        </label>
      )}
```

Update the submit `<Button>`'s `disabled` condition to add `|| !consentSatisfied`:

```tsx
        disabled={submitting || !policyMet || password !== confirm || password.length === 0 || !consentSatisfied}
```

- [ ] **Step 7: Update `registerAction`**

In `apps/admin/app/signup/actions.ts`, extend `RegisterInput`:

```ts
export interface RegisterInput {
  clientId: string
  firstName: string
  lastName: string
  companyName?: string
  email: string
  password: string
  turnstileToken: string
  acceptedPrivacyPolicy?: boolean
  acceptedTerms?: boolean
  acceptedGdpr?: boolean
}
```

Extend the `fetch` body:

```ts
      body: JSON.stringify({
        email: input.email,
        password: input.password,
        firstName: input.firstName,
        lastName: input.lastName,
        ...(input.companyName !== undefined && { companyName: input.companyName }),
        appPublicId: input.clientId,
        turnstileToken: input.turnstileToken,
        ...(input.acceptedPrivacyPolicy !== undefined && { acceptedPrivacyPolicy: input.acceptedPrivacyPolicy }),
        ...(input.acceptedTerms !== undefined && { acceptedTerms: input.acceptedTerms }),
        ...(input.acceptedGdpr !== undefined && { acceptedGdpr: input.acceptedGdpr }),
      }),
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm --filter @sassy-auth/admin test -- signup-form`
Expected: PASS (all existing tests, updated with the new required props, plus the 2 new ones)

- [ ] **Step 9: Commit**

```bash
git add apps/admin/lib/app-info.ts apps/admin/app/signup apps/admin/messages/en.json apps/admin/messages/fr.json
git commit -m "feat(admin): render Privacy Policy/Terms/GDPR consent checkboxes on signup"
```

---

## Task 11: `GET /api/me/consent` and `POST /api/me/consent`

**Files:**
- Modify: `apps/auth-server/src/me/me.controller.ts`
- Modify: `apps/auth-server/src/me/me.service.ts`
- Modify: `apps/auth-server/src/me/me.service.spec.ts`
- Modify: `apps/auth-server/src/me/me.controller.spec.ts`

**Interfaces:**
- Consumes: `resolveOutstandingConsent`, `recordConsent`, `resolveRequiredConsent` (Tasks 4-6), `resolveCountryFromIp`, `resolveClientIp` (Task 3), `ConsentDocumentType` (Task 1).
- Produces: `GET /me/consent?appPublicId=` → `{ outstanding: Array<{ documentType, url }> }`; `POST /me/consent` body `{ appPublicId, accepted: ConsentDocumentType[] }` → `204`. Consumed by Task 12 (admin login actions) and Task 13 (`/login/consent` page).

- [ ] **Step 1: Write the failing service tests**

Add to `apps/auth-server/src/me/me.service.spec.ts` (create it if it doesn't exist yet, following the mocking pattern of `apps.service.spec.ts` — `jest.mock('@sassy-auth/db', ...)`):

```ts
import { Test } from '@nestjs/testing';
import { ForbiddenException, BadRequestException, NotFoundException } from '@nestjs/common';
import { MeService } from './me.service';

jest.mock('@sassy-auth/db', () => ({
  prisma: {
    saUser: { findUnique: jest.fn() },
    saApp: { findUnique: jest.fn() },
    saUserConsent: { findMany: jest.fn(), createMany: jest.fn() },
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockPrisma = require('@sassy-auth/db').prisma as {
  saUser: { findUnique: jest.Mock };
  saApp: { findUnique: jest.Mock };
  saUserConsent: { findMany: jest.Mock; createMany: jest.Mock };
};

describe('MeService consent', () => {
  let service: MeService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({ providers: [MeService] }).compile();
    service = module.get(MeService);
    jest.clearAllMocks();
  });

  describe('getOutstandingConsent', () => {
    it('throws ForbiddenException when the caller has no SaUser', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue(null);
      await expect(service.getOutstandingConsent('ba-1', 'sq_1', 'unknown')).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when the app does not exist', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue({ id: 100 });
      mockPrisma.saApp.findUnique.mockResolvedValue(null);
      await expect(service.getOutstandingConsent('ba-1', 'sq_1', 'unknown')).rejects.toThrow(NotFoundException);
    });

    it('returns the outstanding documents for the caller against the named app', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue({ id: 100 });
      mockPrisma.saApp.findUnique.mockResolvedValue({
        id: 1, privacyPolicyUrl: 'https://a.example.com/privacy', termsUrl: null, gdprUrl: null,
      });
      mockPrisma.saUserConsent.findMany.mockResolvedValue([]);
      const result = await service.getOutstandingConsent('ba-1', 'sq_1', 'unknown');
      expect(result).toEqual({ outstanding: [{ documentType: 'privacy_policy', url: 'https://a.example.com/privacy' }] });
    });
  });

  describe('recordMyConsent', () => {
    it('throws BadRequestException when accepting a document that is not actually required', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue({ id: 100 });
      mockPrisma.saApp.findUnique.mockResolvedValue({ id: 1, privacyPolicyUrl: null, termsUrl: null, gdprUrl: null });
      await expect(
        service.recordMyConsent('ba-1', 'sq_1', 'unknown', ['privacy_policy']),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when the accepted set does not cover every outstanding document', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue({ id: 100 });
      mockPrisma.saApp.findUnique.mockResolvedValue({
        id: 1, privacyPolicyUrl: 'https://a.example.com/privacy', termsUrl: 'https://a.example.com/terms', gdprUrl: null,
      });
      mockPrisma.saUserConsent.findMany.mockResolvedValue([]);
      await expect(
        service.recordMyConsent('ba-1', 'sq_1', 'unknown', ['privacy_policy']),
      ).rejects.toThrow(BadRequestException);
    });

    it('records consent for every outstanding document when the accepted set covers them all', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue({ id: 100 });
      mockPrisma.saApp.findUnique.mockResolvedValue({
        id: 1, privacyPolicyUrl: 'https://a.example.com/privacy', termsUrl: null, gdprUrl: null,
      });
      mockPrisma.saUserConsent.findMany.mockResolvedValue([]);
      await service.recordMyConsent('ba-1', 'sq_1', 'unknown', ['privacy_policy']);
      expect(mockPrisma.saUserConsent.createMany).toHaveBeenCalledWith({
        data: [{ saUserId: 100, appId: 1, documentType: 'privacy_policy', url: 'https://a.example.com/privacy' }],
      });
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sassy-auth/auth-server test -- me.service`
Expected: FAIL — `getOutstandingConsent`/`recordMyConsent` don't exist on `MeService` yet.

- [ ] **Step 3: Implement `MeService`'s consent methods**

In `apps/auth-server/src/me/me.service.ts`, add imports:

```ts
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { ConsentDocumentType } from '@sassy-auth/types';
import { resolveRequiredConsent } from '../consent/resolve-required-consent';
import { resolveOutstandingConsent } from '../consent/resolve-outstanding-consent';
import { recordConsent } from '../consent/record-consent';
import { resolveCountryFromIp } from '../common/geoip/geoip.service';
```

(add `NotFoundException`/`BadRequestException` to the existing `@nestjs/common` import line rather than a second import statement)

Add two methods to the `MeService` class:

```ts
  async getOutstandingConsent(
    baId: string,
    appPublicId: string,
    ip: string,
  ): Promise<{ outstanding: Array<{ documentType: ConsentDocumentType; url: string }> }> {
    const user = await prisma.saUser.findUnique({ where: { betterAuthUserId: baId }, select: { id: true } });
    if (!user) throw new ForbiddenException();
    const app = await prisma.saApp.findUnique({
      where: { publicId: appPublicId },
      select: { id: true, privacyPolicyUrl: true, termsUrl: true, gdprUrl: true },
    });
    if (!app) throw new NotFoundException('App not found');
    const country = resolveCountryFromIp(ip);
    const outstanding = await resolveOutstandingConsent(prisma, user.id, app.id, app, country);
    return { outstanding };
  }

  async recordMyConsent(
    baId: string,
    appPublicId: string,
    ip: string,
    accepted: ConsentDocumentType[],
  ): Promise<void> {
    const user = await prisma.saUser.findUnique({ where: { betterAuthUserId: baId }, select: { id: true } });
    if (!user) throw new ForbiddenException();
    const app = await prisma.saApp.findUnique({
      where: { publicId: appPublicId },
      select: { id: true, privacyPolicyUrl: true, termsUrl: true, gdprUrl: true },
    });
    if (!app) throw new NotFoundException('App not found');
    const country = resolveCountryFromIp(ip);
    const outstanding = await resolveOutstandingConsent(prisma, user.id, app.id, app, country);
    const acceptedSet = new Set(accepted);
    const missing = outstanding.filter((doc) => !acceptedSet.has(doc.documentType));
    if (missing.length > 0) {
      throw new BadRequestException(`Missing acceptance for: ${missing.map((d) => d.documentType).join(', ')}`);
    }
    // Only ever record documents that are genuinely outstanding — an
    // `accepted` entry naming a document the app doesn't require (or that
    // was already accepted) is silently ignored rather than written, so a
    // stale/forged request body can't create a phantom consent row.
    const toRecord = outstanding.filter((doc) => acceptedSet.has(doc.documentType));
    await recordConsent(prisma, user.id, app.id, toRecord);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sassy-auth/auth-server test -- me.service`
Expected: PASS (all existing tests plus the 6 new ones)

- [ ] **Step 5: Write the failing controller test**

Add to `apps/auth-server/src/me/me.controller.spec.ts` (following whatever supertest-against-Nest-app pattern that file already uses for the existing `GET /me/two-factor-status` / `POST /me/two-factor-prompted` tests — copy its `BetterAuthGuard` mock/override setup verbatim):

```ts
  it('GET /me/consent returns outstanding documents from MeService', async () => {
    mockMeService.getOutstandingConsent.mockResolvedValue({ outstanding: [{ documentType: 'terms', url: 'https://a.example.com/terms' }] });
    const res = await request(app.getHttpServer()).get('/me/consent?appPublicId=sq_1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ outstanding: [{ documentType: 'terms', url: 'https://a.example.com/terms' }] });
  });

  it('POST /me/consent calls MeService.recordMyConsent and returns 204', async () => {
    mockMeService.recordMyConsent.mockResolvedValue(undefined);
    const res = await request(app.getHttpServer())
      .post('/me/consent')
      .send({ appPublicId: 'sq_1', accepted: ['terms'] });
    expect(res.status).toBe(204);
    expect(mockMeService.recordMyConsent).toHaveBeenCalledWith(expect.any(String), 'sq_1', expect.any(String), ['terms']);
  });
```

(Match variable names — `mockMeService`, `app`, the `request` import — to whatever this file's existing tests already use; add the two new jest.fn() entries to that same mock object.)

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm --filter @sassy-auth/auth-server test -- me.controller`
Expected: FAIL — 404 (no such routes yet)

- [ ] **Step 7: Add the controller endpoints**

In `apps/auth-server/src/me/me.controller.ts`, add imports:

```ts
import { Body, Query } from '@nestjs/common';
import type { ConsentDocumentType } from '@sassy-auth/types';
import { resolveClientIp } from '../common/net/resolve-client-ip';
```

(merge `Body`/`Query` into the existing `@nestjs/common` import line)

Add two methods:

```ts
  @Get('consent')
  getOutstandingConsent(@Req() req: Request, @Query('appPublicId') appPublicId: string) {
    return this.me.getOutstandingConsent(callerBaId(req), appPublicId, resolveClientIp(req));
  }

  @Post('consent')
  @HttpCode(204)
  async recordConsent(
    @Req() req: Request,
    @Body() body: { appPublicId: string; accepted: ConsentDocumentType[] },
  ): Promise<void> {
    await this.me.recordMyConsent(callerBaId(req), body.appPublicId, resolveClientIp(req), body.accepted ?? []);
  }
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm --filter @sassy-auth/auth-server test -- me.controller`
Expected: PASS (all existing tests plus the 2 new ones)

- [ ] **Step 9: Commit**

```bash
git add apps/auth-server/src/me
git commit -m "feat(auth-server): add GET/POST /api/me/consent"
```

---

## Task 12: Login-time consent gate — password/OTP/TOTP/backup-code

**Files:**
- Create: `apps/admin/lib/consent.ts`
- Modify: `apps/admin/app/login/actions.ts`
- Create: `apps/admin/lib/__tests__/consent.test.ts`
- Modify: `apps/admin/app/login/__tests__/actions.signin.test.ts`
- Modify: `apps/admin/app/login/__tests__/actions.otp.test.ts`
- Modify: `apps/admin/app/login/__tests__/actions.totp.test.ts`

**Interfaces:**
- Consumes: `GET /api/me/consent` (Task 11).
- Produces: `extractClientId(nextStr: string | null): string | null` and `fetchOutstandingConsent(appPublicId: string): Promise<Array<{ documentType: string; url: string }>>`, consumed here and by Task 13.

**Design note (implementation-level, not in the spec):** the consent gate is inserted right after the session is established, *before* the existing optional 2FA-setup-prompt decision in `signInInner` — not after it. `TwoFactorPromptClient`'s skip/set-up buttons `router.push(next)` client-side and never pass back through these server actions, so a gate placed after that branch would silently miss anyone who goes through the 2FA prompt. Placing consent first means: sign-in → mandatory consent gate (if owed) → existing optional 2FA-setup prompt (unchanged) → target app. This keeps the change to `login/actions.ts` minimal (no changes to `TwoFactorPromptClient.tsx` or `/account/security`) and doesn't weaken 2FA enrollment — the 2FA prompt still fires on the same schedule as before, once consent (a separate, mandatory legal step) has cleared.

- [ ] **Step 1: Write the failing test for the shared consent helpers**

```ts
// apps/admin/lib/__tests__/consent.test.ts
import { extractClientId } from '../consent'

describe('extractClientId', () => {
  it('extracts client_id from a relative next URL', () => {
    expect(extractClientId('/authorize?client_id=sq_1&redirect_uri=https://x.example.com')).toBe('sq_1')
  })

  it('extracts client_id from an absolute next URL', () => {
    expect(extractClientId('https://auth.example.com/authorize?client_id=sq_1')).toBe('sq_1')
  })

  it('returns null when next has no client_id', () => {
    expect(extractClientId('/users')).toBeNull()
  })

  it('returns null for an empty/null next', () => {
    expect(extractClientId('')).toBeNull()
    expect(extractClientId(null)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sassy-auth/admin test -- lib/__tests__/consent`
Expected: FAIL with "Cannot find module '../consent'"

- [ ] **Step 3: Write `apps/admin/lib/consent.ts`**

```ts
import 'server-only'
import { cookies } from 'next/headers'

const AUTH_SERVER_URL = process.env.AUTH_SERVER_URL ?? 'https://localhost:3010'

/**
 * `next` may be a relative or absolute authorize URL carrying `client_id` —
 * the same shape login-form.tsx's clientIdFromNext and login/actions.ts's
 * applyPerAppTrustCookie already parse for their own purposes. A
 * placeholder base lets a relative `next` parse without throwing.
 */
export function extractClientId(nextStr: string | null): string | null {
  if (!nextStr) return null
  try {
    return new URL(nextStr, 'http://placeholder.invalid').searchParams.get('client_id')
  } catch {
    return null
  }
}

export interface OutstandingConsentDocument {
  documentType: string
  url: string
}

/**
 * Session-authenticated GET /api/me/consent — fails open (returns []) on
 * any transport/parse failure, same stance as the 2FA-status lookup in
 * login/actions.ts: an unreachable consent check must never block a real,
 * already-authenticated login.
 */
export async function fetchOutstandingConsent(appPublicId: string): Promise<OutstandingConsentDocument[]> {
  try {
    const cookieStore = await cookies()
    const res = await fetch(`${AUTH_SERVER_URL}/api/me/consent?appPublicId=${encodeURIComponent(appPublicId)}`, {
      headers: { Cookie: cookieStore.toString() },
      cache: 'no-store',
    })
    if (!res.ok) return []
    const data = (await res.json()) as { outstanding?: OutstandingConsentDocument[] }
    return data.outstanding ?? []
  } catch {
    return []
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sassy-auth/admin test -- lib/__tests__/consent`
Expected: PASS (4 tests)

- [ ] **Step 5: Write the failing test for `signInInner`'s gate insertion**

Add to `apps/admin/app/login/__tests__/actions.signin.test.ts`. First add a mock for the new module near the file's existing `jest.mock(...)` calls:

```ts
jest.mock('@/lib/consent', () => ({
  extractClientId: jest.fn(),
  fetchOutstandingConsent: jest.fn(),
}))
```

then, after the existing mocked imports, add:

```ts
import { extractClientId, fetchOutstandingConsent } from '@/lib/consent'
const mockExtractClientId = extractClientId as jest.MockedFunction<any>
const mockFetchOutstandingConsent = fetchOutstandingConsent as jest.MockedFunction<any>
```

and set their default behavior in `beforeEach` (find the file's existing `beforeEach` and add):

```ts
    mockExtractClientId.mockReturnValue(null)
    mockFetchOutstandingConsent.mockResolvedValue([])
```

Add a new test near the file's existing successful-sign-in test:

```ts
  it('redirects to /login/consent when the target app has outstanding consent, before the 2FA-prompt check', async () => {
    mockCookies.mockResolvedValue(cookieJar())
    mockGetForwardedOrigin.mockResolvedValue(null)
    mockExtractClientId.mockReturnValue('sq_1')
    mockFetchOutstandingConsent.mockResolvedValue([{ documentType: 'terms', url: 'https://a.example.com/terms' }])

    const { signIn } = await import('../actions')
    await expect(
      signIn(formData({ email: 'a@example.com', password: 'secret', next: '/authorize?client_id=sq_1' })),
    ).rejects.toThrow('NEXT_REDIRECT;/login/consent?appPublicId=sq_1&next=%2Fauthorize%3Fclient_id%3Dsq_1')
  })

  it('does not call the consent check when next has no client_id', async () => {
    mockCookies.mockResolvedValue(cookieJar())
    mockGetForwardedOrigin.mockResolvedValue(null)
    mockExtractClientId.mockReturnValue(null)

    const { signIn } = await import('../actions')
    await expect(signIn(formData({ email: 'a@example.com', password: 'secret' }))).rejects.toThrow('NEXT_REDIRECT')
    expect(mockFetchOutstandingConsent).not.toHaveBeenCalled()
  })
```

(These tests need `upstream(200, {}, SESSION_COOKIE)` mocked as the fetch response for `/sign-in/email`, and `global.fetch` mocked, matching exactly whatever setup pattern this file's existing successful-sign-in test already uses for `res = await fetch(...)` — copy that mock wiring, including the two-factor-status/get-session fetch mocks so `twoFactorStateKnown` stays false and the 2FA-prompt branch is skipped, isolating this test to the consent-gate behavior.)

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm --filter @sassy-auth/admin test -- actions.signin`
Expected: FAIL — no redirect to `/login/consent` occurs yet (falls straight through to `/users`)

- [ ] **Step 7: Implement the gate in `login/actions.ts`**

Add the import near the top of `apps/admin/app/login/actions.ts`:

```ts
import { extractClientId, fetchOutstandingConsent } from '@/lib/consent'
```

Add a helper function near `applyPerAppTrustCookie`:

```ts
/**
 * If `next` targets a specific app (carries client_id) and that app has
 * outstanding required consent for the current session's user, redirect to
 * the mandatory /login/consent interstitial instead of continuing. Returns
 * normally (no-op) when there is nothing outstanding, or when the consent
 * check itself is unreachable (fail open — see fetchOutstandingConsent).
 */
async function maybeRedirectToConsent(nextSafe: string | null): Promise<void> {
  const clientId = extractClientId(nextSafe)
  if (!clientId) return
  const outstanding = await fetchOutstandingConsent(clientId)
  if (outstanding.length === 0) return
  const params = new URLSearchParams({ appPublicId: clientId })
  if (nextSafe) params.set('next', nextSafe)
  redirect(`/login/consent?${params.toString()}`)
}
```

In `signInInner`, insert the call right after `const nextSafe = ...` is computed (immediately before the `// Optional 2FA interstitial` comment block):

```ts
  await maybeRedirectToConsent(nextSafe)

```

In `verifyOtp`, insert it right after `const nextSafe = ...` is computed and before `redirect(nextSafe ?? '/users')`:

```ts
  await maybeRedirectToConsent(nextSafe)
  redirect(nextSafe ?? '/users')
```

In `verifyTotp`, insert it right before the final `redirect(nextSafe ?? '/users')` (after the `if (trustDevice) { await applyPerAppTrustCookie(res, nextSafe) }` block):

```ts
  await maybeRedirectToConsent(nextSafe)
  redirect(nextSafe ?? '/users')
```

In `verifyBackupCode`, same insertion, right before its final `redirect(nextSafe ?? '/users')`.

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm --filter @sassy-auth/admin test -- actions.signin`
Expected: PASS (all existing tests plus the 2 new ones)

- [ ] **Step 9: Add matching gate tests for OTP/TOTP/backup-code and run the full login test suite**

Add one test each to `apps/admin/app/login/__tests__/actions.otp.test.ts` and `apps/admin/app/login/__tests__/actions.totp.test.ts`, mirroring Step 5's "redirects to /login/consent" test but calling `verifyOtp`/`verifyTotp` instead of `signIn`, with the same `jest.mock('@/lib/consent', ...)` setup added to each file.

Run: `pnpm --filter @sassy-auth/admin test -- app/login`
Expected: PASS (every test in `apps/admin/app/login/__tests__/`)

- [ ] **Step 10: Commit**

```bash
git add apps/admin/lib/consent.ts apps/admin/lib/__tests__/consent.test.ts apps/admin/app/login/actions.ts apps/admin/app/login/__tests__
git commit -m "feat(admin): gate password/OTP/TOTP/backup-code login on outstanding consent"
```

---

## Task 13: `/login/consent` page

**Files:**
- Create: `apps/admin/app/login/consent/page.tsx`
- Create: `apps/admin/app/login/consent/ConsentGateClient.tsx`
- Create: `apps/admin/app/login/consent/actions.ts`
- Create: `apps/admin/app/login/consent/__tests__/ConsentGateClient.test.tsx`
- Modify: `apps/admin/messages/en.json`
- Modify: `apps/admin/messages/fr.json`

**Interfaces:**
- Consumes: `fetchOutstandingConsent` (Task 12), `POST /api/me/consent` (Task 11), `validateNextUrl` (existing, from `@/lib/safe-next`).
- Produces: nothing new consumed by later tasks except Task 14's redirect target (`/login/consent?appPublicId=&next=`), which is a URL contract, not a code import.

- [ ] **Step 1: Add i18n strings**

In `apps/admin/messages/en.json`, add a new top-level `loginConsent` object (alongside `twoFactorPrompt`):

```json
  "loginConsent": {
    "title": "Before you continue",
    "body": "This app requires you to accept the following before continuing.",
    "continue": "Continue",
    "error": "We couldn't record your acceptance. Please try again."
  },
```

In `apps/admin/messages/fr.json`:

```json
  "loginConsent": {
    "title": "Avant de continuer",
    "body": "Cette application exige que vous acceptiez les éléments suivants avant de continuer.",
    "continue": "Continuer",
    "error": "Nous n'avons pas pu enregistrer votre acceptation. Veuillez réessayer."
  },
```

Reuse `signup.acceptPrivacyPolicy` / `signup.acceptTerms` / `signup.acceptGdpr` (added in Task 10) for the individual checkbox labels — no new per-document strings needed here.

- [ ] **Step 2: Write `actions.ts`**

```ts
// apps/admin/app/login/consent/actions.ts
'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import * as Sentry from '@sentry/nextjs'
import { validateNextUrl } from '@/lib/safe-next'

const AUTH_SERVER_URL = process.env.AUTH_SERVER_URL ?? 'https://localhost:3010'

export async function acceptConsentAction(
  appPublicId: string,
  accepted: string[],
  next: string,
): Promise<{ error: true } | never> {
  const cookieStore = await cookies()
  let res: Response
  try {
    res = await fetch(`${AUTH_SERVER_URL}/api/me/consent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieStore.toString() },
      body: JSON.stringify({ appPublicId, accepted }),
    })
  } catch (err) {
    Sentry.captureException(err, { tags: { area: 'auth', action: 'login-consent' } })
    return { error: true }
  }
  if (!res.ok) return { error: true }

  const nextSafe = validateNextUrl(next)
  redirect(nextSafe ?? '/users')
}
```

- [ ] **Step 3: Write `page.tsx`**

```tsx
// apps/admin/app/login/consent/page.tsx
import { AuthCard } from '@sassy-auth/ui'
import { getTranslations } from 'next-intl/server'
import { fetchOutstandingConsent } from '@/lib/consent'
import { validateNextUrl } from '@/lib/safe-next'
import { ConsentGateClient } from './ConsentGateClient'

export const dynamic = 'force-dynamic'

export default async function LoginConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ appPublicId?: string; next?: string }>
}) {
  const { appPublicId, next } = await searchParams
  const t = await getTranslations()
  const nextSafe = validateNextUrl(next) ?? ''

  const outstanding = appPublicId ? await fetchOutstandingConsent(appPublicId) : []

  return (
    <AuthCard title={t('loginConsent.title')} className="max-w-md">
      <ConsentGateClient appPublicId={appPublicId ?? ''} next={nextSafe} outstanding={outstanding} />
    </AuthCard>
  )
}
```

- [ ] **Step 4: Write the failing test for `ConsentGateClient`**

```tsx
// apps/admin/app/login/consent/__tests__/ConsentGateClient.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConsentGateClient } from '../ConsentGateClient'

jest.mock('../actions', () => ({ acceptConsentAction: jest.fn() }))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { acceptConsentAction } = require('../actions') as { acceptConsentAction: jest.Mock }

describe('ConsentGateClient', () => {
  beforeEach(() => jest.clearAllMocks())

  it('renders one checkbox per outstanding document, each required and separate', () => {
    render(
      <ConsentGateClient
        appPublicId="sq_1"
        next="/authorize?client_id=sq_1"
        outstanding={[
          { documentType: 'privacy_policy', url: 'https://a.example.com/privacy' },
          { documentType: 'terms', url: 'https://a.example.com/terms' },
        ]}
      />,
    )
    expect(screen.getByRole('checkbox', { name: /Privacy Policy/i })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /Terms and Conditions/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
  })

  it('enables Continue only once every rendered checkbox is checked, and submits all documentTypes', async () => {
    render(
      <ConsentGateClient
        appPublicId="sq_1"
        next="/authorize?client_id=sq_1"
        outstanding={[{ documentType: 'terms', url: 'https://a.example.com/terms' }]}
      />,
    )
    const checkbox = screen.getByRole('checkbox', { name: /Terms and Conditions/i })
    const button = screen.getByRole('button', { name: 'Continue' })
    expect(button).toBeDisabled()
    await userEvent.click(checkbox)
    expect(button).toBeEnabled()
    await userEvent.click(button)
    expect(acceptConsentAction).toHaveBeenCalledWith('sq_1', ['terms'], '/authorize?client_id=sq_1')
  })
})
```

- [ ] **Step 5: Run test to verify it fails**

Run: `pnpm --filter @sassy-auth/admin test -- ConsentGateClient`
Expected: FAIL with "Cannot find module '../ConsentGateClient'"

- [ ] **Step 6: Write `ConsentGateClient.tsx`**

```tsx
// apps/admin/app/login/consent/ConsentGateClient.tsx
'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@sassy-auth/ui'
import type { OutstandingConsentDocument } from '@/lib/consent'
import { acceptConsentAction } from './actions'

const LABEL_KEY: Record<string, 'acceptPrivacyPolicy' | 'acceptTerms' | 'acceptGdpr'> = {
  privacy_policy: 'acceptPrivacyPolicy',
  terms: 'acceptTerms',
  gdpr: 'acceptGdpr',
}

export function ConsentGateClient({
  appPublicId,
  next,
  outstanding,
}: {
  appPublicId: string
  next: string
  outstanding: OutstandingConsentDocument[]
}) {
  const t = useTranslations()
  const [checked, setChecked] = React.useState<Record<string, boolean>>({})
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const allChecked = outstanding.every((doc) => checked[doc.documentType])

  async function handleContinue() {
    setSubmitting(true)
    setError(null)
    try {
      const result = await acceptConsentAction(appPublicId, outstanding.map((d) => d.documentType), next)
      if (result && 'error' in result) {
        setError(t('loginConsent.error'))
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-body-md text-muted-foreground">{t('loginConsent.body')}</p>
      {outstanding.map((doc) => (
        <label key={doc.documentType} className="flex items-start gap-2 text-body-sm text-foreground">
          <input
            type="checkbox"
            checked={checked[doc.documentType] ?? false}
            onChange={(e) => setChecked((prev) => ({ ...prev, [doc.documentType]: e.target.checked }))}
          />
          <span>
            {t.rich(`signup.${LABEL_KEY[doc.documentType]}`, {
              link: (chunks) => (
                <a href={doc.url} target="_blank" rel="noopener noreferrer" className="underline">
                  {chunks}
                </a>
              ),
            })}
          </span>
        </label>
      ))}
      {error && <p className="text-label-md text-destructive">{error}</p>}
      <Button className="w-full" loading={submitting} disabled={submitting || !allChecked} onClick={handleContinue}>
        {t('loginConsent.continue')}
      </Button>
    </div>
  )
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm --filter @sassy-auth/admin test -- ConsentGateClient`
Expected: PASS (2 tests)

- [ ] **Step 8: Commit**

```bash
git add apps/admin/app/login/consent apps/admin/messages/en.json apps/admin/messages/fr.json
git commit -m "feat(admin): add mandatory /login/consent interstitial"
```

---

## Task 14: Login-time consent gate — social sign-in

**Files:**
- Create: `apps/auth-server/src/social/social-consent-context.ts`
- Create: `apps/auth-server/src/social/social-consent-context.spec.ts`
- Create: `apps/auth-server/src/social/resolve-social-consent-redirect.ts`
- Create: `apps/auth-server/src/social/resolve-social-consent-redirect.spec.ts`
- Modify: `apps/auth-server/src/auth/auth.config.ts`
- Modify: `apps/auth-server/src/main.ts`

**Interfaces:**
- Consumes: `resolveOutstandingConsent` (Task 5), `resolveCountryFromIp` (Task 3).
- Produces: nothing consumed by later tasks — this is the last enforcement point.

**Verified BetterAuth behavior (not an assumption):** inspected `better-auth@1.6.11`'s `dist/api/routes/callback.mjs` and `better-call`'s `dist/context.mjs`/`dist/endpoint.mjs` directly. `context.redirect(url)` — used for BOTH the success path (`throw c.redirect(toRedirectTo)`) and every error path (`redirectOnError`) — calls `headers.set("location", url)` on the exact `Headers` object that becomes `ctx.context.responseHeaders`, which `to-auth-endpoints.mjs` uses verbatim as the final response's headers. So `ctx.context.responseHeaders.get('location')` is populated with the intended redirect target for a *successful* social callback too, not just the error cases the existing `classifyCallbackOutcome` code already rewrites — the same in-place `.set()` technique applies unchanged.

- [ ] **Step 1: Write the failing test for the AsyncLocalStorage context module**

```ts
// apps/auth-server/src/social/social-consent-context.spec.ts
import { runWithSocialConsentCapture, captureSocialSignInUserId, readSocialConsentContext } from './social-consent-context';

describe('social-consent-context', () => {
  it('returns the captured ip and userId inside the same capture scope', async () => {
    await runWithSocialConsentCapture('203.0.113.7', async () => {
      captureSocialSignInUserId('ba-user-1');
      expect(readSocialConsentContext()).toEqual({ ip: '203.0.113.7', userId: 'ba-user-1' });
    });
  });

  it('returns null userId when nothing has captured it yet', async () => {
    await runWithSocialConsentCapture('203.0.113.7', async () => {
      expect(readSocialConsentContext()).toEqual({ ip: '203.0.113.7', userId: null });
    });
  });

  it('returns ip null and userId null outside any capture scope', () => {
    expect(readSocialConsentContext()).toEqual({ ip: null, userId: null });
  });

  it('keeps two concurrent capture scopes independent', async () => {
    const results: Array<{ ip: string | null; userId: string | null }> = [];
    await Promise.all([
      runWithSocialConsentCapture('1.1.1.1', async () => {
        captureSocialSignInUserId('user-a');
        await new Promise((r) => setTimeout(r, 10));
        results.push(readSocialConsentContext());
      }),
      runWithSocialConsentCapture('2.2.2.2', async () => {
        captureSocialSignInUserId('user-b');
        results.push(readSocialConsentContext());
      }),
    ]);
    expect(results).toEqual(
      expect.arrayContaining([
        { ip: '1.1.1.1', userId: 'user-a' },
        { ip: '2.2.2.2', userId: 'user-b' },
      ]),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sassy-auth/auth-server test -- social-consent-context`
Expected: FAIL with "Cannot find module './social-consent-context'"

- [ ] **Step 3: Write the implementation**

```ts
// apps/auth-server/src/social/social-consent-context.ts
import { AsyncLocalStorage } from 'node:async_hooks';

interface SocialConsentStore {
  ip: string;
  userId: string | null;
}

const storage = new AsyncLocalStorage<SocialConsentStore>();

/**
 * Hands the client IP resolved at request start (main.ts, where the raw
 * Express req is still available) forward to auth.config.ts's `/callback/:id`
 * `hooks.after` matcher, and lets `databaseHooks.session.create.after` (which
 * already runs for every social sign-in and already receives the newly
 * created session's userId) hand that userId forward too — two separate
 * BetterAuth-invoked callbacks within the same request, neither of which can
 * pass a return value to the other directly. Mirrors
 * apple-private-relay-context.ts's identical use of AsyncLocalStorage for the
 * exact same shape of problem; see that file's header comment for the full
 * rationale on why this needs to wrap the entire request in main.ts rather
 * than a single function call.
 */
export function runWithSocialConsentCapture<T>(ip: string, fn: () => T): T {
  return storage.run({ ip, userId: null }, fn);
}

/** Called from auth.config.ts's databaseHooks.session.create.after. No-op
 * outside a capture scope (e.g. a password/OTP sign-in). */
export function captureSocialSignInUserId(userId: string): void {
  const store = storage.getStore();
  if (store) store.userId = userId;
}

/** Read what this request has captured so far. Both fields are null/absent
 * outside any capture scope. */
export function readSocialConsentContext(): { ip: string | null; userId: string | null } {
  const store = storage.getStore();
  return { ip: store?.ip ?? null, userId: store?.userId ?? null };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sassy-auth/auth-server test -- social-consent-context`
Expected: PASS (4 tests)

- [ ] **Step 5: Write the failing test for the pure redirect-URL rewriter**

```ts
// apps/auth-server/src/social/resolve-social-consent-redirect.spec.ts
import { appendConsentRedirect } from './resolve-social-consent-redirect';

describe('appendConsentRedirect', () => {
  it('returns null when there is nothing outstanding', () => {
    expect(appendConsentRedirect({
      currentLocation: 'https://app.example.com/callback?code=abc',
      appPublicId: 'sq_1',
      outstanding: [],
      adminUrl: 'https://admin.example.com',
    })).toBeNull();
  });

  it('rewrites to /login/consent, carrying appPublicId and the original location as next', () => {
    const result = appendConsentRedirect({
      currentLocation: 'https://app.example.com/callback?code=abc',
      appPublicId: 'sq_1',
      outstanding: [{ documentType: 'terms', url: 'https://a.example.com/terms' }],
      adminUrl: 'https://admin.example.com',
    });
    expect(result).toBe(
      'https://admin.example.com/login/consent?appPublicId=sq_1&next=' +
        encodeURIComponent('https://app.example.com/callback?code=abc'),
    );
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm --filter @sassy-auth/auth-server test -- resolve-social-consent-redirect`
Expected: FAIL with "Cannot find module './resolve-social-consent-redirect'"

- [ ] **Step 7: Write the implementation**

```ts
// apps/auth-server/src/social/resolve-social-consent-redirect.ts
import type { RequiredConsentDocument } from '../consent/resolve-required-consent';

/**
 * Pure URL-construction step: given the browser's intended post-sign-in
 * destination and what's outstanding, decide whether to reroute through
 * /login/consent first. Kept separate from auth.config.ts's hook (which
 * does the DB lookups and header mutation) so this piece is unit-testable
 * without any BetterAuth/Prisma scaffolding.
 */
export function appendConsentRedirect(params: {
  currentLocation: string;
  appPublicId: string;
  outstanding: RequiredConsentDocument[];
  adminUrl: string;
}): string | null {
  if (params.outstanding.length === 0) return null;
  const target = new URL('/login/consent', params.adminUrl);
  target.searchParams.set('appPublicId', params.appPublicId);
  target.searchParams.set('next', params.currentLocation);
  return target.toString();
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm --filter @sassy-auth/auth-server test -- resolve-social-consent-redirect`
Expected: PASS (2 tests)

- [ ] **Step 9: Wire the capture into `main.ts`**

In `apps/auth-server/src/main.ts`, add the import:

```ts
import { runWithSocialConsentCapture } from './social/social-consent-context';
import { resolveClientIp } from './common/net/resolve-client-ip';
```

Change the existing line:

```ts
    runWithPrivateRelayCapture(() => authNodeHandler(req, res)),
```

to:

```ts
    runWithPrivateRelayCapture(() =>
      runWithSocialConsentCapture(resolveClientIp(req), () => authNodeHandler(req, res)),
    ),
```

- [ ] **Step 10: Capture the userId in the existing session-create `after` hook**

In `apps/auth-server/src/auth/auth.config.ts`, add the import:

```ts
import { captureSocialSignInUserId, readSocialConsentContext } from '../social/social-consent-context';
import { resolveOutstandingConsent } from '../consent/resolve-outstanding-consent';
import { resolveCountryFromIp } from '../common/geoip/geoip.service';
import { appendConsentRedirect } from '../social/resolve-social-consent-redirect';
```

In `databaseHooks.session.create.after`, add one line right after the existing `authLogger.warn`/`lastLoginAt` try/catch block and before the `const provider = providerFromSignInMethod(...)` line:

```ts
          captureSocialSignInUserId(session.userId);
```

- [ ] **Step 11: Add the success-path consent check to the `/callback/:id` `hooks.after` matcher**

In `apps/auth-server/src/auth/auth.config.ts`, in the existing `hooks.after` handler, the current code is:

```ts
      const outcome = classifyCallbackOutcome(ctx.context.returned, readIsPrivateEmail());
      if (!outcome) return;

      // Audit trail first (never throws) ...
      await recordFederationEvent(...);

      if (!outcome.canRedirect) {
        return;
      }

      const adminUrl = process.env.ADMIN_URL ?? 'http://localhost:3001';
      const target = `${adminUrl}/oauth-error?code=${outcome.code}`;
      ctx.context.responseHeaders?.set('location', target);
    }),
```

Replace `if (!outcome) return;` with a branch that handles the successful case instead of returning immediately:

```ts
      if (!outcome) {
        // Successful federated sign-in: gate on outstanding consent before
        // letting the browser follow BetterAuth's own success redirect.
        const currentLocation = ctx.context.responseHeaders?.get('location');
        const { ip, userId } = readSocialConsentContext();
        if (!currentLocation || !userId) return;

        const saUser = await prisma.saUser.findUnique({
          where: { betterAuthUserId: userId },
          select: { id: true },
        });
        if (!saUser) return;

        let appPublicId: string | null;
        try {
          appPublicId = new URL(currentLocation).searchParams.get('client_id');
        } catch {
          appPublicId = null;
        }
        if (!appPublicId) return;

        const app = await prisma.saApp.findUnique({
          where: { publicId: appPublicId },
          select: { id: true, privacyPolicyUrl: true, termsUrl: true, gdprUrl: true },
        });
        if (!app) return;

        const country = resolveCountryFromIp(ip ?? 'unknown');
        const outstanding = await resolveOutstandingConsent(prisma, saUser.id, app.id, app, country);
        const adminUrl = process.env.ADMIN_URL ?? 'http://localhost:3001';
        const redirectTarget = appendConsentRedirect({ currentLocation, appPublicId, outstanding, adminUrl });
        if (redirectTarget) {
          ctx.context.responseHeaders?.set('location', redirectTarget);
        }
        return;
      }
```

(the rest of the handler — audit trail, `canRedirect` check, error-code rewrite — stays exactly as it is today, now reached only when `outcome` is non-null)

- [ ] **Step 12: Run the full auth-server test suite to check for regressions**

Run: `pnpm --filter @sassy-auth/auth-server test`
Expected: PASS — every existing test (including `classify-callback-outcome.spec.ts`, `session-gate.spec.ts`, and any auth.config-adjacent specs) plus every new spec added in this plan.

- [ ] **Step 13: Commit**

```bash
git add apps/auth-server/src/social apps/auth-server/src/main.ts apps/auth-server/src/auth/auth.config.ts
git commit -m "feat(auth-server): gate social sign-in on outstanding consent"
```

---

## Task 15: E2E coverage for the full-consent signup path

**Files:**
- Modify: `apps/admin-e2e/lib/app-fixtures.ts`
- Modify: `apps/admin-e2e/pages/signup.page.ts`
- Modify: `apps/admin-e2e/tests/signup.spec.ts`

**Interfaces:**
- Consumes: `POST /api/apps` + `PATCH /api/apps/:publicId` (Task 7), `/signup`'s rendered checkboxes (Task 10).

This task covers the self-serve signup path end-to-end, since it's fully exercisable with the existing `signup.spec.ts` fixture pattern (an app created via the admin API, then driven through the real `/signup` page). The login-time gate (Task 12/14) and the `/login/consent` page (Task 13) are covered by the unit/component tests in those tasks; a full browser-driven login-time e2e (which would additionally require an admin-invited or social-authenticated test user fixture) is left as a follow-up, consistent with keeping this plan's scope to what was specified.

- [ ] **Step 1: Add a consent-document app fixture helper**

In `apps/admin-e2e/lib/app-fixtures.ts`, add a new function alongside `createAppWithPasswordPolicyOverride`:

```ts
/**
 * Creates a fresh SaApp and PATCHes it with all three consent document
 * URLs set, for signup.spec.ts's full-consent-flow test. Mirrors
 * createAppWithPasswordPolicyOverride's create-then-patch shape.
 */
export async function createAppWithConsentDocuments(): Promise<CreatedApp> {
  const appsAdmin = SEED_ADMINS.find((a) => a.key === 'apps')
  if (!appsAdmin) throw new Error("SEED_ADMINS has no 'apps' admin")

  const ctx = await pwRequest.newContext({
    baseURL: AUTH_SERVER_URL,
    storageState: path.join(__dirname, '..', appsAdmin.storageStatePath),
  })
  try {
    const name = `e2e-consent-app-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const createRes = await ctx.post('/api/apps', {
      data: { name, url: `https://example.com/${name}` },
    })
    expect(createRes.ok(), `POST /api/apps failed: ${createRes.status()} ${await createRes.text()}`).toBe(true)
    const created = (await createRes.json()) as CreatedApp

    const patchRes = await ctx.patch(`/api/apps/${created.publicId}`, {
      data: {
        privacyPolicyUrl: 'https://example.com/privacy',
        termsUrl: 'https://example.com/terms',
      },
    })
    expect(
      patchRes.ok(),
      `PATCH /api/apps/${created.publicId} failed: ${patchRes.status()} ${await patchRes.text()}`,
    ).toBe(true)

    return created
  } finally {
    await ctx.dispose()
  }
}
```

(GDPR is deliberately left unset for this fixture — exercising it requires either configuring `GEOIP_DB_PATH` in CI or mocking the geo-IP layer, which is out of scope here; Privacy Policy + Terms alone already exercises the full checkbox-rendering, required-before-submit, and consent-recording path end to end.)

- [ ] **Step 2: Add checkbox locators to `SignupPage`**

In `apps/admin-e2e/pages/signup.page.ts`, add two locators and a method:

```ts
  readonly privacyPolicyCheckbox: Locator
  readonly termsCheckbox: Locator
```

```ts
    this.privacyPolicyCheckbox = page.getByRole('checkbox', { name: /Privacy Policy/i })
    this.termsCheckbox = page.getByRole('checkbox', { name: /Terms and Conditions/i })
```

Update `fillAndSubmit` to accept an optional flag and check the boxes when present:

```ts
  async fillAndSubmit(details: SignupDetails, options: { acceptConsent?: boolean } = {}) {
    await this.firstNameInput.fill(details.firstName)
    await this.lastNameInput.fill(details.lastName)
    await this.companyNameInput.fill(details.companyName)
    await this.emailInput.fill(details.email)
    await this.passwordInput.fill(details.password)
    await this.confirmPasswordInput.fill(details.password)
    if (options.acceptConsent) {
      await this.privacyPolicyCheckbox.check()
      await this.termsCheckbox.check()
    }
    await expect
      .poll(() => this.page.locator('input[name="cf-turnstile-response"]').first().inputValue())
      .not.toBe('')
    await this.submitButton.click()
  }
```

- [ ] **Step 3: Add the e2e test**

In `apps/admin-e2e/tests/signup.spec.ts`, add the import and a new test:

```ts
import { createAppWithConsentDocuments } from '../lib/app-fixtures'
```

```ts
  test('signup requires accepting Privacy Policy and Terms when the app configures them', async ({ page }) => {
    const app = await createAppWithConsentDocuments()
    const signup = new SignupPage(page)
    const uniqueEmail = `e2e-consent-${Date.now()}@example.com`

    await signup.goto(app.publicId)
    await expect(signup.privacyPolicyCheckbox).toBeVisible()
    await expect(signup.termsCheckbox).toBeVisible()

    // Submit disabled without accepting either checkbox.
    await signup.fillAndSubmit({
      firstName: 'Grace',
      lastName: 'Hopper',
      companyName: 'Compilers Inc',
      email: uniqueEmail,
      password: 'StrongPass123!',
    })
    await expect(signup.submitButton).toBeDisabled()

    // Accept both, then submit succeeds.
    await signup.privacyPolicyCheckbox.check()
    await signup.termsCheckbox.check()
    await signup.submitButton.click()
    await expect(signup.checkEmailTitle).toBeVisible()
  })
```

- [ ] **Step 4: Run the e2e test**

Run: `pnpm --filter @sassy-auth/admin-e2e test:e2e -- signup.spec.ts`
Expected: PASS (requires `RS_CLIENT_ID` set in the environment, same precondition as the file's existing tests — if unset, this test skips exactly like its siblings, which is expected in a local run without e2e infra configured)

- [ ] **Step 5: Commit**

```bash
git add apps/admin-e2e/lib/app-fixtures.ts apps/admin-e2e/pages/signup.page.ts apps/admin-e2e/tests/signup.spec.ts
git commit -m "test(e2e): cover the full Privacy Policy/Terms signup consent flow"
```
