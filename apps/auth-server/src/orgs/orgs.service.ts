import {
  BadRequestException, ConflictException, ForbiddenException,
  Injectable, NotFoundException,
} from '@nestjs/common';
import { prisma } from '@sassy-auth/db';
import { SqidService } from '../common/sqid/sqid.service';
import { LoggerService } from '../common/logger/logger.service';
import { checkPermission } from '../common/permissions/check-permission';
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
    await checkPermission(callerBaId, ['platform.orgs.manage', 'org.users.manage']);
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 25;

    const where: { appId?: number; name?: { contains: string; mode: 'insensitive' } } = {};
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
    await checkPermission(callerBaId, ['platform.orgs.manage', 'org.users.manage']);
    const org = await prisma.saOrg.findUnique({ where: { publicId }, include: ORG_INCLUDE });
    if (!org) throw new NotFoundException();
    return formatOrg(org);
  }
}
