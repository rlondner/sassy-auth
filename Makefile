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
# Routed through `turbo run build` (not `pnpm --filter ... run build`) so an
# unchanged auth-server is a cache hit instead of a full rebuild every time.
start-auth-server: caddy
	pnpm exec turbo run build --filter=@sassy-auth/auth-server
	pnpm --filter @sassy-auth/auth-server run start

# Builds and starts admin with no file-watching (production-style run).
# Same turbo-caching rationale as start-auth-server above.
start-admin: caddy
	pnpm exec turbo run build --filter=@sassy-auth/admin
	pnpm --filter @sassy-auth/admin run start

# Runs both servers without file-watching, behind Caddy. Each target builds
# first since `start` scripts expect a prior build; run in parallel so both
# servers come up concurrently once Caddy is confirmed running.
start-no-watch:
	pnpm exec turbo run build --filter=@sassy-auth/auth-server --filter=@sassy-auth/admin
	$(MAKE) -j2 _run-auth-server _run-admin

_run-auth-server:
	pnpm --filter @sassy-auth/auth-server run start

_run-admin:
	pnpm --filter @sassy-auth/admin run start

# Assumes the stack is already running and seeded (see apps/admin-e2e/README.md):
#   pnpm dev  (Postgres + admin + auth-server), plus the platform-admin seed.
e2e-tests:
	pnpm --filter @sassy-auth/admin-e2e run test:e2e
