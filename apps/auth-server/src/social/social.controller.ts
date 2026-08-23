import { Body, Controller, Get, Param, Put, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { BetterAuthGuard } from '../auth/better-auth.guard';
import { checkPermission } from '../common/permissions/check-permission';
import { SocialService } from './social.service';

function callerBaId(req: Request): string {
  return (req as unknown as Record<string, { id: string }>)['betterAuthUser'].id;
}

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
   * enough to keep this route public. The PUT below carries its own
   * method-level guard so this route stays public even though the
   * controller now has an authenticated sibling.
   */
  @Get()
  async list(@Query('client_id') clientId?: string): Promise<{ providers: string[] }> {
    return { providers: await this.social.listForApp(clientId) };
  }

  /**
   * Changes which identity providers an app trusts, so — unlike the GET
   * above — this must be authenticated and authorised exactly like the
   * other app-administration routes (see AppsController.update /
   * AppsService.updateApp). It mirrors both halves of that mechanism:
   * `BetterAuthGuard` establishes there is a valid session (authentication),
   * and `checkPermission(..., 'platform.apps.manage')` establishes the
   * caller may administer apps (authorisation) — the same permission
   * AppsController's create/update/delete routes require. No new guard or
   * authorisation model is introduced.
   */
  @UseGuards(BetterAuthGuard)
  @Put(':clientId')
  async update(
    @Req() req: Request,
    @Param('clientId') clientId: string,
    @Body() body: { providers?: string[] },
  ): Promise<{ providers: string[] }> {
    await checkPermission(callerBaId(req), 'platform.apps.manage');
    await this.social.setForApp(clientId, body.providers ?? []);
    return { providers: await this.social.listForApp(clientId) };
  }
}
