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
      const code = await service.generateCode('user-1', 'app-1', REDIRECT_URI, CHALLENGE, 'S256');
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
          expiresAt: expect.any(Date),
        }),
      });
    });

    it('produces unique codes across consecutive calls', async () => {
      const a = await service.generateCode('u', 'app', REDIRECT_URI, CHALLENGE, 'S256');
      const b = await service.generateCode('u', 'app', REDIRECT_URI, CHALLENGE, 'S256');
      expect(a).not.toBe(b);
    });
  });

  describe('exchangeCode', () => {
    it('returns userId and appPublicId when everything matches', async () => {
      mockPrisma.saOauthCode.delete.mockResolvedValue(makeEntry());
      const result = await service.exchangeCode('some-code', 'app-55', REDIRECT_URI, VERIFIER);
      expect(result).toEqual({ userId: 'user-99', appPublicId: 'app-55' });
      expect(mockPrisma.saOauthCode.delete).toHaveBeenCalledWith({ where: { code: 'some-code' } });
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
