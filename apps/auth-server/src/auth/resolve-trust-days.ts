/**
 * Resolves the effective 2FA trust / re-prompt interval for a given app.
 *
 * The system-wide default is sourced from the TWO_FACTOR_TRUST_DAYS env var
 * (default 14 days). An individual SaApp can override this via its
 * twoFactorTrustDays column; the override is honoured only when it is a
 * positive integer — null, zero, or negative values fall back to the system
 * default.
 *
 * Both trust-device cookie lifetime and the optional-proposal re-prompt
 * threshold use this value.
 */

const FALLBACK_DAYS = 14;

/**
 * Read the system-wide default from the environment. Returns 14 if the env
 * var is absent, empty, zero, negative, fractional, or not a finite positive
 * integer.
 */
export function getSystemTrustDays(): number {
  const raw = process.env['TWO_FACTOR_TRUST_DAYS'];
  if (!raw) return FALLBACK_DAYS;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return FALLBACK_DAYS;
  return n;
}

/**
 * Resolve the effective trust-days value for a specific app.
 *
 * @param app - Object containing the app's optional twoFactorTrustDays field.
 * @param systemDefault - The system-wide default, typically from getSystemTrustDays().
 * @returns The resolved interval in days (always a positive integer).
 */
export function resolveTrustDays(
  app: { twoFactorTrustDays: number | null },
  systemDefault: number,
): number {
  const override = app.twoFactorTrustDays;
  if (override !== null && Number.isInteger(override) && override > 0) {
    return override;
  }
  return systemDefault;
}
