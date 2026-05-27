import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Post,
  Query,
  Redirect,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { compare } from 'bcryptjs';
import { Request } from 'express';
import { prisma } from '@sassy-auth/db';
import { detectIdentifierType, TokenErrorCode } from '@sassy-auth/types';
import { auth } from '../auth/auth.config';
import { fromNodeHeaders } from 'better-auth/node';
import { SqidService } from '../common/sqid/sqid.service';
import { DirectLoginDto } from './dto/direct-login.dto';
import { OauthTokenExchangeDto } from './dto/oauth-token-exchange.dto';
import { OauthService } from './oauth.service';
import { TokenService } from './token.service';
import { LoggerService } from '../common/logger/logger.service';

@Controller('token')
export class TokenController {
  constructor(
    private readonly tokenService: TokenService,
    private readonly oauthService: OauthService,
    private readonly sqidService: SqidService,
    private readonly logger: LoggerService,
  ) {}

  /** GET /api/token/jwks */
  @Get('jwks')
  getJwks() {
    return this.tokenService.getJwks();
  }

  /**
   * GET /api/token/oauth/authorize
   *
   * Validates the client_id (app), checks the requester has an active
   * BetterAuth session, issues an authorization code, and returns redirect info.
   */
  @Get('oauth/authorize')
  @Redirect()
  async oauthAuthorize(
    @Query('client_id') clientId: string,
    @Query('redirect_uri') redirectUri: string,
    @Query('state') state: string = '',
    @Req() req: Request,
  ) {
    // Validate app exists
    let numericId: number;
    try {
      numericId = this.sqidService.decode(clientId);
    } catch {
      throw new BadRequestException(TokenErrorCode.APP_NOT_FOUND);
    }
    const app = await prisma.saApp.findUnique({ where: { id: numericId } });
    if (!app) {
      throw new NotFoundException(TokenErrorCode.APP_NOT_FOUND);
    }

    // Require active BetterAuth session
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    if (!session) {
      throw new UnauthorizedException();
    }

    // Look up sa_user for this BetterAuth user
    const saUser = await prisma.saUser.findFirst({
      where: { betterAuthUserId: session.user.id },
      include: { org: true },
    });
    if (!saUser) {
      throw new ForbiddenException(TokenErrorCode.USER_NOT_FOUND);
    }
    if (saUser.org.appId !== app.id) {
      throw new ForbiddenException(TokenErrorCode.USER_ORG_MISMATCH);
    }

    const code = this.oauthService.generateCode(saUser.publicId, app.publicId);
    const url = new URL(redirectUri);
    url.searchParams.set('code', code);
    if (state) url.searchParams.set('state', state);

    this.logger.getWinstonLogger().info('OAuth authorization code issued', {
      context: 'TokenController',
      appId: clientId,
      userId: saUser.publicId,
    });
    Sentry.setTag('authFlow', 'oauth');
    Sentry.setTag('appId', clientId);

    return { url: url.toString(), statusCode: 302 };
  }

  /**
   * POST /api/token/oauth/token
   *
   * Exchanges an authorization code for a signed RS256 JWT.
   */
  @Post('oauth/token')
  async oauthToken(@Body() dto: OauthTokenExchangeDto) {
    const { userId: userPublicId, appPublicId } = this.oauthService.exchangeCode(
      dto.code,
      dto.client_id,
    );

    const saUser = await prisma.saUser.findFirst({
      where: { publicId: userPublicId },
      include: { org: true },
    });
    if (!saUser) {
      throw new ForbiddenException(TokenErrorCode.USER_NOT_FOUND);
    }

    const token = await this.tokenService.issueJwt({
      saUserId: saUser.id,
      userPublicId: saUser.publicId,
      orgPublicId: saUser.org.publicId,
      appPublicId,
    });

    this.logger.getWinstonLogger().info('OAuth code exchanged, JWT issued', {
      context: 'TokenController',
      appId: appPublicId,
      userId: userPublicId,
    });

    return { access_token: token, token_type: 'Bearer', expires_in: 3600 };
  }

  /**
   * POST /api/token/direct/login
   *
   * Accepts an identifier (email | username | phone) + password + appId.
   * Validates credentials directly against the bcrypt hash in the account
   * table (no BetterAuth session created). Returns a signed RS256 JWT.
   */
  @Post('direct/login')
  async directLogin(@Body() dto: DirectLoginDto) {
    // 1. Validate app exists
    let appNumericId: number;
    try {
      appNumericId = this.sqidService.decode(dto.appId);
    } catch {
      throw new NotFoundException(TokenErrorCode.APP_NOT_FOUND);
    }
    const app = await prisma.saApp.findUnique({ where: { id: appNumericId } });
    if (!app) {
      throw new NotFoundException(TokenErrorCode.APP_NOT_FOUND);
    }

    // 2. Resolve sa_user from identifier
    type SaUserWithOrg = {
      id: number;
      publicId: string;
      betterAuthUserId: string;
      org: { publicId: string; appId: number };
      betterAuthUser: { email: string };
    };

    const identifierType = detectIdentifierType(dto.identifier);
    let betterAuthEmail: string;
    let saUser: Omit<SaUserWithOrg, 'betterAuthUser'> | null;

    if (identifierType === 'email') {
      const found = await prisma.saUser.findFirst({
        where: { betterAuthUser: { email: dto.identifier } },
        include: { org: true, betterAuthUser: true },
      }) as SaUserWithOrg | null;
      if (!found) {
        this.logger.getWinstonLogger().warn('Direct login failed: invalid credentials', {
          context: 'TokenController',
          identifierType: detectIdentifierType(dto.identifier),
          appId: dto.appId,
        });
        throw new UnauthorizedException(TokenErrorCode.INVALID_CREDENTIALS);
      }
      betterAuthEmail = dto.identifier;
      saUser = found;
    } else if (identifierType === 'username') {
      const found = await prisma.saUser.findFirst({
        where: { username: dto.identifier },
        include: { org: true, betterAuthUser: true },
      }) as SaUserWithOrg | null;
      if (!found) {
        this.logger.getWinstonLogger().warn('Direct login failed: invalid credentials', {
          context: 'TokenController',
          identifierType: detectIdentifierType(dto.identifier),
          appId: dto.appId,
        });
        throw new UnauthorizedException(TokenErrorCode.INVALID_CREDENTIALS);
      }
      betterAuthEmail = found.betterAuthUser.email;
      saUser = found;
    } else {
      // phone
      const found = await prisma.saUser.findFirst({
        where: { phoneNumber: dto.identifier },
        include: { org: true, betterAuthUser: true },
      }) as SaUserWithOrg | null;
      if (!found) {
        this.logger.getWinstonLogger().warn('Direct login failed: invalid credentials', {
          context: 'TokenController',
          identifierType: detectIdentifierType(dto.identifier),
          appId: dto.appId,
        });
        throw new UnauthorizedException(TokenErrorCode.INVALID_CREDENTIALS);
      }
      betterAuthEmail = found.betterAuthUser.email;
      saUser = found;
    }

    // 3. Check org/app match BEFORE password validation
    if (saUser.org.appId !== app.id) {
      throw new ForbiddenException(TokenErrorCode.USER_ORG_MISMATCH);
    }

    // 4. Validate password against BetterAuth account table
    const account = await prisma.account.findFirst({
      where: {
        user: { email: betterAuthEmail },
        providerId: 'credential',
      },
    });
    if (!account?.password) {
      this.logger.getWinstonLogger().warn('Direct login failed: invalid credentials', {
        context: 'TokenController',
        identifierType: detectIdentifierType(dto.identifier),
        appId: dto.appId,
      });
      throw new UnauthorizedException(TokenErrorCode.INVALID_CREDENTIALS);
    }
    const valid = await compare(dto.password, account.password);
    if (!valid) {
      this.logger.getWinstonLogger().warn('Direct login failed: invalid credentials', {
        context: 'TokenController',
        identifierType: detectIdentifierType(dto.identifier),
        appId: dto.appId,
      });
      throw new UnauthorizedException(TokenErrorCode.INVALID_CREDENTIALS);
    }

    // 5. Issue JWT
    const token = await this.tokenService.issueJwt({
      saUserId: saUser.id,
      userPublicId: saUser.publicId,
      orgPublicId: saUser.org.publicId,
      appPublicId: app.publicId,
    });

    this.logger.getWinstonLogger().info('Direct login successful, JWT issued', {
      context: 'TokenController',
      identifierType: detectIdentifierType(dto.identifier),
      appId: dto.appId,
      userId: saUser.publicId,
    });
    Sentry.setUser({ id: saUser.publicId });
    Sentry.setTag('authFlow', 'direct');
    Sentry.setTag('appId', dto.appId);

    return { access_token: token, token_type: 'Bearer', expires_in: 3600 };
  }
}
