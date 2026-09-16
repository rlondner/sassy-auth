import { Request } from 'express';
// Reuse BetterAuth's scrypt so client secrets are stored the same way as
// passwords — one hashing primitive in the codebase, not two.
import { verifyPassword } from 'better-auth/crypto';

/**
 * Extracts a presented client secret from either supported method:
 * `client_secret_basic` (Authorization: Basic base64(id:secret)) or
 * `client_secret_post` (form/JSON body). Basic wins when both are present.
 */
export function extractClientSecret(
  req: Request,
  body: { client_secret?: string },
): string | null {
  const header = req.headers.authorization ?? '';
  const [scheme, encoded] = header.split(' ');
  if (scheme?.toLowerCase() === 'basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
    const separator = decoded.indexOf(':');
    if (separator !== -1) {
      // RFC 6749 §2.3.1: both halves are application/x-www-form-urlencoded.
      return decodeURIComponent(decoded.slice(separator + 1));
    }
  }
  return body.client_secret ?? null;
}

/**
 * Verifies a presented secret against a stored hash. Returns false rather than
 * throwing for every failure mode, so callers produce one indistinguishable
 * `invalid_client` response.
 */
export async function verifyClientSecret(
  presented: string | null,
  hash: string | null,
): Promise<boolean> {
  if (!presented || !hash) return false;
  try {
    return await verifyPassword({ password: presented, hash });
  } catch {
    return false;
  }
}
