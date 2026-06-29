# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased] — 2026-06-18

- Apps: optional per-app `callbackUrl`. When set, the PKCE `redirect_uri` must
  match it exactly (trailing-slash tolerant); when blank, any callback under the
  app's URL origin is accepted (unchanged behavior).
- Apps: app and callback URLs now require https + a public host by default.
  Set `SASSY_AUTH_ALLOW_INSECURE_APP_URLS=true` to permit http/localhost URLs in
  development.

### Changed (palette/table-action-tooltips branch — PR #107, not merged)

4 commits by `google-labs-jules[bot]` on 2026-06-17 standardizing table row actions across the admin console:

- **Tooltip wrappers on all table "more actions" buttons** — `apps-table.tsx`, `orgs-table.tsx`, `permissions-table.tsx`, `roles-table.tsx`, `users-table.tsx` now wrap the `DropdownMenuTrigger` in a `<Tooltip>` with localized content via `t('common.moreActions')`.
- **Localized aria-labels** — hardcoded `aria-label="more actions"` replaced with `t('common.moreActions')` across all five tables. The users-table button previously had no `aria-label` at all.
- **`TooltipProvider` in root layout** — `apps/admin/app/layout.tsx` now wraps children in `<TooltipProvider>` inside `<NextIntlClientProvider>`.
- **New i18n keys** — `common.moreActions` added to `en.json` ("More actions") and `fr.json` ("Plus d'actions"). French translations for `common.save`, `common.edit`, `common.delete`, `common.confirm` fixed (were untranslated English).
- **Test infrastructure** — Global tooltip mocks added to `jest.setup.ts`; per-file mocks updated in all five table test files.
- **CI: build workspace packages** — `e2e.yml` now runs `pnpm exec turbo build --filter=!@sassy-auth/auth-server` before Prisma generate, ensuring `@sassy-auth/db` dist is available. Auth-server excluded due to pre-existing build errors.
- **Auth-server seed script** — `--transpile-only` flag added to `ts-node` in the seed script for faster execution (skips type checking).
- **Jules palette doc** — `.Jules/palette.md` added, documenting the tooltip/aria-label pattern and CI build dependency learning.

### Bugs found

See [TODO_2026-06-18.md](./todo/TODO_2026-06-18.md) and [BUGS_2026-06-18.md](./bugs/BUGS_2026-06-18.md).

#### Warning

- **bug-0090** — Jules bot created 6+ duplicate/overlapping PRs (#100–#109) for the same tooltip/loading-state task; only one should be merged.
- **bug-0091** — Auth-server `seed` script `--transpile-only` change bundled into a UI tooltip PR (#107); scope creep risks merge conflicts and masks seed type errors.
- **bug-0092** — CI `e2e.yml` excludes auth-server from `turbo build` due to "known pre-existing errors" — build failures are masked, not fixed.

#### Minor

- **bug-0093** — Global `jest.mock('@sassy-auth/ui')` in `jest.setup.ts` is fragile; file-level mocks in 5 test files completely override it, forcing every new test file to manually duplicate tooltip component mocks.

### Project health note

93 open PRs, 0 merged. All bug-fix branches (bug-0001 through bug-0089) remain empty — no implementation work has started. 5 critical bugs: RBAC isolation (bug-0001), JWT breaking change (bug-0038), in-memory OAuth codes (bug-0039), redirect_uri validation bypass (bug-0054), and inactive user auth bypass (bug-0074). Jules bot contributing duplicate PRs (#100–#109) adds to the backlog without fixing existing issues. Day 22 with zero fixes merged. Total open bugs: 93.

---

## [Unreleased] — 2026-06-07

No new code commits. Deep scan across auth-server token issuance, role/permission services, user service, admin UI components, Prisma schema constraints, and shared packages surfaced **16 new bugs** (1 critical, 9 warning, 6 minor).

### Bugs found

See [TODO_2026-06-07.md](./todo/TODO_2026-06-07.md) and [BUGS_2026-06-07.md](./bugs/BUGS_2026-06-07.md).

#### Critical

- **bug-0074** — Inactive/pending users can obtain JWTs via both OAuth and direct login. Neither flow checks `saUser.status` before issuing a token; setting a user to `inactive` has no effect on authentication.

#### Warning

- **bug-0075** — `listUsers` accepts `appPublicId` filter parameter but silently ignores it; callers get unfiltered results.
- **bug-0076** — `listRoles`/`getRole`/`listPermissions`/`getPermission` missing `targetOrgId` in checkPermission; org admins can list all roles/permissions cross-tenant.
- **bug-0077** — `assignRole`/`removeRole` (POST/DELETE) skip app-scoping validation, unlike the bulk `setUserRoles` (PUT) which validates via `resolveRoleIdsForApp`.
- **bug-0078** — `SaRole` lacks `@@unique([appId, name])` constraint; duplicate role names per app possible via concurrent requests.
- **bug-0079** — `SaPermission.name` globally unique instead of per-app `@@unique([appId, name])`; prevents same permission name across different apps.
- **bug-0080** — No rate limiting on `/api/token/direct/login` or `/api/invitations/:token`; brute-force attacks unthrottled.
- **bug-0081** — `UpdateUserDto` string fields lack `@MinLength`/`@MaxLength` constraints; empty strings and megabyte payloads accepted.
- **bug-0082** — `OauthTokenExchangeDto.client_secret` required by validation but never verified by controller; false sense of security.
- **bug-0083** — PrismaClient singleton has no reconnection strategy; DB connection drop causes sustained outage until process restart.

#### Minor

- **bug-0084** — `apiFetch` sends `Content-Type: application/json` on GET/DELETE with no body.
- **bug-0085** — User `publicId` generated via UUID truncation (12 chars) instead of Sqid pattern used by all other entities.
- **bug-0086** — `validateInvitation`/`acceptInvitation` duplicated in `api.ts` and `api-public.ts`; divergence risk.
- **bug-0087** — DataTable sort direction arrows lack `aria-label`; screen readers announce Unicode literals.
- **bug-0088** — `BreadcrumbPage` uses `role="link"` on non-interactive current-page element.
- **bug-0089** — Sidebar toggle shortcut (Ctrl+B) conflicts with browser bold formatting.

### Project health note

82 open PRs, 0 merged. All bug-fix branches (bug-0001 through bug-0073) remain empty — no implementation work has started. 5 critical bugs now: RBAC isolation (bug-0001), JWT breaking change (bug-0038), in-memory OAuth codes (bug-0039), redirect_uri validation bypass (bug-0054), and inactive user auth bypass (bug-0074). Day 12 with zero fixes merged. Total open bugs: 89.

---

## [Unreleased] — 2026-06-06

No new code commits. Deep scan across auth-server OAuth flow, admin server actions, Prisma schema, shared UI components, and middleware surfaced **20 new bugs** (1 critical, 13 warning, 6 minor).

### Bugs found

See [TODO_2026-06-06.md](./todo/TODO_2026-06-06.md) and [BUGS_2026-06-06.md](./bugs/BUGS_2026-06-06.md).

#### Critical

- **bug-0054** — `oauthAuthorize` does not validate `redirect_uri` against the app's registered URL. An attacker-supplied `redirect_uri` causes the authorization code to be redirected to an external domain (RFC 6749 section 10.6 violation).

#### Warning

- **bug-0055** — `deleteUser` orphans BetterAuth `User`, `Session`, and `Account` rows; email is locked and active sessions survive deletion.
- **bug-0056** — `setLocaleAction` does not validate the `locale` parameter; arbitrary value written to cookie, path traversal possible via dynamic import.
- **bug-0057** — `setLocaleAction` open redirect: `pathname` parameter passed directly to `redirect()` without validation.
- **bug-0058** — Users page has no permission check; any authenticated user can view all users across all orgs.
- **bug-0059** — `SaUser.username` and `phoneNumber` lack unique constraints; `directLogin` may authenticate as wrong user when usernames collide.
- **bug-0060** — `detectIdentifierType` phone regex misclassifies numeric usernames as phone numbers, causing silent login failures.
- **bug-0061** — `updateUserAction` is the only mutation action without error handling; throws unhandled exceptions.
- **bug-0062** — Seed script uses hardcoded password with no production guard.
- **bug-0063** — `SentryExceptionFilter` sends unsanitized request URL (including invitation tokens) to Sentry.
- **bug-0064** — Delete menu items in roles/permissions tables use `data-disabled` instead of Radix `disabled` prop.
- **bug-0065** — `signIn` action ignores `next` query parameter; always redirects to `/users`.
- **bug-0066** — DataTable sortable headers not keyboard-accessible (WCAG 2.1 SC 2.1.1 violation).
- **bug-0067** — Invitation endpoints accept any string as token without format validation.

#### Minor

- **bug-0068** — TOCTOU race in org/app update/delete operations (findUnique then mutate, not atomic).
- **bug-0069** — Middleware `PUBLIC_PATHS` prefix match allows unintended routes like `/login-anything` to bypass auth.
- **bug-0070** — Users table action buttons (Deactivate, Activate, Reset Password, Resend Invitation) are clickable no-ops.
- **bug-0071** — DataTable clickable rows not keyboard-accessible.
- **bug-0072** — `acceptInvitation` exposes raw API error messages to end users.
- **bug-0073** — OAuth authorization codes never purged from memory (abandoned flows leak).

### Project health note

46+ open PRs, 0 merged. All bug-fix branches (bug-0001 through bug-0053) remain empty — no implementation work has started. 4 critical bugs now: RBAC isolation (bug-0001), JWT breaking change (bug-0038), in-memory OAuth codes (bug-0039), and redirect_uri validation bypass (bug-0054). Day 11 with zero fixes merged. Total open bugs: 73.

---

## [Unreleased] — 2026-06-05

No new code commits. Targeted scan of the admin console client layer and component lifecycle patterns surfaced 4 new bugs (2 warning, 2 minor).

### Bugs found

See [TODO_2026-06-05.md](./todo/TODO_2026-06-05.md) and [BUGS_2026-06-05.md](./bugs/BUGS_2026-06-05.md).

- **bug-0050** — `apiFetch` discards auth-server error response bodies; admin UI shows generic "API error 400" instead of actionable messages like "Email already exists."
- **bug-0051** — `validateInvitation` includes raw invitation token in Error message strings, leaking to Sentry, error boundaries, and console.
- **bug-0052** — `getEffectivePermissions` client wrapper synthesizes `Permission` objects with `id: name` (a name string, not a Sqid) and `appId: ''`. Latent until inline actions are added.
- **bug-0053** — 10 admin components use `setTimeout` in click handlers without cleanup on unmount (9 drawer copy handlers + accept-invite form redirect).

### Project health note

31 open PRs, 0 merged. All bug-fix branches (bug-0001 through bug-0049) remain empty — no implementation work has started. 3 critical bugs (RBAC isolation, JWT breaking change, in-memory OAuth codes) block the PKCE feature branch from shipping. Day 10 with zero fixes merged.

---

## [Unreleased] — 2026-06-04

Quiet day — no new code commits landed. One docs-only commit (`b1ff9cf`) from the previous daily review. Targeted scan of existing code on `master` surfaced 2 new bugs.

### Bugs found

See [TODO_2026-06-04.md](./todo/TODO_2026-06-04.md) and [BUGS_2026-06-04.md](./bugs/BUGS_2026-06-04.md).

- **bug-0048** — Magic link URLs and OTP codes logged to `console.log` with no production guard; leaks authentication secrets to log aggregators.
- **bug-0049** — JWT token lifetime hardcoded to 3600 seconds (`token.service.ts:74`); not configurable via environment variable.

### Project health note

29 open PRs, 0 merged. All bug-fix branches (bug-0001 through bug-0047) remain empty — no implementation work has started. 3 critical bugs (RBAC isolation, JWT breaking change, in-memory OAuth codes) block the PKCE feature branch from shipping.

---

## [Unreleased] — 2026-06-03

OAuth2 PKCE (S256) shipped end-to-end on `docs/pkce-resource-server-design` — 8 implementation commits adding the authorize/token flow to auth-server, a FastAPI resource server reference app, login redirect support (`next=` URL), idempotent demo seed, and structured observability logs. The JWT payload saw a **breaking change**: the `permissions` array was replaced with a space-separated `scope` string to align with OAuth 2.0 conventions.

### Added

#### auth-server — OAuth2 PKCE (S256)
- **`/api/token/oauth/authorize`** now requires `code_challenge` + `code_challenge_method=S256` query params; rejects requests without PKCE. (`144c474`)
- **`/api/token/oauth/token`** accepts `code_verifier` instead of `client_secret`; verifies S256 challenge using `crypto.timingSafeEqual` for constant-time comparison. (`144c474`)
- **`OauthService.generateCode()`** stores `codeChallenge` and `codeChallengeMethod` alongside the authorization code (5-minute TTL). (`144c474`)
- **`OauthService.exchangeCode()`** verifies the verifier against the stored challenge; single-use (code deleted after exchange). (`144c474`)
- **`assertRedirectUriMatchesApp()`** — new origin-matching validator for `redirect_uri` against the app's registered URL. (`144c474`)
- **`redirect-uri.spec.ts`** — unit tests for origin matching including localhost, port mismatches, path permutations. (`144c474`)
- **E2E PKCE round-trip test** — authorize → token exchange → JWT verification with scope claim. (`9ae64e3`)
- **`IsUrl({ require_tld: false })`** on `OauthTokenExchangeDto.redirect_uri` to allow `localhost` redirect URIs during development. (`27d5ecf`)
- **JWT `scope` claim** — permissions now serialized as a space-separated string (`scope`) instead of a JSON array (`permissions`). Sorted alphabetically, deduplicated. (`144c474`)

#### auth-server — Observability
- **Structured logging** added to OAuth authorize, token exchange, PKCE verification failure, redirect URI rejection, and direct login success/failure paths. Uses Winston via `LoggerService`. (`d204515`)
- **Sentry tags** — `authFlow` and `appId` tags set on both OAuth and direct-login flows. (`d204515`)

#### auth-server — Demo seed
- **`seedDemoResourceServer()`** — idempotent seed for `resourceserver01` app: 2 roles (Property Managers, Inspectors), 8 `rs.*` permissions, 2 demo users. Gated behind `SEED_DEMO=1`. (`bf7673f`)

#### admin — Login redirect (`next=` URL)
- **`/login?next=<url>`** — login page accepts a `next` query parameter; after successful authentication, redirects to the validated URL instead of `/users`. (`4da3fa1`)
- **`validateNextUrl()`** — same-origin path validator with open-redirect mitigations (rejects `//`, `\`, `userinfo@` URLs, validates absolute URLs against an allowlist). (`4da3fa1`)
- **`safe-next.spec.ts`** — 9 test cases covering null/empty, same-origin paths, protocol-relative, backslash, absolute allowed/disallowed, userinfo, malformed, and env additions. (`4da3fa1`)

#### FastAPI resource server (`apps/resource-server-fastapi/`)
- **New app** — Python/FastAPI reference implementation showing how a resource server integrates with SassyAuth via PKCE. (`97f0f67`, `1637743`)
- **PKCE login flow** — `/auth/login` generates verifier/challenge, redirects to SassyAuth `/authorize`; `/auth/callback` exchanges code for JWT via `code_verifier`. (`1637743`)
- **JWKS token verification** — `PyJWKClient` with 10-minute cache, RS256 algorithm enforcement, audience/issuer validation, required claims check. (`1637743`)
- **`require_scope()` dependency** — FastAPI dependency that extracts Bearer token, verifies JWT, and checks scope. (`1637743`)
- **`/api/properties`** — sample protected endpoint requiring `rs.properties.read` scope. (`1637743`)
- **Test suite** — `test_pkce.py` (verifier/challenge generation), `test_verifier.py` (JWT verification + scope checks), `test_api_properties.py` (endpoint integration). (`1637743`)

#### Documentation
- **FastAPI resource server design spec.** (`a9eb300`)
- **FastAPI resource server implementation plan.** (`120a42c`)

### Changed (Breaking)
- **JWT payload** — `permissions: string[]` → `scope: string` (space-separated). Consumers must parse `decoded.scope.split(' ')` instead of `decoded.permissions`. (`144c474`)
- **`TokenErrorCode` enum** — `INVALID_CODE` and `CODE_EXPIRED` removed; replaced with standard OAuth error codes: `INVALID_REQUEST`, `INVALID_REDIRECT_URI`, `INVALID_GRANT`, `UNAUTHORIZED_CLIENT`. (`144c474`)
- **`SassyAuthJwtPayload` type** updated to match. (`144c474`)

### Fixed
- **localhost redirect URIs** — `IsUrl({ require_tld: false })` allows `http://localhost:8010/auth/callback` in the token exchange DTO. Previously, `@IsUrl()` required a TLD, blocking localhost development. (`27d5ecf`)

### Risky patterns / missing tests

See [TODO_2026-06-03.md](./todo/TODO_2026-06-03.md) and [BUGS_2026-06-03.md](./bugs/BUGS_2026-06-03.md).

- **bug-0038** — JWT `permissions` → `scope` is a breaking change with no migration path or version bump.
- **bug-0039** — In-memory authorization code storage lost on restart; blocks horizontal scaling.
- **bug-0040** — No garbage collection for expired codes; memory leak under sustained traffic.
- **bug-0041** — `code_verifier` and `code_challenge` lack RFC 7636 format validation.
- **bug-0042** — FastAPI resource server exposes access token to client-side JavaScript via `sessionStorage`.
- **bug-0043** — FastAPI JWKS verifier catches all exceptions generically; masks distinct failure modes.
- **bug-0044** — FastAPI scope parsing returns `{"None"}` when scope claim is `null`.
- **bug-0045** — Demo seed hardcodes ngrok URL and weak password instead of reading from env vars.
- **bug-0046** — No rate limiting on token exchange or FastAPI OAuth endpoints.
- **bug-0047** — `redirect_uri` allows all paths under the registered origin; no per-app path allowlist.

---

## [Unreleased] — 2026-06-02

User access management shipped end-to-end — 28 commits across auth-server (role + direct-permission set-replace APIs, atomic createUser), admin UI (3-axis user drawers, RoleRowsEditor), and the sidebar active-route highlight feature branch. All 9 bugs from the 2026-06-01 review (bug-0024 through bug-0032) were merged to master.

### Added

#### auth-server — User role + direct-permission management
- **`UsersService.setUserRoles()`** — set-replace endpoint that atomically swaps all roles for a user within their org's app scope. Wrapped in `$transaction`. (`06abf2d`)
- **`UsersService.getUserDirectPermissions()` + `setUserDirectPermissions()`** — read and set-replace direct permission assignments. (`59ea2e2`)
- **`createUser` expanded** — now accepts `roleIds` and `directPermissionIds` arrays, resolved and assigned atomically inside the creation transaction. (`1a1383e`)
- **`PUT /users/:id/roles`** — set-replace roles endpoint. (`8077cff`)
- **`GET /users/:id/direct-permissions`** — read direct permissions. (`8077cff`)
- **`PUT /users/:id/direct-permissions`** — set-replace direct permissions endpoint. (`8077cff`)
- **`SetUserRolesDto` + `SetUserDirectPermissionsDto`** — validation DTOs. (`a64a673`)
- **`resolveAppScopedIds` shared helper** — extracted from repeated app-scoped ID resolution logic into `common/permissions/`. (`360f3b4`)
- **E2E tests** for `PUT /users/:id/roles` and direct-permissions endpoints. (`aec78a1`)

#### admin — User access editing UI
- **`RoleRowsEditor`** — multi-row role picker primitive for inline role management in drawers. (`c780734`)
- **User create drawer** — supports N roles + N direct permissions via new editor components. (`5832b5e`)
- **User view drawer** — surfaces direct permissions read-only alongside roles and effective permissions. (`fbb0385`)
- **User edit drawer** — 3-axis editing: profile fields, role assignment, direct permission assignment. (`98abb49`)
- **API client helpers** — `setUserRoles()`, `getUserDirectPermissions()`, `setUserDirectPermissions()` added to `lib/api.ts`. (`6a28512`)
- **Server actions** — `setUserRolesAction()`, `setUserDirectPermissionsAction()`, `getUserDirectPermissionsAction()`. (`1b45c19`)
- **i18n** — role + direct-permission editor strings in en.json/fr.json. (`900e423`)
- **Unit tests** — create-drawer passes roleIds + directPermissionIds; view-drawer renders + edits direct perms and roles. (`aae7c7e`, `0e74bc3`)
- **E2E test** — Playwright covers user edit drawer direct-perm flow. (`2e9b851`)

#### Sidebar active-route highlight (in progress — `fix/sidebar-active-highlight`)
- **Design spec** for sidebar active-route highlight behavior. (`45def99`)
- **Implementation plan** for sidebar active-route highlight. (`5337b2a`)
- **E2E test** asserting sidebar highlights the active route across all 5 admin areas. (`18d1802`, `75b2fe7`)

#### Documentation
- **FastAPI resource server spec** — design spec for a FastAPI resource server with PKCE against SassyAuth. (`44a1fe6`)

### Fixed
- **accept-invite CORS + scrypt hashing** — fixed CORS for the accept-invite endpoint, switched to scrypt (via `better-auth/crypto`) for password hashing to match BetterAuth's verifier, and dropped the `bcryptjs` dependency. (`af9f4ca`)
- **SheetContent scroll** — added `flex flex-col` to `SheetContent` so `SheetBody` scrolls correctly when content overflows. (`8ae19b3`)
- **Profile-save error routing** — non-Error failures in user profile save now route through `t()` for i18n instead of crashing. (`7cbfc5a`)
- **Unused i18n keys** — dropped unused `users.fields.directPermission*` keys from message bundles. (`ae9772f`)
- **bug-0024 through bug-0032** — all 9 bugs from the 2026-06-01 review merged to master via `feat/test-coverage-campaign`. See [BUGS_2026-06-01.md](./bugs/BUGS_2026-06-01.md).

### Risky patterns / missing tests

See [TODO_2026-06-02.md](./todo/TODO_2026-06-02.md) and [BUGS_2026-06-02.md](./bugs/BUGS_2026-06-02.md).

- **bug-0033** — Sidebar `startsWith()` matching can false-positive on overlapping route prefixes.
- **bug-0034** — `SetUserRolesDto` / `SetUserDirectPermissionsDto` have no `@ArrayMaxSize` or empty-array guard.
- **bug-0035** — New user server actions repeat the brittle string-matching error pattern already fixed in bug-0032.
- **bug-0036** — `getUserDirectPermissions()` returns `appId: ''`, losing the app context for direct permissions.
- **bug-0037** — `TRUSTED_ORIGINS` is not validated at startup; malformed values silently break CORS.

---

## [Unreleased] — 2026-06-01

Massive day — 47 commits across three workstreams: (1) full permissions and roles CRUD on both auth-server and admin UI, (2) shadcn reskin of the admin console (sidebar, drawers, dark mode, AlertDialog), and (3) a test coverage campaign adding controller specs, service branch coverage, and the matrix E2E test infrastructure.

### Added

#### auth-server — Permissions CRUD
- **`PermissionsService`** with TDD spec — full CRUD (list with pagination/search/app-filter, get with role/user detail, create, update, delete) and `isPlatform()` guard preventing mutation of `platform.*` permissions. (`7f966df`, `34a5e34`)
- **`PermissionsController`** mounted at `/api/permissions` — 5 endpoints (GET list, GET :id, POST, PATCH :id, DELETE :id). (`34a5e34`)
- **Permissions DTOs** — `CreatePermissionDto`, `UpdatePermissionDto`, `ListPermissionsQueryDto` with `@Matches(NAME_REGEX)` validation for dotted lowercase names. (`16d113a`)

#### auth-server — Roles CRUD expansion
- **Role CRUD with permission management** — `RolesService` expanded from read-only to full CRUD: create role with permission IDs, update name/description/permissions atomically in a transaction, delete with user-assignment guard. (`379a1db`)
- **Roles DTOs** — `CreateRoleDto`, `UpdateRoleDto`, `ListRolesQueryDto`. (`379a1db`)

#### auth-server — Test coverage campaign
- **Controller specs** for all 6 modules: apps (4 endpoints), orgs (5), roles (5), permissions (5), users (10), me (2), invitations (2). (`4480256`, `b072cc5`, `ccac0ae`, `611c1c5`, `c9b955c`, `6d4c1c9`)
- **Service spec branch coverage gaps filled** — apps, invitations, orgs, permissions, roles, users service specs expanded with edge cases (P2002/P2003 handling, NotFoundException, ForbiddenException for platform resources). (`7cb727b`)
- **Coverage baseline captured** — 228 tests, 93.33% statement coverage. (`b6fa656`)
- **Matrix E2E test infrastructure** — Nest bootstrap + per-admin session helper (`harness.ts`), per-test data factories with LIFO cleanup queue (`factories.ts`), permissions-matrix single source of truth (`permissions-matrix.ts`). Spec files for all 5 resources created (placeholder `it.skip`). (`990e6cb`, `622a4ad`, `712dd4a`)
- **API & E2E test coverage campaign design spec and implementation plan**. (`61cbe30`, `e58efa7`)

#### admin — Permissions UI
- **`/permissions` route + server actions** — list, get, create, update, delete with error mapping and `revalidatePath`. (`fdfcfc1`, `c3ae5b9`)
- **PermissionsTable** — TanStack Table with search, app filter, pagination, row actions (view/edit/copy name/delete). (`fc3808c`)
- **PermissionCreateDrawer, PermissionEditDrawer, PermissionViewDrawer** — full drawer set with form validation, `NAME_REGEX` enforcement, role/user detail in view drawer. (`61559f2`, `5e8ca5a`, `83d5547`)
- **Permissions i18n** — `permissions.*` block in en.json and fr.json. (`35d7862`)
- **Permissions types + API client helpers**. (`997ef54`)
- **Permissions UI test suites** — 4 test files covering create, edit, view drawers and table. (`116081d`)

#### admin — Roles UI
- **`/roles` route + server actions** — list, get, create, update, delete, listAppPermissions. (`fb48d9c`)
- **RolesTable** — TanStack Table with search, app filter, pagination, row actions. (`52dd681`)
- **RoleCreateDrawer, RoleEditDrawer, RoleViewDrawer** — full drawer set. RoleCreateDrawer includes `PermissionRowsEditor` for inline permission management. (`255c386`, `e23b633`, `1541fa0`)
- **Roles i18n** — `roles.*` block in en.json and fr.json. (`6d81389`)
- **Role types + API helpers + user drawer migration** to shared types. (`177d757`)
- **Roles UI test suites** — 4 test files. (`529e8ff`)

#### admin — Shadcn reskin
- **Sidebar + light/dark theme toggle** — `SidebarShell`, `ThemeProvider`, `ThemeToggle`, `UserFooter` with icon-collapse mode. (`07fd7f4`, `c032520`)
- **Unified `PageHeader`** across Apps/Orgs/Users. (`c7e9d6b`)
- **`DeleteAlertDialog`** — shadcn AlertDialog for all delete confirmations, replacing inline confirms. (`7b3c477`)
- **Drawer + avatar reskin** — all 9 drawers (apps, orgs, users × create/edit/view) reskinned per slate/indigo palette. (`adff67d`)
- **Access-denied panel polish**. (`7726ba2`)
- **Design from variant.com** imported. (`3173bab`)

### Fixed

- **Effective-permissions API response shape** — admin `lib/api.ts` now unwraps the correct response envelope. (`63aa0ee`)
- **Pre-existing build + test breakage** — `server-only` mock, view-drawer test fix, Next.js config, package deps. (`db93252`)
- **Authenticated routes broken** — bumped `lucide-react`, pass icon names as strings across server/client boundary. (`df86a1e`)

### Risky patterns / missing tests

See [TODO_2026-06-01.md](./todo/TODO_2026-06-01.md) and [BUGS_2026-06-01.md](./bugs/BUGS_2026-06-01.md).

- **bug-0024** — Missing org/tenant isolation in `PermissionsService` — all operations check `platform.permissions.manage` but never pass `targetOrgId`.
- **bug-0025** — Missing org/tenant isolation in `RolesService` — same issue.
- **bug-0026** — Permission `name` unique constraint is global, not per-app (should be `@@unique([appId, name])`).
- **bug-0027** — Role `name` has no unique constraint at all (missing `@@unique([appId, name])`).
- **bug-0028** — Admin UI type narrowing uses weak `'publicId' in res` check instead of `'errorKey' in res` (3 instances).
- **bug-0029** — Role names have no input validation in admin UI (permissions require `NAME_REGEX`).
- **bug-0030** — Delete buttons in permissions/roles tables use `data-disabled` instead of HTML `disabled`, breaking keyboard navigation.
- **bug-0031** — Matrix test cleanup queue is module-scoped and never reset between test files, risking cross-spec pollution.
- **bug-0032** — Error mapping in admin server actions relies on brittle string matching against error messages.

---

## [Unreleased] — 2026-05-31

Light day — one critical cookie-encoding bugfix, the orgs-admin-ui feature branch merge, and design documentation for the upcoming shadcn reskin.

### Fixed

- **Session cookie double-encoding** — `parseSessionCookie()` now `decodeURIComponent`'s the cookie value before passing it to `cookieStore.set()`. Previously, base64 `=` padding arrived as `%3D` from upstream; Next.js's `cookie.serialize` re-encoded it to `%253D`, producing a 48-char signature instead of 44. BetterAuth's session lookup returned null, bouncing every page refresh back to `/login`. (`30de696`)

### Added

- **Admin nav E2E regression test** — `apps/admin-e2e/tests/authed/admin-nav.spec.ts` verifies a pre-authenticated session survives navigation to `/users`, hard refresh, `/apps`, and `/orgs`. Guards against the double-encoding regression and any future cookie-handling regressions. (`30de696`)
- **Shadcn reskin design spec** — `docs/superpowers/specs/2026-05-31-shadcn-reskin-design.md`: token system (slate/blue-600 palette), sidebar-first layout, component migration inventory (Button, Input, Select, Table, Sheet → shadcn equivalents), dark mode via `next-themes`. (`bbb2b5f`)
- **Shadcn reskin implementation plan** — `docs/superpowers/plans/2026-05-31-shadcn-reskin.md`: 30+ tasks covering shadcn CLI setup, package rewire, component-by-component migration, `AdminShell` sidebar rebuild, dark mode toggle, and QA. (`db5c613`, `a3e8e2a`)
- **Orgs admin UI branch merged** — `feat/orgs-admin-ui` and `orgs-admin-ui` branches merged to master, bringing in the daily code review report (`CR_2026-05-29.md`) and agent worktree references. (`2b8e3aa`, `51074b0`)

### Risky patterns / missing tests

See [TODO_2026-05-31.md](./todo/TODO_2026-05-31.md) and [BUGS_2026-05-31.md](./bugs/BUGS_2026-05-31.md).

- **bug-0022** — `decodeURIComponent` in `parseSessionCookie` can throw `URIError` on malformed percent-encoded values (no try-catch).
- **bug-0023** — `.claude/worktrees/agent-*` submodule references committed to git history via merge commit.

---

## [Unreleased] — 2026-05-29

Major e2e testing infrastructure day: the `admin-e2e` Playwright suite shipped end-to-end with CI, alongside auth fixes for Origin header forwarding and cookie attribute preservation. Design work started on the Orgs admin UI.

### Added

#### Admin E2E Test Suite (`apps/admin-e2e`)
- **New workspace package** `@sassy-auth/admin-e2e` bootstrapped with Playwright, chromium-only. (`eb44710`)
- **Login spec** verifying `s@sa.io` signs in and redirects to `/users`, with error-text-on-failure racing for clear diagnostics. (`0aef125`, `97226dc`)
- **`LoginPage` Page Object Model** with scoped submit button locator. (`1bceaf2`, `df72ad4`)
- **Auto-applied diagnostics fixture** attaching console logs, page errors, network failures, page HTML snapshot, and visible text on test failure. (`a138529`, `fad2862`)
- **i18n helper** reading admin `messages/en.json` for assertion text. (`5cf4891`, `3e3222b`)
- **Auth-state setup project** + `chromium-authed` project for future logged-in specs. (`f5456d8`, `c0f8548`)
- **Playwright config** with conditional `webServer` (CI spins up both servers; local assumes they are running). (`8ce75cd`, `08e7838`)
- **`data-testid="login-error"`** hook on admin login page for e2e selector stability. (`b2c6ab8`)

#### CI / DevOps
- **GitHub Actions e2e workflow** (`.github/workflows/e2e.yml`) with Postgres 16 service container, Prisma migration, RSA keypair generation, seed data, Playwright browser install, and artifact uploads for report/traces. (`06c9907`, `8f80906`)
- **Turbo `test:e2e` task** in `turbo.json` with passthrough env vars and no caching. (`3fd73ef`)

#### Documentation
- **Orgs admin UI design spec** mirroring the apps page. (`41be341`)
- **Admin E2E README** (`apps/admin-e2e/README.md`). (`c16079b`)
- **Playwright E2E design spec and implementation plan**. (`f717666`, `e45ba10`, `09840fc`)
- **BEGINNER_README.md** for junior developer onboarding. (`2f2760d`)
- **2026-05-28 code review** report. (`3caec0d`)

### Fixed

- **Origin header forwarding** — new `getForwardedOrigin()` helper (`apps/admin/lib/auth-origin.ts`) extracts the browser's Origin/Referer and forwards it on server-to-server BetterAuth calls. Fixes 403 errors from Undici's default `Sec-Fetch-Mode: cors` tripping BetterAuth's CSRF middleware. (`62e69b4`)
- **Trusted origins config** — `auth.config.ts` now reads `TRUSTED_ORIGINS` env var (comma-separated), defaulting to `http://localhost:3001`. (`644bc6d`)
- **Sign-out redirect** — `signOutAction()` now redirects to `/` instead of `/login`, letting the middleware handle the redirect chain. (`e17ec2e`)
- **Login soft failure** — `signIn()` catches transport-level errors (auth-server unreachable) and returns `serverUnavailable` error key instead of crashing. (`2fa5010`)
- **Cookie attribute preservation** — full `parseSessionCookie()` replaces the old regex-extract, preserving `Max-Age`, `Expires`, `Domain`, `Path`, `SameSite`, `HttpOnly`, and `Secure` from upstream `Set-Cookie`. Resolves bug-0013 from 05-27 review. (`2fa5010`)
- **Password verification** — direct-login flow now uses `better-auth/crypto` instead of raw bcrypt. (`f4bd89e`)
- **CI workflow** — test-results upload now gates on `steps.run-e2e.outcome == 'failure'`. (`8f80906`)
- **tsconfig noEmit** — `admin-e2e/tsconfig.json` uses `noEmit: true` to suppress stray `.js` emit. (`59a5de3`)

### Changed

- **`.gitignore`** — added `**/*.tsbuildinfo` glob; removed previously committed `apps/admin/tsconfig.tsbuildinfo`. (`ccce6d5`)
- **Root page redirect** — `apps/admin/app/page.tsx` now redirects authenticated users to `/users`. (`92c1638`)
- **Next.js dev indicators** repositioned via `next.config.ts`. (`5bda178`)
- **User drawer** — various fixes to drawer behavior, data fetching, and view-drawer test coverage. (`1b00820`)
- **Auth-server e2e tests** — extended to cover seeded super-admin flows. (`0ab856d`)
- **`api-public.ts`** — added unauthenticated fetch helper for public auth endpoints. (`b5c07d0`)

---

## [2026-05-28] — 2026-05-27

Heavy feature day across the monorepo (63 commits, all on `master`, local only — 12+ commits ahead of `origin/master` at time of writing). Three concurrent threads: full users/invitations/roles/orgs API surface on `auth-server`, the new `admin` Next.js console, and production-grade observability on both apps.

### Added

#### auth-server — Users / Invitations / Roles / Orgs API

- **`POST /api/users`** — create user + auto-generate invitation token (7-day expiry); wrapped in `$transaction` for atomicity. (`ce7bbc5`, `92ecc2c`)
- **`GET /api/users`, `GET /api/users/:id`** — list and read users with org/email enrichment. (`17b7348`)
- **`PATCH /api/users/:id`, `DELETE /api/users/:id`** — partial update (firstName, lastName, phoneNumber, username, status) and delete. (`6b5dbb3`)
- **`GET /api/users/:id/roles`, `GET /api/users/:id/effective-permissions`** — read role assignments and computed permission set (roles ∪ direct). (`d01e03b`)
- **`POST /api/users/:id/roles`, `DELETE /api/users/:id/roles/:roleId`** — assign and remove role on user. (`762e58b`)
- **`POST /api/users/:id/resend-invitation`** — expire prior unused tokens and mint a fresh one (pending users only). (`aefa396`)
- **`GET /api/invitations/:token`, `POST /api/invitations/:token`** — validate an invitation and accept it (creates BetterAuth `account` + activates `SaUser`); accept path wrapped in `$transaction`. (`8f9e144`, `10a6466`)
- **`GET /api/orgs`, `GET /api/roles`** — read-only listings for the admin console drop-downs. (`2d6c91b`)
- **DB schema:** `UserStatus` enum (`pending` / `active` / `inactive` / `suspended`), `status` field on `SaUser`, new `SaInvitation` model with unique token, `expiresAt`, `usedAt`. (`32b7d0f`, `3dd738c`)
- **`UsersModule` scaffold:** module wiring, DTOs (with `@IsNotEmpty`, `@MinLength`, `@IsEmail`), permission helper. (`633dfe7`, `0bc8bbf`)
- **OpenAPI spec** updated for the new endpoints and status field. (`a9a34d1`)

#### auth-server — Observability (Winston + Sentry)

- **Winston config + NestJS `LoggerService` adapter** with dev/prod transports (console + dev-only file). (`88880c1`)
- **`RequestIdMiddleware`** — propagates / generates `X-Request-Id`, decorates `req.requestId`, echoes in response header. (`495a133`)
- **`RequestLoggingMiddleware`** — per-request structured log line (method, URL, status, duration) with request-id correlation. (`72cffe1`)
- **`SentryExceptionFilter`** — global filter that forwards 5xx (and only 5xx) to Sentry while logging at level. (`87f45b8`)
- **Sentry bootstrap** in `src/instrument.ts` loaded before NestJS (OTel auto-instrumentation). (`87f45b8`, `49c1458`)
- **Structured event logs** added to `TokenController`, `UsersService`, `InvitationsService` (createUser / updated / deleted / role assigned-removed / invitation resent-accepted). (`a68f119`)
- **`.env.example` observability vars**: `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `LOG_LEVEL`. (`85a0fb5`)

#### admin (new Next.js console)

- **Next.js app scaffold** with Tailwind v3, next-intl i18n (en/fr), `transpilePackages` for `@sassy-auth/ui`. (`719d69f`, `ca1b6dc`)
- **Auth middleware + `/login` page + Server Action** that proxies BetterAuth, forwards the session cookie. (`1a9ca0e`)
- **`AdminShell` layout** with sidebar, locale switcher, route group `(admin)`. (`d5df5e4`)
- **`/users` page** as a Server Component, `UsersTable` client component (TanStack Table). (`4995003`)
- **`UserViewDrawer`** — profile card, roles list, effective permissions, inline edit. (`d739c36`)
- **`UserCreateDrawer`** — create-user form, invite URL display + copy-to-clipboard, `createUserAction`. (`a3ebb15`)
- **`/accept-invite` page** — token validation (server) + password form (client). (`268e8d7`)
- **`lib/api.ts`** — session-forwarding `fetch` wrappers and shared types. (`fabacfa`)

#### admin — Observability

- **Sentry Next.js SDK setup** (client / server / edge configs) + `instrumentation.ts`. (`0e3d406`)
- **Global error boundary** (`app/global-error.tsx`) and **admin error boundary** (`app/(admin)/error.tsx`) both calling `Sentry.captureException`. (`42140ee`)
- **Breadcrumbs / user context** in `signIn` action, admin layout, `createUserAction`. (`f0e2a48`)
- **`.env.example` admin Sentry vars**: `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`. (`a526b15`)

#### packages/ui — shared design system

- **`packages/ui` scaffold** with Tailwind tokens, CSS variables, `sideEffects` config. (`22418c8`, `640b2de`)
- **Primitives:** `Button`, `Badge`, `Input`, `Label`, `Select`, `StatusChip`, `UserAvatar`. (`2e7b225`)
- **`Table` + `DataTable`** (TanStack Table integration). (`7156e1f`)
- **`Sheet`, `DropdownMenu`, `FormField`** primitives. (`405f95c`)

#### Documentation

- Observability design spec (Winston + Sentry) + dev-mode file transports addendum. (`35c9955`, `5cd01e7`)
- Observability implementation plan (15 tasks). (`ee7fda6`)
- Admin UI brainstorming + design files (`designs/`). (`ff0f7ef`, `f95331f`)

### Fixed

- **`StatusChip` color**: convert to Tailwind class (was `style` prop). (`6dcd6d5`)
- **`SelectTrigger` focus-visible** ring restored. (`6dcd6d5`)
- **`SelectItemIndicator`** added. (`6dcd6d5`)
- **`react-dom` peer** declared on `packages/ui`. (`6dcd6d5`)
- **`packages/ui` `sideEffects`** and `accent` token added; `typecheck` script. (`640b2de`)
- **`packages/ui` CSS vars** — removed invalid `hsl()` wrappers around color tokens. (`67bed60`)
- **`UsersModule` registration** + `@IsNotEmpty` on DTOs. (`0bc8bbf`)
- **`createUser`** wrapped in `$transaction`; `publicId` derived from `baUserId.slice(...)`. (`92ecc2c`)
- **`acceptInvitation`** writes wrapped in `$transaction`. (`10a6466`)

### Internal

- Verify filter UI test added for users list. (`f2823c9`)
- Admin-ui superpowers plan checked in. (`72ee02f`)
- Max output tokens raised to 64k in `.claude/settings.local.json`. (`2791597`)

### Risky patterns / missing tests

See [TODO.md](./TODO.md) for the prioritized follow-up list and [BUGs.md](./BUGs.md) for the bug catalog. Three Critical-severity items must be resolved before this branch is shippable:

- **bug-0001** — RBAC isolation broken across orgs in `checkPermission`.
- **bug-0002** — Invitation tokens leak via request URL logs (and Sentry).
- **bug-0003** — Admin Next.js middleware accepts any non-empty cookie value.
