/**
 * Single source of truth for the two named `@nestjs/throttler` buckets
 * (`default` and `auth`) registered in app.module.ts.
 *
 * bug-0278: `@Throttle({ auth: { limit: 10, ttl: 60_000 } })` on individual
 * routes previously hardcoded those numbers instead of reading
 * AUTH_RATE_LIMIT / AUTH_RATE_WINDOW_MS. Per @nestjs/throttler semantics, an
 * explicit `{ limit, ttl }` on a route's `@Throttle()` call overrides the
 * named bucket's module-level config for that route — it does not merely
 * select the bucket. So every route carrying that hardcoded decorator was
 * silently immune to the env vars introduced to make these limits
 * configurable: changing AUTH_RATE_LIMIT in `.env` had zero effect on
 * `/api/token/direct/login`, `GET /api/token/oauth/authorize`, or the
 * InvitationsController routes.
 *
 * Importing the same computed values here for both the module-level
 * ThrottlerModule.forRoot() config and every per-route @Throttle() override
 * keeps them in sync by construction.
 */
const isTest = process.env.NODE_ENV === 'test';

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export interface ThrottleBucketConfig {
  ttl: number;
  limit: number;
}

// In `test` mode both buckets are effectively disabled so e2e runs (which
// hammer the same endpoints repeatedly) don't trip the limiter.
export const DEFAULT_THROTTLE: ThrottleBucketConfig = isTest
  ? { ttl: 60_000, limit: 10_000 }
  : { ttl: envInt('DEFAULT_RATE_WINDOW_MS', 60_000), limit: envInt('DEFAULT_RATE_LIMIT', 120) };

export const AUTH_THROTTLE: ThrottleBucketConfig = isTest
  ? { ttl: 60_000, limit: 10_000 }
  : { ttl: envInt('AUTH_RATE_WINDOW_MS', 60_000), limit: envInt('AUTH_RATE_LIMIT', 10) };
