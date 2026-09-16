import * as fs from 'fs';
import * as path from 'path';

// bug-0290: the mkcert dev certificates this resolves are gitignored and
// generated per-machine (see README → "Local HTTPS certificates"), so they
// are absent on a fresh clone, in CI (`NODE_ENV=test`), and in the Docker
// image — all of which hit the isDev branch below. main.ts used to call
// fs.readFileSync unconditionally and crash the whole process with an
// uncaught ENOENT before the server could bind at all. Split into its own
// module (rather than living inline in main.ts) so this can be unit tested
// without triggering main.ts's top-level `bootstrap().catch(...)` call,
// which needs a live Postgres connection.
export function resolveHttpsOptions(
  isDev: boolean,
  secretsDir: string,
): { key: Buffer; cert: Buffer } | undefined {
  if (!isDev) return undefined;
  const keyPath = path.join(secretsDir, 'localhost-key.pem');
  const certPath = path.join(secretsDir, 'localhost.pem');
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
  }
  console.warn(
    `[bug-0290] Dev TLS certificates not found at ${secretsDir} — starting over plain HTTP. ` +
      'Run the mkcert setup in README → "Local HTTPS certificates" to serve dev over https://localhost:3010.',
  );
  return undefined;
}
