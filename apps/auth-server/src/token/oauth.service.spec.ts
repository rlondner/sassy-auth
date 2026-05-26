import { Test } from '@nestjs/testing';
import { OauthService } from './oauth.service';

describe('OauthService', () => {
  let service: OauthService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [OauthService],
    }).compile();
    service = module.get(OauthService);
    jest.clearAllMocks();
  });

  describe('generateCode', () => {
    it('returns a non-empty string code', () => {
      const code = service.generateCode('user-1', 'app-1');
      expect(typeof code).toBe('string');
      expect(code.length).toBeGreaterThan(10);
    });

    it('generates unique codes for different calls', () => {
      const a = service.generateCode('user-1', 'app-1');
      const b = service.generateCode('user-1', 'app-1');
      expect(a).not.toBe(b);
    });
  });

  describe('exchangeCode', () => {
    it('returns userId and appPublicId for a valid code', () => {
      const code = service.generateCode('user-99', 'app-55');
      const result = service.exchangeCode(code, 'app-55');
      expect(result).toEqual({ userId: 'user-99', appPublicId: 'app-55' });
    });

    it('throws when code does not exist', () => {
      expect(() => service.exchangeCode('nonexistent', 'app-1')).toThrow(
        /INVALID_CODE/,
      );
    });

    it('throws when appPublicId does not match', () => {
      const code = service.generateCode('user-1', 'app-correct');
      expect(() => service.exchangeCode(code, 'app-wrong')).toThrow(
        /INVALID_CODE/,
      );
    });

    it('throws when code is expired', () => {
      jest.useFakeTimers();
      const code = service.generateCode('user-1', 'app-1');
      // Advance time by 6 minutes (codes expire after 5 minutes)
      jest.advanceTimersByTime(6 * 60 * 1000);
      expect(() => service.exchangeCode(code, 'app-1')).toThrow(/CODE_EXPIRED/);
      jest.useRealTimers();
    });

    it('invalidates a code after use (one-time use)', () => {
      const code = service.generateCode('user-1', 'app-1');
      service.exchangeCode(code, 'app-1'); // first use succeeds
      expect(() => service.exchangeCode(code, 'app-1')).toThrow(/INVALID_CODE/);
    });
  });
});
