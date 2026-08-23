import jwt from 'jsonwebtoken';

/** Apple's hard ceiling for a client-secret JWT: 6 months, in seconds. */
const APPLE_MAX_LIFETIME_SECONDS = 15_777_000;
/** Mint for 90 days and refresh well before the ceiling. */
const LIFETIME_SECONDS = 90 * 24 * 60 * 60;
/** Regenerate once less than 7 days of the cached secret remains. */
const REFRESH_MARGIN_SECONDS = 7 * 24 * 60 * 60;

/**
 * Apple's `client_secret` is not a static string: it is an ES256 JWT signed
 * with the .p8 key, and Apple refuses one older than six months. Holding it
 * in an env var means sign-in breaks silently, months after deploy, with no
 * code change to blame. So it is minted on demand and cached.
 *
 * Exposed to BetterAuth as a property getter (see build-social-providers)
 * so the value is read at use time rather than frozen at module load.
 */
export function createAppleClientSecretFactory(
  env: NodeJS.ProcessEnv,
  now: () => number = Date.now,
): () => string {
  let cached: { secret: string; expSeconds: number } | null = null;

  return function appleClientSecret(): string {
    const clientId = env.APPLE_CLIENT_ID;
    const teamId = env.APPLE_TEAM_ID;
    const keyId = env.APPLE_KEY_ID;
    const privateKey = env.APPLE_PRIVATE_KEY;

    const missing = [
      ['APPLE_CLIENT_ID', clientId],
      ['APPLE_TEAM_ID', teamId],
      ['APPLE_KEY_ID', keyId],
      ['APPLE_PRIVATE_KEY', privateKey],
    ]
      .filter(([, v]) => !v)
      .map(([k]) => k);

    if (missing.length) {
      throw new Error(`Apple sign-in is misconfigured; missing: ${missing.join(', ')}`);
    }

    const nowSeconds = Math.floor(now() / 1000);
    if (cached && cached.expSeconds - nowSeconds > REFRESH_MARGIN_SECONDS) {
      return cached.secret;
    }

    const expSeconds = nowSeconds + Math.min(LIFETIME_SECONDS, APPLE_MAX_LIFETIME_SECONDS);
    const secret = jwt.sign(
      {
        iss: teamId,
        iat: nowSeconds,
        exp: expSeconds,
        aud: 'https://appleid.apple.com',
        sub: clientId,
      },
      // Escaped newlines are near-universal when a .p8 travels through an env
      // var or a secrets manager; unescape so operators don't have to.
      (privateKey as string).replace(/\\n/g, '\n'),
      { algorithm: 'ES256', keyid: keyId },
    );

    cached = { secret, expSeconds };
    return secret;
  };
}
