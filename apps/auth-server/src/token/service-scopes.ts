// Deliberately separate from token/scopes.ts (SUPPORTED_SCOPES): those are
// OIDC identity scopes granted to a user access token; these gate API
// capabilities on a service token that has no user in the loop at all. See
// docs/superpowers/specs/2026-09-17-service-client-credentials-design.md §3.
export const SUPPORTED_SERVICE_SCOPES = ['roles:write'] as const;

export type SupportedServiceScope = (typeof SUPPORTED_SERVICE_SCOPES)[number];

/**
 * Parses a space-delimited `scope` request against the service-scope
 * vocabulary. Unrecognised scopes are dropped silently rather than
 * rejected, per OAuth 2.0 — the token response echoes only what was
 * actually granted.
 */
export function parseServiceScopes(requested: string | undefined): SupportedServiceScope[] {
  if (!requested) return [];
  const asked = new Set(requested.split(/\s+/).filter(Boolean));
  return SUPPORTED_SERVICE_SCOPES.filter((s) => asked.has(s));
}
