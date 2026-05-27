import { RequestIdMiddleware } from './request-id.middleware';
import { Request, Response } from 'express';

describe('RequestIdMiddleware', () => {
  let middleware: RequestIdMiddleware;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  const next = jest.fn();

  beforeEach(() => {
    middleware = new RequestIdMiddleware();
    mockReq = { headers: {} };
    mockRes = { setHeader: jest.fn() };
    next.mockClear();
  });

  it('generates a request ID when none is provided', () => {
    middleware.use(mockReq as Request, mockRes as Response, next);

    expect(mockReq['requestId']).toBeDefined();
    expect(typeof mockReq['requestId']).toBe('string');
    expect(mockRes.setHeader).toHaveBeenCalledWith('X-Request-Id', mockReq['requestId']);
    expect(next).toHaveBeenCalled();
  });

  it('uses existing X-Request-Id header when provided', () => {
    mockReq.headers = { 'x-request-id': 'existing-id-123' };

    middleware.use(mockReq as Request, mockRes as Response, next);

    expect(mockReq['requestId']).toBe('existing-id-123');
    expect(mockRes.setHeader).toHaveBeenCalledWith('X-Request-Id', 'existing-id-123');
    expect(next).toHaveBeenCalled();
  });
});
