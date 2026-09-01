// Single source of truth for the OAuth route paths + capabilities advertised
// via the RFC 8414 discovery doc at /.well-known/oauth-authorization-server.
//
// Both TokenController (which mounts the routes) and DiscoveryController
// (which advertises them) consume the constants below, so renaming a route or
// flipping a supported grant/PKCE method updates the discovery doc by
// construction. When you add or remove an OAuth surface, edit this file.

export const TOKEN_CONTROLLER_PATH = 'token';
export const OAUTH_AUTHORIZE_ROUTE = 'oauth/authorize';
export const OAUTH_TOKEN_ROUTE = 'oauth/token';
export const JWKS_ROUTE = 'jwks';

// Single source of truth for the Nest global prefix; consumed by both
// configure-nest-app.ts (which mounts it) and this module (which derives
// discovery URLs from it) so the two cannot drift.
export const NEST_GLOBAL_PREFIX = 'api';

// RFC 8414 well-known URI. Must be served at the host root, not under /api.
export const OAUTH_AS_METADATA_PATH = '.well-known/oauth-authorization-server';

// Documented placeholder advertised when BETTER_AUTH_URL is unset. Kept here
// so DiscoveryController and TokenService share the same fallback, preventing
// the discovery `issuer` and the JWT `iss` claim from diverging.
export const ISSUER_PLACEHOLDER = 'https://auth.example.com';

/**
 * Resolves the issuer used in both the discovery doc and JWT `iss` claim.
 * Strips a trailing slash from BETTER_AUTH_URL so RFC 8414 issuer matching
 * (which is string-exact) doesn't break on `auth.example.com/` vs
 * `auth.example.com`. Falls back to ISSUER_PLACEHOLDER when unset.
 */
export function resolveIssuer(): string {
  const raw = process.env.BETTER_AUTH_URL ?? ISSUER_PLACEHOLDER;
  return stripTrailingSlash(raw);
}

const RESPONSE_TYPES_SUPPORTED = ['code'] as const;
const GRANT_TYPES_SUPPORTED = ['authorization_code'] as const;
const CODE_CHALLENGE_METHODS_SUPPORTED = ['S256'] as const;
const TOKEN_ENDPOINT_AUTH_METHODS_SUPPORTED = [
  'none', 'client_secret_basic', 'client_secret_post',
] as const;

export interface OAuthAuthorizationServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  response_types_supported: readonly string[];
  grant_types_supported: readonly string[];
  code_challenge_methods_supported: readonly string[];
  token_endpoint_auth_methods_supported: readonly string[];
}

export function buildOAuthAuthorizationServerMetadata(
  issuer: string,
): OAuthAuthorizationServerMetadata {
  const base = stripTrailingSlash(issuer);
  const tokenRoot = `${base}/${NEST_GLOBAL_PREFIX}/${TOKEN_CONTROLLER_PATH}`;
  return {
    issuer: base,
    authorization_endpoint: `${tokenRoot}/${OAUTH_AUTHORIZE_ROUTE}`,
    token_endpoint: `${tokenRoot}/${OAUTH_TOKEN_ROUTE}`,
    jwks_uri: `${tokenRoot}/${JWKS_ROUTE}`,
    response_types_supported: [...RESPONSE_TYPES_SUPPORTED],
    grant_types_supported: [...GRANT_TYPES_SUPPORTED],
    code_challenge_methods_supported: [...CODE_CHALLENGE_METHODS_SUPPORTED],
    token_endpoint_auth_methods_supported: [...TOKEN_ENDPOINT_AUTH_METHODS_SUPPORTED],
  };
}

function stripTrailingSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

export const OAUTH_USERINFO_ROUTE = 'oauth/userinfo';
export const OAUTH_LOGOUT_ROUTE = 'oauth/logout';

// OIDC Discovery well-known URI. Like RFC 8414, served at the host root.
export const OIDC_METADATA_PATH = '.well-known/openid-configuration';

const SCOPES_SUPPORTED = ['openid', 'profile', 'email'] as const;
const SUBJECT_TYPES_SUPPORTED = ['public'] as const;
const ID_TOKEN_SIGNING_ALGS = ['RS256'] as const;
const CLAIMS_SUPPORTED = [
  'sub', 'iss', 'aud', 'exp', 'iat', 'auth_time', 'nonce', 'amr', 'at_hash',
  'org', 'name', 'given_name', 'family_name', 'email', 'email_verified',
] as const;

export interface OpenIdConfiguration {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  end_session_endpoint: string;
  jwks_uri: string;
  scopes_supported: readonly string[];
  response_types_supported: readonly string[];
  grant_types_supported: readonly string[];
  subject_types_supported: readonly string[];
  id_token_signing_alg_values_supported: readonly string[];
  code_challenge_methods_supported: readonly string[];
  token_endpoint_auth_methods_supported: readonly string[];
  claims_supported: readonly string[];
}

export function buildOpenIdConfiguration(issuer: string): OpenIdConfiguration {
  const oauth = buildOAuthAuthorizationServerMetadata(issuer);
  const base = stripTrailingSlash(issuer);
  const tokenRoot = `${base}/${NEST_GLOBAL_PREFIX}/${TOKEN_CONTROLLER_PATH}`;
  return {
    issuer: oauth.issuer,
    authorization_endpoint: oauth.authorization_endpoint,
    token_endpoint: oauth.token_endpoint,
    jwks_uri: oauth.jwks_uri,
    userinfo_endpoint: `${tokenRoot}/${OAUTH_USERINFO_ROUTE}`,
    end_session_endpoint: `${tokenRoot}/${OAUTH_LOGOUT_ROUTE}`,
    scopes_supported: [...SCOPES_SUPPORTED],
    response_types_supported: oauth.response_types_supported,
    grant_types_supported: oauth.grant_types_supported,
    subject_types_supported: [...SUBJECT_TYPES_SUPPORTED],
    id_token_signing_alg_values_supported: [...ID_TOKEN_SIGNING_ALGS],
    code_challenge_methods_supported: oauth.code_challenge_methods_supported,
    token_endpoint_auth_methods_supported: oauth.token_endpoint_auth_methods_supported,
    claims_supported: [...CLAIMS_SUPPORTED],
  };
}
