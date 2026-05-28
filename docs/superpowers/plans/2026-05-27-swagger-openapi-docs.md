# Swagger / OpenAPI Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve a single unified Swagger UI at `http://<host>/api/docs` from the Nest auth-server, auto-discovering every Nest controller + DTO and merging in BetterAuth's `/api/auth/*` routes, with same-origin cookie auth so developers can sign in and Try-it-out every endpoint live.

**Architecture:** Enable the `@nestjs/swagger` CLI plugin to infer schemas from existing `class-validator` DTOs (zero per-field annotation). At bootstrap, build the Nest OpenAPI doc, invoke BetterAuth's `open-api` plugin to retrieve its OpenAPI document in-process, then merge both into one document served at `/api/docs`. Same-origin cookie reuse means signing in via the BetterAuth endpoints in Swagger UI sets the session cookie used by subsequent Try-it-out calls.

**Tech Stack:** NestJS 10 (Express adapter), `@nestjs/swagger` ^7.4 + CLI plugin, `better-auth/plugins` (open-api plugin), Jest + ts-jest, pnpm workspaces.

**Reference spec:** `docs/superpowers/specs/2026-05-27-swagger-openapi-docs-design.md`

---

## File Structure

**New files:**
- `apps/auth-server/src/docs/openapi.ts` — `mergeOpenApiDocs(nestDoc, betterAuthDoc)` and small helpers. Pure function; no Nest module wiring.
- `apps/auth-server/src/docs/openapi.spec.ts` — Jest unit tests for the merge.

**Modified files:**
- `apps/auth-server/nest-cli.json` — enable `@nestjs/swagger` CLI plugin.
- `apps/auth-server/package.json` — add `@nestjs/swagger` dependency.
- `apps/auth-server/src/auth/auth.config.ts` — enable `openAPI()` BetterAuth plugin.
- `apps/auth-server/src/main.ts` — Swagger bootstrap block.
- `apps/auth-server/src/users/users.controller.ts` — `@ApiTags('Users')` + `@ApiCookieAuth('better-auth.session_token')`.
- `apps/auth-server/src/orgs/orgs.controller.ts` — `@ApiTags('Orgs')` + `@ApiCookieAuth(...)`.
- `apps/auth-server/src/roles/roles.controller.ts` — `@ApiTags('Roles')` + `@ApiCookieAuth(...)`.
- `apps/auth-server/src/invitations/invitations.controller.ts` — `@ApiTags('Invitations')` only (no auth — endpoints are token-based and unauthenticated).
- `apps/auth-server/src/token/token.controller.ts` — `@ApiTags('Token')` only (no auth — most endpoints take tokens or session via different mechanisms).

---

## Task 1: Add `@nestjs/swagger` dependency and enable the CLI plugin

**Files:**
- Modify: `apps/auth-server/package.json`
- Modify: `apps/auth-server/nest-cli.json`

- [ ] **Step 1: Add `@nestjs/swagger` to dependencies**

Edit `apps/auth-server/package.json`. In the `"dependencies"` block, add the line below alphabetically (between `@nestjs/platform-express` and `@sassy-auth/db`):

```json
    "@nestjs/swagger": "^7.4.0",
```

The resulting fragment should be:

```json
    "@nestjs/platform-express": "^10.3.0",
    "@nestjs/swagger": "^7.4.0",
    "@sassy-auth/db": "workspace:*",
```

- [ ] **Step 2: Install the dependency**

Run from the repo root:

```
pnpm --filter @sassy-auth/auth-server install
```

Expected: pnpm resolves `@nestjs/swagger@^7.4.0` (or the latest 7.x) and updates `pnpm-lock.yaml`. No errors.

- [ ] **Step 3: Enable the CLI plugin in `nest-cli.json`**

Replace the entire contents of `apps/auth-server/nest-cli.json` with:

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": {
    "deleteOutDir": true,
    "plugins": [
      {
        "name": "@nestjs/swagger",
        "options": {
          "classValidatorShim": true,
          "introspectComments": true,
          "dtoFileNameSuffix": [".dto.ts"]
        }
      }
    ]
  }
}
```

The plugin reads TS types + `class-validator` decorators on files ending in `.dto.ts` and synthesizes `@ApiProperty()` metadata at compile time.

- [ ] **Step 4: Verify the build still passes**

Run from the repo root:

```
pnpm --filter @sassy-auth/auth-server build
```

Expected: build completes with no errors. `dist/` is rebuilt. The plugin runs silently.

- [ ] **Step 5: Commit**

```
git add apps/auth-server/package.json apps/auth-server/nest-cli.json pnpm-lock.yaml
git commit -m "feat(auth-server): add @nestjs/swagger + enable CLI plugin"
```

---

## Task 2: Enable BetterAuth `openAPI` plugin

**Files:**
- Modify: `apps/auth-server/src/auth/auth.config.ts`

- [ ] **Step 1: Import the plugin**

Open `apps/auth-server/src/auth/auth.config.ts`. The existing `magicLink` and `emailOTP` already come from `'better-auth/plugins'`; add `openAPI` to that same import list (better-auth's package exports do not expose `'better-auth/plugins/open-api'` as a public subpath in v1.6 — the symbol lives on the `'better-auth/plugins'` barrel):

```ts
import { magicLink, emailOTP, openAPI } from 'better-auth/plugins';
```

- [ ] **Step 2: Add `openAPI` to the plugins array**

In the same file, the existing `plugins` array contains `magicLink({...})` and `emailOTP({...})`. After the `emailOTP({...})` closing `})`, append a comma and add:

```ts
    openAPI({ disableDefaultReference: true }),
```

The resulting plugins array should look like:

```ts
  plugins: [
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        // Wire to your email service in production.
        // In development, log the link to the console.
        console.log(`[magic-link] ${email} → ${url}`);
      },
    }),
    emailOTP({
      sendVerificationOTP: async ({ email, otp }: { email: string; otp: string }) => {
        console.log(`[email-otp] ${email} → ${otp}`);
      },
    }),
    openAPI({ disableDefaultReference: true }),
  ],
```

`disableDefaultReference: true` suppresses BetterAuth's standalone Scalar reference page at `/api/auth/reference` so we have a single docs surface.

- [ ] **Step 3: Verify it compiles**

Run:

```
pnpm --filter @sassy-auth/auth-server build
```

Expected: build succeeds with no errors. (Note `auth` is typed `any` in this file, so the plugin's return type is consumed without type friction.)

- [ ] **Step 4: Smoke-test the plugin route**

Start the server in one terminal:

```
pnpm --filter @sassy-auth/auth-server dev
```

In another terminal, hit the plugin's schema endpoint:

```
curl -s http://localhost:3000/api/auth/open-api/generate-schema | head -c 200
```

Expected: a JSON document beginning with something like `{"openapi":"3.1.0","info":{...`. Stop the server (Ctrl+C in the first terminal).

- [ ] **Step 5: Commit**

```
git add apps/auth-server/src/auth/auth.config.ts
git commit -m "feat(auth-server): enable better-auth open-api plugin"
```

---

## Task 3: Implement `mergeOpenApiDocs` with tests (TDD)

**Files:**
- Create: `apps/auth-server/src/docs/openapi.spec.ts`
- Create: `apps/auth-server/src/docs/openapi.ts`

This task uses strict TDD: write each test, run it red, write the code to make it green, commit. The merge function takes the Nest OpenAPI doc and the BetterAuth OpenAPI doc and returns a single merged doc.

- [ ] **Step 1: Write the failing test for path merging and prefixing**

Create `apps/auth-server/src/docs/openapi.spec.ts`:

```ts
import { mergeOpenApiDocs } from './openapi';

const baseNest = {
  openapi: '3.0.0',
  info: { title: 'Sassy Auth API', version: '0.0.1', description: 'API' },
  paths: {
    '/api/users': { get: { tags: ['Users'], responses: { '200': { description: 'OK' } } } },
  },
  components: { schemas: {}, securitySchemes: {} },
  tags: [{ name: 'Users' }],
};

const baseBetterAuth = {
  openapi: '3.1.0',
  info: { title: 'Better Auth', version: '1.0.0', description: 'BA' },
  paths: {
    '/sign-in/email': { post: { responses: { '200': { description: 'OK' } } } },
    '/sign-out': { post: { responses: { '200': { description: 'OK' } } } },
  },
  components: { schemas: {}, securitySchemes: {} },
  tags: [],
};

describe('mergeOpenApiDocs', () => {
  it('prefixes better-auth paths with /api/auth and merges them with nest paths', () => {
    const merged = mergeOpenApiDocs(baseNest as any, baseBetterAuth as any);

    expect(Object.keys(merged.paths).sort()).toEqual([
      '/api/auth/sign-in/email',
      '/api/auth/sign-out',
      '/api/users',
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```
pnpm --filter @sassy-auth/auth-server test -- --testPathPattern docs/openapi.spec
```

Expected: FAIL. Error mentions `Cannot find module './openapi'` or similar — the file doesn't exist yet.

- [ ] **Step 3: Create the minimal implementation to pass Step 1's test**

Create `apps/auth-server/src/docs/openapi.ts`:

```ts
import { OpenAPIObject } from '@nestjs/swagger';

const BETTER_AUTH_PATH_PREFIX = '/api/auth';

export function mergeOpenApiDocs(
  nestDoc: OpenAPIObject,
  betterAuthDoc: OpenAPIObject,
): OpenAPIObject {
  const mergedPaths: Record<string, unknown> = { ...(nestDoc.paths ?? {}) };

  for (const [path, item] of Object.entries(betterAuthDoc.paths ?? {})) {
    const prefixed = `${BETTER_AUTH_PATH_PREFIX}${path}`;
    mergedPaths[prefixed] = item;
  }

  return {
    ...nestDoc,
    paths: mergedPaths,
  } as OpenAPIObject;
}
```

- [ ] **Step 4: Run the test — verify green**

Run the same command:

```
pnpm --filter @sassy-auth/auth-server test -- --testPathPattern docs/openapi.spec
```

Expected: PASS.

- [ ] **Step 5: Add the failing test for schema merging and collision suffix**

Append to `apps/auth-server/src/docs/openapi.spec.ts` (inside the same `describe` block):

```ts
  it('merges component schemas and suffixes BetterAuth schemas on name collision', () => {
    const nest = {
      ...baseNest,
      components: {
        schemas: {
          CreateUserDto: { type: 'object', properties: { email: { type: 'string' } } },
          SessionUser: { type: 'object', properties: { id: { type: 'string' } } },
        },
        securitySchemes: {},
      },
    };
    const ba = {
      ...baseBetterAuth,
      components: {
        schemas: {
          AuthSession: { type: 'object' },
          SessionUser: { type: 'object', properties: { email: { type: 'string' } } },
        },
        securitySchemes: {},
      },
    };

    const merged = mergeOpenApiDocs(nest as any, ba as any);
    const schemas = merged.components!.schemas!;

    expect(schemas).toHaveProperty('CreateUserDto');
    expect(schemas).toHaveProperty('AuthSession');
    expect(schemas).toHaveProperty('SessionUser');
    expect(schemas).toHaveProperty('SessionUser_BetterAuth');
  });
```

- [ ] **Step 6: Run — verify it fails**

```
pnpm --filter @sassy-auth/auth-server test -- --testPathPattern docs/openapi.spec
```

Expected: FAIL — `SessionUser_BetterAuth` not present.

- [ ] **Step 7: Extend `mergeOpenApiDocs` to merge schemas with collision suffix**

Edit `apps/auth-server/src/docs/openapi.ts`. Replace the entire file with:

```ts
import { OpenAPIObject } from '@nestjs/swagger';

const BETTER_AUTH_PATH_PREFIX = '/api/auth';

export function mergeOpenApiDocs(
  nestDoc: OpenAPIObject,
  betterAuthDoc: OpenAPIObject,
): OpenAPIObject {
  const mergedPaths: Record<string, unknown> = { ...(nestDoc.paths ?? {}) };
  for (const [path, item] of Object.entries(betterAuthDoc.paths ?? {})) {
    mergedPaths[`${BETTER_AUTH_PATH_PREFIX}${path}`] = item;
  }

  const nestSchemas = nestDoc.components?.schemas ?? {};
  const baSchemas = betterAuthDoc.components?.schemas ?? {};
  const mergedSchemas: Record<string, unknown> = { ...nestSchemas };
  for (const [name, schema] of Object.entries(baSchemas)) {
    const key = name in nestSchemas ? `${name}_BetterAuth` : name;
    mergedSchemas[key] = schema;
  }

  return {
    ...nestDoc,
    paths: mergedPaths,
    components: {
      ...nestDoc.components,
      schemas: mergedSchemas,
    },
  } as OpenAPIObject;
}
```

- [ ] **Step 8: Run — verify both tests pass**

```
pnpm --filter @sassy-auth/auth-server test -- --testPathPattern docs/openapi.spec
```

Expected: PASS (2 tests).

- [ ] **Step 9: Add the failing test for security-scheme normalization**

Append inside the same `describe` block:

```ts
  it('keeps the nest cookieAuth scheme and drops the BetterAuth equivalent on conflict', () => {
    const nest = {
      ...baseNest,
      components: {
        schemas: {},
        securitySchemes: {
          cookieAuth: {
            type: 'apiKey',
            in: 'cookie',
            name: 'better-auth.session_token',
          },
        },
      },
    };
    const ba = {
      ...baseBetterAuth,
      components: {
        schemas: {},
        securitySchemes: {
          cookieAuth: {
            type: 'apiKey',
            in: 'cookie',
            name: 'some-other-name',
          },
          apiKeyCookie: { type: 'apiKey', in: 'cookie', name: 'x' },
        },
      },
    };

    const merged = mergeOpenApiDocs(nest as any, ba as any);
    const schemes = merged.components!.securitySchemes!;

    expect((schemes['cookieAuth'] as any).name).toBe('better-auth.session_token');
    expect(schemes).toHaveProperty('apiKeyCookie');
  });
```

- [ ] **Step 10: Run — verify it fails**

```
pnpm --filter @sassy-auth/auth-server test -- --testPathPattern docs/openapi.spec
```

Expected: FAIL — security schemes not merged yet.

- [ ] **Step 11: Extend `mergeOpenApiDocs` to merge security schemes (nest wins on conflict)**

Replace the entire contents of `apps/auth-server/src/docs/openapi.ts` with:

```ts
import { OpenAPIObject } from '@nestjs/swagger';

const BETTER_AUTH_PATH_PREFIX = '/api/auth';

export function mergeOpenApiDocs(
  nestDoc: OpenAPIObject,
  betterAuthDoc: OpenAPIObject,
): OpenAPIObject {
  const mergedPaths: Record<string, unknown> = { ...(nestDoc.paths ?? {}) };
  for (const [path, item] of Object.entries(betterAuthDoc.paths ?? {})) {
    mergedPaths[`${BETTER_AUTH_PATH_PREFIX}${path}`] = item;
  }

  const nestSchemas = nestDoc.components?.schemas ?? {};
  const baSchemas = betterAuthDoc.components?.schemas ?? {};
  const mergedSchemas: Record<string, unknown> = { ...nestSchemas };
  for (const [name, schema] of Object.entries(baSchemas)) {
    const key = name in nestSchemas ? `${name}_BetterAuth` : name;
    mergedSchemas[key] = schema;
  }

  const nestSecurity = nestDoc.components?.securitySchemes ?? {};
  const baSecurity = betterAuthDoc.components?.securitySchemes ?? {};
  const mergedSecurity: Record<string, unknown> = { ...nestSecurity };
  for (const [name, scheme] of Object.entries(baSecurity)) {
    if (!(name in nestSecurity)) {
      mergedSecurity[name] = scheme;
    }
  }

  return {
    ...nestDoc,
    paths: mergedPaths,
    components: {
      ...nestDoc.components,
      schemas: mergedSchemas,
      securitySchemes: mergedSecurity,
    },
  } as OpenAPIObject;
}
```

- [ ] **Step 12: Run — verify green**

```
pnpm --filter @sassy-auth/auth-server test -- --testPathPattern docs/openapi.spec
```

Expected: PASS (3 tests).

- [ ] **Step 13: Add the failing test for tag union and info preservation**

Append inside the same `describe`:

```ts
  it('preserves nest info and produces a sorted union of tags', () => {
    const nest = {
      ...baseNest,
      tags: [{ name: 'Users' }, { name: 'Orgs' }],
    };
    const ba = {
      ...baseBetterAuth,
      tags: [{ name: 'Auth' }, { name: 'Users' }], // intentional duplicate
    };

    const merged = mergeOpenApiDocs(nest as any, ba as any);

    expect(merged.info.title).toBe('Sassy Auth API');
    expect((merged.tags ?? []).map((t) => t.name)).toEqual(['Auth', 'Orgs', 'Users']);
  });
```

- [ ] **Step 14: Run — verify it fails**

```
pnpm --filter @sassy-auth/auth-server test -- --testPathPattern docs/openapi.spec
```

Expected: FAIL — tags not unioned, duplicates not removed.

- [ ] **Step 15: Extend `mergeOpenApiDocs` to union and sort tags**

Replace the entire contents of `apps/auth-server/src/docs/openapi.ts` with:

```ts
import { OpenAPIObject } from '@nestjs/swagger';

const BETTER_AUTH_PATH_PREFIX = '/api/auth';

export function mergeOpenApiDocs(
  nestDoc: OpenAPIObject,
  betterAuthDoc: OpenAPIObject,
): OpenAPIObject {
  const mergedPaths: Record<string, unknown> = { ...(nestDoc.paths ?? {}) };
  for (const [path, item] of Object.entries(betterAuthDoc.paths ?? {})) {
    mergedPaths[`${BETTER_AUTH_PATH_PREFIX}${path}`] = item;
  }

  const nestSchemas = nestDoc.components?.schemas ?? {};
  const baSchemas = betterAuthDoc.components?.schemas ?? {};
  const mergedSchemas: Record<string, unknown> = { ...nestSchemas };
  for (const [name, schema] of Object.entries(baSchemas)) {
    const key = name in nestSchemas ? `${name}_BetterAuth` : name;
    mergedSchemas[key] = schema;
  }

  const nestSecurity = nestDoc.components?.securitySchemes ?? {};
  const baSecurity = betterAuthDoc.components?.securitySchemes ?? {};
  const mergedSecurity: Record<string, unknown> = { ...nestSecurity };
  for (const [name, scheme] of Object.entries(baSecurity)) {
    if (!(name in nestSecurity)) {
      mergedSecurity[name] = scheme;
    }
  }

  const tagMap = new Map<string, { name: string; description?: string }>();
  for (const t of nestDoc.tags ?? []) tagMap.set(t.name, t);
  for (const t of betterAuthDoc.tags ?? []) if (!tagMap.has(t.name)) tagMap.set(t.name, t);
  const mergedTags = [...tagMap.values()].sort((a, b) => a.name.localeCompare(b.name));

  return {
    ...nestDoc,
    paths: mergedPaths,
    components: {
      ...nestDoc.components,
      schemas: mergedSchemas,
      securitySchemes: mergedSecurity,
    },
    tags: mergedTags,
  } as OpenAPIObject;
}
```

- [ ] **Step 16: Run — verify green**

```
pnpm --filter @sassy-auth/auth-server test -- --testPathPattern docs/openapi.spec
```

Expected: PASS (4 tests).

- [ ] **Step 17: Add the failing test for defensive fallback (missing/malformed BetterAuth doc)**

Append inside the same `describe`:

```ts
  it('returns the nest doc with no BetterAuth additions when the BetterAuth doc is empty', () => {
    const merged = mergeOpenApiDocs(baseNest as any, {} as any);

    expect(Object.keys(merged.paths)).toEqual(['/api/users']);
    expect(merged.info.title).toBe('Sassy Auth API');
  });
```

- [ ] **Step 18: Run — verify it passes already**

```
pnpm --filter @sassy-auth/auth-server test -- --testPathPattern docs/openapi.spec
```

Expected: PASS (5 tests). The implementation's `?? {}` and `?? []` fallbacks already cover this case. (If it fails for an unexpected reason, fix until green before moving on.)

- [ ] **Step 19: Run the full auth-server test suite to confirm nothing else broke**

```
pnpm --filter @sassy-auth/auth-server test
```

Expected: all tests pass.

- [ ] **Step 20: Commit**

```
git add apps/auth-server/src/docs/openapi.ts apps/auth-server/src/docs/openapi.spec.ts
git commit -m "feat(auth-server): mergeOpenApiDocs for nest+better-auth merge"
```

---

## Task 4: Annotate controllers with `@ApiTags` and `@ApiCookieAuth`

Five small edits — one per controller. Cookie-auth is added only to controllers actually protected by `BetterAuthGuard`.

**Files:**
- Modify: `apps/auth-server/src/users/users.controller.ts`
- Modify: `apps/auth-server/src/orgs/orgs.controller.ts`
- Modify: `apps/auth-server/src/roles/roles.controller.ts`
- Modify: `apps/auth-server/src/invitations/invitations.controller.ts`
- Modify: `apps/auth-server/src/token/token.controller.ts`

- [ ] **Step 1: Annotate `UsersController`**

Open `apps/auth-server/src/users/users.controller.ts`.

Replace the existing first import line:

```ts
import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query, HttpCode, UseGuards, Req,
} from '@nestjs/common';
```

with the same plus a new import:

```ts
import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query, HttpCode, UseGuards, Req,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
```

Then, replace the decorator block:

```ts
@UseGuards(BetterAuthGuard)
@Controller('users')
```

with:

```ts
@ApiTags('Users')
@ApiCookieAuth('better-auth.session_token')
@UseGuards(BetterAuthGuard)
@Controller('users')
```

- [ ] **Step 2: Annotate `OrgsController`**

Open `apps/auth-server/src/orgs/orgs.controller.ts`. After the existing imports, add:

```ts
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
```

Replace:

```ts
@UseGuards(BetterAuthGuard)
@Controller('orgs')
```

with:

```ts
@ApiTags('Orgs')
@ApiCookieAuth('better-auth.session_token')
@UseGuards(BetterAuthGuard)
@Controller('orgs')
```

- [ ] **Step 3: Annotate `RolesController`**

Open `apps/auth-server/src/roles/roles.controller.ts`. After the existing imports, add:

```ts
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
```

Replace:

```ts
@UseGuards(BetterAuthGuard)
@Controller('roles')
```

with:

```ts
@ApiTags('Roles')
@ApiCookieAuth('better-auth.session_token')
@UseGuards(BetterAuthGuard)
@Controller('roles')
```

- [ ] **Step 4: Annotate `InvitationsController` (tag only — public token-based endpoints)**

Open `apps/auth-server/src/invitations/invitations.controller.ts`. After the existing imports, add:

```ts
import { ApiTags } from '@nestjs/swagger';
```

Add `@ApiTags('Invitations')` immediately above `@Controller('invitations')`:

```ts
@ApiTags('Invitations')
@Controller('invitations')
```

No `@ApiCookieAuth` — these endpoints take a path-param token and don't use a session.

- [ ] **Step 5: Annotate `TokenController` (tag only — non-session auth flows)**

Open `apps/auth-server/src/token/token.controller.ts`. After the existing imports, add:

```ts
import { ApiTags } from '@nestjs/swagger';
```

Add `@ApiTags('Token')` immediately above `@Controller('token')`:

```ts
@ApiTags('Token')
@Controller('token')
```

No `@ApiCookieAuth` — `oauthAuthorize` reads the session via `auth.api.getSession()` directly (not the guard), `oauthToken` and `directLogin` use bodies.

- [ ] **Step 6: Verify the build still passes**

```
pnpm --filter @sassy-auth/auth-server build
```

Expected: clean build.

- [ ] **Step 7: Run the test suite to ensure nothing regressed**

```
pnpm --filter @sassy-auth/auth-server test
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```
git add apps/auth-server/src/users/users.controller.ts \
  apps/auth-server/src/orgs/orgs.controller.ts \
  apps/auth-server/src/roles/roles.controller.ts \
  apps/auth-server/src/invitations/invitations.controller.ts \
  apps/auth-server/src/token/token.controller.ts
git commit -m "feat(auth-server): tag controllers and declare cookie auth"
```

---

## Task 5: Wire Swagger into the bootstrap

**Files:**
- Modify: `apps/auth-server/src/main.ts`

- [ ] **Step 1: Add Swagger + merge imports**

Open `apps/auth-server/src/main.ts`. After the line `import { LoggerService } from './common/logger/logger.service';`, add:

```ts
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { mergeOpenApiDocs } from './docs/openapi';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg = require('../package.json');
```

(We use `require` for `package.json` to avoid touching `tsconfig.json` for `resolveJsonModule`. It's a one-line read at startup.)

- [ ] **Step 2: Insert the Swagger setup block in `bootstrap()`**

Locate this section inside `bootstrap()`:

```ts
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new SentryExceptionFilter(loggerService));

  await app.listen(process.env.PORT ?? 3000);
```

Replace it with:

```ts
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new SentryExceptionFilter(loggerService));

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Sassy Auth API')
    .setDescription('Multi-tenant auth and user management')
    .setVersion(pkg.version)
    .addCookieAuth('better-auth.session_token', { type: 'apiKey', in: 'cookie' })
    .build();

  const nestDoc = SwaggerModule.createDocument(app, swaggerConfig);

  let mergedDoc = nestDoc;
  try {
    const betterAuthDoc = await auth.api.generateOpenAPISchema();
    mergedDoc = mergeOpenApiDocs(nestDoc, betterAuthDoc);
  } catch (err) {
    loggerService.warn(
      `Failed to fetch BetterAuth OpenAPI schema; serving Nest-only spec. ${(err as Error).message}`,
      'Bootstrap',
    );
  }

  SwaggerModule.setup('api/docs', app, mergedDoc, {
    swaggerOptions: { withCredentials: true, persistAuthorization: true },
    jsonDocumentUrl: 'api/docs-json',
  });

  await app.listen(process.env.PORT ?? 3000);
```

Key points:
- `withCredentials: true` makes Swagger UI's Try-it-out send cookies on same-origin requests.
- `persistAuthorization: true` keeps any UI-side auth state across page reloads.
- The `try/catch` keeps boot resilient if the BetterAuth plugin shape changes in a future upgrade.

- [ ] **Step 3: Verify the build passes**

```
pnpm --filter @sassy-auth/auth-server build
```

Expected: clean build.

- [ ] **Step 4: Run the test suite**

```
pnpm --filter @sassy-auth/auth-server test
```

Expected: all tests pass. (`main.ts` is not directly unit-tested; the merge function is. The bootstrap change just composes them.)

- [ ] **Step 5: Commit**

```
git add apps/auth-server/src/main.ts
git commit -m "feat(auth-server): serve unified Swagger UI at /api/docs"
```

---

## Task 6: Manual acceptance smoke test

This task isn't code — it's a checklist that exercises the golden path before declaring v1 done. If any step fails, stop and diagnose before continuing.

**Prerequisites:** A seeded user account capable of signing in via email/password. (The repo already has `pnpm seed` for `apps/auth-server`; ensure it has been run against a database the server points at.)

- [ ] **Step 1: Start the server in dev mode**

```
pnpm --filter @sassy-auth/auth-server dev
```

Expected: log line "Auth server listening on port 3000" (or whatever `PORT` is set to). No warnings about failing to fetch the BetterAuth schema.

- [ ] **Step 2: Open the docs UI**

Visit `http://localhost:3000/api/docs` in a browser.

Expected: Swagger UI renders. Section headers (sorted alphabetically): **Auth**, **Invitations**, **Orgs**, **Roles**, **Token**, **Users**. Each section expands to show its endpoints. The Authorize button is visible in the top right, listing `cookieAuth (apiKey in cookie)`.

- [ ] **Step 3: Confirm the raw spec is valid JSON**

```
curl -s http://localhost:3000/api/docs-json | head -c 200
```

Expected: a JSON document starting with `{"openapi":"3.0.0",` (or 3.1.x) followed by `"info":{...`. No HTML.

- [ ] **Step 4: Confirm class-validator constraints flow into the UI**

In the browser, expand the `Users` section, click `POST /api/users`, look at the Request body schema for `CreateUserDto`. Confirm:
- `firstName`, `lastName`, `email`, `orgId` are marked required.
- `username`, `phoneNumber` are optional.
- `email` shows `format: email`.

- [ ] **Step 5: Unauthenticated call returns 401**

In Swagger UI, expand `Users → GET /api/users`, click "Try it out", then "Execute" with no parameters.

Expected: response status `401`. (We have no cookie yet.)

- [ ] **Step 6: Sign in via Swagger UI**

Scroll to `Auth → POST /api/auth/sign-in/email`. Click "Try it out". In the request body, paste valid credentials, e.g.:

```json
{ "email": "admin@example.com", "password": "your-seeded-password" }
```

Click "Execute". Expected: status `200`, response body shows a session/user object. Open browser DevTools → Application → Cookies → `http://localhost:3000`. Confirm a cookie named `better-auth.session_token` (or similar — the actual name depends on BetterAuth's config) is present.

- [ ] **Step 7: Authenticated call returns 200**

Scroll back to `Users → GET /api/users`, click "Try it out", then "Execute".

Expected: status `200`. Response body is a JSON array of users.

- [ ] **Step 8: Sign out clears the cookie**

Scroll to `Auth → POST /api/auth/sign-out`. Try it out, Execute.

Expected: status `200`. In DevTools the `better-auth.session_token` cookie is gone (or expired). Re-running step 5 (`GET /api/users`) returns `401`.

- [ ] **Step 9: Stop the server and commit a small CHANGELOG / no-op note (optional)**

If a `CHANGELOG.md` exists at the repo root, add a one-line entry under an "Unreleased" / dated section:

```
- Serve a unified Swagger/OpenAPI page at /api/docs covering Nest + BetterAuth routes.
```

If no `CHANGELOG.md` exists, skip this step — no commit required.

If you added a changelog entry:

```
git add CHANGELOG.md
git commit -m "docs: changelog entry for /api/docs"
```

---

## Self-Review Summary

Coverage check against the spec sections:

- **Architecture diagram → Tasks 2 + 5** (BetterAuth plugin enabled + bootstrap merge).
- **Auth flow (sign-in via Swagger) → Task 5** (`withCredentials: true`) + **Task 6** acceptance steps 6–8.
- **Merge rules (paths, schemas, securitySchemes, tags, info) → Task 3** (5 unit tests).
- **DTO + controller annotations + CLI plugin → Tasks 1 + 4**.
- **Bootstrap wiring + failure mode → Task 5** (try/catch + warning log).
- **No production gating → Task 5** (no `NODE_ENV` guard around `SwaggerModule.setup`).
- **File inventory → tasks reference exact files listed in the spec**.
- **Testing (unit + manual acceptance) → Tasks 3 + 6**.

Open question deferred during brainstorming (access-log / Sentry exclusion of `/api/docs`) is intentionally out of scope here; revisit once log volume is observed.
