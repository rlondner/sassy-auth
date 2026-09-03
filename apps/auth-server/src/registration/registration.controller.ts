import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { RegistrationService } from './registration.service';
import { RegisterDto } from './register.dto';
import { RateLimitGuard } from './rate-limit.guard';

/**
 * Public (no BetterAuthGuard) self-serve signup endpoint.
 *
 * The NestJS global prefix is 'api', so the effective route is:
 *   POST /api/register
 */
@Controller('register')
export class RegistrationController {
  constructor(private readonly service: RegistrationService) {}

  @Post()
  @UseGuards(RateLimitGuard)
  register(@Body() dto: RegisterDto) {
    return this.service.register(dto);
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
   * /api/register right above it. Reuse the same RateLimitGuard so a caller
   * can't sweep the appPublicId space at will.
   */
  @Get('app')
  @UseGuards(RateLimitGuard)
  getAppName(@Query('appPublicId') appPublicId: string) {
    return this.service.getAppName(appPublicId);
  }
}
