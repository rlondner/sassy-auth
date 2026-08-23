import { availableSocialProviders, buildSocialProviders } from './build-social-providers';
import { runWithPrivateRelayCapture, readIsPrivateEmail } from './apple-private-relay-context';

function appleEnv() {
  const crypto = require('node:crypto') as typeof import('node:crypto');
  const { privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  return {
    APPLE_CLIENT_ID: 'com.example.service',
    APPLE_TEAM_ID: 'TEAM123456',
    APPLE_KEY_ID: 'KEY7890',
    APPLE_PRIVATE_KEY: privateKey,
  };
}

const GOOGLE = { GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gsecret' };

describe('availableSocialProviders', () => {
  it('lists a provider only when both id and secret are set', () => {
    expect(availableSocialProviders(GOOGLE)).toEqual(['google']);
    expect(availableSocialProviders({ GOOGLE_CLIENT_ID: 'gid' })).toEqual([]);
    expect(availableSocialProviders({ GOOGLE_CLIENT_SECRET: 'gsecret' })).toEqual([]);
  });

  it('treats Apple as available on the key triple, not a client secret', () => {
    const env = {
      APPLE_CLIENT_ID: 'com.example.svc',
      APPLE_TEAM_ID: 'TEAM123',
      APPLE_KEY_ID: 'KEY123',
      APPLE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----',
    };
    expect(availableSocialProviders(env)).toEqual(['apple']);
    delete (env as Record<string, unknown>).APPLE_KEY_ID;
    expect(availableSocialProviders(env)).toEqual([]);
  });

  it('returns an empty list when nothing is configured', () => {
    expect(availableSocialProviders({})).toEqual([]);
  });

  it('returns [\'stub\'] when E2E_STUB_IDP_URL is set and NODE_ENV is \'test\'', () => {
    expect(
      availableSocialProviders({ E2E_STUB_IDP_URL: 'http://localhost:9999', NODE_ENV: 'test' }),
    ).toEqual(['stub']);
  });

  it('returns [] when E2E_STUB_IDP_URL is set and NODE_ENV is \'production\'', () => {
    expect(
      availableSocialProviders({
        E2E_STUB_IDP_URL: 'http://localhost:9999',
        NODE_ENV: 'production',
      }),
    ).toEqual([]);
  });

  it("returns ['stub'] when E2E_STUB_IDP_URL is set and NODE_ENV is 'development'", () => {
    expect(
      availableSocialProviders({
        E2E_STUB_IDP_URL: 'http://localhost:9999',
        NODE_ENV: 'development',
      }),
    ).toEqual(['stub']);
  });

  it('returns [] when E2E_STUB_IDP_URL is set and NODE_ENV is absent from the env object', () => {
    expect(availableSocialProviders({ E2E_STUB_IDP_URL: 'http://localhost:9999' })).toEqual([]);
  });

  it('returns [] when E2E_STUB_IDP_URL is set and NODE_ENV is mis-cased (\'Production\')', () => {
    expect(
      availableSocialProviders({
        E2E_STUB_IDP_URL: 'http://localhost:9999',
        NODE_ENV: 'Production',
      }),
    ).toEqual([]);
  });

  it('returns [] when E2E_STUB_IDP_URL is set and NODE_ENV is an empty string', () => {
    expect(
      availableSocialProviders({ E2E_STUB_IDP_URL: 'http://localhost:9999', NODE_ENV: '' }),
    ).toEqual([]);
  });
});

describe('buildSocialProviders', () => {
  it('sets disableSignUp on every provider so federation stays invite-only', () => {
    const built = buildSocialProviders(GOOGLE) as Record<string, { disableSignUp: boolean }>;
    expect(built.google.disableSignUp).toBe(true);
  });

  it('passes the credentials through', () => {
    const built = buildSocialProviders(GOOGLE) as Record<
      string,
      { clientId: string; clientSecret: string }
    >;
    expect(built.google.clientId).toBe('gid');
    expect(built.google.clientSecret).toBe('gsecret');
  });

  it('defaults the Microsoft tenant to common but honours a pinned tenant', () => {
    const base = { MICROSOFT_CLIENT_ID: 'mid', MICROSOFT_CLIENT_SECRET: 'msecret' };
    const built = buildSocialProviders(base) as Record<string, { tenantId: string }>;
    expect(built.microsoft.tenantId).toBe('common');

    const pinned = buildSocialProviders({ ...base, MICROSOFT_TENANT_ID: 'tenant-abc' }) as Record<
      string,
      { tenantId: string }
    >;
    expect(pinned.microsoft.tenantId).toBe('tenant-abc');
  });

  it('omits providers whose credentials are incomplete', () => {
    expect(Object.keys(buildSocialProviders({ GOOGLE_CLIENT_ID: 'gid' }))).toEqual([]);
  });

  it('exposes the Apple client secret as a freshly-read getter', () => {
    const built = buildSocialProviders(appleEnv()) as Record<
      string,
      { clientSecret: string; disableSignUp: boolean }
    >;

    expect(typeof built.apple.clientSecret).toBe('string');
    expect(built.apple.clientSecret.split('.')).toHaveLength(3);
    expect(built.apple.disableSignUp).toBe(true);
  });

  // task-8 fix round 1 (review finding 1): mapProfileToUser is the ONLY
  // point that ever sees Apple's is_private_email claim, and it fires even
  // on a callback that's about to be refused (see build-social-providers.ts
  // for the file:line citations). These tests are the "safe return value"
  // proof the review asked for: the mapped user fields must not change.
  describe('apple mapProfileToUser (private-relay capture)', () => {
    type AppleProviderConfig = {
      mapProfileToUser: (profile: { is_private_email?: boolean }) => Record<string, unknown>;
    };

    it('captures is_private_email: true without altering the mapped fields', async () => {
      const built = buildSocialProviders(appleEnv()) as Record<string, AppleProviderConfig>;

      const { mapped, captured } = await runWithPrivateRelayCapture(async () => {
        const mapped = built.apple.mapProfileToUser({ is_private_email: true });
        return { mapped, captured: readIsPrivateEmail() };
      });

      expect(mapped).toEqual({});
      expect(captured).toBe(true);
    });

    it('captures is_private_email: false without altering the mapped fields', async () => {
      const built = buildSocialProviders(appleEnv()) as Record<string, AppleProviderConfig>;

      const { mapped, captured } = await runWithPrivateRelayCapture(async () => {
        const mapped = built.apple.mapProfileToUser({ is_private_email: false });
        return { mapped, captured: readIsPrivateEmail() };
      });

      expect(mapped).toEqual({});
      expect(captured).toBe(false);
    });

    it('does nothing observable outside a capture scope (no throw, still returns {})', () => {
      const built = buildSocialProviders(appleEnv()) as Record<string, AppleProviderConfig>;
      let mapped: Record<string, unknown> | undefined;
      expect(() => {
        mapped = built.apple.mapProfileToUser({ is_private_email: true });
      }).not.toThrow();
      expect(mapped).toEqual({});
    });
  });
});
