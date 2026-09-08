import { Test } from '@nestjs/testing';
import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { RegistrationService } from './registration.service';
import { SqidService } from '../common/sqid/sqid.service';
import { TurnstileService } from './turnstile.service';
import { OauthService } from '../token/oauth.service';
import { RegisterDto } from './register.dto';

jest.mock('../token/oauth.service');

// Mock @sassy-auth/db
jest.mock('@sassy-auth/db', () => ({
  prisma: {
    saApp: { findUnique: jest.fn() },
    saOrg: { create: jest.fn(), update: jest.fn(), findUnique: jest.fn() },
    saUser: { create: jest.fn() },
    saUserRole: { create: jest.fn() },
    saAppRedirectUri: { findFirst: jest.fn() },
    user: { delete: jest.fn(), findUnique: jest.fn() },
    $transaction: jest.fn(),
  },
}));

// Mock auth.config — we provide `auth` token in tests
jest.mock('../auth/auth.config', () => ({
  auth: {
    api: {
      signUpEmail: jest.fn(),
      sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
    },
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockPrisma = require('@sassy-auth/db').prisma as {
  saApp: { findUnique: jest.Mock };
  saOrg: { create: jest.Mock; update: jest.Mock; findUnique: jest.Mock };
  saUser: { create: jest.Mock };
  saUserRole: { create: jest.Mock };
  saAppRedirectUri: { findFirst: jest.Mock };
  user: { delete: jest.Mock; findUnique: jest.Mock };
  $transaction: jest.Mock;
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockSignUpEmail = require('../auth/auth.config').auth.api.signUpEmail as jest.Mock;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockSendVerificationEmail = require('../auth/auth.config').auth.api.sendVerificationEmail as jest.Mock;

const sqidFake: Pick<SqidService, 'encode' | 'decode'> = {
  encode: (n: number) => `sq_${n}`,
  decode: (s: string) => Number(s.replace('sq_', '')),
};

const baseDto: RegisterDto = {
  email: 'alice@example.com',
  // Satisfies the default global policy resolved by resolvePasswordPolicy:
  // minLength 12, upper, lower, and at least one number required.
  password: 'StrongPass123',
  firstName: 'Alice',
  lastName: 'Wonder',
  companyName: 'Acme Inc',
  appPublicId: 'sq_1',
  turnstileToken: 'valid-captcha-token',
};

const appRow = { id: 1, publicId: 'sq_1', name: 'MyApp', isPlatform: false, passwordPolicyOverride: null };
const draftOrgRow = { id: 10, publicId: 'placeholder', name: 'Acme Inc', appId: 1, isPlatform: false };
const finalOrgRow = { id: 10, publicId: 'sq_10', name: 'Acme Inc', appId: 1, isPlatform: false };
const baUserId = 'ba-user-id-abc123';

describe('RegistrationService', () => {
  let service: RegistrationService;

  let mockVerify: jest.Mock;
  let mockOauthService: { generateCode: jest.Mock };

  beforeEach(async () => {
    mockVerify = jest.fn().mockResolvedValue(true);
    const module = await Test.createTestingModule({
      providers: [
        RegistrationService,
        { provide: SqidService, useValue: sqidFake },
        { provide: TurnstileService, useValue: { verify: mockVerify } },
        { provide: OauthService, useValue: { generateCode: jest.fn() } },
      ],
    }).compile();
    service = module.get(RegistrationService);
    mockOauthService = module.get(OauthService) as unknown as { generateCode: jest.Mock };
    jest.clearAllMocks();
    mockVerify.mockResolvedValue(true);
    // Default: the id signUpEmail returned really was persisted. The
    // synthetic-duplicate cases below override this with null (see
    // auth.config.ts autoSignIn).
    mockPrisma.user.findUnique.mockResolvedValue({ id: baUserId });
  });

  describe('register', () => {
    it('throws UnprocessableEntityException when captcha verification fails, before any app lookup', async () => {
      mockVerify.mockResolvedValue(false);

      await expect(service.register(baseDto)).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(mockPrisma.saApp.findUnique).not.toHaveBeenCalled();
      expect(mockSignUpEmail).not.toHaveBeenCalled();
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('calls TurnstileService.verify with the dto token', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue(null);

      await expect(service.register(baseDto)).rejects.toBeInstanceOf(NotFoundException);
      expect(mockVerify).toHaveBeenCalledWith('valid-captcha-token');
    });

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
          status: 'unverified',
        },
      });
      expect(mockSendVerificationEmail).toHaveBeenCalledWith({
        body: { email: baseDto.email, callbackURL: expect.stringContaining('/signup/verified') },
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

    it('returns a redirectUrl with a signup code when the app is confidential and has a login redirect URI', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue({ ...appRow, clientSecretHash: 'hashed-secret' });
      mockPrisma.saOrg.create.mockResolvedValue(draftOrgRow);
      mockPrisma.saOrg.update.mockResolvedValue(finalOrgRow);
      mockSignUpEmail.mockResolvedValue({ user: { id: baUserId } });
      mockPrisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
        cb({
          saOrg: mockPrisma.saOrg,
          saUser: { create: jest.fn().mockResolvedValue({ id: 42, publicId: 'ba-user-id-a' }) },
          saUserRole: mockPrisma.saUserRole,
        }),
      );
      mockPrisma.saAppRedirectUri.findFirst.mockResolvedValue({ uri: 'https://relying-party.example.com/callback', kind: 'login' });
      mockOauthService.generateCode.mockResolvedValue('signup-code-123');

      const result = await service.register(baseDto);

      expect(mockOauthService.generateCode).toHaveBeenCalledWith(
        'ba-user-id-a',
        'sq_1',
        'https://relying-party.example.com/callback',
        null,
        null,
        ['signup'],
        null,
        'openid profile email',
        expect.any(Date),
      );
      expect(result.redirectUrl).toBe('https://relying-party.example.com/callback?code=signup-code-123');
    });

    it('omits redirectUrl when the app has no registered login redirect URI', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue({ ...appRow, clientSecretHash: 'hashed-secret' });
      mockPrisma.saOrg.create.mockResolvedValue(draftOrgRow);
      mockPrisma.saOrg.update.mockResolvedValue(finalOrgRow);
      mockSignUpEmail.mockResolvedValue({ user: { id: baUserId } });
      mockPrisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
        cb({
          saOrg: mockPrisma.saOrg,
          saUser: { create: jest.fn().mockResolvedValue({ id: 42, publicId: 'ba-user-id-a' }) },
          saUserRole: mockPrisma.saUserRole,
        }),
      );
      mockPrisma.saAppRedirectUri.findFirst.mockResolvedValue(null);

      const result = await service.register(baseDto);

      expect(mockOauthService.generateCode).not.toHaveBeenCalled();
      expect(result.redirectUrl).toBeUndefined();
    });

    it('omits redirectUrl when the app is a public client (no clientSecretHash), even with a login redirect URI registered', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue({ ...appRow, clientSecretHash: null });
      mockPrisma.saOrg.create.mockResolvedValue(draftOrgRow);
      mockPrisma.saOrg.update.mockResolvedValue(finalOrgRow);
      mockSignUpEmail.mockResolvedValue({ user: { id: baUserId } });
      mockPrisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
        cb({
          saOrg: mockPrisma.saOrg,
          saUser: { create: jest.fn().mockResolvedValue({ id: 42, publicId: 'ba-user-id-a' }) },
          saUserRole: mockPrisma.saUserRole,
        }),
      );

      const result = await service.register(baseDto);

      expect(mockPrisma.saAppRedirectUri.findFirst).not.toHaveBeenCalled();
      expect(mockOauthService.generateCode).not.toHaveBeenCalled();
      expect(result.redirectUrl).toBeUndefined();
    });
  });

  describe('register — password policy', () => {
    it('rejects a password that fails the resolved policy before creating any account', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue(appRow);

      await expect(
        service.register({ ...baseDto, password: 'short' }),
      ).rejects.toMatchObject({ response: { errorKey: 'password.policyViolation' } });

      expect(mockSignUpEmail).not.toHaveBeenCalled();
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('accepts a password satisfying an app-level override that the global policy would reject', async () => {
      const appWithOverride = {
        ...appRow,
        passwordPolicyOverride: {
          minLength: 6,
          requireUppercase: false,
          requireLowercase: false,
          requireNumber: false,
          requireSpecial: false,
          minNumbers: 0,
          minSpecial: 0,
        },
      };
      mockPrisma.saApp.findUnique.mockResolvedValue(appWithOverride);
      mockSignUpEmail.mockResolvedValue({ token: 'tok', user: { id: baUserId, email: baseDto.email } });
      mockPrisma.$transaction.mockImplementation(async (cb: (tx: typeof mockPrisma) => unknown) => cb(mockPrisma));
      mockPrisma.saOrg.create.mockResolvedValue(draftOrgRow);
      mockPrisma.saOrg.update.mockResolvedValue(finalOrgRow);
      mockPrisma.saUser.create.mockResolvedValue({ id: 1, publicId: baUserId.slice(0, 12) });

      // 6 chars — satisfies the override's minLength:6 but would fail the
      // global default (minLength 12, uppercase/number required).
      await expect(service.register({ ...baseDto, password: 'abcdef' })).resolves.toEqual({
        ok: true,
        orgPublicId: finalOrgRow.publicId,
      });
      expect(mockSignUpEmail).toHaveBeenCalledWith({
        body: { email: baseDto.email, password: 'abcdef', name: 'Alice Wonder' },
      });
    });
  });

  describe('register — app with defaultOrgId', () => {
    const appWithDefaultOrg = { ...appRow, defaultOrgId: 99, defaultRoleId: null };
    const defaultOrgRow = { id: 99, publicId: 'sq_99', name: 'Citadel', appId: 1, isPlatform: false };

    it('joins the default org and ignores companyName, without creating a new org', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue(appWithDefaultOrg);
      mockPrisma.saOrg.findUnique.mockResolvedValue(defaultOrgRow);
      mockSignUpEmail.mockResolvedValue({ token: 'tok', user: { id: baUserId, email: baseDto.email } });
      mockPrisma.$transaction.mockImplementation(async (cb: (tx: typeof mockPrisma) => unknown) => cb(mockPrisma));
      mockPrisma.saUser.create.mockResolvedValue({ id: 1, publicId: baUserId.slice(0, 12) });

      const result = await service.register({ ...baseDto, companyName: undefined });

      expect(mockPrisma.saOrg.create).not.toHaveBeenCalled();
      expect(mockPrisma.saUser.create).toHaveBeenCalledWith({
        data: {
          publicId: baUserId.slice(0, 12),
          betterAuthUserId: baUserId,
          orgId: defaultOrgRow.id,
          firstName: baseDto.firstName,
          lastName: baseDto.lastName,
          status: 'unverified',
        },
      });
      expect(result).toEqual({ ok: true, orgPublicId: defaultOrgRow.publicId });
    });

    it('throws NotFoundException if the default org row is missing despite defaultOrgId being set', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue(appWithDefaultOrg);
      mockPrisma.saOrg.findUnique.mockResolvedValue(null);
      mockSignUpEmail.mockResolvedValue({ token: 'tok', user: { id: baUserId, email: baseDto.email } });

      await expect(service.register({ ...baseDto, companyName: undefined })).rejects.toBeInstanceOf(NotFoundException);
      expect(mockSignUpEmail).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when companyName is missing and the app has no defaultOrgId', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue(appRow); // no defaultOrgId
      mockSignUpEmail.mockResolvedValue({ token: 'tok', user: { id: baUserId, email: baseDto.email } });

      await expect(service.register({ ...baseDto, companyName: undefined })).rejects.toThrow(
        /companyName is required/,
      );
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('register — app with defaultRoleId', () => {
    it('assigns the default role in the same transaction, for a founder-path signup too', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue({ ...appRow, defaultOrgId: null, defaultRoleId: 7 });
      mockSignUpEmail.mockResolvedValue({ token: 'tok', user: { id: baUserId, email: baseDto.email } });
      mockPrisma.$transaction.mockImplementation(async (cb: (tx: typeof mockPrisma) => unknown) => cb(mockPrisma));
      mockPrisma.saOrg.create.mockResolvedValue(draftOrgRow);
      mockPrisma.saOrg.update.mockResolvedValue(finalOrgRow);
      mockPrisma.saUser.create.mockResolvedValue({ id: 1, publicId: baUserId.slice(0, 12) });

      await service.register(baseDto);

      expect(mockPrisma.saUserRole.create).toHaveBeenCalledWith({ data: { userId: 1, roleId: 7 } });
    });

    it('does not assign a role when defaultRoleId is not set', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue(appRow);
      mockSignUpEmail.mockResolvedValue({ token: 'tok', user: { id: baUserId, email: baseDto.email } });
      mockPrisma.$transaction.mockImplementation(async (cb: (tx: typeof mockPrisma) => unknown) => cb(mockPrisma));
      mockPrisma.saOrg.create.mockResolvedValue(draftOrgRow);
      mockPrisma.saOrg.update.mockResolvedValue(finalOrgRow);
      mockPrisma.saUser.create.mockResolvedValue({ id: 1, publicId: baUserId.slice(0, 12) });

      await service.register(baseDto);

      expect(mockPrisma.saUserRole.create).not.toHaveBeenCalled();
    });
  });

  describe('getAppName — hasDefaultOrg', () => {
    it('reports hasDefaultOrg: true when the app has a defaultOrgId', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue({ name: 'MyApp', defaultOrgId: 99, passwordPolicyOverride: null });
      await expect(service.getAppName('sq_1')).resolves.toEqual({
        name: 'MyApp',
        hasDefaultOrg: true,
        passwordPolicy: expect.any(Object),
      });
    });

    it('reports hasDefaultOrg: false when the app has no defaultOrgId', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue({ name: 'MyApp', defaultOrgId: null, passwordPolicyOverride: null });
      await expect(service.getAppName('sq_1')).resolves.toEqual({
        name: 'MyApp',
        hasDefaultOrg: false,
        passwordPolicy: expect.any(Object),
      });
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
      mockPrisma.saApp.findUnique.mockResolvedValue({ name: 'MyApp', defaultOrgId: null, passwordPolicyOverride: null });

      await expect(service.getAppName('sq_1')).resolves.toEqual({
        name: 'MyApp',
        hasDefaultOrg: false,
        passwordPolicy: expect.any(Object),
      });
      expect(mockPrisma.saApp.findUnique).toHaveBeenCalledWith({
        where: { publicId: 'sq_1' },
        select: { name: true, defaultOrgId: true, passwordPolicyOverride: true },
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
