// Stub for better-auth/crypto — used by Jest unit tests to avoid ESM parse
// errors when ts-jest tries to load the real .mjs distribution.
//
// symmetricEncrypt / symmetricDecrypt are implemented using Node's built-in
// AES-256-GCM so the round-trip works in unit tests without importing the
// real ESM-only better-auth crypto module.
import * as nodeCrypto from 'crypto';

// hashPassword/verifyPassword are a lightweight scrypt-based stand-in (not
// better-auth's actual KDF params) that genuinely distinguishes correct vs.
// incorrect passwords — unlike an earlier version of this stub that always
// returned a constant hash and always verified true. Task 9's client-secret
// tests need a real correct/incorrect distinction to be meaningful; a stub
// that can't fail can't prove the comparison logic works.
export const hashPassword = async (password: string): Promise<string> => {
  const salt = nodeCrypto.randomBytes(16).toString('hex');
  const derived = nodeCrypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
};

export const verifyPassword = async ({
  hash,
  password,
}: {
  hash: string;
  password: string;
}): Promise<boolean> => {
  const [salt, key] = hash.split(':');
  if (!salt || !key) return false;
  const derived = nodeCrypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(key, 'hex');
  if (derived.length !== expected.length) return false;
  return nodeCrypto.timingSafeEqual(derived, expected);
};

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
