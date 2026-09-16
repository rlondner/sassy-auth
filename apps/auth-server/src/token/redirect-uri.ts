import { BadRequestException } from '@nestjs/common';
import { TokenErrorCode } from '@sassy-auth/types';

export interface RedirectUriApp {
  url: string;
  redirectUris?: Array<{ uri: string; kind: string }> | null;
}

function reject(): never {
  throw new BadRequestException(TokenErrorCode.INVALID_REDIRECT_URI);
}

function isExactMatch(redirectUri: string, callbackUrl: string): boolean {
  let a: URL;
  let b: URL;
  try {
    a = new URL(redirectUri);
    b = new URL(callbackUrl);
  } catch {
    return false;
  }
  return (
    a.protocol === b.protocol &&
    a.host === b.host && // host includes port
    a.pathname === b.pathname &&
    a.search === b.search
  );
}

function registered(app: RedirectUriApp, kind: string): string[] {
  return (app.redirectUris ?? []).filter((r) => r.kind === kind).map((r) => r.uri);
}

/**
 * Validates a login `redirect_uri` against an app.
 * - One or more registered `login` URIs: require an exact match against the set
 *   (protocol + host + port + path + query), per RFC 6749 §3.1.2.3.
 * - None registered: require the same origin as `app.url` (any path). This is the
 *   pre-OIDC fallback, preserved so the migration changes no app's behaviour.
 */
export function assertRedirectUriAllowed(redirectUri: string, app: RedirectUriApp): void {
  const allowed = registered(app, 'login');
  if (allowed.length > 0) {
    if (!allowed.some((uri) => isExactMatch(redirectUri, uri))) reject();
    return;
  }
  let redirectOrigin: string;
  let appOrigin: string;
  try {
    redirectOrigin = new URL(redirectUri).origin;
    appOrigin = new URL(app.url).origin;
  } catch {
    reject();
  }
  if (redirectOrigin !== appOrigin) reject();
}

/**
 * Validates a `post_logout_redirect_uri`. Unlike login redirects there is no
 * same-origin fallback: an unregistered URI is always rejected, because a
 * logout redirect has no pre-OIDC behaviour to preserve.
 */
export function assertPostLogoutRedirectUriAllowed(uri: string, app: RedirectUriApp): void {
  const allowed = registered(app, 'post_logout');
  if (!allowed.some((candidate) => isExactMatch(uri, candidate))) reject();
}
