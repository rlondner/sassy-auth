import type { EmailMessageParts } from '../email.types';

export function passwordResetEmail(args: { firstName: string; resetUrl: string }): EmailMessageParts {
  const { firstName, resetUrl } = args;
  return {
    subject: 'Reset your Sassy Auth password',
    text: `Hi ${firstName},\n\nA password reset was requested. Choose a new password:\n${resetUrl}\n\nIf you didn't request this, you can ignore this email. This link expires in 1 hour.`,
    html: `<p>Hi ${firstName},</p><p>A password reset was requested. Choose a new password:</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>If you didn't request this, you can ignore this email. This link expires in 1 hour.</p>`,
  };
}
