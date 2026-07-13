import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '@sassy-auth/db';
import { SqidService } from '../common/sqid/sqid.service';
import { LoggerService } from '../common/logger/logger.service';
import { checkPermission } from '../common/permissions/check-permission';
import { generatePendingPublicId } from '../common/pending-public-id';
import { CreateAppDto } from './dto/create-app.dto';
import { UpdateAppDto } from './dto/update-app.dto';
import { ListAppsQueryDto } from './dto/list-apps-query.dto';

type AppRow = { publicId: string; name: string; url: string; callbackUrl: string | null; isPlatform: boolean; twoFactorTrustDays: number | null; requireTwoFactor: boolean };
function formatApp(a: AppRow) {
  return { publicId: a.publicId, name: a.name, url: a.url, callbackUrl: a.callbackUrl ?? null, isPlatform: a.isPlatform, twoFactorTrustDays: a.twoFactorTrustDays ?? null, requireTwoFactor: a.requireTwoFactor };
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
    const escaped = q.q ? q.q.replace(/%/g, '\\%').replace(/_/g, '\\_') : undefined;
    const where = escaped
      ? { OR: [{ name: { contains: escaped, mode: 'insensitive' as const } }, { url: { contains: escaped, mode: 'insensitive' as const } }] }
      : {};
    const [rows, total] = await Promise.all([
      prisma.saApp.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { id: 'desc' } }),
      prisma.saApp.count({ where }),
    ]);
    return { items: rows.map(formatApp), total, page, pageSize };
  }

  async getApp(callerBaId: string, publicId: string) {
    // bug-0164: sibling to orgs/roles/permissions/users `get`. Apps are
    // read from the same required-perms surface as `listApps` — the
    // orgs / permissions / roles admin pages need to render the parent
    // app's name when displaying a single record. Apps are not
    // org-scoped so no `targetOrgId` is threaded (contrast with
    // orgs.service.ts::getOrg).
    await checkPermission(callerBaId, [
      'platform.apps.manage',
      'platform.orgs.manage',
      'platform.permissions.manage',
      'platform.roles.manage',
    ]);
    const app = await prisma.saApp.findUnique({ where: { publicId } });
    if (!app) throw new NotFoundException();
    return formatApp(app);
  }

  async createApp(callerBaId: string, dto: CreateAppDto) {
    await checkPermission(callerBaId, 'platform.apps.manage');
    try {
      type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
      const created = await prisma.$transaction(async (tx: Tx) => {
        const draft = await tx.saApp.create({
          data: { publicId: generatePendingPublicId(), name: dto.name, url: dto.url, callbackUrl: dto.callbackUrl || null, isPlatform: false, twoFactorTrustDays: dto.twoFactorTrustDays ?? null, requireTwoFactor: dto.requireTwoFactor ?? false },
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
    if (
      dto.name === undefined &&
      dto.url === undefined &&
      dto.callbackUrl === undefined &&
      dto.twoFactorTrustDays === undefined &&
      dto.requireTwoFactor === undefined
    ) {
      throw new BadRequestException(
        'At least one of name, url, callbackUrl, twoFactorTrustDays, or requireTwoFactor must be provided',
      );
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
          ...(dto.twoFactorTrustDays !== undefined && {
            twoFactorTrustDays: dto.twoFactorTrustDays,
          }),
          ...(dto.requireTwoFactor !== undefined && {
            requireTwoFactor: dto.requireTwoFactor,
          }),
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
