import type { EmailMessageParts } from '../email.types';

export function signInCodeEmail(args: { otp: string; minutes: number }): EmailMessageParts {
  const { otp, minutes } = args;
  return {
    subject: 'Your Sassy Auth sign-in code',
    text: `Your sign-in code is ${otp}. It expires in ${minutes} minutes.\n\nIf you didn't request this, you can ignore this email.`,
    html: `<p>Your sign-in code is <strong>${otp}</strong>.</p><p>It expires in ${minutes} minutes.</p><p>If you didn't request this, you can ignore this email.</p>`,
  };
}
