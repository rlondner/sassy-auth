import { Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { BetterAuthGuard } from '../auth/better-auth.guard';
import { BETTER_AUTH_SESSION_COOKIE } from '../common/constants';
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
}
