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

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [OauthService],
    }).compile();
    service = module.get(OauthService);
    jest.useRealTimers();
  });

  describe('generateCode', () => {
    it('returns a non-empty unique string code', () => {
      const a = service.generateCode('user-1', 'app-1', CHALLENGE, 'S256');
      const b = service.generateCode('user-1', 'app-1', CHALLENGE, 'S256');
      expect(typeof a).toBe('string');
      expect(a.length).toBeGreaterThan(10);
      expect(a).not.toBe(b);
    });
  });

  describe('exchangeCode', () => {
    it('returns userId and appPublicId when verifier matches', () => {
      const code = service.generateCode('user-99', 'app-55', CHALLENGE, 'S256');
      const result = service.exchangeCode(code, 'app-55', VERIFIER);
      expect(result).toEqual({ userId: 'user-99', appPublicId: 'app-55' });
    });

    it('throws invalid_grant when code does not exist', () => {
      expect(() => service.exchangeCode('nonexistent', 'app-1', VERIFIER)).toThrow(
        /invalid_grant/,
      );
    });

    it('throws unauthorized_client when client_id does not match', () => {
      const code = service.generateCode('user-1', 'app-correct', CHALLENGE, 'S256');
      expect(() => service.exchangeCode(code, 'app-wrong', VERIFIER)).toThrow(
        /unauthorized_client/,
      );
    });

    it('throws invalid_grant when verifier does not match challenge', () => {
      const code = service.generateCode('user-1', 'app-1', CHALLENGE, 'S256');
      expect(() => service.exchangeCode(code, 'app-1', 'wrong-verifier')).toThrow(
        /invalid_grant/,
      );
    });

    it('throws invalid_grant when code is expired', () => {
      jest.useFakeTimers();
      const code = service.generateCode('user-1', 'app-1', CHALLENGE, 'S256');
      jest.advanceTimersByTime(6 * 60 * 1000);
      expect(() => service.exchangeCode(code, 'app-1', VERIFIER)).toThrow(
        /invalid_grant/,
      );
    });

    it('invalidates a code after first use', () => {
      const code = service.generateCode('user-1', 'app-1', CHALLENGE, 'S256');
      service.exchangeCode(code, 'app-1', VERIFIER);
      expect(() => service.exchangeCode(code, 'app-1', VERIFIER)).toThrow(
        /invalid_grant/,
      );
    });
  });
});
