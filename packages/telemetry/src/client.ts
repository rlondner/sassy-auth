import { trace } from '@opentelemetry/api';
import { WebTracerProvider, BatchSpanProcessor } from '@opentelemetry/sdk-trace-web';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_DEPLOYMENT_ENVIRONMENT_NAME } from '@opentelemetry/semantic-conventions';

const OTEL_PROXY_TRACES_PATH = '/api/otel/v1/traces';

let attemptedInit = false;
// Only set once provider.register() has actually succeeded. captureClientError
// must permanently no-op unless this happened, rather than falling back to
// whatever tracer provider happens to be globally registered.
let registeredServiceName: string | undefined;

/**
 * Call once, client-side only, before any captureClientError call site can
 * do anything useful. Posts spans through the same-origin OTel proxy route
 * (see proxy.ts) rather than directly to Datadog, so the API key never
 * reaches the browser bundle.
 */
export function initOtelClient(serviceName: string): void {
  if (typeof window === 'undefined' || attemptedInit) return;
  attemptedInit = true;

  try {
    const resource = resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName,
      [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: process.env.NODE_ENV,
    });

    const provider = new WebTracerProvider({
      resource,
      spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter({ url: OTEL_PROXY_TRACES_PATH }))],
    });
    provider.register();
    registeredServiceName = serviceName;
  } catch (error) {
    console.error('[otel] Failed to initialize OpenTelemetry Web SDK:', error);
  }
}

/**
 * Records a "client.error" span for an error caught in the browser (an error
 * boundary, a failed fetch, etc.). No-ops if initOtelClient hasn't run yet,
 * or if its OTel provider setup+registration failed.
 */
export function captureClientError(error: unknown, context?: Record<string, string>): void {
  if (!registeredServiceName) return;

  const tracer = trace.getTracer(registeredServiceName);
  const err = error instanceof Error ? error : new Error(String(error));
  const span = tracer.startSpan('client.error', {
    attributes: {
      'error.type': err.name,
      'error.message': err.message,
      ...(context ?? {}),
    },
  });
  span.recordException(err);
  span.end();
}
