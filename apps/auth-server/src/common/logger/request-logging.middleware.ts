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
