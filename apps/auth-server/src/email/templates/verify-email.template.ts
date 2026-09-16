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
      `<p>Hi ${firstName},</p><p>${message}</p>${renderButton(verifyUrl)}` +
      `<p style="word-break: break-all;"><a href="${verifyUrl}">${verifyUrl}</a></p>` +
      `<p>If you didn't create this account, you can ignore this email.</p>`,
    ...(from !== undefined && { from }),
  };
}
