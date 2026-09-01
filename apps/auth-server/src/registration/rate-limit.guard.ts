import { CanActivate, ExecutionContext, HttpException, Injectable } from '@nestjs/common';
import { recordRegistrationRateLimited } from '../telemetry/auth-metrics';

interface WindowEntry {
  count: number;
  windowStart: number;
}

/**
 * Simple in-memory per-IP fixed-window rate limiter.
 *
 * Configuration (via env):
 *   REGISTER_RATE_LIMIT    — max requests per window (default 10; 0 or unset = unlimited for dev)
 *   REGISTER_RATE_WINDOW_MS — window length in ms (default 3600000 = 1 hour)
 *
 * NOTE: This implementation is per-process. In a multi-instance deployment a
 * shared store (Redis, etc.) is required for consistent enforcement across pods.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly store = new Map<string, WindowEntry>();

  private get limit(): number {
    const raw = process.env.REGISTER_RATE_LIMIT;
    if (!raw) return 0; // 0 = unlimited (dev/unset)
    return parseInt(raw, 10);
  }

  private get windowMs(): number {
    const raw = process.env.REGISTER_RATE_WINDOW_MS;
    if (!raw) return 3_600_000; // 1 hour
    return parseInt(raw, 10);
  }

  canActivate(context: ExecutionContext): boolean {
    const limit = this.limit;
    if (!limit) return true; // unlimited when 0 or unset

    const req = context.switchToHttp().getRequest<{ ip?: string; socket?: { remoteAddress?: string }; headers?: Record<string, string> }>();
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';

    const now = Date.now();
    const windowMs = this.windowMs;

    const entry = this.store.get(ip);
    if (!entry || now - entry.windowStart >= windowMs) {
      // First request in this window (or window has expired)
      this.store.set(ip, { count: 1, windowStart: now });
      return true;
    }

    if (entry.count < limit) {
      entry.count += 1;
      return true;
    }

    recordRegistrationRateLimited();
    throw new HttpException('Too many requests', 429);
  }
}
