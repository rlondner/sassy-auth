import { isStubIdpAllowed } from './build-social-providers';

/**
 * A local OIDC provider used only by the e2e suite. Real providers cannot
 * authenticate a headless browser, and browser-level mocking cannot help
 * because BetterAuth's token exchange happens server-side in Node.
 *
 * SAFETY: a stub IdP reachable in production is a complete authentication
 * bypass — anyone who can reach it can mint any identity. Registration uses
 * `isStubIdpAllowed`, the same positive allowlist `availableSocialProviders`
 * (build-social-providers.ts) already applies to the database-row
 * intersection, so the two questions ("is stub an eligible provider row" and
 * "is the stub plugin actually wired into BetterAuth") can never drift
 * apart. The production refusal — including the ambiguous NODE_ENV values
 * a blocklist would fail open on — is unit-tested in stub-provider.spec.ts.
 */
export function stubProviderConfig(env: NodeJS.ProcessEnv): object[] {
  const url = env.E2E_STUB_IDP_URL;
  if (!isStubIdpAllowed(env) || !url) return [];

  return [
    {
      providerId: 'stub',
      clientId: 'stub-client',
      clientSecret: 'stub-secret',
      discoveryUrl: `${url.replace(/\/$/, '')}/.well-known/openid-configuration`,
      scopes: ['openid', 'email', 'profile'],
      disableSignUp: true,
    },
  ];
}
