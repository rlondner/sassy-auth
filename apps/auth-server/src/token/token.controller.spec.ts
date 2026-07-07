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

const mockGetSession = auth.api.getSession as unknown as jest.Mock;

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
      status: 'active',
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

    // bug-0074 — inactive/pending users must not receive a JWT even with the
    // correct password. Kept opaque as INVALID_CREDENTIALS so response does not
    // leak that the account exists.
    it.each(['inactive', 'pending'] as const)(
      'throws UnauthorizedException (INVALID_CREDENTIALS) when user status is %s',
      async (status) => {
        mockPrisma.saApp.findUnique.mockResolvedValue(app);
        mockPrisma.saUser.findFirst.mockResolvedValue({
          ...saUser,
          status,
          betterAuthUser: baUser,
        });
        mockPrisma.account.findFirst.mockResolvedValue(account);

        await expect(
          controller.directLogin({ identifier: 'user@example.com', password: 'pw', appId: 'sqid-10' }),
        ).rejects.toBeInstanceOf(UnauthorizedException);
      },
    );
  });

  // ── GET /api/token/oauth/authorize ───────────────────────────────────────

  describe('oauthAuthorize', () => {
    const app = { id: 10, publicId: 'sqid-10', isPlatform: false, url: 'https://app.example.com' };
    const fakeSession = { user: { id: 'ba-user-1', email: 'user@example.com' } };
    const saUser = {
      id: 1,
      publicId: 'sqid-1',
      betterAuthUserId: 'ba-user-1',
      status: 'active',
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
        'fake-challenge',
        'S256',
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
        controller.oauthAuthorize('sqid-10', 'https://app.example.com/callback', 'fake-challenge', 'S256', '', fakeReq),
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
        controller.oauthAuthorize('sqid-10', 'https://app.example.com/callback', 'fake-challenge', 'S256', '', fakeReq),
      ).rejects.toThrow(ForbiddenException);
    });

    // bug-0074 — a still-valid BetterAuth session cannot mint an OAuth code
    // for a user whose SaUser.status is not 'active'.
    it.each(['inactive', 'pending'] as const)(
      'throws ForbiddenException when user status is %s',
      async (status) => {
        mockPrisma.saApp.findUnique.mockResolvedValue(app);
        mockGetSession.mockResolvedValue(fakeSession);
        mockPrisma.saUser.findFirst.mockResolvedValue({ ...saUser, status });

        const fakeReq = { headers: {} } as unknown as import('express').Request;
        await expect(
          controller.oauthAuthorize('sqid-10', 'https://app.example.com/callback', 'fake-challenge', 'S256', '', fakeReq),
        ).rejects.toThrow(ForbiddenException);
      },
    );
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
        status: 'active',
        orgId: 5,
        org: { publicId: 'sqid-5', appId: 10 },
      };
      mockPrisma.saUser.findFirst.mockResolvedValue(saUser);
      mockPrisma.saApp.findUnique.mockResolvedValue({ id: 10, publicId: 'sqid-10', url: 'https://app.example.com' });
      mockTokenService.issueJwt.mockResolvedValue('oauth.jwt.token');

      const result = await controller.oauthToken({
        code: 'valid-code',
        client_id: 'sqid-10',
        code_verifier: 'a'.repeat(64),
        redirect_uri: 'https://app.example.com/callback',
      });

      expect(result).toEqual({
        access_token: 'oauth.jwt.token',
        token_type: 'Bearer',
        expires_in: 3600,
      });
    });

    // bug-0074 — the OAuth code was issued at /authorize time when the user
    // was active, but they can be deactivated between /authorize and /token.
    // Re-check status here so a mid-flow deactivation is honored.
    it('throws ForbiddenException when user status flipped to inactive between authorize and token', async () => {
      mockOauthService.exchangeCode.mockReturnValue({
        userId: 'sqid-1',
        appPublicId: 'sqid-10',
      });
      mockPrisma.saUser.findFirst.mockResolvedValue({
        id: 1,
        publicId: 'sqid-1',
        status: 'inactive',
        orgId: 5,
        org: { publicId: 'sqid-5', appId: 10 },
      });
      mockPrisma.saApp.findUnique.mockResolvedValue({ id: 10, publicId: 'sqid-10', url: 'https://app.example.com' });

      await expect(
        controller.oauthToken({
          code: 'valid-code',
          client_id: 'sqid-10',
          code_verifier: 'a'.repeat(64),
          redirect_uri: 'https://app.example.com/callback',
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
