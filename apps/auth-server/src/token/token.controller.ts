import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  NotFoundException,
  Post,
  Query,
  Redirect,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import * as Sentry from '@sentry/nestjs';
import { Request } from 'express';
import { prisma } from '@sassy-auth/db';
import { detectIdentifierType, TokenErrorCode } from '@sassy-auth/types';
import { auth } from '../auth/auth.config';
import { fromNodeHeaders } from 'better-auth/node';
// BetterAuth hashes passwords with scrypt by default (format `<saltHex>:<hashHex>`),
// not bcrypt — use its own verifier so direct-login stays compatible with any
// account created via BetterAuth (sign-up, seed, admin invite, etc.).
import { verifyPassword } from 'better-auth/crypto';
import { SqidService } from '../common/sqid/sqid.service';
import { DirectLoginDto } from './dto/direct-login.dto';
import { OauthTokenExchangeDto } from './dto/oauth-token-exchange.dto';
import { OauthService } from './oauth.service';
import { TokenService } from './token.service';
import { assertRedirectUriAllowed } from './redirect-uri';
import { buildOauthErrorRedirectUrl, extractTokenErrorCode } from './oauth-error-redirect';
import { LoggerService } from '../common/logger/logger.service';
import {
  JWKS_ROUTE,
  OAUTH_AUTHORIZE_ROUTE,
  OAUTH_TOKEN_ROUTE,
  TOKEN_CONTROLLER_PATH,
} from './oauth-metadata';

@ApiTags('Token')
@Controller(TOKEN_CONTROLLER_PATH)
export class TokenController {
  constructor(
    private readonly tokenService: TokenService,
    private readonly oauthService: OauthService,
    private readonly sqidService: SqidService,
    private readonly logger: LoggerService,
  ) {}

  /** GET /api/token/jwks */
  @Get(JWKS_ROUTE)
  getJwks() {
    return this.tokenService.getJwks();
  }

  /**
   * GET /api/token/oauth/authorize
   *
   * Validates the client_id (app), checks the requester has an active
   * BetterAuth session, issues an authorization code, and returns redirect info.
   */
  @Get(OAUTH_AUTHORIZE_ROUTE)
  @Redirect()
  async oauthAuthorize(
    @Query('client_id') clientId: string,
    @Query('redirect_uri') redirectUri: string,
    @Query('code_challenge') codeChallenge: string,
    @Query('code_challenge_method') codeChallengeMethod: string,
    @Query('state') state: string = '',
    @Req() req: Request,
  ) {
    try {
      if (!codeChallenge || codeChallengeMethod !== 'S256') {
        throw new BadRequestException(TokenErrorCode.INVALID_REQUEST);
      }

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

      try {
        assertRedirectUriAllowed(redirectUri, app);
      } catch (err) {
        this.logger.getWinstonLogger().warn('oauth.redirect_uri.rejected', {
          context: 'TokenController',
          appId: clientId,
          attemptedOrigin: (() => { try { return new URL(redirectUri).origin; } catch { return '<unparseable>'; } })(),
        });
        throw err;
      }

      const session = await auth.api.getSession({
        headers: fromNodeHeaders(req.headers),
      });
      if (!session) {
        throw new UnauthorizedException();
      }

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

      const code = this.oauthService.generateCode(
        saUser.publicId,
        app.publicId,
        codeChallenge,
        'S256',
      );
      const url = new URL(redirectUri);
      url.searchParams.set('code', code);
      if (state) url.searchParams.set('state', state);

      this.logger.getWinstonLogger().info('OAuth authorization code issued', {
        context: 'TokenController',
        appId: clientId,
        userId: saUser.publicId,
        pkceMethod: 'S256',
        redirectUriOrigin: new URL(redirectUri).origin,
      });
      Sentry.setTag('authFlow', 'oauth');
      Sentry.setTag('appId', clientId);

      return { url: url.toString(), statusCode: 302 };
    } catch (err) {
      // UnauthorizedException keeps the existing login-redirect flow — Nest's
      // global filter handles it. Anything not Http (5xx programming errors)
      // also propagates so Sentry sees it.
      if (err instanceof UnauthorizedException) throw err;
      if (!(err instanceof HttpException)) throw err;
      const status = err.getStatus();
      if (status < 400 || status >= 500) throw err;

      const adminUrl = process.env.ADMIN_URL;
      const code = extractTokenErrorCode(err);
      if (!adminUrl || !code) throw err; // fall back to JSON

      return {
        url: buildOauthErrorRedirectUrl(adminUrl, code, clientId),
        statusCode: 302,
      };
    }
  }

  /**
   * POST /api/token/oauth/token
   *
   * Exchanges an authorization code for a signed RS256 JWT.
   */
  @Post(OAUTH_TOKEN_ROUTE)
  async oauthToken(@Body() dto: OauthTokenExchangeDto) {
    let numericId: number;
    try {
      numericId = this.sqidService.decode(dto.client_id);
    } catch {
      throw new BadRequestException(TokenErrorCode.APP_NOT_FOUND);
    }
    const app = await prisma.saApp.findUnique({ where: { id: numericId } });
    if (!app) {
      throw new NotFoundException(TokenErrorCode.APP_NOT_FOUND);
    }

    try {
      assertRedirectUriAllowed(dto.redirect_uri, app);
    } catch (err) {
      this.logger.getWinstonLogger().warn('oauth.redirect_uri.rejected', {
        context: 'TokenController',
        appId: dto.client_id,
        attemptedOrigin: (() => { try { return new URL(dto.redirect_uri).origin; } catch { return '<unparseable>'; } })(),
      });
      throw err;
    }

    let userPublicId: string;
    let appPublicId: string;
    try {
      const exchanged = this.oauthService.exchangeCode(
        dto.code,
        dto.client_id,
        dto.code_verifier,
      );
      userPublicId = exchanged.userId;
      appPublicId = exchanged.appPublicId;
    } catch (err) {
      this.logger.getWinstonLogger().warn('oauth.pkce.verify_failed', {
        context: 'TokenController',
        appId: dto.client_id,
        reason: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

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
      pkceMethod: 'S256',
    });

    return { access_token: token, token_type: 'Bearer', expires_in: 3600 };
  }

  /**
   * POST /api/token/direct/login
   *
   * Accepts an identifier (email | username | phone) + password + appId.
   * Validates credentials directly against BetterAuth's scrypt hash in the
   * account table (no BetterAuth session created). Returns a signed RS256 JWT.
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
    const valid = await verifyPassword({ hash: account.password, password: dto.password });
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
