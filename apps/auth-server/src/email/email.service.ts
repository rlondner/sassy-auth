import { Inject, Injectable } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { LoggerService } from '../common/logger/logger.service';
import { EMAIL_TRANSPORT, type EmailMessage, type EmailTransport } from './email.types';

@Injectable()
export class EmailService {
  constructor(
    @Inject(EMAIL_TRANSPORT) private readonly transport: EmailTransport,
    private readonly logger: LoggerService,
  ) {}

  /** Send an email. Never throws — a transport failure is logged and reported as { sent: false }. */
  async send(msg: EmailMessage): Promise<{ sent: boolean }> {
    const from = process.env.EMAIL_FROM ?? 'no-reply@sassy-auth.local';
    try {
      await this.transport.send({ ...msg, from });
      return { sent: true };
    } catch (err) {
      Sentry.captureException(err);
      this.logger.getWinstonLogger().warn('Email send failed', {
        context: 'EmailService',
        transport: this.transport.name,
        to: msg.to,
        error: err instanceof Error ? err.message : String(err),
      });
      return { sent: false };
    }
  }
}
