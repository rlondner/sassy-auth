/**
 * @jest-environment jsdom
 */
jest.mock('@opentelemetry/api', () => {
  const actual = jest.requireActual('@opentelemetry/api');
  jest.spyOn(actual.trace, 'getTracer');
  return actual;
});

import { trace } from '@opentelemetry/api';
import { initOtelClient, captureClientError } from './client';

const getTracerMock = trace.getTracer as jest.Mock;

describe('client', () => {
  let startSpanMock: jest.Mock;
  let spanEndMock: jest.Mock;
  let recordExceptionMock: jest.Mock;

  beforeEach(() => {
    spanEndMock = jest.fn();
    recordExceptionMock = jest.fn();
    startSpanMock = jest.fn().mockReturnValue({ end: spanEndMock, recordException: recordExceptionMock });
    getTracerMock.mockReset().mockReturnValue({ startSpan: startSpanMock });
  });

  describe('captureClientError before initOtelClient has run', () => {
    it('is a no-op', () => {
      jest.resetModules();
      // re-require a fresh, uninitialized module instance
      const fresh = jest.requireActual('./client') as typeof import('./client');
      fresh.captureClientError(new Error('boom'));
      expect(startSpanMock).not.toHaveBeenCalled();
    });
  });

  describe('when initOtelClient fails to register the provider', () => {
    it('permanently no-ops captureClientError for that page load', () => {
      jest.resetModules();
      jest.spyOn(console, 'error').mockImplementation(() => {});

      const { WebTracerProvider } = jest.requireActual('@opentelemetry/sdk-trace-web') as typeof import('@opentelemetry/sdk-trace-web');
      const registerSpy = jest.spyOn(WebTracerProvider.prototype, 'register').mockImplementation(() => {
        throw new Error('registration boom');
      });

      const fresh = jest.requireActual('./client') as typeof import('./client');
      fresh.initOtelClient('sassy-auth-admin');
      fresh.captureClientError(new Error('boom'));

      expect(startSpanMock).not.toHaveBeenCalled();

      registerSpy.mockRestore();
      (console.error as jest.Mock).mockRestore();
    });
  });

  describe('after initOtelClient has run', () => {
    beforeAll(() => {
      initOtelClient('sassy-auth-admin');
    });

    it('records an Error with error.type, error.message and any extra context', () => {
      captureClientError(new TypeError('network failed'), { boundary: 'global-error' });

      expect(startSpanMock).toHaveBeenCalledTimes(1);
      const [spanName, spanOptions] = startSpanMock.mock.calls[0] as [string, { attributes: Record<string, string> }];
      expect(spanName).toBe('client.error');
      expect(spanOptions.attributes).toEqual({
        'error.type': 'TypeError',
        'error.message': 'network failed',
        boundary: 'global-error',
      });
      expect(recordExceptionMock).toHaveBeenCalledTimes(1);
      expect(spanEndMock).toHaveBeenCalledTimes(1);
    });

    it('wraps a non-Error thrown value in an Error before recording', () => {
      captureClientError('a plain string throw');

      const [, spanOptions] = startSpanMock.mock.calls.at(-1) as [string, { attributes: Record<string, string> }];
      expect(spanOptions.attributes['error.message']).toBe('a plain string throw');
    });
  });
});
