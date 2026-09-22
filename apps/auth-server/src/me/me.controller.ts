import { Body, Controller, Get, HttpCode, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import type { ConsentDocumentType } from '@sassy-auth/types';
import { BetterAuthGuard } from '../auth/better-auth.guard';
import { BETTER_AUTH_SESSION_COOKIE } from '../common/constants';
import { resolveClientIp } from '../common/net/resolve-client-ip';
import { MeService } from './me.service';

function callerBaId(req: Request): string {
  return (req as unknown as Record<string, { id: string }>)['betterAuthUser'].id;
}

@ApiTags('Me')
@ApiCookieAuth(BETTER_AUTH_SESSION_COOKIE)
@UseGuards(BetterAuthGuard)
@Controller('me')
export class MeController {
  constructor(private readonly me: MeService) {}

  @Get()
  profile(@Req() req: Request) {
    return this.me.getMyProfile(callerBaId(req));
  }

  @Get('permissions')
  permissions(@Req() req: Request) {
    return this.me.getMyPermissions(callerBaId(req));
  }

  @Get('two-factor-status')
  twoFactorStatus(@Req() req: Request) {
    return this.me.getTwoFactorStatus(callerBaId(req));
  }

  @Post('two-factor-prompted')
  @HttpCode(204)
  async recordTwoFactorPrompted(@Req() req: Request): Promise<void> {
    await this.me.recordTwoFactorPrompted(callerBaId(req));
  }

  @Get('consent')
  getOutstandingConsent(@Req() req: Request, @Query('appPublicId') appPublicId: string) {
    return this.me.getOutstandingConsent(callerBaId(req), appPublicId, resolveClientIp(req));
  }

  @Post('consent')
  @HttpCode(204)
  async recordConsent(
    @Req() req: Request,
    @Body() body: { appPublicId: string; accepted: ConsentDocumentType[] },
  ): Promise<void> {
    await this.me.recordMyConsent(callerBaId(req), body.appPublicId, resolveClientIp(req), body.accepted ?? []);
  }
}
