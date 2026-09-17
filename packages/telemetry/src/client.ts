import { trace } from '@opentelemetry/api';
import { WebTracerProvider, BatchSpanProcessor } from '@opentelemetry/sdk-trace-web';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_DEPLOYMENT_ENVIRONMENT_NAME } from '@opentelemetry/semantic-conventions';

const OTEL_PROXY_TRACES_PATH = '/api/otel/v1/traces';

let initialized = false;
let initializedServiceName: string | undefined;

/**
 * Call once, client-side only, before any captureClientError call site can
 * do anything useful. Posts spans through the same-origin OTel proxy route
 * (see proxy.ts) rather than directly to Datadog, so the API key never
 * reaches the browser bundle.
 */
export function initOtelClient(serviceName: string): void {
  if (typeof window === 'undefined' || initialized) return;
  initialized = true;
  initializedServiceName = serviceName;

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
  } catch (error) {
    console.error('[otel] Failed to initialize OpenTelemetry Web SDK:', error);
  }
}

/**
 * Records a "client.error" span for an error caught in the browser (an error
 * boundary, a failed fetch, etc.). No-ops if initOtelClient hasn't run yet.
 */
export function captureClientError(error: unknown, context?: Record<string, string>): void {
  if (!initialized || !initializedServiceName) return;

  const tracer = trace.getTracer(initializedServiceName);
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
