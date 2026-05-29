import {
  Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { BetterAuthGuard } from '../auth/better-auth.guard';
import { BETTER_AUTH_SESSION_COOKIE } from '../common/constants';
import { OrgsService } from './orgs.service';
import { CreateOrgDto } from './dto/create-org.dto';
import { UpdateOrgDto } from './dto/update-org.dto';
import { ListOrgsQueryDto } from './dto/list-orgs-query.dto';

function callerBaId(req: Request): string {
  return (req as unknown as Record<string, { id: string }>)['betterAuthUser'].id;
}

@ApiTags('Orgs')
@ApiCookieAuth(BETTER_AUTH_SESSION_COOKIE)
@UseGuards(BetterAuthGuard)
@Controller('orgs')
export class OrgsController {
  constructor(private readonly orgs: OrgsService) {}

  @Get()
  list(@Req() req: Request, @Query() q: ListOrgsQueryDto) {
    return this.orgs.listOrgs(callerBaId(req), q);
  }

  @Get(':publicId')
  get(@Req() req: Request, @Param('publicId') publicId: string) {
    return this.orgs.getOrg(callerBaId(req), publicId);
  }

  @Post()
  create(@Req() req: Request, @Body() dto: CreateOrgDto) {
    return this.orgs.createOrg(callerBaId(req), dto);
  }

  @Patch(':publicId')
  update(@Req() req: Request, @Param('publicId') publicId: string, @Body() dto: UpdateOrgDto) {
    return this.orgs.updateOrg(callerBaId(req), publicId, dto);
  }

  @Delete(':publicId')
  @HttpCode(204)
  remove(@Req() req: Request, @Param('publicId') publicId: string) {
    return this.orgs.deleteOrg(callerBaId(req), publicId);
  }
}
