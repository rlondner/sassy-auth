import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '@sassy-auth/db';
import { SqidService } from '../common/sqid/sqid.service';
import { LoggerService } from '../common/logger/logger.service';
import { checkPermission } from '../common/permissions/check-permission';
import { CreateAppDto } from './dto/create-app.dto';
import { UpdateAppDto } from './dto/update-app.dto';
import { ListAppsQueryDto } from './dto/list-apps-query.dto';

type AppRow = { publicId: string; name: string; url: string; callbackUrl: string | null; isPlatform: boolean };
function formatApp(a: AppRow) {
  return { publicId: a.publicId, name: a.name, url: a.url, callbackUrl: a.callbackUrl ?? null, isPlatform: a.isPlatform };
}

function isPrismaCode(e: unknown, code: string): boolean {
  return typeof e === 'object' && e !== null && 'code' in e && (e as { code?: string }).code === code;
}

@Injectable()
export class AppsService {
  constructor(
    private readonly sqids: SqidService,
    private readonly logger: LoggerService,
  ) {}

  async listApps(callerBaId: string, q: ListAppsQueryDto) {
    // Orgs, permissions and roles are scoped per-app, so those admin pages need
    // to read the apps list to drive their App filter dropdown.
    await checkPermission(callerBaId, [
      'platform.apps.manage',
      'platform.orgs.manage',
      'platform.permissions.manage',
      'platform.roles.manage',
    ]);
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 25;
    const where = q.q
      ? { OR: [{ name: { contains: q.q, mode: 'insensitive' as const } }, { url: { contains: q.q, mode: 'insensitive' as const } }] }
      : {};
    const [rows, total] = await Promise.all([
      prisma.saApp.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { id: 'desc' } }),
      prisma.saApp.count({ where }),
    ]);
    return { items: rows.map(formatApp), total, page, pageSize };
  }

  async createApp(callerBaId: string, dto: CreateAppDto) {
    await checkPermission(callerBaId, 'platform.apps.manage');
    try {
      type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
      const created = await prisma.$transaction(async (tx: Tx) => {
        const draft = await tx.saApp.create({
          data: { publicId: 'placeholder', name: dto.name, url: dto.url, callbackUrl: dto.callbackUrl || null, isPlatform: false },
        });
        return tx.saApp.update({ where: { id: draft.id }, data: { publicId: this.sqids.encode(draft.id) } });
      });
      this.logger.getWinstonLogger().info('App created', { context: 'AppsService', appId: created.publicId });
      return formatApp(created);
    } catch (e: unknown) {
      if (isPrismaCode(e, 'P2002')) throw new ConflictException('App with this name already exists');
      throw e;
    }
  }

  async updateApp(callerBaId: string, publicId: string, dto: UpdateAppDto) {
    if (dto.name === undefined && dto.url === undefined && dto.callbackUrl === undefined) {
      throw new BadRequestException('At least one of name, url, or callbackUrl must be provided');
    }
    await checkPermission(callerBaId, 'platform.apps.manage');
    const existing = await prisma.saApp.findUnique({ where: { publicId } });
    if (!existing) throw new NotFoundException();
    if (existing.isPlatform) throw new ForbiddenException('Platform app cannot be modified');
    try {
      const updated = await prisma.saApp.update({
        where: { publicId },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.url !== undefined && { url: dto.url }),
          ...(dto.callbackUrl !== undefined && { callbackUrl: dto.callbackUrl ? dto.callbackUrl : null }),
        },
      });
      this.logger.getWinstonLogger().info('App updated', { context: 'AppsService', appId: publicId });
      return formatApp(updated);
    } catch (e: unknown) {
      if (isPrismaCode(e, 'P2002')) throw new ConflictException('App with this name already exists');
      throw e;
    }
  }

  async deleteApp(callerBaId: string, publicId: string): Promise<void> {
    await checkPermission(callerBaId, 'platform.apps.manage');
    const existing = await prisma.saApp.findUnique({ where: { publicId } });
    if (!existing) throw new NotFoundException();
    if (existing.isPlatform) throw new ForbiddenException('Platform app cannot be modified');
    try {
      await prisma.saApp.delete({ where: { publicId } });
      this.logger.getWinstonLogger().info('App deleted', { context: 'AppsService', appId: publicId });
    } catch (e: unknown) {
      if (isPrismaCode(e, 'P2003')) {
        throw new ConflictException('App has dependent organizations, roles, or permissions');
      }
      throw e;
    }
  }
}
