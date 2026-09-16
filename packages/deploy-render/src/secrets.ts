import crypto from 'node:crypto';
import { secretExists, setAndVerifySecret, type GithubConfig } from './githubSecrets';
import type { FetchLike } from './types';

export function generateRsaKeyPair(): { privateKey: string; publicKey: string } {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    privateKey: Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64'),
    publicKey: Buffer.from(publicKey.export({ type: 'spki', format: 'pem' })).toString('base64'),
  };
}

export function generateBetterAuthSecret(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function generateSeedAdminPassword(): string {
  // 24 random bytes as base64url is always >= PASSWORD_MIN_LENGTH (12, see
  // .env.example) with no ambiguous characters.
  return crypto.randomBytes(24).toString('base64url');
}

export interface GeneratedSecret {
  name: string;
  value: string;
}

export interface EnsureSecretsResult {
  generated: GeneratedSecret[];
}

export async function ensureSecrets(
  cfg: GithubConfig,
  fetchFn: FetchLike = fetch,
): Promise<EnsureSecretsResult> {
  const generated: GeneratedSecret[] = [];

  if (!(await secretExists(cfg, 'RSA_PRIVATE_KEY', fetchFn))) {
    const { privateKey, publicKey } = generateRsaKeyPair();
    await setAndVerifySecret(cfg, 'RSA_PRIVATE_KEY', privateKey, fetchFn);
    await setAndVerifySecret(cfg, 'RSA_PUBLIC_KEY', publicKey, fetchFn);
    generated.push({ name: 'RSA_PRIVATE_KEY', value: privateKey }, { name: 'RSA_PUBLIC_KEY', value: publicKey });
  }

  if (!(await secretExists(cfg, 'BETTER_AUTH_SECRET', fetchFn))) {
    const value = generateBetterAuthSecret();
    await setAndVerifySecret(cfg, 'BETTER_AUTH_SECRET', value, fetchFn);
    generated.push({ name: 'BETTER_AUTH_SECRET', value });
  }

  if (!(await secretExists(cfg, 'SEED_ADMIN_PASSWORD', fetchFn))) {
    const value = generateSeedAdminPassword();
    await setAndVerifySecret(cfg, 'SEED_ADMIN_PASSWORD', value, fetchFn);
    generated.push({ name: 'SEED_ADMIN_PASSWORD', value });
  }

  return { generated };
}
