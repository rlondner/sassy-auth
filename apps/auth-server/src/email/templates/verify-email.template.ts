import { renderTemplate, type ActivationEmailBranding } from '@sassy-auth/types';
import type { EmailMessageParts } from '../email.types';

const DEFAULT_SUBJECT = 'Verify your {{appName}} email address';
const DEFAULT_MESSAGE = 'Confirm your email address to finish setting up your account:';

/**
 * Bulletproof table-based button — renders correctly in Outlook/Gmail/Apple
 * Mail without relying on border-radius or flex support. Never part of an
 * admin-customizable template (see design §3): the link must always be
 * present and correctly formatted.
 */
function renderButton(url: string): string {
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 24px 0;">` +
    `<tr><td align="center" bgcolor="#2563eb" style="border-radius: 8px;">` +
    `<a href="${url}" target="_blank" style="display: inline-block; padding: 14px 32px; font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; font-size: 16px; font-weight: 600; color: #ffffff; text-decoration: none; border-radius: 8px;">Confirm your email address</a>` +
    `</td></tr></table>`
  );
}

/**
 * Escapes the five characters that matter for safe interpolation into HTML
 * text content (not attributes). `branding.message` is admin-supplied
 * per-app copy (apps.service.ts's assertValidActivationEmailOverride only
 * checks type and rejects embedded newlines — it does not, and should not,
 * reject markup, since some HTML-ish characters are legitimate copy) and
 * was being spliced into `<p>${message}</p>` unescaped below: an app admin
 * (anyone holding `platform.apps.manage`, not necessarily a fully trusted
 * operator) could inject arbitrary markup — a fake link overlaying the real
 * "Confirm your email address" button, a remote-loaded tracking `<img>`, or
 * spoofed sender-look-alike content — into the activation email every
 * end user of that app receives. Applied only to the HTML rendering; `text`
 * stays a plain, unescaped copy of the same message.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function computeFrom(branding?: ActivationEmailBranding): string | undefined {
  const name = branding?.fromName?.trim();
  const address = branding?.fromAddress?.trim();
  if (name && address) return `${name} <${address}>`;
  return address || name || undefined;
}

export function verificationEmail(args: {
  firstName: string;
  verifyUrl: string;
  appName: string;
  branding?: ActivationEmailBranding;
}): EmailMessageParts & { from?: string } {
  const { firstName, verifyUrl, appName, branding } = args;
  const vars = { firstName, appName, activationUrl: verifyUrl };
  const subject = renderTemplate(branding?.subject?.trim() || DEFAULT_SUBJECT, vars);
  const message = renderTemplate(branding?.message?.trim() || DEFAULT_MESSAGE, vars);
  const from = computeFrom(branding);

  return {
    subject,
    text: `Hi ${firstName},\n\n${message}\n${verifyUrl}\n\nIf you didn't create this account, you can ignore this email.`,
    html:
      `<p>Hi ${firstName},</p><p>${escapeHtml(message)}</p>${renderButton(verifyUrl)}` +
      `<p style="word-break: break-all;"><a href="${verifyUrl}">${verifyUrl}</a></p>` +
      `<p>If you didn't create this account, you can ignore this email.</p>`,
    ...(from !== undefined && { from }),
  };
}
