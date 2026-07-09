import { defineConfig, devices } from '@playwright/test'

const CI_TESTS = process.env.CI_TESTS === 'true'
const ADMIN_URL = process.env.ADMIN_URL ?? 'http://localhost:3001'
const AUTH_SERVER_URL = process.env.AUTH_SERVER_URL ?? 'http://localhost:3000'

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
      // Unauthed flow tests (e.g. login.spec.ts).
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
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
