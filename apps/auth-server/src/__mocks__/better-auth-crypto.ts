// Stub for better-auth/crypto — used by Jest unit tests to avoid ESM parse
// errors when ts-jest tries to load the real .mjs distribution.
//
// symmetricEncrypt / symmetricDecrypt are implemented using Node's built-in
// AES-256-GCM so the round-trip works in unit tests without importing the
// real ESM-only better-auth crypto module.
import * as nodeCrypto from 'crypto';

export const verifyPassword = async (_: { hash: string; password: string }) => true;
export const hashPassword = async (_password: string) => 'stub-hash';

async function deriveKey(secret: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    nodeCrypto.scrypt(secret, 'salt', 32, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

export const symmetricEncrypt = async ({ key, data }: { key: string; data: string }): Promise<string> => {
  const derivedKey = await deriveKey(key);
  const iv = nodeCrypto.randomBytes(16);
  const cipher = nodeCrypto.createCipheriv('aes-256-gcm', derivedKey, iv);
  const encrypted = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('hex');
};

export const symmetricDecrypt = async ({ key, data }: { key: string; data: string }): Promise<string> => {
  const derivedKey = await deriveKey(key);
  const buf = Buffer.from(data, 'hex');
  const iv = buf.slice(0, 16);
  const tag = buf.slice(16, 32);
  const encrypted = buf.slice(32);
  const decipher = nodeCrypto.createDecipheriv('aes-256-gcm', derivedKey, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted).toString('utf8') + decipher.final('utf8');
};
