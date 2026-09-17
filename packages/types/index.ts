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

export const APP_LOGO_MAX_BYTES = 250 * 1024;

export const APP_LOGO_ALLOWED_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/svg+xml',
] as const;

const APP_LOGO_DATA_URI_PATTERN = new RegExp(
  `^data:(${APP_LOGO_ALLOWED_MIME_TYPES.map((t) => t.replace('/', '\\/').replace('+', '\\+')).join('|')});base64,([A-Za-z0-9+/]+=?=?)$`,
);

/**
 * True when `value` is a data URI of an allowed image type whose decoded
 * byte size is within APP_LOGO_MAX_BYTES. Used both by the admin console's
 * client-side file picker (before FileReader output is stored in state)
 * and by the auth-server's IsAppLogo class-validator decorator (before a
 * write hits the database) — one definition, two enforcement points.
 */
export function isValidAppLogoDataUri(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const match = APP_LOGO_DATA_URI_PATTERN.exec(value);
  if (!match) return false;
  const base64Payload = match[2];
  const padding = base64Payload.endsWith('==') ? 2 : base64Payload.endsWith('=') ? 1 : 0;
  const decodedBytes = (base64Payload.length * 3) / 4 - padding;
  return decodedBytes <= APP_LOGO_MAX_BYTES;
}

/**
 * Per-app override for the activation (email-verification) email. Every
 * field is optional and independently defaulted by the caller — omitted or
 * undefined means "use the platform default" for that field.
 */
export interface ActivationEmailBranding {
  fromName?: string;
  /** Domain must be verified with the email provider (e.g. Resend), or sends will fail. */
  fromAddress?: string;
  subject?: string;
  message?: string;
}

/**
 * Literal `{{token}}` substitution — no conditionals, no loops. A token not
 * present in `vars` is left in the output untouched, so a typo'd or removed
 * placeholder degrades visibly rather than silently vanishing.
 *
 * Does no output-context escaping — a caller substituting a value into HTML
 * (e.g. a user-supplied name) is responsible for escaping it first.
 */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match,
  );
}

/**
 * BetterAuth prefixes every cookie it issues with `__Secure-` (RFC 6265bis)
 * whenever `advanced.useSecureCookies` is on. auth-server's auth.config.ts
 * pins that flag to `NODE_ENV === 'production'`, independent of protocol or
 * the cookie's own `Secure` attribute. This applies to every BetterAuth
 * cookie — the session token, the two-factor plugin's temporary challenge
 * cookie, and its trust-device cookie all go through the same internal
 * `createAuthCookie` helper.
 *
 * apps/admin never imports BetterAuth's cookie machinery — it only sees raw
 * Set-Cookie/Cookie headers over HTTP — so it has no way to ask BetterAuth
 * what a cookie is actually named. It must independently compute the same
 * name, from the same production check, or the two sides drift: one side
 * renames a cookie while the other keeps looking for the unprefixed name,
 * and sign-in silently breaks (see auth.config.ts's dev(sec) comment for the
 * incident this traces to, which turned out to reproduce in production too).
 */
export type BetterAuthCookieName = 'session_token' | 'two_factor' | 'trust_device';

export function getBetterAuthCookieName(
  cookie: BetterAuthCookieName,
  isProduction: boolean,
): string {
  const base = `better-auth.${cookie}`;
  return isProduction ? `__Secure-${base}` : base;
}
