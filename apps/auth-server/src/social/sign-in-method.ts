import { PROVIDER_ORDER } from './resolve-enabled-providers';

/**
 * Derive how a session was created from the BetterAuth route that created it.
 *
 * A BetterAuth session records nothing about its own origin, and inspecting
 * Account rows cannot distinguish a user who has BOTH a password and a linked
 * Google account. The route is the only honest signal available at session
 * creation, so it is captured onto Session.signInMethod and read later when
 * the JWT's amr/idp claims are built.
 *
 * Returns null for anything unrecognised; callers fall back to legacy
 * behaviour rather than guessing.
 */
export function signInMethodFromPath(path: string | undefined): string | null {
  if (!path) return null;

  const social = path.match(/\/(?:callback|oauth2\/callback)\/([a-z0-9-]+)$/i);
  if (social) {
    const provider = social[1].toLowerCase();
    return (PROVIDER_ORDER as readonly string[]).includes(provider) ? `ext:${provider}` : null;
  }

  if (/\/sign-in\/email$/.test(path)) return 'pwd';

  return null;
}

/**
 * Inverse of the `ext:<provider>` half of signInMethodFromPath: reads a
 * Session.signInMethod value back out into the provider name, or null for
 * anything that isn't a federated sign-in (password, or an unrecognised/
 * legacy null value). Used to decide whether a successful session-create
 * should also record a 'social.signin.ok' audit event.
 */
export function providerFromSignInMethod(signInMethod: string | null | undefined): string | null {
  if (!signInMethod?.startsWith('ext:')) return null;
  return signInMethod.slice('ext:'.length);
}
