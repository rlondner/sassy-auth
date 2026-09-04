import type { NextFunction, Request, Response } from 'express';
import { AUTH_THROTTLE } from '../common/config/rate-limit-config';

// bug-0232: BetterAuth is mounted straight onto the Express app in
// `main.ts` (`expressApp.all('/api/auth/*', toNodeHandler(auth))`),
// which runs *before* NestJS ever sees the request. The `ThrottlerGuard`
// registered as `APP_GUARD` in `app.module.ts` is a Nest guard and only
// executes inside a Nest execution context, so the bug-0080 buckets have
// never covered the primary credential endpoints — `sign-in/email`,
// `sign-up/email`, magic-link and OTP sends. Those are precisely the
// brute-force targets.
//
// This is a deliberately small fixed-window limiter rather than a new
// dependency: it runs as plain Express middleware ahead of the BetterAuth
// handler, so enforcement does not depend on BetterAuth's own
// `rateLimit` defaults (which are off outside production and whose
// semantics change across releases).
//
// Like `@nestjs/throttler` (see the README "Rate limiting uses in-memory
// store" limitation) the counters live in-process: per-replica, not
// global. Wire a shared Redis store when the deployment scales out
// horizontally.

/** Path suffixes (relative to the BetterAuth mount) that carry a credential. */
const SENSITIVE_PREFIXES = [
  '/sign-in',
  '/sign-up',
  '/forget-password',
  '/reset-password',
  '/change-password',
  '/change-email',
  '/magic-link',
  '/email-otp',
  '/two-factor',
];

const MOUNT_PREFIX = '/api/auth';

/**
 * True when `path` addresses a BetterAuth endpoint where guessing a
 * credential (password, OTP, TOTP, reset token) is the attack. Session
 * reads (`get-session`) and `sign-out` are deliberately excluded — the
 * admin console polls them on every navigation.
 */
export function isSensitiveAuthPath(path: string): boolean {
  const withoutQuery = path.split('?')[0];
  const relative = withoutQuery.startsWith(MOUNT_PREFIX)
    ? withoutQuery.slice(MOUNT_PREFIX.length)
    : withoutQuery;
  if (!relative.startsWith('/')) return false;
  return SENSITIVE_PREFIXES.some(
    (prefix) => relative === prefix || relative.startsWith(`${prefix}/`),
  );
}

export interface AuthRateLimitOptions {
  windowMs: number;
  max: number;
  /** Injectable clock — the tests drive the window without real timers. */
  now?: () => number;
}

export interface AuthRateLimiter {
  (req: Request, res: Response, next: NextFunction): void;
  /** Number of live buckets — exposed so the eviction behaviour is testable. */
  size(): number;
}

interface Bucket {
  count: number;
  windowStart: number;
}

/**
 * Resolve the client identity. `req.ips` is populated by Express only when
 * `trust proxy` is configured, in which case its left-most entry is the
 * original client; otherwise fall back to the socket address.
 */
function clientKey(req: Request): string {
  const forwarded = Array.isArray(req.ips) && req.ips.length > 0 ? req.ips[0] : undefined;
  return forwarded ?? req.ip ?? 'unknown';
}

export function createAuthRateLimiter(options: AuthRateLimitOptions): AuthRateLimiter {
  const { windowMs, max, now = () => Date.now() } = options;
  const buckets = new Map<string, Bucket>();

  // Drop buckets that are two windows stale. Without this an attacker
  // rotating source IPs would grow the map unbounded — a memory-exhaustion
  // vector on the very endpoint we are trying to protect.
  function evictExpired(currentTime: number): void {
    for (const [key, bucket] of buckets) {
      if (currentTime - bucket.windowStart >= windowMs * 2) {
        buckets.delete(key);
      }
    }
  }

  const limiter = ((req: Request, res: Response, next: NextFunction): void => {
    const path = req.path ?? req.originalUrl ?? '';
    if (!isSensitiveAuthPath(path)) {
      next();
      return;
    }

    const currentTime = now();
    evictExpired(currentTime);

    // One shared bucket per client across every sensitive path, so a
    // brute-forcer cannot multiply their budget by alternating endpoints.
    const key = clientKey(req);
    const bucket = buckets.get(key);

    if (!bucket || currentTime - bucket.windowStart >= windowMs) {
      buckets.set(key, { count: 1, windowStart: currentTime });
      next();
      return;
    }

    if (bucket.count < max) {
      bucket.count += 1;
      next();
      return;
    }

    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((bucket.windowStart + windowMs - currentTime) / 1000),
    );
    res.setHeader('Retry-After', retryAfterSeconds);
    // Opaque body: revealing which bucket tripped, or how much budget is
    // left, hands the attacker a tuning signal.
    res.status(429).json({
      statusCode: 429,
      message: 'Too many requests. Please try again later.',
      error: 'Too Many Requests',
    });
  }) as AuthRateLimiter;

  limiter.size = () => buckets.size;
  return limiter;
}

/**
 * Bucket sizes mirror the Nest `auth` throttler bucket from bug-0080
 * (10/min/IP by default). Reads the same AUTH_THROTTLE config (backed by
 * AUTH_RATE_LIMIT / AUTH_RATE_WINDOW_MS, and disabled under `NODE_ENV=test`
 * for the same reason the Nest buckets are: the e2e suite hammers sign-in
 * repeatedly) rather than hardcoding its own numbers — this middleware sits
 * in front of BetterAuth and previously ignored those env vars entirely,
 * so raising AUTH_RATE_LIMIT for local e2e runs had no effect here.
 */
export function createDefaultAuthRateLimiter(): AuthRateLimiter {
  return createAuthRateLimiter({
    windowMs: AUTH_THROTTLE.ttl,
    max: AUTH_THROTTLE.limit,
  });
}
