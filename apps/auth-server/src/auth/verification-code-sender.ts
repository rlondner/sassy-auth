import type { ActivationEmailBranding } from '@sassy-auth/types';
import { verificationCodeEmail } from '../email/templates/verify-email-code.template';

export interface SendVerificationCodeDeps {
  /** Normally `(data) => auth.api.createVerificationOTP({ body: data })`. */
  createOtp(data: { email: string; type: 'email-verification' }): Promise<string>;
  emailer: {
    send(msg: { to: string; subject: string; html: string; text: string; from?: string }): Promise<{ sent: boolean }>;
  };
}

/**
 * Generates and stores a 6-digit email-verification OTP via BetterAuth's
 * emailOTP plugin, then emails it using the same ActivationEmailBranding
 * shape the link-based verification email uses. Kept separate from
 * auth.config.ts so it can be unit tested without a fully-initialized
 * BetterAuth instance (see auth.config.spec.ts's shallow mocking of
 * @sassy-auth/db and the Prisma adapter).
 */
export async function sendVerificationCode(
  deps: SendVerificationCodeDeps,
  data: { email: string; firstName: string; appName: string; branding?: ActivationEmailBranding },
): Promise<void> {
  const { createOtp, emailer } = deps;
  const { email, firstName, appName, branding } = data;
  const otp = await createOtp({ email, type: 'email-verification' });
  const parts = verificationCodeEmail({ firstName, otp, appName, branding });
  // Explicitly include `from` even when undefined (rather than relying on the
  // spread to omit it) so callers/tests that assert on the message shape see
  // a stable `from` key regardless of whether branding set it.
  await emailer.send({ to: email, ...parts, from: parts.from });
}
