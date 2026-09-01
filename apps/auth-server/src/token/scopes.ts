// Canonical order so the `scope` claim and the token response are stable
// regardless of the order the client requested them in.
export const SUPPORTED_SCOPES = ['openid', 'profile', 'email'] as const;

export type SupportedScope = (typeof SUPPORTED_SCOPES)[number];

/**
 * Parses a space-delimited `scope` request. Unrecognised scopes are dropped
 * silently rather than rejected, per OAuth 2.0 — the token response echoes
 * only what was actually granted.
 */
export function parseScopes(requested: string | undefined): SupportedScope[] {
  if (!requested) return [];
  const asked = new Set(requested.split(/\s+/).filter(Boolean));
  return SUPPORTED_SCOPES.filter((s) => asked.has(s));
}
