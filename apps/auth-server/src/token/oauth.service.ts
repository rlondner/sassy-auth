import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';
import { TokenErrorCode } from '@sassy-auth/types';

interface AuthCode {
  userId: string;
  appPublicId: string;
  // bug-0054: the RFC 6749 §4.1.3 requirement — bind the `redirect_uri`
  // supplied at /authorize to the issued code, verified byte-exact at
  // /token. The origin-level `assertRedirectUriAllowed` check runs at
  // BOTH endpoints, but without this per-code binding an attacker could
  // have the victim log in with one redirect_uri (their own callback
  // under the same origin) and exchange the leaked code at /token with a
  // different redirect_uri — collapsing the origin check's protection.
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
  expiresAt: Date;
}

const CODE_TTL_MS = 5 * 60 * 1000;

function base64UrlEncode(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function s256(verifier: string): string {
  return base64UrlEncode(crypto.createHash('sha256').update(verifier).digest());
}

@Injectable()
export class OauthService {
  private readonly codes = new Map<string, AuthCode>();

  generateCode(
    userId: string,
    appPublicId: string,
    redirectUri: string,
    codeChallenge: string,
    codeChallengeMethod: 'S256',
  ): string {
    const code = crypto.randomBytes(32).toString('hex');
    this.codes.set(code, {
      userId,
      appPublicId,
      redirectUri,
      codeChallenge,
      codeChallengeMethod,
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    });
    return code;
  }

  exchangeCode(
    code: string,
    appPublicId: string,
    redirectUri: string,
    codeVerifier: string,
  ): { userId: string; appPublicId: string } {
    const entry = this.codes.get(code);

    if (!entry) {
      throw new UnauthorizedException(TokenErrorCode.INVALID_GRANT);
    }

    if (entry.appPublicId !== appPublicId) {
      this.codes.delete(code);
      throw new UnauthorizedException(TokenErrorCode.UNAUTHORIZED_CLIENT);
    }

    if (entry.expiresAt < new Date()) {
      this.codes.delete(code);
      throw new UnauthorizedException(TokenErrorCode.INVALID_GRANT);
    }

    // bug-0054: byte-exact comparison per RFC 6749 §4.1.3. Any difference
    // (trailing slash, path drift, added query param, casing on the host)
    // is a mismatch — the origin-level allow-list already ran at both
    // /authorize and /token, so we are only guarding against an attacker
    // who bound the code to one URI and tries to redeem at another.
    if (entry.redirectUri !== redirectUri) {
      this.codes.delete(code);
      throw new UnauthorizedException(TokenErrorCode.INVALID_GRANT);
    }

    const expected = Buffer.from(entry.codeChallenge, 'utf8');
    const actual = Buffer.from(s256(codeVerifier), 'utf8');
    if (
      expected.length !== actual.length ||
      !crypto.timingSafeEqual(expected, actual)
    ) {
      this.codes.delete(code);
      throw new UnauthorizedException(TokenErrorCode.INVALID_GRANT);
    }

    this.codes.delete(code);
    return { userId: entry.userId, appPublicId: entry.appPublicId };
  }
}
