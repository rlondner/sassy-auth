import { Test } from '@nestjs/testing';
import * as crypto from 'crypto';
import { OauthService } from './oauth.service';

function s256(verifier: string): string {
  return crypto
    .createHash('sha256')
    .update(verifier)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

describe('OauthService', () => {
  let service: OauthService;
  const VERIFIER = 'a'.repeat(64);
  const CHALLENGE = s256(VERIFIER);
  const REDIRECT_URI = 'https://app.example.com/callback';

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [OauthService],
    }).compile();
    service = module.get(OauthService);
    jest.useRealTimers();
  });

  describe('generateCode', () => {
    it('returns a non-empty unique string code', () => {
      const a = service.generateCode('user-1', 'app-1', REDIRECT_URI, CHALLENGE, 'S256');
      const b = service.generateCode('user-1', 'app-1', REDIRECT_URI, CHALLENGE, 'S256');
      expect(typeof a).toBe('string');
      expect(a.length).toBeGreaterThan(10);
      expect(a).not.toBe(b);
    });
  });

  describe('exchangeCode', () => {
    it('returns userId and appPublicId when verifier matches', () => {
      const code = service.generateCode('user-99', 'app-55', REDIRECT_URI, CHALLENGE, 'S256');
      const result = service.exchangeCode(code, 'app-55', REDIRECT_URI, VERIFIER);
      expect(result).toEqual({ userId: 'user-99', appPublicId: 'app-55' });
    });

    it('throws invalid_grant when code does not exist', () => {
      expect(() => service.exchangeCode('nonexistent', 'app-1', REDIRECT_URI, VERIFIER)).toThrow(
        /invalid_grant/,
      );
    });

    it('throws unauthorized_client when client_id does not match', () => {
      const code = service.generateCode('user-1', 'app-correct', REDIRECT_URI, CHALLENGE, 'S256');
      expect(() => service.exchangeCode(code, 'app-wrong', REDIRECT_URI, VERIFIER)).toThrow(
        /unauthorized_client/,
      );
    });

    it('throws invalid_grant when verifier does not match challenge', () => {
      const code = service.generateCode('user-1', 'app-1', REDIRECT_URI, CHALLENGE, 'S256');
      expect(() => service.exchangeCode(code, 'app-1', REDIRECT_URI, 'wrong-verifier')).toThrow(
        /invalid_grant/,
      );
    });

    it('throws invalid_grant when code is expired', () => {
      jest.useFakeTimers();
      const code = service.generateCode('user-1', 'app-1', REDIRECT_URI, CHALLENGE, 'S256');
      jest.advanceTimersByTime(6 * 60 * 1000);
      expect(() => service.exchangeCode(code, 'app-1', REDIRECT_URI, VERIFIER)).toThrow(
        /invalid_grant/,
      );
    });

    it('invalidates a code after first use', () => {
      const code = service.generateCode('user-1', 'app-1', REDIRECT_URI, CHALLENGE, 'S256');
      service.exchangeCode(code, 'app-1', REDIRECT_URI, VERIFIER);
      expect(() => service.exchangeCode(code, 'app-1', REDIRECT_URI, VERIFIER)).toThrow(
        /invalid_grant/,
      );
    });

    // bug-0054 — RFC 6749 §4.1.3: the redirect_uri sent at /token must
    // byte-exact match the redirect_uri that was bound to the code at
    // /authorize. The pre-existing `assertRedirectUriAllowed` check only
    // enforces the app's origin allow-list, not the per-code binding, so
    // an attacker who has intercepted a code could exchange it with a
    // different redirect_uri under the same allowed origin. This test
    // locks in that the exchange fails with invalid_grant on mismatch.
    it('throws invalid_grant when redirect_uri does not match the one bound at generateCode', () => {
      const code = service.generateCode('user-1', 'app-1', 'https://app.example.com/callback-A', CHALLENGE, 'S256');
      expect(() => service.exchangeCode(code, 'app-1', 'https://app.example.com/callback-B', VERIFIER)).toThrow(
        /invalid_grant/,
      );
    });

    // A single-character difference (trailing slash) must also fail —
    // that's the point of byte-exact comparison.
    it('throws invalid_grant when redirect_uri differs by trailing slash', () => {
      const code = service.generateCode('user-1', 'app-1', 'https://app.example.com/cb', CHALLENGE, 'S256');
      expect(() => service.exchangeCode(code, 'app-1', 'https://app.example.com/cb/', VERIFIER)).toThrow(
        /invalid_grant/,
      );
    });

    // The code must also be invalidated after a redirect_uri mismatch —
    // otherwise an attacker could brute-force by retrying with different
    // URIs. This test confirms the entry is deleted on the failure path.
    it('invalidates the code after a redirect_uri mismatch', () => {
      const code = service.generateCode('user-1', 'app-1', 'https://app.example.com/cb', CHALLENGE, 'S256');
      expect(() => service.exchangeCode(code, 'app-1', 'https://app.example.com/other', VERIFIER)).toThrow();
      // Retry with the correct redirect_uri: still rejected, because the entry was deleted.
      expect(() => service.exchangeCode(code, 'app-1', 'https://app.example.com/cb', VERIFIER)).toThrow(
        /invalid_grant/,
      );
    });
  });
});
