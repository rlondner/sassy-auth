import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { BetterAuthGuard } from '../auth/better-auth.guard';
import { RolesService } from './roles.service';

@UseGuards(BetterAuthGuard)
@Controller('api/roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  list(@Req() req: Request, @Query('appId') appId?: string) {
    return this.roles.listRoles((req as any).betterAuthUser.id, appId);
  }

  @Get(':id')
  get(@Req() req: Request, @Param('id') id: string) {
    return this.roles.getRole((req as any).betterAuthUser.id, id);
  }
}
