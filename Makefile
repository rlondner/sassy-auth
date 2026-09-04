.PHONY: migrate migrate-deploy e2e-tests

migrate:
	pnpm --filter @sassy-auth/db run db:migrate

migrate-deploy:
	pnpm --filter @sassy-auth/db run db:migrate:deploy

# Assumes the stack is already running and seeded (see apps/admin-e2e/README.md):
#   pnpm dev  (Postgres + admin + auth-server), plus the platform-admin seed.
e2e-tests:
	pnpm --filter @sassy-auth/admin-e2e run test:e2e
