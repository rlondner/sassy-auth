/**
 * Resolves the effective 2FA trust / re-prompt interval for a given app, and
 * separately, whether the optional 2FA setup interstitial is shown at all.
 *
 * The system-wide trust-days default is sourced from the TWO_FACTOR_TRUST_DAYS
 * env var (default 14 days). An individual SaApp can override this via its
 * twoFactorTrustDays column; the override is honoured only when it is a
 * positive integer — null, zero, or negative values fall back to the system
 * default.
 *
 * Both trust-device cookie lifetime and the optional-proposal re-prompt
 * threshold use this value.
 *
 * The system-wide prompt-enabled default is sourced from the
 * TWO_FACTOR_PROMPT_ENABLED env var (default true / fail open). An individual
 * SaApp can override this via its twoFactorPromptEnabled column; the override
 * is honoured whenever it is explicitly true or false — null falls back to
 * the system default.
 *
 * These are two independent concerns with no shared internal state.
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

/**
 * Read the system-wide default for whether the optional 2FA setup
 * interstitial is shown at all, from TWO_FACTOR_PROMPT_ENABLED. Fails open:
 * anything other than an explicit "false"/"0" (case-insensitive) is treated
 * as enabled, so a malformed env var never silently disables the prompt
 * fleet-wide.
 */
export function getSystemPromptEnabled(): boolean {
  const raw = process.env['TWO_FACTOR_PROMPT_ENABLED'];
  if (raw === undefined || raw === '') return true;
  return raw.toLowerCase() !== 'false' && raw !== '0';
}

/**
 * Resolve the effective prompt-enabled value for a specific app.
 *
 * @param app - Object containing the app's optional twoFactorPromptEnabled field.
 * @param systemDefault - The system-wide default, typically from getSystemPromptEnabled().
 */
export function resolvePromptEnabled(
  app: { twoFactorPromptEnabled: boolean | null },
  systemDefault: boolean,
): boolean {
  return app.twoFactorPromptEnabled ?? systemDefault;
}
