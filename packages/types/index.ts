/** Claims included in every RS256 JWT issued by SassyAuth. */
export interface SassyAuthJwtPayload {
  /** Issuer: base URL of the SassyAuth server */
  iss: string;
  /** Subject: sa_user.publicId (Sqid) */
  sub: string;
  /** Audience: sa_app.publicId (Sqid) of the target resource server */
  aud: string;
  /** Issued at (Unix seconds) */
  iat: number;
  /** Expires at (Unix seconds) */
  exp: number;
  /** Tenant: sa_org.publicId (Sqid) */
  org: string;
  /**
   * OAuth 2.0 scope claim — space-separated, sorted alphabetically. Union of
   * direct grants and all role permissions for the user, deduplicated.
   */
  scope: string;
}

/** Machine-readable codes returned as the `error` field in 4xx JWT responses. */
export enum TokenErrorCode {
  USER_ORG_MISMATCH = 'USER_ORG_MISMATCH',
  APP_NOT_FOUND = 'APP_NOT_FOUND',
  USER_NOT_FOUND = 'USER_NOT_FOUND',
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  INVALID_REQUEST = 'invalid_request',
  INVALID_REDIRECT_URI = 'invalid_redirect_uri',
  INVALID_GRANT = 'invalid_grant',
  INVALID_CLIENT = 'invalid_client',
  UNAUTHORIZED_CLIENT = 'unauthorized_client',
  TWO_FACTOR_REQUIRED = 'TWO_FACTOR_REQUIRED',
}

/** Identifier type detected from the login identifier string. */
export type IdentifierType = 'email' | 'phone' | 'username';

/** Detects the type of a login identifier string. */
export function detectIdentifierType(identifier: string): IdentifierType {
  if (identifier.includes('@')) return 'email';
  if (/^\+?[\d\s\-().]{7,}$/.test(identifier)) return 'phone';
  return 'username';
}

/** The complete set of password-complexity knobs. An app either inherits the
 * global policy or defines a complete override — there is no per-field mix. */
export interface PasswordPolicy {
  minLength: number
  requireUppercase: boolean
  requireLowercase: boolean
  requireNumber: boolean
  requireSpecial: boolean
  /** Only meaningful when requireNumber is true. */
  minNumbers: number
  /** Only meaningful when requireSpecial is true. */
  minSpecial: number
}

export type PasswordRuleKey =
  | 'minLength'
  | 'requireUppercase'
  | 'requireLowercase'
  | 'requireNumber'
  | 'requireSpecial'
  | 'minNumbers'
  | 'minSpecial'

export interface PasswordRuleResult {
  rule: PasswordRuleKey
  met: boolean
}

const SPECIAL_CHAR_PATTERN = /[!"#$%&'()*+,\-./:;<=>?@[\]^_`{|}~]/g

function countMatches(password: string, pattern: RegExp): number {
  return (password.match(pattern) ?? []).length
}

/**
 * Pure, dependency-free. Evaluates every rule (does not short-circuit) so
 * callers can report or render every failure, not just the first one hit.
 */
export function evaluatePasswordPolicy(
  password: string,
  policy: PasswordPolicy,
): PasswordRuleResult[] {
  const numberCount = countMatches(password, /[0-9]/g);
  const specialCount = countMatches(password, SPECIAL_CHAR_PATTERN);

  const results: PasswordRuleResult[] = [
    { rule: 'minLength', met: password.length >= policy.minLength },
  ];
  if (policy.requireUppercase) {
    results.push({ rule: 'requireUppercase', met: /[A-Z]/.test(password) });
  }
  if (policy.requireLowercase) {
    results.push({ rule: 'requireLowercase', met: /[a-z]/.test(password) });
  }
  if (policy.requireNumber) {
    results.push({ rule: 'requireNumber', met: numberCount >= 1 });
    if (policy.minNumbers > 1) {
      results.push({ rule: 'minNumbers', met: numberCount >= policy.minNumbers });
    }
  }
  if (policy.requireSpecial) {
    results.push({ rule: 'requireSpecial', met: specialCount >= 1 });
    if (policy.minSpecial > 1) {
      results.push({ rule: 'minSpecial', met: specialCount >= policy.minSpecial });
    }
  }
  return results;
}
