import { SeverityNumber, logs, type LogAttributes } from '@opentelemetry/api-logs';
import { trace } from '@opentelemetry/api';
import { randomBytes } from 'node:crypto';
import { recordFederationOutcome } from '../telemetry/auth-metrics';

const tracer = trace.getTracer('sassy-auth.auth-server');

export type FederationEventType =
  | 'social.link.created'
  | 'social.signin.ok'
  | 'social.signin.rejected'
  | 'social.link.removed';

export interface FederationEvent {
  type: FederationEventType;
  provider: string;
  /** Machine-readable cause. Recorded even when the user saw a generic message. */
  reason?: string;
  /** True for provider/transport/DB failures, as opposed to expected refusals. */
  unexpected?: boolean;
  saUserId?: number;
  saUserPublicId?: string;
  betterAuthUserId?: string;
  appPublicId?: string;
  /** PII — persisted only, never emitted to telemetry. */
  email?: string;
  /** PII — persisted only, never emitted to telemetry. */
  providerSub?: string;
  ip?: string;
  userAgent?: string;
}

export interface FederationEventDeps {
  db: { saAuditEvent: { create(args: { data: Record<string, unknown> }): Promise<unknown> } };
  /** Injected so tests can assert emissions without an OTel SDK. */
  emit?: (severity: string, attributes: Record<string, unknown>) => void;
  logger: { warn(message: string, meta?: Record<string, unknown>): void };
}

function defaultEmit(severity: string, attributes: Record<string, unknown>): void {
  logs.getLogger('sassy-auth.social').emit({
    severityText: severity,
    severityNumber: severity === 'ERROR' ? SeverityNumber.ERROR : SeverityNumber.WARN,
    body: String(attributes['auth.event']),
    // Our own emit() seam is typed Record<string, unknown> for test
    // ergonomics (see FederationEventDeps); every value we actually pass
    // is a string, so this is a safe narrowing to OTel's LogAttributes.
    attributes: attributes as LogAttributes,
  });
}

/**
 * Single fan-out point for every federated-auth outcome.
 *
 * Sink 1 — SaAuditEvent: the durable record, unsampled, holds PII.
 * Sink 2 — OpenTelemetry logs (NOT span attributes, which tracesSampleRate
 *          would discard four times in five). The error-tracking backend
 *          ingests these via the vendor-neutral OTel API; this file stays
 *          free of any vendor-specific SDK import by design.
 *
 * Never throws: an audit failure must not break sign-in, matching the
 * lastLoginAt stance in auth.config.ts.
 */
export async function recordFederationEvent(
  deps: FederationEventDeps,
  event: FederationEvent,
): Promise<void> {
  return tracer.startActiveSpan('auth.social.federation', async (span) => {
    const outcome = event.reason ?? 'ok';
    span.setAttribute('auth.provider', event.provider);
    span.setAttribute('auth.event', event.type);
    span.setAttribute('auth.outcome', outcome);
    recordFederationOutcome({ provider: event.provider, type: event.type, outcome });

    const emit = deps.emit ?? defaultEmit;

    // Telemetry first, so it survives a database outage.
    try {
      emit(event.unexpected ? 'ERROR' : event.type === 'social.signin.rejected' ? 'WARN' : 'INFO', {
        'auth.event': event.type,
        'auth.flow': 'social',
        'auth.provider': event.provider,
        'auth.outcome': outcome,
        'app.public_id': event.appPublicId ?? '',
        'user.public_id': event.saUserPublicId ?? '',
      });
    } catch (err: unknown) {
      deps.logger.warn('Federation telemetry emit failed', { err: String(err) });
    }

    try {
      await deps.db.saAuditEvent.create({
        data: {
          publicId: randomBytes(9).toString('base64url'),
          type: event.type,
          provider: event.provider,
          saUserId: event.saUserId ?? null,
          betterAuthUserId: event.betterAuthUserId ?? null,
          appPublicId: event.appPublicId ?? null,
          email: event.email ?? null,
          providerSub: event.providerSub ?? null,
          reason: event.reason ?? null,
          ip: event.ip ?? null,
          userAgent: event.userAgent ?? null,
        },
      });
    } catch (err: unknown) {
      deps.logger.warn('Federation audit write failed', { type: event.type, err: String(err) });
    } finally {
      span.end();
    }
  });
}
