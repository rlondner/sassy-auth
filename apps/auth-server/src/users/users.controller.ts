import {
  Controller, Get, Post, Put, Patch, Delete, Param, Body, Query, HttpCode, UseGuards, Req,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { BetterAuthGuard } from '../auth/better-auth.guard';
import { BETTER_AUTH_SESSION_COOKIE } from '../common/constants';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { AssignRoleDto } from './dto/assign-role.dto';
import { SetUserRolesDto } from './dto/set-user-roles.dto';
import { SetUserDirectPermissionsDto } from './dto/set-user-direct-permissions.dto';

function callerBaId(req: Request): string {
  return (req as unknown as Record<string, { id: string }>)['betterAuthUser'].id;
}

@ApiTags('Users')
@ApiCookieAuth(BETTER_AUTH_SESSION_COOKIE)
@UseGuards(BetterAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(@Req() req: Request, @Query('orgId') orgId?: string, @Query('appId') appId?: string) {
    return this.users.listUsers(callerBaId(req), { orgPublicId: orgId, appPublicId: appId });
  }

  @Get(':id')
  get(@Req() req: Request, @Param('id') id: string) {
    return this.users.getUser(callerBaId(req), id);
  }

  @Post()
  create(@Req() req: Request, @Body() dto: CreateUserDto) {
    return this.users.createUser(callerBaId(req), dto);
  }

  @Patch(':id')
  update(@Req() req: Request, @Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.users.updateUser(callerBaId(req), id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Req() req: Request, @Param('id') id: string) {
    return this.users.deleteUser(callerBaId(req), id);
  }

  @Get(':id/roles')
  getRoles(@Req() req: Request, @Param('id') id: string) {
    return this.users.getUserRoles(callerBaId(req), id);
  }

  @Get(':id/effective-permissions')
  effectivePermissions(@Req() req: Request, @Param('id') id: string) {
    return this.users.getEffectivePermissions(callerBaId(req), id);
  }

  @Post(':id/roles')
  @HttpCode(204)
  assignRole(@Req() req: Request, @Param('id') id: string, @Body() dto: AssignRoleDto) {
    return this.users.assignRole(callerBaId(req), id, dto);
  }

  @Delete(':id/roles/:roleId')
  @HttpCode(204)
  removeRole(@Req() req: Request, @Param('id') id: string, @Param('roleId') roleId: string) {
    return this.users.removeRole(callerBaId(req), id, roleId);
  }

  @Post(':id/resend-invitation')
  resendInvitation(@Req() req: Request, @Param('id') id: string) {
    return this.users.resendInvitation(callerBaId(req), id);
  }

  @Put(':id/roles')
  @HttpCode(204)
  setRoles(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: SetUserRolesDto,
  ) {
    return this.users.setUserRoles(callerBaId(req), id, dto.roleIds);
  }

  @Get(':id/direct-permissions')
  getDirectPermissions(@Req() req: Request, @Param('id') id: string) {
    return this.users.getUserDirectPermissions(callerBaId(req), id);
  }

  @Put(':id/direct-permissions')
  @HttpCode(204)
  setDirectPermissions(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: SetUserDirectPermissionsDto,
  ) {
    return this.users.setUserDirectPermissions(callerBaId(req), id, dto.permissionIds);
  }
}
