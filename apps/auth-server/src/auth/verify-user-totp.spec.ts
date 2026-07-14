// apps/auth-server/src/auth/verify-user-totp.spec.ts
//
// Alignment note: better-auth stores the TOTP secret as a raw random string
// (generateRandomString, NOT base32). createOTP(@better-auth/utils/otp) passes
// that raw string directly to HMAC-SHA1 (no base32 decoding). otplib v13's
// generate() does base32-decode before HMAC, so it would produce a different
// code for the same string. To keep the round-trip correct, we use:
//   - otplib generateSecret() for randomness (base32 string = valid ASCII secret)
//   - createOTP(secret).totp() to compute the code (matches how better-auth verifies)
// This is how better-auth enrollment actually works: raw string in DB, raw string
// in createOTP — not base32-decoded.
import { generateSecret } from 'otplib';
import { symmetricEncrypt } from 'better-auth/crypto';
import { createOTP } from '@better-auth/utils/otp';
import { prisma } from '@sassy-auth/db';
import { verifyUserTotp } from './verify-user-totp';

jest.mock('@sassy-auth/db', () => ({
  prisma: { twoFactor: { findUnique: jest.fn() } },
}));

const findUnique = prisma.twoFactor.findUnique as jest.Mock;

describe('verifyUserTotp', () => {
  const OLD = process.env.BETTER_AUTH_SECRET;
  beforeAll(() => { process.env.BETTER_AUTH_SECRET = 'test-secret-32-chars-min-aaaaaaaa'; });
  afterAll(() => { process.env.BETTER_AUTH_SECRET = OLD; });
  afterEach(() => { findUnique.mockReset(); });

  it('accepts a valid code and rejects a wrong one', async () => {
    // generateSecret() yields a base32 string — valid ASCII, used as a raw
    // secret string (not decoded) by better-auth's createOTP, just like
    // generateRandomString(32) would be during real enrollment.
    const secret = generateSecret();
    const stored = await symmetricEncrypt({ key: process.env.BETTER_AUTH_SECRET!, data: secret });
    findUnique.mockResolvedValue({ userId: 'ba_1', secret: stored, backupCodes: '', verified: true });

    // Compute the code the same way better-auth does internally: createOTP(rawSecret).totp()
    // This exercises the real symmetricEncrypt→symmetricDecrypt round-trip and
    // confirms createOTP produces the same code that verifyUserTotp will verify.
    const good = await createOTP(secret, { period: 30, digits: 6 }).totp();

    expect(await verifyUserTotp('ba_1', good)).toBe(true);
    expect(await verifyUserTotp('ba_1', '000000')).toBe(false);
  });

  it('returns false when the user has no TwoFactor row', async () => {
    findUnique.mockResolvedValue(null);
    expect(await verifyUserTotp('ba_missing', '123456')).toBe(false);
  });
});
