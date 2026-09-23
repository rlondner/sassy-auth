import { Controller, Delete, HttpCode, Param, Put, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { ServiceTokenGuard } from './service-token.guard';
import { ServiceUsersService } from './service-users.service';

function callingAppId(req: Request): number {
  return (req as unknown as Record<string, { appId: number }>)['serviceApp'].appId;
}

/**
 * PUT/DELETE on a specific role — not the human-admin AssignRoleDto-with-body
 * shape, since there's no ambiguity to carry in a body for a machine caller.
 * Idempotent PUT/DELETE matches REST convention for "this edge should
 * exist / not exist". Mounted separately from UsersController: a fully
 * separate surface with a smaller blast radius. See design spec §5.
 */
@ApiTags('Service Users')
@UseGuards(ServiceTokenGuard)
@Controller('service/users')
export class ServiceUsersController {
  constructor(private readonly service: ServiceUsersService) {}

  @Put(':userPublicId/roles/:rolePublicId')
  @HttpCode(204)
  assignRole(
    @Req() req: Request,
    @Param('userPublicId') userPublicId: string,
    @Param('rolePublicId') rolePublicId: string,
  ) {
    return this.service.assignRole(callingAppId(req), userPublicId, rolePublicId);
  }

  @Delete(':userPublicId/roles/:rolePublicId')
  @HttpCode(204)
  removeRole(
    @Req() req: Request,
    @Param('userPublicId') userPublicId: string,
    @Param('rolePublicId') rolePublicId: string,
  ) {
    return this.service.removeRole(callingAppId(req), userPublicId, rolePublicId);
  }
}
