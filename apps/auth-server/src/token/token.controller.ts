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
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import * as Sentry from '@sentry/nestjs';
import { trace } from '@opentelemetry/api';
import { Request, Response } from 'express';
import { extractClientSecret, verifyClientSecret } from './client-auth';
import { prisma } from '@sassy-auth/db';
import { detectIdentifierType, TokenErrorCode } from '@sassy-auth/types';
import { auth } from '../auth/auth.config';
import { fromNodeHeaders } from 'better-auth/node';
// BetterAuth hashes passwords with scrypt by default (format `<saltHex>:<hashHex>`),
// not bcrypt — use its own verifier so direct-login stays compatible with any
// account created via BetterAuth (sign-up, seed, admin invite, etc.).
import { hashPassword, verifyPassword } from 'better-auth/crypto';
import { deriveAuthMethods } from './derive-auth-methods';

// bug-0209: pre-compute a dummy scrypt hash lazily so the user-not-found
// path can spend equivalent CPU time as the user-found path. Without this,
// a fast reject on "no matching row" vs. slow scrypt verify on "matched
// but wrong password" is measurable — an attacker times responses to
// enumerate which identifiers (emails / usernames / phones) exist.
// The dummy input is a fixed string, so the resulting hash is stable
// across requests within one process, and the verify always fails.
let dummyHashPromise: Promise<string> | null = null;
function getDummyPasswordHash(): Promise<string> {
  // Returning the `??=` expression directly yields `Promise<string>`;
  // TS does not narrow the module-level `let` across a return statement.
  return (dummyHashPromise ??= hashPassword('bug-0209-timing-guard-dummy-input'));
}
import { SqidService } from '../common/sqid/sqid.service';
import { DirectLoginDto } from './dto/direct-login.dto';
import { OauthTokenExchangeDto } from './dto/oauth-token-exchange.dto';
import { OauthService } from './oauth.service';
import { TokenService } from './token.service';
import { assertRedirectUriAllowed, assertPostLogoutRedirectUriAllowed } from './redirect-uri';
import { buildClientErrorRedirectUrl, buildOauthErrorRedirectUrl, extractTokenErrorCode } from './oauth-error-redirect';
import { LoggerService } from '../common/logger/logger.service';
import {
  JWKS_ROUTE,
  OAUTH_AUTHORIZE_PATH,
  OAUTH_AUTHORIZE_ROUTE,
  OAUTH_LOGOUT_ROUTE,
  OAUTH_TOKEN_ROUTE,
  OAUTH_USERINFO_ROUTE,
  resolveIssuer,
  TOKEN_CONTROLLER_PATH,
} from './oauth-metadata';
import { resolveTrustDays, getSystemTrustDays } from '../auth/resolve-trust-days';
import { isTwoFactorRequired } from '../auth/two-factor-required';
import { verifyUserTotp } from '../auth/verify-user-totp';
import { parseScopes } from './scopes';
import { record2faChallengeOutcome, recordSignInOutcome } from '../telemetry/auth-metrics';

const tracer = trace.getTracer('sassy-auth.auth-server');

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
   * GET /api/token/app-trust-days?client_id=<sqid>
   *
   * Public (unauthenticated) endpoint. Returns the effective 2FA trust interval
   * for the app identified by client_id (a public sqid). Used by the admin
   * console's signIn server action to resolve the per-app 2FA re-prompt interval
   * without duplicating resolveTrustDays logic client-side.
   *
   * Disclosure is safe: the trust interval is a non-sensitive configuration value
   * and client_id is already public (displayed in the apps list, embedded in OAuth
   * authorize URLs). Returns { effectiveTrustDays: number } — always a resolved
   * positive integer; the system default is returned when client_id is missing,
   * the app is not found, or the app has no per-app override.
   */
  @Get('app-trust-days')
  async appTrustDays(@Query('client_id') clientId: string) {
    if (!clientId) return { effectiveTrustDays: getSystemTrustDays() };
    const app = await prisma.saApp.findUnique({
      where: { publicId: clientId },
      select: { twoFactorTrustDays: true },
    });
    if (!app) return { effectiveTrustDays: getSystemTrustDays() };
    return { effectiveTrustDays: resolveTrustDays(app, getSystemTrustDays()) };
  }

  /**
   * GET /api/token/oauth/authorize
   *
   * Validates the client_id (app), checks the requester has an active
   * BetterAuth session, issues an authorization code, and returns redirect info.
   *
   * Moved into the `auth` throttler bucket rather than the generous `default`
   * one: a valid session lets a caller mint authorization codes repeatedly,
   * so this endpoint carries the same brute-force/abuse profile as /token.
   */
  @Get(OAUTH_AUTHORIZE_ROUTE)
  @Redirect()
  @Throttle({ auth: { limit: 10, ttl: 60_000 } })
  async oauthAuthorize(
    @Query('client_id') clientId: string,
    @Query('redirect_uri') redirectUri: string,
    @Query('code_challenge') codeChallenge: string,
    @Query('code_challenge_method') codeChallengeMethod: string,
    @Query('state') state: string = '',
    @Req() req: Request,
    @Query('scope') scope: string = '',
    @Query('nonce') nonce: string = '',
    @Query('prompt') prompt: string = '',
    @Query('max_age') maxAge: string = '',
  ) {
    // Tracks whether redirect_uri has passed assertRedirectUriAllowed. Once
    // true, errors below (including the prompt=none client-facing errors)
    // may be redirected to the client itself. An unvalidated redirect_uri
    // must never receive a redirect — that's the open redirect the
    // assertRedirectUriAllowed gate exists to prevent — so it always falls
    // through to the admin's own error page/JSON instead.
    let redirectUriValidated = false;
    try {
      let numericId: number;
      try {
        numericId = this.sqidService.decode(clientId);
      } catch {
        throw new BadRequestException(TokenErrorCode.APP_NOT_FOUND);
      }
      const app = await prisma.saApp.findUnique({
        where: { id: numericId },
        include: { redirectUris: true },
      });
      if (!app) {
        throw new NotFoundException(TokenErrorCode.APP_NOT_FOUND);
      }

      // PKCE is mandatory for public clients. Confidential clients may omit it —
      // the client secret provides the same protection — but a challenge, when
      // sent, must still be S256. This must run after the app lookup, since
      // whether PKCE can be omitted depends on the app's client type.
      const isConfidential = app.clientSecretHash !== null;
      if (codeChallenge) {
        if (codeChallengeMethod !== 'S256') {
          throw new BadRequestException(TokenErrorCode.INVALID_REQUEST);
        }
      } else if (!isConfidential) {
        throw new BadRequestException(TokenErrorCode.INVALID_REQUEST);
      }

      try {
        assertRedirectUriAllowed(redirectUri, app);
        redirectUriValidated = true;
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

      // prompt / max_age (OIDC): prompt=login or a session older than
      // max_age forces re-authentication even if a session already exists.
      // prompt=none forbids ANY interactive bounce here — it must report the
      // failure back to the client as an OAuth error (login_required)
      // instead, never redirect to the admin login page.
      const promptValues = new Set(prompt.split(/\s+/).filter(Boolean));
      const sessionAge = session?.session?.createdAt
        ? (Date.now() - new Date(session.session.createdAt).getTime()) / 1000
        : Infinity;
      const maxAgeSeconds = maxAge ? Number(maxAge) : null;
      const staleForMaxAge =
        maxAgeSeconds !== null && Number.isFinite(maxAgeSeconds) && sessionAge > maxAgeSeconds;

      const mustReauthenticate = !session || promptValues.has('login') || staleForMaxAge;

      if (mustReauthenticate) {
        if (promptValues.has('none')) {
          return {
            url: buildClientErrorRedirectUrl(
              redirectUri, 'login_required', 'No active session satisfying the request', state,
            ),
            statusCode: 302,
          };
        }
        const adminUrl = process.env.ADMIN_URL;
        if (!adminUrl) throw new UnauthorizedException();
        const query = new URLSearchParams({
          client_id: clientId,
          redirect_uri: redirectUri,
          scope,
          ...(nonce ? { nonce } : {}),
          ...(codeChallenge ? { code_challenge: codeChallenge, code_challenge_method: 'S256' } : {}),
        });
        if (state) query.set('state', state);
        // Deliberately drop prompt/max_age from `next`: carrying prompt=login
        // would loop forever, and the fresh session satisfies max_age by
        // construction.
        // Absolute path — see the same-shaped comment on the forced-2FA
        // enrollment redirect below.
        const nextPath = `${resolveIssuer()}${OAUTH_AUTHORIZE_PATH}?${query.toString()}`;
        return {
          url: `${adminUrl.replace(/\/$/, '')}/login?next=${encodeURIComponent(nextPath)}`,
          statusCode: 302,
        };
      }

      const saUser = await prisma.saUser.findFirst({
        where: { betterAuthUserId: session.user.id },
        include: { org: true },
      });
      if (!saUser) {
        throw new ForbiddenException(TokenErrorCode.USER_NOT_FOUND);
      }
      // Only 'active' users may complete the OAuth flow. 'pending' users have
      // not yet accepted their invitation; 'inactive' users have been
      // deactivated by an admin. Both must be blocked here — otherwise a
      // BetterAuth session (which persists independently of SaUser.status)
      // would still let them mint a JWT.
      if (saUser.status !== 'active') {
        throw new ForbiddenException(TokenErrorCode.USER_NOT_FOUND);
      }
      if (saUser.org.appId !== app.id) {
        throw new ForbiddenException(TokenErrorCode.USER_ORG_MISMATCH);
      }

      // 2b: forced 2FA enrollment. If the app requires 2FA (per-app flag, or the
      // platform env flag for the platform app) and this active user has not yet
      // enrolled, bounce them into the self-service enrollment page carrying the
      // full authorize URL as `next`, so they return here and get a code only
      // after enrolling. `enroll=1` puts the page in forced (no-skip) mode.
      if (isTwoFactorRequired(app) && !(session.user as { twoFactorEnabled?: boolean }).twoFactorEnabled) {
        // prompt=none forbids this interactive bounce too: report back to
        // the client rather than sending the user to the enrollment page.
        if (promptValues.has('none')) {
          return {
            url: buildClientErrorRedirectUrl(
              redirectUri, 'interaction_required', 'Two-factor enrollment required', state,
            ),
            statusCode: 302,
          };
        }
        const adminUrl = process.env.ADMIN_URL;
        if (adminUrl) {
          const query = new URLSearchParams({
            client_id: clientId,
            redirect_uri: redirectUri,
            code_challenge: codeChallenge,
            code_challenge_method: codeChallengeMethod,
          });
          if (state) query.set('state', state);
          if (scope) query.set('scope', scope);
          if (nonce) query.set('nonce', nonce);
          // Absolute URL, not a bare path: `next` is handed to the admin
          // app (a different origin from this auth server) and ultimately
          // becomes a browser-side redirect. A relative path resolves
          // against the admin app's own origin and 404s there instead of
          // reaching this server.
          const nextPath = `${resolveIssuer()}${OAUTH_AUTHORIZE_PATH}?${query.toString()}`;
          const enrollUrl = `${adminUrl.replace(/\/$/, '')}/account/security?enroll=1&next=${encodeURIComponent(nextPath)}`;
          this.logger.getWinstonLogger().info('OAuth authorize: forced 2FA enrollment', {
            context: 'TokenController', appId: clientId, userId: saUser.publicId,
          });
          return { url: enrollUrl, statusCode: 302 };
        }
        // No ADMIN_URL (dev): fail closed rather than minting a non-2FA code.
        throw new ForbiddenException(TokenErrorCode.USER_NOT_FOUND);
      }

      const { amr, idp } = deriveAuthMethods({
        signInMethod: (session.session as { signInMethod?: string | null }).signInMethod ?? null,
        twoFactorEnabled: Boolean((session.user as { twoFactorEnabled?: boolean }).twoFactorEnabled),
      });
      const granted = parseScopes(scope);
      const authTime = session.session?.createdAt
        ? new Date(session.session.createdAt)
        : new Date();

      const code = await this.oauthService.generateCode(
        saUser.publicId,
        app.publicId,
        redirectUri,
        codeChallenge || null,
        codeChallenge ? 'S256' : null,
        amr,
        nonce || null,
        granted.join(' '),
        authTime,
        idp,
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
      // bug-0149: a browser hitting /authorize without a session used to get
      // a bare JSON 401 — confusing for a top-level nav. That "no session"
      // bounce to the admin's /login is now handled inline above and never
      // throws; UnauthorizedException reaching this catch only happens via
      // the fail-closed path (ADMIN_URL unset), so just fall through to
      // Nest's default JSON 401 in that case.
      if (err instanceof UnauthorizedException) throw err;
      if (!(err instanceof HttpException)) throw err;
      const status = err.getStatus();
      if (status < 400 || status >= 500) throw err;

      const code = extractTokenErrorCode(err);
      if (!code) throw err; // fall back to JSON

      // Once redirect_uri has been validated, prefer sending the error back
      // to the client (RFC 6749 §4.1.2.1) — an OIDC/OAuth library sitting on
      // that callback needs an `error` response, not a dead end on the admin
      // console. An unvalidated redirect_uri must never be redirected to at
      // all, so that branch keeps going to the admin's own error page below.
      if (redirectUriValidated) {
        const oauthError =
          code === TokenErrorCode.USER_ORG_MISMATCH || code === TokenErrorCode.USER_NOT_FOUND
            ? 'access_denied'
            : 'invalid_request';
        return {
          url: buildClientErrorRedirectUrl(redirectUri, oauthError, code, state),
          statusCode: 302,
        };
      }

      const adminUrl = process.env.ADMIN_URL;
      if (!adminUrl) throw err; // fall back to JSON

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
  async oauthToken(
    @Body() dto: OauthTokenExchangeDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    let numericId: number;
    try {
      numericId = this.sqidService.decode(dto.client_id);
    } catch {
      throw new BadRequestException(TokenErrorCode.APP_NOT_FOUND);
    }
    const app = await prisma.saApp.findUnique({
      where: { id: numericId },
      include: { redirectUris: true },
    });
    if (!app) {
      throw new NotFoundException(TokenErrorCode.APP_NOT_FOUND);
    }
    const appClientSecretHash = app.clientSecretHash;

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

    // Client authentication (RFC 6749 §2.3): client_secret_basic (Authorization
    // header) or client_secret_post (body). Basic wins if both are present.
    // Checked once here; the result feeds both halves of the §2 invariant
    // below and (for a confidential client) gates the exchange itself.
    const presentedSecret = extractClientSecret(req, dto);
    const clientAuthenticated = await verifyClientSecret(presentedSecret, appClientSecretHash ?? null);

    // A confidential client must authenticate. Public clients must not present
    // a secret they were never issued — but we don't need to reject that case
    // specially: verifyClientSecret already returns false when the app has no
    // secret configured, and a public app's `appClientSecretHash` check below
    // never fires, so an unauthenticated public client falls through here as
    // intended.
    if (appClientSecretHash && !clientAuthenticated) {
      res.setHeader('WWW-Authenticate', 'Basic realm="sassy-auth"');
      this.logger.getWinstonLogger().warn('oauth.client_auth.failed', {
        context: 'TokenController',
        appId: dto.client_id,
      });
      throw new UnauthorizedException(TokenErrorCode.INVALID_CLIENT);
    }

    let userPublicId: string;
    let appPublicId: string;
    let exchangedAmr: string[] = ['pwd'];
    let exchanged: Awaited<ReturnType<OauthService['exchangeCode']>>;
    let exchangedIdp: string | undefined;
    try {
      exchanged = await this.oauthService.exchangeCode(
        dto.code,
        dto.client_id,
        dto.redirect_uri,
        dto.code_verifier,
      );
      userPublicId = exchanged.userId;
      appPublicId = exchanged.appPublicId;
      exchangedAmr = exchanged.amr ?? ['pwd'];
      exchangedIdp = exchanged.idp;
    } catch (err) {
      this.logger.getWinstonLogger().warn('oauth.pkce.verify_failed', {
        context: 'TokenController',
        appId: dto.client_id,
        reason: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    // §2 invariant, enforced independently of /authorize: a code carrying no
    // PKCE challenge is only exchangeable by an authenticated client. This is
    // the second line of defense — it still applies even if the app is not
    // (or is no longer) confidential, catching a challenge-less code that
    // should never have existed for a public client. The code has already
    // been consumed (single-use) by this point, so this cannot be bypassed
    // by retrying with a secret.
    if (!exchanged.hadChallenge && !clientAuthenticated) {
      res.setHeader('WWW-Authenticate', 'Basic realm="sassy-auth"');
      this.logger.getWinstonLogger().warn('oauth.client_auth.required_for_challengeless_code', {
        context: 'TokenController',
        appId: dto.client_id,
      });
      throw new UnauthorizedException(TokenErrorCode.INVALID_CLIENT);
    }

    const saUser = await prisma.saUser.findFirst({
      where: { publicId: userPublicId },
      include: { org: true },
    });
    if (!saUser) {
      throw new ForbiddenException(TokenErrorCode.USER_NOT_FOUND);
    }
    // The code was issued at /authorize time when the user was active, but they
    // could have been deactivated between /authorize and /token. Re-check here
    // so a mid-flow status change is honored.
    if (saUser.status !== 'active') {
      throw new ForbiddenException(TokenErrorCode.USER_NOT_FOUND);
    }

    const token = await this.tokenService.issueJwt({
      saUserId: saUser.id,
      userPublicId: saUser.publicId,
      orgPublicId: saUser.org.publicId,
      appPublicId,
      appId: app.id,
      scope: exchanged.scope,
      amr: exchangedAmr,
      idp: exchangedIdp,
    });

    const grantedOpenId = exchanged.scope.split(/\s+/).includes('openid');
    const idToken = grantedOpenId
      ? await this.tokenService.issueIdToken({
          saUserId: saUser.id,
          userPublicId: saUser.publicId,
          orgPublicId: saUser.org.publicId,
          appPublicId,
          scope: exchanged.scope,
          nonce: exchanged.nonce,
          authTime: exchanged.authTime,
          amr: exchangedAmr,
          accessToken: token,
        })
      : undefined;

    this.logger.getWinstonLogger().info('OAuth code exchanged, JWT issued', {
      context: 'TokenController',
      appId: appPublicId,
      userId: userPublicId,
      pkceMethod: 'S256',
    });

    return {
      access_token: token,
      token_type: 'Bearer',
      expires_in: 3600,
      scope: exchanged.scope,
      ...(idToken ? { id_token: idToken } : {}),
    };
  }

  /**
   * POST /api/token/direct/login
   *
   * Accepts an identifier (email | username | phone) + password + appId.
   * Validates credentials directly against BetterAuth's scrypt hash in the
   * account table (no BetterAuth session created). Returns a signed RS256 JWT.
   */
  // bug-0080: /api/token/direct/login is unauthenticated and does a
  // scrypt password verification per attempt. Attach the tighter
  // `auth` throttler bucket so a single-source brute-force is bounded
  // to 10 attempts/min per IP (see AppModule config). The generic
  // `default` bucket still applies elsewhere on this controller.
  @Throttle({ auth: { limit: 10, ttl: 60_000 } })
  @Post('direct/login')
  async directLogin(@Body() dto: DirectLoginDto) {
    return tracer.startActiveSpan('auth.signin', async (span) => {
      span.setAttribute('auth.method', 'password');
      try {
        const result = await this.directLoginInner(dto);
        span.setAttribute('auth.outcome', 'ok');
        recordSignInOutcome('ok');
        return result;
      } catch (err) {
        const outcome =
          err instanceof ForbiddenException ? 'two_factor_required' : 'invalid_credentials';
        span.setAttribute('auth.outcome', outcome);
        recordSignInOutcome(outcome);
        throw err;
      } finally {
        span.end();
      }
    });
  }

  private async directLoginInner(dto: DirectLoginDto) {
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
      status: 'active' | 'pending' | 'inactive';
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
        // bug-0209: equalize timing with the user-found path.
        await verifyPassword({ hash: await getDummyPasswordHash(), password: dto.password });
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
      // bug-0147: findUnique against the newly-@unique username column.
      // Previously `findFirst` returned an arbitrary matching row when
      // two users across different orgs shared a username, silently
      // authenticating the wrong tenant. The DB now rejects duplicate
      // non-NULL values at insert/update time, so findUnique returns
      // exactly one match or null.
      const found = await prisma.saUser.findUnique({
        where: { username: dto.identifier },
        include: { org: true, betterAuthUser: true },
      }) as SaUserWithOrg | null;
      if (!found) {
        // bug-0209: equalize timing with the user-found path.
        await verifyPassword({ hash: await getDummyPasswordHash(), password: dto.password });
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
      // phone — bug-0147: same story as username, findUnique against
      // the newly-@unique phoneNumber column.
      const found = await prisma.saUser.findUnique({
        where: { phoneNumber: dto.identifier },
        include: { org: true, betterAuthUser: true },
      }) as SaUserWithOrg | null;
      if (!found) {
        // bug-0209: equalize timing with the user-found path.
        await verifyPassword({ hash: await getDummyPasswordHash(), password: dto.password });
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

    // 3. Validate password against BetterAuth account table.
    //
    // bug-0214: the org/app match used to be checked here, *before* the
    // password work, and answered with a 403 USER_ORG_MISMATCH. That gave an
    // attacker two oracles the bug-0209 timing guard was built to close: a
    // valid identifier in another tenant answered instantly with a different
    // status code, while an unknown identifier answered 401 after a full
    // scrypt. Enumeration and tenant-membership probing both fell out of the
    // difference. The check now happens after verification (step 5) and
    // answers INVALID_CREDENTIALS like every other failure on this path.
    const account = await prisma.account.findFirst({
      where: {
        user: { email: betterAuthEmail },
        providerId: 'credential',
      },
    });
    if (!account?.password) {
      // bug-0215: a social-only user (Google/GitHub, no credential row) used
      // to short-circuit here with no scrypt work at all, so response time
      // told an attacker which accounts use a password and which use SSO —
      // a ready-made target list for provider-specific phishing. Burn the
      // same scrypt budget as the user-found path before answering.
      await verifyPassword({ hash: await getDummyPasswordHash(), password: dto.password });
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
    // bug-0214: org/app match, now behind the password check. A caller who
    // does not know the password learns nothing about which tenant the
    // identifier belongs to; a caller who does know it gets the same opaque
    // INVALID_CREDENTIALS as any other rejection. The specific reason is
    // recorded server-side only.
    if (saUser.org.appId !== app.id) {
      this.logger.getWinstonLogger().warn('Direct login failed: user org does not match app', {
        context: 'TokenController',
        identifierType: detectIdentifierType(dto.identifier),
        appId: dto.appId,
        userId: saUser.publicId,
      });
      throw new UnauthorizedException(TokenErrorCode.INVALID_CREDENTIALS);
    }

    // Only 'active' users may complete direct login. Placed AFTER password
    // verification so the response timing does not distinguish inactive-with-
    // valid-password from wrong-password (kept opaque as INVALID_CREDENTIALS).
    if (saUser.status !== 'active') {
      this.logger.getWinstonLogger().warn('Direct login failed: user not active', {
        context: 'TokenController',
        identifierType: detectIdentifierType(dto.identifier),
        appId: dto.appId,
        userId: saUser.publicId,
      });
      throw new UnauthorizedException(TokenErrorCode.INVALID_CREDENTIALS);
    }

    // 2b: enforce 2FA on the non-interactive path. When the app requires 2FA or
    // the user has enrolled, a valid TOTP code is mandatory. We never emit a
    // pwd-only JWT for a 2FA-enrolled user. The totpCode is never logged.
    const twoFactorEnabled = await prisma.user
      .findUnique({ where: { id: saUser.betterAuthUserId }, select: { twoFactorEnabled: true } })
      .then((u) => u?.twoFactorEnabled ?? false);

    let amr = ['pwd'];
    if (isTwoFactorRequired(app) || twoFactorEnabled) {
      if (!twoFactorEnabled) {
        // Required app, user not enrolled: cannot self-enroll non-interactively.
        record2faChallengeOutcome('required_not_enrolled');
        this.logger.getWinstonLogger().warn('Direct login blocked: 2FA required, user not enrolled', {
          context: 'TokenController', appId: dto.appId, userId: saUser.publicId,
        });
        throw new ForbiddenException(TokenErrorCode.TWO_FACTOR_REQUIRED);
      }
      if (!dto.totpCode || !(await verifyUserTotp(saUser.betterAuthUserId, dto.totpCode))) {
        record2faChallengeOutcome('missing_or_invalid_code');
        this.logger.getWinstonLogger().warn('Direct login blocked: missing/invalid 2FA code', {
          context: 'TokenController', appId: dto.appId, userId: saUser.publicId,
        });
        throw new ForbiddenException(TokenErrorCode.TWO_FACTOR_REQUIRED);
      }
      amr = ['pwd', 'otp', 'mfa'];
      record2faChallengeOutcome('ok');
    }

    // bug-0186: record the login timestamp. This is the JWT-issuance
    // path; the BetterAuth sign-in path (email/password, magic-link,
    // OTP) is tracked separately in the databaseHooks in
    // auth.config.ts. Fire-and-forget with a catch so a rare DB blip
    // during the write does not break login itself — the JWT is what
    // the caller wants.
    prisma.saUser
      .update({ where: { id: saUser.id }, data: { lastLoginAt: new Date() } })
      .catch((err) =>
        this.logger.getWinstonLogger().warn('Failed to update lastLoginAt on directLogin', {
          context: 'TokenController',
          userId: saUser.publicId,
          error: err instanceof Error ? err.message : String(err),
        }),
      );

    // 5. Issue JWT
    const token = await this.tokenService.issueJwt({
      saUserId: saUser.id,
      userPublicId: saUser.publicId,
      orgPublicId: saUser.org.publicId,
      appPublicId: app.publicId,
      appId: appNumericId,
      scope: '',
      amr,
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

  /**
   * GET /api/token/oauth/userinfo
   *
   * Claims for the bearer token's subject, gated by that token's own `scope`
   * claim. Deriving the gate from the presented token means /userinfo can never
   * return more than was granted, with no second source of truth to drift.
   */
  @Get(OAUTH_USERINFO_ROUTE)
  async userinfo(@Req() req: Request) {
    const header = req.headers.authorization ?? '';
    const [scheme, raw] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !raw) {
      throw new UnauthorizedException(TokenErrorCode.INVALID_REQUEST);
    }

    let claims: { sub?: string; scope?: string };
    try {
      claims = this.tokenService.verifyAccessToken(raw);
    } catch {
      throw new UnauthorizedException(TokenErrorCode.INVALID_GRANT);
    }

    const saUser = await prisma.saUser.findFirst({ where: { publicId: claims.sub } });
    if (!saUser || saUser.status !== 'active') {
      throw new UnauthorizedException(TokenErrorCode.USER_NOT_FOUND);
    }

    const scoped = await this.tokenService.buildScopedClaims(saUser.id, claims.scope ?? '');
    return { sub: claims.sub, ...scoped };
  }

  /**
   * GET /api/token/oauth/logout — OIDC RP-Initiated Logout.
   *
   * Always terminates the SassyAuth session. Only redirects when the hint
   * identifies a client that has registered the requested URI: an unvalidated
   * post-logout redirect is an open redirect by another name.
   */
  @Get(OAUTH_LOGOUT_ROUTE)
  @Redirect()
  async oauthLogout(
    @Query('id_token_hint') idTokenHint: string = '',
    @Query('post_logout_redirect_uri') postLogoutRedirectUri: string = '',
    @Query('state') state: string = '',
    @Req() req: Request,
  ) {
    // Terminate first, unconditionally. A failure to validate the hint must
    // never leave the user still signed in.
    try {
      await auth.api.signOut({ headers: fromNodeHeaders(req.headers) });
    } catch {
      // Already signed out, or no session — logout is idempotent.
    }

    const adminUrl = (process.env.ADMIN_URL ?? '').replace(/\/$/, '');
    const loggedOut = `${adminUrl}/logged-out`;

    if (!idTokenHint || !postLogoutRedirectUri) {
      return { url: loggedOut, statusCode: 302 };
    }

    let audience: string;
    try {
      const claims = this.tokenService.verifyAccessToken(idTokenHint);
      if (!claims.aud) return { url: loggedOut, statusCode: 302 };
      audience = claims.aud;
    } catch {
      return { url: loggedOut, statusCode: 302 };
    }

    const app = await prisma.saApp.findUnique({
      where: { publicId: audience },
      include: { redirectUris: true },
    });
    if (!app) return { url: loggedOut, statusCode: 302 };

    try {
      assertPostLogoutRedirectUriAllowed(postLogoutRedirectUri, app);
    } catch {
      this.logger.getWinstonLogger().warn('oauth.post_logout_redirect_uri.rejected', {
        context: 'TokenController', appId: audience,
      });
      return { url: loggedOut, statusCode: 302 };
    }

    const target = new URL(postLogoutRedirectUri);
    if (state) target.searchParams.set('state', state);
    return { url: target.toString(), statusCode: 302 };
  }
}
