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
 * Whether a literal IPv4 address falls in a private, link-local, or otherwise
 * non-public range (RFC 1918, RFC 3927, carrier-grade NAT, cloud metadata
 * endpoint, etc). Only handles dotted-decimal literals — hostnames that
 * *resolve* to such an address at request time (DNS rebinding) are not
 * covered here and must be re-checked by the caller immediately before use.
 */
function isPrivateIPv4Literal(host: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return false;
  const octets = match.slice(1).map(Number);
  if (octets.some((o) => o > 255)) return false;
  const [a, b] = octets;
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 (link-local + cloud metadata)
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 (CGNAT)
  if (a === 0) return true; // 0.0.0.0/8
  return false;
}

/** Whether a literal IPv6 address falls in a private/link-local/ULA range. */
function isPrivateIPv6Literal(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (h.startsWith('fe80:')) return true; // link-local
  if (h.startsWith('fc') || h.startsWith('fd')) return true; // unique local (fc00::/7)
  if (h === '::') return true;
  return false;
}

/**
 * Validates an app or callback URL against the current security policy.
 * - Must be a parseable absolute URL with http/https protocol.
 * - Secure mode (default): requires https and a public host (rejects loopback
 *   hosts, localhost / *.localhost, bare hosts with no dot, and literal
 *   private/link-local/cloud-metadata IP addresses).
 * - Insecure mode: allows http and loopback / no-TLD hosts.
 *
 * Note: this only rejects IP *literals*. A hostname that resolves to a
 * private/internal address at fetch time (DNS rebinding) is not caught by
 * this static check — callers that make an outbound request to a
 * previously-validated URL (e.g. webhook delivery) should re-validate the
 * resolved address immediately before each request.
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
  if (isPrivateIPv4Literal(host)) return false;
  if (isPrivateIPv6Literal(host)) return false;
  return true;
}
