import { Test } from '@nestjs/testing';
import { ForbiddenException, BadRequestException, NotFoundException } from '@nestjs/common';
import { MeService } from './me.service';

jest.mock('@sassy-auth/db', () => ({
  prisma: {
    saUser: { findUnique: jest.fn() },
    saApp: { findUnique: jest.fn() },
    saUserConsent: { findMany: jest.fn(), createMany: jest.fn() },
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockPrisma = require('@sassy-auth/db').prisma as {
  saUser: { findUnique: jest.Mock };
  saApp: { findUnique: jest.Mock };
  saUserConsent: { findMany: jest.Mock; createMany: jest.Mock };
};

describe('MeService', () => {
  let service: MeService;
  beforeEach(async () => {
    const module = await Test.createTestingModule({ providers: [MeService] }).compile();
    service = module.get(MeService);
    jest.clearAllMocks();
  });

  it('returns union of role-derived and direct permissions, deduplicated and sorted', async () => {
    mockPrisma.saUser.findUnique.mockResolvedValue({
      roles: [
        { role: { permissions: [{ permission: { name: 'platform.apps.manage' } }, { permission: { name: 'org.users.manage' } }] } },
      ],
      directPermissions: [
        { permission: { name: 'platform.orgs.manage' } },
        { permission: { name: 'org.users.manage' } },
      ],
    });
    const result = await service.getMyPermissions('ba-caller');
    expect(result).toEqual({ permissions: ['org.users.manage', 'platform.apps.manage', 'platform.orgs.manage'] });
  });

  it('returns empty list when caller has no SaUser permissions', async () => {
    mockPrisma.saUser.findUnique.mockResolvedValue({ roles: [], directPermissions: [] });
    const result = await service.getMyPermissions('ba-caller');
    expect(result).toEqual({ permissions: [] });
  });

  it('throws ForbiddenException when caller has no SaUser', async () => {
    mockPrisma.saUser.findUnique.mockResolvedValue(null);
    await expect(service.getMyPermissions('ba-caller')).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('MeService.getMyProfile', () => {
  let service: MeService;
  beforeEach(async () => {
    const module = await Test.createTestingModule({ providers: [MeService] }).compile();
    service = module.get(MeService);
    jest.clearAllMocks();
  });

  it('returns userId, org, and app metadata', async () => {
    mockPrisma.saUser.findUnique.mockResolvedValue({
      publicId: 'sq_u1',
      org: {
        publicId: 'sq_o1', name: 'Acme', isPlatform: false,
        app: { publicId: 'sq_a1', name: 'app01', isPlatform: false },
      },
    });
    const result = await service.getMyProfile('ba-caller');
    expect(result).toEqual({
      userId: 'sq_u1',
      org: { id: 'sq_o1', name: 'Acme', isPlatform: false },
      app: { id: 'sq_a1', name: 'app01', isPlatform: false },
    });
  });

  it('throws ForbiddenException when caller has no SaUser', async () => {
    mockPrisma.saUser.findUnique.mockResolvedValue(null);
    await expect(service.getMyProfile('ba-caller')).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('MeService consent', () => {
  let service: MeService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({ providers: [MeService] }).compile();
    service = module.get(MeService);
    jest.clearAllMocks();
  });

  describe('getOutstandingConsent', () => {
    it('throws ForbiddenException when the caller has no SaUser', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue(null);
      await expect(service.getOutstandingConsent('ba-1', 'sq_1', 'unknown')).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when the app does not exist', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue({ id: 100 });
      mockPrisma.saApp.findUnique.mockResolvedValue(null);
      await expect(service.getOutstandingConsent('ba-1', 'sq_1', 'unknown')).rejects.toThrow(NotFoundException);
    });

    it('returns the outstanding documents for the caller against the named app', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue({ id: 100 });
      mockPrisma.saApp.findUnique.mockResolvedValue({
        id: 1, privacyPolicyUrl: 'https://a.example.com/privacy', termsUrl: null, gdprUrl: null,
      });
      mockPrisma.saUserConsent.findMany.mockResolvedValue([]);
      const result = await service.getOutstandingConsent('ba-1', 'sq_1', 'unknown');
      expect(result).toEqual({ outstanding: [{ documentType: 'privacy_policy', url: 'https://a.example.com/privacy' }] });
    });
  });

  describe('recordMyConsent', () => {
    it('silently ignores and does not record when accepting a document that is not actually required', async () => {
      // Adapted from the brief's original assertion (rejects.toThrow(BadRequestException)):
      // that contradicted both the brief's own inline comment and the task's stated
      // security property, which both say a non-outstanding `accepted` entry (not
      // required, or already accepted) must be silently ignored, not rejected.
      mockPrisma.saUser.findUnique.mockResolvedValue({ id: 100 });
      mockPrisma.saApp.findUnique.mockResolvedValue({ id: 1, privacyPolicyUrl: null, termsUrl: null, gdprUrl: null });
      mockPrisma.saUserConsent.findMany.mockResolvedValue([]);
      await expect(service.recordMyConsent('ba-1', 'sq_1', 'unknown', ['privacy_policy'])).resolves.toBeUndefined();
      expect(mockPrisma.saUserConsent.createMany).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when the accepted set does not cover every outstanding document', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue({ id: 100 });
      mockPrisma.saApp.findUnique.mockResolvedValue({
        id: 1, privacyPolicyUrl: 'https://a.example.com/privacy', termsUrl: 'https://a.example.com/terms', gdprUrl: null,
      });
      mockPrisma.saUserConsent.findMany.mockResolvedValue([]);
      await expect(
        service.recordMyConsent('ba-1', 'sq_1', 'unknown', ['privacy_policy']),
      ).rejects.toThrow(BadRequestException);
    });

    it('records consent for every outstanding document when the accepted set covers them all', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue({ id: 100 });
      mockPrisma.saApp.findUnique.mockResolvedValue({
        id: 1, privacyPolicyUrl: 'https://a.example.com/privacy', termsUrl: null, gdprUrl: null,
      });
      mockPrisma.saUserConsent.findMany.mockResolvedValue([]);
      await service.recordMyConsent('ba-1', 'sq_1', 'unknown', ['privacy_policy']);
      expect(mockPrisma.saUserConsent.createMany).toHaveBeenCalledWith({
        data: [{ saUserId: 100, appId: 1, documentType: 'privacy_policy', url: 'https://a.example.com/privacy' }],
      });
    });

    it('silently ignores an accepted entry naming a document that is not outstanding', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue({ id: 100 });
      mockPrisma.saApp.findUnique.mockResolvedValue({
        id: 1, privacyPolicyUrl: 'https://a.example.com/privacy', termsUrl: null, gdprUrl: null,
      });
      mockPrisma.saUserConsent.findMany.mockResolvedValue([]);
      await service.recordMyConsent('ba-1', 'sq_1', 'unknown', ['privacy_policy', 'terms']);
      expect(mockPrisma.saUserConsent.createMany).toHaveBeenCalledWith({
        data: [{ saUserId: 100, appId: 1, documentType: 'privacy_policy', url: 'https://a.example.com/privacy' }],
      });
    });
  });
});
