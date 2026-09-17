import { SeverityNumber } from '@opentelemetry/api-logs';
import { ExportResultCode } from '@opentelemetry/core';
import { SentryLogRecordExporter, type SentryLoggerLike } from './sentry-log-exporter';

function fakeRecord(overrides: Partial<{ severityNumber: number; body: unknown; attributes: Record<string, unknown> }>) {
  return {
    severityNumber: SeverityNumber.INFO,
    body: 'default body',
    attributes: {},
    ...overrides,
  } as never;
}

function fakeSentryLogger(): SentryLoggerLike & { info: jest.Mock; warn: jest.Mock; error: jest.Mock } {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

describe('SentryLogRecordExporter', () => {
  it('routes WARN-and-above-but-below-ERROR records to logger.warn', () => {
    const logger = fakeSentryLogger();
    const exporter = new SentryLogRecordExporter(logger);
    const callback = jest.fn();
    exporter.export(
      [fakeRecord({ severityNumber: SeverityNumber.WARN, body: 'social.signin.rejected', attributes: { 'auth.provider': 'google' } })],
      callback,
    );
    expect(logger.warn).toHaveBeenCalledWith('social.signin.rejected', { 'auth.provider': 'google' });
    expect(callback).toHaveBeenCalledWith({ code: ExportResultCode.SUCCESS });
  });

  it('routes ERROR-and-above records to logger.error', () => {
    const logger = fakeSentryLogger();
    const exporter = new SentryLogRecordExporter(logger);
    exporter.export(
      [fakeRecord({ severityNumber: SeverityNumber.ERROR, body: 'social.signin.rejected', attributes: { 'auth.outcome': 'provider_error' } })],
      jest.fn(),
    );
    expect(logger.error).toHaveBeenCalledWith('social.signin.rejected', { 'auth.outcome': 'provider_error' });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('routes everything below WARN to logger.info', () => {
    const logger = fakeSentryLogger();
    const exporter = new SentryLogRecordExporter(logger);
    exporter.export([fakeRecord({ severityNumber: SeverityNumber.DEBUG, body: 'social.signin.ok' })], jest.fn());
    expect(logger.info).toHaveBeenCalledWith('social.signin.ok', {});
  });

  it('routes records with an undefined severityNumber to logger.info', () => {
    const logger = fakeSentryLogger();
    const exporter = new SentryLogRecordExporter(logger);
    exporter.export([fakeRecord({ severityNumber: undefined, body: 'social.signin.unspecified' })], jest.fn());
    expect(logger.info).toHaveBeenCalledWith('social.signin.unspecified', {});
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('stringifies a non-string body via String() coercion', () => {
    const logger = fakeSentryLogger();
    const exporter = new SentryLogRecordExporter(logger);
    exporter.export([fakeRecord({ body: { some: 'object' } })], jest.fn());
    expect(logger.info).toHaveBeenCalledWith('[object Object]', {});
  });

  it('falls back to the default message when body is undefined', () => {
    const logger = fakeSentryLogger();
    const exporter = new SentryLogRecordExporter(logger);
    exporter.export([fakeRecord({ body: undefined })], jest.fn());
    expect(logger.info).toHaveBeenCalledWith('sassy-auth.log.event', {});
  });

  it('resolves shutdown without throwing', async () => {
    await expect(new SentryLogRecordExporter(fakeSentryLogger()).shutdown()).resolves.toBeUndefined();
  });

  it('resolves forceFlush without throwing', async () => {
    await expect(new SentryLogRecordExporter(fakeSentryLogger()).forceFlush()).resolves.toBeUndefined();
  });
});
