import { config as loadEnv } from 'dotenv';
import { resolve } from 'path';
loadEnv({ path: resolve(process.cwd(), '../../.env.local') });
import './instrument';
import 'reflect-metadata';
import express from 'express';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { toNodeHandler } from 'better-auth/node';
import { AppModule } from './app.module';
import { auth, TRUSTED_ORIGINS } from './auth/auth.config';
import { createDefaultAuthRateLimiter } from './auth/auth-rate-limit';
import { runWithPrivateRelayCapture } from './social/apple-private-relay-context';
import { configureNestApp } from './configure-nest-app';
import { LoggerService } from './common/logger/logger.service';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { mergeOpenApiDocs } from './docs/openapi';
import { BETTER_AUTH_SESSION_COOKIE } from './common/constants';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg = require('../package.json');

// bug-0115: fail fast on missing / unparseable `BETTER_AUTH_URL`.
// Previously an empty or malformed value survived until first request,
// then produced a malformed `issuer` in the OAuth AS discovery doc and
// every JWT's `iss` claim — a silent-but-broken deploy is the worst
// failure mode for an auth-server. Called synchronously at the top of
// bootstrap so a bad config is surfaced by the trailing
// `bootstrap().catch(process.exit(1))` at the bottom of this file
// (bug-0210).
function validateStartupEnv(): void {
  const url = process.env.BETTER_AUTH_URL;
  if (!url || url.trim() === '') {
    throw new Error(
      'BETTER_AUTH_URL is required (empty or unset). Set it to the auth-server\'s public origin (e.g. https://auth.example.com).',
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      `BETTER_AUTH_URL is not a valid URL: ${JSON.stringify(url)}. Expected e.g. https://auth.example.com.`,
    );
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(
      `BETTER_AUTH_URL must use http: or https:, got ${parsed.protocol}. Full value: ${url}.`,
    );
  }
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      'BETTER_AUTH_SECRET must be at least 32 characters (see .env.example). Regenerate with `openssl rand -base64 48`.',
    );
  }
  // bug-0185: ADMIN_URL is used to build invitation emails and the
  // OAuth error redirect. When unset in prod the code silently falls
  // back to http://localhost:3001 and mails invitation links that
  // land on the operator's laptop, not the intended admin console.
  // Warn (don't throw) so the auth-server still starts in dev with no
  // admin console reachable — a common workflow when hacking on the
  // auth-server in isolation.
  if (process.env.NODE_ENV === 'production' && !process.env.ADMIN_URL) {
    console.warn(
      '[bug-0185] ADMIN_URL is unset in production. Invitation emails and OAuth-error redirects will point at http://localhost:3001 — invitees will not be able to accept.',
    );
  }
}

async function bootstrap() {
  validateStartupEnv();
  const expressApp = express();

  // BetterAuth intercepts /api/auth/* before NestJS processes any request.
  //
  // bug-0232: because that interception happens ahead of NestJS, the
  // `ThrottlerGuard` registered as APP_GUARD in app.module.ts never runs for
  // these routes — sign-in/sign-up/magic-link/OTP were entirely unthrottled
  // despite the bug-0080 work. The limiter below runs as plain Express
  // middleware in front of the handler and applies the same 10/min/IP budget
  // as the Nest `auth` bucket to credential-bearing paths only (session reads
  // and sign-out are exempt — the admin console polls them constantly).
  // task-8 fix round 1 (review finding 1): wrap the whole BetterAuth
  // request in an AsyncLocalStorage scope (apple-private-relay-context.ts)
  // so Apple's mapProfileToUser (fired deep inside the /callback/:id
  // endpoint handler, via getUserInfo) can hand `is_private_email` back to
  // this same request's hooks.after matcher, which runs later in the same
  // request but is a separate call made by BetterAuth's own framework code
  // — see apple-private-relay-context.ts for the full mechanism and why the
  // scope must be opened here, spanning the entire request, rather than
  // around any single inner call.
  const authNodeHandler = toNodeHandler(auth);
  // task-13 fix (found live while verifying the federated sign-in button —
  // no prior unit test exercises a real cross-origin browser request against
  // this route, so nothing caught it): `/api/auth/*` is registered directly
  // on the raw Express app, ahead of `NestFactory.create` /
  // `configureNestApp`'s `app.enableCors(...)` below — by the time Nest's
  // CORS middleware exists, this route has already been wired into the
  // handler chain in front of it, so it never runs for these requests.
  // BetterAuth's own `trustedOrigins` (auth.config.ts) is NOT a CORS
  // mechanism either — it only gates an internal Origin-header CSRF check
  // (better-auth/dist/context/create-context.mjs); it never sets
  // `Access-Control-Allow-Origin`. Verified live: an OPTIONS preflight to
  // `/api/auth/sign-in/social` from a cross-origin admin (its own port,
  // e.g. :3001 talking to the auth-server's :3000 — the exact topology
  // TRUSTED_ORIGINS/.env.local already documents as the deployment
  // default) returned a bare 404, and the browser then blocked the actual
  // POST with "No 'Access-Control-Allow-Origin' header is present". That
  // meant the social-buttons.tsx POST/fetch fix (also task-13, also
  // uncommitted) could never succeed against a real cross-origin admin —
  // the same class of "never actually worked" bug that fix's own comment
  // describes for the GET it replaced. Scoped to exactly TRUSTED_ORIGINS,
  // matching the allow-list `configureNestApp` uses for the rest of the API.
  const authCors = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const origin = req.headers.origin;
    if (origin && TRUSTED_ORIGINS.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      res.setHeader(
        'Access-Control-Allow-Headers',
        req.headers['access-control-request-headers'] ?? 'content-type',
      );
      res.statusCode = 204;
      return res.end();
    }
    return next();
  };
  expressApp.all('/api/auth/*', authCors, createDefaultAuthRateLimiter(), (req, res) =>
    runWithPrivateRelayCapture(() => authNodeHandler(req, res)),
  );

  const loggerService = new LoggerService();

  const app = await NestFactory.create(AppModule, new ExpressAdapter(expressApp), {
    logger: loggerService,
  });

  configureNestApp(app, loggerService);

  // Ensure NestJS lifecycle hooks (OnModuleDestroy, OnApplicationShutdown) fire on
  // SIGTERM/SIGINT so Prisma disconnects cleanly and Sentry flushes buffered events.
  app.enableShutdownHooks();

  // bug-0153: Swagger/OpenAPI docs are only mounted outside production.
  // In prod the full API surface must not be publicly discoverable at
  // `/api/docs` and `/api/docs-json`. Anyone who needs the OpenAPI spec
  // in prod should build it from the source (nest CLI) or point a
  // non-prod deploy at production data.
  if (process.env.NODE_ENV !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Sassy Auth API')
      .setDescription('Multi-tenant auth and user management')
      .setVersion(pkg.version)
      .addCookieAuth(
        BETTER_AUTH_SESSION_COOKIE,
        { type: 'apiKey', in: 'cookie' },
        BETTER_AUTH_SESSION_COOKIE,
      )
      .build();

    const nestDoc = SwaggerModule.createDocument(app, swaggerConfig);

    let mergedDoc = nestDoc;
    try {
      const betterAuthDoc = await auth.api.generateOpenAPISchema();
      // bug-0092: BetterAuth's generateOpenAPISchema() returns an
      // OpenAPI-shape object where `OpenAPIParameter.name` is
      // `string | undefined` (its own internal type), while NestJS's
      // `OpenAPIObject` expects `ParameterObject.name: string` (from
      // the OpenAPI spec). The shapes are structurally compatible at
      // runtime — `mergeOpenApiDocs` merges paths / schemas / tags by
      // key without inspecting individual parameter properties — so
      // the cast is a documented type-only reconciliation.
      mergedDoc = mergeOpenApiDocs(nestDoc, betterAuthDoc as unknown as OpenAPIObject);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      loggerService.warn(
        `Failed to fetch BetterAuth OpenAPI schema; serving Nest-only spec. ${message}`,
        'Bootstrap',
      );
    }

    SwaggerModule.setup('api/docs', app, mergedDoc, {
      swaggerOptions: { withCredentials: true, persistAuthorization: true },
      jsonDocumentUrl: 'api/docs-json',
    });
  }

  await app.listen(process.env.PORT ?? 3000);
  loggerService.log(`Auth server listening on port ${process.env.PORT ?? 3000}`, 'Bootstrap');
}

bootstrap().catch((err) => {
  console.error('Fatal: auth-server bootstrap failed', err);
  process.exit(1);
});
