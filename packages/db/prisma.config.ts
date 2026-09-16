import { defineConfig } from 'prisma/config';

// bug-0280: packages/db/index.ts fails fast when DATABASE_URL is unset so
// the app gets a clear error instead of an opaque connection failure. This
// config file feeds the same env var to the Prisma CLI (`generate`,
// `migrate deploy`, etc. all resolve their datasource here now that the
// CLI's implicit env/schema resolution is gone in v7) and had no equivalent
// guard — an unset DATABASE_URL surfaced as a generic Prisma CLI error with
// no pointer to the actual cause instead of this message.
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set');
}

export default defineConfig({
  schema: 'schema.prisma',
  migrations: {
    path: 'migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
