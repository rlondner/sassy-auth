import { INestApplication, ValidationPipe } from '@nestjs/common';
import { TRUSTED_ORIGINS } from './auth/auth.config';
import { SentryExceptionFilter } from './common/filters/sentry-exception.filter';
import { LoggerService } from './common/logger/logger.service';
import { NEST_GLOBAL_PREFIX, OAUTH_AS_METADATA_PATH } from './token/oauth-metadata';

// Shared Nest wiring used by main.ts and the e2e harness so the global prefix,
// pipes, filters, and CORS allow-list can never drift between them. CORS is
// enabled here because BetterAuth (/api/auth/*) is mounted on the underlying
// Express app BEFORE Nest installs middleware, so its own CORS / trustedOrigins
// path is untouched; this layer handles preflight + headers for the rest of
// the /api/* surface (e.g. POST /api/invitations/:token/accept from the admin
// app's accept-invite browser flow).
export function configureNestApp(app: INestApplication, loggerService: LoggerService) {
  // RFC 8414 mandates the OAuth discovery doc be served at the host root, so
  // exclude it from the /api global prefix.
  app.setGlobalPrefix(NEST_GLOBAL_PREFIX, { exclude: [OAUTH_AS_METADATA_PATH] });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new SentryExceptionFilter(loggerService));
  app.enableCors({ origin: TRUSTED_ORIGINS, credentials: true });
}
