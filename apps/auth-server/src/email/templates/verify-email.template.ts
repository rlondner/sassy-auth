import type { EmailMessageParts } from '../email.types';

export function verifyEmailTemplate(args: { firstName: string; verifyUrl: string }): EmailMessageParts {
  const { firstName, verifyUrl } = args;
  return {
    subject: 'Verify your Sassy Auth email address',
    text: `Hi ${firstName},\n\nConfirm your email address to finish setting up your account:\n${verifyUrl}\n\nIf you didn't create this account, you can ignore this email.`,
    html: `<p>Hi ${firstName},</p><p>Confirm your email address to finish setting up your account:</p><p><a href="${verifyUrl}">${verifyUrl}</a></p><p>If you didn't create this account, you can ignore this email.</p>`,
  };
}
