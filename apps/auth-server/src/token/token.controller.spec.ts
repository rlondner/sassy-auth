import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import * as jwt from 'jsonwebtoken';
import * as crypto from 'crypto';
import { TokenController } from './token.controller';
import { TokenService } from './token.service';
import { OauthService } from './oauth.service';
import { SqidService } from '../common/sqid/sqid.service';
import { LoggerService } from '../common/logger/logger.service';
import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { TokenErrorCode } from '@sassy-auth/types';
import { resolveIssuer } from './oauth-metadata';

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

import { verifyPassword, hashPassword } from 'better-auth/crypto';
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

// ── Key pair for signing test bearer tokens ─────────────────────────────────
// verifyAccessToken below actually verifies against this key, so
// signTestToken produces tokens the controller's real auth-gate logic
// accepts or rejects for real, rather than the mock trivially agreeing
// with itself.
const { privateKey: testPrivateKey, publicKey: testPublicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const testPrivatePem = testPrivateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
const testPublicPem = testPublicKey.export({ type: 'spki', format: 'pem' }) as string;

function signTestToken(payload: Record<string, unknown>): string {
  return jwt.sign(payload, testPrivatePem, { algorithm: 'RS256', issuer: resolveIssuer() });
}

const mockTokenService = {
  issueJwt: jest.fn(),
  issueIdToken: jest.fn(),
  getJwks: jest.fn(),
  resolvePermissions: jest.fn(),
  buildScopedClaims: jest.fn(),
  verifyAccessToken: jest.fn((token: string) =>
    jwt.verify(token, testPublicPem, { algorithms: ['RS256'], issuer: resolveIssuer() }),
  ),
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
    const mockSession = (
      userOverrides: Record<string, unknown> = {},
      sessionOverrides: Record<string, unknown> = {},
    ) =>
      mockGetSession.mockResolvedValue({
        user: { ...fakeSession.user, ...userOverrides },
        // signInMethod defaults to null, matching a pre-migration session
        // (Task 4): deriveAuthMethods falls back to the legacy 'pwd' path.
        session: { signInMethod: null, ...sessionOverrides },
      });
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
        undefined,
      );
    });

    // Task 5 — a federated sign-in must never claim 'pwd' and must carry
    // the provider name through to the authorization code.
    it('issues a code with ext amr and the provider idp for a federated session', async () => {
      mockApp();
      mockSession({}, { signInMethod: 'ext:google' });
      mockSaUser();
      mockOauthService.generateCode.mockReturnValue('federated-code');

      await controller.oauthAuthorize('sqid-10', 'https://app.example.com/callback', 'fake-challenge', 'S256', '', fakeReq);
      expect(mockOauthService.generateCode).toHaveBeenCalledWith(
        saUser.publicId,
        app.publicId,
        'https://app.example.com/callback',
        'fake-challenge',
        'S256',
        ['ext'],
        null,
        '',
        expect.any(Date),
        'google',
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
        undefined,
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
        undefined,
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
    // Task 9: oauthToken now takes @Req/@Res for client-secret extraction and
    // the WWW-Authenticate header. These unit-level tests don't exercise
    // client auth (no Authorization header, no client_secret in the body),
    // so a bare stand-in is enough — the confidential-client invariants
    // below exercise real req/res via supertest.
    const fakeTokenReq = { headers: {} } as unknown as import('express').Request;
    const fakeTokenRes = { setHeader: jest.fn() } as unknown as import('express').Response;

    it('returns access_token when code is valid', async () => {
      mockOauthService.exchangeCode.mockReturnValue({
        userId: 'sqid-1',
        appPublicId: 'sqid-10',
        scope: '',
        hadChallenge: true,
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

      const result = await controller.oauthToken(
        {
          code: 'valid-code',
          client_id: 'sqid-10',
          code_verifier: 'a'.repeat(64),
          redirect_uri: 'https://app.example.com/callback',
        },
        fakeTokenReq,
        fakeTokenRes,
      );

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
        hadChallenge: true,
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

      const result = await controller.oauthToken(
        {
          code: 'valid-code',
          client_id: 'sqid-10',
          code_verifier: 'a'.repeat(64),
          redirect_uri: 'https://app.example.com/callback',
        },
        fakeTokenReq,
        fakeTokenRes,
      );

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

    // Task 5 — idp must round-trip from the exchanged code into issueJwt so
    // the JWT can carry which provider was used for a federated sign-in.
    it('passes the exchanged idp through to issueJwt', async () => {
      mockOauthService.exchangeCode.mockReturnValue({
        userId: 'sqid-1',
        appPublicId: 'sqid-10',
        amr: ['ext'],
        scope: '',
        idp: 'google',
        hadChallenge: true,
      });
      mockPrisma.saUser.findFirst.mockResolvedValue({
        id: 1,
        publicId: 'sqid-1',
        status: 'active',
        orgId: 5,
        org: { publicId: 'sqid-5', appId: 10 },
      });
      mockPrisma.saApp.findUnique.mockResolvedValue({ id: 10, publicId: 'sqid-10', url: 'https://app.example.com' });
      mockTokenService.issueJwt.mockResolvedValue('oauth.jwt.token');

      await controller.oauthToken(
        {
          code: 'valid-code',
          client_id: 'sqid-10',
          code_verifier: 'a'.repeat(64),
          redirect_uri: 'https://app.example.com/callback',
        },
        fakeTokenReq,
        fakeTokenRes,
      );

      expect(mockTokenService.issueJwt).toHaveBeenCalledWith(
        expect.objectContaining({ amr: ['ext'], idp: 'google' }),
      );
    });

    // bug-0074 — the OAuth code was issued at /authorize time when the user
    // was active, but they can be deactivated between /authorize and /token.
    // Re-check status here so a mid-flow deactivation is honored.
    it('throws ForbiddenException when user status flipped to inactive between authorize and token', async () => {
      mockOauthService.exchangeCode.mockReturnValue({
        userId: 'sqid-1',
        appPublicId: 'sqid-10',
        hadChallenge: true,
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
        controller.oauthToken(
          {
            code: 'valid-code',
            client_id: 'sqid-10',
            code_verifier: 'a'.repeat(64),
            redirect_uri: 'https://app.example.com/callback',
          },
          fakeTokenReq,
          fakeTokenRes,
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ── Task 9: confidential clients — §2 invariant ──────────────────────────
  //
  // "A PKCE-challenge-less authorization code may only be exchanged by a
  // request that authenticates with a client secret" is enforced at two
  // independent points: /authorize (refuses to *issue* a challenge-less code
  // unless the app is confidential) and /token (refuses to *exchange* a
  // challenge-less code unless the caller authenticated). Neither check
  // alone is sufficient — a bug removing either one must be caught by a test
  // that cannot pass via the other check. Tests below are written so each
  // exercises exactly one side.

  describe('confidential client invariants', () => {
    let app: INestApplication;

    beforeAll(async () => {
      const moduleRef: TestingModule = await Test.createTestingModule({
        controllers: [TokenController],
        providers: [
          { provide: TokenService, useValue: mockTokenService },
          { provide: OauthService, useValue: mockOauthService },
          { provide: SqidService, useValue: mockSqidService },
          { provide: LoggerService, useValue: { log: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(), getWinstonLogger: () => ({ info: jest.fn(), warn: jest.fn(), child: jest.fn() }) } },
        ],
      }).compile();
      app = moduleRef.createNestApplication();
      app.setGlobalPrefix('api');
      await app.init();
    });

    afterAll(async () => {
      await app.close();
    });

    beforeEach(() => {
      jest.clearAllMocks();
      mockVerifyPassword.mockResolvedValue(true);
    });

    it('/authorize refuses to omit PKCE for a public app', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue({
        id: 7, publicId: 'a_7', url: 'https://app.example.com',
        clientSecretHash: null, redirectUris: [],
      });

      const res = await request(app.getHttpServer())
        .get('/api/token/oauth/authorize')
        .query({ client_id: 'a_7', redirect_uri: 'https://app.example.com/cb', scope: 'openid' });

      expect(res.status).toBe(400);
      expect(mockOauthService.generateCode).not.toHaveBeenCalled();
    });

    it('/authorize allows omitting PKCE for a confidential app', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue({
        id: 7, publicId: 'a_7', url: 'https://app.example.com',
        clientSecretHash: 'scrypt-hash', redirectUris: [],
      });

      const res = await request(app.getHttpServer())
        .get('/api/token/oauth/authorize')
        .query({ client_id: 'a_7', redirect_uri: 'https://app.example.com/cb', scope: 'openid' });

      // Weak on its own (see Ruling 2, T9 pre-flight ledger): `not.toBe(400)`
      // alone would also pass if the request failed for an unrelated reason
      // downstream (e.g. no session) while the PKCE gate itself was broken
      // and rejecting everything with 400 regardless of app type. Assert
      // directly that the response is not the PKCE `invalid_request` error,
      // so a regression that makes PKCE mandatory again for confidential
      // apps is caught even if some other check also happens to fail here.
      expect(res.status).not.toBe(400);
      expect(res.body?.message).not.toBe('invalid_request');
    });

    // Exercises the /authorize-side check only: it would fail (400 becomes
    // something else, or a code gets issued) if that check were removed,
    // independent of whatever /token does.
    it('/authorize issues a challenge-less code once the app is confidential', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue({
        id: 7, publicId: 'a_7', url: 'https://app.example.com',
        clientSecretHash: 'scrypt-hash', redirectUris: [],
      });
      mockGetSession.mockResolvedValue({
        user: { id: 'ba-user-1', email: 'user@example.com', twoFactorEnabled: false },
        session: { signInMethod: null },
      });
      mockPrisma.saUser.findFirst.mockResolvedValue({
        id: 1, publicId: 'sqid-1', betterAuthUserId: 'ba-user-1', status: 'active',
        org: { id: 5, publicId: 'sqid-5', appId: 7 },
      });
      mockOauthService.generateCode.mockResolvedValue('confidential-code');

      const res = await request(app.getHttpServer())
        .get('/api/token/oauth/authorize')
        .query({ client_id: 'a_7', redirect_uri: 'https://app.example.com/cb', scope: 'openid' });

      expect(res.status).toBe(302);
      expect(mockOauthService.generateCode).toHaveBeenCalledWith(
        'sqid-1', 'a_7', 'https://app.example.com/cb', null, null,
        expect.any(Array), null, 'openid', expect.any(Date), undefined,
      );
    });

    it('/token rejects a challenge-less code when the client did not authenticate', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue({
        id: 7, publicId: 'a_7', url: 'https://app.example.com',
        clientSecretHash: 'scrypt-hash', redirectUris: [],
      });
      mockOauthService.exchangeCode.mockResolvedValue({
        userId: 'u_1', appPublicId: 'a_7', amr: ['pwd'],
        nonce: null, scope: 'openid', authTime: new Date(), hadChallenge: false,
      });

      const res = await request(app.getHttpServer())
        .post('/api/token/oauth/token')
        .send({ code: 'c', client_id: 'a_7', redirect_uri: 'https://app.example.com/cb' });

      expect(res.status).toBe(401);
      expect(mockTokenService.issueJwt).not.toHaveBeenCalled();
    });

    // Exercises the /token-side check in isolation from the /token-side
    // "confidential app failed to authenticate" check above: the app here
    // is public (no clientSecretHash), so the first check (`app.clientSecretHash
    // && !clientAuthenticated`) never fires — only the second check
    // (`!exchanged.hadChallenge && !clientAuthenticated`) can produce the
    // 401. This is the scenario the invariant exists for: a code that
    // somehow carries no PKCE challenge (e.g. the app's secret was rotated
    // away, or a bug elsewhere let one slip past /authorize) must still be
    // refused at exchange time.
    it('/token rejects a challenge-less code for a public app with no client secret to present', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue({
        id: 7, publicId: 'a_7', url: 'https://app.example.com',
        clientSecretHash: null, redirectUris: [],
      });
      mockOauthService.exchangeCode.mockResolvedValue({
        userId: 'u_1', appPublicId: 'a_7', amr: ['pwd'],
        nonce: null, scope: 'openid', authTime: new Date(), hadChallenge: false,
      });

      const res = await request(app.getHttpServer())
        .post('/api/token/oauth/token')
        .send({ code: 'c', client_id: 'a_7', redirect_uri: 'https://app.example.com/cb' });

      expect(res.status).toBe(401);
      expect(mockTokenService.issueJwt).not.toHaveBeenCalled();
    });

    it('/token allows a challenge-less code when the client authenticated with the correct secret', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue({
        id: 7, publicId: 'a_7', url: 'https://app.example.com',
        clientSecretHash: 'scrypt-hash', redirectUris: [],
      });
      mockOauthService.exchangeCode.mockResolvedValue({
        userId: 'u_1', appPublicId: 'a_7', amr: ['pwd'],
        nonce: null, scope: 'openid', authTime: new Date(), hadChallenge: false,
      });
      mockPrisma.saUser.findFirst.mockResolvedValue({
        id: 1, publicId: 'u_1', status: 'active', org: { publicId: 'org_1', appId: 7 },
      });
      mockTokenService.issueJwt.mockResolvedValue('jwt-token');
      mockVerifyPassword.mockResolvedValue(true);

      const res = await request(app.getHttpServer())
        .post('/api/token/oauth/token')
        .send({
          code: 'c', client_id: 'a_7', redirect_uri: 'https://app.example.com/cb',
          client_secret: 'right',
        });

      expect(res.status).toBe(201);
      expect(res.body.access_token).toBe('jwt-token');
    });

    it('/token rejects a wrong client secret with invalid_client', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue({
        id: 7, publicId: 'a_7', url: 'https://app.example.com',
        clientSecretHash: await hashPassword('right'), redirectUris: [],
      });
      mockVerifyPassword.mockResolvedValueOnce(false);

      const res = await request(app.getHttpServer())
        .post('/api/token/oauth/token')
        .send({ code: 'c', client_id: 'a_7', redirect_uri: 'https://app.example.com/cb', client_secret: 'wrong' });

      expect(res.status).toBe(401);
      expect(res.headers['www-authenticate']).toContain('Basic');
      expect(res.body.message).toBe(TokenErrorCode.INVALID_CLIENT);
      expect(mockOauthService.exchangeCode).not.toHaveBeenCalled();
    });

    it('checks both a presented client secret and a presented PKCE verifier when both are sent', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue({
        id: 7, publicId: 'a_7', url: 'https://app.example.com',
        clientSecretHash: 'scrypt-hash', redirectUris: [],
      });
      mockOauthService.exchangeCode.mockResolvedValue({
        userId: 'u_1', appPublicId: 'a_7', amr: ['pwd'],
        nonce: null, scope: 'openid', authTime: new Date(), hadChallenge: true,
      });
      mockPrisma.saUser.findFirst.mockResolvedValue({
        id: 1, publicId: 'u_1', status: 'active', org: { publicId: 'org_1', appId: 7 },
      });
      mockTokenService.issueJwt.mockResolvedValue('jwt-token');
      mockVerifyPassword.mockResolvedValue(true);

      const res = await request(app.getHttpServer())
        .post('/api/token/oauth/token')
        .send({
          code: 'c', client_id: 'a_7', redirect_uri: 'https://app.example.com/cb',
          client_secret: 'right', code_verifier: 'v'.repeat(64),
        });

      expect(res.status).toBe(201);
      // Both credentials were checked: the secret via verifyPassword, the
      // verifier via exchangeCode (PKCE lives inside OauthService).
      expect(mockVerifyPassword).toHaveBeenCalled();
      expect(mockOauthService.exchangeCode).toHaveBeenCalledWith(
        'c', 'a_7', 'https://app.example.com/cb', 'v'.repeat(64),
      );
    });
  });

  // ── GET /api/token/oauth/userinfo ────────────────────────────────────────

  describe('GET /api/token/oauth/userinfo', () => {
    let app: INestApplication;

    beforeAll(async () => {
      const moduleRef: TestingModule = await Test.createTestingModule({
        controllers: [TokenController],
        providers: [
          { provide: TokenService, useValue: mockTokenService },
          { provide: OauthService, useValue: mockOauthService },
          { provide: SqidService, useValue: mockSqidService },
          { provide: LoggerService, useValue: { log: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(), getWinstonLogger: () => ({ info: jest.fn(), warn: jest.fn(), child: jest.fn() }) } },
        ],
      }).compile();
      app = moduleRef.createNestApplication();
      app.setGlobalPrefix('api');
      await app.init();
    });

    afterAll(async () => {
      await app.close();
    });

    it('returns sub plus the claims the token was granted', async () => {
      const token = signTestToken({ sub: 'u_1', aud: 'a_7', scope: 'openid profile' });
      mockPrisma.saUser.findFirst.mockResolvedValue({ id: 1, publicId: 'u_1', status: 'active' });
      mockTokenService.buildScopedClaims.mockResolvedValue({
        name: 'Ada Lovelace', given_name: 'Ada', family_name: 'Lovelace',
      });

      const res = await request(app.getHttpServer())
        .get('/api/token/oauth/userinfo')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.sub).toBe('u_1');
      expect(res.body.name).toBe('Ada Lovelace');
    });

    it('cannot return a claim the token did not grant', async () => {
      const token = signTestToken({ sub: 'u_1', aud: 'a_7', scope: 'openid' });
      mockPrisma.saUser.findFirst.mockResolvedValue({ id: 1, publicId: 'u_1', status: 'active' });
      mockTokenService.buildScopedClaims.mockResolvedValue({});

      const res = await request(app.getHttpServer())
        .get('/api/token/oauth/userinfo')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ sub: 'u_1' });
      expect(mockTokenService.buildScopedClaims).toHaveBeenCalledWith(expect.any(Number), 'openid');
    });

    it('rejects a missing bearer token', async () => {
      const res = await request(app.getHttpServer()).get('/api/token/oauth/userinfo');
      expect(res.status).toBe(401);
    });

    it('rejects a token with a bad signature', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/token/oauth/userinfo')
        .set('Authorization', 'Bearer not.a.token');
      expect(res.status).toBe(401);
    });

    // Not in the brief's exact test list, but this is the named security
    // invariant this endpoint exists to uphold: a valid token for a user
    // who is no longer active must not be served stale claims.
    it('rejects a valid token for a user who is no longer active', async () => {
      const token = signTestToken({ sub: 'u_1', aud: 'a_7', scope: 'openid profile' });
      mockPrisma.saUser.findFirst.mockResolvedValue({ id: 1, publicId: 'u_1', status: 'inactive' });

      const res = await request(app.getHttpServer())
        .get('/api/token/oauth/userinfo')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(401);
      expect(mockTokenService.buildScopedClaims).not.toHaveBeenCalled();
    });

    it('rejects a token for a user that no longer exists', async () => {
      const token = signTestToken({ sub: 'u_ghost', aud: 'a_7', scope: 'openid' });
      mockPrisma.saUser.findFirst.mockResolvedValue(null);

      const res = await request(app.getHttpServer())
        .get('/api/token/oauth/userinfo')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(401);
    });
  });
});
