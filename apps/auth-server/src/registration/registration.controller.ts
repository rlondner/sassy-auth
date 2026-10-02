import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { RegistrationService } from './registration.service';
import { CompleteRegistrationDto, RegisterDto, StartRegistrationDto, VerifyRegistrationCodeDto } from './register.dto';
import {
  RateLimitGuard,
  AppLookupRateLimitGuard,
  RegisterStartRateLimitGuard,
  VerifyRegistrationCodeRateLimitGuard,
  CompleteRegistrationRateLimitGuard,
} from './rate-limit.guard';
import { resolveClientIp } from '../common/net/resolve-client-ip';

/**
 * Public (no BetterAuthGuard) self-serve signup endpoint.
 *
 * The NestJS global prefix is 'api', so the effective route is:
 *   POST /api/register
 */
@ApiTags('Registration')
@Controller('register')
export class RegistrationController {
  constructor(private readonly service: RegistrationService) {}

  @Post()
  @UseGuards(RateLimitGuard)
  register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.service.register(dto, resolveClientIp(req));
  }

  /**
   * GET /api/register/app?appPublicId=<id>
   *
   * Public and unauthenticated, mirroring SocialController's public
   * GET /api/social-providers: exposes only an app's display name for a
   * known public id, which is the same class of disclosure as confirming
   * whether a client_id exists at all. Used by the admin console's /signup
   * page to render "Register with {app name}".
   *
   * Unlike GET /api/social-providers (which returns an empty list for an
   * unknown client_id and so is not an enumeration oracle), this endpoint
   * responds 200 for a known appPublicId and 404 for an unknown one — a
   * distinguishable response is unavoidable here since the whole point is
   * to surface the app's name. bug-0279: that made it an unauthenticated,
   * unrate-limited enumeration surface for appPublicId, unlike POST
   * /api/register right above it. Uses AppLookupRateLimitGuard — a
   * separate DI singleton subclass of RateLimitGuard with its own
   * independent budget/counter — so this route (called on every /signup
   * page load) can't sweep the appPublicId space at will, while also not
   * sharing (and thus exhausting) the POST /api/register budget just from
   * page views.
   */
  @Get('app')
  @UseGuards(AppLookupRateLimitGuard)
  getAppName(@Query('appPublicId') appPublicId: string, @Req() req: Request) {
    return this.service.getAppName(appPublicId, resolveClientIp(req));
  }

  /**
   * POST /api/register/start — step 1 of the code-first signup wizard
   * (emailVerificationMethod: 'code' apps only; see the design doc). Creates
   * a placeholder BetterAuth account and emails the first verification code.
   */
  @Post('start')
  @UseGuards(RegisterStartRateLimitGuard)
  start(@Body() dto: StartRegistrationDto, @Req() req: Request) {
    return this.service.startRegistration(dto);
  }

  /**
   * POST /api/register/verify-code — step 2. Checks (without consuming) the
   * 6-digit code so the wizard can show an inline error before the user
   * moves on to the password step.
   */
  @Post('verify-code')
  @UseGuards(VerifyRegistrationCodeRateLimitGuard)
  verifyCode(@Body() dto: VerifyRegistrationCodeDto) {
    return this.service.verifyRegistrationCode(dto);
  }

  /**
   * POST /api/register/complete — step 4. Consumes the code for real, sets
   * the real password, and creates the org/SaUser exactly as POST /api/register
   * does for the link flow.
   */
  @Post('complete')
  @UseGuards(CompleteRegistrationRateLimitGuard)
  complete(@Body() dto: CompleteRegistrationDto, @Req() req: Request) {
    return this.service.completeRegistration(dto, resolveClientIp(req));
  }
}
