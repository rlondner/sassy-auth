import {
  Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { BetterAuthGuard } from '../auth/better-auth.guard';
import { BETTER_AUTH_SESSION_COOKIE } from '../common/constants';
import { PermissionsService } from './permissions.service';
import { CreatePermissionDto } from './dto/create-permission.dto';
import { UpdatePermissionDto } from './dto/update-permission.dto';
import { ListPermissionsQueryDto } from './dto/list-permissions-query.dto';

function callerBaId(req: Request): string {
  return (req as unknown as Record<string, { id: string }>)['betterAuthUser'].id;
}

@ApiTags('Permissions')
@ApiCookieAuth(BETTER_AUTH_SESSION_COOKIE)
@UseGuards(BetterAuthGuard)
@Controller('permissions')
export class PermissionsController {
  constructor(private readonly permissions: PermissionsService) {}

  @Get()
  list(@Req() req: Request, @Query() q: ListPermissionsQueryDto) {
    return this.permissions.listPermissions(callerBaId(req), q);
  }

  @Get(':publicId')
  get(@Req() req: Request, @Param('publicId') publicId: string) {
    return this.permissions.getPermission(callerBaId(req), publicId);
  }

  @Post()
  create(@Req() req: Request, @Body() dto: CreatePermissionDto) {
    return this.permissions.createPermission(callerBaId(req), dto);
  }

  @Patch(':publicId')
  update(@Req() req: Request, @Param('publicId') publicId: string, @Body() dto: UpdatePermissionDto) {
    return this.permissions.updatePermission(callerBaId(req), publicId, dto);
  }

  @Delete(':publicId')
  @HttpCode(204)
  remove(@Req() req: Request, @Param('publicId') publicId: string) {
    return this.permissions.deletePermission(callerBaId(req), publicId);
  }
}
