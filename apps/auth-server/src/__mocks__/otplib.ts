// Jest mock for otplib — avoids loading @scure/base (ESM-only) in the Jest
// CJS environment. generateSecret() just needs to produce a random base32
// string; we implement it inline here using Node's built-in crypto.
import * as crypto from 'crypto';

const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function generateSecret(length = 32): string {
  const bytes = crypto.randomBytes(length);
  let result = '';
  for (const byte of bytes) {
    result += BASE32_CHARS[byte % 32];
  }
  return result;
}

export { generateSecret };

// Class-based API stub (unused in our tests but keeps the import shape valid).
export const authenticator = {
  generateSecret,
  generate: (_secret: string) => '000000',
};
