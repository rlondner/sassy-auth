import { defineConfig, devices } from '@playwright/test'
import { readFileSync } from 'fs'
import path from 'path'

const CI_TESTS = process.env.CI_TESTS === 'true'
const ADMIN_URL = process.env.ADMIN_URL ?? 'http://localhost:3001'
const AUTH_SERVER_URL = process.env.AUTH_SERVER_URL ?? 'http://localhost:3000'
const RS_BASE_URL = process.env.RS_BASE_URL ?? 'http://localhost:8010'
const STUB_IDP_URL = process.env.E2E_STUB_IDP_URL ?? 'http://localhost:9099'

// task-13: ports for the three local webServer processes below are derived
// from the *_URL constants above rather than hardcoded, so the whole suite
// can be pointed at alternate ports (e.g. when 3000/3001/8010 are already
// bound by an unrelated docker stack on this machine) purely via env vars —
// no source edit needed per run. Two call sites previously hardcoded a
// literal port despite the corresponding *_URL already being configurable:
// `next start --port 3001` (apps/admin/package.json's own `start` script)
// and `uvicorn ... --port 8010` below. Both are worked around here without
// editing admin's package.json: `pnpm --filter @sassy-auth/admin exec next
// start --port <PORT>` calls the local `next` binary directly, bypassing the
// package.json script's own hardcoded flag entirely.
const AUTH_SERVER_PORT = new URL(AUTH_SERVER_URL).port || '3000'
const ADMIN_PORT = new URL(ADMIN_URL).port || '3001'
const RS_PORT = new URL(RS_BASE_URL).port || '8010'

let RS_CLIENT_ID = process.env.RS_CLIENT_ID ?? ''
if (!RS_CLIENT_ID) {
  try {
    RS_CLIENT_ID = readFileSync('/tmp/sassy-e2e-rs-client-id.txt', 'utf8').trim()
  } catch { /* file not written; RS specs skip */ }
}
// Expose for spec files that read process.env.RS_CLIENT_ID
if (RS_CLIENT_ID) {
  process.env.RS_CLIENT_ID = RS_CLIENT_ID
}

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: CI_TESTS,
  retries: CI_TESTS ? 2 : 0,
  // Local: cap at 2 so Next.js dev-mode route compilation doesn't get
  // overwhelmed at cold start (12 parallel first-hit compiles times out
  // the 30s test timeout). CI still serializes.
  workers: CI_TESTS ? 1 : 1,
  timeout: 30_000,
  reporter: CI_TESTS ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: ADMIN_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'setup',
      testDir: '.',
      testMatch: /auth-state\.setup\.ts/,
    },
    {
      // Unauthed flow tests (e.g. login.spec.ts, two-factor.spec.ts).
      // depends on 'setup' so that .auth/super-admin.json exists and is fresh
      // when the admin-reset test's test.use({ storageState }) loads it.
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
      testIgnore: /(authed|matrix)\/.*\.spec\.ts/,
    },
    {
      // Super admin only — existing authed/ flow plus matrix participation.
      name: 'chromium-super',
      use: { ...devices['Desktop Chrome'], storageState: '.auth/super-admin.json' },
      dependencies: ['setup'],
      testMatch: /(authed|matrix)\/.*\.spec\.ts/,
    },
    // The four resource-specific admins participate only in the matrix.
    {
      name: 'chromium-apps',
      use: { ...devices['Desktop Chrome'], storageState: '.auth/apps-admin.json' },
      dependencies: ['setup'],
      testMatch: /matrix\/.*\.spec\.ts/,
    },
    {
      name: 'chromium-orgs',
      use: { ...devices['Desktop Chrome'], storageState: '.auth/orgs-admin.json' },
      dependencies: ['setup'],
      testMatch: /matrix\/.*\.spec\.ts/,
    },
    {
      name: 'chromium-perms',
      use: { ...devices['Desktop Chrome'], storageState: '.auth/perms-admin.json' },
      dependencies: ['setup'],
      testMatch: /matrix\/.*\.spec\.ts/,
    },
    {
      name: 'chromium-users',
      use: { ...devices['Desktop Chrome'], storageState: '.auth/users-admin.json' },
      dependencies: ['setup'],
      testMatch: /matrix\/.*\.spec\.ts/,
    },
  ],
  webServer: CI_TESTS
    ? [
        {
          // task-11: stubProviderConfig (auth-server/src/social/stub-provider.ts)
          // registers the stub OIDC provider ONLY when E2E_STUB_IDP_URL is set
          // AND NODE_ENV is exactly 'test' or 'development' — a positive
          // allowlist, not a `!== 'production'` blocklist, because the stub is a
          // complete auth bypass if it's ever reachable outside test. NODE_ENV is
          // therefore set explicitly here rather than inherited: an unset value
          // would make the allowlist refuse the stub and the federated specs
          // below would fail with "provider not found".
          command: 'pnpm --filter @sassy-auth/auth-server dev',
          url: `${AUTH_SERVER_URL}/api/token/jwks`,
          reuseExistingServer: false,
          timeout: 120_000,
          stdout: 'pipe',
          stderr: 'pipe',
          env: {
            NODE_ENV: 'test',
            E2E_STUB_IDP_URL: STUB_IDP_URL,
            // task-13: without this the auth-server always binds 3000
            // (main.ts: `app.listen(process.env.PORT ?? 3000)`), which
            // breaks AUTH_SERVER_URL-based port overrides.
            PORT: AUTH_SERVER_PORT,
          },
        },
        {
          // task-11: the stub identity provider itself. Must be up before the
          // auth-server's discovery-document fetch on first sign-in attempt, so
          // it's an independent webServer entry rather than something the
          // auth-server spawns; Playwright starts all entries concurrently and
          // waits on each `url` before running tests.
          command: 'node fixtures/stub-idp/server.mjs',
          url: `${STUB_IDP_URL}/.well-known/openid-configuration`,
          reuseExistingServer: false,
          timeout: 30_000,
          stdout: 'pipe',
          stderr: 'pipe',
          env: {
            STUB_IDP_PORT: new URL(STUB_IDP_URL).port || '9099',
            STUB_IDP_ISSUER: STUB_IDP_URL,
          },
        },
        {
          // `next start`, not `next dev`. In dev mode Next compiles each route
          // on first hit, and that compile happens inside the 30s test timeout —
          // which is what made whole groups of specs fail on `page.goto` or on a
          // row-action click, differently on each run. Serving a prebuilt app
          // took the same specs from ~32s timeouts to sub-second.
          //
          // The workflow builds the app in a prior step; `next start` refuses to
          // run without .next, so a missing build fails loudly here rather than
          // silently falling back to dev.
          //
          // NODE_ENV stays `test` (set at the job level) rather than production:
          // the admin sets session cookies `secure` when NODE_ENV is production
          // (login/actions.ts, (admin)/actions.ts) and adds HSTS, and a Secure
          // cookie is never returned over the plain-http localhost origin the
          // suite runs against.
          // task-13: `pnpm --filter @sassy-auth/admin start` runs the
          // package.json `start` script verbatim, which hardcodes
          // `next start --port 3001` — that literal would win over any
          // ADMIN_URL-derived port. Calling `next` directly via `exec`
          // bypasses the script and lets us pass our own --port.
          command: `pnpm --filter @sassy-auth/admin exec next start --port ${ADMIN_PORT}`,
          url: ADMIN_URL,
          reuseExistingServer: false,
          timeout: 120_000,
          stdout: 'pipe',
          stderr: 'pipe',
        },
        {
          command: [
            `SASSY_CLIENT_ID=${RS_CLIENT_ID}`,
            `REDIRECT_URI=${RS_BASE_URL}/auth/callback`,
            `RS_BASE_URL=${RS_BASE_URL}`,
            `AUTH_SERVER_URL=${AUTH_SERVER_URL}`,
            `ADMIN_URL=${ADMIN_URL}`,
            // task-13: was a literal `--port 8010`, which blocked pointing
            // RS_BASE_URL at an alternate port.
            `uvicorn app.main:app --port ${RS_PORT}`,
          ].join(' '),
          // Playwright resolves a relative webServer.cwd against the config
          // directory (apps/admin-e2e), not the repo root — so a repo-relative
          // path would resolve to apps/admin-e2e/apps/resource-server-fastapi
          // (ENOENT) and abort the whole CI e2e run. Resolve from __dirname.
          cwd: path.resolve(__dirname, '../resource-server-fastapi'),
          url: `${RS_BASE_URL}/`,
          reuseExistingServer: false,
          timeout: 60_000,
          stdout: 'pipe',
          stderr: 'pipe',
        },
      ]
    : undefined,
})
