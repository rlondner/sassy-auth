import { Controller, Get, Query } from '@nestjs/common';
import { SocialService } from './social.service';

// `NEST_GLOBAL_PREFIX` ('api', see token/oauth-metadata.ts) is applied by
// configure-nest-app.ts to every controller, so the path here is
// 'social-providers' (not 'api/social-providers') to land the route at
// exactly GET /api/social-providers rather than /api/api/social-providers.
@Controller('social-providers')
export class SocialController {
  constructor(private readonly social: SocialService) {}

  /**
   * Public and unauthenticated: the admin console's /login page calls this
   * before anyone has a session. It exposes only which buttons to render —
   * never credentials — and returns an empty list for an unknown client_id
   * so it cannot be used to enumerate apps. No `@UseGuards` here: guards in
   * this codebase are opt-in per controller (see TokenController's
   * unguarded jwks/app-trust-days routes), so simply not adding one is
   * enough to keep this route public.
   */
  @Get()
  async list(@Query('client_id') clientId?: string): Promise<{ providers: string[] }> {
    return { providers: await this.social.listForApp(clientId) };
  }
}
