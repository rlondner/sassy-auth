#!/usr/bin/env bash
#
# Production entrypoint for the auth-server image.
# Runs Prisma migrations when DATABASE_URL is set, then starts the compiled app.
#
set -euo pipefail

log() { printf '→ %s\n' "$*"; }

if [ -n "${DATABASE_URL:-}" ]; then
  log "Applying database migrations"
  cd /app/packages/db
  npx prisma migrate deploy
else
  log "DATABASE_URL unset — skipping migrations"
fi

cd /app/apps/auth-server
log "Starting auth-server"
exec node dist/main.js
