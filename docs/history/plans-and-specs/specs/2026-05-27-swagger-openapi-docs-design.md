# Swagger / OpenAPI Documentation — Design

**Date:** 2026-05-27
**Status:** Draft (pending review)
**Scope:** `apps/auth-server` (NestJS 10 on Express)

## Goal

Serve a single Swagger UI page from the Nest auth-server that:

1. Auto-discovers every Nest controller, route, and DTO at runtime so docs stay in sync with code with zero per-endpoint manual annotation.
2. Documents the BetterAuth `/api/auth/*` routes (sign-in, sign-up, session, sign-out, …) alongside the Nest routes so the page is a complete API reference.
3. Lets a developer try every endpoint live, including authenticated ones, without leaving the page.
4. Doubles as living external API documentation in production.

## Non-goals (v1)

- Hand-tuned response examples, multi-version specs, programmatic spec export, custom theming. All deferred.
- A separate dev-only docs surface. The same page serves dev testing and production reference.

## Architecture

```
                  ┌─────────────────────────────────────────────┐
                  │  Express app (apps/auth-server/src/main.ts) │
                  └─────────────────────────────────────────────┘
                                  │
       ┌──────────────────────────┼──────────────────────────────┐
       │                          │                              │
 /api/auth/*                /api/docs  /api/docs-json       /api/{users,orgs,roles,…}
       │                          │                              │
       ▼                          ▼                              ▼
 toNodeHandler(auth)         Swagger UI                 Nest controllers
   ├─ open-api plugin          (served by               (BetterAuthGuard,
   │  enabled                  SwaggerModule)            class-validator DTOs)
   ▼
 GET /api/auth/open-api/
       generate-schema  ─── fetched once at bootstrap ──┐
                                                        │
                                                        ▼
                                              merged OpenAPI document
                                              (Nest spec ∪ BetterAuth spec)
                                                        │
                                                        ▼
                                              SwaggerModule.setup('docs', …)
```

**Bootstrap sequence in `main.ts`:**

1. Create Express + Nest as today.
2. Build the Nest OpenAPI doc via `SwaggerModule.createDocument(app, config)`.
3. Invoke `auth.api.generateOpenAPISchema()` (exposed by BetterAuth's open-api plugin — in-process, no HTTP round-trip).
4. Merge: combine `paths`, `components.schemas`, `components.securitySchemes`, and `tags` from both into one document.
5. `SwaggerModule.setup('api/docs', app, merged, { swaggerOptions: { withCredentials: true } })` — `withCredentials: true` is the critical bit for same-origin cookie reuse from Try-it-out.

## Authentication flow

The Nest server has no HTML UI of its own. The admin app lives on a different origin (`:3001` in dev) and cannot share cookies with `:3000` without explicit cookie-domain configuration. Therefore the Swagger page itself is the developer's login surface.

**Sign-in via the Swagger page (v1 default):**

1. User opens `http://localhost:3000/api/docs`.
2. Scrolls to the `Auth` tag, finds `POST /api/auth/sign-in/email`.
3. Clicks Try it out, pastes `{ "email": "...", "password": "..." }`, hits Execute.
4. Response: 200 with `Set-Cookie: better-auth.session_token=…` on `localhost:3000`.
5. Because `swaggerOptions.withCredentials = true`, the browser stored the cookie and now attaches it to every subsequent Try-it-out request.
6. User scrolls to `Users`, clicks Try-it-out on `GET /api/users`: cookie travels → `BetterAuthGuard` resolves the session → call succeeds.
7. `POST /api/auth/sign-out` clears the cookie; protected endpoints return 401 again.

This makes the page self-contained. No new auth surface, no token UI, no CORS gymnastics.

**Cross-origin admin-app flow (works but not promoted in v1):** in deployed environments where `admin` and `api` share a parent domain (`app.example.com` + `api.example.com`) and BetterAuth's cookie is scoped to `.example.com`, logging into admin also satisfies `/api/docs`. We will not document this in v1; the in-page sign-in is the canonical flow.

## Merge logic

A single small module — `apps/auth-server/src/docs/openapi.ts` — exports:

```ts
mergeOpenApiDocs(nestDoc: OpenAPIObject, betterAuthDoc: OpenAPIObject): OpenAPIObject
```

Rules:

- **`paths`:** shallow concat. Nest paths are already prefixed with `/api` (from `app.setGlobalPrefix('api')`). BetterAuth's plugin emits paths rooted at `/auth/*`; the merger prefixes them with `/api` before insertion.
- **`components.schemas`:** shallow merge. On name collision, the BetterAuth schema is suffixed with `_BetterAuth`. Collisions are not expected (Nest uses DTO class names like `CreateUserDto`).
- **`components.securitySchemes`:** union, normalized to one canonical `cookieAuth` entry. The Nest doc's scheme wins on conflict, since it's built from the single source of truth (`DocumentBuilder.addCookieAuth(...)` in `main.ts`).
- **`tags`:** union, sorted alphabetically. Nest controllers tagged via `@ApiTags('Users')` etc. BetterAuth routes inherit the `Auth` tag from the plugin.
- **`info`:** taken from the Nest doc (title, version, description).

## DTO and controller annotations

**Enable the Nest CLI plugin** in `apps/auth-server/nest-cli.json`:

```json
{
  "compilerOptions": {
    "plugins": [
      {
        "name": "@nestjs/swagger",
        "options": { "classValidatorShim": true, "introspectComments": true }
      }
    ]
  }
}
```

What this gives us with no per-field edits:

- TS types → `@ApiProperty()` (`email: string` → `{ type: 'string' }`).
- `class-validator` decorators → OpenAPI constraints (`@IsEmail()` → `format: email`, `@MinLength(8)` → `minLength: 8`, optional `?` → `required: false`).
- TSDoc `/** … */` on a field → OpenAPI `description` (optional, only where useful).

**Controller-level decorators** (one-time, small):

```ts
@ApiTags('Users')
@ApiCookieAuth('better-auth.session_token')
@UseGuards(BetterAuthGuard)
@Controller('users')
export class UsersController { /* unchanged */ }
```

Applied to: `UsersController`, `OrgsController`, `RolesController`, `InvitationsController`, `TokenController`.

**Not in v1:** per-method `@ApiOperation()` / `@ApiResponse()`. Defaults from method names and DTO types are sufficient. Richer response docs are deferred until external traffic justifies the polish.

## Bootstrap wiring

**`apps/auth-server/src/auth/auth.config.ts`** — enable the BetterAuth plugin:

```ts
import { openAPI } from 'better-auth/plugins/open-api';

export const auth = betterAuth({
  // …existing config…
  plugins: [
    // …existing plugins…
    openAPI({ disableDefaultReference: true }),
  ],
});
```

`disableDefaultReference: true` suppresses the standalone Scalar page at `/api/auth/reference` so we have one docs surface.

**`apps/auth-server/src/main.ts`** — additions after `app.useGlobalFilters(...)` and before `app.listen(...)`:

```ts
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { mergeOpenApiDocs } from './docs/openapi';
import pkg from '../package.json';

const config = new DocumentBuilder()
  .setTitle('Sassy Auth API')
  .setDescription('Multi-tenant auth and user management')
  .setVersion(pkg.version)
  .addCookieAuth('better-auth.session_token', { type: 'apiKey', in: 'cookie' })
  .build();

const nestDoc = SwaggerModule.createDocument(app, config);

let merged = nestDoc;
try {
  const betterAuthDoc = await auth.api.generateOpenAPISchema();
  merged = mergeOpenApiDocs(nestDoc, betterAuthDoc);
} catch (err) {
  loggerService.warn(
    `Failed to fetch BetterAuth OpenAPI schema; serving Nest-only spec. ${(err as Error).message}`,
    'Bootstrap',
  );
}

SwaggerModule.setup('api/docs', app, merged, {
  swaggerOptions: { withCredentials: true, persistAuthorization: true },
  jsonDocumentUrl: 'api/docs-json',
});
```

**No production gating.** The page is always available. The audience is both internal developers and external consumers.

**Failure mode:** if BetterAuth's schema fetch fails, we log a warning and serve the Nest-only spec rather than crashing boot. Keeps the server resilient to plugin/version churn.

## File inventory

**New:**
- `apps/auth-server/src/docs/openapi.ts` — `mergeOpenApiDocs` and helpers.
- `apps/auth-server/src/docs/openapi.spec.ts` — unit tests for merge.

**Modified:**
- `apps/auth-server/src/main.ts` — Swagger bootstrap block.
- `apps/auth-server/src/auth/auth.config.ts` — enable `openAPI` plugin.
- `apps/auth-server/nest-cli.json` — enable `@nestjs/swagger` CLI plugin.
- `apps/auth-server/package.json` — add `@nestjs/swagger` dependency.
- Five controllers (`users`, `orgs`, `roles`, `invitations`, `token`) — add `@ApiTags(...)` and `@ApiCookieAuth(...)`.

## Testing

**Unit tests (`apps/auth-server/src/docs/openapi.spec.ts`):**

- Merging preserves both producers' paths; Nest paths under `/api/*`, BetterAuth paths re-rooted under `/api/auth/*`.
- Schema-name collisions resolve with a `_BetterAuth` suffix.
- `securitySchemes` collisions: Nest's `cookieAuth` definition wins; BetterAuth's equivalent is dropped.
- `info` is taken from the Nest doc; `tags` are the union sorted alphabetically.
- BetterAuth doc missing or malformed: merger returns the Nest doc unchanged (defensive fallback complementing the bootstrap try/catch).

**Manual acceptance (golden path):**

1. `pnpm --filter @sassy-auth/auth-server dev` boots the server.
2. `http://localhost:3000/api/docs` renders Swagger UI with sections `Auth`, `Invitations`, `Orgs`, `Roles`, `Token`, `Users`.
3. `GET /api/docs-json` returns valid JSON parseable by `openapi-types`.
4. `GET /api/users` Try-it-out (no session) → 401.
5. `POST /api/auth/sign-in/email` Try-it-out with seeded credentials → 200, cookie visible in DevTools → Application → Cookies → `localhost:3000` → `better-auth.session_token`.
6. `GET /api/users` Try-it-out after step 5 → 200 with user list.
7. `POST /api/auth/sign-out` → cookie removed; `GET /api/users` Try-it-out → 401 again.

**Spec-correctness sanity:**

- `npx @redocly/cli lint http://localhost:3000/api/docs-json` reports zero errors (warnings allowed).
- `class-validator` constraints visible in UI (e.g., `CreateUserDto.email` shows `format: email`).

## Out of scope (v1)

- Rich `@ApiOperation` / `@ApiResponse` examples.
- Versioned spec (`/api/v1/docs`).
- Programmatic spec export to a file at build time.
- Theming / custom branding (stock Swagger UI is fine).

## Risks and open questions

- **Risk:** BetterAuth's spec emits a security scheme whose cookie name may not match the one declared in `main.ts`. *Mitigation:* the merge normalizes to one canonical `cookieAuth`, with the Nest-built scheme winning on conflict.
- **Risk:** A future BetterAuth upgrade changes `auth.api.generateOpenAPISchema()` shape or removes it. *Mitigation:* the bootstrap try/catch + unit test for malformed input keep the server up; the warning log makes the regression visible.
- **Open question (decision deferred):** should `/api/docs` and `/api/docs-json` be excluded from access logs and Sentry breadcrumbs? Default proposed: yes, via a one-line skip filter in the existing logger middleware. Confirm during implementation.
