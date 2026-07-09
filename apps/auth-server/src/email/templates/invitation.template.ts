import type { EmailMessageParts } from '../email.types';

export function invitationEmail(args: { firstName: string; inviteUrl: string }): EmailMessageParts {
  const { firstName, inviteUrl } = args;
  return {
    subject: "You've been invited to Sassy Auth",
    text: `Hi ${firstName},\n\nYou've been invited. Set your password to activate your account:\n${inviteUrl}\n\nThis link expires in 7 days.`,
    html: `<p>Hi ${firstName},</p><p>You've been invited. Set your password to activate your account:</p><p><a href="${inviteUrl}">${inviteUrl}</a></p><p>This link expires in 7 days.</p>`,
  };
}
