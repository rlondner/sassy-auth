import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';
import { prisma } from '@sassy-auth/db';
import { TokenErrorCode } from '@sassy-auth/types';

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

function isPrismaCode(e: unknown, code: string): boolean {
  return typeof e === 'object' && e !== null && 'code' in e && (e as { code?: string }).code === code;
}

@Injectable()
export class OauthService {
  /**
   * bug-0039: OAuth codes are persisted in `SaOauthCode` so the
   * auth-server can run multiple replicas behind a load balancer.
   * `generateCode` inserts a row; `exchangeCode` uses Prisma's
   * atomic `delete` to consume the row exactly once, returning the
   * deleted entry for validation.
   *
   * Concurrent exchanges of the same code race safely: only one
   * `delete` can succeed against a given primary key, so the second
   * caller sees Prisma's P2025 ("record not found") and gets
   * `INVALID_GRANT`. This preserves the single-use semantics that
   * were previously enforced by `Map.delete()` in memory.
   */

  async generateCode(
    userId: string,
    appPublicId: string,
    redirectUri: string,
    codeChallenge: string,
    codeChallengeMethod: 'S256',
    amr: string[],
    idp?: string,
  ): Promise<string> {
    const code = crypto.randomBytes(32).toString('hex');
    await prisma.saOauthCode.create({
      data: {
        code,
        userId,
        appPublicId,
        redirectUri,
        codeChallenge,
        codeChallengeMethod,
        amr: JSON.stringify(amr),
        idp: idp ?? null,
        expiresAt: new Date(Date.now() + CODE_TTL_MS),
      },
    });
    return code;
  }

  async exchangeCode(
    code: string,
    appPublicId: string,
    redirectUri: string,
    codeVerifier: string,
  ): Promise<{ userId: string; appPublicId: string; amr: string[]; idp?: string }> {
    // Atomic delete-and-return: race-safe against concurrent
    // exchanges. P2025 = record not found = INVALID_GRANT.
    // Any successful delete removes the row regardless of the
    // downstream validation outcome, matching the previous
    // "single-use, invalidated on any failure" semantics.
    let entry: {
      userId: string;
      appPublicId: string;
      redirectUri: string;
      codeChallenge: string;
      codeChallengeMethod: string;
      expiresAt: Date;
      amr: string;
      idp: string | null;
    };
    try {
      entry = await prisma.saOauthCode.delete({ where: { code } });
    } catch (e: unknown) {
      if (isPrismaCode(e, 'P2025')) {
        throw new UnauthorizedException(TokenErrorCode.INVALID_GRANT);
      }
      throw e;
    }

    if (entry.appPublicId !== appPublicId) {
      throw new UnauthorizedException(TokenErrorCode.UNAUTHORIZED_CLIENT);
    }

    if (entry.expiresAt < new Date()) {
      throw new UnauthorizedException(TokenErrorCode.INVALID_GRANT);
    }

    // bug-0054: byte-exact comparison per RFC 6749 §4.1.3.
    if (entry.redirectUri !== redirectUri) {
      throw new UnauthorizedException(TokenErrorCode.INVALID_GRANT);
    }

    const expected = Buffer.from(entry.codeChallenge, 'utf8');
    const actual = Buffer.from(s256(codeVerifier), 'utf8');
    if (
      expected.length !== actual.length ||
      !crypto.timingSafeEqual(expected, actual)
    ) {
      throw new UnauthorizedException(TokenErrorCode.INVALID_GRANT);
    }

    return {
      userId: entry.userId,
      appPublicId: entry.appPublicId,
      amr: safeParseAmr(entry.amr),
      idp: entry.idp ?? undefined,
    };
  }
}

function safeParseAmr(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : ['pwd'];
  } catch {
    return ['pwd'];
  }
}
