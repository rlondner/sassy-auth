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

interface IssueIdTokenParams {
  saUserId: number;
  userPublicId: string;
  orgPublicId: string;
  appPublicId: string;
  scope: string;
  nonce: string | null;
  authTime: Date;
  amr: string[];
  accessToken: string;
}

/**
 * OIDC at_hash: base64url of the left-most half of the SHA-256 of the
 * access token's ASCII octets (RS256 → SHA-256 → 128 bits kept).
 */
function atHash(accessToken: string): string {
  const digest = crypto.createHash('sha256').update(accessToken, 'ascii').digest();
  return digest.subarray(0, digest.length / 2).toString('base64url');
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

  /**
   * Resolves the scope-gated identity claims. Single source of truth shared by
   * the id_token and /userinfo, so the two cannot disagree about what a scope
   * grants.
   */
  async buildScopedClaims(saUserId: number, scope: string): Promise<Record<string, unknown>> {
    const granted = new Set(scope.split(/\s+/).filter(Boolean));
    if (!granted.has('profile') && !granted.has('email')) return {};

    const user = await prisma.saUser.findUnique({
      where: { id: saUserId },
      include: { betterAuthUser: true },
    });
    if (!user) throw new NotFoundException(TokenErrorCode.USER_NOT_FOUND);

    const claims: Record<string, unknown> = {};
    if (granted.has('profile')) {
      claims.name = `${user.firstName} ${user.lastName}`.trim();
      claims.given_name = user.firstName;
      claims.family_name = user.lastName;
    }
    if (granted.has('email')) {
      claims.email = user.betterAuthUser.email;
      claims.email_verified = user.betterAuthUser.emailVerified;
    }
    return claims;
  }

  async issueIdToken(params: IssueIdTokenParams): Promise<string> {
    const issuer = resolveIssuer();
    const now = Math.floor(Date.now() / 1000);
    const scoped = await this.buildScopedClaims(params.saUserId, params.scope);

    const payload = {
      sub: params.userPublicId,
      aud: params.appPublicId,
      iss: issuer,
      iat: now,
      exp: now + 3600,
      auth_time: Math.floor(params.authTime.getTime() / 1000),
      amr: params.amr,
      at_hash: atHash(params.accessToken),
      // A SassyAuth identity is org-scoped; an id_token without `org` would
      // describe a user that does not exist.
      org: params.orgPublicId,
      ...(params.nonce ? { nonce: params.nonce } : {}),
      ...scoped,
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
