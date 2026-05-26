import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
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

    response.status(status).json({
      statusCode: status,
      message,
      error,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
