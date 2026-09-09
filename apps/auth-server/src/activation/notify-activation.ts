import * as crypto from 'crypto';
import { prisma } from '@sassy-auth/db';

const WEBHOOK_TIMEOUT_MS = 5000;

interface DeliveryConfig {
  webhookUrl: string;
  webhookSecret: string;
  appPublicId: string;
}

async function resolveDeliveryConfig(orgId: number): Promise<DeliveryConfig | null> {
  const org = await prisma.saOrg.findUnique({
    where: { id: orgId },
    select: { app: { select: { publicId: true, webhookUrl: true, webhookSecret: true } } },
  });
  if (!org?.app.webhookUrl || !org.app.webhookSecret) return null;
  return { webhookUrl: org.app.webhookUrl, webhookSecret: org.app.webhookSecret, appPublicId: org.app.publicId };
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
export async function notifyActivation(saUser: { id: number; publicId: string; orgId: number }): Promise<void> {
  let config: DeliveryConfig | null;
  try {
    config = await resolveDeliveryConfig(saUser.orgId);
  } catch {
    return;
  }
  if (!config) return;

  const body = JSON.stringify({
    event: 'account.activated',
    userId: saUser.publicId,
    appPublicId: config.appPublicId,
    activatedAt: new Date().toISOString(),
  });
  const signature = crypto.createHmac('sha256', config.webhookSecret).update(body).digest('hex');

  let result = await postOnce(config.webhookUrl, body, signature);
  if (!result.ok && isRetryable(result.error!)) {
    result = await postOnce(config.webhookUrl, body, signature);
  }

  await logOutcome(saUser.id, config.appPublicId, result.ok, result.error);
}
