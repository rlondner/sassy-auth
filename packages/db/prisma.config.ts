import { defineConfig } from 'prisma/config';

// bug-0280: packages/db/index.ts fails fast when DATABASE_URL is unset so
// the app gets a clear error instead of an opaque connection failure. This
// config file feeds the same env var to the Prisma CLI (`generate`,
// `migrate deploy`, etc. all resolve their datasource here now that the
// CLI's implicit env/schema resolution is gone in v7) and had no equivalent
// guard — an unset DATABASE_URL surfaced as a generic Prisma CLI error with
// no pointer to the actual cause instead of this message.
//
// `generate` only reads schema.prisma and never opens a connection, but this
// config file is loaded for every CLI command — including `generate` from
// packages/db's postinstall hook, which runs on every `pnpm install`. Don't
// require a real DATABASE_URL for that case, or a bare install breaks in any
// environment (CI, fresh clone) where it isn't set yet.
const isGenerateOnly = process.argv.includes('generate');

if (!process.env.DATABASE_URL && !isGenerateOnly) {
  throw new Error('DATABASE_URL is not set');
}

export default defineConfig({
  schema: 'schema.prisma',
  migrations: {
    path: 'migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? 'postgresql://generate:generate@localhost:5432/generate',
  },
});
