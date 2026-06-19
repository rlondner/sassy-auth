import {
  buildOAuthAuthorizationServerMetadata,
  JWKS_ROUTE,
  OAUTH_AUTHORIZE_ROUTE,
  OAUTH_TOKEN_ROUTE,
  TOKEN_CONTROLLER_PATH,
} from './oauth-metadata';

describe('buildOAuthAuthorizationServerMetadata', () => {
  it('derives endpoint URLs by joining issuer + /api/ + controller path + route constants', () => {
    const doc = buildOAuthAuthorizationServerMetadata('https://auth.example.com');
    expect(doc.issuer).toBe('https://auth.example.com');
    expect(doc.authorization_endpoint).toBe(
      `https://auth.example.com/api/${TOKEN_CONTROLLER_PATH}/${OAUTH_AUTHORIZE_ROUTE}`,
    );
    expect(doc.token_endpoint).toBe(
      `https://auth.example.com/api/${TOKEN_CONTROLLER_PATH}/${OAUTH_TOKEN_ROUTE}`,
    );
    expect(doc.jwks_uri).toBe(
      `https://auth.example.com/api/${TOKEN_CONTROLLER_PATH}/${JWKS_ROUTE}`,
    );
  });

  it('strips a trailing slash from the issuer to avoid // in derived URLs', () => {
    const doc = buildOAuthAuthorizationServerMetadata('https://auth.example.com/');
    expect(doc.issuer).toBe('https://auth.example.com');
    expect(doc.authorization_endpoint.includes('//api/')).toBe(false);
    expect(doc.token_endpoint.startsWith('https://auth.example.com/api/')).toBe(true);
  });

  it('advertises the OAuth capabilities the auth-server actually implements', () => {
    const doc = buildOAuthAuthorizationServerMetadata('http://localhost:3000');
    expect(doc.response_types_supported).toEqual(['code']);
    expect(doc.grant_types_supported).toEqual(['authorization_code']);
    expect(doc.code_challenge_methods_supported).toEqual(['S256']);
    // Public PKCE clients only — no client_secret support on /token.
    expect(doc.token_endpoint_auth_methods_supported).toEqual(['none']);
  });

  it('handles a localhost issuer with a non-default port', () => {
    const doc = buildOAuthAuthorizationServerMetadata('http://localhost:3000');
    expect(doc.issuer).toBe('http://localhost:3000');
    expect(doc.authorization_endpoint).toBe('http://localhost:3000/api/token/oauth/authorize');
    expect(doc.token_endpoint).toBe('http://localhost:3000/api/token/oauth/token');
    expect(doc.jwks_uri).toBe('http://localhost:3000/api/token/jwks');
  });

  it('produces only the fields documented in the OAuthAuthorizationServerMetadata interface', () => {
    const doc = buildOAuthAuthorizationServerMetadata('http://localhost:3000');
    expect(Object.keys(doc).sort()).toEqual(
      [
        'authorization_endpoint',
        'code_challenge_methods_supported',
        'grant_types_supported',
        'issuer',
        'jwks_uri',
        'response_types_supported',
        'token_endpoint',
        'token_endpoint_auth_methods_supported',
      ].sort(),
    );
  });
});
