import { BadRequestException } from '@nestjs/common';
import { TokenErrorCode } from '@sassy-auth/types';

/**
 * Asserts that `redirectUri` and `appUrl` share the same origin
 * (scheme + host + port). Paths under the registered origin are allowed.
 */
export function assertRedirectUriMatchesApp(
  redirectUri: string,
  appUrl: string,
): void {
  let redirectOrigin: string;
  let appOrigin: string;
  try {
    redirectOrigin = new URL(redirectUri).origin;
    appOrigin = new URL(appUrl).origin;
  } catch {
    throw new BadRequestException(TokenErrorCode.INVALID_REDIRECT_URI);
  }
  if (redirectOrigin !== appOrigin) {
    throw new BadRequestException(TokenErrorCode.INVALID_REDIRECT_URI);
  }
}
