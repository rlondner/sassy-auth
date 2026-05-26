import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';
import { TokenErrorCode } from '@sassy-auth/types';

interface AuthCode {
  userId: string;
  appPublicId: string;
  expiresAt: Date;
}

const CODE_TTL_MS = 5 * 60 * 1000; // 5 minutes

@Injectable()
export class OauthService {
  private readonly codes = new Map<string, AuthCode>();

  generateCode(userId: string, appPublicId: string): string {
    const code = crypto.randomBytes(32).toString('hex');
    this.codes.set(code, {
      userId,
      appPublicId,
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    });
    return code;
  }

  exchangeCode(
    code: string,
    appPublicId: string,
  ): { userId: string; appPublicId: string } {
    const entry = this.codes.get(code);

    if (!entry || entry.appPublicId !== appPublicId) {
      throw new UnauthorizedException(TokenErrorCode.INVALID_CODE);
    }

    if (entry.expiresAt < new Date()) {
      this.codes.delete(code);
      throw new UnauthorizedException(TokenErrorCode.CODE_EXPIRED);
    }

    this.codes.delete(code); // one-time use
    return { userId: entry.userId, appPublicId: entry.appPublicId };
  }
}
