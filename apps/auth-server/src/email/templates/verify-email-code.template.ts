import { renderTemplate, type ActivationEmailBranding } from '@sassy-auth/types';
import type { EmailMessageParts } from '../email.types';

const DEFAULT_SUBJECT = 'Verify your {{appName}} email address';
const DEFAULT_MESSAGE = 'Enter this code to verify your email address:';

/**
 * Fixed, non-admin-customizable code display — same rationale as
 * verify-email.template.ts's renderButton: the mechanism of verification
 * must never be something an admin's custom `message` text can spoof or
 * omit.
 */
function renderCode(otp: string): string {
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 24px 0;">` +
    `<tr><td align="center" style="background: #f3f4f6; border-radius: 8px; padding: 16px 32px;">` +
    `<span style="font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #111827;">${otp}</span>` +
    `</td></tr></table>`
  );
}

/** Same escaping rationale as verify-email.template.ts's escapeHtml. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeHtmlMultiline(value: string): string {
  return escapeHtml(value).replace(/\r\n|\r|\n/g, '<br>');
}

function computeFrom(branding?: ActivationEmailBranding): string | undefined {
  const name = branding?.fromName?.trim();
  const address = branding?.fromAddress?.trim();
  if (name && address) return `${name} <${address}>`;
  return address || name || undefined;
}

export function verificationCodeEmail(args: {
  firstName: string;
  otp: string;
  appName: string;
  branding?: ActivationEmailBranding;
}): EmailMessageParts & { from?: string } {
  const { firstName, otp, appName, branding } = args;
  const vars = { firstName, appName };
  const subject = renderTemplate(branding?.subject?.trim() || DEFAULT_SUBJECT, vars);
  const message = renderTemplate(branding?.message?.trim() || DEFAULT_MESSAGE, vars);
  const from = computeFrom(branding);

  return {
    subject,
    text: `Hi ${firstName},\n\n${message}\n${otp}\n\nIf you didn't create this account, you can ignore this email.`,
    html:
      `<p>Hi ${firstName},</p><p>${escapeHtmlMultiline(message)}</p>${renderCode(otp)}` +
      `<p>If you didn't create this account, you can ignore this email.</p>`,
    ...(from !== undefined && { from }),
  };
}
