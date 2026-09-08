/**
 * Client secret assigned to the seeded "E2E OIDC Client" confidential app
 * (src/seed/e2e-oidc-client.ts). Mirrors seed-password.ts: a fixed dev value
 * is only acceptable in development/test, and the well-known default is
 * documented rather than hidden.
 */

/** Documented in task-12-report.md and used by the local dev + CI seeds. */
export const DEV_SEED_CLIENT_SECRET = 'e2e-oidc-dev-secret-CHANGE-ME';

type SeedEnv = Record<string, string | undefined>;

/** Environments where the well-known default is acceptable. */
const DEV_LIKE = new Set(['development', 'test']);

export function resolveSeedClientSecret(env: SeedEnv = process.env): string {
  // E2E_OIDC_CLIENT_SECRET is the pre-existing convention in the Playwright
  // suite (see apps/admin-e2e/playwright.config.ts); honouring it keeps the
  // seeded app and the tests that authenticate against it from drifting apart.
  const explicit = env.SEED_E2E_OIDC_CLIENT_SECRET || env.E2E_OIDC_CLIENT_SECRET;
  if (explicit) return explicit;

  const nodeEnv = env.NODE_ENV ?? 'development';
  if (!DEV_LIKE.has(nodeEnv)) {
    throw new Error(
      `Refusing to seed the E2E OIDC client with the built-in default secret while NODE_ENV=${nodeEnv}. ` +
        'Set SEED_E2E_OIDC_CLIENT_SECRET to the secret the seeded app should use.',
    );
  }

  return DEV_SEED_CLIENT_SECRET;
}
