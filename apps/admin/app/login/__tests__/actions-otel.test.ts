import { trace } from '@opentelemetry/api';
import { InMemorySpanExporter, SimpleSpanProcessor, BasicTracerProvider } from '@opentelemetry/sdk-trace-base';

jest.mock('@sentry/nextjs', () => ({
  addBreadcrumb: jest.fn(),
  setUser: jest.fn(),
  setTag: jest.fn(),
  captureException: jest.fn(),
  withScope: jest.fn((fn: (scope: unknown) => void) => fn({ setLevel: jest.fn() })),
}));

// signIn calls next/headers's `headers()` (via getForwardedOrigin) and
// `cookies()` directly; outside a real Next.js request scope these are
// unavailable, so stub them the same way this repo's other server-action
// tests do (see lib/__tests__/api.test.ts).
jest.mock('next/headers', () => ({
  headers: jest.fn().mockResolvedValue(new Headers()),
  cookies: jest.fn().mockResolvedValue({
    get: jest.fn().mockReturnValue(undefined),
    set: jest.fn(),
    toString: () => '',
  }),
}));

const originalFetch = global.fetch;

describe('signIn span', () => {
  let exporter: InMemorySpanExporter;

  beforeEach(() => {
    exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
    trace.setGlobalTracerProvider(provider);
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      headers: new Headers(),
      json: async () => ({ error: 'invalid_credentials' }),
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('emits an admin.login.submit span with an outcome attribute', async () => {
    const { signIn } = await import('../actions');
    const formData = new FormData();
    formData.set('email', 'a@example.com');
    formData.set('password', 'wrong-password');
    await signIn(formData);

    const spans = exporter.getFinishedSpans();
    const loginSpan = spans.find((s) => s.name === 'admin.login.submit');
    expect(loginSpan).toBeDefined();
    expect(loginSpan?.attributes['auth.outcome']).toBeDefined();
  });
});
