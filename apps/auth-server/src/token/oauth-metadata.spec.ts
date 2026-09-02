import {
  buildOAuthAuthorizationServerMetadata,
  buildOpenIdConfiguration,
  ISSUER_PLACEHOLDER,
  JWKS_ROUTE,
  OAUTH_AUTHORIZE_ROUTE,
  OAUTH_TOKEN_ROUTE,
  TOKEN_CONTROLLER_PATH,
  resolveIssuer,
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
    expect(doc.token_endpoint_auth_methods_supported).toEqual([
      'none', 'client_secret_basic', 'client_secret_post',
    ]);
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

describe('buildOpenIdConfiguration', () => {
  const doc = buildOpenIdConfiguration('http://localhost:3000');

  it('advertises the OIDC endpoints under the API prefix', () => {
    expect(doc.issuer).toBe('http://localhost:3000');
    expect(doc.authorization_endpoint).toBe('http://localhost:3000/api/token/oauth/authorize');
    expect(doc.token_endpoint).toBe('http://localhost:3000/api/token/oauth/token');
    expect(doc.userinfo_endpoint).toBe('http://localhost:3000/api/token/oauth/userinfo');
    expect(doc.jwks_uri).toBe('http://localhost:3000/api/token/jwks');
  });

  it('advertises the supported OIDC capabilities', () => {
    expect(doc.scopes_supported).toEqual(['openid', 'profile', 'email']);
    expect(doc.response_types_supported).toEqual(['code']);
    expect(doc.grant_types_supported).toEqual(['authorization_code']);
    expect(doc.subject_types_supported).toEqual(['public']);
    expect(doc.id_token_signing_alg_values_supported).toEqual(['RS256']);
    expect(doc.code_challenge_methods_supported).toEqual(['S256']);
    expect(doc.token_endpoint_auth_methods_supported).toEqual([
      'none', 'client_secret_basic', 'client_secret_post',
    ]);
  });

  it('does not advertise offline_access — refresh tokens are unsupported', () => {
    expect(doc.scopes_supported).not.toContain('offline_access');
    expect(doc.grant_types_supported).not.toContain('refresh_token');
  });

  it('does not advertise end_session_endpoint — RP-Initiated Logout is not implemented (bug-0277)', () => {
    expect(doc).not.toHaveProperty('end_session_endpoint');
  });

  it('shares endpoint URLs with the RFC 8414 document', () => {
    const oauthDoc = buildOAuthAuthorizationServerMetadata('http://localhost:3000');
    expect(doc.authorization_endpoint).toBe(oauthDoc.authorization_endpoint);
    expect(doc.token_endpoint).toBe(oauthDoc.token_endpoint);
    expect(doc.jwks_uri).toBe(oauthDoc.jwks_uri);
  });
});

describe('resolveIssuer', () => {
  let originalIssuer: string | undefined;

  beforeEach(() => {
    originalIssuer = process.env.BETTER_AUTH_URL;
  });

  afterEach(() => {
    if (originalIssuer === undefined) delete process.env.BETTER_AUTH_URL;
    else process.env.BETTER_AUTH_URL = originalIssuer;
  });

  it('returns BETTER_AUTH_URL verbatim when set without a trailing slash', () => {
    process.env.BETTER_AUTH_URL = 'https://auth.prod.example.com';
    expect(resolveIssuer()).toBe('https://auth.prod.example.com');
  });

  it('strips a trailing slash so the value matches what discovery advertises', () => {
    process.env.BETTER_AUTH_URL = 'https://auth.prod.example.com/';
    expect(resolveIssuer()).toBe('https://auth.prod.example.com');
  });

  it('falls back to ISSUER_PLACEHOLDER when BETTER_AUTH_URL is unset', () => {
    delete process.env.BETTER_AUTH_URL;
    expect(resolveIssuer()).toBe(ISSUER_PLACEHOLDER);
  });

  it('lets TokenService and DiscoveryController agree on the issuer string (no trailing-slash drift)', () => {
    process.env.BETTER_AUTH_URL = 'https://auth.prod.example.com/';
    const tokenIssuer = resolveIssuer();
    const discoveryDoc = buildOAuthAuthorizationServerMetadata(resolveIssuer());
    expect(tokenIssuer).toBe(discoveryDoc.issuer);
  });
});
