/**
 * Effective 2FA-required resolution for an app.
 *
 * Non-platform apps use their own SaApp.requireTwoFactor column. The platform
 * app is immutable through the app UI, so its enforcement is an out-of-band
 * operational decision via the PLATFORM_REQUIRE_2FA env flag (default off).
 *
 * Only the exact string "true" (case-insensitive) enables it — any other value
 * is treated as off, so a stray "1"/"yes" never silently locks out operators.
 */
export function isPlatformTwoFactorRequired(): boolean {
  return (process.env['PLATFORM_REQUIRE_2FA'] ?? '').toLowerCase() === 'true';
}

export function isTwoFactorRequired(app: {
  requireTwoFactor: boolean;
  isPlatform: boolean;
}): boolean {
  if (app.requireTwoFactor) return true;
  return app.isPlatform && isPlatformTwoFactorRequired();
}
