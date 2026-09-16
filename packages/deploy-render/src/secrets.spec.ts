import {
  generateRsaKeyPair,
  generateBetterAuthSecret,
  generateSeedAdminPassword,
  ensureSecrets,
} from './secrets';
import * as githubSecrets from './githubSecrets';
import type { GithubConfig } from './githubSecrets';

const cfg: GithubConfig = {
  owner: 'acme',
  repo: 'sassy-auth',
  environment: 'production',
  token: 'gh-token',
};

describe('generateRsaKeyPair', () => {
  it('returns base64-encoded PKCS8/SPKI PEM strings', () => {
    const { privateKey, publicKey } = generateRsaKeyPair();
    expect(Buffer.from(privateKey, 'base64').toString('utf8')).toContain('PRIVATE KEY');
    expect(Buffer.from(publicKey, 'base64').toString('utf8')).toContain('PUBLIC KEY');
  });
});

describe('generateBetterAuthSecret', () => {
  it('returns a 64-character hex string (32 random bytes)', () => {
    expect(generateBetterAuthSecret()).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('generateSeedAdminPassword', () => {
  it('returns a password at least 12 characters long', () => {
    expect(generateSeedAdminPassword().length).toBeGreaterThanOrEqual(12);
  });
});

describe('ensureSecrets', () => {
  afterEach(() => jest.restoreAllMocks());

  it('generates and stores every secret that does not already exist', async () => {
    jest.spyOn(githubSecrets, 'secretExists').mockResolvedValue(false);
    const setSpy = jest.spyOn(githubSecrets, 'setAndVerifySecret').mockResolvedValue(undefined);

    const result = await ensureSecrets(cfg, jest.fn());

    const generatedNames = result.generated.map((g) => g.name).sort();
    expect(generatedNames).toEqual(
      ['BETTER_AUTH_SECRET', 'RSA_PRIVATE_KEY', 'RSA_PUBLIC_KEY', 'SEED_ADMIN_PASSWORD'].sort(),
    );
    expect(setSpy).toHaveBeenCalledTimes(4);
  });

  it('skips secrets that already exist', async () => {
    jest.spyOn(githubSecrets, 'secretExists').mockResolvedValue(true);
    const setSpy = jest.spyOn(githubSecrets, 'setAndVerifySecret').mockResolvedValue(undefined);

    const result = await ensureSecrets(cfg, jest.fn());

    expect(result.generated).toEqual([]);
    expect(setSpy).not.toHaveBeenCalled();
  });
});
