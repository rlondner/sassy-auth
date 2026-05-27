import { SentryExceptionFilter } from './sentry-exception.filter';
import { HttpException, HttpStatus, ArgumentsHost } from '@nestjs/common';

// Mock Sentry
jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
  withScope: jest.fn((cb) => cb({ setExtra: jest.fn(), setTag: jest.fn() })),
}));

import * as Sentry from '@sentry/nestjs';

// Mock LoggerService
const mockError = jest.fn();
jest.mock('../logger/logger.service', () => ({
  LoggerService: jest.fn().mockImplementation(() => ({
    error: mockError,
  })),
}));

describe('SentryExceptionFilter', () => {
  let filter: SentryExceptionFilter;
  let mockJson: jest.Mock;
  let mockStatus: jest.Mock;
  let mockHost: ArgumentsHost;

  beforeEach(() => {
    jest.clearAllMocks();
    const { LoggerService } = require('../logger/logger.service');
    filter = new SentryExceptionFilter(new LoggerService());

    mockJson = jest.fn();
    mockStatus = jest.fn().mockReturnValue({ json: mockJson });
    mockHost = {
      switchToHttp: () => ({
        getResponse: () => ({ status: mockStatus }),
        getRequest: () => ({ url: '/api/test', method: 'GET', requestId: 'req-abc' }),
      }),
    } as unknown as ArgumentsHost;
  });

  it('returns standardized JSON for HttpException', () => {
    const exception = new HttpException('Not found', HttpStatus.NOT_FOUND);
    filter.catch(exception, mockHost);

    expect(mockStatus).toHaveBeenCalledWith(404);
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 404,
        message: 'Not found',
        path: '/api/test',
      }),
    );
  });

  it('does NOT send 4xx HttpExceptions to Sentry', () => {
    const exception = new HttpException('Bad request', HttpStatus.BAD_REQUEST);
    filter.catch(exception, mockHost);

    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('sends 5xx HttpExceptions to Sentry', () => {
    const exception = new HttpException('Server error', HttpStatus.INTERNAL_SERVER_ERROR);
    filter.catch(exception, mockHost);

    expect(Sentry.captureException).toHaveBeenCalledWith(exception);
  });

  it('sends non-HttpException errors to Sentry', () => {
    const exception = new Error('unexpected crash');
    filter.catch(exception, mockHost);

    expect(Sentry.captureException).toHaveBeenCalledWith(exception);
    expect(mockStatus).toHaveBeenCalledWith(500);
  });

  it('logs all exceptions via LoggerService', () => {
    const exception = new Error('boom');
    filter.catch(exception, mockHost);

    expect(mockError).toHaveBeenCalledWith(
      expect.stringContaining('boom'),
      expect.any(String),
      'ExceptionFilter',
    );
  });
});
