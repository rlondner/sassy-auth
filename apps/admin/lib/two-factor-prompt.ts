/**
 * Client-side copy of the shouldPromptTwoFactor logic.
 * The canonical version with full unit tests lives in:
 * apps/auth-server/src/auth/should-prompt-two-factor.ts
 * Keep these in sync.
 */
export function shouldPromptTwoFactor(params: {
  twoFactorEnabled: boolean;
  promptedAt: Date | null;
  now: Date;
  intervalDays: number;
  promptEnabled: boolean;
}): boolean {
  if (!params.promptEnabled) return false;
  if (params.twoFactorEnabled) return false;
  if (!params.promptedAt) return true;
  const intervalMs = params.intervalDays * 24 * 60 * 60 * 1000;
  return params.now.getTime() - params.promptedAt.getTime() > intervalMs;
}

/**
 * Reads TWO_FACTOR_TRUST_DAYS from process.env (available in Server Actions).
 * Default: 14 days.
 */
export function getSystemTrustDaysClient(): number {
  const raw = process.env['TWO_FACTOR_TRUST_DAYS'];
  if (!raw) return 14;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : 14;
}

/**
 * Reads TWO_FACTOR_PROMPT_ENABLED from process.env (available in Server
 * Actions). Fails open: anything other than an explicit "false"/"0"
 * (case-insensitive) is treated as enabled. Default: true.
 */
export function getSystemPromptEnabledClient(): boolean {
  const raw = process.env['TWO_FACTOR_PROMPT_ENABLED'];
  if (raw === undefined || raw === '') return true;
  return raw.toLowerCase() !== 'false' && raw !== '0';
}
