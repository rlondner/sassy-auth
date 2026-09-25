import { SeverityNumber } from '@opentelemetry/api-logs';
import { ExportResultCode, type ExportResult } from '@opentelemetry/core';
import type { LogRecordExporter, ReadableLogRecord } from '@opentelemetry/sdk-logs';

/**
 * Bridges OTel log records to Sentry's structured-logging API. Takes the
 * Sentry `logger` object as a constructor argument (rather than importing
 * `@sentry/nestjs` or `@sentry/nextjs` directly) so this package has no hard
 * dependency on either Sentry SDK flavor — each app passes its own `logger`.
 */
export interface SentryLoggerLike {
  info(message: string, attributes?: Record<string, unknown>): void;
  warn(message: string, attributes?: Record<string, unknown>): void;
  error(message: string, attributes?: Record<string, unknown>): void;
}

export class SentryLogRecordExporter implements LogRecordExporter {
  constructor(private readonly sentryLogger: SentryLoggerLike) {}

  export(records: ReadableLogRecord[], resultCallback: (result: ExportResult) => void): void {
    for (const record of records) {
      const message = String(record.body ?? 'sassy-auth.log.event');
      const attributes = { ...record.attributes };
      if (record.severityNumber !== undefined && record.severityNumber >= SeverityNumber.ERROR) {
        this.sentryLogger.error(message, attributes);
      } else if (record.severityNumber !== undefined && record.severityNumber >= SeverityNumber.WARN) {
        this.sentryLogger.warn(message, attributes);
      } else {
        this.sentryLogger.info(message, attributes);
      }
    }
    resultCallback({ code: ExportResultCode.SUCCESS });
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }
}
