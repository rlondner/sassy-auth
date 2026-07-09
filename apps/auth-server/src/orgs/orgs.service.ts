import {
  BadRequestException, ConflictException, ForbiddenException,
  Injectable, NotFoundException,
} from '@nestjs/common';
import { prisma } from '@sassy-auth/db';
import { SqidService } from '../common/sqid/sqid.service';
import { LoggerService } from '../common/logger/logger.service';
import { checkPermission } from '../common/permissions/check-permission';
import { resolveListScope } from '../common/permissions/resolve-list-scope';
import { generatePendingPublicId } from '../common/pending-public-id';
import { CreateOrgDto } from './dto/create-org.dto';
import { UpdateOrgDto } from './dto/update-org.dto';
import { ListOrgsQueryDto } from './dto/list-orgs-query.dto';

type OrgRow = {
  publicId: string; name: string; isPlatform: boolean;
  app: { publicId: string; name: string };
  _count: { users: number };
};
function formatOrg(o: OrgRow) {
  return {
    publicId: o.publicId,
    name: o.name,
    isPlatform: o.isPlatform,
    userCount: o._count.users,
    app: { publicId: o.app.publicId, name: o.app.name },
  };
}

const ORG_INCLUDE = {
  app: { select: { publicId: true, name: true } },
  _count: { select: { users: true } },
} as const;

function isPrismaCode(e: unknown, code: string): boolean {
  return typeof e === 'object' && e !== null && 'code' in e && (e as { code?: string }).code === code;
}

@Injectable()
export class OrgsService {
  constructor(
    private readonly sqids: SqidService,
    private readonly logger: LoggerService,
  ) {}

  async listOrgs(callerBaId: string, q: ListOrgsQueryDto = {}) {
    // platform.users.manage included so the /users admin page can populate
    // its org-filter dropdown without a cross-page permission grant. Mirrors
    // the apps.list pattern where sibling-area admins get read access to the
    // resource they need to *select* against.
    //
    // bug-0001: `resolveListScope` returns 'platform' for platform.*
    // holders (unscoped list) and 'org' with the caller's orgId for
    // callers holding only `org.users.manage`. The latter branch adds
    // `{ id: scope.orgId }` to the `where` clause so an org admin's
    // /orgs list contains only their own org — never a foreign tenant.
    const scope = await resolveListScope(callerBaId, [
      'platform.orgs.manage',
      'platform.users.manage',
      'org.users.manage',
    ]);
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 25;

    const where: { id?: number; appId?: number; name?: { contains: string; mode: 'insensitive' } } = {};
    if (scope.scope === 'org') where.id = scope.orgId;
    if (q.appId) {
      const app = await prisma.saApp.findUnique({ where: { publicId: q.appId } });
      if (!app) throw new NotFoundException('App not found');
      where.appId = app.id;
    }
    if (q.q) where.name = { contains: q.q, mode: 'insensitive' };

    const [rows, total] = await Promise.all([
      prisma.saOrg.findMany({
        where, skip: (page - 1) * pageSize, take: pageSize,
        orderBy: { id: 'desc' }, include: ORG_INCLUDE,
      }),
      prisma.saOrg.count({ where }),
    ]);
    return { items: rows.map(formatOrg), total, page, pageSize };
  }

  async getOrg(callerBaId: string, publicId: string) {
    // bug-0001: fetch first, then check with targetOrgId. Previously the
    // check ran without a target, so `org.users.manage` in ANY org
    // granted read access to EVERY other org's detail (cross-tenant
    // IDOR). Passing `targetOrgId: org.id` reduces the check to
    // `caller.orgId === org.id` for org-scoped callers while platform.*
    // holders still bypass the org check.
    const org = await prisma.saOrg.findUnique({ where: { publicId }, include: ORG_INCLUDE });
    if (!org) throw new NotFoundException();
    await checkPermission(
      callerBaId,
      [
        'platform.orgs.manage',
        'platform.users.manage',
        'org.users.manage',
      ],
      { targetOrgId: org.id },
    );
    return formatOrg(org);
  }

  async createOrg(callerBaId: string, dto: CreateOrgDto) {
    await checkPermission(callerBaId, 'platform.orgs.manage');
    const app = await prisma.saApp.findUnique({ where: { publicId: dto.appId } });
    if (!app) throw new NotFoundException('App not found');
    if (app.isPlatform) throw new ForbiddenException('Cannot create orgs under a platform app');
    try {
      type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
      const created = await prisma.$transaction(async (tx: Tx) => {
        const draft = await tx.saOrg.create({
          data: { publicId: generatePendingPublicId(), name: dto.name, appId: app.id, isPlatform: false },
        });
        return tx.saOrg.update({
          where: { id: draft.id },
          data: { publicId: this.sqids.encode(draft.id) },
          include: ORG_INCLUDE,
        });
      });
      this.logger.getWinstonLogger().info('Org created', { context: 'OrgsService', orgId: created.publicId });
      return formatOrg(created);
    } catch (e: unknown) {
      if (isPrismaCode(e, 'P2002')) throw new ConflictException('Org with this name already exists in this app');
      throw e;
    }
  }

  async updateOrg(callerBaId: string, publicId: string, dto: UpdateOrgDto) {
    if (dto.name === undefined) {
      throw new BadRequestException('At least one of name must be provided');
    }
    await checkPermission(callerBaId, 'platform.orgs.manage');
    const existing = await prisma.saOrg.findUnique({ where: { publicId } });
    if (!existing) throw new NotFoundException();
    if (existing.isPlatform) throw new ForbiddenException('Platform org cannot be modified');
    try {
      const updated = await prisma.saOrg.update({
        where: { publicId },
        data: { name: dto.name },
        include: ORG_INCLUDE,
      });
      this.logger.getWinstonLogger().info('Org updated', { context: 'OrgsService', orgId: publicId });
      return formatOrg(updated);
    } catch (e: unknown) {
      if (isPrismaCode(e, 'P2002')) throw new ConflictException('Org with this name already exists in this app');
      throw e;
    }
  }

  async deleteOrg(callerBaId: string, publicId: string): Promise<void> {
    await checkPermission(callerBaId, 'platform.orgs.manage');
    const existing = await prisma.saOrg.findUnique({ where: { publicId } });
    if (!existing) throw new NotFoundException();
    if (existing.isPlatform) throw new ForbiddenException('Platform org cannot be modified');
    try {
      await prisma.saOrg.delete({ where: { publicId } });
      this.logger.getWinstonLogger().info('Org deleted', { context: 'OrgsService', orgId: publicId });
    } catch (e: unknown) {
      if (isPrismaCode(e, 'P2003')) {
        throw new ConflictException('Org has dependent users');
      }
      throw e;
    }
  }
}
