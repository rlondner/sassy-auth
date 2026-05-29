# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
