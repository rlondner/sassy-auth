import { BadRequestException } from '@nestjs/common';
import { TokenErrorCode } from '@sassy-auth/types';

export interface RedirectUriApp {
  url: string;
  callbackUrl?: string | null;
}

function reject(): never {
  throw new BadRequestException(TokenErrorCode.INVALID_REDIRECT_URI);
}

/** Trim a single trailing slash from a non-root path so `/cb` == `/cb/`. */
function normalizePath(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
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
    normalizePath(a.pathname) === normalizePath(b.pathname) &&
    a.search === b.search
  );
}

/**
 * Validates a PKCE `redirect_uri` against an app.
 * - When `app.callbackUrl` is set (non-empty): require an exact match
 *   (protocol + host + port + path + query), tolerant of a single trailing slash.
 * - Otherwise ("default"): require the same origin as `app.url` (any path).
 */
export function assertRedirectUriAllowed(redirectUri: string, app: RedirectUriApp): void {
  if (app.callbackUrl) {
    if (!isExactMatch(redirectUri, app.callbackUrl)) reject();
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
