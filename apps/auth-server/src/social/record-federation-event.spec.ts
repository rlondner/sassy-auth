import { trace, type Span, type Context } from '@opentelemetry/api';
import { InMemorySpanExporter, SimpleSpanProcessor, BasicTracerProvider } from '@opentelemetry/sdk-trace-base';
import type { SpanProcessor } from '@opentelemetry/sdk-trace-base';
import { recordFederationEvent } from './record-federation-event';

// A SpanProcessor built entirely against the public OTel API (onStart/onEnd)
// rather than a version-specific SDK class export (this repo's installed
// @opentelemetry/sdk-trace-base does not even export a `Span` class from its
// public entrypoint), used to make span.setAttribute throw on demand — proving
// record-federation-event.ts's own try/catch around span.setAttribute(...)
// swallows failures. Gated by a flag rather than being unconditional, since
// the tracer's ProxyTracer delegate binds to this suite's single provider
// once and is shared by every test in this describe block.
let throwOnSetAttribute = false;
class ThrowingSetAttributeProcessor implements SpanProcessor {
  onStart(span: Span, _parentContext: Context): void {
    if (!throwOnSetAttribute) return;
    span.setAttribute = () => {
      throw new Error('span attribute exploded');
    };
  }
  onEnd(): void {}
  shutdown(): Promise<void> {
    return Promise.resolve();
  }
  forceFlush(): Promise<void> {
    return Promise.resolve();
  }
}

function makeDeps() {
  const created: unknown[] = [];
  const emitted: { severity: string; attributes: Record<string, unknown> }[] = [];
  return {
    created,
    emitted,
    deps: {
      db: { saAuditEvent: { create: async (args: { data: unknown }) => { created.push(args.data); } } },
      emit: (severity: string, attributes: Record<string, unknown>) => { emitted.push({ severity, attributes }); },
      logger: { warn: jest.fn() },
    },
  };
}

describe('recordFederationEvent', () => {
  it('writes the durable row with the real reason', async () => {
    const { deps, created } = makeDeps();
    await recordFederationEvent(deps, {
      type: 'social.signin.rejected',
      provider: 'google',
      reason: 'no_sauser_for_verified_email',
      email: 'alice@acme.com',
      providerSub: 'sub-123',
      appPublicId: 'qp31',
    });
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      type: 'social.signin.rejected',
      provider: 'google',
      reason: 'no_sauser_for_verified_email',
      email: 'alice@acme.com',
      providerSub: 'sub-123',
    });
  });

  it('keeps email and provider sub out of telemetry', async () => {
    const { deps, emitted } = makeDeps();
    await recordFederationEvent(deps, {
      type: 'social.signin.ok',
      provider: 'google',
      email: 'alice@acme.com',
      providerSub: 'sub-123',
      saUserPublicId: 'UkLW',
      appPublicId: 'qp31',
    });
    const serialized = JSON.stringify(emitted);
    expect(serialized).not.toContain('alice@acme.com');
    expect(serialized).not.toContain('sub-123');
    expect(emitted[0].attributes['auth.provider']).toBe('google');
    expect(emitted[0].attributes['user.public_id']).toBe('UkLW');
  });

  it('emits WARN for expected rejections and ERROR for unexpected failures', async () => {
    const { deps, emitted } = makeDeps();
    await recordFederationEvent(deps, { type: 'social.signin.rejected', provider: 'google', reason: 'email_unverified' });
    await recordFederationEvent(deps, { type: 'social.signin.rejected', provider: 'google', reason: 'provider_error', unexpected: true });
    expect(emitted[0].severity).toBe('WARN');
    expect(emitted[1].severity).toBe('ERROR');
  });

  it('never throws when the audit write fails', async () => {
    const { deps, emitted } = makeDeps();
    deps.db.saAuditEvent.create = async () => { throw new Error('db down'); };
    await expect(
      recordFederationEvent(deps, { type: 'social.signin.ok', provider: 'google' }),
    ).resolves.toBeUndefined();
    expect(deps.logger.warn).toHaveBeenCalled();
    expect(emitted).toHaveLength(1); // telemetry still emitted
  });
});

describe('recordFederationEvent span', () => {
  // The tracer in record-federation-event.ts is captured once at module load
  // (`const tracer = trace.getTracer(...)`), and OTel's ProxyTracer caches its
  // delegate on first use — so re-registering a global tracer provider mid-suite
  // does not rebind it. All span assertions in this describe block therefore
  // share a single provider/exporter, reset between tests.
  const exporter = new InMemorySpanExporter();

  beforeAll(() => {
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter), new ThrowingSetAttributeProcessor()],
    });
    trace.setGlobalTracerProvider(provider);
  });

  beforeEach(() => {
    exporter.reset();
  });

  it('emits an auth.social.federation span with provider and outcome attributes', async () => {
    const { deps } = makeDeps();
    await recordFederationEvent(deps, { type: 'social.signin.ok', provider: 'google', appPublicId: 'qp31' });

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe('auth.social.federation');
    expect(spans[0].attributes['auth.provider']).toBe('google');
    expect(spans[0].attributes['auth.outcome']).toBe('ok');
  });

  it('keeps email and provider sub out of span attributes', async () => {
    const { deps } = makeDeps();
    await recordFederationEvent(deps, {
      type: 'social.signin.ok',
      provider: 'google',
      email: 'alice@acme.com',
      providerSub: 'sub-123',
      appPublicId: 'qp31',
    });

    const spans = exporter.getFinishedSpans();
    const serialized = JSON.stringify(spans[0].attributes);
    expect(serialized).not.toContain('alice@acme.com');
    expect(serialized).not.toContain('sub-123');
  });

  // recordFederationOutcome (auth-metrics.ts) guards its own counter.add()
  // call internally now, so record-federation-event.ts no longer needs its
  // own try/catch around that call — see auth-metrics.spec.ts for coverage
  // of that guard. What remains guarded here is span.setAttribute(...),
  // which is a different API this file still wraps directly.
  it('never throws when span attribute telemetry fails', async () => {
    throwOnSetAttribute = true;
    try {
      const { deps, created, emitted } = makeDeps();
      await expect(
        recordFederationEvent(deps, { type: 'social.signin.ok', provider: 'google' }),
      ).resolves.toBeUndefined();
      expect(deps.logger.warn).toHaveBeenCalled();
      expect(created).toHaveLength(1); // DB write still happened
      expect(emitted).toHaveLength(1); // emit still happened
    } finally {
      throwOnSetAttribute = false;
    }
  });
});
