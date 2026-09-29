# Per-App Favicon + Dynamic Signup/Login Tab Title Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-`SaApp` favicon (uploaded next to the existing Logo field) and make the `/signup` and `/login` browser tab titles read `"{appName} Sign Up"` / `"{appName} Sign In"` — including when `/login` is reached via a resource server's authorize redirect (`?next=<url with client_id>`) — instead of the static `"SassyAuth Admin"` console title.

**Architecture:** Mirrors the existing `logo` field end-to-end: a nullable data-URI column on `SaApp`, shared size/type validation in `packages/types` reused for both logo and favicon, a generalized upload component in the admin console, and two public read paths — `GET /api/register/app` (already returns `name`, extended with `favicon`, used by `/signup`) and `GET /api/social-providers` (extended with `name` + `favicon`, used by `/login`, kept separate from the rate-limited/404-capable register endpoint to avoid changing that page's enumeration-safety posture). Both pages gain a Next.js `generateMetadata` export.

**Tech Stack:** NestJS + Prisma (auth-server), Next.js App Router (admin), Jest + Testing Library, class-validator, Prisma migrations, next-intl.

**Spec:** `docs/superpowers/specs/2026-09-29-app-favicon-signup-title-design.md`

---

## Task 1: Shared favicon validation in `packages/types`

**Files:**
- Modify: `packages/types/index.ts:124-152`

**Interfaces:**
- Produces: `APP_FAVICON_MAX_BYTES`, `APP_FAVICON_ALLOWED_MIME_TYPES`, `isValidAppFaviconDataUri(value: unknown): boolean` — consumed by Task 2 (decorator) and Task 12 (admin component).

- [ ] **Step 1: Generalize the byte/type check and add the favicon exports**

Modify `packages/types/index.ts`, replacing lines 124-152 (from `export const APP_LOGO_MAX_BYTES = 250 * 1024;` through the end of `isValidAppLogoDataUri`) with:

```ts
export const APP_LOGO_MAX_BYTES = 250 * 1024;

export const APP_LOGO_ALLOWED_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/svg+xml',
] as const;

export const APP_FAVICON_MAX_BYTES = APP_LOGO_MAX_BYTES;

export const APP_FAVICON_ALLOWED_MIME_TYPES = APP_LOGO_ALLOWED_MIME_TYPES;

function buildImageDataUriPattern(allowedTypes: readonly string[]): RegExp {
  return new RegExp(
    `^data:(${allowedTypes.map((t) => t.replace('/', '\\/').replace('+', '\\+')).join('|')});base64,([A-Za-z0-9+/]+=?=?)$`,
  );
}

/**
 * True when `value` is a data URI whose mime type is in `allowedTypes` and
 * whose decoded byte size is within `maxBytes`. Shared by
 * isValidAppLogoDataUri and isValidAppFaviconDataUri so the two rules
 * (currently identical) can't silently drift apart from independently
 * duplicated regex/byte-math.
 */
function isValidImageDataUri(value: unknown, allowedTypes: readonly string[], maxBytes: number): boolean {
  if (typeof value !== 'string') return false;
  const match = buildImageDataUriPattern(allowedTypes).exec(value);
  if (!match) return false;
  const base64Payload = match[2];
  const padding = base64Payload.endsWith('==') ? 2 : base64Payload.endsWith('=') ? 1 : 0;
  const decodedBytes = (base64Payload.length * 3) / 4 - padding;
  return decodedBytes <= maxBytes;
}

/**
 * True when `value` is a data URI of an allowed image type whose decoded
 * byte size is within APP_LOGO_MAX_BYTES. Used both by the admin console's
 * client-side file picker (before FileReader output is stored in state)
 * and by the auth-server's IsAppLogo class-validator decorator (before a
 * write hits the database) — one definition, two enforcement points.
 */
export function isValidAppLogoDataUri(value: unknown): boolean {
  return isValidImageDataUri(value, APP_LOGO_ALLOWED_MIME_TYPES, APP_LOGO_MAX_BYTES);
}

/**
 * Same rule as isValidAppLogoDataUri, exposed under its own name for the
 * favicon field (see IsAppFavicon / AppFaviconField). Deliberately reuses
 * APP_LOGO_ALLOWED_MIME_TYPES/APP_LOGO_MAX_BYTES as its source of truth
 * (via the APP_FAVICON_* aliases above) rather than an independent rule.
 */
export function isValidAppFaviconDataUri(value: unknown): boolean {
  return isValidImageDataUri(value, APP_FAVICON_ALLOWED_MIME_TYPES, APP_FAVICON_MAX_BYTES);
}
```

- [ ] **Step 2: Rebuild the package**

Run: `pnpm --filter @sassy-auth/types build`
Expected: succeeds; `packages/types/dist/index.js` and `index.d.ts` now export `APP_FAVICON_MAX_BYTES`, `APP_FAVICON_ALLOWED_MIME_TYPES`, `isValidAppFaviconDataUri`.

Verify with: `grep -n "isValidAppFaviconDataUri" packages/types/dist/index.js` — should show a match.

- [ ] **Step 3: Commit**

```bash
git add packages/types/index.ts packages/types/dist
git commit -m "feat(types): generalize app-image validation and add favicon rule"
```

---

## Task 2: `IsAppFavicon` decorator (auth-server)

**Files:**
- Create: `apps/auth-server/src/common/config/is-app-favicon.decorator.ts`
- Create: `apps/auth-server/src/common/config/is-app-favicon.decorator.spec.ts`

**Interfaces:**
- Produces: `IsAppFavicon(): PropertyDecorator` — consumed by Task 4's DTOs.

- [ ] **Step 1: Write the failing test**

Create `apps/auth-server/src/common/config/is-app-favicon.decorator.spec.ts`:

```ts
import { validateSync } from 'class-validator';
import { IsOptional } from 'class-validator';
import { IsAppFavicon } from './is-app-favicon.decorator';

class Fixture {
  @IsOptional()
  @IsAppFavicon()
  favicon?: string | null;
}

function makeWith(favicon: unknown): Fixture {
  const f = new Fixture();
  // @ts-expect-error test assigns arbitrary values
  f.favicon = favicon;
  return f;
}

// 1x1 transparent PNG, well under the 250KB cap.
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

describe('IsAppFavicon', () => {
  it('passes for a small valid PNG data URI', () => {
    expect(validateSync(makeWith(TINY_PNG))).toHaveLength(0);
  });

  it('passes when omitted (optional)', () => {
    expect(validateSync(makeWith(undefined))).toHaveLength(0);
  });

  it('passes when explicitly null', () => {
    expect(validateSync(makeWith(null))).toHaveLength(0);
  });

  it('fails for a non-data-URI string', () => {
    const errs = validateSync(makeWith('not-a-data-uri'));
    expect(errs).toHaveLength(1);
    expect(errs[0].constraints?.isAppFavicon).toBeDefined();
  });

  it('fails for a disallowed mime type', () => {
    const errs = validateSync(makeWith('data:image/gif;base64,R0lGODlh'));
    expect(errs).toHaveLength(1);
  });

  it('fails for a payload over the size cap', () => {
    // 350KB of base64 chars decodes to ~262.5KB, over the 256KB cap.
    const oversized = 'data:image/png;base64,' + 'A'.repeat(350000);
    const errs = validateSync(makeWith(oversized));
    expect(errs).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter auth-server test -- is-app-favicon.decorator.spec.ts`
Expected: FAIL with a module-not-found error for `./is-app-favicon.decorator`.

- [ ] **Step 3: Write the decorator**

Create `apps/auth-server/src/common/config/is-app-favicon.decorator.ts`:

```ts
import { registerDecorator, ValidationOptions } from 'class-validator';
import { isValidAppFaviconDataUri } from '@sassy-auth/types';

/**
 * Validates that a property is an acceptable app favicon: a data URI of an
 * allowed image mime type, within the shared size cap. Mirrors IsAppLogo's
 * structure — the actual rule lives in @sassy-auth/types so the admin
 * console's client-side file picker enforces the identical rule before it
 * ever reaches this decorator.
 */
export function IsAppFavicon(validationOptions?: ValidationOptions): PropertyDecorator {
  return (object: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isAppFavicon',
      target: object.constructor,
      propertyName: propertyName as string,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          return isValidAppFaviconDataUri(value);
        },
        defaultMessage() {
          return 'must be a data URI of an allowed image type (png, jpeg, webp, svg) within the size limit';
        },
      },
    });
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter auth-server test -- is-app-favicon.decorator.spec.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/common/config/is-app-favicon.decorator.ts apps/auth-server/src/common/config/is-app-favicon.decorator.spec.ts
git commit -m "feat(auth-server): add IsAppFavicon validator"
```

---

## Task 3: `SaApp.favicon` column + migration

**Files:**
- Modify: `packages/db/schema.prisma:114-120`
- Create: `packages/db/migrations/<timestamp>_add_app_favicon/migration.sql`

**Interfaces:**
- Produces: `SaApp.favicon: string | null` on the Prisma model, available as `prisma.saApp.*({ ..., favicon: ... })` to Task 5.

- [ ] **Step 1: Add the `favicon` field to the Prisma schema**

Modify `packages/db/schema.prisma`, in `model SaApp`, immediately after the `logo` field:

```prisma
  /// Full data URI (e.g. "data:image/png;base64,...."). null = no logo set.
  logo        String?
  /// Full data URI. null = no favicon set; the signup/login pages fall back
  /// to the browser's default icon (no site-wide favicon exists either way).
  favicon     String?
```

- [ ] **Step 2: Generate the migration**

Run (from repo root, requires a running dev database per this repo's existing `db:migrate` script):
`pnpm --filter @sassy-auth/db db:migrate --name add_app_favicon`

Expected: a new directory `packages/db/migrations/<timestamp>_add_app_favicon/migration.sql` is created, containing:

```sql
ALTER TABLE "SaApp" ADD COLUMN "favicon" TEXT;
```

If the dev database isn't reachable in this environment, hand-create the migration directory instead — copy the exact structure of the most recent migration (`packages/db/migrations/20260925000000_add_two_factor_prompt_enabled/`) and write the SQL above verbatim, then run `pnpm --filter @sassy-auth/db db:migrate:deploy` to apply it and regenerate the client.

- [ ] **Step 3: Regenerate the Prisma client**

Run: `pnpm --filter @sassy-auth/db db:generate`
Expected: succeeds; the generated `SaApp` model type now includes a `favicon` field.

Verify with: `grep -rn "favicon" packages/db/generated/prisma/models/SaApp.ts` — should show a match.

- [ ] **Step 4: Commit**

```bash
git add packages/db/schema.prisma packages/db/migrations
git commit -m "feat(db): add favicon column to SaApp"
```

---

## Task 4: `favicon` on `CreateAppDto` / `UpdateAppDto`

**Files:**
- Modify: `apps/auth-server/src/apps/dto/create-app.dto.ts`
- Modify: `apps/auth-server/src/apps/dto/update-app.dto.ts`
- Modify: `apps/auth-server/src/apps/dto/app-dto.spec.ts`

**Interfaces:**
- Produces: `CreateAppDto.favicon?: string | null`, `UpdateAppDto.favicon?: string | null` — consumed by Task 5's `AppsService`.

- [ ] **Step 1: Write the failing tests**

Modify `apps/auth-server/src/apps/dto/app-dto.spec.ts`, adding at the end of the file:

```ts

describe('CreateAppDto — favicon validation', () => {
  const TINY_PNG =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

  it('accepts a valid favicon data URI', () => {
    const dto = plainToInstance(CreateAppDto, { name: 'A', url: 'https://a.example.com', favicon: TINY_PNG });
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('accepts omitting favicon', () => {
    const dto = plainToInstance(CreateAppDto, { name: 'A', url: 'https://a.example.com' });
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('rejects a non-data-URI favicon', () => {
    const dto = plainToInstance(CreateAppDto, { name: 'A', url: 'https://a.example.com', favicon: 'not-a-data-uri' });
    expect(validateSync(dto).length).toBeGreaterThan(0);
  });
});

describe('UpdateAppDto — favicon validation', () => {
  it('accepts null (clear favicon)', () => {
    const dto = Object.assign(new UpdateAppDto(), { favicon: null });
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('accepts undefined (omit)', () => {
    const dto = Object.assign(new UpdateAppDto(), { favicon: undefined });
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('rejects a non-data-URI favicon', () => {
    const dto = Object.assign(new UpdateAppDto(), { favicon: 'not-a-data-uri' });
    expect(validateSync(dto).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter auth-server test -- app-dto.spec.ts`
Expected: FAIL — `favicon` is not a recognized property / validation doesn't reject `'not-a-data-uri'` because the field doesn't exist yet and `class-validator` has nothing to check.

- [ ] **Step 3: Add `favicon` to both DTOs**

Modify `apps/auth-server/src/apps/dto/create-app.dto.ts`:

```ts
import { IsArray, IsBoolean, IsInt, IsOptional, IsPositive, IsString, Max, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsAppUrl } from '../../common/config/is-app-url.decorator';
import { IsAppLogo } from '../../common/config/is-app-logo.decorator';
import { IsAppFavicon } from '../../common/config/is-app-favicon.decorator';

export class CreateAppDto {
  @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsAppUrl() @MaxLength(2048) url!: string;

  /**
   * Full data URI (e.g. "data:image/png;base64,..."), validated by
   * IsAppLogo against the shared @sassy-auth/types size/type rule.
   * Omitted or null means no logo.
   */
  @IsOptional()
  @IsAppLogo()
  logo?: string | null;

  /**
   * Full data URI, validated by IsAppFavicon against the same shared
   * size/type rule as logo. Omitted or null means no favicon.
   */
  @IsOptional()
  @IsAppFavicon()
  favicon?: string | null;

  /**
```

(Only the import block and the field list right after `logo` change — everything else in the file, starting from the `twoFactorTrustDays` doc comment, is untouched.)

Modify `apps/auth-server/src/apps/dto/update-app.dto.ts`:

```ts
import { IsArray, IsBoolean, IsInt, IsOptional, IsPositive, IsString, Max, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PasswordPolicy, ActivationEmailBranding } from '@sassy-auth/types';
import { IsAppUrl } from '../../common/config/is-app-url.decorator';
import { IsAppLogo } from '../../common/config/is-app-logo.decorator';
import { IsAppFavicon } from '../../common/config/is-app-favicon.decorator';

// "At least one of name / url" is enforced server-side in
// AppsService.updateApp rather than in a DTO-level ValidateIf trick (which is
// bypassable when whitelist:true is set on ValidationPipe).
export class UpdateAppDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsAppUrl() @MaxLength(2048) url?: string;

  /**
   * Full data URI (e.g. "data:image/png;base64,..."), validated by
   * IsAppLogo against the shared @sassy-auth/types size/type rule.
   * `null` clears the logo.
   */
  @IsOptional()
  @IsAppLogo()
  logo?: string | null;

  /**
   * Full data URI, validated by IsAppFavicon against the same shared
   * size/type rule as logo. `null` clears the favicon.
   */
  @IsOptional()
  @IsAppFavicon()
  favicon?: string | null;

  /**
```

(Only the import block and the field list right after `logo` change — everything else, starting from the `twoFactorTrustDays` doc comment, is untouched.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter auth-server test -- app-dto.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/apps/dto/create-app.dto.ts apps/auth-server/src/apps/dto/update-app.dto.ts apps/auth-server/src/apps/dto/app-dto.spec.ts
git commit -m "feat(auth-server): add favicon field to app DTOs"
```

---

## Task 5: Persist and return `favicon` in `AppsService`

**Files:**
- Modify: `apps/auth-server/src/apps/apps.service.ts`
- Modify: `apps/auth-server/src/apps/apps.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

Modify `apps/auth-server/src/apps/apps.service.spec.ts`, adding after the existing `'listApps never selects logo and always returns logo: null in every row, even if the DB row has one'` test (mirror its structure exactly, using `favicon` in place of `logo`):

```ts
  it('listApps never selects favicon and always returns favicon: null in every row, even if the DB row has one', async () => {
    mockPrisma.saApp.findMany.mockResolvedValue([{ ...appRow, favicon: 'data:image/png;base64,LEAKED=' }]);
    mockPrisma.saApp.count.mockResolvedValue(1);
    const result = await service.listApps('ba-caller', { page: 1, pageSize: 25 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].favicon).toBeNull();
    const call = mockPrisma.saApp.findMany.mock.calls[0][0];
    expect(call.select).toBeDefined();
    expect(call.select.favicon).toBeUndefined();
    expect(call.include).toBeUndefined();
  });
```

Then, after the existing `'createApp defaults logo to null when omitted'` test, add:

```ts
  it('createApp stores a provided favicon', async () => {
    mockPrisma.$transaction.mockImplementation(async (cb: (tx: typeof mockPrisma) => unknown) => cb(mockPrisma));
    mockPrisma.saApp.create.mockResolvedValue({ ...appRow, publicId: 'placeholder' });
    mockPrisma.saApp.update.mockResolvedValue({ ...appRow, favicon: 'data:image/png;base64,AAA=' });
    const result = await service.createApp('ba-caller', {
      name: 'Customer Portal', url: 'https://portal.example.com', favicon: 'data:image/png;base64,AAA=',
    });
    expect(mockPrisma.saApp.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ favicon: 'data:image/png;base64,AAA=' }),
    }));
    expect(result.favicon).toBe('data:image/png;base64,AAA=');
  });

  it('createApp defaults favicon to null when omitted', async () => {
    mockPrisma.$transaction.mockImplementation(async (cb: (tx: typeof mockPrisma) => unknown) => cb(mockPrisma));
    mockPrisma.saApp.create.mockResolvedValue({ ...appRow, publicId: 'placeholder' });
    mockPrisma.saApp.update.mockResolvedValue(appRow);
    await service.createApp('ba-caller', { name: 'Customer Portal', url: 'https://portal.example.com' });
    expect(mockPrisma.saApp.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ favicon: null }),
    }));
  });
```

Then, after the existing `'updateApp omits logo from update data when DTO omits it'` test, add:

```ts
  it('updateApp sets favicon when provided', async () => {
    mockPrisma.saApp.findUnique.mockResolvedValue(appRow);
    mockPrisma.saApp.update.mockResolvedValue({ ...appRow, favicon: 'data:image/png;base64,BBB=' });
    await service.updateApp('ba-caller', 'sq_1', { favicon: 'data:image/png;base64,BBB=' });
    expect(mockPrisma.saApp.update).toHaveBeenCalledWith({
      where: { publicId: 'sq_1' },
      data: { favicon: 'data:image/png;base64,BBB=' },
      include: { defaultOrg: { select: { publicId: true } }, defaultRole: { select: { publicId: true } } },
    });
  });

  it('updateApp clears favicon when given null', async () => {
    mockPrisma.saApp.findUnique.mockResolvedValue(appRow);
    mockPrisma.saApp.update.mockResolvedValue({ ...appRow, favicon: null });
    await service.updateApp('ba-caller', 'sq_1', { favicon: null });
    expect(mockPrisma.saApp.update).toHaveBeenCalledWith({
      where: { publicId: 'sq_1' },
      data: { favicon: null },
      include: { defaultOrg: { select: { publicId: true } }, defaultRole: { select: { publicId: true } } },
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter auth-server test -- apps.service.spec.ts`
Expected: FAIL — `favicon` comes back `undefined` (not stored/returned), and the `listApps` select assertion fails because `favicon` was never added to it.

- [ ] **Step 3: Add `favicon` handling to `AppsService`**

Modify `apps/auth-server/src/apps/apps.service.ts`:

In the `AppRow` type (line 18-19), add `favicon` next to `logo`:

```ts
type AppRow = {
  publicId: string; name: string; url: string; logo?: string | null; favicon?: string | null; isPlatform: boolean;
```

In `formatApp` (line 40), add `favicon` next to `logo`:

```ts
    publicId: a.publicId, name: a.name, url: a.url, logo: a.logo ?? null, favicon: a.favicon ?? null, isPlatform: a.isPlatform,
```

In `listApps`'s final return (line 245), null out `favicon` alongside `logo`:

```ts
    return { items: rows.map((r) => ({ ...formatApp(r), logo: null, favicon: null })), total, page, pageSize };
```

(The `select` in the `findMany` call above it already omits `favicon` by construction — it's a fixed field list that was never updated to include it, exactly like `logo`.)

In `createApp`'s `data` object (line 273), add `favicon: dto.favicon ?? null` next to `logo`:

```ts
          data: { publicId: generatePendingPublicId(), name: dto.name, url: dto.url, logo: dto.logo ?? null, favicon: dto.favicon ?? null, isPlatform: false, twoFactorTrustDays: dto.twoFactorTrustDays ?? null, twoFactorPromptEnabled: dto.twoFactorPromptEnabled ?? null, requireTwoFactor: dto.requireTwoFactor ?? false, allowOfflineAccess: dto.allowOfflineAccess ?? false },
```

In `updateApp`'s "at least one field" guard (lines 293-314), add `dto.favicon === undefined &&` right after the `dto.logo === undefined &&` line, and add `favicon,` to the error message's field list:

```ts
    if (
      dto.name === undefined &&
      dto.url === undefined &&
      dto.logo === undefined &&
      dto.favicon === undefined &&
      dto.twoFactorTrustDays === undefined &&
```

```ts
      throw new BadRequestException(
        'At least one of name, url, logo, favicon, twoFactorTrustDays, twoFactorPromptEnabled, requireTwoFactor, allowOfflineAccess, redirectUris, defaultOrgId, defaultRoleId, passwordPolicyOverride, activationWebhookUrl, privacyPolicyUrl, termsUrl, gdprUrl, or activationEmailOverride must be provided',
      );
```

In `updateApp`'s patch spread (line 337), add the favicon line right after the logo line:

```ts
            ...(dto.logo !== undefined && { logo: dto.logo }),
            ...(dto.favicon !== undefined && { favicon: dto.favicon }),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter auth-server test -- apps.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/apps/apps.service.ts apps/auth-server/src/apps/apps.service.spec.ts
git commit -m "feat(auth-server): persist and return app favicon"
```

---

## Task 6: Include `favicon` in `GET /api/register/app`

**Files:**
- Modify: `apps/auth-server/src/registration/registration.service.ts`
- Modify: `apps/auth-server/src/registration/registration.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

Modify `apps/auth-server/src/registration/registration.service.spec.ts`, within the existing `describe('getAppName', ...)` block, updating the two mocked rows and expected results that currently reference `logo` to also carry `favicon`. Change:

```ts
    it('returns the app name and logo for a known appPublicId', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue({ name: 'MyApp', defaultOrgId: null, passwordPolicyOverride: null, logo: 'data:image/png;base64,AAA=' });

      await expect(service.getAppName('sq_1')).resolves.toEqual({
        name: 'MyApp',
        hasDefaultOrg: false,
        passwordPolicy: expect.any(Object),
        logo: 'data:image/png;base64,AAA=',
        privacyPolicyUrl: null,
        termsUrl: null,
        gdprUrl: null,
        gdprRequired: false,
      });
      expect(mockPrisma.saApp.findUnique).toHaveBeenCalledWith({
        where: { publicId: 'sq_1' },
        select: {
          name: true,
          defaultOrgId: true,
          passwordPolicyOverride: true,
          logo: true,
          privacyPolicyUrl: true,
          termsUrl: true,
          gdprUrl: true,
        },
      });
    });
```

to:

```ts
    it('returns the app name, logo, and favicon for a known appPublicId', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue({ name: 'MyApp', defaultOrgId: null, passwordPolicyOverride: null, logo: 'data:image/png;base64,AAA=', favicon: 'data:image/png;base64,FFF=' });

      await expect(service.getAppName('sq_1')).resolves.toEqual({
        name: 'MyApp',
        hasDefaultOrg: false,
        passwordPolicy: expect.any(Object),
        logo: 'data:image/png;base64,AAA=',
        favicon: 'data:image/png;base64,FFF=',
        privacyPolicyUrl: null,
        termsUrl: null,
        gdprUrl: null,
        gdprRequired: false,
      });
      expect(mockPrisma.saApp.findUnique).toHaveBeenCalledWith({
        where: { publicId: 'sq_1' },
        select: {
          name: true,
          defaultOrgId: true,
          passwordPolicyOverride: true,
          logo: true,
          favicon: true,
          privacyPolicyUrl: true,
          termsUrl: true,
          gdprUrl: true,
        },
      });
    });
```

Then, in the `describe('getAppName — hasDefaultOrg', ...)` block above it, change:

```ts
  describe('getAppName — hasDefaultOrg', () => {
    it('reports hasDefaultOrg: true when the app has a defaultOrgId', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue({ name: 'MyApp', defaultOrgId: 99, passwordPolicyOverride: null, logo: null });
      await expect(service.getAppName('sq_1')).resolves.toEqual({
        name: 'MyApp',
        hasDefaultOrg: true,
        passwordPolicy: expect.any(Object),
        logo: null,
        privacyPolicyUrl: null,
        termsUrl: null,
        gdprUrl: null,
        gdprRequired: false,
      });
    });

    it('reports hasDefaultOrg: false when the app has no defaultOrgId', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue({ name: 'MyApp', defaultOrgId: null, passwordPolicyOverride: null, logo: null });
      await expect(service.getAppName('sq_1')).resolves.toEqual({
        name: 'MyApp',
        hasDefaultOrg: false,
        passwordPolicy: expect.any(Object),
        logo: null,
        privacyPolicyUrl: null,
        termsUrl: null,
        gdprUrl: null,
        gdprRequired: false,
      });
    });
  });
```

to:

```ts
  describe('getAppName — hasDefaultOrg', () => {
    it('reports hasDefaultOrg: true when the app has a defaultOrgId', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue({ name: 'MyApp', defaultOrgId: 99, passwordPolicyOverride: null, logo: null, favicon: null });
      await expect(service.getAppName('sq_1')).resolves.toEqual({
        name: 'MyApp',
        hasDefaultOrg: true,
        passwordPolicy: expect.any(Object),
        logo: null,
        favicon: null,
        privacyPolicyUrl: null,
        termsUrl: null,
        gdprUrl: null,
        gdprRequired: false,
      });
    });

    it('reports hasDefaultOrg: false when the app has no defaultOrgId', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue({ name: 'MyApp', defaultOrgId: null, passwordPolicyOverride: null, logo: null, favicon: null });
      await expect(service.getAppName('sq_1')).resolves.toEqual({
        name: 'MyApp',
        hasDefaultOrg: false,
        passwordPolicy: expect.any(Object),
        logo: null,
        favicon: null,
        privacyPolicyUrl: null,
        termsUrl: null,
        gdprUrl: null,
        gdprRequired: false,
      });
    });
  });
```

Then change:

```ts
    it('returns logo: null when the app has no logo set', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue({ name: 'MyApp', defaultOrgId: null, passwordPolicyOverride: null, logo: null });

      await expect(service.getAppName('sq_1')).resolves.toEqual({
        name: 'MyApp',
        hasDefaultOrg: false,
        passwordPolicy: expect.any(Object),
        logo: null,
        privacyPolicyUrl: null,
        termsUrl: null,
        gdprUrl: null,
        gdprRequired: false,
      });
    });
```

to:

```ts
    it('returns logo: null and favicon: null when the app has neither set', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue({ name: 'MyApp', defaultOrgId: null, passwordPolicyOverride: null, logo: null, favicon: null });

      await expect(service.getAppName('sq_1')).resolves.toEqual({
        name: 'MyApp',
        hasDefaultOrg: false,
        passwordPolicy: expect.any(Object),
        logo: null,
        favicon: null,
        privacyPolicyUrl: null,
        termsUrl: null,
        gdprUrl: null,
        gdprRequired: false,
      });
    });
```

Then change:

```ts
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
```

to:

```ts
    it('includes privacyPolicyUrl, termsUrl, gdprUrl, and gdprRequired in the response', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue({
        name: 'MyApp',
        defaultOrgId: null,
        passwordPolicyOverride: null,
        logo: null,
        favicon: null,
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
```

(The `'throws NotFoundException for an unknown appPublicId'` and `'throws NotFoundException for an empty appPublicId...'` tests mock no row or assert only on the thrown exception type — neither references `logo`, so neither needs a change.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter auth-server test -- registration.service.spec.ts`
Expected: FAIL — actual result omits `favicon` and the `select` assertion doesn't include it.

- [ ] **Step 3: Add `favicon` to `getAppName`**

Modify `apps/auth-server/src/registration/registration.service.ts`, in `getAppName` (around line 308-351):

```ts
  async getAppName(
    appPublicId: string,
    ip: string = 'unknown',
  ): Promise<{
    name: string;
    hasDefaultOrg: boolean;
    passwordPolicy: PasswordPolicy;
    logo: string | null;
    favicon: string | null;
    privacyPolicyUrl: string | null;
    termsUrl: string | null;
    gdprUrl: string | null;
    gdprRequired: boolean;
  }> {
    if (!appPublicId) throw new NotFoundException('App not found');
    const app = await prisma.saApp.findUnique({
      where: { publicId: appPublicId },
      select: {
        name: true,
        defaultOrgId: true,
        passwordPolicyOverride: true,
        logo: true,
        favicon: true,
        privacyPolicyUrl: true,
        termsUrl: true,
        gdprUrl: true,
      },
    });
    if (!app) throw new NotFoundException('App not found');
    const country = resolveCountryFromIp(ip);
    return {
      name: app.name,
      hasDefaultOrg: app.defaultOrgId !== null,
      passwordPolicy: resolvePasswordPolicy(app),
      logo: app.logo ?? null,
      favicon: app.favicon ?? null,
      privacyPolicyUrl: app.privacyPolicyUrl ?? null,
      termsUrl: app.termsUrl ?? null,
      gdprUrl: app.gdprUrl ?? null,
      gdprRequired: resolveRequiredConsent(app, country).some((d) => d.documentType === 'gdpr'),
    };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter auth-server test -- registration.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/registration/registration.service.ts apps/auth-server/src/registration/registration.service.spec.ts
git commit -m "feat(auth-server): include favicon in GET /api/register/app"
```

---

## Task 7: Include `name` + `favicon` in `GET /api/social-providers`

**Files:**
- Modify: `apps/auth-server/src/social/social.service.ts`
- Modify: `apps/auth-server/src/social/social.service.spec.ts`
- Modify: `apps/auth-server/src/social/social.controller.ts`
- Modify: `apps/auth-server/src/social/social.controller.spec.ts`

**Interfaces:**
- Removes: `SocialService.getLogoForApp(clientId)`.
- Produces: `SocialService.getBrandingForApp(clientId): Promise<{ name: string | null; logo: string | null; favicon: string | null }>` — consumed by `SocialController.list`.

- [ ] **Step 1: Write the failing service tests**

Modify `apps/auth-server/src/social/social.service.spec.ts`. Replace the `makeService` helper's `app` parameter type and the whole `describe('SocialService.getLogoForApp', ...)` block:

```ts
function makeService(
  rows: { appId: number | null; provider: string; enabled: boolean }[],
  app: { id: number; name?: string | null; logo?: string | null; favicon?: string | null } | null,
) {
  const db = {
    saApp: { findUnique: async () => app },
    saSocialProvider: { findMany: async () => rows },
  };
  return new SocialService(db as never, { GOOGLE_CLIENT_ID: 'g', GOOGLE_CLIENT_SECRET: 's' });
}
```

```ts
describe('SocialService.getBrandingForApp', () => {
  it('returns name, logo, and favicon for a known app', async () => {
    const svc = makeService([], { id: 7, name: 'Acme', logo: 'data:image/png;base64,AAA=', favicon: 'data:image/png;base64,FFF=' });
    await expect(svc.getBrandingForApp('qp31')).resolves.toEqual({
      name: 'Acme',
      logo: 'data:image/png;base64,AAA=',
      favicon: 'data:image/png;base64,FFF=',
    });
  });

  it('returns all-null fields for a known app with none set', async () => {
    const svc = makeService([], { id: 7, name: null, logo: null, favicon: null });
    await expect(svc.getBrandingForApp('qp31')).resolves.toEqual({ name: null, logo: null, favicon: null });
  });

  it('returns all-null fields for an unknown client_id rather than throwing', async () => {
    const svc = makeService([], null);
    await expect(svc.getBrandingForApp('nope')).resolves.toEqual({ name: null, logo: null, favicon: null });
  });

  it('returns all-null fields when no client_id is given', async () => {
    const svc = makeService([], null);
    await expect(svc.getBrandingForApp(undefined)).resolves.toEqual({ name: null, logo: null, favicon: null });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter auth-server test -- social.service.spec.ts`
Expected: FAIL with `svc.getBrandingForApp is not a function`.

- [ ] **Step 3: Replace `getLogoForApp` with `getBrandingForApp`**

Modify `apps/auth-server/src/social/social.service.ts`:

In the `Db` type (line 6-12), widen the `findUnique` result to include `name` and `favicon`:

```ts
type Db = {
  saApp: { findUnique(args: unknown): Promise<{ id: number; isPlatform?: boolean; name?: string | null; logo?: string | null; favicon?: string | null } | null> };
  saSocialProvider: {
    findMany(args?: unknown): Promise<{ appId: number | null; provider: string; enabled: boolean }[]>;
    upsert(args: unknown): Promise<unknown>;
  };
};
```

Replace the `getLogoForApp` method (lines 65-75) with:

```ts
  /**
   * The name, logo, and favicon to show on the login screen for this app,
   * or all-null if the app has none of these or the client_id is
   * unknown/absent. Mirrors listForApp's enumeration-safety rule: an
   * unknown client_id yields all-null fields, never a throw, so this stays
   * indistinguishable from "app has none of these set." Consolidated from
   * the former single-field getLogoForApp into one lookup now that a
   * second (name) and third (favicon) field are needed — one findUnique
   * call instead of three near-identical ones.
   */
  async getBrandingForApp(clientId: string | undefined): Promise<{ name: string | null; logo: string | null; favicon: string | null }> {
    if (!clientId) return { name: null, logo: null, favicon: null };
    const app = await this.db.saApp.findUnique({
      where: { publicId: clientId },
      select: { id: true, name: true, logo: true, favicon: true },
    });
    return { name: app?.name ?? null, logo: app?.logo ?? null, favicon: app?.favicon ?? null };
  }
```

- [ ] **Step 4: Run service tests to verify they pass**

Run: `pnpm --filter auth-server test -- social.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Write the failing controller tests**

Modify `apps/auth-server/src/social/social.controller.spec.ts`. Replace the `buildApp` helper and the three `describe('SocialController (public reachability)', ...)` tests that assert on `res.body`:

```ts
  async function buildApp(listForApp: jest.Mock, branding: { name: string | null; logo: string | null; favicon: string | null } = { name: null, logo: null, favicon: null }): Promise<INestApplication> {
    const getBrandingForApp = jest.fn().mockResolvedValue(branding);
    const moduleRef = await Test.createTestingModule({
      controllers: [SocialController],
      providers: [{ provide: SocialService, useValue: { listForApp, getBrandingForApp } }],
    }).compile();
    const instance = moduleRef.createNestApplication();
    instance.setGlobalPrefix('api');
    await instance.init();
    return instance;
  }
```

```ts
  it('answers GET /api/social-providers with 200 and no auth', async () => {
    app = await buildApp(jest.fn().mockResolvedValue(['google']));
    const res = await request(app.getHttpServer())
      .get('/api/social-providers')
      .query({ client_id: 'qp31' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ providers: ['google'], logo: null, name: null, favicon: null });
  });

  it('answers 200 with an empty list for an unknown client_id — never 404', async () => {
    app = await buildApp(jest.fn().mockResolvedValue([]));
    const res = await request(app.getHttpServer())
      .get('/api/social-providers')
      .query({ client_id: 'doesnotexist' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ providers: [], logo: null, name: null, favicon: null });
  });
```

(The third test, `'sends no cookie/authorization header, proving the route needs none'`, doesn't assert on `res.body` — leave it unchanged.)

- [ ] **Step 6: Run controller tests to verify they fail**

Run: `pnpm --filter auth-server test -- social.controller.spec.ts`
Expected: FAIL — `SocialController.list` still calls the (now-removed) `getLogoForApp` and returns `{ providers, logo }` only.

- [ ] **Step 7: Update `SocialController.list`**

Modify `apps/auth-server/src/social/social.controller.ts`, the `list` method (lines 51-59):

```ts
  @SkipThrottle({ default: true, auth: true })
  @Get()
  async list(@Query('client_id') clientId?: string): Promise<{
    providers: string[]; logo: string | null; name: string | null; favicon: string | null
  }> {
    const [providers, branding] = await Promise.all([
      this.social.listForApp(clientId),
      this.social.getBrandingForApp(clientId),
    ]);
    return { providers, ...branding };
  }
```

- [ ] **Step 8: Run controller tests to verify they pass**

Run: `pnpm --filter auth-server test -- social.controller.spec.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add apps/auth-server/src/social/social.service.ts apps/auth-server/src/social/social.service.spec.ts apps/auth-server/src/social/social.controller.ts apps/auth-server/src/social/social.controller.spec.ts
git commit -m "feat(auth-server): include name and favicon in GET /api/social-providers"
```

---

## Task 8: `favicon` on the admin `App`/`CreateAppPayload`/`UpdateAppPayload` types

**Files:**
- Modify: `apps/admin/lib/types.ts:91-148`

- [ ] **Step 1: Add `favicon` to the three interfaces**

Modify `apps/admin/lib/types.ts`. In `App` (after `logo` at line 95):

```ts
export interface App {
  publicId: string;
  name: string;
  url: string;
  logo?: string | null;
  favicon?: string | null;
  redirectUris?: RedirectUri[];
```

In `CreateAppPayload` (after `logo` at line 123):

```ts
export interface CreateAppPayload {
  name: string;
  url: string;
  logo?: string | null;
  favicon?: string | null;
  redirectUris?: RedirectUri[];
```

In `UpdateAppPayload` (after `logo` at line 134):

```ts
export interface UpdateAppPayload {
  name?: string;
  url?: string;
  logo?: string | null;
  favicon?: string | null;
  redirectUris?: RedirectUri[];
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter admin exec tsc --noEmit`
Expected: succeeds with no new errors (this is a pure type widening; nothing yet reads or writes `favicon`, so no call site should break).

- [ ] **Step 3: Commit**

```bash
git add apps/admin/lib/types.ts
git commit -m "feat(admin): add favicon to App/CreateAppPayload/UpdateAppPayload types"
```

---

## Task 9: `favicon` in `fetchAppInfo` (signup page's data source)

**Files:**
- Modify: `apps/admin/lib/app-info.ts`
- Modify: `apps/admin/lib/__tests__/app-info.test.ts`

- [ ] **Step 1: Write the failing tests**

Modify `apps/admin/lib/__tests__/app-info.test.ts`, adding `favicon: null` to every expected object in the existing four tests (they all currently list `logo: null` — add `favicon: null` right after it in each `.resolves.toEqual({...})` block). For example, the first test becomes:

```ts
  it('returns the app name, hasDefaultOrg, and passwordPolicy when the response is ok', async () => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ name: 'Acme', hasDefaultOrg: true, passwordPolicy: POLICY }),
    } as Response)

    await expect(fetchAppInfo('sq_1')).resolves.toEqual({
      name: 'Acme',
      hasDefaultOrg: true,
      passwordPolicy: POLICY,
      logo: null,
      favicon: null,
      privacyPolicyUrl: null,
      termsUrl: null,
      gdprUrl: null,
      gdprRequired: false,
    })
  })
```

Apply the same `favicon: null` addition to the other three tests (`'falls back to passwordPolicy: null...'`, `'falls back to name: null... when the response is not ok'`, `'falls back to name: null... when fetch throws'`).

Then add one new test at the end of the `describe` block:

```ts
  it('returns the favicon from a successful response', async () => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ name: 'Acme', hasDefaultOrg: true, passwordPolicy: POLICY, favicon: 'data:image/png;base64,FFF=' }),
    } as Response)

    await expect(fetchAppInfo('sq_1')).resolves.toEqual({
      name: 'Acme',
      hasDefaultOrg: true,
      passwordPolicy: POLICY,
      logo: null,
      favicon: 'data:image/png;base64,FFF=',
      privacyPolicyUrl: null,
      termsUrl: null,
      gdprUrl: null,
      gdprRequired: false,
    })
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter admin test -- app-info.test.ts`
Expected: FAIL — actual result omits `favicon`.

- [ ] **Step 3: Add `favicon` to `fetchAppInfo`**

Modify `apps/admin/lib/app-info.ts`:

```ts
export async function fetchAppInfo(
  clientId: string,
): Promise<{
  name: string | null; hasDefaultOrg: boolean; passwordPolicy: PasswordPolicy | null; logo: string | null;
  favicon: string | null;
  privacyPolicyUrl: string | null; termsUrl: string | null; gdprUrl: string | null; gdprRequired: boolean;
}> {
  try {
    const forwardedIp = await getForwardedClientIpHeader()
    const res = await fetch(`${AUTH_SERVER}/api/register/app?appPublicId=${encodeURIComponent(clientId)}`, {
      cache: 'no-store',
      headers: { ...forwardedIp },
    })
    if (!res.ok) {
      return {
        name: null, hasDefaultOrg: false, passwordPolicy: null, logo: null, favicon: null,
        privacyPolicyUrl: null, termsUrl: null, gdprUrl: null, gdprRequired: false,
      }
    }
    const body = (await res.json()) as {
      name?: string; hasDefaultOrg?: boolean; passwordPolicy?: PasswordPolicy; logo?: string | null; favicon?: string | null;
      privacyPolicyUrl?: string | null; termsUrl?: string | null; gdprUrl?: string | null; gdprRequired?: boolean;
    }
    return {
      name: typeof body.name === 'string' ? body.name : null,
      hasDefaultOrg: body.hasDefaultOrg === true,
      passwordPolicy: body.passwordPolicy ?? null,
      logo: typeof body.logo === 'string' ? body.logo : null,
      favicon: typeof body.favicon === 'string' ? body.favicon : null,
      privacyPolicyUrl: typeof body.privacyPolicyUrl === 'string' ? body.privacyPolicyUrl : null,
      termsUrl: typeof body.termsUrl === 'string' ? body.termsUrl : null,
      gdprUrl: typeof body.gdprUrl === 'string' ? body.gdprUrl : null,
      gdprRequired: body.gdprRequired === true,
    }
  } catch {
    return {
      name: null, hasDefaultOrg: false, passwordPolicy: null, logo: null, favicon: null,
      privacyPolicyUrl: null, termsUrl: null, gdprUrl: null, gdprRequired: false,
    }
  }
}
```

(Only the return type, the two fallback return objects, the `body` cast, and the success-path return object change — the function's control flow is untouched.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter admin test -- app-info.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/admin/lib/app-info.ts apps/admin/lib/__tests__/app-info.test.ts
git commit -m "feat(admin): include favicon in fetchAppInfo"
```

---

## Task 10: `name` + `favicon` in `fetchSocialProviders` (login page's data source)

**Files:**
- Modify: `apps/admin/lib/social-providers.ts`
- Modify: `apps/admin/lib/__tests__/social-providers.test.ts`

- [ ] **Step 1: Write the failing tests**

Modify `apps/admin/lib/__tests__/social-providers.test.ts` in full:

```ts
import { fetchSocialProviders } from '../social-providers'

const originalFetch = global.fetch

afterEach(() => {
  global.fetch = originalFetch
})

describe('fetchSocialProviders', () => {
  it('returns providers, logo, name, and favicon from a successful response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ providers: ['google'], logo: 'data:image/png;base64,AAA=', name: 'Acme', favicon: 'data:image/png;base64,FFF=' }),
    }) as unknown as typeof fetch

    await expect(fetchSocialProviders('/authorize?client_id=sq_1')).resolves.toEqual({
      providers: ['google'],
      logo: 'data:image/png;base64,AAA=',
      name: 'Acme',
      favicon: 'data:image/png;base64,FFF=',
    })
  })

  it('returns an empty providers list and all-null fields on a non-ok response', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false }) as unknown as typeof fetch

    await expect(fetchSocialProviders('/authorize?client_id=sq_1')).resolves.toEqual({
      providers: [],
      logo: null,
      name: null,
      favicon: null,
    })
  })

  it('returns an empty providers list and all-null fields when fetch throws', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network')) as unknown as typeof fetch

    await expect(fetchSocialProviders('/authorize?client_id=sq_1')).resolves.toEqual({
      providers: [],
      logo: null,
      name: null,
      favicon: null,
    })
  })

  it('tolerates malformed logo/name/favicon fields in the response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ providers: ['google'], logo: 123, name: 456, favicon: 789 }),
    }) as unknown as typeof fetch

    await expect(fetchSocialProviders('/authorize?client_id=sq_1')).resolves.toEqual({
      providers: ['google'],
      logo: null,
      name: null,
      favicon: null,
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter admin test -- social-providers.test.ts`
Expected: FAIL — actual result omits `name`/`favicon`.

- [ ] **Step 3: Add `name`/`favicon` to `fetchSocialProviders`**

Modify `apps/admin/lib/social-providers.ts`:

```ts
const AUTH_SERVER = process.env.AUTH_SERVER_URL ?? 'https://localhost:3010'

/**
 * Ask the auth-server which provider buttons this app shows, and what
 * branding (name/logo/favicon, if any) to render on the login card. `next`
 * is the authorize URL the user was bounced from; its client_id names the
 * app. Any failure yields an empty provider list and no branding — the
 * password form must still render.
 */
export async function fetchSocialProviders(next: string): Promise<{
  providers: string[]; logo: string | null; name: string | null; favicon: string | null
}> {
  let clientId: string | null = null
  try {
    clientId = new URL(next, 'http://placeholder.invalid').searchParams.get('client_id')
  } catch {
    clientId = null
  }

  const query = clientId ? `?client_id=${encodeURIComponent(clientId)}` : ''
  try {
    const res = await fetch(`${AUTH_SERVER}/api/social-providers${query}`, { cache: 'no-store' })
    if (!res.ok) return { providers: [], logo: null, name: null, favicon: null }
    const body = (await res.json()) as { providers?: unknown; logo?: unknown; name?: unknown; favicon?: unknown }
    return {
      providers: Array.isArray(body.providers) ? (body.providers as string[]) : [],
      logo: typeof body.logo === 'string' ? body.logo : null,
      name: typeof body.name === 'string' ? body.name : null,
      favicon: typeof body.favicon === 'string' ? body.favicon : null,
    }
  } catch {
    return { providers: [], logo: null, name: null, favicon: null }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter admin test -- social-providers.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Run the full admin test suite to catch other `fetchSocialProviders` mocks**

Run: `pnpm --filter admin test`
Expected: PASS. If any other test mocks `fetchSocialProviders` to resolve `{ providers: [...], logo: ... }` without `name`/`favicon`, update it to include `name: null, favicon: null` (or specific values, if the test cares) — this widened return shape is additive, so a mock lacking the new keys will make `undefined !== null` assertions fail wherever a test asserts the full object with `toEqual`.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/lib/social-providers.ts apps/admin/lib/__tests__/social-providers.test.ts
git commit -m "feat(admin): include name and favicon in fetchSocialProviders"
```

---

## Task 11: `favicon` translations (en/fr)

**Files:**
- Modify: `apps/admin/messages/en.json:60-63,173-174`
- Modify: `apps/admin/messages/fr.json:60-63,173-174`

- [ ] **Step 1: Add the English keys**

Modify `apps/admin/messages/en.json`. After line 63 (`"noLogo": "No logo configured",`), add:

```json
      "favicon": "App favicon",
      "faviconHint": "Shown as the browser tab icon on this app's sign in and sign up pages. PNG, JPEG, WebP, or SVG, up to 250KB.",
      "removeFavicon": "Remove favicon",
      "noFavicon": "No favicon configured",
```

After line 174 (`"logoTooLarge": "That image is too large. Please choose one under 250KB.",`), add:

```json
      "faviconInvalidType": "Please choose a PNG, JPEG, WebP, or SVG image.",
      "faviconTooLarge": "That image is too large. Please choose one under 250KB.",
```

- [ ] **Step 2: Add the French keys**

Modify `apps/admin/messages/fr.json`. After line 63 (`"noLogo": "Aucun logo configuré",`), add:

```json
      "favicon": "Favicon de l'application",
      "faviconHint": "Affiché comme icône d'onglet sur les pages de connexion et d'inscription de cette application. PNG, JPEG, WebP ou SVG, 250 Ko maximum.",
      "removeFavicon": "Supprimer le favicon",
      "noFavicon": "Aucun favicon configuré",
```

After line 174 (`"logoTooLarge": "Cette image est trop volumineuse. Veuillez en choisir une de moins de 250 Ko.",`), add:

```json
      "faviconInvalidType": "Veuillez choisir une image PNG, JPEG, WebP ou SVG.",
      "faviconTooLarge": "Cette image est trop volumineuse. Veuillez en choisir une de moins de 250 Ko.",
```

- [ ] **Step 3: Run the locale parity test**

Run: `pnpm --filter admin test -- messages-parity.test.ts`
Expected: PASS — both files now carry exactly the same key set.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/messages/en.json apps/admin/messages/fr.json
git commit -m "feat(admin): add en/fr translations for app favicon"
```

---

## Task 12: Generalize `AppLogoField` into `AppImageField`, add `AppFaviconField`

**Files:**
- Create: `apps/admin/components/app-image-field.tsx`
- Modify: `apps/admin/components/app-logo-field.tsx`
- Create: `apps/admin/components/app-favicon-field.tsx`
- Create: `apps/admin/components/__tests__/app-favicon-field.test.tsx`
- Verify only (no edits expected): `apps/admin/components/__tests__/app-logo-field.test.tsx`

**Interfaces:**
- Produces: `AppImageField(props: AppImageFieldProps)`, `AppFaviconField({ value, onValueChange })` — `AppFaviconField` consumed by Tasks 13-15.
- `AppLogoField`'s existing public signature (`{ value, onValueChange }`) is unchanged — every existing caller (`app-create-drawer.tsx`, `app-edit-drawer.tsx`) keeps working without modification.

- [ ] **Step 1: Write the failing test for the new `AppFaviconField`**

Create `apps/admin/components/__tests__/app-favicon-field.test.tsx`:

```tsx
import * as React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import en from '@/messages/en.json'
import { AppFaviconField } from '../app-favicon-field'

function withIntl(node: React.ReactNode) {
  return (
    <NextIntlClientProvider locale="en" messages={en}>
      {node}
    </NextIntlClientProvider>
  )
}

describe('AppFaviconField', () => {
  it('converts a valid small image to a data URI and calls onValueChange', async () => {
    const onValueChange = jest.fn()
    render(withIntl(<AppFaviconField value={null} onValueChange={onValueChange} />))
    const file = new File(['a'.repeat(10)], 'favicon.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText(en.apps.fields.favicon), { target: { files: [file] } })
    await waitFor(() => expect(onValueChange).toHaveBeenCalledWith(expect.stringMatching(/^data:image\/png;base64,/)))
  })

  it('rejects a disallowed file type without calling onValueChange', async () => {
    const onValueChange = jest.fn()
    render(withIntl(<AppFaviconField value={null} onValueChange={onValueChange} />))
    const file = new File(['a'.repeat(10)], 'favicon.gif', { type: 'image/gif' })
    fireEvent.change(screen.getByLabelText(en.apps.fields.favicon), { target: { files: [file] } })
    await waitFor(() => expect(screen.getByText(en.apps.errors.faviconInvalidType)).toBeInTheDocument())
    expect(onValueChange).not.toHaveBeenCalled()
  })

  it('rejects a file over the size cap without calling onValueChange', async () => {
    const onValueChange = jest.fn()
    render(withIntl(<AppFaviconField value={null} onValueChange={onValueChange} />))
    const oversized = new File([new Uint8Array(260 * 1024)], 'favicon.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText(en.apps.fields.favicon), { target: { files: [oversized] } })
    await waitFor(() => expect(screen.getByText(en.apps.errors.faviconTooLarge)).toBeInTheDocument())
    expect(onValueChange).not.toHaveBeenCalled()
  })

  it('shows a preview and a remove button when a value is set, and clears on remove', () => {
    const onValueChange = jest.fn()
    render(withIntl(<AppFaviconField value="data:image/png;base64,AAA=" onValueChange={onValueChange} />))
    expect(screen.getByRole('img')).toHaveAttribute('src', 'data:image/png;base64,AAA=')
    fireEvent.click(screen.getByRole('button', { name: en.apps.fields.removeFavicon }))
    expect(onValueChange).toHaveBeenCalledWith(null)
  })

  it('shows no preview or remove button when value is null', () => {
    render(withIntl(<AppFaviconField value={null} onValueChange={jest.fn()} />))
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: en.apps.fields.removeFavicon })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter admin test -- app-favicon-field.test.tsx`
Expected: FAIL — `../app-favicon-field` does not exist.

- [ ] **Step 3: Create the generalized `AppImageField`**

Create `apps/admin/components/app-image-field.tsx`:

```tsx
'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { X } from 'lucide-react'
import { Label } from '@sassy-auth/ui'
import { readFileAsDataUri } from '@/lib/read-file-as-data-uri'

interface Props {
  value: string | null
  onValueChange: (next: string | null) => void
  inputId: string
  label: string
  hint: string
  removeLabel: string
  allowedMimeTypes: readonly string[]
  maxBytes: number
  invalidTypeErrorKey: string
  tooLargeErrorKey: string
}

export function AppImageField({
  value, onValueChange, inputId, label, hint, removeLabel, allowedMimeTypes, maxBytes, invalidTypeErrorKey, tooLargeErrorKey,
}: Props) {
  const t = useTranslations()
  const [errorKey, setErrorKey] = React.useState<string | null>(null)

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!allowedMimeTypes.includes(file.type)) {
      setErrorKey(invalidTypeErrorKey)
      return
    }
    if (file.size > maxBytes) {
      setErrorKey(tooLargeErrorKey)
      return
    }
    setErrorKey(null)
    const dataUri = await readFileAsDataUri(file)
    onValueChange(dataUri)
  }

  function handleRemove() {
    setErrorKey(null)
    onValueChange(null)
  }

  return (
    <div>
      <Label htmlFor={inputId}>{label}</Label>
      <p className="mt-1 text-body-sm text-muted-foreground">{hint}</p>
      <div className="mt-2 flex items-center gap-3">
        {value && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={value}
            alt={label}
            className="h-10 w-10 rounded border border-border object-contain"
          />
        )}
        <input
          id={inputId}
          type="file"
          accept={allowedMimeTypes.join(',')}
          onChange={handleFileChange}
          className="block text-body-sm"
        />
        {value && (
          <button
            type="button"
            aria-label={removeLabel}
            onClick={handleRemove}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-border text-muted-foreground hover:text-destructive"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {errorKey && (
        <p role="alert" className="mt-1 text-body-sm text-destructive">
          {t(errorKey)}
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Turn `AppLogoField` into a thin wrapper**

Replace the full contents of `apps/admin/components/app-logo-field.tsx` with:

```tsx
'use client'

import { useTranslations } from 'next-intl'
import { APP_LOGO_ALLOWED_MIME_TYPES, APP_LOGO_MAX_BYTES } from '@sassy-auth/types'
import { AppImageField } from './app-image-field'

interface Props {
  value: string | null
  onValueChange: (next: string | null) => void
}

export function AppLogoField({ value, onValueChange }: Props) {
  const t = useTranslations()
  return (
    <AppImageField
      value={value}
      onValueChange={onValueChange}
      inputId="appLogo"
      label={t('apps.fields.logo')}
      hint={t('apps.fields.logoHint')}
      removeLabel={t('apps.fields.removeLogo')}
      allowedMimeTypes={APP_LOGO_ALLOWED_MIME_TYPES}
      maxBytes={APP_LOGO_MAX_BYTES}
      invalidTypeErrorKey="apps.errors.logoInvalidType"
      tooLargeErrorKey="apps.errors.logoTooLarge"
    />
  )
}
```

- [ ] **Step 5: Create `AppFaviconField`**

Create `apps/admin/components/app-favicon-field.tsx`:

```tsx
'use client'

import { useTranslations } from 'next-intl'
import { APP_FAVICON_ALLOWED_MIME_TYPES, APP_FAVICON_MAX_BYTES } from '@sassy-auth/types'
import { AppImageField } from './app-image-field'

interface Props {
  value: string | null
  onValueChange: (next: string | null) => void
}

export function AppFaviconField({ value, onValueChange }: Props) {
  const t = useTranslations()
  return (
    <AppImageField
      value={value}
      onValueChange={onValueChange}
      inputId="appFavicon"
      label={t('apps.fields.favicon')}
      hint={t('apps.fields.faviconHint')}
      removeLabel={t('apps.fields.removeFavicon')}
      allowedMimeTypes={APP_FAVICON_ALLOWED_MIME_TYPES}
      maxBytes={APP_FAVICON_MAX_BYTES}
      invalidTypeErrorKey="apps.errors.faviconInvalidType"
      tooLargeErrorKey="apps.errors.faviconTooLarge"
    />
  )
}
```

- [ ] **Step 6: Run the new favicon field test**

Run: `pnpm --filter admin test -- app-favicon-field.test.tsx`
Expected: PASS (5 tests)

- [ ] **Step 7: Run the existing logo field test to confirm the refactor didn't break it**

Run: `pnpm --filter admin test -- app-logo-field.test.tsx`
Expected: PASS (5 tests, unchanged) — `AppLogoField`'s external behavior (label, hint, error keys, preview, remove button) is identical to before.

- [ ] **Step 8: Commit**

```bash
git add apps/admin/components/app-image-field.tsx apps/admin/components/app-logo-field.tsx apps/admin/components/app-favicon-field.tsx apps/admin/components/__tests__/app-favicon-field.test.tsx
git commit -m "refactor(admin): generalize AppLogoField into AppImageField, add AppFaviconField"
```

---

## Task 13: Wire `AppFaviconField` into `AppCreateDrawer`

**Files:**
- Modify: `apps/admin/components/app-create-drawer.tsx`
- Modify: `apps/admin/components/__tests__/app-create-drawer.test.tsx`

- [ ] **Step 1: Write the failing test**

Modify `apps/admin/components/__tests__/app-create-drawer.test.tsx`, adding a new test right after the existing `'includes a picked logo in the create payload'` test:

```tsx
  it('includes a picked favicon in the create payload', async () => {
    ;(actions.createAppAction as jest.Mock).mockResolvedValue({
      app: { publicId: 'sq_1', name: 'X', url: 'https://x.example', isPlatform: false },
    })
    render(withIntl(<AppCreateDrawer open onOpenChange={() => undefined} />))
    fireEvent.change(screen.getByLabelText(en.apps.fields.name), { target: { value: 'X' } })
    fireEvent.change(screen.getByLabelText(en.apps.fields.url), { target: { value: 'https://x.example' } })

    const file = new File(['a'.repeat(10)], 'favicon.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText(en.apps.fields.favicon), { target: { files: [file] } })
    await waitFor(() => expect(screen.getByRole('img')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: en.apps.drawer.createTitle }))
    await waitFor(() =>
      expect(actions.createAppAction).toHaveBeenCalledWith(
        expect.objectContaining({ favicon: expect.stringMatching(/^data:image\/png;base64,/) }),
      ),
    )
  })
```

This uses the same `render`/`withIntl`/`fireEvent`/`waitFor`/`en`/`actions` symbols the file already imports at its top (see the existing `'includes a picked logo in the create payload'` test at line 182 for the identical pattern) — no new imports needed.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter admin test -- app-create-drawer.test.tsx`
Expected: FAIL — `screen.getByLabelText(en.apps.fields.favicon)` finds no element.

- [ ] **Step 3: Add the favicon field and state**

Modify `apps/admin/components/app-create-drawer.tsx`:

Add the import next to `AppLogoField`:

```tsx
import { AppLogoField } from './app-logo-field'
import { AppFaviconField } from './app-favicon-field'
```

Add state next to `logo` (line 38):

```tsx
  const [logo, setLogo] = React.useState<string | null>(null)
  const [favicon, setFavicon] = React.useState<string | null>(null)
```

Add the reset-on-close line next to `setLogo(null)` (line 50):

```tsx
      setLogo(null)
      setFavicon(null)
```

Add `favicon` to the `createAppAction` call (line 67-75):

```tsx
      const result = await createAppAction({
        name: name.trim(),
        url: url.trim(),
        logo,
        favicon,
        redirectUris,
        twoFactorTrustDays,
        requireTwoFactor,
        twoFactorPromptEnabled: twoFactorPromptEnabled === null ? undefined : twoFactorPromptEnabled,
      })
```

Render `<AppFaviconField>` right after `<AppLogoField>` (line 120-122):

```tsx
            <div>
              <AppLogoField value={logo} onValueChange={setLogo} />
            </div>
            <div>
              <AppFaviconField value={favicon} onValueChange={setFavicon} />
            </div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter admin test -- app-create-drawer.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/admin/components/app-create-drawer.tsx apps/admin/components/__tests__/app-create-drawer.test.tsx
git commit -m "feat(admin): add favicon upload to the create-app drawer"
```

---

## Task 14: Wire `favicon` into `AppEditDrawer`

**Files:**
- Modify: `apps/admin/components/app-edit-drawer.tsx`
- Modify: `apps/admin/components/__tests__/app-edit-drawer.test.tsx`

- [ ] **Step 1: Write the failing test**

Modify `apps/admin/components/__tests__/app-edit-drawer.test.tsx`, adding a new test right after the existing `'includes a changed logo in the update payload'` test (around line 213-229):

```tsx
  it('includes a changed favicon in the update payload', async () => {
    ;(actions.updateAppAction as jest.Mock).mockResolvedValue({ app: { ...app, name: 'X2' } })
    const onOpenChange = jest.fn()
    render(withIntl(<AppEditDrawer app={app} open onOpenChange={onOpenChange} />))

    const file = new File(['a'.repeat(10)], 'favicon.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText(en.apps.fields.favicon), { target: { files: [file] } })
    await waitFor(() => expect(screen.getByRole('img')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: en.apps.drawer.save }))
    await waitFor(() =>
      expect(actions.updateAppAction).toHaveBeenCalledWith(
        'sq_1',
        expect.objectContaining({ favicon: expect.stringMatching(/^data:image\/png;base64,/) }),
      ),
    )
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('backfills the favicon from getAppAction and does not mark the form dirty from that alone', async () => {
    ;(actions.getAppAction as jest.Mock).mockResolvedValue({
      app: { ...app, favicon: 'data:image/png;base64,EXISTING=' },
    })
    render(withIntl(<AppEditDrawer app={app} open onOpenChange={() => undefined} />))

    await waitFor(() => expect(actions.getAppAction).toHaveBeenCalledWith('sq_1'))
    await waitFor(() =>
      expect(screen.getByRole('img')).toHaveAttribute('src', 'data:image/png;base64,EXISTING='),
    )
    expect(screen.getByRole('button', { name: en.apps.drawer.save })).toBeDisabled()
  })
```

This mirrors the existing `'includes a changed logo in the update payload'` (line 213) and `'backfills the logo from getAppAction...'` (line 200) tests exactly, using the same `app` fixture (defined once near the top of the file, at line 129) and the same `render`/`withIntl`/`fireEvent`/`waitFor`/`en`/`actions` symbols already imported there — no new imports needed.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter admin test -- app-edit-drawer.test.tsx`
Expected: FAIL — `screen.getByLabelText(en.apps.fields.favicon)` finds no element.

- [ ] **Step 3: Add favicon state, dirty check, patch building, and the field**

Modify `apps/admin/components/app-edit-drawer.tsx`:

Add the import next to `AppLogoField`:

```tsx
import { AppLogoField } from './app-logo-field'
import { AppFaviconField } from './app-favicon-field'
```

Add state next to `logo`/`originalLogo` (lines 42-48):

```tsx
  const [logo, setLogo] = React.useState<string | null>(app.logo ?? null)
  const [originalLogo, setOriginalLogo] = React.useState<string | null>(app.logo ?? null)
  const [favicon, setFavicon] = React.useState<string | null>(app.favicon ?? null)
  const [originalFavicon, setOriginalFavicon] = React.useState<string | null>(app.favicon ?? null)
```

In the `useEffect` that resets state when `app`/`open` changes (lines 113-117), add next to `setOriginalLogo`:

```tsx
    setLogo(app.logo ?? null)
    setOriginalLogo(app.logo ?? null)
    setFavicon(app.favicon ?? null)
    setOriginalFavicon(app.favicon ?? null)
```

In the `getAppAction` backfill callback (lines 156-166), add next to `setOriginalLogo`:

```tsx
      if ('app' in result) {
        setLogo(result.app.logo ?? null)
        setOriginalLogo(result.app.logo ?? null)
        setFavicon(result.app.favicon ?? null)
        setOriginalFavicon(result.app.favicon ?? null)
```

Extend the `dirty` expression (line 251) — add `|| favicon !== originalFavicon` right after `logo !== originalLogo`:

```tsx
  const dirty = name !== app.name || url !== app.url || logo !== originalLogo || favicon !== originalFavicon || redirectUrisDirty || twoFactorTrustDays !== (app.twoFactorTrustDays ?? null) || twoFactorPromptEnabled !== (app.twoFactorPromptEnabled ?? null) || requireTwoFactor !== (app.requireTwoFactor ?? false) || allowOfflineAccess !== (app.allowOfflineAccess ?? false) || socialDirty || defaultOrgId !== (app.defaultOrgId ?? null) || defaultRoleId !== (app.defaultRoleId ?? null) || passwordPolicyDirty || webhookUrlDirty || activationDirty || privacyPolicyUrlDirty || termsUrlDirty || gdprUrlDirty
```

Extend the `patch` type (line 264) — add `favicon?: string | null;` right after `logo?: string | null;`:

```tsx
    const patch: { name?: string; url?: string; logo?: string | null; favicon?: string | null; redirectUris?: RedirectUri[]; twoFactorTrustDays?: number | null; twoFactorPromptEnabled?: boolean | null; requireTwoFactor?: boolean; allowOfflineAccess?: boolean; defaultOrgId?: string | null; defaultRoleId?: string | null; passwordPolicyOverride?: PasswordPolicy | null; activationWebhookUrl?: string | null; activationEmailOverride?: import('@/lib/types').ActivationEmailBranding | null; privacyPolicyUrl?: string | null; termsUrl?: string | null; gdprUrl?: string | null } = {}
```

Add the patch-building line (line 267) right after `if (logo !== originalLogo) patch.logo = logo`:

```tsx
    if (logo !== originalLogo) patch.logo = logo
    if (favicon !== originalFavicon) patch.favicon = favicon
```

Render `<AppFaviconField>` right after `<AppLogoField>` (lines 361-363):

```tsx
            <div>
              <AppLogoField value={logo} onValueChange={setLogo} />
            </div>
            <div>
              <AppFaviconField value={favicon} onValueChange={setFavicon} />
            </div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter admin test -- app-edit-drawer.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/admin/components/app-edit-drawer.tsx apps/admin/components/__tests__/app-edit-drawer.test.tsx
git commit -m "feat(admin): add favicon upload to the edit-app drawer"
```

---

## Task 15: Read-only favicon preview in `AppViewDrawer`

**Files:**
- Modify: `apps/admin/components/app-view-drawer.tsx`
- Modify: `apps/admin/components/__tests__/app-view-drawer.test.tsx`

- [ ] **Step 1: Write the failing test**

Modify `apps/admin/components/__tests__/app-view-drawer.test.tsx`, finding the existing test that asserts `expect(screen.getByText(en.apps.fields.noLogo)).toBeInTheDocument()` (around line 110) and adding, right after that line:

```tsx
    expect(screen.getByText(en.apps.fields.noFavicon)).toBeInTheDocument()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter admin test -- app-view-drawer.test.tsx`
Expected: FAIL — `en.apps.fields.noFavicon` text is not found.

- [ ] **Step 3: Add the read-only favicon block**

Modify `apps/admin/components/app-view-drawer.tsx`, right after the existing logo block (lines 105-115):

```tsx
          <div>
            <p className="text-label-sm font-bold uppercase tracking-wider text-muted-foreground">{t('apps.fields.logo')}</p>
            <div className="mt-1 flex items-center rounded border border-border bg-card px-3 py-2">
              {displayApp.logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={displayApp.logo} alt={t('apps.fields.logo')} className="h-10 w-10 rounded border border-border object-contain" />
              ) : (
                <span className="text-body-sm text-muted-foreground">{t('apps.fields.noLogo')}</span>
              )}
            </div>
          </div>
          <div>
            <p className="text-label-sm font-bold uppercase tracking-wider text-muted-foreground">{t('apps.fields.favicon')}</p>
            <div className="mt-1 flex items-center rounded border border-border bg-card px-3 py-2">
              {displayApp.favicon ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={displayApp.favicon} alt={t('apps.fields.favicon')} className="h-10 w-10 rounded border border-border object-contain" />
              ) : (
                <span className="text-body-sm text-muted-foreground">{t('apps.fields.noFavicon')}</span>
              )}
            </div>
          </div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter admin test -- app-view-drawer.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/admin/components/app-view-drawer.tsx apps/admin/components/__tests__/app-view-drawer.test.tsx
git commit -m "feat(admin): show favicon preview in the app view drawer"
```

---

## Task 16: `/signup` dynamic title + favicon

**Files:**
- Modify: `apps/admin/app/signup/page.tsx`
- Modify: `apps/admin/app/signup/__tests__/page.test.tsx`

- [ ] **Step 1: Write the failing tests**

Modify `apps/admin/app/signup/__tests__/page.test.tsx`, adding `import SignupPage, { generateMetadata } from '../page'` in place of the current `import SignupPage from '../page'`, and adding a new `describe` block at the end of the file:

```tsx
describe('SignupPage generateMetadata', () => {
  it('sets the title to "{appName} Sign Up" when the app has a name', async () => {
    mockFetchAppInfo.mockResolvedValue({ ...BASE_APP_INFO, name: 'Acme' })
    const metadata = await generateMetadata({ searchParams: Promise.resolve({ client_id: 'sq_1' }) })
    expect(metadata.title).toBe('Acme Sign Up')
  })

  it('leaves the title unset when there is no client_id', async () => {
    const metadata = await generateMetadata({ searchParams: Promise.resolve({}) })
    expect(metadata.title).toBeUndefined()
    expect(mockFetchAppInfo).not.toHaveBeenCalled()
  })

  it('leaves the title unset when the app has no name', async () => {
    mockFetchAppInfo.mockResolvedValue({ ...BASE_APP_INFO, name: null })
    const metadata = await generateMetadata({ searchParams: Promise.resolve({ client_id: 'sq_1' }) })
    expect(metadata.title).toBeUndefined()
  })

  it('sets the tab icon when the app has a favicon', async () => {
    mockFetchAppInfo.mockResolvedValue({ ...BASE_APP_INFO, name: 'Acme', favicon: 'data:image/png;base64,FFF=' })
    const metadata = await generateMetadata({ searchParams: Promise.resolve({ client_id: 'sq_1' }) })
    expect(metadata.icons).toEqual({ icon: 'data:image/png;base64,FFF=' })
  })

  it('leaves the icon unset when the app has no favicon', async () => {
    mockFetchAppInfo.mockResolvedValue({ ...BASE_APP_INFO, name: 'Acme', favicon: null })
    const metadata = await generateMetadata({ searchParams: Promise.resolve({ client_id: 'sq_1' }) })
    expect(metadata.icons).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter admin test -- signup/__tests__/page.test.tsx`
Expected: FAIL — `../page` has no exported member `generateMetadata`.

- [ ] **Step 3: Add `generateMetadata` to the signup page**

Modify `apps/admin/app/signup/page.tsx`:

```tsx
import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { AuthCard } from '@sassy-auth/ui'
import { fetchAppInfo } from '@/lib/app-info'
import { SignupForm } from './signup-form'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ client_id?: string; next?: string }>
}): Promise<Metadata> {
  const { client_id: clientId } = await searchParams
  if (!clientId) return {}
  const { name: appName, favicon } = await fetchAppInfo(clientId)
  return {
    ...(appName && { title: `${appName} Sign Up` }),
    ...(favicon && { icons: { icon: favicon } }),
  }
}

export default async function SignupPage({
```

(Only the new `import type { Metadata }` line and the new `generateMetadata` export are added — the rest of the file, starting from `export default async function SignupPage`, is untouched.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter admin test -- signup/__tests__/page.test.tsx`
Expected: PASS (8 tests total: 3 existing subtitle tests + 5 new metadata tests)

- [ ] **Step 5: Commit**

```bash
git add apps/admin/app/signup/page.tsx apps/admin/app/signup/__tests__/page.test.tsx
git commit -m "feat(admin): dynamic tab title and favicon on the signup page"
```

---

## Task 17: `/login` dynamic title + favicon

**Files:**
- Create: `apps/admin/app/login/__tests__/page.test.tsx`
- Modify: `apps/admin/app/login/page.tsx`

- [ ] **Step 1: Write the failing tests**

Create `apps/admin/app/login/__tests__/page.test.tsx`:

```tsx
import { generateMetadata } from '../page'
import { fetchSocialProviders } from '@/lib/social-providers'

jest.mock('@/lib/social-providers', () => ({
  fetchSocialProviders: jest.fn(),
}))

const mockFetchSocialProviders = fetchSocialProviders as jest.MockedFunction<typeof fetchSocialProviders>

// validateNextUrl only accepts a same-origin path or an absolute URL whose
// origin matches AUTH_SERVER_URL (default https://localhost:3010 — see
// apps/admin/lib/safe-next.ts's allowlist()), so this uses that default
// origin rather than a real resource server's domain — the shape mirrors
// the authorize-URL `next` a resource-server SaApp actually sends (e.g.
// `https://auth-api-dev.milissai.com/api/token/oauth/authorize?client_id=...`),
// just on an origin this test environment's default allowlist accepts.
const AUTHORIZE_NEXT = 'https://localhost:3010/api/token/oauth/authorize?client_id=p5sV&redirect_uri=https%3A%2F%2Flocalhost%3A3030%2Fapi%2Fauth%2Fcallback&scope=openid+email+profile'

beforeEach(() => {
  jest.clearAllMocks()
})

describe('LoginPage generateMetadata', () => {
  it('sets the title to "{appName} Sign In" when next resolves to a named app', async () => {
    mockFetchSocialProviders.mockResolvedValue({ providers: [], logo: null, name: 'Acme', favicon: null })
    const metadata = await generateMetadata({ searchParams: Promise.resolve({ next: AUTHORIZE_NEXT }) })
    expect(metadata.title).toBe('Acme Sign In')
  })

  it('leaves the title unset when there is no next', async () => {
    const metadata = await generateMetadata({ searchParams: Promise.resolve({}) })
    expect(metadata.title).toBeUndefined()
    expect(mockFetchSocialProviders).not.toHaveBeenCalled()
  })

  it('leaves the title unset when next does not resolve to a named app', async () => {
    mockFetchSocialProviders.mockResolvedValue({ providers: [], logo: null, name: null, favicon: null })
    const metadata = await generateMetadata({ searchParams: Promise.resolve({ next: AUTHORIZE_NEXT }) })
    expect(metadata.title).toBeUndefined()
  })

  it('sets the tab icon when the resolved app has a favicon', async () => {
    mockFetchSocialProviders.mockResolvedValue({ providers: [], logo: null, name: 'Acme', favicon: 'data:image/png;base64,FFF=' })
    const metadata = await generateMetadata({ searchParams: Promise.resolve({ next: AUTHORIZE_NEXT }) })
    expect(metadata.icons).toEqual({ icon: 'data:image/png;base64,FFF=' })
  })

  it('leaves the icon unset when the resolved app has no favicon', async () => {
    mockFetchSocialProviders.mockResolvedValue({ providers: [], logo: null, name: 'Acme', favicon: null })
    const metadata = await generateMetadata({ searchParams: Promise.resolve({ next: AUTHORIZE_NEXT }) })
    expect(metadata.icons).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter admin test -- login/__tests__/page.test.tsx`
Expected: FAIL — `../page` has no exported member `generateMetadata`.

- [ ] **Step 3: Add `generateMetadata` to the login page**

Modify `apps/admin/app/login/page.tsx`:

Add the `Metadata` type import at the top:

```ts
import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getBetterAuthCookieName } from '@sassy-auth/types'
import { validateNextUrl } from '@/lib/safe-next'
import { fetchSocialProviders } from '@/lib/social-providers'
import { LoginForm } from './login-form'
```

Add the new export right after `export const dynamic = 'force-dynamic'` and before `async function hasActiveSession`:

```ts
export const dynamic = 'force-dynamic'

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}): Promise<Metadata> {
  const { next } = await searchParams
  const nextSafe = validateNextUrl(next)
  if (!nextSafe) return {}
  const { name: appName, favicon } = await fetchSocialProviders(nextSafe)
  return {
    ...(appName && { title: `${appName} Sign In` }),
    ...(favicon && { icons: { icon: favicon } }),
  }
}

async function hasActiveSession(): Promise<boolean> {
```

(Nothing else in the file changes — `LoginPage` itself, `hasActiveSession`, and the rest of the module are untouched.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter admin test -- login/__tests__/page.test.tsx`
Expected: PASS (5 tests)

- [ ] **Step 5: Run the full admin test suite**

Run: `pnpm --filter admin test`
Expected: PASS — confirms nothing else in the admin app broke across all 17 tasks.

- [ ] **Step 6: Run the full auth-server test suite**

Run: `pnpm --filter auth-server test`
Expected: PASS — confirms nothing else in the auth-server broke.

- [ ] **Step 7: Commit**

```bash
git add apps/admin/app/login/page.tsx apps/admin/app/login/__tests__/page.test.tsx
git commit -m "feat(admin): dynamic tab title and favicon on the login page"
```

---

## Post-plan verification

After all 17 tasks are complete:

- [ ] Run `pnpm --filter admin exec tsc --noEmit` — expect no errors.
- [ ] Run `pnpm --filter auth-server exec tsc --noEmit` — expect no errors (or only pre-existing, unrelated errors already present on `master`/`dev` before this plan started).
- [ ] Manually verify in a browser (dev server running, `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and a real app configured): upload a favicon on an app via the edit drawer, then visit `/signup?client_id=<that app>` and confirm the browser tab shows the app's name + "Sign Up" and the uploaded favicon; visit `/login?next=<an authorize URL for that app>` and confirm the tab shows the app's name + "Sign In" and the same favicon.
