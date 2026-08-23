import type { AppleProfile } from 'better-auth/social-providers';
import type { SocialProviderId } from './resolve-enabled-providers';
import { createAppleClientSecretFactory } from './apple-client-secret';
import { captureIsPrivateEmail } from './apple-private-relay-context';

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

/**
 * SAFETY: admitting the stub IdP is a complete authentication bypass — anyone
 * who can reach it can mint any identity. Allowlisted on NODE_ENV, not
 * blocklisted: a `!== 'production'` check fails OPEN (an unset NODE_ENV, a
 * mis-cased 'Production', or an empty string would all count as "not
 * production" and let the stub through). Listing exactly the values that
 * should enable it means every unexpected or absent value excludes it
 * instead.
 *
 * Shared by `availableSocialProviders` (governs whether resolve-enabled-
 * providers' database-row intersection admits 'stub') and
 * `stubProviderConfig` in ./stub-provider.ts (governs whether the stub is
 * actually registered with BetterAuth's genericOAuth plugin) so the two
 * questions can never drift apart.
 */
export function isStubIdpAllowed(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.E2E_STUB_IDP_URL) && (env.NODE_ENV === 'test' || env.NODE_ENV === 'development');
}

export function availableSocialProviders(env: NodeJS.ProcessEnv): SocialProviderId[] {
  const out: SocialProviderId[] = [];
  if (hasAll(env, GOOGLE_KEYS)) out.push('google');
  if (hasAll(env, MICROSOFT_KEYS)) out.push('microsoft');
  if (hasAll(env, APPLE_KEYS)) out.push('apple');
  // `stub` is not a BetterAuth social provider — a later task registers it
  // through a separate plugin for the e2e suite only. It is listed here
  // (not in buildSocialProviders) purely so resolve-enabled-providers'
  // database-row intersection doesn't filter it out.
  if (isStubIdpAllowed(env)) {
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

  if (available.includes('apple')) {
    const appleSecret = createAppleClientSecretFactory(env);
    providers.apple = {
      clientId: env.APPLE_CLIENT_ID!,
      // A getter, not a value: BetterAuth reads this when it exchanges the
      // code, so a long-running process always gets a live secret rather than
      // one frozen at module load.
      get clientSecret() {
        return appleSecret();
      },
      disableSignUp: true,
      // task-8 fix round 1 (review finding 1): capture Apple's
      // `is_private_email` claim into request-scoped AsyncLocalStorage so
      // the /callback/:id after-hook can tell a Hide My Email relay user
      // (fixable by one checkbox on Apple's own consent screen) apart from
      // any other uninvited sign-in, which otherwise leaves the user stuck.
      //
      // `getUserInfo` (@better-auth/core/dist/social-providers/apple.mjs:
      // 71-95) calls `options.mapProfileToUser?.(enrichedProfile)`
      // UNCONDITIONALLY, and `getUserInfo` itself is invoked before
      // `handleOAuthUserInfo` (better-auth/dist/api/routes/callback.mjs:
      // 89-92, 148) ever evaluates `disableSignUp` — so this fires even on
      // a callback that is about to be refused. `enrichedProfile` is
      // `{ ...decodeJwt(token.idToken), name }`, and `AppleProfile`
      // (@better-auth/core/dist/social-providers/apple.d.mts) types
      // `is_private_email: boolean` as a field of that decoded JWT, so it
      // is present on every Apple callback, refused or not.
      //
      // Returning `{}` changes NOTHING about the mapped user: `getUserInfo`
      // spreads this return value LAST — `{ id, name, emailVerified, email,
      // ...userMap }` — so a partial with no keys contributes nothing.
      // `mapProfileToUser`'s type (oauth-provider.ts) requires an object
      // return (not `undefined`) when the function is provided at all, so
      // `{}` is the type-safe form of "do nothing to the mapped user".
      mapProfileToUser: (profile: AppleProfile) => {
        captureIsPrivateEmail(Boolean(profile.is_private_email));
        return {};
      },
    };
  }

  // `stub` is intentionally absent here — it is not a BetterAuth social
  // provider; see availableSocialProviders above.

  return providers;
}
