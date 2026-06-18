import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';
import { TokenErrorCode } from '@sassy-auth/types';

interface AuthCode {
  userId: string;
  appPublicId: string;
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
    codeChallenge: string,
    codeChallengeMethod: 'S256',
  ): string {
    const code = crypto.randomBytes(32).toString('hex');
    this.codes.set(code, {
      userId,
      appPublicId,
      codeChallenge,
      codeChallengeMethod,
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    });
    return code;
  }

  exchangeCode(
    code: string,
    appPublicId: string,
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
