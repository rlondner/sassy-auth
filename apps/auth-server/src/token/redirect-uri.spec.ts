import { BadRequestException } from '@nestjs/common';
import { TokenErrorCode } from '@sassy-auth/types';
import { assertRedirectUriAllowed, assertPostLogoutRedirectUriAllowed } from './redirect-uri';

describe('assertRedirectUriAllowed — no registered URIs: origin fallback', () => {
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
});

describe('assertRedirectUriAllowed — set-valued matching', () => {
  it('accepts any registered login URI', () => {
    const app = {
      url: 'https://app.example.com',
      redirectUris: [
        { uri: 'https://app.example.com/cb', kind: 'login' },
        { uri: 'http://localhost:3000/cb', kind: 'login' },
      ],
    };

    expect(() => assertRedirectUriAllowed('http://localhost:3000/cb', app)).not.toThrow();
    expect(() => assertRedirectUriAllowed('https://app.example.com/cb', app)).not.toThrow();
  });

  it('rejects a same-origin path once URIs are registered', () => {
    const app = {
      url: 'https://app.example.com',
      redirectUris: [{ uri: 'https://app.example.com/cb', kind: 'login' }],
    };

    expect(() => assertRedirectUriAllowed('https://app.example.com/evil', app)).toThrow();
  });

  it('ignores post_logout URIs when matching a login redirect', () => {
    const app = {
      url: 'https://app.example.com',
      redirectUris: [
        { uri: 'https://app.example.com/cb', kind: 'login' },
        { uri: 'https://app.example.com/bye', kind: 'post_logout' },
      ],
    };

    expect(() => assertRedirectUriAllowed('https://app.example.com/bye', app)).toThrow();
  });

  it('falls back to same-origin matching when no login URIs are registered', () => {
    const app = { url: 'https://app.example.com', redirectUris: [] };

    expect(() => assertRedirectUriAllowed('https://app.example.com/anything', app)).not.toThrow();
    expect(() => assertRedirectUriAllowed('https://evil.example.com/cb', app)).toThrow();
  });
});

describe('assertPostLogoutRedirectUriAllowed', () => {
  it('accepts only registered post_logout URIs', () => {
    const app = {
      url: 'https://app.example.com',
      redirectUris: [
        { uri: 'https://app.example.com/cb', kind: 'login' },
        { uri: 'https://app.example.com/bye', kind: 'post_logout' },
      ],
    };

    expect(() => assertPostLogoutRedirectUriAllowed('https://app.example.com/bye', app)).not.toThrow();
    expect(() => assertPostLogoutRedirectUriAllowed('https://app.example.com/cb', app)).toThrow();
  });

  it('has no same-origin fallback — an unregistered URI is always rejected', () => {
    const app = { url: 'https://app.example.com', redirectUris: [] };

    expect(() => assertPostLogoutRedirectUriAllowed('https://app.example.com/bye', app)).toThrow();
  });
});
