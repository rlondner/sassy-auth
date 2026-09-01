import { BadRequestException, ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { TokenErrorCode } from '@sassy-auth/types';
import { buildClientErrorRedirectUrl, buildOauthErrorRedirectUrl, extractTokenErrorCode } from './oauth-error-redirect';

describe('extractTokenErrorCode', () => {
  it.each([
    [TokenErrorCode.INVALID_REQUEST],
    [TokenErrorCode.APP_NOT_FOUND],
    [TokenErrorCode.INVALID_REDIRECT_URI],
    [TokenErrorCode.USER_NOT_FOUND],
    [TokenErrorCode.USER_ORG_MISMATCH],
  ])('returns the code embedded in an HttpException message (%s)', (code) => {
    const err = new BadRequestException(code);
    expect(extractTokenErrorCode(err)).toBe(code);
  });

  it('returns null for UnauthorizedException', () => {
    expect(extractTokenErrorCode(new UnauthorizedException())).toBeNull();
  });

  it('returns null for unrecognized exception messages', () => {
    expect(extractTokenErrorCode(new ForbiddenException('not_a_token_error_code'))).toBeNull();
  });

  it('returns null for non-Http errors', () => {
    expect(extractTokenErrorCode(new Error('boom'))).toBeNull();
    expect(extractTokenErrorCode(null)).toBeNull();
    expect(extractTokenErrorCode(undefined)).toBeNull();
  });

  it('reads code from response.message when Nest wraps the message in an object', () => {
    // Nest's HttpException constructor accepts (string | object). When a NotFoundException
    // receives a string, getResponse() returns { statusCode, message, error }.
    const err = new NotFoundException(TokenErrorCode.APP_NOT_FOUND);
    expect(extractTokenErrorCode(err)).toBe(TokenErrorCode.APP_NOT_FOUND);
  });
});

describe('buildOauthErrorRedirectUrl', () => {
  it('builds a URL pointing at /oauth-error with the code in the query string', () => {
    const url = buildOauthErrorRedirectUrl('http://localhost:3001', TokenErrorCode.INVALID_REDIRECT_URI, '84LRe');
    expect(url).toBe('http://localhost:3001/oauth-error?code=invalid_redirect_uri&app=84LRe');
  });

  it('omits the app param when clientId is undefined', () => {
    const url = buildOauthErrorRedirectUrl('http://localhost:3001', TokenErrorCode.INVALID_REQUEST);
    expect(url).toBe('http://localhost:3001/oauth-error?code=invalid_request');
  });

  it('strips a trailing slash on adminUrl', () => {
    const url = buildOauthErrorRedirectUrl('http://localhost:3001/', TokenErrorCode.APP_NOT_FOUND, 'abc');
    expect(url).toBe('http://localhost:3001/oauth-error?code=APP_NOT_FOUND&app=abc');
  });

  it('URL-encodes special characters in clientId', () => {
    const url = buildOauthErrorRedirectUrl('http://localhost:3001', TokenErrorCode.APP_NOT_FOUND, 'a b/c');
    expect(url).toBe('http://localhost:3001/oauth-error?code=APP_NOT_FOUND&app=a+b%2Fc');
  });
});

describe('buildClientErrorRedirectUrl', () => {
  it('appends the OAuth error parameters to the client redirect URI', () => {
    const url = buildClientErrorRedirectUrl(
      'https://app.example.com/cb', 'login_required', 'No active session', 'xyz',
    );
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://app.example.com/cb');
    expect(parsed.searchParams.get('error')).toBe('login_required');
    expect(parsed.searchParams.get('error_description')).toBe('No active session');
    expect(parsed.searchParams.get('state')).toBe('xyz');
  });

  it('preserves an existing query string on the redirect URI', () => {
    const url = buildClientErrorRedirectUrl(
      'https://app.example.com/cb?tenant=acme', 'access_denied', 'Denied', '',
    );
    const parsed = new URL(url);
    expect(parsed.searchParams.get('tenant')).toBe('acme');
    expect(parsed.searchParams.get('error')).toBe('access_denied');
  });

  it('omits state when the client did not send one', () => {
    const url = buildClientErrorRedirectUrl('https://app.example.com/cb', 'access_denied', 'Denied', '');
    expect(new URL(url).searchParams.has('state')).toBe(false);
  });
});
