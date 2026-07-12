/**
 * In-memory store of the last OTP per recipient. ONLY written when
 * NODE_ENV === 'test' (see otp-sender). Read exclusively by the env-guarded
 * test-only endpoint (Task 4). Never used in production paths.
 */
const lastOtpByEmail = new Map<string, string>();

export const otpTestStore = {
  set(email: string, otp: string): void {
    lastOtpByEmail.set(email.toLowerCase(), otp);
  },
  get(email: string): string | undefined {
    return lastOtpByEmail.get(email.toLowerCase());
  },
};
