import { UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';
import { RefreshTokenService } from './refresh-token.service';

jest.mock('@sassy-auth/db', () => ({
  prisma: {
    saRefreshToken: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockPrisma = require('@sassy-auth/db').prisma as {
  saRefreshToken: {
    create: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
  $transaction: jest.Mock;
};

function hashOf(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

describe('RefreshTokenService', () => {
  let service: RefreshTokenService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new RefreshTokenService();
    mockPrisma.$transaction.mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops));
  });

  describe('issue', () => {
    it('creates a new family row and returns an opaque token whose hash matches the stored row', async () => {
      const token = await service.issue({
        saUserId: 1,
        userPublicId: 'usr-1',
        orgPublicId: 'org-1',
        appId: 10,
        appPublicId: 'app-10',
        scope: 'openid offline_access',
        amr: ['pwd'],
        authTime: new Date('2026-09-17T00:00:00Z'),
      });

      expect(typeof token).toBe('string');
      expect(mockPrisma.saRefreshToken.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tokenHash: hashOf(token),
          saUserId: 1,
          userPublicId: 'usr-1',
          orgPublicId: 'org-1',
          appId: 10,
          appPublicId: 'app-10',
          scope: 'openid offline_access',
          amr: JSON.stringify(['pwd']),
          idp: null,
        }),
      });
    });

    it('sets a 30-day sliding expiry and a 90-day absolute expiry', async () => {
      const now = new Date('2026-09-17T00:00:00Z');
      jest.useFakeTimers().setSystemTime(now);
      await service.issue({
        saUserId: 1, userPublicId: 'usr-1', orgPublicId: 'org-1',
        appId: 10, appPublicId: 'app-10', scope: '', amr: ['pwd'], authTime: now,
      });
      const data = mockPrisma.saRefreshToken.create.mock.calls[0][0].data;
      expect(data.expiresAt.toISOString()).toBe(new Date('2026-10-17T00:00:00Z').toISOString());
      expect(data.absoluteExpiresAt.toISOString()).toBe(new Date('2026-12-16T00:00:00Z').toISOString());
      jest.useRealTimers();
    });
  });

  describe('rotate', () => {
    const existingRow = {
      tokenHash: 'irrelevant',
      familyId: 'fam-1',
      saUserId: 1,
      userPublicId: 'usr-1',
      orgPublicId: 'org-1',
      appId: 10,
      appPublicId: 'app-10',
      scope: 'openid',
      amr: JSON.stringify(['pwd']),
      idp: null,
      authTime: new Date('2026-09-01T00:00:00Z'),
      expiresAt: new Date('2026-10-17T00:00:00Z'),
      absoluteExpiresAt: new Date('2026-12-16T00:00:00Z'),
      revokedAt: null,
      replacedByTokenHash: null,
    };

    it('rotates a valid token: revokes the old row and issues a new one in the same family', async () => {
      mockPrisma.saRefreshToken.findUnique.mockResolvedValue(existingRow);
      mockPrisma.saRefreshToken.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.saRefreshToken.create.mockResolvedValue({});

      const result = await service.rotate('presented-token', 'app-10');

      expect(result).toEqual(expect.objectContaining({
        saUserId: 1, userPublicId: 'usr-1', orgPublicId: 'org-1',
        appId: 10, appPublicId: 'app-10', scope: 'openid', amr: ['pwd'],
        authTime: existingRow.authTime,
      }));
      expect(typeof result.token).toBe('string');
      expect(mockPrisma.saRefreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tokenHash: hashOf('presented-token'), revokedAt: null },
          data: expect.objectContaining({ replacedByTokenHash: hashOf(result.token) }),
        }),
      );
      expect(mockPrisma.saRefreshToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            familyId: 'fam-1',
            absoluteExpiresAt: existingRow.absoluteExpiresAt,
          }),
        }),
      );
    });

    it('concurrent replay: if a race already flipped revokedAt, the losing request fails cleanly without creating a child row', async () => {
      mockPrisma.saRefreshToken.findUnique.mockResolvedValue(existingRow);
      // Simulates a concurrent winner already having revoked this row
      // between our read and our conditional write.
      mockPrisma.saRefreshToken.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.rotate('presented-token', 'app-10')).rejects.toBeInstanceOf(UnauthorizedException);
      expect(mockPrisma.saRefreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tokenHash: hashOf('presented-token'), revokedAt: null },
        }),
      );
      expect(mockPrisma.saRefreshToken.create).not.toHaveBeenCalled();
    });

    it('rejects an unknown token with invalid_grant', async () => {
      mockPrisma.saRefreshToken.findUnique.mockResolvedValue(null);
      await expect(service.rotate('nope', 'app-10')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a token issued for a different app', async () => {
      mockPrisma.saRefreshToken.findUnique.mockResolvedValue(existingRow);
      await expect(service.rotate('presented-token', 'app-99')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects an expired (sliding) token', async () => {
      mockPrisma.saRefreshToken.findUnique.mockResolvedValue({
        ...existingRow, expiresAt: new Date('2020-01-01T00:00:00Z'),
      });
      await expect(service.rotate('presented-token', 'app-10')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a token past its absolute expiry', async () => {
      mockPrisma.saRefreshToken.findUnique.mockResolvedValue({
        ...existingRow, absoluteExpiresAt: new Date('2020-01-01T00:00:00Z'),
      });
      await expect(service.rotate('presented-token', 'app-10')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('reuse detection: presenting an already-rotated token burns the whole family', async () => {
      mockPrisma.saRefreshToken.findUnique.mockResolvedValue({
        ...existingRow, revokedAt: new Date('2026-09-10T00:00:00Z'), replacedByTokenHash: 'some-hash',
      });
      mockPrisma.saRefreshToken.updateMany.mockResolvedValue({ count: 2 });

      await expect(service.rotate('stolen-token', 'app-10')).rejects.toBeInstanceOf(UnauthorizedException);
      expect(mockPrisma.saRefreshToken.updateMany).toHaveBeenCalledWith({
        where: { familyId: 'fam-1', revokedAt: null },
        data: expect.objectContaining({ revokedAt: expect.any(Date) }),
      });
    });
  });

  describe('revokeForUserApp', () => {
    it('revokes all non-revoked tokens for that user+app', async () => {
      mockPrisma.saRefreshToken.updateMany.mockResolvedValue({ count: 1 });
      await service.revokeForUserApp('usr-1', 'app-10');
      expect(mockPrisma.saRefreshToken.updateMany).toHaveBeenCalledWith({
        where: { userPublicId: 'usr-1', appPublicId: 'app-10', revokedAt: null },
        data: expect.objectContaining({ revokedAt: expect.any(Date) }),
      });
    });
  });

  describe('revokeForUser', () => {
    it('revokes all non-revoked tokens for that user across every app', async () => {
      mockPrisma.saRefreshToken.updateMany.mockResolvedValue({ count: 3 });
      await service.revokeForUser(1);
      expect(mockPrisma.saRefreshToken.updateMany).toHaveBeenCalledWith({
        where: { saUserId: 1, revokedAt: null },
        data: expect.objectContaining({ revokedAt: expect.any(Date) }),
      });
    });
  });
});
