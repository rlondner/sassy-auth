import { Injectable, LoggerService as NestLoggerService } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { createAppLogger } from './winston.config';

@Injectable()
export class LoggerService implements NestLoggerService {
  private readonly logger = createAppLogger();

  log(message: string, context?: string) {
    this.logger.info(message, { context });
  }

  error(message: string, stack?: string, context?: string) {
    const sentryEventId = Sentry.lastEventId();
    this.logger.error(message, { context, stack, ...(sentryEventId && { sentryEventId }) });
  }

  warn(message: string, context?: string) {
    this.logger.warn(message, { context });
  }

  debug(message: string, context?: string) {
    this.logger.debug(message, { context });
  }

  verbose(message: string, context?: string) {
    this.logger.verbose(message, { context });
  }

  /** Attach request-scoped metadata to all subsequent log entries in this call chain. */
  child(meta: Record<string, unknown>) {
    return this.logger.child(meta);
  }

  /** Direct access to the Winston logger for structured logging with extra fields. */
  getWinstonLogger() {
    return this.logger;
  }
}
