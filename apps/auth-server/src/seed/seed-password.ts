/**
 * Password assigned to every account created by the seed scripts.
 *
 * The seed provisions platform admins — including the super admin `s@sa.io` —
 * so a hardcoded default is a documented credential for anyone who runs the
 * seed against a real deployment. The default is therefore only available in
 * development and test; production seeding must supply a password explicitly.
 */

/** Documented in the README and used by the local dev + CI seeds. */
export const DEV_SEED_PASSWORD = 'Pass@word1234';

type SeedEnv = Record<string, string | undefined>;

/** Environments where the well-known default is acceptable. */
const DEV_LIKE = new Set(['development', 'test']);

export function resolveSeedPassword(env: SeedEnv = process.env): string {
  // E2E_ADMIN_PASSWORD is the pre-existing convention in the Playwright suite
  // (see apps/admin-e2e/lib/admins.ts); honouring it keeps the seeded accounts
  // and the tests that sign into them from drifting apart.
  const explicit = env.SEED_ADMIN_PASSWORD || env.E2E_ADMIN_PASSWORD;
  if (explicit) return explicit;

  // An unset NODE_ENV is treated as unsafe, not as a synonym for
  // "development" — defaulting the unset case to the permissive branch would
  // mean any deployment that simply forgets to set NODE_ENV (a common gap in
  // bare `node`/container/PaaS invocations) silently provisions every
  // platform admin, including the super admin, with the publicly documented
  // password. Local development declares itself via NODE_ENV=development in
  // .env.example/.env.local; anything else must be explicit too.
  const nodeEnv = env.NODE_ENV;
  if (!nodeEnv || !DEV_LIKE.has(nodeEnv)) {
    throw new Error(
      `Refusing to seed with the built-in default password while NODE_ENV=${nodeEnv ?? '(unset)'}. ` +
        'Set SEED_ADMIN_PASSWORD to the password the seeded admin accounts should use.',
    );
  }

  return DEV_SEED_PASSWORD;
}
