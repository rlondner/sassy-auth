'use strict';
/**
 * print-app-public-id.cjs
 *
 * Reads the publicId for a named SaApp from the database and writes it to a
 * file (no trailing newline).  Exits 1 loudly on any error so CI never
 * silently produces an empty file that causes downstream RS tests to skip.
 *
 * Environment:
 *   APP_NAME  – name column in sa_app (default: 'resourceserver01')
 *   OUT_FILE  – output path            (default: '/tmp/sassy-e2e-rs-client-id.txt')
 *   DATABASE_URL – Prisma connection string (inherited from job env)
 */

const fs = require('fs');
const path = require('path');

const APP_NAME = process.env.APP_NAME || 'resourceserver01';
const OUT_FILE = process.env.OUT_FILE || '/tmp/sassy-e2e-rs-client-id.txt';

// @prisma/client resolves relative to packages/db (this file's cwd when
// invoked via `pnpm --filter @sassy-auth/db exec node scripts/...`).
const { PrismaClient } = require('@prisma/client');

const p = new PrismaClient();

p.saApp.findUnique({ where: { name: APP_NAME } })
  .then((app) => {
    if (!app) {
      process.stderr.write(`[print-app-public-id] ERROR: app '${APP_NAME}' not found in database.\n`);
      process.exit(1);
    }
    if (!app.publicId) {
      process.stderr.write(`[print-app-public-id] ERROR: app '${APP_NAME}' has no publicId.\n`);
      process.exit(1);
    }
    // Ensure parent directory exists.
    const dir = path.dirname(OUT_FILE);
    fs.mkdirSync(dir, { recursive: true });
    // Write without trailing newline so $(cat file) gives a clean value.
    fs.writeFileSync(OUT_FILE, app.publicId, 'utf8');
    process.stdout.write(`[print-app-public-id] Written publicId for '${APP_NAME}' to ${OUT_FILE}\n`);
    process.exit(0);
  })
  .catch((err) => {
    process.stderr.write(`[print-app-public-id] ERROR: ${err.message}\n`);
    process.exit(1);
  })
  .finally(() => p.$disconnect());
