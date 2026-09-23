import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { TokenErrorCode } from '@sassy-auth/types';
import { TokenService } from '../token/token.service';
import { SqidService } from '../common/sqid/sqid.service';

/**
 * Guards /api/service/users/*. Parallel to BetterAuthGuard, but for service
 * tokens instead of a human session cookie: proves the caller holds a valid
 * service token carrying roles:write, and attaches which app it belongs to.
 * See design spec §5.
 */
@Injectable()
export class ServiceTokenGuard implements CanActivate {
  constructor(
    private readonly tokenService: TokenService,
    private readonly sqidService: SqidService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization ?? '';
    const [scheme, raw] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !raw) {
      throw new UnauthorizedException(TokenErrorCode.INVALID_REQUEST);
    }

    let claims: { azp?: string; scope?: string };
    try {
      claims = this.tokenService.verifyServiceAccessToken(raw);
    } catch {
      throw new UnauthorizedException(TokenErrorCode.INVALID_GRANT);
    }

    const grantedScopes = new Set((claims.scope ?? '').split(/\s+/).filter(Boolean));
    if (!grantedScopes.has('roles:write')) {
      throw new ForbiddenException();
    }

    if (!claims.azp) {
      throw new UnauthorizedException(TokenErrorCode.INVALID_GRANT);
    }
    let appId: number;
    try {
      appId = this.sqidService.decode(claims.azp);
    } catch {
      throw new UnauthorizedException(TokenErrorCode.INVALID_GRANT);
    }

    (request as unknown as Record<string, unknown>)['serviceApp'] = {
      appId,
      appPublicId: claims.azp,
    };
    return true;
  }
}
