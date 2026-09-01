import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '@sassy-auth/db';
import { SqidService } from '../common/sqid/sqid.service';
import { LoggerService } from '../common/logger/logger.service';
import { checkPermission } from '../common/permissions/check-permission';
import { generatePendingPublicId } from '../common/pending-public-id';
import { CreateAppDto } from './dto/create-app.dto';
import { UpdateAppDto } from './dto/update-app.dto';
import { ListAppsQueryDto } from './dto/list-apps-query.dto';

type RedirectUriRow = { uri: string; kind: string };
type AppRow = {
  publicId: string; name: string; url: string; isPlatform: boolean;
  twoFactorTrustDays: number | null; requireTwoFactor: boolean;
  redirectUris?: RedirectUriRow[];
};
function formatApp(a: AppRow) {
  return {
    publicId: a.publicId, name: a.name, url: a.url, isPlatform: a.isPlatform,
    twoFactorTrustDays: a.twoFactorTrustDays ?? null,
    requireTwoFactor: a.requireTwoFactor,
    redirectUris: (a.redirectUris ?? []).map((r) => ({ uri: r.uri, kind: r.kind })),
  };
}

/** Redirect URIs must be absolute http(s) URLs — no javascript:, data:, or relative paths. */
function assertValidRedirectUris(uris: Array<{ uri: string; kind: string }>): void {
  for (const r of uris) {
    let parsed: URL;
    try {
      parsed = new URL(r.uri);
    } catch {
      throw new BadRequestException(`Invalid redirect URI: ${r.uri}`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new BadRequestException(`Redirect URI must be http(s): ${r.uri}`);
    }
    if (r.kind !== 'login' && r.kind !== 'post_logout') {
      throw new BadRequestException(`Invalid redirect URI kind: ${r.kind}`);
    }
  }
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
      prisma.saApp.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { id: 'desc' }, include: { redirectUris: true } }),
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
    const app = await prisma.saApp.findUnique({ where: { publicId }, include: { redirectUris: true } });
    if (!app) throw new NotFoundException();
    return formatApp(app);
  }

  async createApp(callerBaId: string, dto: CreateAppDto) {
    await checkPermission(callerBaId, 'platform.apps.manage');
    if (dto.redirectUris) assertValidRedirectUris(dto.redirectUris);
    try {
      type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
      const created = await prisma.$transaction(async (tx: Tx) => {
        const draft = await tx.saApp.create({
          data: { publicId: generatePendingPublicId(), name: dto.name, url: dto.url, isPlatform: false, twoFactorTrustDays: dto.twoFactorTrustDays ?? null, requireTwoFactor: dto.requireTwoFactor ?? false },
        });
        const updated = await tx.saApp.update({ where: { id: draft.id }, data: { publicId: this.sqids.encode(draft.id) } });
        if (dto.redirectUris) {
          await tx.saAppRedirectUri.deleteMany({ where: { appId: draft.id } });
          await tx.saAppRedirectUri.createMany({
            data: dto.redirectUris.map((r) => ({ appId: draft.id, uri: r.uri, kind: r.kind })),
          });
        }
        return updated;
      });
      this.logger.getWinstonLogger().info('App created', { context: 'AppsService', appId: created.publicId });
      return formatApp({ ...created, redirectUris: dto.redirectUris ?? [] });
    } catch (e: unknown) {
      if (isPrismaCode(e, 'P2002')) throw new ConflictException('App with this name already exists');
      throw e;
    }
  }

  async updateApp(callerBaId: string, publicId: string, dto: UpdateAppDto) {
    if (
      dto.name === undefined &&
      dto.url === undefined &&
      dto.twoFactorTrustDays === undefined &&
      dto.requireTwoFactor === undefined &&
      dto.redirectUris === undefined
    ) {
      throw new BadRequestException(
        'At least one of name, url, twoFactorTrustDays, requireTwoFactor, or redirectUris must be provided',
      );
    }
    await checkPermission(callerBaId, 'platform.apps.manage');
    const existing = await prisma.saApp.findUnique({ where: { publicId }, include: { redirectUris: true } });
    if (!existing) throw new NotFoundException();
    if (existing.isPlatform) throw new ForbiddenException('Platform app cannot be modified');
    if (dto.redirectUris) assertValidRedirectUris(dto.redirectUris);
    try {
      const updated = await prisma.saApp.update({
        where: { publicId },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.url !== undefined && { url: dto.url }),
          ...(dto.twoFactorTrustDays !== undefined && {
            twoFactorTrustDays: dto.twoFactorTrustDays,
          }),
          ...(dto.requireTwoFactor !== undefined && {
            requireTwoFactor: dto.requireTwoFactor,
          }),
        },
      });
      if (dto.redirectUris) {
        await prisma.saAppRedirectUri.deleteMany({ where: { appId: existing.id } });
        await prisma.saAppRedirectUri.createMany({
          data: dto.redirectUris.map((r) => ({ appId: existing.id, uri: r.uri, kind: r.kind })),
        });
      }
      this.logger.getWinstonLogger().info('App updated', { context: 'AppsService', appId: publicId });
      return formatApp({ ...updated, redirectUris: dto.redirectUris ?? existing.redirectUris });
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
