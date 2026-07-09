import { HttpException, UnauthorizedException } from '@nestjs/common';
import { TokenErrorCode } from '@sassy-auth/types';

const KNOWN_CODES: ReadonlySet<string> = new Set(Object.values(TokenErrorCode));

/**
 * Pull a `TokenErrorCode` value out of an arbitrary error. Returns null when
 * the error is not an `HttpException`, is an `UnauthorizedException` (which has
 * its own login-redirect flow), or carries a message that isn't a known code.
 *
 * Nest's `HttpException` may carry the code either as a bare string message
 * (`new BadRequestException('invalid_redirect_uri')`) or as `{ message }` on
 * the response object — handle both.
 */
export function extractTokenErrorCode(err: unknown): TokenErrorCode | null {
  if (!(err instanceof HttpException)) return null;
  if (err instanceof UnauthorizedException) return null;

  const candidates: unknown[] = [err.message];
  const response = err.getResponse();
  if (typeof response === 'object' && response !== null && 'message' in response) {
    candidates.push((response as { message: unknown }).message);
  }

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && KNOWN_CODES.has(candidate)) {
      return candidate as TokenErrorCode;
    }
  }
  return null;
}

/**
 * Build the admin-app URL that shows the OAuth error page. Caller is expected
 * to have already verified that `adminUrl` is set.
 */
export function buildOauthErrorRedirectUrl(
  adminUrl: string,
  code: TokenErrorCode,
  clientId?: string,
): string {
  const base = adminUrl.replace(/\/+$/, '');
  const params = new URLSearchParams({ code });
  if (clientId) params.set('app', clientId);
  return `${base}/oauth-error?${params.toString()}`;
}
