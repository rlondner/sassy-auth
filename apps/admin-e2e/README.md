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
| `tests/signup.spec.ts` | Registration ("/register") flow — via `/signup`, the app's actual registration UI. Skipped unless `RS_CLIENT_ID`/`SASSY_CLIENT_ID` is set, same gate as `rs-round-trip.spec.ts`. |
| `tests/authed/` | Reserved for future logged-in specs that opt into the `chromium-authed` project. |

## Adding a new test

- **Public flow** (login, accept-invite, error paths): add to `tests/*.spec.ts`. Runs in the bare `chromium` project. Import `test` and `expect` from `../lib/fixtures` so the diagnostics fixture is active.
- **Logged-in flow** (anything inside the `(admin)` route group): add to `tests/authed/*.spec.ts`. Runs in `chromium-authed` with the super-admin session pre-loaded. Import `test` and `expect` from `../../lib/fixtures`.
