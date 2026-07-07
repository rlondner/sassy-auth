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
import { auth } from './auth/auth.config';
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
}

async function bootstrap() {
  validateStartupEnv();
  const expressApp = express();

  // BetterAuth intercepts /api/auth/* before NestJS processes any request.
  expressApp.all('/api/auth/*', toNodeHandler(auth));

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
