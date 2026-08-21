import { Injectable, NotFoundException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import * as crypto from 'crypto';
import { prisma } from '@sassy-auth/db';
import { TokenErrorCode } from '@sassy-auth/types';
import { resolveIssuer } from './oauth-metadata';

interface IssueJwtParams {
  saUserId: number;
  userPublicId: string;
  orgPublicId: string;
  appPublicId: string;
  /** Numeric SaApp.id of the audience, used to scope permissions (bug-0157). */
  appId: number;
  /** Space-delimited OIDC scopes granted for this token. '' for non-OIDC flows. */
  scope: string;
  amr?: string[];
}

@Injectable()
export class TokenService {
  private readonly privateKey: string;
  private readonly publicKey: string;
  private readonly kid: string;

  constructor() {
    if (!process.env.RSA_PRIVATE_KEY || !process.env.RSA_PUBLIC_KEY) {
      throw new Error('RSA_PRIVATE_KEY and RSA_PUBLIC_KEY env vars are required');
    }
    this.privateKey = Buffer.from(process.env.RSA_PRIVATE_KEY, 'base64').toString('utf-8');
    this.publicKey = Buffer.from(process.env.RSA_PUBLIC_KEY, 'base64').toString('utf-8');
    this.kid = process.env.JWT_KEY_ID ?? 'sassy-auth-1';
  }

  async resolvePermissions(saUserId: number, audienceAppId: number): Promise<string[]> {
    const user = await prisma.saUser.findUnique({
      where: { id: saUserId },
      include: {
        roles: {
          include: {
            role: { include: { permissions: { include: { permission: true } } } },
          },
        },
        directPermissions: { include: { permission: true } },
      },
    });

    if (!user) {
      throw new NotFoundException(TokenErrorCode.USER_NOT_FOUND);
    }

    // bug-0157: a token's permissions must describe only what its audience can
    // act on. Mirrors the predicate in common/permissions/resolve-app-scoped-ids.ts:
    // system permissions (org.*) deliberately cross app boundaries, everything
    // else must belong to the audience app.
    const inAudience = (p: { appId: number; isSystem: boolean }): boolean =>
      p.isSystem || p.appId === audienceAppId;

    const names = new Set<string>();

    for (const ur of user.roles) {
      for (const rp of ur.role.permissions) {
        if (inAudience(rp.permission)) names.add(rp.permission.name);
      }
    }

    for (const up of user.directPermissions) {
      if (inAudience(up.permission)) names.add(up.permission.name);
    }

    return Array.from(names).sort();
  }

  async issueJwt(params: IssueJwtParams): Promise<string> {
    const permissions = await this.resolvePermissions(params.saUserId, params.appId);
    // Share normalization with the RFC 8414 discovery doc so the advertised
    // `issuer` and the JWT `iss` claim cannot diverge on a trailing slash.
    const issuer = resolveIssuer();
    const now = Math.floor(Date.now() / 1000);

    const payload = {
      sub: params.userPublicId,
      aud: params.appPublicId,
      org: params.orgPublicId,
      iss: issuer,
      iat: now,
      exp: now + 3600,
      // OAuth `scope` means granted scopes. Effective permissions moved to
      // their own array claim in the OIDC compatibility work.
      scope: params.scope,
      permissions,
      ...(params.amr && params.amr.length ? { amr: params.amr } : {}),
    };

    return jwt.sign(payload, this.privateKey, { algorithm: 'RS256', keyid: this.kid });
  }

  getJwks(): { keys: Record<string, unknown>[] } {
    const keyObject = crypto.createPublicKey(this.publicKey);
    const jwk = keyObject.export({ format: 'jwk' });
    return {
      keys: [
        {
          ...jwk,
          alg: 'RS256',
          use: 'sig',
          kid: this.kid,
        },
      ],
    };
  }
}
