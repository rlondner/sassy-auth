# Dev-environment insecure URLs + per-app callback URL enforcement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow registering http/localhost apps only when sassy-auth is explicitly configured for dev, and add an optional per-app `callbackUrl` that, when set, forces the PKCE `redirect_uri` to match it exactly (trailing-slash tolerant); when unset, behaves as today (origin match against the app `url`).

**Architecture:** A single env-gated URL policy (`SASSY_AUTH_ALLOW_INSECURE_APP_URLS`, default off) is the one source of truth, consumed by a custom class-validator decorator on the app DTOs and (indirectly) reflected in admin error copy. A new nullable `SaApp.callbackUrl` column drives redirect-uri enforcement in the OAuth authorize/token endpoints.

**Tech Stack:** NestJS + class-validator (auth-server), Prisma/PostgreSQL (`packages/db`), Next.js + next-intl + `@sassy-auth/ui` (admin), Jest (unit/integration), Playwright (admin-e2e).

## Global Constraints

- New env var name, verbatim: `SASSY_AUTH_ALLOW_INSECURE_APP_URLS`. Enabled only when the value is exactly the string `"true"`. Default (unset/any other value) = secure mode.
- Secure mode: app `url` and `callbackUrl` must be `https` and a public host — reject `localhost`, `*.localhost`, loopback IPs (`127.0.0.1`, `::1`, `[::1]`), and bare hosts with no dot.
- Insecure mode: allow `http`/`https` and loopback/no-TLD hosts.
- `callbackUrl` is optional. Empty string / `null` / omitted all mean "default" and are stored as SQL `NULL`. A non-empty value enables exact-match enforcement.
- Exact match = same protocol, same host (incl. port), same query string, and same path after trimming a single trailing `/` from each side. Fragments and userinfo are ignored.
- Default (`callbackUrl` NULL) preserves today's behavior exactly: `redirect_uri` must share the same origin as `app.url`.
- Max URL length stays 2048. Read env at call time (never cache) so tests can toggle it.
- Error code for redirect rejection stays `TokenErrorCode.INVALID_REDIRECT_URI`.

---

## File Structure

**auth-server (NestJS)**
- Create `apps/auth-server/src/common/config/app-url-policy.ts` — `isInsecureAppUrlsAllowed()`, `isAppUrlAllowed(value)`.
- Create `apps/auth-server/src/common/config/app-url-policy.spec.ts` — policy unit tests.
- Create `apps/auth-server/src/common/config/is-app-url.decorator.ts` — `@IsAppUrl()` class-validator decorator.
- Create `apps/auth-server/src/common/config/is-app-url.decorator.spec.ts` — decorator + DTO validation tests.
- Modify `apps/auth-server/src/apps/dto/create-app.dto.ts`, `update-app.dto.ts` — use `@IsAppUrl()`, add `callbackUrl`.
- Modify `apps/auth-server/src/apps/apps.service.ts` — persist/return `callbackUrl`; update at-least-one check.
- Modify `apps/auth-server/src/apps/apps.service.spec.ts` — update expectations for `callbackUrl`.
- Modify `apps/auth-server/src/token/redirect-uri.ts` — rename to `assertRedirectUriAllowed(redirectUri, app)`, add exact-match.
- Modify `apps/auth-server/src/token/redirect-uri.spec.ts` — cover new behavior.
- Modify `apps/auth-server/src/token/token.controller.ts` — call new function in both OAuth endpoints.

**db (Prisma)**
- Modify `packages/db/schema.prisma` — add `callbackUrl String?` to `SaApp`.
- Create `packages/db/migrations/<ts>_app_callback_url/migration.sql` — add nullable column.

**admin (Next.js)**
- Modify `apps/admin/lib/types.ts` — add `callbackUrl` to `App`, `CreateAppPayload`, `UpdateAppPayload`.
- Modify `apps/admin/app/(admin)/apps/actions.ts` — map 400 to `apps.errors.urlInsecure`.
- Modify `apps/admin/components/app-create-drawer.tsx`, `app-edit-drawer.tsx`, `app-view-drawer.tsx` — Callback URL field + view badge.
- Modify `apps/admin/messages/en.json` — new field labels, hints, badge, error copy.

**docs/config**
- Modify `.env.example` — document the flag.
- Modify `CHANGELOG.md` — note the change.

---

## Task 1: URL policy core (`app-url-policy.ts`)

**Files:**
- Create: `apps/auth-server/src/common/config/app-url-policy.ts`
- Test: `apps/auth-server/src/common/config/app-url-policy.spec.ts`

**Interfaces:**
- Consumes: nothing (reads `process.env.SASSY_AUTH_ALLOW_INSECURE_APP_URLS`).
- Produces: `isInsecureAppUrlsAllowed(): boolean`, `isAppUrlAllowed(value: unknown): boolean`.

- [ ] **Step 1: Write the failing test**

Create `apps/auth-server/src/common/config/app-url-policy.spec.ts`:

```ts
import { isAppUrlAllowed, isInsecureAppUrlsAllowed } from './app-url-policy';

describe('app-url-policy', () => {
  const original = process.env.SASSY_AUTH_ALLOW_INSECURE_APP_URLS;
  afterEach(() => {
    if (original === undefined) delete process.env.SASSY_AUTH_ALLOW_INSECURE_APP_URLS;
    else process.env.SASSY_AUTH_ALLOW_INSECURE_APP_URLS = original;
  });

  describe('isInsecureAppUrlsAllowed', () => {
    it('is false when unset', () => {
      delete process.env.SASSY_AUTH_ALLOW_INSECURE_APP_URLS;
      expect(isInsecureAppUrlsAllowed()).toBe(false);
    });
    it('is true only for the exact string "true"', () => {
      process.env.SASSY_AUTH_ALLOW_INSECURE_APP_URLS = 'true';
      expect(isInsecureAppUrlsAllowed()).toBe(true);
      process.env.SASSY_AUTH_ALLOW_INSECURE_APP_URLS = 'TRUE';
      expect(isInsecureAppUrlsAllowed()).toBe(false);
      process.env.SASSY_AUTH_ALLOW_INSECURE_APP_URLS = '1';
      expect(isInsecureAppUrlsAllowed()).toBe(false);
    });
  });

  describe('isAppUrlAllowed (secure mode, default)', () => {
    beforeEach(() => { delete process.env.SASSY_AUTH_ALLOW_INSECURE_APP_URLS; });
    it('accepts https public host', () => {
      expect(isAppUrlAllowed('https://app.example.com/cb')).toBe(true);
    });
    it('rejects http', () => {
      expect(isAppUrlAllowed('http://app.example.com')).toBe(false);
    });
    it('rejects localhost and *.localhost', () => {
      expect(isAppUrlAllowed('https://localhost:3000')).toBe(false);
      expect(isAppUrlAllowed('https://api.localhost')).toBe(false);
    });
    it('rejects loopback IPs', () => {
      expect(isAppUrlAllowed('https://127.0.0.1:3000')).toBe(false);
      expect(isAppUrlAllowed('http://[::1]:3000')).toBe(false);
    });
    it('rejects bare host with no dot', () => {
      expect(isAppUrlAllowed('https://intranet')).toBe(false);
    });
    it('rejects non-string, empty, and malformed', () => {
      expect(isAppUrlAllowed(undefined)).toBe(false);
      expect(isAppUrlAllowed('')).toBe(false);
      expect(isAppUrlAllowed('not a url')).toBe(false);
      expect(isAppUrlAllowed('ftp://example.com')).toBe(false);
    });
  });

  describe('isAppUrlAllowed (insecure mode)', () => {
    beforeEach(() => { process.env.SASSY_AUTH_ALLOW_INSECURE_APP_URLS = 'true'; });
    it('accepts http localhost', () => {
      expect(isAppUrlAllowed('http://localhost:3000/cb')).toBe(true);
    });
    it('accepts loopback IP', () => {
      expect(isAppUrlAllowed('http://127.0.0.1:8080')).toBe(true);
    });
    it('still rejects non-http(s) and malformed', () => {
      expect(isAppUrlAllowed('ftp://localhost')).toBe(false);
      expect(isAppUrlAllowed('nonsense')).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sassy-auth/auth-server exec jest src/common/config/app-url-policy.spec.ts`
Expected: FAIL — `Cannot find module './app-url-policy'`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/auth-server/src/common/config/app-url-policy.ts`:

```ts
/**
 * Whether sassy-auth permits insecure (http / localhost / loopback / no-TLD)
 * app and callback URLs. Off by default so production stays https-only unless an
 * operator explicitly opts in. Read at call time so tests can toggle the env.
 */
export function isInsecureAppUrlsAllowed(): boolean {
  return process.env.SASSY_AUTH_ALLOW_INSECURE_APP_URLS === 'true';
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', '[::1]']);

/**
 * Validates an app or callback URL against the current security policy.
 * - Must be a parseable absolute URL with http/https protocol.
 * - Secure mode (default): requires https and a public host (rejects loopback
 *   hosts, localhost / *.localhost, and bare hosts with no dot).
 * - Insecure mode: allows http and loopback / no-TLD hosts.
 */
export function isAppUrlAllowed(value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;

  if (isInsecureAppUrlsAllowed()) return true;

  // Secure mode
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  if (LOOPBACK_HOSTS.has(host)) return false;
  if (host === 'localhost' || host.endsWith('.localhost')) return false;
  if (!host.includes('.')) return false; // no TLD → not a public host
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sassy-auth/auth-server exec jest src/common/config/app-url-policy.spec.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/common/config/app-url-policy.ts apps/auth-server/src/common/config/app-url-policy.spec.ts
git commit -m "feat(auth-server): env-gated app URL security policy"
```

---

## Task 2: `@IsAppUrl()` class-validator decorator

**Files:**
- Create: `apps/auth-server/src/common/config/is-app-url.decorator.ts`
- Test: `apps/auth-server/src/common/config/is-app-url.decorator.spec.ts`

**Interfaces:**
- Consumes: `isAppUrlAllowed`, `isInsecureAppUrlsAllowed` from `./app-url-policy`.
- Produces: `IsAppUrl(validationOptions?: ValidationOptions): PropertyDecorator`.

- [ ] **Step 1: Write the failing test**

Create `apps/auth-server/src/common/config/is-app-url.decorator.spec.ts`:

```ts
import { validateSync } from 'class-validator';
import { IsAppUrl } from './is-app-url.decorator';

class Fixture {
  @IsAppUrl()
  url!: string;
}

function makeWith(url: unknown): Fixture {
  const f = new Fixture();
  // @ts-expect-error test assigns arbitrary values
  f.url = url;
  return f;
}

describe('IsAppUrl', () => {
  const original = process.env.SASSY_AUTH_ALLOW_INSECURE_APP_URLS;
  afterEach(() => {
    if (original === undefined) delete process.env.SASSY_AUTH_ALLOW_INSECURE_APP_URLS;
    else process.env.SASSY_AUTH_ALLOW_INSECURE_APP_URLS = original;
  });

  it('passes for https public host in secure mode', () => {
    delete process.env.SASSY_AUTH_ALLOW_INSECURE_APP_URLS;
    expect(validateSync(makeWith('https://app.example.com'))).toHaveLength(0);
  });

  it('fails for http localhost in secure mode', () => {
    delete process.env.SASSY_AUTH_ALLOW_INSECURE_APP_URLS;
    const errs = validateSync(makeWith('http://localhost:3000'));
    expect(errs).toHaveLength(1);
    expect(errs[0].constraints?.isAppUrl).toContain('https');
  });

  it('passes for http localhost in insecure mode', () => {
    process.env.SASSY_AUTH_ALLOW_INSECURE_APP_URLS = 'true';
    expect(validateSync(makeWith('http://localhost:3000'))).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sassy-auth/auth-server exec jest src/common/config/is-app-url.decorator.spec.ts`
Expected: FAIL — `Cannot find module './is-app-url.decorator'`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/auth-server/src/common/config/is-app-url.decorator.ts`:

```ts
import { registerDecorator, ValidationOptions } from 'class-validator';
import { isAppUrlAllowed, isInsecureAppUrlsAllowed } from './app-url-policy';

/**
 * Validates that a property is an acceptable app/callback URL under the current
 * security policy (see app-url-policy.ts). The error message adapts to whether
 * insecure URLs are currently permitted.
 */
export function IsAppUrl(validationOptions?: ValidationOptions): PropertyDecorator {
  return (object: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isAppUrl',
      target: object.constructor,
      propertyName: propertyName as string,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          return isAppUrlAllowed(value);
        },
        defaultMessage() {
          return isInsecureAppUrlsAllowed()
            ? 'must be a valid http(s) URL'
            : 'must be a valid https URL with a public host';
        },
      },
    });
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sassy-auth/auth-server exec jest src/common/config/is-app-url.decorator.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/common/config/is-app-url.decorator.ts apps/auth-server/src/common/config/is-app-url.decorator.spec.ts
git commit -m "feat(auth-server): IsAppUrl class-validator decorator"
```

---

## Task 3: Wire DTOs (url policy + optional callbackUrl)

**Files:**
- Modify: `apps/auth-server/src/apps/dto/create-app.dto.ts`
- Modify: `apps/auth-server/src/apps/dto/update-app.dto.ts`
- Test: `apps/auth-server/src/apps/dto/app-dto.spec.ts` (create)

**Interfaces:**
- Consumes: `IsAppUrl` from `../../common/config/is-app-url.decorator`.
- Produces: `CreateAppDto { name; url; callbackUrl?: string | null }`, `UpdateAppDto { name?; url?; callbackUrl?: string | null }`.

- [ ] **Step 1: Write the failing test**

Create `apps/auth-server/src/apps/dto/app-dto.spec.ts`:

```ts
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateAppDto } from './create-app.dto';
import { UpdateAppDto } from './update-app.dto';

describe('App DTO validation (secure mode)', () => {
  const original = process.env.SASSY_AUTH_ALLOW_INSECURE_APP_URLS;
  beforeEach(() => { delete process.env.SASSY_AUTH_ALLOW_INSECURE_APP_URLS; });
  afterAll(() => {
    if (original === undefined) delete process.env.SASSY_AUTH_ALLOW_INSECURE_APP_URLS;
    else process.env.SASSY_AUTH_ALLOW_INSECURE_APP_URLS = original;
  });

  it('accepts https url and no callbackUrl', () => {
    const dto = plainToInstance(CreateAppDto, { name: 'A', url: 'https://a.example.com' });
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('accepts an empty-string callbackUrl as "default" (no error)', () => {
    const dto = plainToInstance(CreateAppDto, { name: 'A', url: 'https://a.example.com', callbackUrl: '' });
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('accepts a valid https callbackUrl', () => {
    const dto = plainToInstance(CreateAppDto, {
      name: 'A', url: 'https://a.example.com', callbackUrl: 'https://a.example.com/auth/cb',
    });
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('rejects an http callbackUrl in secure mode', () => {
    const dto = plainToInstance(CreateAppDto, {
      name: 'A', url: 'https://a.example.com', callbackUrl: 'http://localhost/cb',
    });
    expect(validateSync(dto).length).toBeGreaterThan(0);
  });

  it('rejects an http app url in secure mode', () => {
    const dto = plainToInstance(CreateAppDto, { name: 'A', url: 'http://localhost:3000' });
    expect(validateSync(dto).length).toBeGreaterThan(0);
  });

  it('UpdateAppDto: omitting callbackUrl is valid', () => {
    const dto = plainToInstance(UpdateAppDto, { name: 'B' });
    expect(validateSync(dto)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sassy-auth/auth-server exec jest src/apps/dto/app-dto.spec.ts`
Expected: FAIL — `callbackUrl` not yet on DTO / http still allowed by old `@IsUrl`.

- [ ] **Step 3: Write minimal implementation**

Replace `apps/auth-server/src/apps/dto/create-app.dto.ts` with:

```ts
import { IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { IsAppUrl } from '../../common/config/is-app-url.decorator';

export class CreateAppDto {
  @IsString() @MinLength(1) @MaxLength(120) name: string;
  @IsAppUrl() @MaxLength(2048) url: string;

  // Optional exact-match callback URL. Omitted / null / '' all mean "default"
  // (origin match against `url`) and skip validation.
  @ValidateIf((o) => o.callbackUrl !== undefined && o.callbackUrl !== null && o.callbackUrl !== '')
  @IsAppUrl()
  @MaxLength(2048)
  callbackUrl?: string | null;
}
```

Replace `apps/auth-server/src/apps/dto/update-app.dto.ts` with:

```ts
import { IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { IsAppUrl } from '../../common/config/is-app-url.decorator';

// "At least one of name / url / callbackUrl" is enforced server-side in
// AppsService.updateApp rather than in a DTO-level ValidateIf trick (which is
// bypassable when whitelist:true is set on ValidationPipe).
export class UpdateAppDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsAppUrl() @MaxLength(2048) url?: string;

  // Omitted = leave unchanged. '' or null = clear back to "default".
  @ValidateIf((o) => o.callbackUrl !== undefined && o.callbackUrl !== null && o.callbackUrl !== '')
  @IsAppUrl()
  @MaxLength(2048)
  callbackUrl?: string | null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sassy-auth/auth-server exec jest src/apps/dto/app-dto.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/apps/dto/create-app.dto.ts apps/auth-server/src/apps/dto/update-app.dto.ts apps/auth-server/src/apps/dto/app-dto.spec.ts
git commit -m "feat(auth-server): app DTOs use IsAppUrl + optional callbackUrl"
```

---

## Task 4: Prisma schema + migration (`SaApp.callbackUrl`)

**Files:**
- Modify: `packages/db/schema.prisma` (SaApp model, lines ~71-80)
- Create: `packages/db/migrations/<timestamp>_app_callback_url/migration.sql`

**Interfaces:**
- Produces: `SaApp.callbackUrl: string | null` available on the Prisma client.

- [ ] **Step 1: Add the column to the schema**

In `packages/db/schema.prisma`, change the `SaApp` model to add `callbackUrl` after `url`:

```prisma
model SaApp {
  id          Int            @id @default(autoincrement())
  publicId    String         @unique
  name        String         @unique
  url         String
  callbackUrl String?
  isPlatform  Boolean        @default(false)
  orgs        SaOrg[]
  permissions SaPermission[]
  roles       SaRole[]
}
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm --filter @sassy-auth/db exec dotenv -e ../../.env.local -- prisma migrate dev --name app_callback_url`
Expected: Prisma creates `packages/db/migrations/<timestamp>_app_callback_url/migration.sql` and regenerates the client. The SQL should be:

```sql
ALTER TABLE "SaApp" ADD COLUMN "callbackUrl" TEXT;
```

If a local database is not available, create the migration directory and `migration.sql` by hand with the `ALTER TABLE` above, then run `pnpm --filter @sassy-auth/db run db:generate` to regenerate the client from the schema.

- [ ] **Step 3: Verify the client typings**

Run: `pnpm --filter @sassy-auth/db run build`
Expected: PASS (no TypeScript errors; `callbackUrl` is now part of `SaApp`).

- [ ] **Step 4: Commit**

```bash
git add packages/db/schema.prisma packages/db/migrations
git commit -m "feat(db): add nullable SaApp.callbackUrl column"
```

---

## Task 5: AppsService persists & returns `callbackUrl`

**Files:**
- Modify: `apps/auth-server/src/apps/apps.service.ts`
- Modify: `apps/auth-server/src/apps/apps.service.spec.ts`

**Interfaces:**
- Consumes: `CreateAppDto`/`UpdateAppDto` with `callbackUrl?: string | null`.
- Produces: `formatApp` output now includes `callbackUrl: string | null`. Create stores `callbackUrl: dto.callbackUrl || null`. Update writes `callbackUrl` only when the key is present, normalizing `''`/`null` to `null`. The at-least-one guard also accepts `callbackUrl`.

- [ ] **Step 1: Update the existing spec to expect callbackUrl, and add new cases**

In `apps/auth-server/src/apps/apps.service.spec.ts`:

1. Update the two fixtures to include `callbackUrl`:

```ts
const appRow = { id: 1, publicId: 'sq_1', name: 'Customer Portal', url: 'https://portal.example.com', callbackUrl: null, isPlatform: false };
const platformRow = { id: 2, publicId: 'sq_2', name: 'SassyAuth', url: 'https://auth', callbackUrl: null, isPlatform: true };
```

2. Update the `listApps` expectation (around line 60) to include `callbackUrl: null`:

```ts
items: [{ publicId: 'sq_1', name: 'Customer Portal', url: 'https://portal.example.com', callbackUrl: null, isPlatform: false }],
```

3. Update the create test (around lines 86-89). The `create` call now includes `callbackUrl: null`, and the returned/formatted object includes it:

```ts
const result = await service.createApp('ba-caller', { name: 'Customer Portal', url: 'https://portal.example.com' });
expect(mockPrisma.saApp.create).toHaveBeenCalledWith({ data: { publicId: 'placeholder', name: 'Customer Portal', url: 'https://portal.example.com', callbackUrl: null, isPlatform: false } });
expect(result).toEqual({ publicId: 'sq_1', name: 'Customer Portal', url: 'https://portal.example.com', callbackUrl: null, isPlatform: false });
```

4. Add a new test that a provided `callbackUrl` is persisted (place after the existing create test):

```ts
it('createApp stores a provided callbackUrl', async () => {
  mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
    fn({
      saApp: {
        create: jest.fn().mockResolvedValue({ id: 1 }),
        update: jest.fn().mockResolvedValue({ ...appRow, callbackUrl: 'https://portal.example.com/cb' }),
      },
    }),
  );
  const result = await service.createApp('ba-caller', {
    name: 'Customer Portal', url: 'https://portal.example.com', callbackUrl: 'https://portal.example.com/cb',
  });
  expect(result.callbackUrl).toBe('https://portal.example.com/cb');
});
```

5. Add a test that update can clear callbackUrl with `''` (place near the other update tests):

```ts
it('updateApp clears callbackUrl when given empty string', async () => {
  mockPrisma.saApp.findUnique.mockResolvedValue(appRow);
  mockPrisma.saApp.update.mockResolvedValue({ ...appRow, callbackUrl: null });
  await service.updateApp('ba-caller', 'sq_1', { callbackUrl: '' });
  expect(mockPrisma.saApp.update).toHaveBeenCalledWith({
    where: { publicId: 'sq_1' },
    data: { callbackUrl: null },
  });
});
```

> Note: the existing create test's `$transaction` mock may differ from the snippet in case 4 — match whatever shape the existing passing test already uses; only the asserted `data` and result need the `callbackUrl` additions.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sassy-auth/auth-server exec jest src/apps/apps.service.spec.ts`
Expected: FAIL — service does not yet read/write `callbackUrl`.

- [ ] **Step 3: Update the service**

In `apps/auth-server/src/apps/apps.service.ts`:

Change the `AppRow` type and `formatApp`:

```ts
type AppRow = { publicId: string; name: string; url: string; callbackUrl: string | null; isPlatform: boolean };
function formatApp(a: AppRow) {
  return { publicId: a.publicId, name: a.name, url: a.url, callbackUrl: a.callbackUrl ?? null, isPlatform: a.isPlatform };
}
```

In `createApp`, update the draft creation `data` to include callbackUrl:

```ts
const draft = await tx.saApp.create({
  data: { publicId: 'placeholder', name: dto.name, url: dto.url, callbackUrl: dto.callbackUrl || null, isPlatform: false },
});
```

In `updateApp`, broaden the at-least-one guard and write callbackUrl when present:

```ts
if (dto.name === undefined && dto.url === undefined && dto.callbackUrl === undefined) {
  throw new BadRequestException('At least one of name, url, or callbackUrl must be provided');
}
```

```ts
const updated = await prisma.saApp.update({
  where: { publicId },
  data: {
    ...(dto.name !== undefined && { name: dto.name }),
    ...(dto.url !== undefined && { url: dto.url }),
    ...(dto.callbackUrl !== undefined && { callbackUrl: dto.callbackUrl ? dto.callbackUrl : null }),
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sassy-auth/auth-server exec jest src/apps/apps.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/apps/apps.service.ts apps/auth-server/src/apps/apps.service.spec.ts
git commit -m "feat(auth-server): persist and return SaApp.callbackUrl"
```

---

## Task 6: Redirect-uri exact-match + rename

**Files:**
- Modify: `apps/auth-server/src/token/redirect-uri.ts`
- Modify: `apps/auth-server/src/token/redirect-uri.spec.ts`

**Interfaces:**
- Produces: `interface RedirectUriApp { url: string; callbackUrl?: string | null }` and `assertRedirectUriAllowed(redirectUri: string, app: RedirectUriApp): void`. Throws `BadRequestException(TokenErrorCode.INVALID_REDIRECT_URI)` on mismatch/malformed.
- Removes: `assertRedirectUriMatchesApp` (Task 7 updates the only caller).

- [ ] **Step 1: Rewrite the spec for the new signature + exact-match**

Replace `apps/auth-server/src/token/redirect-uri.spec.ts` with:

```ts
import { BadRequestException } from '@nestjs/common';
import { TokenErrorCode } from '@sassy-auth/types';
import { assertRedirectUriAllowed } from './redirect-uri';

describe('assertRedirectUriAllowed — default (no callbackUrl): origin match', () => {
  it('accepts exact origin with any path', () => {
    expect(() =>
      assertRedirectUriAllowed('https://example.com/auth/callback', { url: 'https://example.com' }),
    ).not.toThrow();
  });
  it('accepts when registered app.url has a trailing slash', () => {
    expect(() =>
      assertRedirectUriAllowed('https://example.com/cb', { url: 'https://example.com/' }),
    ).not.toThrow();
  });
  it('rejects different hosts', () => {
    expect(() =>
      assertRedirectUriAllowed('https://evil.example/cb', { url: 'https://example.com' }),
    ).toThrow(BadRequestException);
  });
  it('rejects different schemes', () => {
    expect(() =>
      assertRedirectUriAllowed('http://example.com/cb', { url: 'https://example.com' }),
    ).toThrow(BadRequestException);
  });
  it('rejects different ports', () => {
    expect(() =>
      assertRedirectUriAllowed('https://example.com:8443/cb', { url: 'https://example.com' }),
    ).toThrow(BadRequestException);
  });
  it('rejects malformed redirect_uri', () => {
    try {
      assertRedirectUriAllowed('not a url', { url: 'https://example.com' });
      fail('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      expect((e as Error).message).toContain(TokenErrorCode.INVALID_REDIRECT_URI);
    }
  });
  it('treats empty-string callbackUrl as default (origin match)', () => {
    expect(() =>
      assertRedirectUriAllowed('https://example.com/cb', { url: 'https://example.com', callbackUrl: '' }),
    ).not.toThrow();
  });
});

describe('assertRedirectUriAllowed — explicit callbackUrl: exact match', () => {
  const app = { url: 'https://example.com', callbackUrl: 'https://example.com/auth/cb' };

  it('accepts an exactly equal redirect_uri', () => {
    expect(() => assertRedirectUriAllowed('https://example.com/auth/cb', app)).not.toThrow();
  });
  it('accepts a trailing-slash variant (tolerant)', () => {
    expect(() => assertRedirectUriAllowed('https://example.com/auth/cb/', app)).not.toThrow();
  });
  it('accepts when stored value has the trailing slash and request does not', () => {
    const app2 = { url: 'https://example.com', callbackUrl: 'https://example.com/auth/cb/' };
    expect(() => assertRedirectUriAllowed('https://example.com/auth/cb', app2)).not.toThrow();
  });
  it('rejects a different path', () => {
    expect(() => assertRedirectUriAllowed('https://example.com/other', app)).toThrow(BadRequestException);
  });
  it('rejects a different query string', () => {
    const app2 = { url: 'https://example.com', callbackUrl: 'https://example.com/cb?x=1' };
    expect(() => assertRedirectUriAllowed('https://example.com/cb?x=2', app2)).toThrow(BadRequestException);
  });
  it('rejects a different host/port/scheme', () => {
    expect(() => assertRedirectUriAllowed('https://example.com:8443/auth/cb', app)).toThrow(BadRequestException);
    expect(() => assertRedirectUriAllowed('http://example.com/auth/cb', app)).toThrow(BadRequestException);
  });
  it('rejects a malformed redirect_uri', () => {
    expect(() => assertRedirectUriAllowed('not a url', app)).toThrow(BadRequestException);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sassy-auth/auth-server exec jest src/token/redirect-uri.spec.ts`
Expected: FAIL — `assertRedirectUriAllowed` not exported.

- [ ] **Step 3: Rewrite the implementation**

Replace `apps/auth-server/src/token/redirect-uri.ts` with:

```ts
import { BadRequestException } from '@nestjs/common';
import { TokenErrorCode } from '@sassy-auth/types';

export interface RedirectUriApp {
  url: string;
  callbackUrl?: string | null;
}

function reject(): never {
  throw new BadRequestException(TokenErrorCode.INVALID_REDIRECT_URI);
}

/** Trim a single trailing slash from a non-root path so `/cb` == `/cb/`. */
function normalizePath(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

function isExactMatch(redirectUri: string, callbackUrl: string): boolean {
  let a: URL;
  let b: URL;
  try {
    a = new URL(redirectUri);
    b = new URL(callbackUrl);
  } catch {
    return false;
  }
  return (
    a.protocol === b.protocol &&
    a.host === b.host && // host includes port
    normalizePath(a.pathname) === normalizePath(b.pathname) &&
    a.search === b.search
  );
}

/**
 * Validates a PKCE `redirect_uri` against an app.
 * - When `app.callbackUrl` is set (non-empty): require an exact match
 *   (protocol + host + port + path + query), tolerant of a single trailing slash.
 * - Otherwise ("default"): require the same origin as `app.url` (any path).
 */
export function assertRedirectUriAllowed(redirectUri: string, app: RedirectUriApp): void {
  if (app.callbackUrl) {
    if (!isExactMatch(redirectUri, app.callbackUrl)) reject();
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sassy-auth/auth-server exec jest src/token/redirect-uri.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/token/redirect-uri.ts apps/auth-server/src/token/redirect-uri.spec.ts
git commit -m "feat(auth-server): exact-match callback enforcement in redirect-uri"
```

---

## Task 7: Token controller uses the new validator

**Files:**
- Modify: `apps/auth-server/src/token/token.controller.ts`

**Interfaces:**
- Consumes: `assertRedirectUriAllowed` from `./redirect-uri`.

- [ ] **Step 1: Update the import**

Change line ~30 from:

```ts
import { assertRedirectUriMatchesApp } from './redirect-uri';
```

to:

```ts
import { assertRedirectUriAllowed } from './redirect-uri';
```

- [ ] **Step 2: Update the authorize endpoint call**

In `oauthAuthorize`, replace:

```ts
        assertRedirectUriMatchesApp(redirectUri, app.url);
```

with:

```ts
        assertRedirectUriAllowed(redirectUri, app);
```

- [ ] **Step 3: Update the token endpoint call**

In `oauthToken`, replace:

```ts
      assertRedirectUriMatchesApp(dto.redirect_uri, app);
```

> The current code reads `assertRedirectUriMatchesApp(dto.redirect_uri, app.url)`; replace it with:

```ts
      assertRedirectUriAllowed(dto.redirect_uri, app);
```

(`app` is the full Prisma row, which now includes `callbackUrl`, so it satisfies `RedirectUriApp`.)

- [ ] **Step 4: Verify the token suite still compiles and passes**

Run: `pnpm --filter @sassy-auth/auth-server exec jest src/token`
Expected: PASS (controller + redirect-uri specs green).

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/token/token.controller.ts
git commit -m "feat(auth-server): authorize/token enforce per-app callbackUrl"
```

---

## Task 8: Admin types, API payloads, and error mapping

**Files:**
- Modify: `apps/admin/lib/types.ts`
- Modify: `apps/admin/app/(admin)/apps/actions.ts`

**Interfaces:**
- Produces: `App`, `CreateAppPayload`, `UpdateAppPayload` each gain `callbackUrl?: string | null`. `mapError` returns `apps.errors.urlInsecure` for HTTP 400.
- Note: `createApp`/`updateApp` in `lib/api.ts` already `JSON.stringify(payload)`, so the new field is sent automatically — no change needed there.

- [ ] **Step 1: Extend the types**

In `apps/admin/lib/types.ts`, update the three interfaces:

```ts
export interface App {
  publicId: string;
  name: string;
  url: string;
  callbackUrl?: string | null;
  isPlatform: boolean;
}

export interface CreateAppPayload {
  name: string;
  url: string;
  callbackUrl?: string | null;
}

export interface UpdateAppPayload {
  name?: string;
  url?: string;
  callbackUrl?: string | null;
}
```

- [ ] **Step 2: Update the error mapping**

In `apps/admin/app/(admin)/apps/actions.ts`, change the 400 branch of `mapError`:

```ts
  if (message.includes('400')) {
    return 'apps.errors.urlInsecure'
  }
```

- [ ] **Step 3: Typecheck the admin app**

Run: `pnpm --filter admin run typecheck` (if absent, run `pnpm --filter admin exec tsc --noEmit`)
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/lib/types.ts "apps/admin/app/(admin)/apps/actions.ts"
git commit -m "feat(admin): callbackUrl in app payloads + insecure-url error mapping"
```

---

## Task 9: Admin drawers + i18n copy

**Files:**
- Modify: `apps/admin/messages/en.json`
- Modify: `apps/admin/components/app-create-drawer.tsx`
- Modify: `apps/admin/components/app-edit-drawer.tsx`
- Modify: `apps/admin/components/app-view-drawer.tsx`

**Interfaces:**
- Consumes: `App.callbackUrl`, `CreateAppPayload.callbackUrl`, `UpdateAppPayload.callbackUrl`.

- [ ] **Step 1: Add i18n strings**

In `apps/admin/messages/en.json`, under `apps.fields` add three keys (keep existing keys):

```json
    "fields": {
      "name": "App Name",
      "url": "App URL",
      "callbackUrl": "Callback URL",
      "callbackUrlHint": "Leave blank to accept any callback under the app's URL. Set a full URL to require an exact redirect_uri match.",
      "callbackUrlDefault": "Default (any path under app URL)",
      "publicId": "Public ID",
      "urlHint": "The primary base URL for this application."
    },
```

Under `apps.errors`, update `urlInvalid` and add `urlInsecure`:

```json
      "urlInvalid": "Please enter a valid URL.",
      "urlInsecure": "In production, app and callback URLs must use https and a public host.",
      "nameRequired": "App name is required."
```

- [ ] **Step 2: Add the Callback URL field to the create drawer**

In `apps/admin/components/app-create-drawer.tsx`:

Add state next to `url` (after `const [url, setUrl] = React.useState('')`):

```tsx
  const [callbackUrl, setCallbackUrl] = React.useState('')
```

Reset it in the `useEffect` cleanup (alongside `setUrl('')`):

```tsx
      setCallbackUrl('')
```

Include it in the submit payload (replace the `createAppAction` call):

```tsx
      const result = await createAppAction({
        name: name.trim(),
        url: url.trim(),
        callbackUrl: callbackUrl.trim() || null,
      })
```

Add the field markup immediately after the App URL `<div>` block:

```tsx
            <div>
              <Label htmlFor="appCallbackUrl">{t('apps.fields.callbackUrl')}</Label>
              <Input
                id="appCallbackUrl"
                type="url"
                value={callbackUrl}
                onChange={(e) => setCallbackUrl(e.target.value)}
                placeholder="https://app.example.com/auth/callback"
              />
              <p className="mt-1 text-body-sm text-muted-foreground">
                {t('apps.fields.callbackUrlHint')}
              </p>
            </div>
```

- [ ] **Step 3: Add the Callback URL field to the edit drawer**

In `apps/admin/components/app-edit-drawer.tsx`:

Add state (after `const [url, setUrl] = React.useState(app.url)`):

```tsx
  const [callbackUrl, setCallbackUrl] = React.useState(app.callbackUrl ?? '')
```

Sync it in the `useEffect` (alongside `setUrl(app.url)`):

```tsx
    setCallbackUrl(app.callbackUrl ?? '')
```

Extend the `dirty` check:

```tsx
  const dirty = name !== app.name || url !== app.url || callbackUrl !== (app.callbackUrl ?? '')
```

Extend the patch in `handleSubmit` (after the `url` branch):

```tsx
    if (callbackUrl !== (app.callbackUrl ?? '')) patch.callbackUrl = callbackUrl.trim() || null
```

Update the local `patch` type to include callbackUrl:

```tsx
    const patch: { name?: string; url?: string; callbackUrl?: string | null } = {}
```

Add the field markup after the App URL `<div>`:

```tsx
            <div>
              <Label htmlFor="appCallbackUrl">{t('apps.fields.callbackUrl')}</Label>
              <Input
                id="appCallbackUrl"
                type="url"
                value={callbackUrl}
                onChange={(e) => setCallbackUrl(e.target.value)}
                placeholder="https://app.example.com/auth/callback"
              />
              <p className="mt-1 text-body-sm text-muted-foreground">
                {t('apps.fields.callbackUrlHint')}
              </p>
            </div>
```

- [ ] **Step 4: Show the callback URL in the view drawer**

In `apps/admin/components/app-view-drawer.tsx`, add a row after the App URL `DetailRow`. When unset, show the default label instead of a copyable value:

```tsx
          {app.callbackUrl ? (
            <DetailRow
              label={t('apps.fields.callbackUrl')}
              value={app.callbackUrl}
              onCopy={() => copy(app.callbackUrl as string, 'callbackUrl')}
              copied={copied === 'callbackUrl'}
              copyLabel={t('apps.actions.copy')}
            />
          ) : (
            <div>
              <p className="text-label-sm font-bold uppercase tracking-wider text-muted-foreground">
                {t('apps.fields.callbackUrl')}
              </p>
              <div className="mt-1 rounded border border-border bg-card px-3 py-2">
                <span className="text-body-sm text-muted-foreground">
                  {t('apps.fields.callbackUrlDefault')}
                </span>
              </div>
            </div>
          )}
```

- [ ] **Step 5: Typecheck / build the admin app**

Run: `pnpm --filter admin exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/messages/en.json apps/admin/components/app-create-drawer.tsx apps/admin/components/app-edit-drawer.tsx apps/admin/components/app-view-drawer.tsx
git commit -m "feat(admin): Callback URL field in app drawers + i18n copy"
```

---

## Task 10: Docs, env example, CHANGELOG, full verification

**Files:**
- Modify: `.env.example`
- Modify: `CHANGELOG.md`

**Interfaces:** none (docs + final verification).

- [ ] **Step 1: Document the env var**

In `.env.example`, add (after the `AUTH_SERVER_URL` / trusted-origins block, near other auth-server settings):

```bash
# Dev-only: allow registering apps with http and/or localhost/loopback URLs.
# Leave unset (or anything other than "true") in production so app and callback
# URLs are required to be https with a public host.
SASSY_AUTH_ALLOW_INSECURE_APP_URLS=
```

- [ ] **Step 2: Add a CHANGELOG entry**

In `CHANGELOG.md`, add an entry under the current unreleased/top section:

```md
- Apps: optional per-app `callbackUrl`. When set, the PKCE `redirect_uri` must
  match it exactly (trailing-slash tolerant); when blank, any callback under the
  app's URL origin is accepted (unchanged behavior).
- Apps: app and callback URLs now require https + a public host by default.
  Set `SASSY_AUTH_ALLOW_INSECURE_APP_URLS=true` to permit http/localhost URLs in
  development.
```

- [ ] **Step 3: Run the full auth-server unit suite**

Run: `pnpm --filter @sassy-auth/auth-server test`
Expected: PASS — including `app-url-policy`, `is-app-url.decorator`, `app-dto`, `apps.service`, `apps.controller`, `redirect-uri`, and token specs.

- [ ] **Step 4: Build db + admin to confirm types**

Run: `pnpm --filter @sassy-auth/db run build && pnpm --filter admin exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .env.example CHANGELOG.md
git commit -m "docs: document SASSY_AUTH_ALLOW_INSECURE_APP_URLS + callbackUrl"
```

---

## Self-Review Notes (resolved)

- **Spec coverage:** Config flag → Task 1/10; data model → Task 4; URL validation gating → Tasks 1-3; PKCE exact-match + default origin → Task 6-7; admin UI (field + badge + copy) → Tasks 8-9; tests → folded into each task; seeds/fixtures audited (existing app-creation tests use `https://example.com`, platform/demo seeds write via Prisma and bypass DTO validation, so no breakage).
- **Type consistency:** `callbackUrl: string | null` used consistently across Prisma model, DTOs, service `formatApp`, `RedirectUriApp`, and admin types. The validator/exported names `assertRedirectUriAllowed`, `RedirectUriApp`, `isAppUrlAllowed`, `isInsecureAppUrlsAllowed`, `IsAppUrl` match between definition and consumer tasks.
- **Placeholder scan:** none — every code step includes full content.
- **Behavior preservation:** default (`callbackUrl` NULL/empty) keeps origin match; existing redirect-uri cases retained in the rewritten spec.
