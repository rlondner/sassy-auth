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
