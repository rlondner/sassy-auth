import { Test } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { RegistrationService } from './registration.service';
import { SqidService } from '../common/sqid/sqid.service';
import { RegisterDto } from './register.dto';

// Mock @sassy-auth/db
jest.mock('@sassy-auth/db', () => ({
  prisma: {
    saApp: { findUnique: jest.fn() },
    saOrg: { create: jest.fn(), update: jest.fn() },
    saUser: { create: jest.fn() },
    user: { delete: jest.fn(), findUnique: jest.fn() },
    $transaction: jest.fn(),
  },
}));

// Mock auth.config — we provide `auth` token in tests
jest.mock('../auth/auth.config', () => ({
  auth: {
    api: {
      signUpEmail: jest.fn(),
    },
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockPrisma = require('@sassy-auth/db').prisma as {
  saApp: { findUnique: jest.Mock };
  saOrg: { create: jest.Mock; update: jest.Mock };
  saUser: { create: jest.Mock };
  user: { delete: jest.Mock; findUnique: jest.Mock };
  $transaction: jest.Mock;
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockSignUpEmail = require('../auth/auth.config').auth.api.signUpEmail as jest.Mock;

const sqidFake: Pick<SqidService, 'encode' | 'decode'> = {
  encode: (n: number) => `sq_${n}`,
  decode: (s: string) => Number(s.replace('sq_', '')),
};

const baseDto: RegisterDto = {
  email: 'alice@example.com',
  password: 'password123',
  firstName: 'Alice',
  lastName: 'Wonder',
  companyName: 'Acme Inc',
  appPublicId: 'sq_1',
};

const appRow = { id: 1, publicId: 'sq_1', name: 'MyApp', isPlatform: false };
const draftOrgRow = { id: 10, publicId: 'placeholder', name: 'Acme Inc', appId: 1, isPlatform: false };
const finalOrgRow = { id: 10, publicId: 'sq_10', name: 'Acme Inc', appId: 1, isPlatform: false };
const baUserId = 'ba-user-id-abc123';

describe('RegistrationService', () => {
  let service: RegistrationService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        RegistrationService,
        { provide: SqidService, useValue: sqidFake },
      ],
    }).compile();
    service = module.get(RegistrationService);
    jest.clearAllMocks();
    // Default: the id signUpEmail returned really was persisted. The
    // synthetic-duplicate cases below override this with null (see
    // auth.config.ts autoSignIn).
    mockPrisma.user.findUnique.mockResolvedValue({ id: baUserId });
  });

  describe('register', () => {
    it('throws NotFoundException when appPublicId is not found', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue(null);

      await expect(service.register(baseDto)).rejects.toBeInstanceOf(NotFoundException);
      expect(mockSignUpEmail).not.toHaveBeenCalled();
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('happy path: calls signUpEmail then creates saOrg + saUser and returns orgPublicId', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue(appRow);
      mockSignUpEmail.mockResolvedValue({ token: 'tok', user: { id: baUserId, email: baseDto.email, name: baseDto.companyName } });

      // Simulate prisma.$transaction running the callback with the tx mock
      mockPrisma.$transaction.mockImplementation(async (cb: (tx: typeof mockPrisma) => unknown) => cb(mockPrisma));
      mockPrisma.saOrg.create.mockResolvedValue(draftOrgRow);
      mockPrisma.saOrg.update.mockResolvedValue(finalOrgRow);
      mockPrisma.saUser.create.mockResolvedValue({ id: 1, publicId: baUserId.slice(0, 12), betterAuthUserId: baUserId });

      const result = await service.register(baseDto);

      expect(mockSignUpEmail).toHaveBeenCalledWith({
        body: { email: baseDto.email, password: baseDto.password, name: 'Alice Wonder' },
      });

      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockPrisma.saOrg.create).toHaveBeenCalledWith({
        data: { publicId: expect.stringMatching(/^pending-/), name: baseDto.companyName, appId: appRow.id, isPlatform: false },
      });
      expect(mockPrisma.saOrg.update).toHaveBeenCalledWith({
        where: { id: draftOrgRow.id },
        data: { publicId: 'sq_10' },
      });
      expect(mockPrisma.saUser.create).toHaveBeenCalledWith({
        data: {
          publicId: baUserId.slice(0, 12),
          betterAuthUserId: baUserId,
          orgId: finalOrgRow.id,
          firstName: baseDto.firstName,
          lastName: baseDto.lastName,
          status: 'active',
        },
      });

      expect(result).toEqual({ ok: true, orgPublicId: finalOrgRow.publicId });
    });

    it('surfaces duplicate-email error from signUpEmail as ConflictException', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue(appRow);
      // BetterAuth throws an APIError with status 'UNPROCESSABLE_ENTITY' on duplicate email
      const apiError = Object.assign(new Error('USER_ALREADY_EXISTS'), { status: 'UNPROCESSABLE_ENTITY', statusCode: 422 });
      mockSignUpEmail.mockRejectedValue(apiError);

      await expect(service.register(baseDto)).rejects.toBeInstanceOf(ConflictException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('compensation: if tx fails after signUpEmail succeeded, deletes the BetterAuth user', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue(appRow);
      mockSignUpEmail.mockResolvedValue({ token: 'tok', user: { id: baUserId, email: baseDto.email, name: baseDto.companyName } });

      const txError = new Error('DB constraint failure');
      mockPrisma.$transaction.mockRejectedValue(txError);
      mockPrisma.user.delete.mockResolvedValue(undefined);

      await expect(service.register(baseDto)).rejects.toThrow('DB constraint failure');

      expect(mockPrisma.user.delete).toHaveBeenCalledWith({ where: { id: baUserId } });
    });

    it('compensation: if delete of BetterAuth user also fails, still re-throws the original tx error', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue(appRow);
      mockSignUpEmail.mockResolvedValue({ token: 'tok', user: { id: baUserId } });

      const txError = new Error('TX failure');
      mockPrisma.$transaction.mockRejectedValue(txError);
      // Compensating delete also throws — should be swallowed
      mockPrisma.user.delete.mockRejectedValue(new Error('Delete also failed'));

      await expect(service.register(baseDto)).rejects.toThrow('TX failure');
    });
  });

  // With emailAndPassword.autoSignIn disabled (required by the session-create
  // gate), BetterAuth stops throwing on a duplicate email and instead returns a
  // *synthetic* user — an id that was never persisted — so that sign-up cannot
  // be used to enumerate accounts. Taking that id at face value would create an
  // SaUser pointing at a non-existent BetterAuth user.
  describe('duplicate email under autoSignIn=false (synthetic response)', () => {
    it('returns 409 when signUpEmail resolves with an id that is not in the database', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue(appRow);
      mockSignUpEmail.mockResolvedValue({ token: null, user: { id: 'synthetic-id', email: baseDto.email } });
      mockPrisma.user.findUnique.mockResolvedValue(null); // never persisted

      await expect(service.register(baseDto)).rejects.toBeInstanceOf(ConflictException);
    });

    it('does not create an org or user for a synthetic response', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue(appRow);
      mockSignUpEmail.mockResolvedValue({ token: null, user: { id: 'synthetic-id', email: baseDto.email } });
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.register(baseDto)).rejects.toBeInstanceOf(ConflictException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockPrisma.saUser.create).not.toHaveBeenCalled();
    });

    it('does not delete the pre-existing BetterAuth user when rejecting a duplicate', async () => {
      // The compensation path must not touch the incumbent account.
      mockPrisma.saApp.findUnique.mockResolvedValue(appRow);
      mockSignUpEmail.mockResolvedValue({ token: null, user: { id: 'synthetic-id', email: baseDto.email } });
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.register(baseDto)).rejects.toBeInstanceOf(ConflictException);
      expect(mockPrisma.user.delete).not.toHaveBeenCalled();
    });

    it('proceeds normally when the returned id really was persisted', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue(appRow);
      mockSignUpEmail.mockResolvedValue({ token: null, user: { id: baUserId, email: baseDto.email } });
      mockPrisma.user.findUnique.mockResolvedValue({ id: baUserId });
      mockPrisma.$transaction.mockImplementation(async (cb: (tx: typeof mockPrisma) => unknown) => cb(mockPrisma));
      mockPrisma.saOrg.create.mockResolvedValue(draftOrgRow);
      mockPrisma.saOrg.update.mockResolvedValue(finalOrgRow);
      mockPrisma.saUser.create.mockResolvedValue({ id: 1 });

      await expect(service.register(baseDto)).resolves.toEqual({ ok: true, orgPublicId: finalOrgRow.publicId });
    });
  });

  describe('getAppName', () => {
    it('returns the app name for a known appPublicId', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue({ name: 'MyApp' });

      await expect(service.getAppName('sq_1')).resolves.toEqual({ name: 'MyApp' });
      expect(mockPrisma.saApp.findUnique).toHaveBeenCalledWith({
        where: { publicId: 'sq_1' },
        select: { name: true },
      });
    });

    it('throws NotFoundException for an unknown appPublicId', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue(null);

      await expect(service.getAppName('nope')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFoundException for an empty appPublicId without querying the database', async () => {
      await expect(service.getAppName('')).rejects.toBeInstanceOf(NotFoundException);
      expect(mockPrisma.saApp.findUnique).not.toHaveBeenCalled();
    });
  });

});
