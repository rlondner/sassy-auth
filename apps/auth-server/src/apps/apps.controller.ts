import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { BetterAuthGuard } from '../auth/better-auth.guard';
import { AppsService } from './apps.service';
import { CreateAppDto } from './dto/create-app.dto';
import { UpdateAppDto } from './dto/update-app.dto';
import { ListAppsQueryDto } from './dto/list-apps-query.dto';

function callerBaId(req: Request): string {
  return (req as unknown as Record<string, { id: string }>)['betterAuthUser'].id;
}

@UseGuards(BetterAuthGuard)
@Controller('apps')
export class AppsController {
  constructor(private readonly apps: AppsService) {}

  @Get()
  list(@Req() req: Request, @Query() q: ListAppsQueryDto) {
    return this.apps.listApps(callerBaId(req), q);
  }

  @Get(':publicId')
  get(@Req() req: Request, @Param('publicId') publicId: string) {
    return this.apps.getApp(callerBaId(req), publicId);
  }

  @Post()
  create(@Req() req: Request, @Body() dto: CreateAppDto) {
    return this.apps.createApp(callerBaId(req), dto);
  }

  @Patch(':publicId')
  update(@Req() req: Request, @Param('publicId') publicId: string, @Body() dto: UpdateAppDto) {
    return this.apps.updateApp(callerBaId(req), publicId, dto);
  }

  @Delete(':publicId')
  @HttpCode(204)
  remove(@Req() req: Request, @Param('publicId') publicId: string) {
    return this.apps.deleteApp(callerBaId(req), publicId);
  }
}
