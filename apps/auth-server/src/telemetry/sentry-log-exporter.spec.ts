import { SeverityNumber } from '@opentelemetry/api-logs';
import { ExportResultCode } from '@opentelemetry/core';

const warn = jest.fn();
const error = jest.fn();
const info = jest.fn();

jest.mock('@sentry/nestjs', () => ({
  logger: {
    warn: (...args: unknown[]) => warn(...args),
    error: (...args: unknown[]) => error(...args),
    info: (...args: unknown[]) => info(...args),
  },
}));

import { SentryLogRecordExporter } from './sentry-log-exporter';

function fakeRecord(overrides: Partial<{ severityNumber: number; body: unknown; attributes: Record<string, unknown> }>) {
  return {
    severityNumber: SeverityNumber.INFO,
    body: 'default body',
    attributes: {},
    ...overrides,
  } as never;
}

describe('SentryLogRecordExporter', () => {
  afterEach(() => jest.clearAllMocks());

  it('routes WARN-and-above-but-below-ERROR records to Sentry.logger.warn', () => {
    const exporter = new SentryLogRecordExporter();
    const callback = jest.fn();
    exporter.export(
      [fakeRecord({ severityNumber: SeverityNumber.WARN, body: 'social.signin.rejected', attributes: { 'auth.provider': 'google' } })],
      callback,
    );
    expect(warn).toHaveBeenCalledWith('social.signin.rejected', { 'auth.provider': 'google' });
    expect(callback).toHaveBeenCalledWith({ code: ExportResultCode.SUCCESS });
  });

  it('routes ERROR-and-above records to Sentry.logger.error', () => {
    const exporter = new SentryLogRecordExporter();
    exporter.export(
      [fakeRecord({ severityNumber: SeverityNumber.ERROR, body: 'social.signin.rejected', attributes: { 'auth.outcome': 'provider_error' } })],
      jest.fn(),
    );
    expect(error).toHaveBeenCalledWith('social.signin.rejected', { 'auth.outcome': 'provider_error' });
    expect(warn).not.toHaveBeenCalled();
  });

  it('routes everything below WARN to Sentry.logger.info', () => {
    const exporter = new SentryLogRecordExporter();
    exporter.export([fakeRecord({ severityNumber: SeverityNumber.DEBUG, body: 'social.signin.ok' })], jest.fn());
    expect(info).toHaveBeenCalledWith('social.signin.ok', {});
  });

  it('resolves shutdown without throwing', async () => {
    await expect(new SentryLogRecordExporter().shutdown()).resolves.toBeUndefined();
  });
});
