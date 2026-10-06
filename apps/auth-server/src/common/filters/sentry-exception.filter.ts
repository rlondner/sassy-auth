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
    // Set only when the thrown exception's response body carries a machine-
    // readable `code` (e.g. `new BadRequestException({ code: 'OTP_EXPIRED' })`
    // — see registration.service.ts's mapOtpError). Previously this field
    // was silently dropped here even though callers already relied on it
    // reaching the client (bug found in a whole-implementation review of the
    // code-first signup wizard: verify-code/complete's OTP error codes never
    // actually reached the browser because this filter rebuilds the entire
    // response body and only ever copied `message`/`error` through).
    let code: string | undefined;

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
        if (typeof b['code'] === 'string') {
          code = b['code'];
        }
      } else {
        message = exception.message;
        error = HttpStatus[status] ?? 'Error';
      }
    } else {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = 'Internal server error';
      error = 'INTERNAL_SERVER_ERROR';
    }

    // Log every exception (use the raw exception message for the log entry)
    const rawMessage =
      exception instanceof Error ? exception.message : message;
    const stack = exception instanceof Error ? exception.stack : undefined;
    this.logger.error(
      `${request.method} ${request.url} ${status} — ${rawMessage}`,
      stack ?? '',
      'ExceptionFilter',
    );

    // Only send 5xx and non-HttpException errors to Sentry
    const shouldReport =
      !(exception instanceof HttpException) || status >= 500;

    if (shouldReport) {
      Sentry.withScope((scope) => {
        scope.setExtra('requestId', (request as Request & { requestId?: string }).requestId);
        scope.setExtra('path', request.url);
        scope.setTag('status', String(status));
        Sentry.captureException(exception);
      });
    }

    response.status(status).json({
      statusCode: status,
      message,
      error,
      ...(code !== undefined && { code }),
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
