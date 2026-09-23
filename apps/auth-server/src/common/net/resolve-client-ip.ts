/**
 * Resolve the real client IP behind Render's one proxy hop. `req.ips` is
 * populated by Express only when `trust proxy` is configured (main.ts's
 * bootstrap() does this) — in which case its left-most entry is the
 * original client; otherwise fall back to the socket address. Mirrors
 * auth-rate-limit.ts's (now-shared) clientKey logic.
 */
export function resolveClientIp(req: { ips?: string[]; ip?: string }): string {
  const forwarded = Array.isArray(req.ips) && req.ips.length > 0 ? req.ips[0] : undefined;
  return forwarded ?? req.ip ?? 'unknown';
}
