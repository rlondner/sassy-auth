import { Body, Controller, Get, Param, Put, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { BetterAuthGuard } from '../auth/better-auth.guard';
import { checkPermission } from '../common/permissions/check-permission';
import { SetProvidersDto } from './dto/set-providers.dto';
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
   * enough to keep this route public. The PUT/settings routes below carry
   * their own method-level guard so this route stays public even though the
   * controller now has authenticated siblings.
   *
   * By construction this only ever returns the providers currently shown
   * for an app — never the full set the deployment has credentials for — so
   * it cannot be the source of the admin console's checkbox universe (see
   * `settings` below): a provider that's off for an app never appears here,
   * and there would be no way to opt back in from a list that never shows
   * it.
   */
  @Get()
  async list(@Query('client_id') clientId?: string): Promise<{ providers: string[] }> {
    return { providers: await this.social.listForApp(clientId) };
  }

  /**
   * Backing data for the admin console's "Social sign-in" checkbox group:
   * `available` (every provider this deployment has credentials for) and
   * `enabled` (the subset currently shown for this app). Authenticated and
   * authorised exactly like the PUT below — `available` reveals which
   * providers the deployment has credentials configured for, which the
   * public GET above deliberately never discloses for an app that has
   * opted out, so this must not be public. An unknown clientId 404s here
   * (unlike the public GET's empty-list-always behaviour) because
   * enumeration isn't a concern once the caller already holds
   * `platform.apps.manage`.
   */
  @UseGuards(BetterAuthGuard)
  @Get(':clientId/settings')
  async settings(
    @Req() req: Request,
    @Param('clientId') clientId: string,
  ): Promise<{ available: string[]; enabled: string[] }> {
    await checkPermission(callerBaId(req), 'platform.apps.manage');
    return this.social.getSettingsForApp(clientId);
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
   * authorisation model is introduced. The platform-app write guard lives in
   * `SocialService.setForApp`, mirroring `AppsService.updateApp`/`deleteApp`.
   */
  @UseGuards(BetterAuthGuard)
  @Put(':clientId')
  async update(
    @Req() req: Request,
    @Param('clientId') clientId: string,
    @Body() body: SetProvidersDto,
  ): Promise<{ providers: string[] }> {
    await checkPermission(callerBaId(req), 'platform.apps.manage');
    await this.social.setForApp(clientId, body.providers ?? []);
    return { providers: await this.social.listForApp(clientId) };
  }
}
