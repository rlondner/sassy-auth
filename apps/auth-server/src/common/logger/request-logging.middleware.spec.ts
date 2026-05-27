import { RequestLoggingMiddleware } from './request-logging.middleware';
import { Request, Response } from 'express';

// Capture log calls
const mockInfo = jest.fn();
const mockWarn = jest.fn();
const mockChild = jest.fn().mockReturnValue({ info: mockInfo, warn: mockWarn });

jest.mock('./logger.service', () => ({
  LoggerService: jest.fn().mockImplementation(() => ({
    getWinstonLogger: () => ({ child: mockChild }),
  })),
}));

describe('RequestLoggingMiddleware', () => {
  let middleware: RequestLoggingMiddleware;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let endCallback: () => void;

  beforeEach(() => {
    jest.clearAllMocks();
    const { LoggerService } = require('./logger.service');
    middleware = new RequestLoggingMiddleware(new LoggerService());

    mockReq = {
      method: 'GET',
      originalUrl: '/api/users',
      requestId: 'req-123',
    };
    mockRes = {
      statusCode: 200,
      on: jest.fn((event: string, cb: () => void) => {
        if (event === 'finish') endCallback = cb;
      }),
    } as any;
  });

  it('logs completed requests at info level for 2xx status', () => {
    const next = jest.fn();
    middleware.use(mockReq as Request, mockRes as Response, next);
    expect(next).toHaveBeenCalled();

    // Simulate response finish
    endCallback();

    expect(mockChild).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'req-123' }),
    );
    expect(mockInfo).toHaveBeenCalledWith(
      expect.stringContaining('GET /api/users'),
    );
  });

  it('logs 4xx/5xx responses at warn level', () => {
    mockRes.statusCode = 500;
    const next = jest.fn();
    middleware.use(mockReq as Request, mockRes as Response, next);
    endCallback();

    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining('GET /api/users'),
    );
  });
});
