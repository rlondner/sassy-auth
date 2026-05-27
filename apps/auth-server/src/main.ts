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

  await app.listen(process.env.PORT ?? 3000);
  loggerService.log(`Auth server listening on port ${process.env.PORT ?? 3000}`, 'Bootstrap');
}

bootstrap();
