import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { LoggerService } from './logger.service';

// Path segments that are bearer credentials and must never reach a log
// shipper. Tokens are replaced with the literal `:token` so the route
// shape is still useful for analytics.
const SENSITIVE_PATH_PATTERNS: Array<{ pattern: RegExp; replacement: string }> =
  [
    {
      pattern: /^(\/api\/invitations\/)[^/?#]+/,
      replacement: '$1:token',
    },
  ];

// Query-string keys whose VALUE may leak credentials. Anything in this set
// is replaced by `[REDACTED]` in the logged URL.
const SENSITIVE_QUERY_KEYS = new Set([
  'token',
  'code',
  'state',
  'password',
  'access_token',
  'refresh_token',
  'client_secret',
  'secret',
  'authorization',
]);

export function sanitizeUrlForLog(originalUrl: string): string {
  // Split path vs query
  const queryIdx = originalUrl.indexOf('?');
  let path = queryIdx >= 0 ? originalUrl.slice(0, queryIdx) : originalUrl;
  const query = queryIdx >= 0 ? originalUrl.slice(queryIdx + 1) : '';

  for (const { pattern, replacement } of SENSITIVE_PATH_PATTERNS) {
    path = path.replace(pattern, replacement);
  }

  if (!query) return path;
  const scrubbedPairs = query.split('&').map((pair) => {
    const eq = pair.indexOf('=');
    const key = eq >= 0 ? pair.slice(0, eq) : pair;
    if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) {
      return `${key}=[REDACTED]`;
    }
    return pair;
  });
  return `${path}?${scrubbedPairs.join('&')}`;
}

@Injectable()
export class RequestLoggingMiddleware implements NestMiddleware {
  constructor(private readonly loggerService: LoggerService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const start = Date.now();

    const childLogger = this.loggerService.getWinstonLogger().child({
      requestId: req.requestId,
      context: 'HTTP',
    });

    res.on('finish', () => {
      const duration = Date.now() - start;
      const sanitizedUrl = sanitizeUrlForLog(req.originalUrl);
      const message = `${req.method} ${sanitizedUrl} ${res.statusCode} ${duration}ms`;

      if (res.statusCode >= 400) {
        childLogger.warn(message);
      } else {
        childLogger.info(message);
      }
    });

    next();
  }
}
