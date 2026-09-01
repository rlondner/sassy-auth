#!/usr/bin/env bash
#
# Entrypoint for the SassyAuth developer-preview image.
#
#   1. Generate RS256 signing keys and a BetterAuth secret — once, onto a
#      named volume, so restarts do not invalidate issued tokens or sessions.
#   2. Write /app/.env.local so the Prisma scripts (which load it via
#      dotenv-cli) and auth-server's main.ts (which loads it via dotenv) find
#      the secrets where they already expect them.
#   3. Run migrations and the idempotent seed.
#   4. Hand off to CMD (`pnpm dev`).
#
set -euo pipefail

SECRETS_DIR="${SASSY_SECRETS_DIR:-/secrets}"
SECRETS_FILE="$SECRETS_DIR/generated.env"

log() { printf '\033[36m→ %s\033[0m\n' "$*"; }

# ── 1. Signing material ──────────────────────────────────────────────────────
#
# Generated once and kept on a volume. Regenerating the RSA pair on every boot
# would break every JWT already issued to a resource server, and regenerating
# BETTER_AUTH_SECRET would sign every admin session out — both of which look
# like bugs in SassyAuth rather than a consequence of `docker compose up`.

mkdir -p "$SECRETS_DIR"

if [ ! -f "$SECRETS_FILE" ]; then
  log "First run — generating RS256 key pair and BetterAuth secret"
  node -e '
    const crypto = require("crypto");
    const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    const b64 = (key, type) =>
      Buffer.from(key.export({ type, format: "pem" })).toString("base64");

    process.stdout.write(
      `RSA_PRIVATE_KEY="${b64(privateKey, "pkcs8")}"\n` +
      `RSA_PUBLIC_KEY="${b64(publicKey, "spki")}"\n` +
      `BETTER_AUTH_SECRET="${crypto.randomBytes(32).toString("hex")}"\n`
    );
  ' > "$SECRETS_FILE"
  chmod 600 "$SECRETS_FILE"
else
  log "Reusing signing keys from $SECRETS_FILE"
fi

# ── 2. .env.local ────────────────────────────────────────────────────────────
#
# Only the generated secrets go here. Everything else (DATABASE_URL,
# BETTER_AUTH_URL, ...) arrives as a container environment variable from
# docker-compose.yml, and dotenv does not overwrite variables that are already
# set — so compose stays the single place to change configuration.

cat > /app/.env.local <<EOF
# Written by docker/entrypoint.sh on every boot. Editing this file inside the
# container has no lasting effect — change docker-compose.yml instead.
$(cat "$SECRETS_FILE")
EOF

# ── 3. Schema and seed data ──────────────────────────────────────────────────
#
# compose gates startup on the postgres healthcheck, so the database should be
# accepting connections by now. The retry loop covers the gap between
# "accepting connections" and "ready to serve", which pg_isready can report
# optimistically on a cold volume.

log "Applying database migrations"
for attempt in 1 2 3 4 5; do
  if pnpm --filter @sassy-auth/db db:migrate:deploy; then
    break
  fi
  if [ "$attempt" = "5" ]; then
    echo "Migrations failed after 5 attempts. Is DATABASE_URL correct?" >&2
    exit 1
  fi
  log "Database not ready (attempt $attempt/5) — retrying in 3s"
  sleep 3
done

# The seed is idempotent, so running it on every boot is safe and keeps a
# recreated container consistent with a fresh volume.
log "Seeding platform data"
pnpm --filter @sassy-auth/db db:seed

cat <<'BANNER'

  SassyAuth is starting.

    Admin console   http://localhost:3001/login
    Auth server     http://localhost:3000
    API docs        http://localhost:3000/api/docs

    Sign in as      s@sa.io / Pass@word1234

  That password is a published default for local evaluation. Never expose
  this container to a network you do not control.

BANNER

exec "$@"
