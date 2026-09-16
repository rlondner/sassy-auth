import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { InvitationsService } from './invitations.service';
import { LoggerService } from '../common/logger/logger.service';

jest.mock('@sassy-auth/db', () => ({
  prisma: {
    saInvitation: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    saUser: { update: jest.fn() },
    user: { update: jest.fn() },
    account: { create: jest.fn() },
    saApp: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  },
}));

jest.mock('../activation/notify-activation', () => ({
  notifyActivation: jest.fn().mockResolvedValue(undefined),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockPrisma = require('@sassy-auth/db').prisma as {
  saInvitation: { findUnique: jest.Mock; update: jest.Mock; updateMany: jest.Mock };
  saUser: { update: jest.Mock };
  user: { update: jest.Mock };
  account: { create: jest.Mock };
  saApp: { findUnique: jest.Mock };
  $transaction: jest.Mock;
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockNotifyActivation = require('../activation/notify-activation').notifyActivation as jest.Mock;

const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
const pastDate = new Date(Date.now() - 1000);

const validInvitation = {
  id: 1,
  token: 'abc123',
  usedAt: null,
  expiresAt: futureDate,
  user: {
    id: 1,
    publicId: 'usr1',
    firstName: 'Jane',
    status: 'pending',
    betterAuthUserId: 'ba-jane',
    orgId: 3,
    betterAuthUser: { id: 'ba-jane', email: 'jane@example.com' },
    org: { appId: 1 },
  },
};

describe('InvitationsService', () => {
  let service: InvitationsService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        InvitationsService,
        { provide: LoggerService, useValue: { log: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(), getWinstonLogger: () => ({ info: jest.fn(), warn: jest.fn(), child: jest.fn() }) } },
      ],
    }).compile();
    service = module.get(InvitationsService);
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(mockPrisma));
    mockPrisma.saApp.findUnique.mockResolvedValue({ id: 1, passwordPolicyOverride: null });
  });

  describe('validateToken', () => {
    it('returns user info for a valid, unexpired token', async () => {
      mockPrisma.saInvitation.findUnique.mockResolvedValue(validInvitation);
      const result = await service.validateToken('abc123');
      expect(result.firstName).toBe('Jane');
      expect(result.email).toBe('jane@example.com');
      expect(result.expired).toBe(false);
      expect(result.passwordPolicy).toEqual(expect.objectContaining({ minLength: 12 }));
    });

    it('returns expired:true for an expired token', async () => {
      mockPrisma.saInvitation.findUnique.mockResolvedValue({ ...validInvitation, expiresAt: pastDate });
      const result = await service.validateToken('abc123');
      expect(result.expired).toBe(true);
    });

    // Regression: a used-but-not-yet-expired invitation must report
    // expired:true so the accept-invite page renders the "expired or invalid"
    // ErrorState instead of the password form. Pre-fix, validateToken only
    // checked expiresAt and revisiting a consumed link still showed the form.
    it('returns expired:true for an already-used token whose expiresAt is still in the future', async () => {
      mockPrisma.saInvitation.findUnique.mockResolvedValue({
        ...validInvitation,
        usedAt: new Date(),
        expiresAt: futureDate,
      });
      const result = await service.validateToken('abc123');
      expect(result.expired).toBe(true);
    });

    it('throws NotFoundException for unknown token', async () => {
      mockPrisma.saInvitation.findUnique.mockResolvedValue(null);
      await expect(service.validateToken('unknown')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('acceptInvitation', () => {
    it('creates Account, activates SaUser, claims the invitation atomically', async () => {
      mockPrisma.saInvitation.findUnique.mockResolvedValue(validInvitation);
      mockPrisma.saInvitation.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.account.create.mockResolvedValue(undefined);
      mockPrisma.saUser.update.mockResolvedValue(undefined);
      mockPrisma.user.update.mockResolvedValue(undefined);

      await expect(service.acceptInvitation('abc123', 'NewPassword123!')).resolves.toBeUndefined();

      // updateMany is the conditional claim: must filter on usedAt:null
      // and an `expiresAt > now` guard, both crucial for race safety.
      expect(mockPrisma.saInvitation.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: validInvitation.id,
            usedAt: null,
          }),
          data: expect.objectContaining({ usedAt: expect.any(Date) }),
        }),
      );
      expect(mockPrisma.account.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ providerId: 'credential', userId: 'ba-jane' }),
        }),
      );
      expect(mockPrisma.saUser.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'active' } }),
      );
    });

    it('notifies the activation webhook after the transaction commits', async () => {
      mockPrisma.saInvitation.findUnique.mockResolvedValue(validInvitation);
      mockPrisma.saInvitation.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.account.create.mockResolvedValue(undefined);
      mockPrisma.saUser.update.mockResolvedValue(undefined);
      mockPrisma.user.update.mockResolvedValue(undefined);

      await service.acceptInvitation('abc123', 'NewPassword123!');

      expect(mockNotifyActivation).toHaveBeenCalledWith({
        id: validInvitation.user.id,
        publicId: validInvitation.user.publicId,
        orgId: validInvitation.user.orgId,
      });
    });

    it('does not notify the activation webhook when the invitation claim loses the race', async () => {
      mockPrisma.saInvitation.findUnique.mockResolvedValue(validInvitation);
      mockPrisma.saInvitation.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.acceptInvitation('abc123', 'NewPassword123!')).rejects.toBeInstanceOf(BadRequestException);

      expect(mockNotifyActivation).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when the atomic claim finds zero rows (lost race)', async () => {
      mockPrisma.saInvitation.findUnique.mockResolvedValue(validInvitation);
      mockPrisma.saInvitation.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.acceptInvitation('abc123', 'NewPassword123!')).rejects.toBeInstanceOf(BadRequestException);
      // account.create must NOT have been called when the claim failed
      expect(mockPrisma.account.create).not.toHaveBeenCalled();
    });

    it('throws BadRequestException for expired token', async () => {
      mockPrisma.saInvitation.findUnique.mockResolvedValue({ ...validInvitation, expiresAt: pastDate });
      await expect(service.acceptInvitation('abc123', 'NewPassword123!')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws BadRequestException for already-used token', async () => {
      mockPrisma.saInvitation.findUnique.mockResolvedValue({ ...validInvitation, usedAt: new Date() });
      await expect(service.acceptInvitation('abc123', 'NewPassword123!')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFoundException for unknown token in acceptInvitation', async () => {
      mockPrisma.saInvitation.findUnique.mockResolvedValue(null);
      await expect(service.acceptInvitation('unknown', 'NewPassword123!')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects a password that fails the resolved policy and does not touch the transaction', async () => {
      mockPrisma.saInvitation.findUnique.mockResolvedValue(validInvitation);
      mockPrisma.saApp.findUnique.mockResolvedValue({ id: 1, passwordPolicyOverride: null });

      await expect(service.acceptInvitation('abc123', 'short')).rejects.toMatchObject({
        response: { errorKey: 'password.policyViolation' },
      });
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockPrisma.saInvitation.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.account.create).not.toHaveBeenCalled();
    });

    it("accepts a password satisfying the invitation app's policy override even though it would fail the global default", async () => {
      mockPrisma.saInvitation.findUnique.mockResolvedValue(validInvitation);
      mockPrisma.saApp.findUnique.mockResolvedValue({
        id: 1,
        passwordPolicyOverride: {
          minLength: 6,
          requireUppercase: false,
          requireLowercase: false,
          requireNumber: false,
          requireSpecial: false,
          minNumbers: 0,
          minSpecial: 0,
        },
      });
      mockPrisma.saInvitation.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.account.create.mockResolvedValue(undefined);
      mockPrisma.saUser.update.mockResolvedValue(undefined);
      mockPrisma.user.update.mockResolvedValue(undefined);

      await expect(service.acceptInvitation('abc123', 'abc123')).resolves.toBeUndefined();
    });
  });

  describe('acceptInvitation publicId nullish branch', () => {
    it('logs with user.id when publicId is null', async () => {
      const invWithoutPublicId = {
        ...validInvitation,
        user: { ...validInvitation.user, publicId: null },
      };
      mockPrisma.saInvitation.findUnique.mockResolvedValue(invWithoutPublicId);
      mockPrisma.saInvitation.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.account.create.mockResolvedValue(undefined);
      mockPrisma.saUser.update.mockResolvedValue(undefined);
      mockPrisma.user.update.mockResolvedValue(undefined);

      await expect(service.acceptInvitation('abc123', 'NewPassword123!')).resolves.toBeUndefined();
    });
  });
});
