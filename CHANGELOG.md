# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased] — 2026-07-01

Ships the toast/refresh admin UX, the OAuth issuer DRY refactor, and the E2E raceSuccessOrError scoping fix that had been accumulating on the working tree. Roles read gates broadened so the `/users` role picker works without a cross-page permission grant. Docs catch up on Flox, the multi-tenant demo seed, the `/.well-known/oauth-authorization-server` and `/api/me` endpoints, and the CR/BUGS/TODO daily-file convention.

### Added

#### admin — Toast notifications & post-mutation refresh
- **Sonner integration** — `sonner@^1.7.0` dependency; `<Toaster />` mounted in the root layout inside `ThemeProvider` and `NextIntlClientProvider`, forwards `next-themes` resolved theme so manual light/dark toggles take effect. (`apps/admin/components/toaster.tsx`, `apps/admin/app/layout.tsx`)
- **15 success toasts** on every CRUD path — create/update/delete for apps, orgs, permissions, roles, and users. All strings via i18n keys (`apps.toast.created`, `orgs.toast.updated`, …). Covers all 5 tables + 10 drawer variants.
- **`onSuccess?: () => void` prop** on every drawer (create + edit + view) so parent tables can pass a post-mutation refresh callback.
- **Table refresh helpers** — `apps-table`, `orgs-table`, `permissions-table`, `roles-table` each extract a `refresh` `useCallback` that re-fetches list data via the existing server action and is passed to their create/edit drawers. `users-table` uses `router.refresh()` since the Users page is a Server Component paired with `revalidatePath` in the mutating action.

#### auth-server — OAuth issuer resolution (DRY)
- **`resolveIssuer()` + `ISSUER_PLACEHOLDER`** exported from `oauth-metadata.ts`. Single source of truth for both the RFC 8414 discovery `issuer` field and the JWT `iss` claim, so the two cannot drift on a trailing slash or on the `https://auth.example.com` fallback. Strips a trailing slash from `BETTER_AUTH_URL` (RFC 8414 issuer matching is string-exact). (`apps/auth-server/src/token/oauth-metadata.ts`)
- **`NEST_GLOBAL_PREFIX` exported** — the `'api'` prefix is now defined once in `oauth-metadata.ts` and consumed by `configure-nest-app.ts`, replacing the previous duplicate string constant.
- **`DiscoveryController` startup warning** — logs a `console.warn` when `BETTER_AUTH_URL` is unset so a misconfigured prod deploy that would advertise the `https://auth.example.com` placeholder is observable. (`apps/auth-server/src/token/discovery.controller.ts`)
- **Test coverage** — `resolveIssuer()` unit tests (verbatim, trailing-slash strip, placeholder fallback, agreement between discovery + JWT paths); `DiscoveryController` startup-warn / no-warn tests. (`apps/auth-server/src/token/oauth-metadata.spec.ts`, `apps/auth-server/src/token/discovery.controller.spec.ts`)

#### docs
- **README — Flox quick-start** block pointing at `flox activate` for zero-config Node/pnpm/Postgres/Python provisioning. (`README.md`)
- **README — `SEED_DEMO_MULTITENANT`** documented (app01 + Acme/Globex orgs) alongside the existing `SEED_DEMO`.
- **README — API surface** now lists `GET /.well-known/oauth-authorization-server`, `GET /api/me`, and the `/oauth-error` admin route; adds a note that all admin CRUD flows show Sonner toasts.
- **README — Known Limitations** entry for `BETTER_AUTH_URL` not being validated at startup (bug-0115), and for the incomplete escalation-guard coverage on `removeRole` / `checkPermissionForApp` (bug-0094, bug-0097).
- **README — bug/CR paths** now reference `bugs/BUGS_*.md` and `todo/TODO_*.md` daily-file convention instead of the legacy `TODO.md` / `BUGs.md`.
- **`.env.example`** — adds `SEED_DEMO_MULTITENANT=` alongside `SEED_DEMO=`, so developers copying `.env.example` discover the multi-tenant demo seed.
- **`.gitignore`** — ignore `/.roborev/` snapshots.

### Changed

- **`TokenService.issueJwt`** — uses `resolveIssuer()` instead of inline `process.env.BETTER_AUTH_URL ?? 'https://auth.example.com'`, so the JWT `iss` claim and the discovery `issuer` field share the same normalization path. (`apps/auth-server/src/token/token.service.ts`)
- **`DiscoveryController.getOAuthAuthorizationServerMetadata`** — now calls `resolveIssuer()` (was reading `process.env.BETTER_AUTH_URL` directly). (`apps/auth-server/src/token/discovery.controller.ts`)
- **`RolesService.listRoles` / `getRole` read gates** — accept `platform.users.manage` in addition to `platform.roles.manage` / `org.roles.manage`, so the `/users` admin page can populate the role picker in the user-access drawer without needing a cross-page grant. Mirrors the orgs/permissions read pattern. Matrix test rotation and unit tests updated. (`apps/auth-server/src/roles/roles.service.ts`, `apps/auth-server/src/roles/roles.service.spec.ts`, `apps/auth-server/test/matrix/permissions-matrix.ts`)
- **`raceSuccessOrError` (E2E)** — all 5 admin-e2e page objects (`apps`, `orgs`, `permissions`, `roles`, `users`) scope error detection to `[data-sonner-toaster], [role="dialog"], [role="alertdialog"]` instead of the whole page. Next.js Dev Tools mounts a persistent empty `role="alert"` placeholder at the page root; a global `page.getByRole('alert')` matched it on every poll and made the error race always win.
- **OAuth authorize E2E route mock** — `oauth-authorize-flow.spec.ts` narrows the `page.route` stub from `${origin}/**` to exactly `origin === redirectUriOrigin && pathname === '/cb'`. The broad mock intercepted `/api/token/oauth/authorize` itself when `platformApp.url` shares the auth-server's origin (the default `BETTER_AUTH_URL=http://localhost:3000` case), causing the test to hang on the authorize endpoint with an empty body.
- **Playwright workers** — `CI_TESTS ? 1 : 1` (both branches serialize). Preserves the earlier local finding that Next.js dev-mode route compilation gets overwhelmed on cold-start parallel first-hits at 30s test timeout.

### Known open bugs

Daily bug/CR/TODO snapshots continue to live under `bugs/BUGS_*.md`, `code_reviews/CR_*.md`, and `todo/TODO_*.md`. Notable open items observed during the review window (bug-0112 … bug-0130) — French toast i18n untranslated (bug-0112), `refresh()` errors unhandled after mutations (bug-0114), `resolveIssuer()` accepts non-URL strings (bug-0115), `DeleteAlertDialog` error `<div>` missing `role="alert"` (bug-0120), `OrgsService` cross-tenant listing (bug-0121), double `stripTrailingSlash` (bug-0122) — remain open and are not addressed here.

---

## [Unreleased] — 2026-06-19

Massive day — 48 commits across two major feature branches (#114 feat/flox, #115 feat/org-scoped-admin), OAuth AS discovery, E2E fixes, and infrastructure cleanup. The org-scoped multi-tenant admin feature is the highlight: `SaPermission.isSystem`, app-scoped RBAC helpers, escalation guards, `GET /api/me` profile, permission-driven sidebar, and comprehensive scenario tests.

### Added

#### auth-server — Org-scoped multi-tenant administration (PR #115)

- **`SaPermission.isSystem` column** — new boolean column on permissions marking system-level perms that bypass app-scope checks. Migration sets `isSystem = true` on all `org.*` permissions. (`cc2c476`)
- **`checkPermissionForApp` helper** — app-scoped permission check for routes that operate within a single app's context. Non-platform permissions are rejected when the caller's app doesn't match the target app. (`b22f85f`)
- **`resolvePermissionIdsForApp`** honors `isSystem` flag — system permissions bypass the app-scope filter, allowing them to be assigned cross-app. (`efe06b3`)
- **`assertCallerCanGrantSystemPerms` escalation guard** — prevents privilege escalation by verifying the caller holds (directly or via roles) every system permission they're trying to grant. (`a4f6285`)
- **Escalation guard wired into user-assignment paths** — `assignRole`, `setUserRoles`, `setUserDirectPermissions`, and `createUser` all invoke the escalation guard before modifying grants. (`2a1c972`)
- **`GET /api/me` profile endpoint** — returns the caller's org, app context, and effective permissions for the admin UI's permission-driven behavior. (`f982259`)
- **Roles service: app-scoped gates** — `listRoles`/`createRole`/`updateRole`/`deleteRole` now check `platform.roles.manage` or `org.roles.manage` and scope reads by app. (`91f4a07`)
- **Permissions service: expose `isSystem`** — list and get responses include the `isSystem` flag. Immutability check extended to `isSystem` permissions. (`7424530`, `e7ee534`)
- **Orgs/permissions reads opened to `platform.users.manage`** — org-scoped admins with user management permission can now list orgs and permissions within their app scope. (`4e06f17`)
- **`SaRole @@unique([appId, name])` constraint** — role names are now enforced unique per app via DB constraint + migration. (`a13b1b7`)
- **Permission catalog migration** — split `platform.permissions.manage`, added `platform.roles.manage` + `org.roles.manage`, dropped `org.permissions.manage` with grant re-pointing. (`86d8a3a`)
- **Seed: `platform.roles.manage` + `org.roles.manage`** — new platform permissions seeded; added `r@sa.io` admin user. (`60a4912`)
- **Seed: `SEED_DEMO_MULTITENANT`** — new scenario creating `app01` with Acme and Globex orgs, 3 users each, with `org.users.manage` + `org.roles.manage` + custom app permissions. (`2e414f1`)

#### admin — Org-scoped UI (PR #115)

- **Permission-driven sidebar** — admin shell fetches `GET /api/me/permissions` and conditionally shows nav items based on the caller's effective permissions. (`4df9ee7`)
- **`getMyProfile` client** — `lib/api.ts` client helper for `GET /api/me`. (`b72dae7`)
- **`Permission.isSystem` type + System badge** — permissions table renders a "System" badge for `isSystem` permissions and locks edit/delete actions. (`b72dae7`, `0c5a67`)
- **Roles page: app-scoped** — non-platform callers see only their own app's roles; write affordances gated behind `canWrite`. (`c9d64aa`)
- **Users page: org-scoped default** — non-platform callers' Users page filters default to their own org. (`5999425`)
- **Sentry capture for /me failures** — `/api/me` fetch failures in the admin layout are reported to Sentry instead of silently swallowed. (`07f7d2a`)

#### auth-server — OAuth AS Discovery (latest on master)

- **`GET /.well-known/oauth-authorization-server`** — RFC 8414 OAuth Authorization Server metadata document exposing issuer, authorization/token/jwks endpoints, supported response types, grant types, and code challenge methods. (`4e06f17`)
- **`DiscoveryController`** — NestJS controller mounted outside the global prefix at `/.well-known/`. (`4e06f17`)

#### Flox environment (PR #114)

- **`.flox/env/manifest.toml`** — Flox environment with `nodejs_26`, `pnpm`, `postgresql`, `python311`, `uv`. (`6602267`)
- **Postgres service** — auto-provisioned via Flox services with `PGHOST`, `PGPORT`, `PGUSER`, `PGDATABASE` env vars. (`97c3b35`)
- **Auto-generate `.env.local`** — on first `flox activate`, generates RSA key pair, `BETTER_AUTH_SECRET`, and all other required env vars. (`97c3b35`)
- **Auto-run migrations and seed** — first activation runs `prisma migrate deploy` and `db:seed` automatically. (`1e1b34c`)

#### Testing

- **Multi-tenant scenario tests** — `bootScenarioApp` + demo-user helpers, visibility isolation spec (Acme/Globex admins see only their org's users), grant-ceiling spec (escalation guard blocks cross-permission-level grants). (`9d7c425`, `8962f65`, `20e2d7d`)
- **Migration verification test** — verifies `org.roles.manage` re-point and `org.permissions.manage` drop. (`3aef3e2`)
- **E2E multi-tenant tenant admin** — Playwright spec verifying tenant admin sees only their own org's users and scoped sidebar. (`c9910fd`)
- **Sidebar unit tests** — platform super, tenant admin, and single-perm holder sidebar visibility. (`477a536`)
- **Matrix test rotation** — updated for `platform.roles.manage` split. (`701ace6`)
- **Prisma binary resolution** — E2E tests now resolve prisma via absolute path instead of npx. (`1e22059`)

#### Infrastructure

- **Timestamped test results** — `scripts/log-test.mjs` writes test results to `test-results/` with timestamps. (`0370241`)
- **Code review files moved** — historical code review reports moved to `code_reviews/` directory. (`681bf68`)
- **`.gitignore` updates** — ignore `.claude/worktrees/`, `test-results/`, turbo watch config. (`70515ea`, `155d036`)

### Fixed

- **bug-0027 / bug-0078** — Role name uniqueness: `@@unique([appId, name])` constraint added via migration `20260618215604`. (`a13b1b7`)
- **E2E test fixes** — Playwright page objects refactored with `raceSuccessOrError` pattern, users page object expanded, Flox manifest fixes. (`ac648f6`)

### Bugs found (18 new)

See [TODO_2026-06-19.md](./todo/TODO_2026-06-19.md) and [BUGS_2026-06-19.md](./bugs/BUGS_2026-06-19.md).

#### Critical

- **bug-0094** — `checkPermissionForApp` silently grants access when `targetAppId` is undefined — any non-platform permission holder gets unconditional access.
- **bug-0099** — Migration 20260618220100 uses literal `publicId` strings that violate the unique constraint on re-run (partial migration recovery).
- **bug-0101** — `closeScenarioApp()` in the first scenario spec's `afterAll` tears down the shared NestJS server; second spec fails with `ERR_SERVER_NOT_RUNNING`.

#### Warning

- **bug-0095** — TOCTOU race in OAuth authorize vs code exchange: user's org/app membership not re-validated at code exchange.
- **bug-0096** — `updatePermission` allows renaming a non-platform permission to a `platform.*` prefix.
- **bug-0097** — `removeRole` has no escalation guard (asymmetric with `assignRole`).
- **bug-0098** — Migration isSystem bulk UPDATE affects all apps' `org.*` permissions, not just the platform app.
- **bug-0100** — New permissions from migration left with `pending-*` placeholder publicIds until the next seed.
- **bug-0102** — Grant-ceiling scenario tests are order-dependent with no teardown.
- **bug-0103** — `permissions-table.tsx` has no `canWrite` prop; edit/delete shown based on name heuristic only.
- **bug-0104** — `users-table.tsx` `initialOrgId`/`canPickOrg` props accepted but voided; org filtering non-functional.
- **bug-0105** — `permission-view-drawer.tsx` fetch error silently swallowed; sections appear empty with no feedback.
- **bug-0106** — Admin layout uses `notFound()` instead of `redirect('/login')` for unauthenticated sessions.
- **bug-0107** — `roles/page.tsx` throws raw `allSettled` rejection to error boundary, leaking API paths.
- **bug-0108** — `raceSuccessOrError` in E2E page objects resolves silently when both timeout (false positive).

#### Minor

- **bug-0109** — `playwright.config.ts` workers ternary is a dead branch (`CI_TESTS ? 1 : 1`).
- **bug-0110** — `roles.service.ts` `updateRole` missing null check after `findUnique` in transaction.
- **bug-0111** — `me.controller.ts` unsafe cast to extract `betterAuthUser` without optional chaining.

### Project health note

After today's review: 2 bugs fixed (bug-0027, bug-0078), 18 new bugs found. Net bug count: **109 open** (93 prior - 2 fixed + 18 new). The org-scoped admin feature is a significant architectural improvement, but the migration safety issues (bug-0098, bug-0099, bug-0100) and the escalation guard coverage gaps (bug-0094, bug-0096, bug-0097) should be addressed before deploying to a multi-tenant production environment. The 5 original critical bugs (bug-0001, bug-0038, bug-0039, bug-0054, bug-0074) remain open. Day 23 with zero fixes merged to production.

---

## [Unreleased] — 2026-06-18

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
