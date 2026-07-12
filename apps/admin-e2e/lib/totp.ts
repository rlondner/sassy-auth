import * as OTPAuth from 'otpauth'

/**
 * Compute the current TOTP code from a base32-encoded secret.
 * Uses 6 digits, 30-second period, SHA1 — matching BetterAuth twoFactor
 * plugin defaults (compatible with Google Authenticator / Authy).
 */
export function computeTotp(base32Secret: string): string {
  const totp = new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(base32Secret),
    digits: 6,
    period: 30,
    algorithm: 'SHA1',
  })
  return totp.generate()
}
