import * as crypto from 'crypto';
import { SeverityNumber, logs, type LogAttributes } from '@opentelemetry/api-logs';
import { prisma } from '@sassy-auth/db';

const WEBHOOK_TIMEOUT_MS = 5000;

interface DeliveryConfig {
  activationWebhookUrl: string;
  activationWebhookSecret: string;
  appPublicId: string;
}

interface NotifyActivationDeps {
  /** Injected so tests can assert emissions without a real OTel SDK. */
  emit?: (attributes: Record<string, unknown>) => void;
}

/** "Jane" → "J***". Never emitted un-redacted to telemetry — see emitWebhookCallLog. */
function redactName(value: string): string {
  return value.length > 0 ? `${value[0]}***` : '***';
}

/** "jane.doe@example.com" → "j***@example.com". Domain kept (low cardinality, not identifying on its own). */
function redactEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  return `${email[0]}***${email.slice(at)}`;
}

function defaultEmit(attributes: Record<string, unknown>): void {
  logs.getLogger('sassy-auth.activation').emit({
    severityText: 'INFO',
    severityNumber: SeverityNumber.INFO,
    body: 'activation.webhook.called',
    // Our own emit() seam is typed Record<string, unknown> for test
    // ergonomics; every value we actually pass is a string, so this is a
    // safe narrowing to OTel's LogAttributes.
    attributes: attributes as LogAttributes,
  });
}

/**
 * Records that a SaApp's activation webhook is about to be called: an OTel
 * log (redacted PII only — never the full name/email) plus a console.log
 * (full name/email, for local/dev visibility). Never throws — telemetry must
 * not block webhook delivery.
 */
function emitWebhookCallLog(
  emit: (attributes: Record<string, unknown>) => void,
  config: DeliveryConfig,
  user: { publicId: string; firstName: string; lastName: string; email: string },
): void {
  try {
    emit({
      'activation.event': 'webhook.called',
      'app.public_id': config.appPublicId,
      'user.public_id': user.publicId,
      'user.first_name': redactName(user.firstName),
      'user.last_name': redactName(user.lastName),
      'user.email': redactEmail(user.email),
    });
  } catch {
    // Telemetry must never break webhook delivery.
  }
  console.log(
    `[activation] Calling webhook for app ${config.appPublicId} (${config.activationWebhookUrl}): ${user.firstName} ${user.lastName} <${user.email}>`,
  );
}

async function resolveDeliveryConfig(orgId: number): Promise<DeliveryConfig | null> {
  const org = await prisma.saOrg.findUnique({
    where: { id: orgId },
    select: { app: { select: { publicId: true, activationWebhookUrl: true, activationWebhookSecret: true } } },
  });
  if (!org?.app.activationWebhookUrl || !org.app.activationWebhookSecret) return null;
  return { activationWebhookUrl: org.app.activationWebhookUrl, activationWebhookSecret: org.app.activationWebhookSecret, appPublicId: org.app.publicId };
}

async function postOnce(url: string, body: string, signature: string): Promise<{ ok: boolean; error: string | null }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Sassy-Signature': `sha256=${signature}` },
      body,
      signal: controller.signal,
      // SSRF: a webhook URL that later 302-redirects must not cause the
      // signed request to be silently re-POSTed to wherever the redirect
      // points (potentially an internal/private address). `redirect: 'error'`
      // makes fetch reject instead of following it — handled below by the
      // same catch block as any other network failure.
      redirect: 'error',
    });
    if (res.ok) return { ok: true, error: null };
    return { ok: false, error: `HTTP ${res.status}` };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timeout);
  }
}

function isRetryable(error: string): boolean {
  return !error.startsWith('HTTP ') || error.startsWith('HTTP 5');
}

async function logOutcome(saUserId: number, appPublicId: string, delivered: boolean, reason: string | null): Promise<void> {
  try {
    await prisma.saAuditEvent.create({
      data: {
        publicId: crypto.randomBytes(9).toString('base64url'),
        type: delivered ? 'activation_webhook_sent' : 'activation_webhook_failed',
        saUserId,
        appPublicId,
        reason,
      },
    });
  } catch {
    // Audit logging is best-effort — never let it surface to the caller.
  }
}

/**
 * Fires the activation webhook for a SaApp, if one is configured. Called by
 * every code path that transitions a SaUser's status to 'active' (email
 * verification, invitation acceptance, admin re-activation). Fire-and-forget:
 * one retry on a network error or 5xx, no further backoff or persistence
 * beyond the SaAuditEvent log — never throws.
 */
export async function notifyActivation(
  saUser: { id: number; publicId: string; orgId: number; firstName: string; lastName: string; email: string },
  deps: NotifyActivationDeps = {},
): Promise<void> {
  let config: DeliveryConfig | null;
  try {
    config = await resolveDeliveryConfig(saUser.orgId);
  } catch {
    return;
  }
  if (!config) return;

  emitWebhookCallLog(deps.emit ?? defaultEmit, config, saUser);

  const body = JSON.stringify({
    event: 'account.activated',
    userId: saUser.publicId,
    appPublicId: config.appPublicId,
    activatedAt: new Date().toISOString(),
    // Both are covered by the signature below (it's computed over the whole
    // body): `timestamp` lets the RP reject stale requests (a replay window
    // check), `nonce` lets it dedupe an exact replay — or the driver's own
    // same-event retry below — within that window.
    timestamp: Date.now(),
    nonce: crypto.randomBytes(16).toString('hex'),
  });
  const signature = crypto.createHmac('sha256', config.activationWebhookSecret).update(body).digest('hex');

  let result = await postOnce(config.activationWebhookUrl, body, signature);
  if (!result.ok && isRetryable(result.error!)) {
    result = await postOnce(config.activationWebhookUrl, body, signature);
  }

  await logOutcome(saUser.id, config.appPublicId, result.ok, result.error);
}
