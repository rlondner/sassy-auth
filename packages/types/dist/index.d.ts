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
export declare enum TokenErrorCode {
    USER_ORG_MISMATCH = "USER_ORG_MISMATCH",
    APP_NOT_FOUND = "APP_NOT_FOUND",
    USER_NOT_FOUND = "USER_NOT_FOUND",
    INVALID_CREDENTIALS = "INVALID_CREDENTIALS",
    INVALID_REQUEST = "invalid_request",
    INVALID_REDIRECT_URI = "invalid_redirect_uri",
    INVALID_GRANT = "invalid_grant",
    INVALID_CLIENT = "invalid_client",
    UNAUTHORIZED_CLIENT = "unauthorized_client",
    TWO_FACTOR_REQUIRED = "TWO_FACTOR_REQUIRED"
}
/** Identifier type detected from the login identifier string. */
export type IdentifierType = 'email' | 'phone' | 'username';
/** Detects the type of a login identifier string. */
export declare function detectIdentifierType(identifier: string): IdentifierType;
/** The complete set of password-complexity knobs. An app either inherits the
 * global policy or defines a complete override — there is no per-field mix. */
export interface PasswordPolicy {
    minLength: number;
    requireUppercase: boolean;
    requireLowercase: boolean;
    requireNumber: boolean;
    requireSpecial: boolean;
    /** Only meaningful when requireNumber is true. */
    minNumbers: number;
    /** Only meaningful when requireSpecial is true. */
    minSpecial: number;
}
export type PasswordRuleKey = 'minLength' | 'requireUppercase' | 'requireLowercase' | 'requireNumber' | 'requireSpecial' | 'minNumbers' | 'minSpecial';
export interface PasswordRuleResult {
    rule: PasswordRuleKey;
    met: boolean;
}
/**
 * Pure, dependency-free. Evaluates every rule (does not short-circuit) so
 * callers can report or render every failure, not just the first one hit.
 */
export declare function evaluatePasswordPolicy(password: string, policy: PasswordPolicy): PasswordRuleResult[];
export declare const APP_LOGO_MAX_BYTES: number;
export declare const APP_LOGO_ALLOWED_MIME_TYPES: readonly ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
/**
 * True when `value` is a data URI of an allowed image type whose decoded
 * byte size is within APP_LOGO_MAX_BYTES. Used both by the admin console's
 * client-side file picker (before FileReader output is stored in state)
 * and by the auth-server's IsAppLogo class-validator decorator (before a
 * write hits the database) — one definition, two enforcement points.
 */
export declare function isValidAppLogoDataUri(value: unknown): boolean;
