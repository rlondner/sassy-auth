import { Injectable, NotFoundException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import * as crypto from 'crypto';
import { trace } from '@opentelemetry/api';
import { prisma } from '@sassy-auth/db';
import { TokenErrorCode } from '@sassy-auth/types';
import { resolveIssuer } from './oauth-metadata';
import { recordTokenIssueDuration } from '../telemetry/auth-metrics';

const tracer = trace.getTracer('sassy-auth.auth-server');

/** JWT lifetime in seconds — must match the `exp - iat` computed in issueJwt(). */
const TOKEN_TTL_SECONDS = 3600;

interface IssueJwtParams {
  saUserId: number;
  userPublicId: string;
  orgPublicId: string;
  appPublicId: string;
  amr?: string[];
  idp?: string;
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

  async resolvePermissions(saUserId: number): Promise<string[]> {
    const user = await prisma.saUser.findUnique({
      where: { id: saUserId },
      include: {
        roles: {
          include: {
            role: {
              include: {
                permissions: { include: { permission: true } },
              },
            },
          },
        },
        directPermissions: { include: { permission: true } },
      },
    });

    if (!user) {
      throw new NotFoundException(TokenErrorCode.USER_NOT_FOUND);
    }

    const names = new Set<string>();

    for (const ur of user.roles) {
      for (const rp of ur.role.permissions) {
        names.add(rp.permission.name);
      }
    }

    for (const up of user.directPermissions) {
      names.add(up.permission.name);
    }

    return Array.from(names).sort();
  }

  async issueJwt(params: IssueJwtParams): Promise<string> {
    return tracer.startActiveSpan('auth.token.issue', async (span) => {
      span.setAttribute('kid', this.kid);
      span.setAttribute('ttl', TOKEN_TTL_SECONDS);
      const start = Date.now();
      try {
        const permissions = await this.resolvePermissions(params.saUserId);
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
          exp: now + TOKEN_TTL_SECONDS,
          scope: permissions.join(' '),
          ...(params.amr && params.amr.length ? { amr: params.amr } : {}),
          ...(params.idp ? { idp: params.idp } : {}),
        };

        const token = jwt.sign(payload, this.privateKey, { algorithm: 'RS256', keyid: this.kid });
        recordTokenIssueDuration(Date.now() - start, 'ok');
        return token;
      } catch (err) {
        recordTokenIssueDuration(Date.now() - start, 'error');
        throw err;
      } finally {
        span.end();
      }
    });
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
