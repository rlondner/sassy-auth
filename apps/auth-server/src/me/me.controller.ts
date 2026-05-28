import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { BetterAuthGuard } from '../auth/better-auth.guard';
import { MeService } from './me.service';

function callerBaId(req: Request): string {
  return (req as unknown as Record<string, { id: string }>)['betterAuthUser'].id;
}

@UseGuards(BetterAuthGuard)
@Controller('me')
export class MeController {
  constructor(private readonly me: MeService) {}

  @Get('permissions')
  permissions(@Req() req: Request) {
    return this.me.getMyPermissions(callerBaId(req));
  }
}
