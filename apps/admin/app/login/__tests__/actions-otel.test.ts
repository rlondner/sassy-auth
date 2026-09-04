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
    // The OpenTelemetry trace API only accepts one global provider
    // registration; without disabling the previous test's provider first,
    // every test after the first silently exports into a stale provider and
    // exporter.getFinishedSpans() here always returns []. Also reset the
    // module registry so `actions.ts`'s module-scoped `tracer` (captured via
    // `trace.getTracer(...)` at import time) is re-created against the fresh
    // provider registered below, rather than staying bound to a prior test's
    // now-disabled one.
    trace.disable();
    jest.resetModules();
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
    // The mocked fetch responds 401, which signInInner maps to the
    // `invalidCredentials` error code; the span attribute must carry the
    // normalized snake_case outcome shared with the other services, not the
    // raw camelCase code.
    expect(loginSpan?.attributes['auth.outcome']).toBe('invalid_credentials');
  });

  it('traces an unverified-account rejection with its own outcome, not validation_error', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 403,
      headers: new Headers(),
      json: async () => ({ code: 'ACCOUNT_UNVERIFIED' }),
      clone() {
        return this;
      },
    }) as unknown as typeof fetch;

    const { signIn } = await import('../actions');
    const formData = new FormData();
    formData.set('email', 'a@example.com');
    formData.set('password', 'wrong-password');
    await signIn(formData);

    const spans = exporter.getFinishedSpans();
    const loginSpan = spans.find((s) => s.name === 'admin.login.submit');
    expect(loginSpan).toBeDefined();
    // The session-create gate's 403 with code ACCOUNT_UNVERIFIED maps to the
    // `unverified` error code, which must carry its own outcome — the same
    // account-state family as `inactive` — rather than falling through to
    // the `validation_error` default that `normalizeAuthOutcome` uses for
    // unmapped codes.
    expect(loginSpan?.attributes['auth.outcome']).toBe('unverified');
  });
});
