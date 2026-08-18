# Admin Playwright E2E Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a Playwright e2e suite in a new `apps/admin-e2e/` workspace package, with a Page Object Model for `/login`, an auto-diagnostics fixture, an authenticated-state setup project, a first spec that signs in as the seeded `s@sa.io` super admin, and a CI workflow that auto-starts both apps under `CI_TESTS=true`.

**Architecture:** New pnpm workspace at `apps/admin-e2e/`. Three Playwright projects: a `setup` project that signs in once and persists `storageState` to `.auth/super-admin.json`; a bare `chromium` project that runs the login spec (no preset session); a `chromium-authed` project (with `storageState` pre-loaded) reserved for future logged-in specs in `tests/authed/`. Diagnostics fixture is auto-applied — it buckets console/pageerror/network for every test and attaches them with a DOM snapshot on failure. Locally, Playwright assumes both apps and Postgres are already running. In CI (`CI_TESTS=true`), Playwright's `webServer` block spawns both apps; the GitHub Actions workflow provides Postgres via a service container.

**Tech Stack:** Playwright (`@playwright/test`), TypeScript 5 (NodeNext module resolution for native JSON imports), pnpm 9 workspaces, Turborepo, GitHub Actions, Postgres 16 service container.

**Reference spec:** `docs/superpowers/specs/2026-05-28-playwright-e2e-design.md`.

---

## Files this plan creates or modifies

**Create (new workspace package):**
- `apps/admin-e2e/package.json` — workspace metadata + Playwright scripts + devDeps
- `apps/admin-e2e/tsconfig.json` — NodeNext module + resolveJsonModule for the i18n import
- `apps/admin-e2e/.gitignore` — `.auth/`, `test-results/`, `playwright-report/`, `blob-report/`, `node_modules/`
- `apps/admin-e2e/playwright.config.ts` — single source of Playwright config; conditional `webServer`, three projects
- `apps/admin-e2e/lib/i18n.ts` — dot-path lookup against `apps/admin/messages/en.json`
- `apps/admin-e2e/lib/fixtures.ts` — auto-applied `diagnostics` fixture; re-exports `test` and `expect`
- `apps/admin-e2e/pages/login.page.ts` — `LoginPage` POM (locators + actions only, no assertions)
- `apps/admin-e2e/auth-state.setup.ts` — `setup`-project spec that signs in and persists `storageState`
- `apps/admin-e2e/tests/login.spec.ts` — the first spec: `s@sa.io` → `/users` with error-text-on-failure racing
- `apps/admin-e2e/tests/authed/.gitkeep` — empty marker so the folder exists but contains no specs in this PR
- `apps/admin-e2e/README.md` — how to run locally + CI notes
- `.github/workflows/e2e.yml` — Postgres service container, migrate, seed, generate RSA keys, run Playwright with `CI_TESTS=true`, upload artifacts

**Modify (production-side):**
- `apps/admin/app/login/page.tsx:49` — add `data-testid="login-error"` to the existing error `<p>` (one attribute, otherwise unchanged)
- `turbo.json` — add a `test:e2e` task so `turbo test` continues to ignore the e2e suite and `turbo test:e2e --filter=@sassy-auth/admin-e2e` runs it explicitly

---

## Task 1: Bootstrap the `admin-e2e` workspace package

**Files:**
- Create: `apps/admin-e2e/package.json`
- Create: `apps/admin-e2e/tsconfig.json`
- Create: `apps/admin-e2e/.gitignore`

- [ ] **Step 1.1: Create the package directory and `package.json`**

Use the Write tool. Write `apps/admin-e2e/package.json`:

```json
{
  "name": "@sassy-auth/admin-e2e",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "test:e2e": "playwright test",
    "test:e2e:headed": "playwright test --headed",
    "test:e2e:ui": "playwright test --ui",
    "test:e2e:report": "playwright show-report",
    "install:browsers": "playwright install --with-deps chromium"
  },
  "devDependencies": {
    "@playwright/test": "^1.49.0",
    "@types/node": "^20.0.0",
    "typescript": "^5.4.0"
  }
}
```

Note: no `test` script (deliberate — keeps `turbo test` from picking up e2e).

- [ ] **Step 1.2: Create `tsconfig.json`**

Write `apps/admin-e2e/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["playwright.config.ts", "auth-state.setup.ts", "pages/**/*", "lib/**/*", "tests/**/*"]
}
```

- [ ] **Step 1.3: Create `.gitignore`**

Write `apps/admin-e2e/.gitignore`:

```
node_modules/
.auth/
test-results/
playwright-report/
blob-report/
```

- [ ] **Step 1.4: Install the package and Chromium**

Run from the repo root:

```powershell
pnpm install
```

Expected: pnpm picks up the new `apps/admin-e2e/` workspace via the existing `apps/*` glob and installs `@playwright/test`, `@types/node`, and `typescript` into `apps/admin-e2e/node_modules`.

Then install the Chromium browser binary:

```powershell
pnpm --filter @sassy-auth/admin-e2e exec playwright install chromium
```

Expected: downloads the Chromium build to Playwright's per-user cache. On Linux/CI we'd add `--with-deps`; on Windows that flag is a no-op.

- [ ] **Step 1.5: Verify workspace registration**

```powershell
pnpm -r list --depth -1 | findstr admin-e2e
```

Expected: one line that includes `@sassy-auth/admin-e2e`. If the line is missing, `pnpm install` did not pick up the new package — double-check `pnpm-workspace.yaml` still has the `apps/*` glob and the directory name matches exactly.

- [ ] **Step 1.6: Commit**

```powershell
git add apps/admin-e2e/package.json apps/admin-e2e/tsconfig.json apps/admin-e2e/.gitignore pnpm-lock.yaml
git commit -m "chore(admin-e2e): bootstrap @sassy-auth/admin-e2e workspace package"
```

---

## Task 2: Add `data-testid="login-error"` to the admin login page

**Files:**
- Modify: `apps/admin/app/login/page.tsx:49`

- [ ] **Step 2.1: Read the current file**

Use the Read tool on `apps/admin/app/login/page.tsx`. Confirm lines 48–56 still render the error `<p>` as:

```tsx
{state?.error && (
  <p className="text-label-md text-[var(--destructive)]">
    {state.error === 'invalidCredentials' ||
    state.error === 'inactive' ||
    state.error === 'serverUnavailable'
      ? t(`error.${state.error}`)
      : state.error}
  </p>
)}
```

If the structure has drifted, the testid still belongs on whichever single `<p>` renders any of the three known error messages. Don't add it to multiple places.

- [ ] **Step 2.2: Add the testid**

Use the Edit tool on `apps/admin/app/login/page.tsx`:

old_string:
```
    <p className="text-label-md text-[var(--destructive)]">
```

new_string:
```
    <p data-testid="login-error" className="text-label-md text-[var(--destructive)]">
```

- [ ] **Step 2.3: Verify admin jest tests still pass**

```powershell
pnpm --filter @sassy-auth/admin test
```

Expected: all existing admin jest specs pass (the testid is inert in the markup; nothing should break). If an existing snapshot test fails because the snapshot includes the attribute set, update the snapshot.

- [ ] **Step 2.4: Commit**

```powershell
git add apps/admin/app/login/page.tsx
git commit -m "feat(admin): add data-testid=\"login-error\" hook for e2e selector"
```

---

## Task 3: Create the i18n helper

**Files:**
- Create: `apps/admin-e2e/lib/i18n.ts`

The helper has no unit test — it's transitively verified by Task 4 (LoginPage uses it for every locator) and Task 7 (the spec runs the LoginPage). YAGNI.

- [ ] **Step 3.1: Create the file**

Write `apps/admin-e2e/lib/i18n.ts`:

```ts
import enMessages from '../../admin/messages/en.json' assert { type: 'json' }

// Walk a dot-path: 'login.email' → enMessages.login.email.
// Throws on missing key — a dropped i18n entry should surface as a
// loud test error, not a silent selector miss.
export function t(key: string): string {
  const value = key.split('.').reduce<unknown>((acc, k) => {
    if (acc && typeof acc === 'object' && k in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[k]
    }
    return undefined
  }, enMessages)
  if (typeof value !== 'string') {
    throw new Error(`i18n key missing or not a string: ${key}`)
  }
  return value
}
```

- [ ] **Step 3.2: Type-check**

```powershell
pnpm --filter @sassy-auth/admin-e2e exec tsc --noEmit
```

Expected: no errors. If TS complains about the JSON import, double-check `module: "NodeNext"` and `resolveJsonModule: true` are set in `tsconfig.json` from Task 1.

- [ ] **Step 3.3: Commit**

```powershell
git add apps/admin-e2e/lib/i18n.ts
git commit -m "feat(admin-e2e): add i18n helper reading admin messages/en.json"
```

---

## Task 4: Create the `LoginPage` POM

**Files:**
- Create: `apps/admin-e2e/pages/login.page.ts`

- [ ] **Step 4.1: Create the file**

Write `apps/admin-e2e/pages/login.page.ts`:

```ts
import type { Page, Locator } from '@playwright/test'
import { t } from '../lib/i18n'

export class LoginPage {
  readonly page: Page
  readonly emailInput: Locator
  readonly passwordInput: Locator
  readonly submitButton: Locator
  readonly anyErrorMessage: Locator

  constructor(page: Page) {
    this.page = page
    this.emailInput = page.getByLabel(t('login.email'))
    this.passwordInput = page.getByLabel(t('login.password'))
    this.submitButton = page.getByRole('button', { name: t('login.submit') })
    // Single error <p> in app/login/page.tsx renders one of three dynamic
    // error keys; selecting by testid avoids coupling to a specific key.
    this.anyErrorMessage = page.getByTestId('login-error')
  }

  async goto() {
    await this.page.goto('/login')
  }

  async signIn(email: string, password: string) {
    await this.emailInput.fill(email)
    await this.passwordInput.fill(password)
    await this.submitButton.click()
  }
}
```

- [ ] **Step 4.2: Type-check**

```powershell
pnpm --filter @sassy-auth/admin-e2e exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4.3: Commit**

```powershell
git add apps/admin-e2e/pages/login.page.ts
git commit -m "feat(admin-e2e): add LoginPage Page Object Model"
```

---

## Task 5: Create the auto-applied diagnostics fixture

**Files:**
- Create: `apps/admin-e2e/lib/fixtures.ts`

- [ ] **Step 5.1: Create the file**

Write `apps/admin-e2e/lib/fixtures.ts`:

```ts
import { test as base } from '@playwright/test'

type DiagnosticBuckets = {
  consoleMessages: string[]
  pageErrors: string[]
  networkFailures: string[]
}

export const test = base.extend<{ diagnostics: DiagnosticBuckets }>({
  diagnostics: [
    async ({ page }, use, testInfo) => {
      const buckets: DiagnosticBuckets = {
        consoleMessages: [],
        pageErrors: [],
        networkFailures: [],
      }

      page.on('console', (msg) => {
        buckets.consoleMessages.push(`[${msg.type()}] ${msg.text()}`)
      })
      page.on('pageerror', (err) => {
        buckets.pageErrors.push(`${err.name}: ${err.message}\n${err.stack ?? ''}`)
      })
      page.on('requestfailed', (req) => {
        const failure = req.failure()?.errorText ?? 'unknown'
        buckets.networkFailures.push(
          `requestfailed ${req.method()} ${req.url()} — ${failure}`,
        )
      })
      page.on('response', (res) => {
        if (res.status() >= 400) {
          buckets.networkFailures.push(
            `${res.status()} ${res.request().method()} ${res.url()}`,
          )
        }
      })

      await use(buckets)

      // After test runs, attach diagnostics on failure only.
      if (testInfo.status !== testInfo.expectedStatus) {
        const html = await page.content().catch(() => '<could not capture page HTML>')
        const visibleText = await page.locator('body').innerText().catch(() => null)

        await testInfo.attach('console.log', {
          body: buckets.consoleMessages.join('\n') || '(none)',
          contentType: 'text/plain',
        })
        await testInfo.attach('page-errors.log', {
          body: buckets.pageErrors.join('\n\n') || '(none)',
          contentType: 'text/plain',
        })
        await testInfo.attach('network.log', {
          body: buckets.networkFailures.join('\n') || '(none)',
          contentType: 'text/plain',
        })
        await testInfo.attach('page-snapshot.html', {
          body: html,
          contentType: 'text/html',
        })
        if (visibleText) {
          await testInfo.attach('visible-page-text.txt', {
            body: visibleText,
            contentType: 'text/plain',
          })
        }
      }
    },
    { auto: true },
  ],
})

export { expect } from '@playwright/test'
```

- [ ] **Step 5.2: Type-check**

```powershell
pnpm --filter @sassy-auth/admin-e2e exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5.3: Commit**

```powershell
git add apps/admin-e2e/lib/fixtures.ts
git commit -m "feat(admin-e2e): add auto-applied diagnostics fixture"
```

---

## Task 6: Create the minimal `playwright.config.ts` (chromium only, no setup/authed yet)

This task ships a working config with just the `chromium` project so Task 7 can run the login spec end-to-end without depending on the setup/authed wiring (added in Task 8). Keeping these in separate commits makes a regression easier to bisect later.

**Files:**
- Create: `apps/admin-e2e/playwright.config.ts`

- [ ] **Step 6.1: Create the file**

Write `apps/admin-e2e/playwright.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test'

const CI_TESTS = process.env.CI_TESTS === 'true'
const ADMIN_URL = process.env.ADMIN_URL ?? 'http://localhost:3001'
const AUTH_SERVER_URL = process.env.AUTH_SERVER_URL ?? 'http://localhost:3000'

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: CI_TESTS,
  retries: CI_TESTS ? 2 : 0,
  workers: CI_TESTS ? 1 : undefined,
  reporter: CI_TESTS ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: ADMIN_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: CI_TESTS
    ? [
        {
          command: 'pnpm --filter @sassy-auth/auth-server dev',
          url: `${AUTH_SERVER_URL}/api/token/jwks`,
          reuseExistingServer: false,
          timeout: 120_000,
          stdout: 'pipe',
          stderr: 'pipe',
        },
        {
          command: 'pnpm --filter @sassy-auth/admin dev',
          url: ADMIN_URL,
          reuseExistingServer: false,
          timeout: 120_000,
          stdout: 'pipe',
          stderr: 'pipe',
        },
      ]
    : undefined,
})
```

- [ ] **Step 6.2: Type-check**

```powershell
pnpm --filter @sassy-auth/admin-e2e exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6.3: Smoke-check that Playwright loads the config**

```powershell
pnpm --filter @sassy-auth/admin-e2e exec playwright test --list
```

Expected: `Listing tests:` output with `Total: 0 tests in 0 files` (no specs exist yet — that's fine). If Playwright errors about the config, fix and retry before moving on.

- [ ] **Step 6.4: Commit**

```powershell
git add apps/admin-e2e/playwright.config.ts
git commit -m "feat(admin-e2e): add Playwright config (chromium only, conditional webServer)"
```

---

## Task 7: Write and verify the first spec — `tests/login.spec.ts`

**Files:**
- Create: `apps/admin-e2e/tests/login.spec.ts`

This task contains the project's first observable behavior. The spec is expected to FAIL on first run (the user has confirmed this in advance). Success criteria are NOT "test green" but "test fails with a clear diagnostic message that quotes the user-visible error from the UI."

- [ ] **Step 7.1: Bring up the stack locally**

This task requires both apps and Postgres running. In separate terminals:

```powershell
# Terminal A — DB + both apps via Turborepo
pnpm dev
```

Confirm `http://localhost:3000/api/token/jwks` and `http://localhost:3001/login` both respond (browser or `curl`).

If you have not seeded the DB on this checkout yet:

```powershell
# Terminal B — one-time seed
pnpm --filter @sassy-auth/auth-server seed
```

Expected seed output ends with `Seed complete.` and includes a line `Created admin s@sa.io with role Platform Super Admin` (or `Admin already exists: s@sa.io` if already seeded).

- [ ] **Step 7.2: Write the spec**

Write `apps/admin-e2e/tests/login.spec.ts`:

```ts
import { test, expect } from '../lib/fixtures'
import { LoginPage } from '../pages/login.page'

const SUPER_ADMIN_EMAIL = 's@sa.io'
const SUPER_ADMIN_PASSWORD = 'Pass@word1234'
const RACE_TIMEOUT_MS = 10_000

test.describe('Login', () => {
  test('s@sa.io signs in from /login and is redirected to /users', async ({ page }) => {
    const login = new LoginPage(page)
    await login.goto()
    await expect(page).toHaveURL(/\/login$/)

    await login.signIn(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD)

    // Race success-URL vs. visible-error so a UI error becomes the failure reason.
    const errorPromise = login.anyErrorMessage
      .waitFor({ state: 'visible', timeout: RACE_TIMEOUT_MS })
      .then(() => 'error' as const)
      .catch(() => null)
    const successPromise = page
      .waitForURL(/\/users$/, { timeout: RACE_TIMEOUT_MS })
      .then(() => 'success' as const)
      .catch(() => null)

    const outcome = await Promise.race([errorPromise, successPromise])

    if (outcome === 'error') {
      const renderedErrorText =
        (await login.anyErrorMessage.textContent())?.trim() ?? '<unknown>'
      throw new Error(
        `Login flow rendered an error to the user instead of redirecting: "${renderedErrorText}". ` +
          `See attached console.log, network.log, and page-snapshot.html for full context.`,
      )
    }

    await expect(page).toHaveURL(/\/users$/)
  })
})
```

- [ ] **Step 7.3: Run the spec**

```powershell
pnpm --filter @sassy-auth/admin-e2e test:e2e
```

Two possible outcomes — both are acceptable for THIS task:

  **Outcome A — test passes (login flow is healthy):** the spec ends in `1 passed`. Move on to Step 7.4.

  **Outcome B — test fails (expected, per stated user expectation):** the failure must contain ONE of these patterns in the thrown error message:
  - `Login flow rendered an error to the user instead of redirecting: "Invalid email or password."`
  - `Login flow rendered an error to the user instead of redirecting: "This account has been deactivated."`
  - `Login flow rendered an error to the user instead of redirecting: "Sign-in service is unavailable. Please try again in a moment."`
  - Or a Playwright-native timeout on `await expect(page).toHaveURL(/\/users$/)` (this happens when neither the success URL nor a visible error appeared in 10s).

  If the failure is generic (no quoted error text, no clear timeout source), something is wrong with the diagnostics fixture or the POM — go back and fix.

- [ ] **Step 7.4: Inspect the HTML report**

```powershell
pnpm --filter @sassy-auth/admin-e2e test:e2e:report
```

Expected: a browser opens to `playwright-report/index.html`. For a failed run, click the failing test and confirm these attachments are present:
- `console.log`
- `page-errors.log`
- `network.log`
- `page-snapshot.html`
- `visible-page-text.txt`
- Trace, screenshot, and video (Playwright-native)

For a green run, no attachments — only the trace if enabled. That's correct.

- [ ] **Step 7.5: Diagnostics smoke (proves the fixture works even on a green stack)**

This step deliberately makes the test fail by using a wrong password, so the diagnostics fixture's behavior is verified once explicitly.

Use the Edit tool on `apps/admin-e2e/tests/login.spec.ts` to change ONLY the password constant:

old_string:
```
const SUPER_ADMIN_PASSWORD = 'Pass@word1234'
```

new_string:
```
const SUPER_ADMIN_PASSWORD = 'wrong-password-for-smoke'
```

Run again:

```powershell
pnpm --filter @sassy-auth/admin-e2e test:e2e
```

Expected error message (verbatim text):

```
Login flow rendered an error to the user instead of redirecting: "Invalid email or password."
```

Open the report and confirm `network.log` contains a line like `401 POST http://localhost:3000/api/auth/sign-in/email`.

Then REVERT the password by Editing the file back:

old_string:
```
const SUPER_ADMIN_PASSWORD = 'wrong-password-for-smoke'
```

new_string:
```
const SUPER_ADMIN_PASSWORD = 'Pass@word1234'
```

- [ ] **Step 7.6: Commit**

```powershell
git add apps/admin-e2e/tests/login.spec.ts
git commit -m "feat(admin-e2e): add s@sa.io login spec with error-text-on-failure racing"
```

---

## Task 8: Add the auth-state setup project + `chromium-authed` project

This task wires the `storageState` plumbing so future logged-in specs (`tests/authed/*.spec.ts`) start already authenticated. The `tests/authed/` folder is created empty (with a `.gitkeep`) so the directory survives git.

**Files:**
- Create: `apps/admin-e2e/auth-state.setup.ts`
- Create: `apps/admin-e2e/tests/authed/.gitkeep`
- Modify: `apps/admin-e2e/playwright.config.ts` (projects array only)

- [ ] **Step 8.1: Create the empty `tests/authed/` folder**

Write `apps/admin-e2e/tests/authed/.gitkeep` with an empty body. (Use the Write tool with an empty `content` string.) The folder exists only so future PRs have a home for authed specs.

- [ ] **Step 8.2: Create the setup spec**

Write `apps/admin-e2e/auth-state.setup.ts`:

```ts
import { test as setup, expect } from '@playwright/test'
import { LoginPage } from './pages/login.page'

const AUTH_FILE = '.auth/super-admin.json'

setup('authenticate as super admin', async ({ page }) => {
  const login = new LoginPage(page)
  await login.goto()
  await login.signIn('s@sa.io', 'Pass@word1234')
  await expect(page).toHaveURL(/\/users$/)
  await page.context().storageState({ path: AUTH_FILE })
})
```

Note: this file imports `test` from `@playwright/test` directly (not from `lib/fixtures`) — the setup project does not need the diagnostics fixture, and Playwright requires setup specs to use the bare `test` API.

- [ ] **Step 8.3: Update `playwright.config.ts` to add the two new projects**

Use the Edit tool on `apps/admin-e2e/playwright.config.ts`:

old_string:
```
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
```

new_string:
```
  projects: [
    {
      name: 'setup',
      testMatch: /auth-state\.setup\.ts/,
    },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      // No dependencies — login.spec.ts must exercise the real /login flow,
      // not start from a pre-set session.
      testIgnore: /authed\/.*\.spec\.ts/,
    },
    {
      name: 'chromium-authed',
      use: {
        ...devices['Desktop Chrome'],
        storageState: '.auth/super-admin.json',
      },
      dependencies: ['setup'],
      testMatch: /authed\/.*\.spec\.ts/,
    },
  ],
```

- [ ] **Step 8.4: Type-check**

```powershell
pnpm --filter @sassy-auth/admin-e2e exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 8.5: Run the full suite (proves setup runs and `chromium-authed` skips silently)**

```powershell
pnpm --filter @sassy-auth/admin-e2e test:e2e
```

Expected (on a green stack):
- Setup project runs the `authenticate as super admin` step and passes.
- File `apps/admin-e2e/.auth/super-admin.json` exists after the run (`Test-Path .\apps\admin-e2e\.auth\super-admin.json` returns True).
- The `chromium` project runs the login spec.
- The `chromium-authed` project runs zero tests (correct — it has none yet).
- Final line: `2 passed` (the setup test + the login test).

If Playwright errors about "No tests found," it's because the `chromium-authed` `testMatch` accidentally matches nothing AND a filter narrowed the run. In a default invocation that should not happen — re-read the config diff.

- [ ] **Step 8.6: Commit**

```powershell
git add apps/admin-e2e/auth-state.setup.ts apps/admin-e2e/tests/authed/.gitkeep apps/admin-e2e/playwright.config.ts
git commit -m "feat(admin-e2e): add setup project + chromium-authed for future logged-in specs"
```

---

## Task 9: Wire Turborepo

**Files:**
- Modify: `turbo.json`

- [ ] **Step 9.1: Read the current `turbo.json`**

Use the Read tool. Current shape (3 tasks: `build`, `test`, `dev`).

- [ ] **Step 9.2: Add a `test:e2e` task**

Use the Edit tool on `turbo.json`:

old_string:
```
    "test": {
      "dependsOn": ["^build"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    }
```

new_string:
```
    "test": {
      "dependsOn": ["^build"]
    },
    "test:e2e": {
      "dependsOn": ["^build"],
      "cache": false,
      "env": ["CI_TESTS", "ADMIN_URL", "AUTH_SERVER_URL", "DATABASE_URL", "BETTER_AUTH_URL", "BETTER_AUTH_SECRET", "RSA_PRIVATE_KEY", "RSA_PUBLIC_KEY"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    }
```

The `env` array tells Turborepo which env vars influence the task, so cache keys reflect them. `cache: false` is set because e2e outputs are non-deterministic.

- [ ] **Step 9.3: Verify `turbo test` does NOT include the e2e package**

```powershell
pnpm exec turbo run test --dry-run
```

Expected: the output lists tasks for packages that have a `test` script (`@sassy-auth/admin`, `@sassy-auth/auth-server`, etc.) but NOT `@sassy-auth/admin-e2e` (which only has `test:e2e`).

- [ ] **Step 9.4: Verify `turbo test:e2e --filter=@sassy-auth/admin-e2e` finds it**

```powershell
pnpm exec turbo run test:e2e --filter=@sassy-auth/admin-e2e --dry-run
```

Expected: the output lists one task — `@sassy-auth/admin-e2e#test:e2e`.

- [ ] **Step 9.5: Commit**

```powershell
git add turbo.json
git commit -m "chore(turbo): add test:e2e task scoped to admin-e2e package"
```

---

## Task 10: Add the `README.md`

**Files:**
- Create: `apps/admin-e2e/README.md`

- [ ] **Step 10.1: Create the file**

Write `apps/admin-e2e/README.md`:

````markdown
# @sassy-auth/admin-e2e

Playwright end-to-end tests for the SassyAuth admin UI (`apps/admin`).

## Local development

The suite assumes the stack is already running and the DB has been seeded.

### One-time setup

```powershell
# Install Chromium binary
pnpm --filter @sassy-auth/admin-e2e install:browsers

# Seed the platform admins (idempotent — safe to re-run)
pnpm --filter @sassy-auth/auth-server seed
```

### Each test run

```powershell
# Terminal 1 — start Postgres + both apps
pnpm dev

# Terminal 2 — run the e2e suite
pnpm --filter @sassy-auth/admin-e2e test:e2e
```

### Debugging a failure

```powershell
# Open the last HTML report in a browser
pnpm --filter @sassy-auth/admin-e2e test:e2e:report

# Re-run with the inspector UI for live debugging
pnpm --filter @sassy-auth/admin-e2e test:e2e:ui

# Re-run with a visible browser window
pnpm --filter @sassy-auth/admin-e2e test:e2e:headed
```

Failure artifacts attached per failing test:

- Trace (full timeline of every action, network call, DOM snapshot)
- Screenshot at the moment of failure
- Video of the run
- `console.log` — every `console.*` call from the page
- `page-errors.log` — unhandled JS exceptions with stack traces
- `network.log` — every HTTP 4xx/5xx and request failure
- `page-snapshot.html` — full DOM at moment of failure
- `visible-page-text.txt` — text-only view of the page

## CI

GitHub Actions runs the suite via `.github/workflows/e2e.yml`. The workflow:

1. Spins up a Postgres 16 service container.
2. Runs Prisma migrations and the platform-admin seed.
3. Generates a fresh RSA keypair (base64-encoded into `RSA_PRIVATE_KEY` / `RSA_PUBLIC_KEY`).
4. Installs the Chromium browser binary.
5. Runs `pnpm --filter @sassy-auth/admin-e2e test:e2e` with `CI_TESTS=true`.

`CI_TESTS=true` flips `playwright.config.ts` into CI mode:

- The `webServer` block spawns both apps (otherwise they must be started manually).
- `retries: 2`, `workers: 1`, `forbidOnly: true`.
- HTML reporter is on (uploaded as the `playwright-report` artifact).

## Project layout

| Path | Responsibility |
|---|---|
| `playwright.config.ts` | Three projects: `setup`, `chromium`, `chromium-authed`. Conditional `webServer`. |
| `auth-state.setup.ts` | The `setup` project's only spec — signs in once and persists `storageState` to `.auth/super-admin.json`. |
| `pages/login.page.ts` | `LoginPage` Page Object Model — locators + actions for `/login`. |
| `lib/i18n.ts` | Dot-path lookup against `apps/admin/messages/en.json`. |
| `lib/fixtures.ts` | Auto-applied diagnostics fixture; re-exports `test` and `expect`. |
| `tests/login.spec.ts` | First spec — `s@sa.io` signs in, redirects to `/users`. Races URL vs. rendered error so UI errors become the failure reason. |
| `tests/authed/` | Reserved for future logged-in specs that opt into the `chromium-authed` project. |

## Adding a new test

- **Public flow** (login, accept-invite, error paths): add to `tests/*.spec.ts`. Runs in the bare `chromium` project. Import `test` and `expect` from `../lib/fixtures` so the diagnostics fixture is active.
- **Logged-in flow** (anything inside the `(admin)` route group): add to `tests/authed/*.spec.ts`. Runs in `chromium-authed` with the super-admin session pre-loaded. Import `test` and `expect` from `../../lib/fixtures`.
````

- [ ] **Step 10.2: Commit**

```powershell
git add apps/admin-e2e/README.md
git commit -m "docs(admin-e2e): add README"
```

---

## Task 11: Add the GitHub Actions workflow

**Files:**
- Create: `.github/workflows/e2e.yml`

This task is the only one that cannot be fully verified locally — the workflow is exercised by a push to GitHub. Verification happens in Task 12.

- [ ] **Step 11.1: Confirm `.github/workflows/` exists**

```powershell
Test-Path .github\workflows
```

Expected: `True`. If False, create the directory before writing the file:

```powershell
New-Item -ItemType Directory -Force .github\workflows | Out-Null
```

- [ ] **Step 11.2: Create the workflow**

Write `.github/workflows/e2e.yml`:

```yaml
name: e2e

on:
  pull_request:
    branches: [master]
  push:
    branches: [master]
  workflow_dispatch: {}

concurrency:
  group: e2e-${{ github.ref }}
  cancel-in-progress: true

jobs:
  admin-e2e:
    runs-on: ubuntu-latest
    timeout-minutes: 20

    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: sassy
          POSTGRES_PASSWORD: sassy
          POSTGRES_DB: sassy_e2e
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U sassy -d sassy_e2e"
          --health-interval 5s
          --health-timeout 3s
          --health-retries 10

    env:
      CI_TESTS: 'true'
      DATABASE_URL: postgresql://sassy:sassy@localhost:5432/sassy_e2e
      BETTER_AUTH_URL: http://localhost:3000
      BETTER_AUTH_SECRET: test-secret-at-least-32-chars-long!!
      AUTH_SERVER_URL: http://localhost:3000
      ADMIN_URL: http://localhost:3001
      NODE_ENV: test

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - name: Install deps
        run: pnpm install --frozen-lockfile

      - name: Generate Prisma client
        run: pnpm --filter @sassy-auth/db exec prisma generate --schema=schema.prisma

      - name: Apply migrations
        run: pnpm --filter @sassy-auth/db exec prisma migrate deploy --schema=schema.prisma

      - name: Generate RSA keypair for auth-server
        run: |
          mkdir -p ./keys
          openssl genpkey -algorithm RSA -out ./keys/private.pem -pkeyopt rsa_keygen_bits:2048
          openssl rsa -in ./keys/private.pem -pubout -out ./keys/public.pem
          echo "RSA_PRIVATE_KEY=$(base64 -w0 ./keys/private.pem)" >> $GITHUB_ENV
          echo "RSA_PUBLIC_KEY=$(base64 -w0 ./keys/public.pem)" >> $GITHUB_ENV

      - name: Seed platform data
        run: pnpm --filter @sassy-auth/auth-server seed

      - name: Install Playwright browsers
        run: pnpm --filter @sassy-auth/admin-e2e exec playwright install --with-deps chromium

      - name: Run e2e
        run: pnpm --filter @sassy-auth/admin-e2e test:e2e

      - name: Upload Playwright report
        if: ${{ !cancelled() }}
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: apps/admin-e2e/playwright-report/
          retention-days: 14

      - name: Upload test results (traces, videos, attachments)
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-test-results
          path: apps/admin-e2e/test-results/
          retention-days: 14
```

- [ ] **Step 11.3: Lint the workflow with `gh` if available**

```powershell
gh workflow view e2e.yml
```

If `gh` complains the workflow file does not yet exist on the default branch, that's fine — it's not pushed. The check we want is YAML validity, which a push will surface. Move on.

- [ ] **Step 11.4: Commit**

```powershell
git add .github/workflows/e2e.yml
git commit -m "ci: add e2e workflow with Postgres service container and CI_TESTS=true"
```

---

## Task 12: End-to-end verification & PR

- [ ] **Step 12.1: Confirm working tree is clean**

```powershell
git status
```

Expected: `nothing to commit, working tree clean`. If untracked files remain (e.g., `.auth/super-admin.json`, `test-results/`, `playwright-report/`), confirm they match patterns in `apps/admin-e2e/.gitignore` — they should not appear as untracked.

- [ ] **Step 12.2: Local no-stack check (verifies the conditional `webServer` gate)**

Stop both apps and Postgres. Then:

```powershell
pnpm --filter @sassy-auth/admin-e2e test:e2e
```

Expected: the suite fails fast with a connection error from the first page action (something like `net::ERR_CONNECTION_REFUSED` for `http://localhost:3001`). What you are verifying is that Playwright did NOT spawn the apps locally (because `CI_TESTS` is unset). If the test instead waited 120s for a `webServer` start, the conditional gate is broken — re-read `playwright.config.ts`.

Bring the stack back up (`pnpm dev`) before continuing.

- [ ] **Step 12.3: Local CI-mode dry-run (optional but informative)**

This step is local proof that the `CI_TESTS=true` path works without GitHub Actions in the loop.

Stop both apps if they're running. Then:

```powershell
$env:CI_TESTS='true'; pnpm --filter @sassy-auth/admin-e2e test:e2e; Remove-Item Env:\CI_TESTS
```

Expected: Playwright spawns auth-server and admin via the `webServer` block, waits for both health-check URLs, then runs the suite. This proves the CI config is functional independent of GitHub Actions.

Note: this requires Postgres to be running locally (the `webServer` block does NOT spawn Postgres — see the spec). If Postgres is down, auth-server will fail to boot and Playwright will time out waiting for `/api/token/jwks`.

- [ ] **Step 12.4: Push and open PR**

```powershell
git push -u origin <branch-name>
gh pr create --title "feat(admin-e2e): add Playwright e2e suite with login spec and CI workflow" --body "$(cat <<'EOF'
## Summary
- New `apps/admin-e2e/` workspace package with Playwright.
- First spec: `s@sa.io` signs in at `/login`, expected redirect to `/users`.
- Auto-diagnostics fixture: console, page errors, network 4xx/5xx, DOM snapshot, visible-text dump all attached on failure.
- `setup` project persists `storageState` to `.auth/super-admin.json` for future logged-in specs (`tests/authed/`).
- One production-side change: `data-testid="login-error"` on the admin login form's error `<p>`.
- GitHub Actions workflow runs the suite with `CI_TESTS=true` (Playwright spawns both apps; Postgres is a service container).

Design spec: `docs/superpowers/specs/2026-05-28-playwright-e2e-design.md`
Implementation plan: `docs/superpowers/plans/2026-05-28-playwright-e2e.md`

## Test plan
- [ ] `pnpm --filter @sassy-auth/admin-e2e test:e2e` runs locally with `pnpm dev` up
- [ ] Wrong password → failure quotes "Invalid email or password." and `network.log` shows the 401
- [ ] CI workflow uploads `playwright-report/` (always) and `test-results/` (on failure)
- [ ] `turbo test` does not invoke the e2e suite; `turbo test:e2e --filter=@sassy-auth/admin-e2e` does
EOF
)"
```

- [ ] **Step 12.5: Observe CI**

```powershell
gh pr checks --watch
```

Expected: the `e2e / admin-e2e` job runs. Possible outcomes:

  **A. CI job succeeds:** login test passes against a freshly-seeded CI Postgres. Done.

  **B. CI job fails on the login test only:** download the `playwright-report` artifact and inspect the attached `network.log`, `page-snapshot.html`, and the thrown error message. This is the expected diagnostic experience — the suite did its job by quoting the user-facing error. File a follow-up issue from those diagnostics.

  **C. CI job fails before the login test (migrate / seed / RSA key step):** check the failing step's log. Most likely:
  - `pnpm --filter @sassy-auth/db exec prisma generate --schema=schema.prisma` fails because the prisma schema is named differently → adjust the `--schema=` argument.
  - Seed step fails because `apps/auth-server/src/seed/seed.ts` requires an env var not set on the job → identify the missing var from the seed source and add it to the workflow's `env:` block. This is exactly the "additional env vars" caveat called out in the spec.

---

## Self-review

(Run mentally against the spec — no agent dispatch.)

**Spec coverage check:** every "In scope" bullet from `docs/superpowers/specs/2026-05-28-playwright-e2e-design.md` maps to at least one task:

| Spec item | Task(s) |
|---|---|
| New workspace package | Task 1 |
| Playwright config with conditional `webServer` | Task 6 |
| `chromium-authed` + setup project (`storageState`) | Task 8 |
| `LoginPage` POM | Task 4 |
| i18n helper | Task 3 |
| Auto diagnostics fixture | Task 5 |
| First spec (login → /users) | Task 7 |
| `data-testid="login-error"` on admin login | Task 2 |
| GitHub Actions workflow | Task 11 |
| Turborepo wiring | Task 9 |

**"Explicitly NOT in scope" check:** the plan does not add tests beyond `login.spec.ts`, does not add WebKit/Firefox, does not add visual regression, does not add Sentry DSN, does not centralize credentials. Consistent with the spec.

**Type / name consistency:**
- `LoginPage` is used in Task 4 (definition), Task 7 (login spec), and Task 8 (setup spec) — all three import it consistently.
- `anyErrorMessage` is the locator name in Task 4 and is the name referenced in Task 7. Consistent.
- `t()` from `lib/i18n.ts` (Task 3) is the export the POM uses in Task 4. Consistent.
- `test` and `expect` re-exported from `lib/fixtures.ts` (Task 5) are the imports in `tests/login.spec.ts` (Task 7). Consistent. Note: `auth-state.setup.ts` (Task 8) imports `test as setup` from `@playwright/test` directly — this is intentional and called out in Task 8 Step 8.2.
- The setup project (Task 8) writes `storageState` to `.auth/super-admin.json` and the `chromium-authed` project reads from the same path. Consistent.

**Placeholder scan:** no `TBD` / `TODO` / "implement later." Two intentional pivot points in Task 12 Step 12.5 (option C: adjust `--schema=` if needed; add missing env vars from seed source) are framed as "diagnose the failing log" rather than "implement later" — these are knowable unknowns the spec explicitly flagged.

**Bite-sized check:** every step is one action with exact files and exact commands. No "while you're there" scope creep.
