# syntax=docker/dockerfile:1

# SassyAuth — developer-preview image.
#
# This image runs the same dev servers `pnpm dev` runs. It exists so that
# someone evaluating the project can get to a working token in one command,
# without installing Node, pnpm, or PostgreSQL.
#
# It is NOT a production deployment artifact, and deliberately so:
#
#   * It runs `next dev` / `nest start --watch`, not compiled builds.
#   * It runs two processes in one container.
#   * It runs with NODE_ENV unset (i.e. development). That is load-bearing,
#     not laziness: auth.config.ts sets the session cookie's `secure` flag
#     from `NODE_ENV === 'production'`, and a Secure cookie is not stored by
#     browsers over plain http://localhost — so a "production" container
#     served over http could not be logged into at all.
#
# See README → "Quick Start (Docker)" for what a real deployment would need.

FROM node:24-bookworm-slim

# openssl — required by Prisma's query engine on bookworm-slim.
# curl    — used by the compose healthcheck.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl curl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && apt-get clean

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

# apps/admin-e2e depends on @playwright/test, whose install step would pull
# browser bundles into this image. Nothing here runs a browser — the e2e suite
# runs on the host — so skip the download rather than ship ~400MB of Chromium.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

WORKDIR /app

COPY . .

# packages/db declares `postinstall: prisma generate`, and the generator reads
# `env("DATABASE_URL")` from schema.prisma. Nothing connects to a database at
# build time — this placeholder is parsed and never dialed. Declared as ARG so
# it stays build-time only and cannot mask a missing DATABASE_URL at runtime.
ARG DATABASE_URL="postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder"

RUN pnpm install --frozen-lockfile \
 && pnpm --filter @sassy-auth/db --filter @sassy-auth/types build \
 && chmod +x /app/docker/entrypoint.sh

# 3000 = auth-server (NestJS), 3001 = admin console (Next.js).
EXPOSE 3000 3001

ENTRYPOINT ["/app/docker/entrypoint.sh"]
CMD ["pnpm", "dev"]
