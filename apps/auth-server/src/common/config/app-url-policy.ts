/**
 * Whether sassy-auth permits insecure (http / localhost / loopback / no-TLD)
 * app and callback URLs. Off by default so production stays https-only unless an
 * operator explicitly opts in. Read at call time so tests can toggle the env.
 */
export function isInsecureAppUrlsAllowed(): boolean {
  return process.env.SASSY_AUTH_ALLOW_INSECURE_APP_URLS === 'true';
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', '[::1]']);

/**
 * Validates an app or callback URL against the current security policy.
 * - Must be a parseable absolute URL with http/https protocol.
 * - Secure mode (default): requires https and a public host (rejects loopback
 *   hosts, localhost / *.localhost, and bare hosts with no dot).
 * - Insecure mode: allows http and loopback / no-TLD hosts.
 */
export function isAppUrlAllowed(value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;

  if (isInsecureAppUrlsAllowed()) return true;

  // Secure mode
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  if (LOOPBACK_HOSTS.has(host)) return false;
  if (host === 'localhost' || host.endsWith('.localhost')) return false;
  if (!host.includes('.')) return false; // no TLD → not a public host
  return true;
}
