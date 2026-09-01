import { Test } from '@nestjs/testing';
import { TokenService } from './token.service';
import { SqidService } from '../common/sqid/sqid.service';
import * as jwt from 'jsonwebtoken';
import * as crypto from 'crypto';

// ── Prisma mock ──────────────────────────────────────────────────────────────

jest.mock('@sassy-auth/db', () => ({
  prisma: {
    saUser: {
      findUnique: jest.fn(),
    },
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockPrisma = require('@sassy-auth/db').prisma as {
  saUser: { findUnique: jest.Mock };
};

// ── Key pair for tests ───────────────────────────────────────────────────────

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
const publicPem = publicKey.export({ type: 'spki', format: 'pem' }) as string;

process.env.RSA_PRIVATE_KEY = Buffer.from(privatePem).toString('base64');
process.env.RSA_PUBLIC_KEY = Buffer.from(publicPem).toString('base64');
process.env.BETTER_AUTH_URL = 'https://auth.example.com';
// Non-default value so the assertions prove the env var drives both the JWT
// header and the JWKS (and they stay in sync).
process.env.JWT_KEY_ID = 'test-kid-1';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const saUserWithPermissions = {
  id: 1,
  publicId: 'usr-1',
  betterAuthUserId: 'ba-1',
  orgId: 1,
  org: { id: 1, publicId: 'org-1', appId: 5 },
  roles: [
    {
      role: {
        permissions: [
          { permission: { name: 'invoices.create', appId: 5, isSystem: false } },
          { permission: { name: 'reports.read', appId: 5, isSystem: false } },
        ],
      },
    },
  ],
  directPermissions: [
    { permission: { name: 'invoices.create', appId: 5, isSystem: false } }, // duplicate — must be deduped
    { permission: { name: 'sales.manage', appId: 5, isSystem: false } },
  ],
};

describe('TokenService', () => {
  let service: TokenService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [TokenService, SqidService],
    }).compile();
    service = module.get(TokenService);
    jest.clearAllMocks();
  });

  // ── Permission resolution ──────────────────────────────────────────────────

  describe('resolvePermissions', () => {
    it('returns sorted, deduplicated union of role and direct permissions', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue(saUserWithPermissions);

      const result = await service.resolvePermissions(1, 5);

      expect(result).toEqual([
        'invoices.create',
        'reports.read',
        'sales.manage',
      ]);
    });

    it('throws USER_NOT_FOUND when sa_user does not exist', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue(null);

      await expect(service.resolvePermissions(999, 5)).rejects.toMatchObject({
        message: expect.stringContaining('USER_NOT_FOUND'),
      });
    });
  });

  // ── JWT issuance ───────────────────────────────────────────────────────────

  describe('issueJwt', () => {
    it('includes amr when provided and omits it when empty', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue(saUserWithPermissions);
      jest.spyOn(service as any, 'resolvePermissions').mockResolvedValue([]);

      const withMfa = jwt.decode(await service.issueJwt({ saUserId: 1, userPublicId: 'u', orgPublicId: 'o', appPublicId: 'a', appId: 5, scope: '', amr: ['pwd', 'otp', 'mfa'] })) as jwt.JwtPayload;
      expect(withMfa.amr).toEqual(['pwd', 'otp', 'mfa']);

      const none = jwt.decode(await service.issueJwt({ saUserId: 1, userPublicId: 'u', orgPublicId: 'o', appPublicId: 'a', appId: 5, scope: '', amr: [] })) as jwt.JwtPayload;
      expect('amr' in none).toBe(false);

      const undef = jwt.decode(await service.issueJwt({ saUserId: 1, userPublicId: 'u', orgPublicId: 'o', appPublicId: 'a', appId: 5, scope: '' })) as jwt.JwtPayload;
      expect('amr' in undef).toBe(false);
    });

    it('returns a verifiable RS256 JWT with correct claims', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue(saUserWithPermissions);

      const token = await service.issueJwt({
        saUserId: 1,
        userPublicId: 'usr-1',
        orgPublicId: 'org-1',
        appPublicId: 'app-1',
        appId: 5,
        scope: 'openid profile',
      });

      const decoded = jwt.verify(token, publicPem, {
        algorithms: ['RS256'],
      }) as jwt.JwtPayload;

      expect(decoded.sub).toBe('usr-1');
      expect(decoded.aud).toBe('app-1');
      expect(decoded.org).toBe('org-1');
      expect(decoded.iss).toBe('https://auth.example.com');
      expect(typeof decoded.scope).toBe('string');
      expect(decoded.scope).toBe('openid profile');
      expect(decoded.permissions).toEqual(['invoices.create', 'reports.read', 'sales.manage']);
      expect(decoded.exp! - decoded.iat!).toBe(3600);

      // The JWT header must carry the env-configured `kid` so JWKS-based
      // verifiers (e.g. the FastAPI resource server) can pick the right key.
      const completed = jwt.decode(token, { complete: true }) as {
        header: { alg: string; kid?: string };
      };
      expect(completed.header.kid).toBe('test-kid-1');
    });
  });

  describe('resolvePermissions — audience filtering (bug-0157)', () => {
    it('excludes non-system permissions belonging to another app', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue({
        id: 1,
        roles: [
          { role: { permissions: [
            { permission: { name: 'rs.properties.read', appId: 7, isSystem: false } },
            { permission: { name: 'other.secret.read', appId: 99, isSystem: false } },
          ] } },
        ],
        directPermissions: [],
      });

      const result = await service.resolvePermissions(1, 7);

      expect(result).toEqual(['rs.properties.read']);
    });

    it('keeps system permissions regardless of their owning app', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue({
        id: 1,
        roles: [],
        directPermissions: [
          { permission: { name: 'org.users.manage', appId: 99, isSystem: true } },
          { permission: { name: 'other.secret.read', appId: 99, isSystem: false } },
        ],
      });

      const result = await service.resolvePermissions(1, 7);

      expect(result).toEqual(['org.users.manage']);
    });
  });

  describe('issueJwt — claim shape', () => {
    beforeEach(() => {
      mockPrisma.saUser.findUnique.mockResolvedValue({
        id: 1,
        roles: [],
        directPermissions: [
          { permission: { name: 'rs.properties.read', appId: 7, isSystem: false } },
        ],
      });
    });

    it('puts granted scopes in `scope` and permissions in a `permissions` array', async () => {
      const token = await service.issueJwt({
        saUserId: 1,
        userPublicId: 'u_1',
        orgPublicId: 'o_1',
        appPublicId: 'a_7',
        appId: 7,
        scope: 'openid profile',
      });

      const decoded = jwt.decode(token) as Record<string, unknown>;
      expect(decoded.scope).toBe('openid profile');
      expect(decoded.permissions).toEqual(['rs.properties.read']);
    });

    it('emits an empty scope string when no scopes were granted', async () => {
      const token = await service.issueJwt({
        saUserId: 1,
        userPublicId: 'u_1',
        orgPublicId: 'o_1',
        appPublicId: 'a_7',
        appId: 7,
        scope: '',
      });

      const decoded = jwt.decode(token) as Record<string, unknown>;
      expect(decoded.scope).toBe('');
      expect(decoded.permissions).toEqual(['rs.properties.read']);
    });
  });

  // ── id_token issuance ────────────────────────────────────────────────────

  describe('issueIdToken', () => {
    const baseParams = {
      saUserId: 1, userPublicId: 'u_1', orgPublicId: 'o_1', appPublicId: 'a_7',
      nonce: 'n-123', authTime: new Date('2026-08-21T10:00:00Z'),
      amr: ['pwd'], accessToken: 'header.payload.signature',
    };

    beforeEach(() => {
      mockPrisma.saUser.findUnique.mockResolvedValue({
        id: 1, firstName: 'Ada', lastName: 'Lovelace',
        org: { publicId: 'o_1' },
        betterAuthUser: { email: 'ada@example.com', emailVerified: true },
      });
    });

    it('always emits the core identity claims', async () => {
      const decoded = jwt.decode(await service.issueIdToken({ ...baseParams, scope: 'openid' })) as Record<string, unknown>;

      expect(decoded.sub).toBe('u_1');
      expect(decoded.aud).toBe('a_7');
      expect(decoded.org).toBe('o_1');
      expect(decoded.nonce).toBe('n-123');
      expect(decoded.amr).toEqual(['pwd']);
      expect(decoded.auth_time).toBe(Math.floor(baseParams.authTime.getTime() / 1000));
      expect(typeof decoded.at_hash).toBe('string');
      expect(decoded.azp).toBeUndefined();
    });

    it('omits profile and email claims when those scopes were not granted', async () => {
      const decoded = jwt.decode(await service.issueIdToken({ ...baseParams, scope: 'openid' })) as Record<string, unknown>;

      expect(decoded.name).toBeUndefined();
      expect(decoded.email).toBeUndefined();
    });

    it('includes profile claims for the profile scope', async () => {
      const decoded = jwt.decode(await service.issueIdToken({ ...baseParams, scope: 'openid profile' })) as Record<string, unknown>;

      expect(decoded.name).toBe('Ada Lovelace');
      expect(decoded.given_name).toBe('Ada');
      expect(decoded.family_name).toBe('Lovelace');
      expect(decoded.email).toBeUndefined();
    });

    it('includes email claims for the email scope', async () => {
      const decoded = jwt.decode(await service.issueIdToken({ ...baseParams, scope: 'openid email' })) as Record<string, unknown>;

      expect(decoded.email).toBe('ada@example.com');
      expect(decoded.email_verified).toBe(true);
      expect(decoded.name).toBeUndefined();
    });

    it('omits nonce when the client did not send one', async () => {
      const decoded = jwt.decode(await service.issueIdToken({ ...baseParams, nonce: null, scope: 'openid' })) as Record<string, unknown>;

      expect(decoded).not.toHaveProperty('nonce');
    });
  });

  // ── JWKS ──────────────────────────────────────────────────────────────────

  describe('getJwks', () => {
    it('returns a JWKS object with at least one RSA key', () => {
      const jwks = service.getJwks();
      expect(jwks.keys).toHaveLength(1);
      expect(jwks.keys[0].kty).toBe('RSA');
      expect(jwks.keys[0].alg).toBe('RS256');
      expect(jwks.keys[0].use).toBe('sig');
      expect(jwks.keys[0].kid).toBe('test-kid-1');
    });
  });
});
