# Admin Playwright E2E Tests — Design Spec

**Date:** 2026-05-28
**Author:** brainstorming session (Claude + user)
**Related prior specs:** `2026-05-27-apps-admin-ui-design.md`, `2026-05-26-user-management-ui-design.md`, `2026-05-27-platform-admin-seed-design.md`

## 1. Goal

Stand up a Playwright-based end-to-end test suite for the `apps/admin` UI in a new `apps/admin-e2e/` workspace package. The first concrete test exercises the seeded platform Super Admin (`s@sa.io` / `Pass@word1234`) signing in at `/login` and being redirected to `/users`. The harness is built so future UI tests on `/users`, `/apps`, etc. land cheaply, with rich on-failure diagnostics that surface the user-visible error (e.g. `"This account has been deactivated."`) — not just a generic URL-mismatch — so the suite is useful as an active debugging tool from day one.

## 2. Scope

### In scope

- **New workspace package** `apps/admin-e2e/` (registered automatically via the existing `apps/*` glob in `pnpm-workspace.yaml`).
- **Playwright config** with a single Chromium project, conditional `webServer` block toggled by `CI_TESTS=true` for CI auto-start, role-based selectors, trace / screenshot / video on failure.
- **Authenticated-state setup project** that signs in once per worker, stores the BetterAuth session cookie to `.auth/super-admin.json`, and exposes a `chromium-authed` project that future logged-in specs (`tests/authed/*.spec.ts`) opt into.
- **`LoginPage` Page Object Model** wrapping `/login` selectors and the sign-in action.
- **i18n helper** that reads `apps/admin/messages/en.json` directly so the POM's label strings track production copy with no next-intl runtime dep.
- **Auto-applied diagnostics fixture** that buckets browser console messages, page errors (with stack), and HTTP 4xx/5xx responses for every test, then attaches them to the Playwright HTML report when a test fails, alongside a full DOM snapshot and visible-text dump.
- **First spec** `tests/login.spec.ts`: races URL-becomes-`/users` against rendered-error-message-appears so a UI error is surfaced verbatim in the failure reason.
- **One production-side change** — add `data-testid="login-error"` to the existing error `<p>` in `apps/admin/app/login/page.tsx` so the POM can locate the dynamic-key error regardless of which of the three error keys (`invalidCredentials` / `inactive` / `serverUnavailable`) fired.
- **`.github/workflows/e2e.yml`** GitHub Actions workflow with a Postgres service container that migrates, seeds, generates a fresh RSA keypair, installs Chromium, runs the suite with `CI_TESTS=true`, and uploads the report + raw test-results as artifacts.
- **Turborepo wiring** — add a `test:e2e` task to `turbo.json`; the admin-e2e package exposes only `test:e2e` (not `test`) so the default `turbo test` pipeline does not run e2e by accident.

### Explicitly NOT in scope

- Any tests beyond the single `login.spec.ts` (`/users`, `/apps`, accept-invite flows, error paths). The `tests/authed/` folder and `chromium-authed` project ship empty, ready for follow-on PRs.
- WebKit / Firefox projects. Chromium only. Cross-browser added later when a real cross-browser need surfaces.
- Visual regression (`expect.toHaveScreenshot`). Out of scope for this PR.
- Sentry DSN wiring in CI. The workflow leaves `SENTRY_DSN` unset; both apps run with Sentry disabled, which is fine for e2e.
- Matrix builds / sharding. Single CI job, single worker.
- PR-comment posting of report links. GitHub's artifact UI is sufficient until usage proves otherwise.
- `globalSetup` that runs the seed. CI runs `pnpm seed` as its own step; local dev assumes the developer has already run it.
- A `lib/test-users.ts` central catalog of test credentials. Credentials are hardcoded inline in the single spec; centralization can happen the moment a second spec needs them.

## 3. Architecture

### Package layout

```
apps/admin-e2e/
├── package.json                  # @sassy-auth/admin-e2e (private workspace)
├── tsconfig.json                 # NodeNext, resolveJsonModule for messages/en.json import
├── playwright.config.ts          # conditional webServer, 3 projects (setup / chromium / chromium-authed)
├── .gitignore                    # .auth/, test-results/, playwright-report/, blob-report/
├── README.md                     # how to run locally + CI notes
├── auth-state.setup.ts           # logs in once per worker, persists storageState
├── pages/
│   └── login.page.ts             # LoginPage POM (selectors + actions; no expect)
├── lib/
│   ├── i18n.ts                   # t('login.email') → reads apps/admin/messages/en.json
│   └── fixtures.ts               # auto diagnostics fixture; re-exports test + expect
└── tests/
    ├── login.spec.ts             # the first test; runs in 'chromium' project (no preset session)
    └── authed/                   # empty in this PR; reserved for tests/authed/*.spec.ts
```

### Process boundaries

```
┌──────────────────────────────────────────────────────────────────────┐
│ Playwright runner (apps/admin-e2e)                                   │
│  - setup project: seeds .auth/super-admin.json via real /login       │
│  - chromium project: bare context — used for tests/login.spec.ts     │
│  - chromium-authed project: starts with storageState pre-loaded —    │
│    used for future tests/authed/*.spec.ts                            │
└──────────────────────────────────────────────────────────────────────┘
                       │ HTTP, cookie-jar per browser context
                       ▼
┌──────────────────────────────────────────────────────────────────────┐
│ apps/admin (Next.js, port 3001)                                      │
│  app/login/page.tsx          form with name=email, name=password     │
│  app/login/actions.ts        Server Action → POST /api/auth/sign-in  │
│  middleware.ts               redirects unauth → /login               │
│  app/page.tsx                redirect('/users') (added in prior turn)│
└──────────────────────────────────────────────────────────────────────┘
                       │ fetch with cookies forwarded
                       ▼
┌──────────────────────────────────────────────────────────────────────┐
│ apps/auth-server (NestJS + BetterAuth, port 3000)                    │
│  /api/auth/sign-in/email     issues better-auth.session_token cookie │
│  /api/auth/get-session       validates cookie for middleware         │
└──────────────────────────────────────────────────────────────────────┘
                       │
                       ▼
                  packages/db (Prisma) → Postgres
                       │
                       ▼
       Seeded by `pnpm --filter @sassy-auth/auth-server seed`
       Required pre-state: s@sa.io / Pass@word1234 row exists
```

### Stack management

| Environment | Auth-server | Admin app | Postgres | Set up by |
|---|---|---|---|---|
| Local dev | `pnpm dev` (developer) | `pnpm dev` (developer) | `pnpm dev` (developer) | Developer; Playwright assumes URLs reachable |
| CI (`CI_TESTS=true`) | Playwright `webServer` spawns | Playwright `webServer` spawns | GitHub Actions service container | `e2e.yml` workflow |

The `CI_TESTS=true` env var is the single switch. In `playwright.config.ts`:

- When set: `webServer` is an array of two entries (auth-server then admin), `retries: 2`, `workers: 1`, `forbidOnly: true`, HTML reporter on.
- When unset: `webServer` is `undefined`, `retries: 0`, parallel workers, list reporter.

### Authorization model

Tests use the seeded Platform Super Admin. The `s@sa.io` row is created by `apps/auth-server/src/seed/seed.ts:36` with the `Platform Super Admin` role, which is wired to every `platform.*` permission. Tests do not create their own users in this PR.

### Selectors strategy

Role-based (`getByLabel`, `getByRole`) for every interactive element. The label strings come from `apps/admin/messages/en.json` via the i18n helper, so a copy refactor either keeps the test green (label text unchanged) or breaks loudly with a missing-key error (helper throws on undefined). One exception: the login error `<p>` uses `data-testid="login-error"` because the rendered key is dynamic (one of three) and we don't want the test to know which one fired in advance.

## 4. Detailed design

### 4.1 `playwright.config.ts`

- `testDir: './tests'`
- `fullyParallel: true`
- `forbidOnly: CI_TESTS`
- `retries: CI_TESTS ? 2 : 0`
- `workers: CI_TESTS ? 1 : undefined`
- `reporter: CI_TESTS ? [['list'], ['html', { open: 'never' }]] : 'list'`
- `use.baseURL: process.env.ADMIN_URL ?? 'http://localhost:3001'`
- `use.trace: 'retain-on-failure'`
- `use.screenshot: 'only-on-failure'`
- `use.video: 'retain-on-failure'`
- `projects`:
  - `setup` — `testMatch: /auth-state\.setup\.ts/`
  - `chromium` — `Desktop Chrome` device; `testIgnore: /authed\/.*\.spec\.ts/`; no dependencies (so the login spec actually exercises login)
  - `chromium-authed` — `Desktop Chrome` device + `storageState: '.auth/super-admin.json'`; `dependencies: ['setup']`; `testMatch: /authed\/.*\.spec\.ts/`
- `webServer`:
  - When `CI_TESTS === 'true'`: array of two entries.
    - auth-server: `command: 'pnpm --filter @sassy-auth/auth-server dev'`, `url: '${AUTH_SERVER_URL}/api/token/jwks'`, `reuseExistingServer: false`, `timeout: 120_000`, `stdout: 'pipe'`, `stderr: 'pipe'`.
    - admin: `command: 'pnpm --filter @sassy-auth/admin dev'`, `url: ADMIN_URL`, `reuseExistingServer: false`, `timeout: 120_000`, `stdout: 'pipe'`, `stderr: 'pipe'`.
  - Otherwise: `undefined`.

Workers fixed to 1 in CI on purpose: BetterAuth session writes and a single shared Postgres mean parallel workers racing on `s@sa.io` login could trigger session collisions. Lift after the suite stabilizes.

### 4.2 `lib/i18n.ts`

Imports `apps/admin/messages/en.json` via Node's native JSON module assertion (`assert { type: 'json' }`), enabled by `module: "NodeNext"` + `resolveJsonModule: true` in tsconfig. Exposes a single function:

```ts
export function t(key: string): string
```

Walks a dot-path (`'login.email'` → `enMessages.login.email`). Throws if the resolved value is missing or not a string. The loud failure is intentional: a dropped i18n key surfaces as a clear test error, not a silent selector miss.

### 4.3 `pages/login.page.ts`

A `LoginPage` class. Constructor receives a `Page` and builds `Locator`s; no `expect` calls anywhere in the POM.

Exposed locators:

- `emailInput` — `page.getByLabel(t('login.email'))`
- `passwordInput` — `page.getByLabel(t('login.password'))`
- `submitButton` — `page.getByRole('button', { name: t('login.submit') })`
- `anyErrorMessage` — `page.getByTestId('login-error')` (resolves to the single error `<p>` regardless of which error key rendered)

Exposed actions:

- `async goto()` — `page.goto('/login')` (relative path; `baseURL` from config supplies the host)
- `async signIn(email, password)` — fill email, fill password, click submit

No assertion helpers on the POM. Assertions live in the specs so failures point at user-facing behavior, not a wrapper method.

### 4.4 `lib/fixtures.ts` — diagnostics

Re-exports a `test` extended from `@playwright/test`'s base with one fixture, `diagnostics`, declared with `{ auto: true }` so every spec that imports from this file gets the fixture wired without naming it in the test signature. Also re-exports `expect`.

During setup, the fixture binds four `page` event listeners and buckets them:

| Event | Bucket | Format |
|---|---|---|
| `console` | `consoleMessages` | `[${msg.type()}] ${msg.text()}` |
| `pageerror` | `pageErrors` | `${err.name}: ${err.message}\n${err.stack ?? ''}` |
| `requestfailed` | `networkFailures` | `requestfailed ${method} ${url} — ${failure.errorText}` |
| `response` (status ≥ 400) | `networkFailures` | `${status} ${method} ${url}` |

After the test runs, the fixture inspects `testInfo.status !== testInfo.expectedStatus`. If the test failed:

1. Capture `page.content()` (full HTML) and `page.locator('body').innerText()` (visible text). Both are wrapped in `.catch()` so a closed page doesn't mask the original failure.
2. Attach via `testInfo.attach()`:
   - `console.log` — bucketed console messages (or `(none)`)
   - `page-errors.log` — bucketed unhandled JS exceptions with stacks (or `(none)`)
   - `network.log` — bucketed 4xx/5xx responses and request failures (or `(none)`)
   - `page-snapshot.html` — full DOM at moment of failure (Content-Type `text/html`)
   - `visible-page-text.txt` — visible text only, when available

On green runs, nothing is attached and the buckets are garbage-collected with the fixture.

### 4.5 `auth-state.setup.ts`

A single Playwright `setup` test that:

1. Constructs a `LoginPage`, calls `goto()`, then `signIn('s@sa.io', 'Pass@word1234')`.
2. Asserts `expect(page).toHaveURL(/\/users$/)` so a broken login fails the setup loudly (and all `chromium-authed` specs fail-fast as a dependent project).
3. Calls `page.context().storageState({ path: '.auth/super-admin.json' })` to persist the cookie jar.

Future `tests/authed/*.spec.ts` start with this storageState pre-loaded — they `page.goto('/users')` and are already authenticated, skipping the login round-trip entirely (~50ms cookie replay vs. ~3–5s full login flow per test).

`.auth/` is gitignored. In CI, the file is regenerated every run. Locally, it persists across test runs until the BetterAuth session expires (default 7 days); once expired, the first authed test fails with a 401 in `network.log` via the diagnostics fixture — which is informative, not silent.

### 4.6 `tests/login.spec.ts`

```ts
test('s@sa.io signs in from /login and is redirected to /users', async ({ page }) => {
  const login = new LoginPage(page)
  await login.goto()
  await expect(page).toHaveURL(/\/login$/)

  await login.signIn('s@sa.io', 'Pass@word1234')

  // Race success-URL vs. visible-error so a UI error becomes the failure reason.
  const errorPromise = login.anyErrorMessage
    .waitFor({ state: 'visible', timeout: 10_000 })
    .then(() => 'error' as const)
    .catch(() => null)
  const successPromise = page
    .waitForURL(/\/users$/, { timeout: 10_000 })
    .then(() => 'success' as const)
    .catch(() => null)

  const outcome = await Promise.race([errorPromise, successPromise])

  if (outcome === 'error') {
    const renderedErrorText = (await login.anyErrorMessage.textContent())?.trim() ?? '<unknown>'
    throw new Error(
      `Login flow rendered an error to the user instead of redirecting: "${renderedErrorText}". ` +
        `See attached console.log, network.log, and page-snapshot.html for full context.`,
    )
  }

  await expect(page).toHaveURL(/\/users$/)
})
```

Imports from `'../lib/fixtures'` (not `'@playwright/test'` directly) so the auto diagnostics fixture is active.

The `/\/users$/` regex deliberately anchors with `$` to reject `/users?next=...` style accidents. The `/\/login$/` pre-assertion guards against a previous-session cookie silently letting the user past `/login`; in the bare `chromium` project this never happens, but the assertion is cheap insurance and documents intent.

### 4.7 `apps/admin/app/login/page.tsx` — production side

Single change: add `data-testid="login-error"` to the existing error `<p>` (currently at lines 48–56). No other changes; the attribute is inert in production. Justified because the rendered error key is dynamic (one of three) and using a role-based selector tied to a specific translated string would couple the POM to one error path.

### 4.8 Package scripts (`apps/admin-e2e/package.json`)

| Script | Command |
|---|---|
| `test:e2e` | `playwright test` |
| `test:e2e:headed` | `playwright test --headed` |
| `test:e2e:ui` | `playwright test --ui` |
| `test:e2e:report` | `playwright show-report` |
| `install:browsers` | `playwright install --with-deps chromium` |

Devdependencies: `@playwright/test`, `@types/node`, `typescript`. No runtime dependencies.

### 4.9 Turborepo wiring (`turbo.json`)

Add a `test:e2e` task. The `admin-e2e` package intentionally exposes `test:e2e` and not `test`, so `turbo test` (the default) does not invoke it. Running e2e is an explicit `pnpm --filter @sassy-auth/admin-e2e test:e2e` or `turbo test:e2e --filter=@sassy-auth/admin-e2e`.

### 4.10 `.github/workflows/e2e.yml`

| Block | Detail |
|---|---|
| Triggers | `pull_request` to master, `push` to master, `workflow_dispatch` |
| Concurrency | `e2e-${{ github.ref }}`, `cancel-in-progress: true` |
| Runner | `ubuntu-latest`, `timeout-minutes: 20` |
| Postgres service | `postgres:16`, dedicated `sassy_e2e` DB, health-checked port 5432 |
| Job-level env | `CI_TESTS=true`, `DATABASE_URL`, `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, `AUTH_SERVER_URL`, `ADMIN_URL`, `NODE_ENV=test` |
| Steps | (1) checkout, (2) pnpm setup, (3) node 20 + pnpm cache, (4) `pnpm install --frozen-lockfile`, (5) `prisma generate`, (6) `prisma migrate deploy`, (7) `pnpm --filter @sassy-auth/auth-server seed`, (8) generate fresh RSA keypair → base64 → `$GITHUB_ENV` as `RSA_PRIVATE_KEY` / `RSA_PUBLIC_KEY`, (9) `playwright install --with-deps chromium`, (10) `pnpm --filter @sassy-auth/admin-e2e test:e2e` |
| Artifacts | `playwright-report/` (always, 14-day retention), `test-results/` (on failure, 14-day retention) |

Caveat to verify during implementation: the workflow assumes auth-server reads `RSA_PRIVATE_KEY` / `RSA_PUBLIC_KEY` as base64-encoded PEM, matching the existing Jest e2e at `apps/auth-server/test/app.e2e-spec.ts:24-25`. If the production code expects a different encoding, the keygen step needs a one-line fix; this does not change the design.

Additional caveat: the env-var list above is the *known* set surfaced by the seed and the login flow. The auth-server may read additional vars (SQIDS alphabet, port, log level). Implementation must inventory `process.env.*` reads in `apps/auth-server` and add missing ones; this is a fill-in, not a re-design.

## 5. Failure-mode behavior

When the login test fails (per stated expectation that it currently will), the user gets, in this order of accessibility:

1. **Console output**: a non-zero exit code and the thrown `Error` message naming the rendered UI error verbatim. Example: `Login flow rendered an error to the user instead of redirecting: "This account has been deactivated."`
2. **Playwright HTML report** (`playwright-report/index.html`, opened with `pnpm --filter @sassy-auth/admin-e2e test:e2e:report`): per failing test —
   - Trace (full timeline; every action, network call, DOM snapshot)
   - Screenshot at moment of failure
   - Video of the run
   - `console.log` (every `console.*` from the page)
   - `page-errors.log` (unhandled JS exceptions with stack traces)
   - `network.log` (every HTTP 4xx/5xx)
   - `page-snapshot.html` (full DOM at moment of failure)
   - `visible-page-text.txt` (text-only view)
3. **CI artifacts**: same content, uploaded as `playwright-report` (always) and `playwright-test-results` (on failure).

A test that fails because no error was rendered AND no `/users` redirect happened within 10s falls into the `await expect(page).toHaveURL(/\/users$/)` at the end of the spec — that produces a Playwright-native timeout failure with the trace already attached.

## 6. Test plan

This PR's own verification (not test code in the suite, but how we know the harness works):

- **Green path on a known-good DB:** run `pnpm seed` locally on a fresh Postgres, bring up both apps with `pnpm dev`, run `pnpm --filter @sassy-auth/admin-e2e test:e2e`. The login spec passes. The setup project runs and writes `.auth/super-admin.json`.
- **Diagnostics smoke:** temporarily change the spec's password to `'wrong'`, run again. The thrown error message contains `"Invalid email or password."` (the rendered `login.error.invalidCredentials` text). `network.log` artifact contains the 401 response from `/api/auth/sign-in/email`. Revert the change before merging.
- **CI smoke:** push the branch; the workflow's Postgres comes up, migrations and seed run cleanly, Playwright spawns both apps, the spec runs (currently expected to fail per the user — the failure is informative, with full diagnostics in the uploaded artifacts).
- **No-CI-TESTS local default:** `pnpm --filter @sassy-auth/admin-e2e test:e2e` with both apps NOT running fails fast with connection errors and does NOT spawn the apps (verifies the conditional `webServer` gate).

## 7. Open questions / follow-ups (not blocking this PR)

- When the second logged-in spec lands, extract `s@sa.io` / `Pass@word1234` into `lib/test-users.ts`.
- When more than one Playwright suite exists (admin-e2e, future auth-server-e2e), revisit whether to lift `forbidOnly`, retries, and worker count into a shared `playwright.base.config.ts`.
- Visual regression and accessibility checks (`@axe-core/playwright`) — separate design when prioritized.
- Reusing storageState across CI jobs via cache — possible, but the cost of a fresh login per job is tiny vs. the complexity of staleness handling.
