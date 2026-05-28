import 'dotenv/config';
import './instrument';
import 'reflect-metadata';
import express from 'express';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { toNodeHandler } from 'better-auth/node';
import { AppModule } from './app.module';
import { auth } from './auth/auth.config';
import { SentryExceptionFilter } from './common/filters/sentry-exception.filter';
import { LoggerService } from './common/logger/logger.service';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { mergeOpenApiDocs } from './docs/openapi';
import { BETTER_AUTH_SESSION_COOKIE } from './common/constants';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg = require('../package.json');

async function bootstrap() {
  const expressApp = express();

  // BetterAuth intercepts /api/auth/* before NestJS processes any request.
  expressApp.all('/api/auth/*', toNodeHandler(auth));

  const loggerService = new LoggerService();

  const app = await NestFactory.create(AppModule, new ExpressAdapter(expressApp), {
    logger: loggerService,
  });

  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new SentryExceptionFilter(loggerService));

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
    mergedDoc = mergeOpenApiDocs(nestDoc, betterAuthDoc);
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

  await app.listen(process.env.PORT ?? 3000);
  loggerService.log(`Auth server listening on port ${process.env.PORT ?? 3000}`, 'Bootstrap');
}

bootstrap();
