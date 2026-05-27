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

  it('rejects an inbound X-Request-Id containing control characters', () => {
    mockReq.headers = { 'x-request-id': 'evil\nlog forge\t' };

    middleware.use(mockReq as Request, mockRes as Response, next);

    expect(mockReq['requestId']).not.toBe('evil\nlog forge\t');
    expect(mockReq['requestId']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('rejects an inbound X-Request-Id longer than 128 chars', () => {
    mockReq.headers = { 'x-request-id': 'a'.repeat(129) };

    middleware.use(mockReq as Request, mockRes as Response, next);

    expect(mockReq['requestId']).not.toBe('a'.repeat(129));
    expect((mockReq['requestId'] as string).length).toBeLessThanOrEqual(128);
  });

  it('rejects an inbound X-Request-Id with disallowed characters', () => {
    mockReq.headers = { 'x-request-id': 'has spaces and !@#' };

    middleware.use(mockReq as Request, mockRes as Response, next);

    expect(mockReq['requestId']).not.toBe('has spaces and !@#');
    expect(mockReq['requestId']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('accepts a sane request id (UUID-like)', () => {
    mockReq.headers = { 'x-request-id': '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed' };

    middleware.use(mockReq as Request, mockRes as Response, next);

    expect(mockReq['requestId']).toBe('1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed');
  });
});
