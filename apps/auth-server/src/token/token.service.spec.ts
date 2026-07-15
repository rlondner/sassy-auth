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
          { permission: { name: 'invoices.create' } },
          { permission: { name: 'reports.read' } },
        ],
      },
    },
  ],
  directPermissions: [
    { permission: { name: 'invoices.create' } }, // duplicate — must be deduped
    { permission: { name: 'sales.manage' } },
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

      const result = await service.resolvePermissions(1);

      expect(result).toEqual([
        'invoices.create',
        'reports.read',
        'sales.manage',
      ]);
    });

    it('throws USER_NOT_FOUND when sa_user does not exist', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue(null);

      await expect(service.resolvePermissions(999)).rejects.toMatchObject({
        message: expect.stringContaining('USER_NOT_FOUND'),
      });
    });
  });

  // ── JWT issuance ───────────────────────────────────────────────────────────

  describe('issueJwt', () => {
    it('includes amr when provided and omits it when empty', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue(saUserWithPermissions);
      jest.spyOn(service as any, 'resolvePermissions').mockResolvedValue([]);

      const withMfa = jwt.decode(await service.issueJwt({ saUserId: 1, userPublicId: 'u', orgPublicId: 'o', appPublicId: 'a', amr: ['pwd', 'otp', 'mfa'] })) as jwt.JwtPayload;
      expect(withMfa.amr).toEqual(['pwd', 'otp', 'mfa']);

      const none = jwt.decode(await service.issueJwt({ saUserId: 1, userPublicId: 'u', orgPublicId: 'o', appPublicId: 'a', amr: [] })) as jwt.JwtPayload;
      expect('amr' in none).toBe(false);

      const undef = jwt.decode(await service.issueJwt({ saUserId: 1, userPublicId: 'u', orgPublicId: 'o', appPublicId: 'a' })) as jwt.JwtPayload;
      expect('amr' in undef).toBe(false);
    });

    it('returns a verifiable RS256 JWT with correct claims', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue(saUserWithPermissions);

      const token = await service.issueJwt({
        saUserId: 1,
        userPublicId: 'usr-1',
        orgPublicId: 'org-1',
        appPublicId: 'app-1',
      });

      const decoded = jwt.verify(token, publicPem, {
        algorithms: ['RS256'],
      }) as jwt.JwtPayload;

      expect(decoded.sub).toBe('usr-1');
      expect(decoded.aud).toBe('app-1');
      expect(decoded.org).toBe('org-1');
      expect(decoded.iss).toBe('https://auth.example.com');
      expect(typeof decoded.scope).toBe('string');
      expect(decoded.scope).toBe('invoices.create reports.read sales.manage');
      expect(decoded.exp! - decoded.iat!).toBe(3600);

      // The JWT header must carry the env-configured `kid` so JWKS-based
      // verifiers (e.g. the FastAPI resource server) can pick the right key.
      const completed = jwt.decode(token, { complete: true }) as {
        header: { alg: string; kid?: string };
      };
      expect(completed.header.kid).toBe('test-kid-1');
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
