import { prisma } from '@sassy-auth/db';
import { symmetricDecrypt } from 'better-auth/crypto';
import { createOTP } from '@better-auth/utils/otp';

/**
 * Session-less TOTP verification for the direct/login path.
 *
 * Mirrors better-auth's own /two-factor/verify-totp endpoint internals: read the
 * user's TwoFactor row, decrypt the secret with the app secret, and verify the
 * code with the same 6-digit / 30s parameters. No session or temp cookie needed.
 *
 * Never logs the secret or the entered code.
 */
export async function verifyUserTotp(betterAuthUserId: string, code: string): Promise<boolean> {
  const tf = await prisma.twoFactor.findUnique({ where: { userId: betterAuthUserId } });
  if (!tf) return false;
  const secret = await symmetricDecrypt({
    key: process.env.BETTER_AUTH_SECRET!,
    data: tf.secret,
  });
  return createOTP(secret, { period: 30, digits: 6 }).verify(code);
}
