import { Test } from '@nestjs/testing';
import * as crypto from 'crypto';
import { OauthService } from './oauth.service';

jest.mock('@sassy-auth/db', () => ({
  prisma: {
    saOauthCode: {
      create: jest.fn(),
      delete: jest.fn(),
    },
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockPrisma = require('@sassy-auth/db').prisma as {
  saOauthCode: { create: jest.Mock; delete: jest.Mock };
};

function s256(verifier: string): string {
  return crypto
    .createHash('sha256')
    .update(verifier)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

const VERIFIER = 'a'.repeat(64);
const CHALLENGE = s256(VERIFIER);
const REDIRECT_URI = 'https://app.example.com/callback';

function makeEntry(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    userId: 'user-99',
    appPublicId: 'app-55',
    redirectUri: REDIRECT_URI,
    codeChallenge: CHALLENGE,
    codeChallengeMethod: 'S256',
    expiresAt: new Date(Date.now() + 60_000),
    amr: JSON.stringify(['pwd']),
    nonce: null,
    scope: '',
    authTime: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('OauthService', () => {
  let service: OauthService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [OauthService],
    }).compile();
    service = module.get(OauthService);
    jest.clearAllMocks();
    jest.useRealTimers();
    mockPrisma.saOauthCode.create.mockResolvedValue({});
  });

  describe('generateCode', () => {
    it('inserts a row with all fields and returns the code', async () => {
      const authTime = new Date('2026-08-21T10:00:00Z');
      const code = await service.generateCode(
        'user-1', 'app-1', REDIRECT_URI, CHALLENGE, 'S256', ['pwd'], null, '', authTime,
      );
      expect(typeof code).toBe('string');
      expect(code.length).toBeGreaterThan(10);
      expect(mockPrisma.saOauthCode.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          code,
          userId: 'user-1',
          appPublicId: 'app-1',
          redirectUri: REDIRECT_URI,
          codeChallenge: CHALLENGE,
          codeChallengeMethod: 'S256',
          amr: JSON.stringify(['pwd']),
          nonce: null,
          scope: '',
          authTime,
          expiresAt: expect.any(Date),
        }),
      });
    });

    it('produces unique codes across consecutive calls', async () => {
      const authTime = new Date();
      const a = await service.generateCode('u', 'app', REDIRECT_URI, CHALLENGE, 'S256', ['pwd'], null, '', authTime);
      const b = await service.generateCode('u', 'app', REDIRECT_URI, CHALLENGE, 'S256', ['pwd'], null, '', authTime);
      expect(a).not.toBe(b);
    });

    it('persists nonce, scope, and authTime with the code', async () => {
      const authTime = new Date('2026-08-21T10:00:00Z');
      await service.generateCode('u_1', 'a_7', 'https://app/cb', 'chal', 'S256', ['pwd'], 'n-123', 'openid profile', authTime);

      expect(mockPrisma.saOauthCode.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          nonce: 'n-123', scope: 'openid profile', authTime,
        }),
      });
    });
  });

  describe('exchangeCode', () => {
    it('returns userId, appPublicId, and amr when everything matches', async () => {
      mockPrisma.saOauthCode.delete.mockResolvedValue(makeEntry());
      const result = await service.exchangeCode('some-code', 'app-55', REDIRECT_URI, VERIFIER);
      expect(result).toEqual({
        userId: 'user-99',
        appPublicId: 'app-55',
        amr: ['pwd'],
        nonce: null,
        scope: '',
        authTime: new Date('2026-01-01T00:00:00Z'),
        hadChallenge: true,
      });
      expect(mockPrisma.saOauthCode.delete).toHaveBeenCalledWith({ where: { code: 'some-code' } });
    });

    it('round-trips amr from generateCode to exchangeCode', async () => {
      const verifier = 'a'.repeat(64);
      const challenge = require('crypto').createHash('sha256').update(verifier)
        .digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      // Wire up the mock: create captures the data, delete returns it back
      let capturedData: Record<string, unknown> = {};
      mockPrisma.saOauthCode.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => {
        capturedData = data;
        return Promise.resolve({});
      });
      mockPrisma.saOauthCode.delete.mockImplementation(() =>
        Promise.resolve({
          ...capturedData,
          expiresAt: new Date(Date.now() + 60_000),
        }),
      );
      const code = await service.generateCode(
        'u_pub', 'a_pub', 'https://rs.example/cb', challenge, 'S256', ['pwd', 'otp', 'mfa'],
        null, '', new Date(),
      );
      const out = await service.exchangeCode(code, 'a_pub', 'https://rs.example/cb', verifier);
      expect(out.amr).toEqual(['pwd', 'otp', 'mfa']);
    });

    // Prisma raises P2025 when `delete` targets a row that does not
    // exist. This is the only path where the delete throws — successful
    // deletes always return the row.
    it('throws invalid_grant when the code does not exist (Prisma P2025)', async () => {
      mockPrisma.saOauthCode.delete.mockRejectedValue({ code: 'P2025' });
      await expect(
        service.exchangeCode('nonexistent', 'app-1', REDIRECT_URI, VERIFIER),
      ).rejects.toThrow(/invalid_grant/);
    });

    // bug-0039 race safety — two concurrent exchanges of the same code:
    // only one delete succeeds. This is the second one, which sees
    // P2025 (previously it would see `!entry` from the in-memory Map).
    it('closes the concurrent-exchange race via Prisma delete atomicity', async () => {
      // Concurrent call 1: succeeds.
      mockPrisma.saOauthCode.delete.mockResolvedValueOnce(makeEntry());
      // Concurrent call 2: sees row already deleted by call 1.
      mockPrisma.saOauthCode.delete.mockRejectedValueOnce({ code: 'P2025' });

      const [first, second] = await Promise.allSettled([
        service.exchangeCode('shared-code', 'app-55', REDIRECT_URI, VERIFIER),
        service.exchangeCode('shared-code', 'app-55', REDIRECT_URI, VERIFIER),
      ]);
      expect(first.status).toBe('fulfilled');
      expect(second.status).toBe('rejected');
      if (second.status === 'rejected') {
        expect(String(second.reason)).toMatch(/invalid_grant/);
      }
    });

    it('throws unauthorized_client when client_id does not match', async () => {
      mockPrisma.saOauthCode.delete.mockResolvedValue(makeEntry({ appPublicId: 'app-correct' }));
      await expect(
        service.exchangeCode('c', 'app-wrong', REDIRECT_URI, VERIFIER),
      ).rejects.toThrow(/unauthorized_client/);
    });

    it('throws invalid_grant when the code has expired', async () => {
      mockPrisma.saOauthCode.delete.mockResolvedValue(
        makeEntry({ expiresAt: new Date(Date.now() - 1) }),
      );
      await expect(
        service.exchangeCode('c', 'app-55', REDIRECT_URI, VERIFIER),
      ).rejects.toThrow(/invalid_grant/);
    });

    // bug-0054 — the redirect_uri stored at /authorize must byte-exact
    // match the redirect_uri sent at /token. Delete happens BEFORE the
    // check (single-use semantic preserved), so retrying with the
    // correct URI still fails at the P2025 branch.
    it('throws invalid_grant when redirect_uri does not match', async () => {
      mockPrisma.saOauthCode.delete.mockResolvedValue(
        makeEntry({ redirectUri: 'https://app.example.com/A' }),
      );
      await expect(
        service.exchangeCode('c', 'app-55', 'https://app.example.com/B', VERIFIER),
      ).rejects.toThrow(/invalid_grant/);
    });

    it('throws invalid_grant when redirect_uri differs by trailing slash', async () => {
      mockPrisma.saOauthCode.delete.mockResolvedValue(
        makeEntry({ redirectUri: 'https://app.example.com/cb' }),
      );
      await expect(
        service.exchangeCode('c', 'app-55', 'https://app.example.com/cb/', VERIFIER),
      ).rejects.toThrow(/invalid_grant/);
    });

    it('returns nonce, scope, authTime, and hadChallenge on exchange', async () => {
      // NOTE: the brief's literal placeholders ('s256-of-verifier' /
      // 'verifier-matching-challenge') do not actually hash to each other;
      // using them verbatim would fail PKCE verification before the new
      // fields are ever returned. Substituted with a real matching pair
      // (same approach as the round-trip test above) so this test exercises
      // the intended behavior instead of always throwing.
      mockPrisma.saOauthCode.delete.mockResolvedValue({
        userId: 'u_1', appPublicId: 'a_7', redirectUri: 'https://app/cb',
        codeChallenge: CHALLENGE, codeChallengeMethod: 'S256',
        amr: '["pwd"]', nonce: 'n-123', scope: 'openid profile',
        authTime: new Date('2026-08-21T10:00:00Z'),
        expiresAt: new Date(Date.now() + 60_000),
      });

      const result = await service.exchangeCode('code', 'a_7', 'https://app/cb', VERIFIER);

      expect(result.nonce).toBe('n-123');
      expect(result.scope).toBe('openid profile');
      expect(result.hadChallenge).toBe(true);
    });

    it('reports hadChallenge false for a code stored without PKCE', async () => {
      mockPrisma.saOauthCode.delete.mockResolvedValue({
        userId: 'u_1', appPublicId: 'a_7', redirectUri: 'https://app/cb',
        codeChallenge: null, codeChallengeMethod: null,
        amr: '["pwd"]', nonce: null, scope: '',
        authTime: new Date(), expiresAt: new Date(Date.now() + 60_000),
      });

      const result = await service.exchangeCode('code', 'a_7', 'https://app/cb', undefined);

      expect(result.hadChallenge).toBe(false);
    });

    it('throws invalid_grant when verifier does not match challenge', async () => {
      mockPrisma.saOauthCode.delete.mockResolvedValue(makeEntry());
      await expect(
        service.exchangeCode('c', 'app-55', REDIRECT_URI, 'wrong-verifier'),
      ).rejects.toThrow(/invalid_grant/);
    });

    // Re-raise other Prisma errors so operational issues surface loudly
    // (a P2003 or connection failure should not silently return
    // INVALID_GRANT — the caller and observability tooling need to see
    // the real error).
    it('re-raises non-P2025 Prisma errors', async () => {
      const boom = new Error('DB timeout');
      mockPrisma.saOauthCode.delete.mockRejectedValue(boom);
      await expect(
        service.exchangeCode('c', 'app-55', REDIRECT_URI, VERIFIER),
      ).rejects.toBe(boom);
    });
  });
});
