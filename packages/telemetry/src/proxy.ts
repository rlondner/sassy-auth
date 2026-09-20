import { isDatadogOtlpEnabled } from './server';
import { parseOtlpHeaders } from './headers';

const MAX_BODY_BYTES = 1_000_000;
const ALLOWED_SIGNAL_PATHS = new Set(['v1/traces']);

type RouteContext = { params: Promise<{ path: string[] }> };

/**
 * Next.js Route Handler factory. Drop the result into
 * `apps/admin/app/api/otel/[...path]/route.ts` as `export const POST = createOtelProxyHandler()`.
 * Keeps OTEL_EXPORTER_OTLP_HEADERS (the Datadog API key) server-side — the
 * browser bundle never sees it. Only `v1/traces` is allowlisted today, since
 * only client-side error spans are wired up (no browser metrics/logs).
 */
export function createOtelProxyHandler() {
  return async function POST(request: Request, context: RouteContext): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response(null, { status: 405 });
    }

    const { path } = await context.params;
    const signalPath = path.join('/');
    if (!ALLOWED_SIGNAL_PATHS.has(signalPath)) {
      return new Response(null, { status: 404 });
    }

    const url = new URL(request.url);
    const origin = request.headers.get('origin');
    if (origin !== null && origin !== url.origin) {
      return new Response(null, { status: 403 });
    }

    const contentLengthHeader = request.headers.get('content-length');
    if (contentLengthHeader !== null && Number(contentLengthHeader) > MAX_BODY_BYTES) {
      return new Response(null, { status: 413 });
    }

    if (!isDatadogOtlpEnabled()) {
      console.error('[otel-proxy] OTEL_EXPORTER_OTLP_ENDPOINT is not set; dropping telemetry');
      return new Response(null, { status: 500 });
    }

    const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const ddHeaders = parseOtlpHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS);

    try {
      const contentType = request.headers.get('content-type') ?? 'application/x-protobuf';
      const body = await request.arrayBuffer();

      const upstreamResponse = await fetch(`${endpoint}/${signalPath}`, {
        method: 'POST',
        headers: { 'content-type': contentType, ...ddHeaders },
        body,
      });

      return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        headers: { 'content-type': upstreamResponse.headers.get('content-type') ?? 'application/json' },
      });
    } catch (error) {
      console.error('[otel-proxy] Failed to reach the Datadog OTLP endpoint:', error);
      return new Response(null, { status: 502 });
    }
  };
}
