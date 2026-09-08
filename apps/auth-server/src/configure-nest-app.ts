import { INestApplication, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { TRUSTED_ORIGINS } from './auth/auth.config';
import { SentryExceptionFilter } from './common/filters/sentry-exception.filter';
import { LoggerService } from './common/logger/logger.service';
import { NEST_GLOBAL_PREFIX, OAUTH_AS_METADATA_PATH, OIDC_METADATA_PATH } from './token/oauth-metadata';

// Shared Nest wiring used by main.ts and the e2e harness so the global prefix,
// pipes, filters, and CORS allow-list can never drift between them. CORS is
// enabled here because BetterAuth (/api/auth/*) is mounted on the underlying
// Express app BEFORE Nest installs middleware, so its own CORS / trustedOrigins
// path is untouched; this layer handles preflight + headers for the rest of
// the /api/* surface (e.g. POST /api/invitations/:token/accept from the admin
// app's accept-invite browser flow).
export function configureNestApp(app: INestApplication, loggerService: LoggerService) {
  // bug-0154: Helmet sets the standard security response headers —
  // X-Content-Type-Options, X-Frame-Options, Strict-Transport-Security,
  // Referrer-Policy, and a default Content-Security-Policy. The auth-
  // server serves JSON to first-party clients, so the strict defaults
  // are fine. The one exception is Swagger UI at /api/docs (see main.ts),
  // whose inline scripts would trip the default CSP; since the docs
  // endpoint is gated behind `NODE_ENV !== 'production'` (bug-0153),
  // the strict CSP is only in effect in prod, where Swagger UI isn't
  // mounted anyway.
  app.use(helmet());
  // RFC 8414 and OIDC Discovery both mandate their well-known documents be
  // served at the host root, so exclude both from the /api global prefix.
  // bug (found by Task 12's e2e proof): OIDC_METADATA_PATH was added in
  // Task 5 but never added here, so /.well-known/openid-configuration was
  // silently served at /api/.well-known/openid-configuration instead —
  // unit/controller tests never caught it because they don't apply the
  // bootstrapped app's global prefix the way main.ts does.
  app.setGlobalPrefix(NEST_GLOBAL_PREFIX, {
    exclude: [OAUTH_AS_METADATA_PATH, OIDC_METADATA_PATH],
  });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new SentryExceptionFilter(loggerService));
  app.enableCors({ origin: TRUSTED_ORIGINS, credentials: true });
}
