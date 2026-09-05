import { BadRequestException } from '@nestjs/common';
import { evaluatePasswordPolicy, PasswordPolicy, PasswordRuleKey } from '@sassy-auth/types';

/**
 * Fixed security floor, not a policy knob — bounds the scrypt hashing cost
 * an unauthenticated caller can force per request (bug-0184's rationale,
 * now applied uniformly across every password-setting surface instead of
 * only accept-invite).
 */
export const MAX_PASSWORD_LENGTH = 256;

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value.toLowerCase() === 'true';
}

function parseInt10(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

/**
 * Global default policy, read from env. Defaults reproduce the exact
 * bug-0280 policy (12/upper/lower/number required, no special-char
 * requirement) so this change is behavior-neutral for any app that never
 * opts into an override.
 */
export function getGlobalPasswordPolicy(env: NodeJS.ProcessEnv | Record<string, string | undefined>): PasswordPolicy {
  return {
    minLength: parseInt10(env['PASSWORD_MIN_LENGTH'], 12),
    requireUppercase: parseBool(env['PASSWORD_REQUIRE_UPPERCASE'], true),
    requireLowercase: parseBool(env['PASSWORD_REQUIRE_LOWERCASE'], true),
    requireNumber: parseBool(env['PASSWORD_REQUIRE_NUMBER'], true),
    requireSpecial: parseBool(env['PASSWORD_REQUIRE_SPECIAL'], false),
    minNumbers: parseInt10(env['PASSWORD_MIN_NUMBERS'], 1),
    minSpecial: parseInt10(env['PASSWORD_MIN_SPECIAL'], 0),
  };
}

/**
 * null passwordPolicyOverride → inherit the global policy. Non-null → a
 * complete PasswordPolicy that fully replaces the global one — no
 * per-field mix (see design spec §4).
 */
export function resolvePasswordPolicy(
  app: { passwordPolicyOverride: unknown },
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): PasswordPolicy {
  if (app.passwordPolicyOverride) {
    return app.passwordPolicyOverride as PasswordPolicy;
  }
  return getGlobalPasswordPolicy(env);
}

/** Every rule in `policy` that `password` violates, plus the synthetic
 * 'maxLength' rule key if it exceeds MAX_PASSWORD_LENGTH. Shared by every
 * password-setting surface (NestJS-owned services via validatePasswordOrThrow
 * below, and the BetterAuth hooks.before matcher in auth.config.ts, which
 * isn't NestJS-owned and can't use a NestJS exception) so the "what counts as
 * a violation" logic exists in exactly one place. */
export function getFailedPasswordRules(password: string, policy: PasswordPolicy): Array<PasswordRuleKey | 'maxLength'> {
  const failedRules: Array<PasswordRuleKey | 'maxLength'> = evaluatePasswordPolicy(password, policy)
    .filter((r) => !r.met)
    .map((r) => r.rule);
  if (password.length > MAX_PASSWORD_LENGTH) {
    failedRules.push('maxLength');
  }
  return failedRules;
}

/** Throws BadRequestException({ errorKey, failedRules }) listing every
 * violated rule (plus 'maxLength' as a synthetic rule key) if the password
 * fails. Every password-setting surface calls this exactly once. */
export function validatePasswordOrThrow(password: string, policy: PasswordPolicy): void {
  const failedRules = getFailedPasswordRules(password, policy);
  if (failedRules.length > 0) {
    throw new BadRequestException({ errorKey: 'password.policyViolation', failedRules });
  }
}
