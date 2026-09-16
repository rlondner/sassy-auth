import {
  secretExists,
  setSecret,
  sealSecret,
  setAndVerifySecret,
  type GithubConfig,
} from './githubSecrets';

const cfg: GithubConfig = {
  owner: 'acme',
  repo: 'sassy-auth',
  environment: 'production',
  token: 'gh-token',
};

describe('secretExists', () => {
  it('returns false when GitHub responds 404', async () => {
    const fetchFn = jest.fn().mockResolvedValue({ status: 404, ok: false } as Response);
    await expect(secretExists(cfg, 'DATABASE_URL', fetchFn)).resolves.toBe(false);
    expect(fetchFn).toHaveBeenCalledWith(
      'https://api.github.com/repos/acme/sassy-auth/environments/production/secrets/DATABASE_URL',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer gh-token' }) }),
    );
  });

  it('returns true when GitHub responds 200', async () => {
    const fetchFn = jest.fn().mockResolvedValue({ status: 200, ok: true } as Response);
    await expect(secretExists(cfg, 'DATABASE_URL', fetchFn)).resolves.toBe(true);
  });

  it('throws on unexpected error status', async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValue({ status: 500, ok: false, text: async () => 'boom' } as Response);
    await expect(secretExists(cfg, 'DATABASE_URL', fetchFn)).rejects.toThrow(/500/);
  });
});

describe('sealSecret', () => {
  it('produces a non-empty base64 string', async () => {
    // A real Curve25519 public key, base64-encoded (test fixture, not a secret).
    const publicKey = 'CoLnKzljvQBrRKzO4CIfjbty8y+FVN7leGFF9DEbnzY=';
    const sealed = await sealSecret('hello-world', publicKey);
    expect(typeof sealed).toBe('string');
    expect(sealed.length).toBeGreaterThan(0);
  });
});

describe('setSecret', () => {
  it('fetches the environment public key then PUTs the encrypted value', async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ key_id: '123', key: 'CoLnKzljvQBrRKzO4CIfjbty8y+FVN7leGFF9DEbnzY=' }),
      } as Response)
      .mockResolvedValueOnce({ ok: true, status: 201, text: async () => '' } as Response);

    await setSecret(cfg, 'BETTER_AUTH_SECRET', 'super-secret-value', fetchFn);

    expect(fetchFn).toHaveBeenNthCalledWith(
      1,
      'https://api.github.com/repos/acme/sassy-auth/environments/production/secrets/public-key',
      expect.anything(),
    );
    const putCall = fetchFn.mock.calls[1];
    expect(putCall[0]).toBe(
      'https://api.github.com/repos/acme/sassy-auth/environments/production/secrets/BETTER_AUTH_SECRET',
    );
    expect(putCall[1].method).toBe('PUT');
    const body = JSON.parse(putCall[1].body);
    expect(body.key_id).toBe('123');
    expect(typeof body.encrypted_value).toBe('string');
  });

  it('throws when the PUT fails', async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ key_id: '123', key: 'CoLnKzljvQBrRKzO4CIfjbty8y+FVN7leGFF9DEbnzY=' }),
      } as Response)
      .mockResolvedValueOnce({ ok: false, status: 403, text: async () => 'forbidden' } as Response);

    await expect(setSecret(cfg, 'BETTER_AUTH_SECRET', 'value', fetchFn)).rejects.toThrow(/403/);
  });
});

describe('setAndVerifySecret', () => {
  it('resolves when the secret is set and then reads back as present', async () => {
    const fetchFn = jest
      .fn()
      // getEnvironmentPublicKey
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ key_id: '123', key: 'CoLnKzljvQBrRKzO4CIfjbty8y+FVN7leGFF9DEbnzY=' }),
      } as Response)
      // setSecret PUT
      .mockResolvedValueOnce({ ok: true, status: 201, text: async () => '' } as Response)
      // secretExists GET
      .mockResolvedValueOnce({ ok: true, status: 200 } as Response);

    await expect(
      setAndVerifySecret(cfg, 'BETTER_AUTH_SECRET', 'super-secret-value', fetchFn),
    ).resolves.toBeUndefined();

    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('throws when the secret does not read back as present after writing', async () => {
    const fetchFn = jest
      .fn()
      // getEnvironmentPublicKey
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ key_id: '123', key: 'CoLnKzljvQBrRKzO4CIfjbty8y+FVN7leGFF9DEbnzY=' }),
      } as Response)
      // setSecret PUT
      .mockResolvedValueOnce({ ok: true, status: 201, text: async () => '' } as Response)
      // secretExists GET returns 404
      .mockResolvedValueOnce({ ok: false, status: 404 } as Response);

    await expect(
      setAndVerifySecret(cfg, 'BETTER_AUTH_SECRET', 'super-secret-value', fetchFn),
    ).rejects.toThrow(/does not read back as present/);
  });
});
