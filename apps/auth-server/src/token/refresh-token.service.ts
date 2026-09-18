import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';
import { prisma } from '@sassy-auth/db';
import { TokenErrorCode } from '@sassy-auth/types';
import { safeParseAmr } from './amr';

const SLIDING_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const ABSOLUTE_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

export interface IssueRefreshTokenParams {
  saUserId: number;
  userPublicId: string;
  orgPublicId: string;
  appId: number;
  appPublicId: string;
  scope: string;
  amr: string[];
  idp?: string;
  authTime: Date;
}

export interface RotatedRefreshToken {
  token: string;
  saUserId: number;
  userPublicId: string;
  orgPublicId: string;
  appId: number;
  appPublicId: string;
  scope: string;
  amr: string[];
  idp?: string;
  authTime: Date;
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class RefreshTokenService {
  /** First issuance: starts a new rotation family. */
  async issue(params: IssueRefreshTokenParams): Promise<string> {
    const token = crypto.randomBytes(32).toString('hex');
    const familyId = crypto.randomBytes(16).toString('hex');
    const now = Date.now();
    await prisma.saRefreshToken.create({
      data: {
        tokenHash: hashToken(token),
        familyId,
        saUserId: params.saUserId,
        userPublicId: params.userPublicId,
        orgPublicId: params.orgPublicId,
        appId: params.appId,
        appPublicId: params.appPublicId,
        scope: params.scope,
        amr: JSON.stringify(params.amr),
        idp: params.idp ?? null,
        authTime: params.authTime,
        expiresAt: new Date(now + SLIDING_TTL_MS),
        absoluteExpiresAt: new Date(now + ABSOLUTE_TTL_MS),
      },
    });
    return token;
  }

  /**
   * Redeems a presented refresh token: rotates it (single-use) and returns
   * the claims needed to mint a fresh access token, plus the new refresh
   * token. Every failure mode — not found, wrong app, expired, or reuse of
   * an already-rotated token — throws the same invalid_grant so none of
   * them are distinguishable to the caller.
   *
   * Reuse detection: if the presented token has already been rotated
   * (revokedAt set), that token must have leaked — the entire family is
   * revoked so the whole rotation chain is burned, not just this token.
   */
  async rotate(presentedToken: string, appPublicId: string): Promise<RotatedRefreshToken> {
    const tokenHash = hashToken(presentedToken);
    const row = await prisma.saRefreshToken.findUnique({ where: { tokenHash } });
    if (!row || row.appPublicId !== appPublicId) {
      throw new UnauthorizedException(TokenErrorCode.INVALID_GRANT);
    }

    const now = new Date();
    if (row.revokedAt) {
      await prisma.saRefreshToken.updateMany({
        where: { familyId: row.familyId, revokedAt: null },
        data: { revokedAt: now },
      });
      throw new UnauthorizedException(TokenErrorCode.INVALID_GRANT);
    }
    if (row.expiresAt < now || row.absoluteExpiresAt < now) {
      throw new UnauthorizedException(TokenErrorCode.INVALID_GRANT);
    }

    const newToken = crypto.randomBytes(32).toString('hex');
    const newTokenHash = hashToken(newToken);
    await prisma.$transaction([
      prisma.saRefreshToken.update({
        where: { tokenHash },
        data: { revokedAt: now, replacedByTokenHash: newTokenHash },
      }),
      prisma.saRefreshToken.create({
        data: {
          tokenHash: newTokenHash,
          familyId: row.familyId,
          saUserId: row.saUserId,
          userPublicId: row.userPublicId,
          orgPublicId: row.orgPublicId,
          appId: row.appId,
          appPublicId: row.appPublicId,
          scope: row.scope,
          amr: row.amr,
          idp: row.idp,
          authTime: row.authTime,
          expiresAt: new Date(now.getTime() + SLIDING_TTL_MS),
          absoluteExpiresAt: row.absoluteExpiresAt,
        },
      }),
    ]);

    return {
      token: newToken,
      saUserId: row.saUserId,
      userPublicId: row.userPublicId,
      orgPublicId: row.orgPublicId,
      appId: row.appId,
      appPublicId: row.appPublicId,
      scope: row.scope,
      amr: safeParseAmr(row.amr),
      idp: row.idp ?? undefined,
      authTime: row.authTime,
    };
  }

  /** Revokes every outstanding refresh token for (userPublicId, appPublicId) — used on logout. */
  async revokeForUserApp(userPublicId: string, appPublicId: string): Promise<void> {
    await prisma.saRefreshToken.updateMany({
      where: { userPublicId, appPublicId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Revokes every outstanding refresh token for a user across all apps — used on deactivation. */
  async revokeForUser(saUserId: number): Promise<void> {
    await prisma.saRefreshToken.updateMany({
      where: { saUserId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
