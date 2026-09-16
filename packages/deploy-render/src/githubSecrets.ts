import sodium from 'libsodium-wrappers';
import type { FetchLike } from './types';

export interface GithubConfig {
  owner: string;
  repo: string;
  environment: string;
  token: string;
}

interface EnvironmentPublicKey {
  key_id: string;
  key: string;
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function secretUrl(cfg: GithubConfig, name: string): string {
  return `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/environments/${cfg.environment}/secrets/${name}`;
}

export async function secretExists(
  cfg: GithubConfig,
  name: string,
  fetchFn: FetchLike = fetch,
): Promise<boolean> {
  const res = await fetchFn(secretUrl(cfg, name), { headers: authHeaders(cfg.token) });
  if (res.status === 404) return false;
  if (!res.ok) {
    throw new Error(`GitHub API error checking secret ${name}: ${res.status} ${await res.text()}`);
  }
  return true;
}

async function getEnvironmentPublicKey(
  cfg: GithubConfig,
  fetchFn: FetchLike,
): Promise<EnvironmentPublicKey> {
  const url = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/environments/${cfg.environment}/secrets/public-key`;
  const res = await fetchFn(url, { headers: authHeaders(cfg.token) });
  if (!res.ok) {
    throw new Error(`GitHub API error fetching public key: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as EnvironmentPublicKey;
}

export async function sealSecret(value: string, publicKeyBase64: string): Promise<string> {
  await sodium.ready;
  const binKey = sodium.from_base64(publicKeyBase64, sodium.base64_variants.ORIGINAL);
  const binValue = sodium.from_string(value);
  const encrypted = sodium.crypto_box_seal(binValue, binKey);
  return sodium.to_base64(encrypted, sodium.base64_variants.ORIGINAL);
}

export async function setSecret(
  cfg: GithubConfig,
  name: string,
  value: string,
  fetchFn: FetchLike = fetch,
): Promise<void> {
  const publicKey = await getEnvironmentPublicKey(cfg, fetchFn);
  const encryptedValue = await sealSecret(value, publicKey.key);
  const res = await fetchFn(secretUrl(cfg, name), {
    method: 'PUT',
    headers: { ...authHeaders(cfg.token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ encrypted_value: encryptedValue, key_id: publicKey.key_id }),
  });
  if (!res.ok) {
    throw new Error(`GitHub API error setting secret ${name}: ${res.status} ${await res.text()}`);
  }
}

export async function setAndVerifySecret(
  cfg: GithubConfig,
  name: string,
  value: string,
  fetchFn: FetchLike = fetch,
): Promise<void> {
  await setSecret(cfg, name, value, fetchFn);
  if (!(await secretExists(cfg, name, fetchFn))) {
    throw new Error(`Secret ${name} was written to GitHub but does not read back as present`);
  }
}
