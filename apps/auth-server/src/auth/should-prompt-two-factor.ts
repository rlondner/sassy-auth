/**
 * Pure decision function: should the optional "Set up 2FA" interstitial be
 * shown to this user after a successful password login?
 *
 * Returns true only when:
 * - The user does NOT yet have 2FA enabled, AND
 * - They have never been prompted (promptedAt is null) OR the last prompt was
 *   strictly more than intervalDays ago. The boundary itself (elapsed === interval)
 *   returns false to avoid edge-case re-prompts at the exact expiry instant.
 *
 * intervalDays = 0 means "always prompt if not enrolled" (useful for testing).
 */
export interface ShouldPromptParams {
  twoFactorEnabled: boolean;
  promptedAt: Date | null;
  now: Date;
  intervalDays: number;
}

export function shouldPromptTwoFactor({
  twoFactorEnabled,
  promptedAt,
  now,
  intervalDays,
}: ShouldPromptParams): boolean {
  if (twoFactorEnabled) return false;
  if (promptedAt === null) return true;
  const intervalMs = intervalDays * 24 * 60 * 60 * 1000;
  const elapsedMs = now.getTime() - promptedAt.getTime();
  return elapsedMs > intervalMs;
}
