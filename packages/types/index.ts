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
   * Effective permissions — union of direct grants and all role permissions,
   * deduplicated, sorted alphabetically.
   */
  permissions: string[];
}

/** Machine-readable codes returned as the `error` field in 4xx JWT responses. */
export enum TokenErrorCode {
  USER_ORG_MISMATCH = 'USER_ORG_MISMATCH',
  APP_NOT_FOUND = 'APP_NOT_FOUND',
  USER_NOT_FOUND = 'USER_NOT_FOUND',
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  INVALID_CODE = 'INVALID_CODE',
  CODE_EXPIRED = 'CODE_EXPIRED',
}

/** Identifier type detected from the login identifier string. */
export type IdentifierType = 'email' | 'phone' | 'username';

/** Detects the type of a login identifier string. */
export function detectIdentifierType(identifier: string): IdentifierType {
  if (identifier.includes('@')) return 'email';
  if (/^\+?[\d\s\-().]{7,}$/.test(identifier)) return 'phone';
  return 'username';
}
