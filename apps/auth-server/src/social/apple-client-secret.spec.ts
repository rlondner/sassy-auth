import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { createAppleClientSecretFactory } from './apple-client-secret';

// A throwaway EC P-256 key, generated in-test so no key material is committed.
const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
  namedCurve: 'prime256v1',
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const env = {
  APPLE_CLIENT_ID: 'com.example.service',
  APPLE_TEAM_ID: 'TEAM123456',
  APPLE_KEY_ID: 'KEY7890',
  APPLE_PRIVATE_KEY: privateKey,
};

describe('createAppleClientSecretFactory', () => {
  it('mints an ES256 JWT with the claims Apple requires', () => {
    const now = () => 1_700_000_000_000;
    const secret = createAppleClientSecretFactory(env, now)();

    // jwt.verify checks expiration against the real wall clock by default;
    // pin it to the injected `now` so this test doesn't depend on when it runs.
    const decoded = jwt.verify(secret, publicKey, {
      algorithms: ['ES256'],
      clockTimestamp: Math.floor(now() / 1000),
    }) as jwt.JwtPayload;
    expect(decoded.iss).toBe('TEAM123456');
    expect(decoded.sub).toBe('com.example.service');
    expect(decoded.aud).toBe('https://appleid.apple.com');
    expect(decoded.iat).toBe(1_700_000_000);

    const header = JSON.parse(
      Buffer.from(secret.split('.')[0], 'base64url').toString('utf8'),
    ) as { alg: string; kid: string };
    expect(header.alg).toBe('ES256');
    expect(header.kid).toBe('KEY7890');
  });

  it('never exceeds Apple\'s six-month maximum lifetime', () => {
    const now = () => 1_700_000_000_000;
    const secret = createAppleClientSecretFactory(env, now)();
    const decoded = jwt.decode(secret) as jwt.JwtPayload;
    expect(decoded.exp! - decoded.iat!).toBeLessThanOrEqual(15_777_000);
  });

  it('returns the cached secret on repeated calls', () => {
    const factory = createAppleClientSecretFactory(env, () => 1_700_000_000_000);
    expect(factory()).toBe(factory());
  });

  it('regenerates once the cached secret nears expiry', () => {
    let clock = 1_700_000_000_000;
    const factory = createAppleClientSecretFactory(env, () => clock);
    const first = factory();
    clock += 100 * 24 * 60 * 60 * 1000; // 100 days later
    expect(factory()).not.toBe(first);
  });

  it('serves the cached secret while well inside the refresh margin', () => {
    let clock = 1_700_000_000_000;
    const factory = createAppleClientSecretFactory(env, () => clock);
    const first = factory();
    clock += 30 * 24 * 60 * 60 * 1000; // 30 days later
    expect(factory()).toBe(first);
  });

  it('regenerates once inside the refresh margin but before expiry', () => {
    let clock = 1_700_000_000_000;
    const factory = createAppleClientSecretFactory(env, () => clock);
    const first = factory();
    clock += 85 * 24 * 60 * 60 * 1000; // 85 days later
    expect(factory()).not.toBe(first);
  });

  it('never serves an expired secret', () => {
    let clock = 1_700_000_000_000;
    const factory = createAppleClientSecretFactory(env, () => clock);
    factory(); // Prime the cache
    clock += 95 * 24 * 60 * 60 * 1000; // 95 days later, past the 90-day lifetime
    const secret = factory();
    const decoded = jwt.decode(secret) as jwt.JwtPayload;
    expect(decoded.exp!).toBeGreaterThan(Math.floor(clock / 1000));
  });

  it('throws a clear error when the key material is incomplete', () => {
    expect(() => createAppleClientSecretFactory({ APPLE_TEAM_ID: 'T' })()).toThrow(
      /APPLE_CLIENT_ID/,
    );
  });
});
