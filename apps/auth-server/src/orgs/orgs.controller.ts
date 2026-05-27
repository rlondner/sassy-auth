import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { BetterAuthGuard } from '../auth/better-auth.guard';
import { OrgsService } from './orgs.service';

@ApiTags('Orgs')
@ApiCookieAuth('better-auth.session_token')
@UseGuards(BetterAuthGuard)
@Controller('orgs')
export class OrgsController {
  constructor(private readonly orgs: OrgsService) {}

  @Get()
  list(@Req() req: Request) {
    return this.orgs.listOrgs((req as any).betterAuthUser.id);
  }

  @Get(':id')
  get(@Req() req: Request, @Param('id') id: string) {
    return this.orgs.getOrg((req as any).betterAuthUser.id, id);
  }
}
