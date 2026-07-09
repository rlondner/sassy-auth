import {
  Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { BetterAuthGuard } from '../auth/better-auth.guard';
import { BETTER_AUTH_SESSION_COOKIE } from '../common/constants';
import { RolesService } from './roles.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { ListRolesQueryDto } from './dto/list-roles-query.dto';

function callerBaId(req: Request): string {
  return (req as unknown as Record<string, { id: string }>)['betterAuthUser'].id;
}

@ApiTags('Roles')
@ApiCookieAuth(BETTER_AUTH_SESSION_COOKIE)
@UseGuards(BetterAuthGuard)
@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  list(@Req() req: Request, @Query() q: ListRolesQueryDto) {
    return this.roles.listRoles(callerBaId(req), q);
  }

  @Get(':publicId')
  get(@Req() req: Request, @Param('publicId') publicId: string) {
    return this.roles.getRole(callerBaId(req), publicId);
  }

  @Post()
  create(@Req() req: Request, @Body() dto: CreateRoleDto) {
    return this.roles.createRole(callerBaId(req), dto);
  }

  @Patch(':publicId')
  update(@Req() req: Request, @Param('publicId') publicId: string, @Body() dto: UpdateRoleDto) {
    return this.roles.updateRole(callerBaId(req), publicId, dto);
  }

  @Delete(':publicId')
  @HttpCode(204)
  remove(@Req() req: Request, @Param('publicId') publicId: string) {
    return this.roles.deleteRole(callerBaId(req), publicId);
  }
}
