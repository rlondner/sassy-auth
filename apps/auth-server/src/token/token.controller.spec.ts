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
    // `update` covers the bug-0186 fire-and-forget lastLoginAt bump
    // in directLogin. Default it to resolve so the tests that don't
    // care about the write don't need to touch it.
    saUser: { findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    account: { findFirst: jest.fn() },
    user: { findUnique: jest.fn() },
  },
}));

jest.mock('../auth/verify-user-totp');

jest.mock('../auth/auth.config', () => ({
  auth: { api: { getSession: jest.fn() } },
}));

jest.mock('better-auth/crypto', () => ({
  verifyPassword: jest.fn().mockResolvedValue(true),
  hashPassword: jest.fn().mockResolvedValue('dummy-hash'),
}));

import { verifyPassword } from 'better-auth/crypto';
import { prisma } from '@sassy-auth/db';
import { auth } from '../auth/auth.config';
import { verifyUserTotp } from '../auth/verify-user-totp';

const mockGetSession = auth.api.getSession as unknown as jest.Mock;
const mockVerifyPassword = verifyPassword as unknown as jest.Mock;

const mockPrisma = prisma as unknown as {
  saApp: { findUnique: jest.Mock };
  saUser: { findUnique: jest.Mock; findFirst: jest.Mock; update: jest.Mock };
  account: { findFirst: jest.Mock };
  user: { findUnique: jest.Mock };
};

const mockTokenService = {
  issueJwt: jest.fn(),
  issueIdToken: jest.fn(),
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
    // Default: user has 2FA disabled — tests that don't care about 2FA
    // still need prisma.user.findUnique to return a value so directLogin
    // doesn't crash at the 2FA-enforcement block.
    mockPrisma.user.findUnique.mockResolvedValue({ twoFactorEnabled: false });
    // Restore fire-and-forget default after clearAllMocks.
    mockPrisma.saUser.update.mockResolvedValue({});
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

    // bug-0214: the org/app mismatch used to short-circuit with a 403
    // USER_ORG_MISMATCH *before* the scrypt verify. That handed an attacker
    // both a user-enumeration oracle (403 instantly vs 401 after ~100ms) and
    // a tenant-membership oracle. The response must now be indistinguishable
    // from a wrong password: same status, same code, same work done.
    it('throws UnauthorizedException (INVALID_CREDENTIALS), not 403, when user org does not match app', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue({ ...app, id: 10 });
      mockPrisma.saUser.findFirst.mockResolvedValue({
        ...saUser,
        org: { id: 5, publicId: 'sqid-5', appId: 999 }, // different app
        betterAuthUser: baUser,
      });
      mockPrisma.account.findFirst.mockResolvedValue(account);

      await expect(
        controller.directLogin({ identifier: 'user@example.com', password: 'pw', appId: 'sqid-10' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('verifies the password before rejecting an org/app mismatch', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue({ ...app, id: 10 });
      mockPrisma.saUser.findFirst.mockResolvedValue({
        ...saUser,
        org: { id: 5, publicId: 'sqid-5', appId: 999 },
        betterAuthUser: baUser,
      });
      mockPrisma.account.findFirst.mockResolvedValue(account);

      await expect(
        controller.directLogin({ identifier: 'user@example.com', password: 'pw', appId: 'sqid-10' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(mockVerifyPassword).toHaveBeenCalledWith({ hash: 'hashed', password: 'pw' });
    });

    it('does not issue a JWT for a user whose org belongs to another app', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue({ ...app, id: 10 });
      mockPrisma.saUser.findFirst.mockResolvedValue({
        ...saUser,
        org: { id: 5, publicId: 'sqid-5', appId: 999 },
        betterAuthUser: baUser,
      });
      mockPrisma.account.findFirst.mockResolvedValue(account);

      await expect(
        controller.directLogin({ identifier: 'user@example.com', password: 'pw', appId: 'sqid-10' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(mockTokenService.issueJwt).not.toHaveBeenCalled();
    });

    // bug-0215: a user with no credential-provider account row (social-only
    // sign-in) used to bail out before any scrypt work, so response time
    // revealed which accounts authenticate with a password and which with
    // Google/GitHub — a targeted-phishing shopping list.
    it('burns a dummy scrypt verify when the user has no credential account row', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue(app);
      mockPrisma.saUser.findFirst.mockResolvedValue({ ...saUser, betterAuthUser: baUser });
      mockPrisma.account.findFirst.mockResolvedValue(null); // social-only user

      await expect(
        controller.directLogin({ identifier: 'user@example.com', password: 'pw', appId: 'sqid-10' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(mockVerifyPassword).toHaveBeenCalledWith(
        expect.objectContaining({ password: 'pw' }),
      );
    });

    it('burns a dummy scrypt verify when the account row exists but carries no password', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue(app);
      mockPrisma.saUser.findFirst.mockResolvedValue({ ...saUser, betterAuthUser: baUser });
      mockPrisma.account.findFirst.mockResolvedValue({ providerId: 'credential', password: null });

      await expect(
        controller.directLogin({ identifier: 'user@example.com', password: 'pw', appId: 'sqid-10' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(mockVerifyPassword).toHaveBeenCalledWith(
        expect.objectContaining({ password: 'pw' }),
      );
    });

    it('never verifies against the real hash when there is no credential row', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue(app);
      mockPrisma.saUser.findFirst.mockResolvedValue({ ...saUser, betterAuthUser: baUser });
      mockPrisma.account.findFirst.mockResolvedValue(null);

      await expect(
        controller.directLogin({ identifier: 'user@example.com', password: 'pw', appId: 'sqid-10' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      // The dummy hash is generated internally, never the (absent) stored one.
      expect(mockVerifyPassword).not.toHaveBeenCalledWith({ hash: 'hashed', password: 'pw' });
    });

    it('throws NotFoundException when app does not exist', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue(null);

      await expect(
        controller.directLogin({ identifier: 'user@example.com', password: 'pw', appId: 'sqid-99' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    // bug-0147 — username / phoneNumber identifier branches now use
    // findUnique against the newly-@unique columns. Previously they used
    // findFirst on a non-unique column, so two users across different
    // orgs sharing a username silently authenticated the wrong tenant
    // (cross-org auth bug). These tests lock in the correct Prisma call.
    it('directLogin (username branch) uses findUnique on username, not findFirst', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue(app);
      mockPrisma.saUser.findUnique.mockResolvedValue({ ...saUser, betterAuthUser: baUser });
      mockPrisma.account.findFirst.mockResolvedValue(account);
      mockTokenService.issueJwt.mockResolvedValue('jwt.token');

      await controller.directLogin({ identifier: 'alice', password: 'pw', appId: 'sqid-10' });

      expect(mockPrisma.saUser.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { username: 'alice' } }),
      );
      expect(mockPrisma.saUser.findFirst).not.toHaveBeenCalled();
    });

    // bug-0186: successful directLogin bumps SaUser.lastLoginAt so the
    // admin console's "Last login" column reflects reality. The update
    // is fire-and-forget so its rejection cannot fail the login itself.
    it('bumps SaUser.lastLoginAt on successful directLogin', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue(app);
      mockPrisma.saUser.findFirst.mockResolvedValue({ ...saUser, betterAuthUser: baUser });
      mockPrisma.account.findFirst.mockResolvedValue(account);
      mockTokenService.issueJwt.mockResolvedValue('jwt.token');
      mockPrisma.saUser.update.mockResolvedValue({});

      await controller.directLogin({
        identifier: 'user@example.com',
        password: 'pw',
        appId: 'sqid-10',
      });

      expect(mockPrisma.saUser.update).toHaveBeenCalledWith({
        where: { id: saUser.id },
        data: { lastLoginAt: expect.any(Date) },
      });
    });

    it('directLogin (phone branch) uses findUnique on phoneNumber, not findFirst', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue(app);
      mockPrisma.saUser.findUnique.mockResolvedValue({ ...saUser, betterAuthUser: baUser });
      mockPrisma.account.findFirst.mockResolvedValue(account);
      mockTokenService.issueJwt.mockResolvedValue('jwt.token');

      await controller.directLogin({ identifier: '+15551234567', password: 'pw', appId: 'sqid-10' });

      expect(mockPrisma.saUser.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { phoneNumber: '+15551234567' } }),
      );
      expect(mockPrisma.saUser.findFirst).not.toHaveBeenCalled();
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

  // ── POST /api/token/direct/login — 2FA enforcement ───────────────────────

  describe('directLogin 2FA enforcement', () => {
    const app2fa = { id: 10, publicId: 'sqid-10', isPlatform: false, requireTwoFactor: false };
    const baUser2fa = { id: 'ba-1', email: 'a@b.co' };
    const saUser2fa = {
      id: 1,
      publicId: 'sqid-1',
      betterAuthUserId: 'ba-1',
      status: 'active',
      orgId: 5,
      org: { id: 5, publicId: 'sqid-5', appId: 10 },
    };
    const account2fa = { password: 'hashed', providerId: 'credential' };

    const mockApp = (overrides: Partial<typeof app2fa> = {}) =>
      mockPrisma.saApp.findUnique.mockResolvedValue({ ...app2fa, ...overrides });

    const mockDirectUser = (opts: { status: string; twoFactorEnabled: boolean; passwordOk: boolean }) => {
      mockPrisma.saUser.findFirst.mockResolvedValue({ ...saUser2fa, status: opts.status, betterAuthUser: baUser2fa });
      mockPrisma.account.findFirst.mockResolvedValue(account2fa);
      mockPrisma.user.findUnique.mockResolvedValue({ twoFactorEnabled: opts.twoFactorEnabled });
      mockTokenService.issueJwt.mockResolvedValue('jwt.token');
    };

    it('rejects with 403 two_factor_required when required and no code supplied', async () => {
      mockApp({ requireTwoFactor: true, isPlatform: false });
      mockDirectUser({ status: 'active', twoFactorEnabled: true, passwordOk: true });
      await expect(controller.directLogin({ identifier: 'a@b.co', password: 'pw', appId: 'sqid-10' } as any))
        .rejects.toMatchObject({ status: 403 });
    });

    it('issues an mfa JWT when a valid totpCode is supplied', async () => {
      mockApp({ requireTwoFactor: true, isPlatform: false });
      mockDirectUser({ status: 'active', twoFactorEnabled: true, passwordOk: true });
      (verifyUserTotp as jest.Mock).mockResolvedValue(true);
      await controller.directLogin({ identifier: 'a@b.co', password: 'pw', appId: 'sqid-10', totpCode: '123456' } as any);
      expect(mockTokenService.issueJwt).toHaveBeenCalledWith(expect.objectContaining({ amr: ['pwd', 'otp', 'mfa'] }));
    });

    it('rejects with 403 when the totpCode is wrong', async () => {
      mockApp({ requireTwoFactor: true, isPlatform: false });
      mockDirectUser({ status: 'active', twoFactorEnabled: true, passwordOk: true });
      (verifyUserTotp as jest.Mock).mockResolvedValue(false);
      await expect(controller.directLogin({ identifier: 'a@b.co', password: 'pw', appId: 'sqid-10', totpCode: '000000' } as any))
        .rejects.toMatchObject({ status: 403 });
    });

    it('issues a pwd-only JWT for a non-required app with a non-2FA user', async () => {
      mockApp({ requireTwoFactor: false, isPlatform: false });
      mockDirectUser({ status: 'active', twoFactorEnabled: false, passwordOk: true });
      await controller.directLogin({ identifier: 'a@b.co', password: 'pw', appId: 'sqid-10' } as any);
      expect(mockTokenService.issueJwt).toHaveBeenCalledWith(expect.objectContaining({ amr: ['pwd'] }));
    });
  });

  // ── GET /api/token/oauth/authorize ───────────────────────────────────────

  describe('oauthAuthorize', () => {
    const app = { id: 10, publicId: 'sqid-10', isPlatform: false, requireTwoFactor: false, url: 'https://app.example.com' };
    const fakeSession = { user: { id: 'ba-user-1', email: 'user@example.com', twoFactorEnabled: false } };
    const saUser = {
      id: 1,
      publicId: 'sqid-1',
      betterAuthUserId: 'ba-user-1',
      status: 'active',
      orgId: 5,
      org: { id: 5, publicId: 'sqid-5', appId: 10 },
    };

    const fakeReq = { headers: {} } as unknown as import('express').Request;

    // Helper to mock common authorize dependencies
    const mockApp = (overrides: Partial<typeof app> = {}) =>
      mockPrisma.saApp.findUnique.mockResolvedValue({ ...app, ...overrides });
    const mockSession = (userOverrides: Record<string, unknown> = {}) =>
      mockGetSession.mockResolvedValue({ user: { ...fakeSession.user, ...userOverrides } });
    const mockSaUser = (overrides: Partial<typeof saUser & { status: string }> = {}) =>
      mockPrisma.saUser.findFirst.mockResolvedValue({ ...saUser, ...overrides });

    it('returns redirect url with code when session is valid and org matches', async () => {
      mockApp();
      mockSession();
      mockSaUser();
      mockOauthService.generateCode.mockReturnValue('test-code-abc');

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
      mockApp();
      mockGetSession.mockResolvedValue(null);

      await expect(
        controller.oauthAuthorize('sqid-10', 'https://app.example.com/callback', 'fake-challenge', 'S256', '', fakeReq),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws ForbiddenException when user org does not match app', async () => {
      mockApp();
      mockSession();
      mockPrisma.saUser.findFirst.mockResolvedValue({
        ...saUser,
        org: { id: 5, publicId: 'sqid-5', appId: 999 }, // wrong app
      });

      await expect(
        controller.oauthAuthorize('sqid-10', 'https://app.example.com/callback', 'fake-challenge', 'S256', '', fakeReq),
      ).rejects.toThrow(ForbiddenException);
    });

    // bug-0074 — a still-valid BetterAuth session cannot mint an OAuth code
    // for a user whose SaUser.status is not 'active'.
    it.each(['inactive', 'pending'] as const)(
      'throws ForbiddenException when user status is %s',
      async (status) => {
        mockApp();
        mockSession();
        mockSaUser({ status });

        await expect(
          controller.oauthAuthorize('sqid-10', 'https://app.example.com/callback', 'fake-challenge', 'S256', '', fakeReq),
        ).rejects.toThrow(ForbiddenException);
      },
    );

    // 2FA forced-enrollment gate
    it('redirects required+unenrolled users to forced enrollment', async () => {
      process.env.ADMIN_URL = 'https://admin.example';
      mockApp({ requireTwoFactor: true, isPlatform: false });
      mockSession({ twoFactorEnabled: false });
      mockSaUser({ status: 'active' });

      const res = await controller.oauthAuthorize('sqid-10', 'https://app.example.com/callback', 'fake-challenge', 'S256', '', fakeReq);
      expect(res.url).toContain('/account/security?enroll=1&next=');
      expect(mockOauthService.generateCode).not.toHaveBeenCalled();

      delete process.env.ADMIN_URL;
    });

    it('issues a code with mfa amr for enrolled users when 2FA is required', async () => {
      mockApp({ requireTwoFactor: true, isPlatform: false });
      mockSession({ twoFactorEnabled: true });
      mockSaUser({ status: 'active' });
      mockOauthService.generateCode.mockReturnValue('mfa-code-xyz');

      await controller.oauthAuthorize('sqid-10', 'https://app.example.com/callback', 'fake-challenge', 'S256', '', fakeReq);
      expect(mockOauthService.generateCode).toHaveBeenCalledWith(
        saUser.publicId,
        app.publicId,
        'https://app.example.com/callback',
        'fake-challenge',
        'S256',
        ['pwd', 'otp', 'mfa'],
        null,
        '',
        expect.any(Date),
      );
    });

    // Task 6: nonce/scope/auth_time plumbing
    it('parses granted scopes and passes nonce through to generateCode', async () => {
      mockApp();
      mockSession();
      mockSaUser();
      mockOauthService.generateCode.mockReturnValue('test-code-abc');

      await controller.oauthAuthorize(
        'sqid-10',
        'https://app.example.com/callback',
        'fake-challenge',
        'S256',
        '',
        fakeReq,
        'email openid wat',
        'n-xyz',
      );

      expect(mockOauthService.generateCode).toHaveBeenCalledWith(
        saUser.publicId,
        app.publicId,
        'https://app.example.com/callback',
        'fake-challenge',
        'S256',
        ['pwd'],
        'n-xyz',
        'openid email',
        expect.any(Date),
      );
    });

    it('derives auth_time from the BetterAuth session createdAt', async () => {
      mockApp();
      const createdAt = new Date('2026-08-21T10:00:00Z');
      mockGetSession.mockResolvedValue({
        user: { ...fakeSession.user },
        session: { createdAt },
      });
      mockSaUser();
      mockOauthService.generateCode.mockReturnValue('test-code-abc');

      await controller.oauthAuthorize('sqid-10', 'https://app.example.com/callback', 'fake-challenge', 'S256', '', fakeReq);

      expect(mockOauthService.generateCode).toHaveBeenCalledWith(
        saUser.publicId,
        app.publicId,
        'https://app.example.com/callback',
        'fake-challenge',
        'S256',
        ['pwd'],
        null,
        '',
        createdAt,
      );
    });

    it('carries scope and nonce through the forced 2FA enrollment next= round-trip', async () => {
      process.env.ADMIN_URL = 'https://admin.example';
      mockApp({ requireTwoFactor: true, isPlatform: false });
      mockSession({ twoFactorEnabled: false });
      mockSaUser({ status: 'active' });

      const res = await controller.oauthAuthorize(
        'sqid-10',
        'https://app.example.com/callback',
        'fake-challenge',
        'S256',
        '',
        fakeReq,
        'openid profile',
        'n-abc',
      );

      const nextParam = new URL(res.url).searchParams.get('next');
      expect(nextParam).toBeTruthy();
      const nextParams = new URLSearchParams((nextParam as string).split('?')[1]);
      expect(nextParams.get('scope')).toBe('openid profile');
      expect(nextParams.get('nonce')).toBe('n-abc');

      delete process.env.ADMIN_URL;
    });

    // bug-0149 — an unauthenticated browser hitting /authorize is bounced to
    // the admin console's /login with the full authorize URL preserved as
    // `next`. Task 6 review finding: this redirect must also carry scope/nonce
    // through the round-trip, same as the forced-2FA enrollment redirect above,
    // since nonce is load-bearing for OIDC replay protection once id_token
    // issuance lands (Task 7).
    it('carries scope and nonce through the bug-0149 login redirect next= round-trip', async () => {
      process.env.ADMIN_URL = 'https://admin.example';
      mockApp();
      mockGetSession.mockResolvedValue(null);

      const res = await controller.oauthAuthorize(
        'sqid-10',
        'https://app.example.com/callback',
        'fake-challenge',
        'S256',
        'csrf-state',
        fakeReq,
        'openid profile',
        'n-login',
      );

      expect(res.url).toContain('/login?next=');
      const nextParam = new URL(res.url).searchParams.get('next');
      expect(nextParam).toBeTruthy();
      const nextParams = new URLSearchParams((nextParam as string).split('?')[1]);
      expect(nextParams.get('state')).toBe('csrf-state');
      expect(nextParams.get('scope')).toBe('openid profile');
      expect(nextParams.get('nonce')).toBe('n-login');

      delete process.env.ADMIN_URL;
    });
  });

  // ── POST /api/token/oauth/token ───────────────────────────────────────────

  describe('oauthToken', () => {
    it('returns access_token when code is valid', async () => {
      mockOauthService.exchangeCode.mockReturnValue({
        userId: 'sqid-1',
        appPublicId: 'sqid-10',
        scope: '',
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
        scope: '',
      });
    });

    it('returns id_token when the openid scope was granted', async () => {
      mockOauthService.exchangeCode.mockReturnValue({
        userId: 'sqid-1',
        appPublicId: 'sqid-10',
        scope: 'openid profile',
        nonce: 'n-abc',
        authTime: new Date('2026-08-21T10:00:00Z'),
        amr: ['pwd'],
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
      mockTokenService.issueIdToken.mockResolvedValue('oauth.id.token');

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
        scope: 'openid profile',
        id_token: 'oauth.id.token',
      });
      expect(mockTokenService.issueIdToken).toHaveBeenCalledWith(
        expect.objectContaining({
          saUserId: 1,
          userPublicId: 'sqid-1',
          orgPublicId: 'sqid-5',
          appPublicId: 'sqid-10',
          scope: 'openid profile',
          nonce: 'n-abc',
          amr: ['pwd'],
          accessToken: 'oauth.jwt.token',
        }),
      );
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
