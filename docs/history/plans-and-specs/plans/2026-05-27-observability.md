# Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add structured logging (Winston) and error tracking (Sentry) to the NestJS auth server and Next.js admin console, with trace correlation between the two.

**Architecture:** Winston wraps NestJS's built-in logger, outputting JSON to stdout (prod) and pretty-print + file transports (dev). Sentry captures unhandled exceptions via a global NestJS filter and the Next.js SDK. OpenTelemetry is provided by Sentry's Node SDK — no separate collector. A request ID middleware ties logs and Sentry events together.

**Tech Stack:** Winston, @sentry/nestjs, @sentry/nextjs, uuid (for request IDs)

---

## Task 1: Install backend dependencies & add `.gitignore` entry

**Files:**
- Modify: `apps/auth-server/package.json`
- Modify: `.gitignore`

- [ ] **Step 1: Install Winston and Sentry packages in auth-server**

```bash
cd apps/auth-server && pnpm add winston @sentry/nestjs @sentry/node uuid && pnpm add -D @types/uuid
```

- [ ] **Step 2: Add `logs/` to root `.gitignore`**

Append to `.gitignore`:

```
logs/
```

- [ ] **Step 3: Commit**

```bash
git add apps/auth-server/package.json pnpm-lock.yaml .gitignore
git commit -m "chore: add winston, sentry, uuid deps to auth-server"
```

---

## Task 2: Winston configuration & NestJS logger adapter

**Files:**
- Create: `apps/auth-server/src/common/logger/winston.config.ts`
- Create: `apps/auth-server/src/common/logger/logger.service.ts`
- Create: `apps/auth-server/src/common/logger/logger.service.spec.ts`

- [ ] **Step 1: Write the test for LoggerService**

Create `apps/auth-server/src/common/logger/logger.service.spec.ts`:

```typescript
import { LoggerService } from './logger.service';

// Capture Winston transport output
let logOutput: any[] = [];

jest.mock('./winston.config', () => {
  const { transports, createLogger, format } = jest.requireActual('winston');
  const transport = new transports.Console({ silent: true });
  const original = transport.log.bind(transport);
  transport.log = (info: any, callback: () => void) => {
    logOutput.push(info);
    original(info, callback);
  };
  return {
    createAppLogger: () =>
      createLogger({
        level: 'debug',
        format: format.combine(format.timestamp(), format.json()),
        transports: [transport],
      }),
  };
});

describe('LoggerService', () => {
  let logger: LoggerService;

  beforeEach(() => {
    logOutput = [];
    logger = new LoggerService();
  });

  it('logs info messages with context', () => {
    logger.log('hello world', 'TestContext');
    expect(logOutput).toHaveLength(1);
    expect(logOutput[0]).toMatchObject({
      level: 'info',
      message: 'hello world',
      context: 'TestContext',
    });
  });

  it('logs error messages with stack trace', () => {
    logger.error('something broke', 'stack-trace-here', 'TestContext');
    expect(logOutput).toHaveLength(1);
    expect(logOutput[0]).toMatchObject({
      level: 'error',
      message: 'something broke',
      stack: 'stack-trace-here',
      context: 'TestContext',
    });
  });

  it('logs warn messages', () => {
    logger.warn('watch out', 'TestContext');
    expect(logOutput).toHaveLength(1);
    expect(logOutput[0].level).toBe('warn');
  });

  it('logs debug messages', () => {
    logger.debug('detailed info', 'TestContext');
    expect(logOutput).toHaveLength(1);
    expect(logOutput[0].level).toBe('debug');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/auth-server && npx jest src/common/logger/logger.service.spec.ts --no-coverage
```

Expected: FAIL — `Cannot find module './winston.config'`

- [ ] **Step 3: Create Winston configuration**

Create `apps/auth-server/src/common/logger/winston.config.ts`:

```typescript
import * as winston from 'winston';
import * as path from 'path';

const isProduction = process.env.NODE_ENV === 'production';
const logLevel = process.env.LOG_LEVEL ?? (isProduction ? 'info' : 'debug');

const jsonFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json(),
);

const prettyFormat = winston.format.combine(
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, context, traceId, requestId, stack, ...meta }) => {
    const ctx = context ? ` [${context}]` : '';
    const ids = [traceId && `traceId=${traceId}`, requestId && `requestId=${requestId}`]
      .filter(Boolean)
      .join(' ');
    const suffix = ids ? ` | ${ids}` : '';
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    const line = `[${timestamp}] ${level.toUpperCase()}${ctx} ${message}${suffix}${metaStr}`;
    return stack ? `${line}\n${stack}` : line;
  }),
);

export function createAppLogger(): winston.Logger {
  const transports: winston.transport[] = [
    new winston.transports.Console({
      format: isProduction ? jsonFormat : prettyFormat,
    }),
  ];

  // Dev-only file transports
  if (!isProduction) {
    const logsDir = path.resolve(process.cwd(), 'logs');
    transports.push(
      new winston.transports.File({
        filename: path.join(logsDir, 'error.log'),
        level: 'error',
        format: jsonFormat,
      }),
      new winston.transports.File({
        filename: path.join(logsDir, 'combined.log'),
        format: jsonFormat,
      }),
    );
  }

  return winston.createLogger({
    level: logLevel,
    defaultMeta: {},
    transports,
  });
}
```

- [ ] **Step 4: Create NestJS LoggerService adapter**

Create `apps/auth-server/src/common/logger/logger.service.ts`:

```typescript
import { Injectable, LoggerService as NestLoggerService } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { createAppLogger } from './winston.config';

const logger = createAppLogger();

@Injectable()
export class LoggerService implements NestLoggerService {
  log(message: string, context?: string) {
    logger.info(message, { context });
  }

  error(message: string, stack?: string, context?: string) {
    const sentryEventId = Sentry.lastEventId();
    logger.error(message, { context, stack, ...(sentryEventId && { sentryEventId }) });
  }

  warn(message: string, context?: string) {
    logger.warn(message, { context });
  }

  debug(message: string, context?: string) {
    logger.debug(message, { context });
  }

  verbose(message: string, context?: string) {
    logger.verbose(message, { context });
  }

  /** Attach request-scoped metadata to all subsequent log entries in this call chain. */
  child(meta: Record<string, unknown>) {
    return logger.child(meta);
  }

  /** Direct access to the Winston logger for structured logging with extra fields. */
  getWinstonLogger() {
    return logger;
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd apps/auth-server && npx jest src/common/logger/logger.service.spec.ts --no-coverage
```

Expected: PASS — all 4 tests green.

- [ ] **Step 6: Commit**

```bash
git add apps/auth-server/src/common/logger/
git commit -m "feat(logging): add Winston config and NestJS LoggerService adapter"
```

---

## Task 3: Request ID middleware

**Files:**
- Create: `apps/auth-server/src/common/middleware/request-id.middleware.ts`
- Create: `apps/auth-server/src/common/middleware/request-id.middleware.spec.ts`

- [ ] **Step 1: Write the test**

Create `apps/auth-server/src/common/middleware/request-id.middleware.spec.ts`:

```typescript
import { RequestIdMiddleware } from './request-id.middleware';
import { Request, Response } from 'express';

describe('RequestIdMiddleware', () => {
  let middleware: RequestIdMiddleware;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  const next = jest.fn();

  beforeEach(() => {
    middleware = new RequestIdMiddleware();
    mockReq = { headers: {} };
    mockRes = { setHeader: jest.fn() };
    next.mockClear();
  });

  it('generates a request ID when none is provided', () => {
    middleware.use(mockReq as Request, mockRes as Response, next);

    expect(mockReq['requestId']).toBeDefined();
    expect(typeof mockReq['requestId']).toBe('string');
    expect(mockRes.setHeader).toHaveBeenCalledWith('X-Request-Id', mockReq['requestId']);
    expect(next).toHaveBeenCalled();
  });

  it('uses existing X-Request-Id header when provided', () => {
    mockReq.headers = { 'x-request-id': 'existing-id-123' };

    middleware.use(mockReq as Request, mockRes as Response, next);

    expect(mockReq['requestId']).toBe('existing-id-123');
    expect(mockRes.setHeader).toHaveBeenCalledWith('X-Request-Id', 'existing-id-123');
    expect(next).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/auth-server && npx jest src/common/middleware/request-id.middleware.spec.ts --no-coverage
```

Expected: FAIL — `Cannot find module './request-id.middleware'`

- [ ] **Step 3: Implement the middleware**

Create `apps/auth-server/src/common/middleware/request-id.middleware.ts`:

```typescript
import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const requestId = (req.headers['x-request-id'] as string) ?? uuidv4();
    req.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    next();
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd apps/auth-server && npx jest src/common/middleware/request-id.middleware.spec.ts --no-coverage
```

Expected: PASS — both tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/common/middleware/
git commit -m "feat(logging): add RequestIdMiddleware for X-Request-Id tracking"
```

---

## Task 4: Request logging middleware

**Files:**
- Create: `apps/auth-server/src/common/logger/request-logging.middleware.ts`
- Create: `apps/auth-server/src/common/logger/request-logging.middleware.spec.ts`

- [ ] **Step 1: Write the test**

Create `apps/auth-server/src/common/logger/request-logging.middleware.spec.ts`:

```typescript
import { RequestLoggingMiddleware } from './request-logging.middleware';
import { Request, Response } from 'express';

// Capture log calls
const mockInfo = jest.fn();
const mockWarn = jest.fn();
const mockChild = jest.fn().mockReturnValue({ info: mockInfo, warn: mockWarn });

jest.mock('./logger.service', () => ({
  LoggerService: jest.fn().mockImplementation(() => ({
    getWinstonLogger: () => ({ child: mockChild }),
  })),
}));

describe('RequestLoggingMiddleware', () => {
  let middleware: RequestLoggingMiddleware;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let endCallback: () => void;

  beforeEach(() => {
    jest.clearAllMocks();
    const { LoggerService } = require('./logger.service');
    middleware = new RequestLoggingMiddleware(new LoggerService());

    mockReq = {
      method: 'GET',
      originalUrl: '/api/users',
      requestId: 'req-123',
    };
    mockRes = {
      statusCode: 200,
      on: jest.fn((event: string, cb: () => void) => {
        if (event === 'finish') endCallback = cb;
      }),
    } as any;
  });

  it('logs completed requests at info level for 2xx status', () => {
    const next = jest.fn();
    middleware.use(mockReq as Request, mockRes as Response, next);
    expect(next).toHaveBeenCalled();

    // Simulate response finish
    endCallback();

    expect(mockChild).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'req-123' }),
    );
    expect(mockInfo).toHaveBeenCalledWith(
      expect.stringContaining('GET /api/users'),
    );
  });

  it('logs 4xx/5xx responses at warn level', () => {
    mockRes.statusCode = 500;
    const next = jest.fn();
    middleware.use(mockReq as Request, mockRes as Response, next);
    endCallback();

    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining('GET /api/users'),
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/auth-server && npx jest src/common/logger/request-logging.middleware.spec.ts --no-coverage
```

Expected: FAIL — `Cannot find module './request-logging.middleware'`

- [ ] **Step 3: Implement request logging middleware**

Create `apps/auth-server/src/common/logger/request-logging.middleware.ts`:

```typescript
import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { LoggerService } from './logger.service';

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
      const message = `${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`;

      if (res.statusCode >= 400) {
        childLogger.warn(message);
      } else {
        childLogger.info(message);
      }
    });

    next();
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd apps/auth-server && npx jest src/common/logger/request-logging.middleware.spec.ts --no-coverage
```

Expected: PASS — both tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/common/logger/request-logging.middleware.ts apps/auth-server/src/common/logger/request-logging.middleware.spec.ts
git commit -m "feat(logging): add HTTP request logging middleware"
```

---

## Task 5: Sentry initialization & global exception filter

**Files:**
- Create: `apps/auth-server/src/instrument.ts`
- Create: `apps/auth-server/src/common/filters/sentry-exception.filter.ts`
- Create: `apps/auth-server/src/common/filters/sentry-exception.filter.spec.ts`

- [ ] **Step 1: Create Sentry initialization file**

Create `apps/auth-server/src/instrument.ts`:

```typescript
import * as Sentry from '@sentry/nestjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
  integrations: [Sentry.prismaIntegration()],
});
```

- [ ] **Step 2: Write the test for SentryExceptionFilter**

Create `apps/auth-server/src/common/filters/sentry-exception.filter.spec.ts`:

```typescript
import { SentryExceptionFilter } from './sentry-exception.filter';
import { HttpException, HttpStatus, ArgumentsHost } from '@nestjs/common';

// Mock Sentry
jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
  withScope: jest.fn((cb) => cb({ setExtra: jest.fn(), setTag: jest.fn() })),
}));

import * as Sentry from '@sentry/nestjs';

// Mock LoggerService
const mockError = jest.fn();
jest.mock('../logger/logger.service', () => ({
  LoggerService: jest.fn().mockImplementation(() => ({
    error: mockError,
  })),
}));

describe('SentryExceptionFilter', () => {
  let filter: SentryExceptionFilter;
  let mockJson: jest.Mock;
  let mockStatus: jest.Mock;
  let mockHost: ArgumentsHost;

  beforeEach(() => {
    jest.clearAllMocks();
    const { LoggerService } = require('../logger/logger.service');
    filter = new SentryExceptionFilter(new LoggerService());

    mockJson = jest.fn();
    mockStatus = jest.fn().mockReturnValue({ json: mockJson });
    mockHost = {
      switchToHttp: () => ({
        getResponse: () => ({ status: mockStatus }),
        getRequest: () => ({ url: '/api/test', method: 'GET', requestId: 'req-abc' }),
      }),
    } as unknown as ArgumentsHost;
  });

  it('returns standardized JSON for HttpException', () => {
    const exception = new HttpException('Not found', HttpStatus.NOT_FOUND);
    filter.catch(exception, mockHost);

    expect(mockStatus).toHaveBeenCalledWith(404);
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 404,
        message: 'Not found',
        path: '/api/test',
      }),
    );
  });

  it('does NOT send 4xx HttpExceptions to Sentry', () => {
    const exception = new HttpException('Bad request', HttpStatus.BAD_REQUEST);
    filter.catch(exception, mockHost);

    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('sends 5xx HttpExceptions to Sentry', () => {
    const exception = new HttpException('Server error', HttpStatus.INTERNAL_SERVER_ERROR);
    filter.catch(exception, mockHost);

    expect(Sentry.captureException).toHaveBeenCalledWith(exception);
  });

  it('sends non-HttpException errors to Sentry', () => {
    const exception = new Error('unexpected crash');
    filter.catch(exception, mockHost);

    expect(Sentry.captureException).toHaveBeenCalledWith(exception);
    expect(mockStatus).toHaveBeenCalledWith(500);
  });

  it('logs all exceptions via LoggerService', () => {
    const exception = new Error('boom');
    filter.catch(exception, mockHost);

    expect(mockError).toHaveBeenCalledWith(
      expect.stringContaining('boom'),
      expect.any(String),
      'ExceptionFilter',
    );
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd apps/auth-server && npx jest src/common/filters/sentry-exception.filter.spec.ts --no-coverage
```

Expected: FAIL — `Cannot find module './sentry-exception.filter'`

- [ ] **Step 4: Implement the Sentry exception filter**

Create `apps/auth-server/src/common/filters/sentry-exception.filter.ts`:

```typescript
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import * as Sentry from '@sentry/nestjs';
import { LoggerService } from '../logger/logger.service';

@Catch()
export class SentryExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: LoggerService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status: number;
    let message: string;
    let error: string;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
        error = HttpStatus[status] ?? 'Error';
      } else if (typeof body === 'object' && body !== null) {
        const b = body as Record<string, unknown>;
        message = Array.isArray(b['message'])
          ? (b['message'] as string[]).join(', ')
          : String(b['message'] ?? exception.message);
        error = String(b['error'] ?? HttpStatus[status] ?? 'Error');
      } else {
        message = exception.message;
        error = HttpStatus[status] ?? 'Error';
      }
    } else {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = 'Internal server error';
      error = 'INTERNAL_SERVER_ERROR';
    }

    // Log every exception
    const stack = exception instanceof Error ? exception.stack : undefined;
    this.logger.error(
      `${request.method} ${request.url} ${status} — ${message}`,
      stack ?? '',
      'ExceptionFilter',
    );

    // Only send 5xx and non-HttpException errors to Sentry
    const shouldReport =
      !(exception instanceof HttpException) || status >= 500;

    if (shouldReport) {
      Sentry.withScope((scope) => {
        scope.setExtra('requestId', request.requestId);
        scope.setExtra('path', request.url);
        scope.setTag('status', String(status));
        Sentry.captureException(exception);
      });
    }

    response.status(status).json({
      statusCode: status,
      message,
      error,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd apps/auth-server && npx jest src/common/filters/sentry-exception.filter.spec.ts --no-coverage
```

Expected: PASS — all 5 tests green.

- [ ] **Step 6: Commit**

```bash
git add apps/auth-server/src/instrument.ts apps/auth-server/src/common/filters/sentry-exception.filter.ts apps/auth-server/src/common/filters/sentry-exception.filter.spec.ts
git commit -m "feat(sentry): add Sentry init and SentryExceptionFilter"
```

---

## Task 6: Wire logging & Sentry into NestJS bootstrap

**Files:**
- Modify: `apps/auth-server/src/main.ts`
- Modify: `apps/auth-server/src/common/common.module.ts`
- Modify: `apps/auth-server/src/app.module.ts`

- [ ] **Step 1: Update `main.ts` to import Sentry first and use Winston logger**

Replace the entire contents of `apps/auth-server/src/main.ts` with:

```typescript
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
```

- [ ] **Step 2: Register LoggerService and middlewares in CommonModule**

Replace the entire contents of `apps/auth-server/src/common/common.module.ts` with:

```typescript
import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { SqidService } from './sqid/sqid.service';
import { LoggerService } from './logger/logger.service';
import { RequestIdMiddleware } from './middleware/request-id.middleware';
import { RequestLoggingMiddleware } from './logger/request-logging.middleware';

@Global()
@Module({
  providers: [SqidService, LoggerService],
  exports: [SqidService, LoggerService],
})
export class CommonModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(RequestIdMiddleware, RequestLoggingMiddleware)
      .forRoutes('*');
  }
}
```

- [ ] **Step 3: Register SentryModule in AppModule**

Replace the entire contents of `apps/auth-server/src/app.module.ts` with:

```typescript
import { Module } from '@nestjs/common';
import { SentryModule } from '@sentry/nestjs/setup';
import { AuthModule } from './auth/auth.module';
import { TokenModule } from './token/token.module';
import { CommonModule } from './common/common.module';
import { UsersModule } from './users/users.module';
import { InvitationsModule } from './invitations/invitations.module';
import { OrgsModule } from './orgs/orgs.module';
import { RolesModule } from './roles/roles.module';

@Module({
  imports: [SentryModule.forRoot(), CommonModule, AuthModule, TokenModule, UsersModule, InvitationsModule, OrgsModule, RolesModule],
})
export class AppModule {}
```

- [ ] **Step 4: Delete the old HttpExceptionFilter**

The old filter at `apps/auth-server/src/common/filters/http-exception.filter.ts` is no longer referenced. Delete it:

```bash
rm apps/auth-server/src/common/filters/http-exception.filter.ts
```

- [ ] **Step 5: Run all backend tests to verify nothing is broken**

```bash
cd apps/auth-server && npx jest --no-coverage
```

Expected: All existing tests pass. The old `HttpExceptionFilter` import may appear in test files — if so, update those imports to `SentryExceptionFilter` (see step 6).

- [ ] **Step 6: Fix any broken test imports**

If any test file imports `HttpExceptionFilter`, update it to import `SentryExceptionFilter` from `'../common/filters/sentry-exception.filter'` and pass a `new LoggerService()` to its constructor.

- [ ] **Step 7: Commit**

```bash
git add apps/auth-server/src/main.ts apps/auth-server/src/common/common.module.ts apps/auth-server/src/app.module.ts apps/auth-server/src/common/filters/
git commit -m "feat(logging): wire Winston + Sentry into NestJS bootstrap"
```

---

## Task 7: Add structured auth event logging to TokenController

**Files:**
- Modify: `apps/auth-server/src/token/token.controller.ts`
- Modify: `apps/auth-server/src/token/token.module.ts` (if LoggerService not already available via CommonModule global)

- [ ] **Step 1: Add logging to TokenController**

Add `LoggerService` injection and auth event logs. Modify `apps/auth-server/src/token/token.controller.ts`:

Add import at the top:

```typescript
import * as Sentry from '@sentry/nestjs';
import { LoggerService } from '../common/logger/logger.service';
```

Add `LoggerService` to the constructor:

```typescript
constructor(
  private readonly tokenService: TokenService,
  private readonly oauthService: OauthService,
  private readonly sqidService: SqidService,
  private readonly logger: LoggerService,
) {}
```

In `oauthAuthorize`, after the redirect URL is built (before `return`), add:

```typescript
this.logger.log('OAuth code issued');
this.logger.getWinstonLogger().info('OAuth authorization code issued', {
  context: 'TokenController',
  appId: clientId,
  userId: saUser.publicId,
});
Sentry.setTag('authFlow', 'oauth');
Sentry.setTag('appId', clientId);
```

Remove the `this.logger.log('OAuth code issued');` line (it was a placeholder). The final addition is just:

```typescript
this.logger.getWinstonLogger().info('OAuth authorization code issued', {
  context: 'TokenController',
  appId: clientId,
  userId: saUser.publicId,
});
Sentry.setTag('authFlow', 'oauth');
Sentry.setTag('appId', clientId);
```

In `oauthToken`, after the token is issued (before `return`), add:

```typescript
this.logger.getWinstonLogger().info('OAuth code exchanged, JWT issued', {
  context: 'TokenController',
  appId: appPublicId,
  userId: userPublicId,
});
```

In `directLogin`, after the JWT is issued (before `return`), add:

```typescript
this.logger.getWinstonLogger().info('Direct login successful, JWT issued', {
  context: 'TokenController',
  identifierType: detectIdentifierType(dto.identifier),
  appId: dto.appId,
  userId: saUser.publicId,
});
Sentry.setUser({ id: saUser.publicId });
Sentry.setTag('authFlow', 'direct');
Sentry.setTag('appId', dto.appId);
```

At each `throw new UnauthorizedException` in `directLogin`, add a warning log just before the throw:

```typescript
this.logger.getWinstonLogger().warn('Direct login failed: invalid credentials', {
  context: 'TokenController',
  identifierType: detectIdentifierType(dto.identifier),
  appId: dto.appId,
});
```

- [ ] **Step 2: Run backend tests**

```bash
cd apps/auth-server && npx jest --no-coverage
```

Expected: All tests pass. The `TokenController` test file creates the controller via NestJS Test module — `LoggerService` is available globally from `CommonModule`, but in tests it may need to be provided. If tests fail, add `LoggerService` to the test module's providers.

- [ ] **Step 3: Fix any test failures**

If `token.controller.spec.ts` fails because `LoggerService` is not provided, add it to the test module:

```typescript
import { LoggerService } from '../common/logger/logger.service';

// In the Test.createTestingModule providers array:
{ provide: LoggerService, useValue: { log: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(), getWinstonLogger: () => ({ info: jest.fn(), warn: jest.fn(), child: jest.fn() }) } },
```

- [ ] **Step 4: Commit**

```bash
git add apps/auth-server/src/token/token.controller.ts apps/auth-server/src/token/
git commit -m "feat(logging): add structured auth event logging to TokenController"
```

---

## Task 8: Add structured logging to UsersService

**Files:**
- Modify: `apps/auth-server/src/users/users.service.ts`

- [ ] **Step 1: Add LoggerService injection and event logging**

Add import at the top of `apps/auth-server/src/users/users.service.ts`:

```typescript
import { LoggerService } from '../common/logger/logger.service';
```

Update the constructor:

```typescript
constructor(
  private readonly sqids: SqidService,
  private readonly logger: LoggerService,
) {}
```

Add log statements to key operations. After each successful mutation, add structured logging:

In `createUser`, after the transaction completes (after `const baseUrl` line, before `return`):

```typescript
this.logger.getWinstonLogger().info('User created', {
  context: 'UsersService',
  userId: saUser.publicId,
  orgId: dto.orgId,
  email: dto.email,
});
```

In `updateUser`, after the update completes (before `return formatUser(updated)`):

```typescript
const changedFields = Object.keys(dto).filter((k) => dto[k] !== undefined);
this.logger.getWinstonLogger().info('User updated', {
  context: 'UsersService',
  userId: publicId,
  changedFields,
});
```

In `deleteUser`, after the delete (before end of method):

```typescript
this.logger.getWinstonLogger().info('User deleted', {
  context: 'UsersService',
  userId: publicId,
});
```

In `assignRole`, after the create (before end of method):

```typescript
this.logger.getWinstonLogger().info('Role assigned to user', {
  context: 'UsersService',
  userId: userPublicId,
  roleId: dto.roleId,
});
```

In `removeRole`, after the delete (before end of method):

```typescript
this.logger.getWinstonLogger().info('Role removed from user', {
  context: 'UsersService',
  userId: userPublicId,
  roleId: rolePublicId,
});
```

In `resendInvitation`, after the new invitation is created (before `return`):

```typescript
this.logger.getWinstonLogger().info('Invitation resent', {
  context: 'UsersService',
  userId: userPublicId,
});
```

- [ ] **Step 2: Run backend tests**

```bash
cd apps/auth-server && npx jest --no-coverage
```

Expected: All tests pass. If `users.service.spec.ts` fails, add `LoggerService` mock to its test module (same pattern as Task 7 Step 3).

- [ ] **Step 3: Commit**

```bash
git add apps/auth-server/src/users/users.service.ts
git commit -m "feat(logging): add structured event logging to UsersService"
```

---

## Task 9: Add structured logging to InvitationsService

**Files:**
- Modify: `apps/auth-server/src/invitations/invitations.service.ts`

- [ ] **Step 1: Add LoggerService injection and event logging**

Add import at the top of `apps/auth-server/src/invitations/invitations.service.ts`:

```typescript
import { LoggerService } from '../common/logger/logger.service';
```

Add constructor with injection (the service currently has no constructor):

```typescript
constructor(private readonly logger: LoggerService) {}
```

In `acceptInvitation`, after the transaction completes (after `});` closing the `$transaction`), add:

```typescript
this.logger.getWinstonLogger().info('Invitation accepted', {
  context: 'InvitationsService',
  userId: inv.user.publicId ?? String(inv.user.id),
});
```

- [ ] **Step 2: Run backend tests**

```bash
cd apps/auth-server && npx jest --no-coverage
```

Expected: All tests pass. If `invitations.service.spec.ts` fails, add `LoggerService` mock to its test module:

```typescript
{ provide: LoggerService, useValue: { getWinstonLogger: () => ({ info: jest.fn(), warn: jest.fn() }) } },
```

- [ ] **Step 3: Commit**

```bash
git add apps/auth-server/src/invitations/invitations.service.ts
git commit -m "feat(logging): add structured event logging to InvitationsService"
```

---

## Task 10: Add env vars to `.env.example`

> **Note on `logs/traces.log`:** The spec mentions writing OTel spans to a local file when `SENTRY_DSN` is not set. Sentry's bundled OTel SDK does not expose a simple file exporter. If this is needed later, it can be added by installing `@opentelemetry/exporter-logs-otlp-http` and a custom `FileSpanExporter`. For now, Sentry traces in dev are viewable via the Sentry dev dashboard (free tier) or by setting `SENTRY_DSN` to a dev project. Deferring `traces.log` to a follow-up task.

**Files:**
- Modify: `apps/auth-server/.env.example` (or root `.env.example`)

- [ ] **Step 1: Add observability env vars**

Append to the `.env.example` file:

```
# ── Observability ─────────────────────────────────────────
SENTRY_DSN=                    # Sentry DSN (leave blank to disable in dev)
SENTRY_ENVIRONMENT=            # Override environment name (defaults to NODE_ENV)
LOG_LEVEL=                     # debug | info | warn | error (defaults: debug in dev, info in prod)
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs: add observability env vars to .env.example"
```

---

## Task 11: Install frontend dependencies & Sentry Next.js setup

**Files:**
- Modify: `apps/admin/package.json`
- Create: `apps/admin/sentry.client.config.ts`
- Create: `apps/admin/sentry.server.config.ts`
- Create: `apps/admin/sentry.edge.config.ts`
- Create: `apps/admin/instrumentation.ts`
- Modify: `apps/admin/next.config.ts`

- [ ] **Step 1: Install Sentry Next.js SDK**

```bash
cd apps/admin && pnpm add @sentry/nextjs
```

- [ ] **Step 2: Create `sentry.client.config.ts`**

Create `apps/admin/sentry.client.config.ts`:

```typescript
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
  replaysOnErrorSampleRate: 0,
  replaysSessionSampleRate: 0,
});
```

- [ ] **Step 3: Create `sentry.server.config.ts`**

Create `apps/admin/sentry.server.config.ts`:

```typescript
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
});
```

- [ ] **Step 4: Create `sentry.edge.config.ts`**

Create `apps/admin/sentry.edge.config.ts`:

```typescript
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
});
```

- [ ] **Step 5: Create `instrumentation.ts`**

Create `apps/admin/instrumentation.ts`:

```typescript
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}
```

- [ ] **Step 6: Wrap `next.config.ts` with Sentry**

Replace `apps/admin/next.config.ts` with:

```typescript
import type { NextConfig } from 'next'
import { withSentryConfig } from '@sentry/nextjs'
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./i18n/request.ts')

const nextConfig: NextConfig = {
  transpilePackages: ['@sassy-auth/ui'],
}

export default withSentryConfig(withNextIntl(nextConfig), {
  silent: true,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  disableSourceMapUpload: !process.env.SENTRY_AUTH_TOKEN,
})
```

- [ ] **Step 7: Commit**

```bash
git add apps/admin/package.json apps/admin/sentry.client.config.ts apps/admin/sentry.server.config.ts apps/admin/sentry.edge.config.ts apps/admin/instrumentation.ts apps/admin/next.config.ts pnpm-lock.yaml
git commit -m "feat(admin): add Sentry Next.js SDK setup and instrumentation"
```

---

## Task 12: Add frontend error boundaries

**Files:**
- Create: `apps/admin/app/global-error.tsx`
- Create: `apps/admin/app/(admin)/error.tsx`

- [ ] **Step 1: Create `global-error.tsx`**

Create `apps/admin/app/global-error.tsx`:

```tsx
'use client'

import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <html>
      <body>
        <div style={{ padding: '2rem', textAlign: 'center', fontFamily: 'sans-serif' }}>
          <h2>Something went wrong</h2>
          <p>An unexpected error occurred. The issue has been reported.</p>
          <button
            onClick={reset}
            style={{
              marginTop: '1rem',
              padding: '0.5rem 1rem',
              borderRadius: '0.375rem',
              border: '1px solid #d1d5db',
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  )
}
```

- [ ] **Step 2: Create `(admin)/error.tsx`**

Create `apps/admin/app/(admin)/error.tsx`:

```tsx
'use client'

import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
      <h2 className="text-xl font-semibold">Something went wrong</h2>
      <p className="text-muted-foreground">An unexpected error occurred. The issue has been reported.</p>
      <button
        onClick={reset}
        className="px-4 py-2 rounded-md border border-border hover:bg-muted transition-colors"
      >
        Try again
      </button>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/admin/app/global-error.tsx apps/admin/app/\(admin\)/error.tsx
git commit -m "feat(admin): add global and admin error boundaries with Sentry reporting"
```

---

## Task 13: Add Sentry breadcrumbs to admin actions

**Files:**
- Modify: `apps/admin/app/login/actions.ts`
- Modify: `apps/admin/app/(admin)/actions.ts`
- Modify: `apps/admin/lib/api.ts`

- [ ] **Step 1: Add breadcrumbs to login action**

Modify `apps/admin/app/login/actions.ts` — add import at the top:

```typescript
import * as Sentry from '@sentry/nextjs'
```

After the `redirect('/users')` line (or just before it, since redirect throws), add Sentry context. The best place is after successful cookie setting, before redirect:

```typescript
Sentry.setUser({ email })
Sentry.addBreadcrumb({
  category: 'auth',
  message: 'Admin login successful',
  level: 'info',
})
```

On the failure paths (each `return { error: ... }`), add:

```typescript
Sentry.addBreadcrumb({
  category: 'auth',
  message: 'Admin login failed',
  level: 'warning',
})
```

- [ ] **Step 2: Add breadcrumbs to admin actions (sign out, locale switch)**

Modify `apps/admin/app/(admin)/actions.ts` — add import at the top:

```typescript
import * as Sentry from '@sentry/nextjs'
```

In `signOutAction`, before `redirect('/login')`:

```typescript
Sentry.addBreadcrumb({
  category: 'auth',
  message: 'Admin signed out',
  level: 'info',
})
```

In `setLocaleAction`, before `redirect(pathname)`:

```typescript
Sentry.addBreadcrumb({
  category: 'ui',
  message: `Locale switched to ${locale}`,
  level: 'info',
})
Sentry.setTag('locale', locale)
```

- [ ] **Step 3: Add breadcrumbs to API wrapper for mutation operations**

Modify `apps/admin/lib/api.ts` — add import at the top:

```typescript
import * as Sentry from '@sentry/nextjs'
```

In `createUser`, after the successful response (before `return`):

```typescript
const result: CreateUserResponse = await res.json()
Sentry.addBreadcrumb({ category: 'admin.action', message: `User created: ${result.user.email}`, level: 'info' })
return result
```

(Replace the existing `return res.json()` with the above.)

In `updateUser`, after the successful response:

```typescript
const result: User = await res.json()
Sentry.addBreadcrumb({ category: 'admin.action', message: `User updated: ${id}`, level: 'info' })
return result
```

In `deleteUser`, after the successful fetch:

```typescript
Sentry.addBreadcrumb({ category: 'admin.action', message: `User deleted: ${id}`, level: 'info' })
```

In `assignRole`, after the successful fetch:

```typescript
Sentry.addBreadcrumb({ category: 'admin.action', message: `Role ${roleId} assigned to user ${userId}`, level: 'info' })
```

In `removeRole`, after the successful fetch:

```typescript
Sentry.addBreadcrumb({ category: 'admin.action', message: `Role ${roleId} removed from user ${userId}`, level: 'info' })
```

In `resendInvitation`, after the successful response:

```typescript
const result = await res.json()
Sentry.addBreadcrumb({ category: 'admin.action', message: `Invitation resent for user ${userId}`, level: 'info' })
return result
```

- [ ] **Step 4: Add Sentry user context in admin layout**

Modify `apps/admin/app/(admin)/layout.tsx` — add import:

```typescript
import * as Sentry from '@sentry/nextjs'
```

After `if (!session?.user) notFound()`, add:

```typescript
Sentry.setUser({ email: session.user.email })
Sentry.setTag('locale', currentLocale)
```

- [ ] **Step 5: Run frontend tests**

```bash
cd apps/admin && npx jest --no-coverage
```

Expected: All tests pass. If any test imports from `lib/api.ts` and fails because `@sentry/nextjs` is not mocked, add a jest mock:

Add to `apps/admin/jest.setup.ts`:

```typescript
jest.mock('@sentry/nextjs', () => ({
  addBreadcrumb: jest.fn(),
  setUser: jest.fn(),
  setTag: jest.fn(),
  captureException: jest.fn(),
  withScope: jest.fn((cb) => cb({ setExtra: jest.fn(), setTag: jest.fn() })),
}));
```

- [ ] **Step 6: Commit**

```bash
git add apps/admin/app/login/actions.ts apps/admin/app/\(admin\)/actions.ts apps/admin/app/\(admin\)/layout.tsx apps/admin/lib/api.ts apps/admin/jest.setup.ts
git commit -m "feat(admin): add Sentry breadcrumbs for admin actions and user context"
```

---

## Task 14: Add admin env vars to `.env.example`

**Files:**
- Modify: `apps/admin/.env.example` or `apps/admin/.env.local.example` (or root `.env.example` if it covers both)

- [ ] **Step 1: Add admin Sentry env vars**

Append to the relevant `.env.example`:

```
# ── Admin Observability ───────────────────────────────────
NEXT_PUBLIC_SENTRY_DSN=        # Sentry DSN for admin console (leave blank to disable in dev)
SENTRY_AUTH_TOKEN=             # Sentry auth token for source map uploads (build-time only)
SENTRY_ORG=                    # Sentry organization slug (build-time only)
SENTRY_PROJECT=                # Sentry project slug (build-time only)
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs: add admin Sentry env vars to .env.example"
```

---

## Task 15: Run full test suite & verify

**Files:** None (verification only)

- [ ] **Step 1: Run all backend tests**

```bash
cd apps/auth-server && npx jest --no-coverage
```

Expected: All tests pass.

- [ ] **Step 2: Run all frontend tests**

```bash
cd apps/admin && npx jest --no-coverage
```

Expected: All tests pass.

- [ ] **Step 3: Verify dev build compiles**

```bash
pnpm build
```

Expected: Both auth-server and admin build successfully.

- [ ] **Step 4: Verify dev mode starts without errors (manual check)**

```bash
pnpm dev
```

Verify:
- Auth server starts and Winston logs appear in console (pretty-print format)
- `logs/combined.log` and `logs/error.log` are created in `apps/auth-server/logs/`
- Admin console starts without Sentry errors (NEXT_PUBLIC_SENTRY_DSN not set = SDK inert)
- Hit `http://localhost:3000/api/token/jwks` and verify request log appears in console

- [ ] **Step 5: Commit any final fixes if needed**

```bash
git add -A && git commit -m "fix: resolve test/build issues from observability integration"
```

Only run this if Step 1-3 required fixes.
