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
