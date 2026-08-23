const warn = jest.fn();
const error = jest.fn();
const info = jest.fn();

jest.mock('@sentry/nestjs', () => ({
  logger: { warn: (...args: unknown[]) => warn(...args), error: (...args: unknown[]) => error(...args), info: (...args: unknown[]) => info(...args) },
}));

import { emitFederationEventToSentry } from './telemetry-sentry-adapter';

describe('emitFederationEventToSentry', () => {
  afterEach(() => jest.clearAllMocks());

  it('routes WARN severity to Sentry.logger.warn, carrying the record through', () => {
    emitFederationEventToSentry('WARN', { 'auth.event': 'social.signin.rejected', 'auth.provider': 'google' });
    expect(warn).toHaveBeenCalledWith('social.signin.rejected', {
      'auth.event': 'social.signin.rejected',
      'auth.provider': 'google',
    });
    expect(error).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
  });

  it('routes ERROR severity to Sentry.logger.error', () => {
    emitFederationEventToSentry('ERROR', { 'auth.event': 'social.signin.rejected', 'auth.outcome': 'provider_error' });
    expect(error).toHaveBeenCalledWith('social.signin.rejected', {
      'auth.event': 'social.signin.rejected',
      'auth.outcome': 'provider_error',
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('routes anything else (INFO) to Sentry.logger.info', () => {
    emitFederationEventToSentry('INFO', { 'auth.event': 'social.signin.ok' });
    expect(info).toHaveBeenCalledWith('social.signin.ok', { 'auth.event': 'social.signin.ok' });
  });

  it('falls back to a stable message when auth.event is absent', () => {
    emitFederationEventToSentry('WARN', {});
    expect(warn).toHaveBeenCalledWith('social.federation.event', {});
  });
});
