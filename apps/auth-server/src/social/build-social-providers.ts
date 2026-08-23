import type { SocialProviderId } from './resolve-enabled-providers';

/**
 * bug-0175 kept: a provider is configured only when BOTH halves of its
 * credential pair are present. An id without a secret used to be cast to
 * `undefined as string` and crash deep inside BetterAuth's OAuth flow.
 */
function hasAll(env: NodeJS.ProcessEnv, keys: string[]): boolean {
  return keys.every((k) => Boolean(env[k]));
}

const GOOGLE_KEYS = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'];
const MICROSOFT_KEYS = ['MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET'];
// Apple has no static secret: it is an ES256 JWT minted from the .p8 key.
const APPLE_KEYS = ['APPLE_CLIENT_ID', 'APPLE_TEAM_ID', 'APPLE_KEY_ID', 'APPLE_PRIVATE_KEY'];

export function availableSocialProviders(env: NodeJS.ProcessEnv): SocialProviderId[] {
  const out: SocialProviderId[] = [];
  if (hasAll(env, GOOGLE_KEYS)) out.push('google');
  if (hasAll(env, MICROSOFT_KEYS)) out.push('microsoft');
  if (hasAll(env, APPLE_KEYS)) out.push('apple');
  // `stub` is not a BetterAuth social provider — a later task registers it
  // through a separate plugin for the e2e suite only. It is listed here
  // (not in buildSocialProviders) purely so resolve-enabled-providers'
  // database-row intersection doesn't filter it out.
  //
  // Allowlisted on NODE_ENV, not blocklisted: admitting the stub is a
  // complete authentication bypass, since anyone who can reach it can mint
  // any identity. A `!== 'production'` check fails OPEN — an unset
  // NODE_ENV, a mis-cased 'Production', or an empty string would all count
  // as "not production" and let the stub through. Listing exactly the
  // values that should enable it means every unexpected or absent value
  // excludes it instead.
  if (env.E2E_STUB_IDP_URL && (env.NODE_ENV === 'test' || env.NODE_ENV === 'development')) {
    out.push('stub');
  }
  return out;
}

/**
 * Build BetterAuth's `socialProviders` config.
 *
 * `disableSignUp: true` on every provider is what makes federation
 * invite-only: BetterAuth's callback returns BEFORE creating a User row when
 * no account or verified-email match exists (callback.mjs:157 →
 * link-account.mjs:74), so a refused sign-in leaves no orphan.
 *
 * DELIBERATE NON-ACTION: none of these providers is added to
 * `trustedProviders`. Implicit linking requires `userInfo.emailVerified`
 * only while a provider is untrusted (link-account.mjs:20-22). Trusting one
 * silently removes the single rule this feature's security rests on.
 */
export function buildSocialProviders(env: NodeJS.ProcessEnv): Record<string, unknown> {
  const available = availableSocialProviders(env);
  const providers: Record<string, unknown> = {};

  if (available.includes('google')) {
    providers.google = {
      clientId: env.GOOGLE_CLIENT_ID!,
      clientSecret: env.GOOGLE_CLIENT_SECRET!,
      disableSignUp: true,
    };
  }

  if (available.includes('microsoft')) {
    providers.microsoft = {
      clientId: env.MICROSOFT_CLIENT_ID!,
      clientSecret: env.MICROSOFT_CLIENT_SECRET!,
      // Pin to your own directory rather than 'common': a single-tenant app
      // only accepts that directory's users, which is the supported way to
      // work around Entra not emitting the verified-email claims BetterAuth
      // reads (microsoft-entra-id.mjs:97). See the spec, §6.
      tenantId: env.MICROSOFT_TENANT_ID ?? 'common',
      disableSignUp: true,
    };
  }

  // Apple is intentionally absent here — Task 3 adds it, because its
  // secret must be generated (an ES256 JWT), not merely read from env.
  // `stub` is intentionally absent here — it is not a BetterAuth social
  // provider; see availableSocialProviders above.

  return providers;
}
