import { BadRequestException } from '@nestjs/common';
import { TokenErrorCode } from '@sassy-auth/types';
import { assertRedirectUriAllowed } from './redirect-uri';

describe('assertRedirectUriAllowed — default (no callbackUrl): origin match', () => {
  it('accepts exact origin with any path', () => {
    expect(() =>
      assertRedirectUriAllowed('https://example.com/auth/callback', { url: 'https://example.com' }),
    ).not.toThrow();
  });
  it('accepts when registered app.url has a trailing slash', () => {
    expect(() =>
      assertRedirectUriAllowed('https://example.com/cb', { url: 'https://example.com/' }),
    ).not.toThrow();
  });
  it('rejects different hosts', () => {
    expect(() =>
      assertRedirectUriAllowed('https://evil.example/cb', { url: 'https://example.com' }),
    ).toThrow(BadRequestException);
  });
  it('rejects different schemes', () => {
    expect(() =>
      assertRedirectUriAllowed('http://example.com/cb', { url: 'https://example.com' }),
    ).toThrow(BadRequestException);
  });
  it('rejects different ports', () => {
    expect(() =>
      assertRedirectUriAllowed('https://example.com:8443/cb', { url: 'https://example.com' }),
    ).toThrow(BadRequestException);
  });
  it('rejects malformed redirect_uri', () => {
    try {
      assertRedirectUriAllowed('not a url', { url: 'https://example.com' });
      fail('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      expect((e as Error).message).toContain(TokenErrorCode.INVALID_REDIRECT_URI);
    }
  });
  it('treats empty-string callbackUrl as default (origin match)', () => {
    expect(() =>
      assertRedirectUriAllowed('https://example.com/cb', { url: 'https://example.com', callbackUrl: '' }),
    ).not.toThrow();
  });
});

describe('assertRedirectUriAllowed — explicit callbackUrl: exact match', () => {
  const app = { url: 'https://example.com', callbackUrl: 'https://example.com/auth/cb' };

  it('accepts an exactly equal redirect_uri', () => {
    expect(() => assertRedirectUriAllowed('https://example.com/auth/cb', app)).not.toThrow();
  });
  it('accepts a trailing-slash variant (tolerant)', () => {
    expect(() => assertRedirectUriAllowed('https://example.com/auth/cb/', app)).not.toThrow();
  });
  it('accepts when stored value has the trailing slash and request does not', () => {
    const app2 = { url: 'https://example.com', callbackUrl: 'https://example.com/auth/cb/' };
    expect(() => assertRedirectUriAllowed('https://example.com/auth/cb', app2)).not.toThrow();
  });
  it('rejects a different path', () => {
    expect(() => assertRedirectUriAllowed('https://example.com/other', app)).toThrow(BadRequestException);
  });
  it('rejects a different query string', () => {
    const app2 = { url: 'https://example.com', callbackUrl: 'https://example.com/cb?x=1' };
    expect(() => assertRedirectUriAllowed('https://example.com/cb?x=2', app2)).toThrow(BadRequestException);
  });
  it('rejects a different host/port/scheme', () => {
    expect(() => assertRedirectUriAllowed('https://example.com:8443/auth/cb', app)).toThrow(BadRequestException);
    expect(() => assertRedirectUriAllowed('http://example.com/auth/cb', app)).toThrow(BadRequestException);
  });
  it('rejects a malformed redirect_uri', () => {
    expect(() => assertRedirectUriAllowed('not a url', app)).toThrow(BadRequestException);
  });
});
