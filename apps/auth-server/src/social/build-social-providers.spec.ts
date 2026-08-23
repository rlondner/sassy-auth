import { availableSocialProviders, buildSocialProviders } from './build-social-providers';

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
});
