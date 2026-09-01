import { logger as sentryLogger } from '@sentry/nestjs';
import { SeverityNumber } from '@opentelemetry/api-logs';
import { ExportResultCode, type ExportResult } from '@opentelemetry/core';
import type { LogRecordExporter, ReadableLogRecord } from '@opentelemetry/sdk-logs';

/**
 * Bridges OTel log records to Sentry's own structured-logging API.
 * `@sentry/opentelemetry` bridges spans, never OTel logs — see the git
 * history of `apps/auth-server/src/social/telemetry-sentry-adapter.ts` for
 * the full investigation. Registering this as a LogRecordProcessor on the
 * app's LoggerProvider (see otel.ts's setupLogging) means every future
 * `logs.getLogger(...).emit(...)` call site gets Sentry delivery for free,
 * not just the one federation-events call site the old adapter special-cased.
 */
export class SentryLogRecordExporter implements LogRecordExporter {
  export(records: ReadableLogRecord[], resultCallback: (result: ExportResult) => void): void {
    for (const record of records) {
      const message = String(record.body ?? 'sassy-auth.log.event');
      const attributes = { ...record.attributes };
      if (record.severityNumber !== undefined && record.severityNumber >= SeverityNumber.ERROR) {
        sentryLogger.error(message, attributes);
      } else if (record.severityNumber !== undefined && record.severityNumber >= SeverityNumber.WARN) {
        sentryLogger.warn(message, attributes);
      } else {
        sentryLogger.info(message, attributes);
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
