import { createOtelProxyHandler } from './proxy';

function makeRequest(overrides: { method?: string; origin?: string | null; contentLength?: string | null } = {}): Request {
  const headers = new Headers();
  if (overrides.origin !== null) headers.set('origin', overrides.origin ?? 'https://admin.example.com');
  if (overrides.contentLength !== null) headers.set('content-length', overrides.contentLength ?? '10');
  headers.set('content-type', 'application/x-protobuf');
  return new Request('https://admin.example.com/api/otel/v1/traces', {
    method: overrides.method ?? 'POST',
    headers,
    body: overrides.method === 'GET' ? undefined : new Uint8Array([1, 2, 3]),
  });
}

describe('createOtelProxyHandler', () => {
  const ORIGINAL_ENV = process.env;
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'https://otlp.datadoghq.com';
    process.env.OTEL_EXPORTER_OTLP_HEADERS = 'dd-api-key=test-key';
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    global.fetch = originalFetch;
  });

  it('forwards a valid POST to the OTLP endpoint with the dd-api-key header injected', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const handler = createOtelProxyHandler();
    const response = await handler(makeRequest(), { params: Promise.resolve({ path: ['v1', 'traces'] }) });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://otlp.datadoghq.com/v1/traces');
    expect((init.headers as Record<string, string>)['dd-api-key']).toBe('test-key');
  });

  it('returns 405 for a non-POST method', async () => {
    const handler = createOtelProxyHandler();
    const response = await handler(makeRequest({ method: 'GET' }), { params: Promise.resolve({ path: ['v1', 'traces'] }) });
    expect(response.status).toBe(405);
  });

  it('returns 404 for an unknown signal path', async () => {
    const handler = createOtelProxyHandler();
    const response = await handler(makeRequest(), { params: Promise.resolve({ path: ['v1', 'metrics'] }) });
    expect(response.status).toBe(404);
  });

  it('returns 403 for a cross-origin request', async () => {
    const handler = createOtelProxyHandler();
    const response = await handler(
      makeRequest({ origin: 'https://evil.example.com' }),
      { params: Promise.resolve({ path: ['v1', 'traces'] }) },
    );
    expect(response.status).toBe(403);
  });

  it('returns 413 for an oversized body', async () => {
    const handler = createOtelProxyHandler();
    const response = await handler(
      makeRequest({ contentLength: String(2_000_000) }),
      { params: Promise.resolve({ path: ['v1', 'traces'] }) },
    );
    expect(response.status).toBe(413);
  });

  it('returns 500 when OTEL_EXPORTER_OTLP_ENDPOINT is unset', async () => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const handler = createOtelProxyHandler();
    const response = await handler(makeRequest(), { params: Promise.resolve({ path: ['v1', 'traces'] }) });
    expect(response.status).toBe(500);
  });
});
