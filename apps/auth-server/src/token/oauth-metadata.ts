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

// Must match setGlobalPrefix() in configure-nest-app.ts.
const NEST_GLOBAL_PREFIX = 'api';

// RFC 8414 well-known URI. Must be served at the host root, not under /api.
export const OAUTH_AS_METADATA_PATH = '.well-known/oauth-authorization-server';

const RESPONSE_TYPES_SUPPORTED = ['code'] as const;
const GRANT_TYPES_SUPPORTED = ['authorization_code'] as const;
const CODE_CHALLENGE_METHODS_SUPPORTED = ['S256'] as const;
// Public PKCE clients only — there is no client_secret-based auth on /token.
const TOKEN_ENDPOINT_AUTH_METHODS_SUPPORTED = ['none'] as const;

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
