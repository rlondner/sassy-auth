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
   */
  @Get('app')
  getAppName(@Query('appPublicId') appPublicId: string) {
    return this.service.getAppName(appPublicId);
  }
}
