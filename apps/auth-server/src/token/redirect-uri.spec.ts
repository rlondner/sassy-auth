import { BadRequestException } from '@nestjs/common';
import { TokenErrorCode } from '@sassy-auth/types';
import { assertRedirectUriMatchesApp } from './redirect-uri';

describe('assertRedirectUriMatchesApp', () => {
  it('accepts exact origin with any path', () => {
    expect(() =>
      assertRedirectUriMatchesApp(
        'https://example.com/auth/callback',
        'https://example.com',
      ),
    ).not.toThrow();
  });

  it('accepts when the registered app.url has a trailing slash', () => {
    expect(() =>
      assertRedirectUriMatchesApp(
        'https://example.com/cb',
        'https://example.com/',
      ),
    ).not.toThrow();
  });

  it('rejects different hosts', () => {
    expect(() =>
      assertRedirectUriMatchesApp(
        'https://evil.example/cb',
        'https://example.com',
      ),
    ).toThrow(BadRequestException);
  });

  it('rejects different schemes', () => {
    expect(() =>
      assertRedirectUriMatchesApp(
        'http://example.com/cb',
        'https://example.com',
      ),
    ).toThrow(BadRequestException);
  });

  it('rejects different ports', () => {
    expect(() =>
      assertRedirectUriMatchesApp(
        'https://example.com:8443/cb',
        'https://example.com',
      ),
    ).toThrow(BadRequestException);
  });

  it('rejects malformed redirect_uri with TokenErrorCode.INVALID_REDIRECT_URI', () => {
    try {
      assertRedirectUriMatchesApp('not a url', 'https://example.com');
      fail('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      expect((e as Error).message).toContain(TokenErrorCode.INVALID_REDIRECT_URI);
    }
  });

  it('rejects malformed app.url with TokenErrorCode.INVALID_REDIRECT_URI', () => {
    expect(() =>
      assertRedirectUriMatchesApp('https://example.com/cb', 'not a url'),
    ).toThrow(/invalid_redirect_uri/);
  });
});
