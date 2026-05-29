import { Test, TestingModule } from '@nestjs/testing';
import { TokenController } from './token.controller';
import { TokenService } from './token.service';
import { OauthService } from './oauth.service';
import { SqidService } from '../common/sqid/sqid.service';
import { LoggerService } from '../common/logger/logger.service';
import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';

jest.mock('@sentry/nestjs', () => ({
  setTag: jest.fn(),
  setUser: jest.fn(),
  captureException: jest.fn(),
  withScope: jest.fn((cb) => cb({ setExtra: jest.fn(), setTag: jest.fn() })),
  lastEventId: jest.fn(),
}));

jest.mock('@sassy-auth/db', () => ({
  prisma: {
    saApp: { findUnique: jest.fn() },
    saUser: { findUnique: jest.fn(), findFirst: jest.fn() },
    account: { findFirst: jest.fn() },
  },
}));

jest.mock('../auth/auth.config', () => ({
  auth: { api: { getSession: jest.fn() } },
}));

jest.mock('better-auth/crypto', () => ({ verifyPassword: jest.fn().mockResolvedValue(true) }));

import { prisma } from '@sassy-auth/db';
import { auth } from '../auth/auth.config';

const mockGetSession = auth.api.getSession as jest.Mock;

const mockPrisma = prisma as unknown as {
  saApp: { findUnique: jest.Mock };
  saUser: { findUnique: jest.Mock; findFirst: jest.Mock };
  account: { findFirst: jest.Mock };
};

const mockTokenService = {
  issueJwt: jest.fn(),
  getJwks: jest.fn(),
  resolvePermissions: jest.fn(),
};

const mockOauthService = {
  generateCode: jest.fn(),
  exchangeCode: jest.fn(),
};

const mockSqidService = {
  encode: jest.fn((id: number) => `sqid-${id}`),
  decode: jest.fn((s: string) => parseInt(s.replace('sqid-', ''), 10)),
};

describe('TokenController', () => {
  let controller: TokenController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TokenController],
      providers: [
        { provide: TokenService, useValue: mockTokenService },
        { provide: OauthService, useValue: mockOauthService },
        { provide: SqidService, useValue: mockSqidService },
        { provide: LoggerService, useValue: { log: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(), getWinstonLogger: () => ({ info: jest.fn(), warn: jest.fn(), child: jest.fn() }) } },
      ],
    }).compile();
    controller = module.get(TokenController);
    jest.clearAllMocks();
  });

  // ── GET /api/token/jwks ───────────────────────────────────────────────────

  describe('getJwks', () => {
    it('returns jwks from TokenService', () => {
      const jwks = { keys: [{ kty: 'RSA' }] };
      mockTokenService.getJwks.mockReturnValue(jwks);
      expect(controller.getJwks()).toEqual(jwks);
    });
  });

  // ── POST /api/token/direct/login ─────────────────────────────────────────

  describe('directLogin', () => {
    const app = { id: 10, publicId: 'sqid-10', isPlatform: false };
    const baUser = { id: 'ba-1', email: 'user@example.com' };
    const saUser = {
      id: 1,
      publicId: 'sqid-1',
      betterAuthUserId: 'ba-1',
      orgId: 5,
      org: { id: 5, publicId: 'sqid-5', appId: 10 },
    };
    const account = { password: 'hashed', providerId: 'credential' };

    it('throws ForbiddenException (USER_ORG_MISMATCH) when user org does not match app', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue({ ...app, id: 10 });
      mockPrisma.saUser.findFirst.mockResolvedValue({
        ...saUser,
        org: { id: 5, publicId: 'sqid-5', appId: 999 }, // different app
        betterAuthUser: baUser,
      });
      mockPrisma.account.findFirst.mockResolvedValue(account);

      await expect(
        controller.directLogin({ identifier: 'user@example.com', password: 'pw', appId: 'sqid-10' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when app does not exist', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue(null);

      await expect(
        controller.directLogin({ identifier: 'user@example.com', password: 'pw', appId: 'sqid-99' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ── GET /api/token/oauth/authorize ───────────────────────────────────────

  describe('oauthAuthorize', () => {
    const app = { id: 10, publicId: 'sqid-10', isPlatform: false };
    const fakeSession = { user: { id: 'ba-user-1', email: 'user@example.com' } };
    const saUser = {
      id: 1,
      publicId: 'sqid-1',
      betterAuthUserId: 'ba-user-1',
      orgId: 5,
      org: { id: 5, publicId: 'sqid-5', appId: 10 },
    };

    it('returns redirect url with code when session is valid and org matches', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue(app);
      mockGetSession.mockResolvedValue(fakeSession);
      mockPrisma.saUser.findFirst.mockResolvedValue(saUser);
      mockOauthService.generateCode.mockReturnValue('test-code-abc');

      const fakeReq = { headers: {} } as unknown as import('express').Request;
      const result = await controller.oauthAuthorize(
        'sqid-10',
        'https://app.example.com/callback',
        'csrf-state',
        fakeReq,
      );

      expect(result).toMatchObject({ statusCode: 302 });
      expect(result.url).toContain('code=test-code-abc');
      expect(result.url).toContain('state=csrf-state');
    });

    it('throws UnauthorizedException when session is null', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue(app);
      mockGetSession.mockResolvedValue(null);

      const fakeReq = { headers: {} } as unknown as import('express').Request;
      await expect(
        controller.oauthAuthorize('sqid-10', 'https://app.example.com/callback', '', fakeReq),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws ForbiddenException when user org does not match app', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue({ ...app, id: 10 });
      mockGetSession.mockResolvedValue(fakeSession);
      mockPrisma.saUser.findFirst.mockResolvedValue({
        ...saUser,
        org: { id: 5, publicId: 'sqid-5', appId: 999 }, // wrong app
      });

      const fakeReq = { headers: {} } as unknown as import('express').Request;
      await expect(
        controller.oauthAuthorize('sqid-10', 'https://app.example.com/callback', '', fakeReq),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ── POST /api/token/oauth/token ───────────────────────────────────────────

  describe('oauthToken', () => {
    it('returns access_token when code is valid', async () => {
      mockOauthService.exchangeCode.mockReturnValue({
        userId: 'sqid-1',
        appPublicId: 'sqid-10',
      });
      const saUser = {
        id: 1,
        publicId: 'sqid-1',
        orgId: 5,
        org: { publicId: 'sqid-5', appId: 10 },
      };
      mockPrisma.saUser.findFirst.mockResolvedValue(saUser);
      mockPrisma.saApp.findUnique.mockResolvedValue({ id: 10, publicId: 'sqid-10' });
      mockTokenService.issueJwt.mockResolvedValue('oauth.jwt.token');

      const result = await controller.oauthToken({
        code: 'valid-code',
        client_id: 'sqid-10',
        client_secret: 'secret',
        redirect_uri: 'https://app.example.com/callback',
      });

      expect(result).toEqual({
        access_token: 'oauth.jwt.token',
        token_type: 'Bearer',
        expires_in: 3600,
      });
    });
  });
});
