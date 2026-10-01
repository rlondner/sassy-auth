.PHONY: generate migrate migrate-deploy e2e-tests caddy start-auth-server start-admin start-no-watch _run-auth-server _run-admin

generate:
	pnpm --filter @sassy-auth/db run db:generate

migrate:
	pnpm --filter @sassy-auth/db run db:migrate

migrate-deploy:
	pnpm --filter @sassy-auth/db run db:migrate:deploy

# Starts the local Caddy reverse proxy if it isn't already running (no-op otherwise).
caddy:
	powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/start-caddy.ps1

# Builds and starts auth-server with no file-watching (production-style run).
start-auth-server: caddy
	pnpm --filter @sassy-auth/auth-server run build
	pnpm --filter @sassy-auth/auth-server run start

# Builds and starts admin with no file-watching (production-style run).
start-admin: caddy
	pnpm --filter @sassy-auth/admin run build
	pnpm --filter @sassy-auth/admin run start

# Runs both servers without file-watching, behind Caddy. Each target builds
# first since `start` scripts expect a prior build; run in parallel so both
# servers come up concurrently once Caddy is confirmed running.
start-no-watch: 
	pnpm --filter @sassy-auth/auth-server run build
	pnpm --filter @sassy-auth/admin run build
	$(MAKE) -j2 _run-auth-server _run-admin

_run-auth-server:
	pnpm --filter @sassy-auth/auth-server run start

_run-admin:
	pnpm --filter @sassy-auth/admin run start

# Assumes the stack is already running and seeded (see apps/admin-e2e/README.md):
#   pnpm dev  (Postgres + admin + auth-server), plus the platform-admin seed.
e2e-tests:
	pnpm --filter @sassy-auth/admin-e2e run test:e2e
