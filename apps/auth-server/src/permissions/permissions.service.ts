import {
  BadRequestException, ConflictException, ForbiddenException,
  Injectable, NotFoundException,
} from '@nestjs/common';
import { prisma } from '@sassy-auth/db';
import { SqidService } from '../common/sqid/sqid.service';
import { LoggerService } from '../common/logger/logger.service';
import { checkPermission } from '../common/permissions/check-permission';
import { CreatePermissionDto } from './dto/create-permission.dto';
import { UpdatePermissionDto } from './dto/update-permission.dto';
import { ListPermissionsQueryDto } from './dto/list-permissions-query.dto';

const PERMISSION_INCLUDE = {
  app: { select: { publicId: true, name: true } },
} as const;

const PERMISSION_DETAIL_INCLUDE = {
  app: { select: { publicId: true, name: true } },
  roles: {
    take: 50,
    include: { role: { include: { app: { select: { name: true } } } } },
    orderBy: { role: { name: 'asc' } },
  },
  users: {
    take: 50,
    include: { user: { include: { betterAuthUser: { select: { email: true } } } } },
    orderBy: { user: { betterAuthUser: { email: 'asc' } } },
  },
} as const;

function isPrismaCode(e: unknown, code: string): boolean {
  return typeof e === 'object' && e !== null && 'code' in e && (e as { code?: string }).code === code;
}

function isPlatform(name: string): boolean {
  return name.startsWith('platform.');
}

@Injectable()
export class PermissionsService {
  constructor(
    private readonly sqids: SqidService,
    private readonly logger: LoggerService,
  ) {}

  async listPermissions(callerBaId: string, q: ListPermissionsQueryDto = {}) {
    // platform.users.manage included so the /users admin page can populate
    // the permission picker in the user-access drawer without a cross-page
    // permission grant.
    await checkPermission(callerBaId, [
      'platform.permissions.manage',
      'platform.users.manage',
    ]);
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
      prisma.saPermission.findMany({
        where, skip: (page - 1) * pageSize, take: pageSize,
        orderBy: { id: 'desc' }, include: PERMISSION_INCLUDE,
      }),
      prisma.saPermission.count({ where }),
    ]);

    // Single roundtrip for role/user counts across this page (no N+1).
    const ids = rows.map((r) => (r as { id: number }).id);
    const [roleGroups, userGroups] = ids.length === 0
      ? [[], []] as [Array<{ permissionId: number; _count: { _all: number } }>, Array<{ permissionId: number; _count: { _all: number } }>]
      : await Promise.all([
          prisma.saRolePermission.groupBy({ by: ['permissionId'], where: { permissionId: { in: ids } }, _count: { _all: true } }),
          prisma.saUserPermission.groupBy({ by: ['permissionId'], where: { permissionId: { in: ids } }, _count: { _all: true } }),
        ]);
    const roleMap = new Map(roleGroups.map((g) => [g.permissionId, g._count._all]));
    const userMap = new Map(userGroups.map((g) => [g.permissionId, g._count._all]));

    return {
      items: rows.map((r) => {
        const row = r as { id: number; publicId: string; name: string; isSystem: boolean; app: { publicId: string; name: string } };
        return {
          publicId: row.publicId, name: row.name, isSystem: row.isSystem,
          app: { publicId: row.app.publicId, name: row.app.name },
          roleCount: roleMap.get(row.id) ?? 0,
          userCount: userMap.get(row.id) ?? 0,
        };
      }),
      total, page, pageSize,
    };
  }

  async getPermission(callerBaId: string, publicId: string) {
    await checkPermission(callerBaId, [
      'platform.permissions.manage',
      'platform.users.manage',
    ]);
    const p = await prisma.saPermission.findUnique({ where: { publicId }, include: PERMISSION_DETAIL_INCLUDE });
    if (!p) throw new NotFoundException();
    const row = p as unknown as {
      id: number; publicId: string; name: string; isSystem: boolean;
      app: { publicId: string; name: string };
      roles: Array<{ role: { publicId: string; name: string; app: { name: string } } }>;
      users: Array<{ user: { publicId: string; firstName: string; lastName: string; betterAuthUser: { email: string } } }>;
    };
    const [roleCount, userCount] = await Promise.all([
      prisma.saRolePermission.count({ where: { permissionId: row.id } }),
      prisma.saUserPermission.count({ where: { permissionId: row.id } }),
    ]);
    return {
      publicId: row.publicId, name: row.name, isSystem: row.isSystem,
      app: { publicId: row.app.publicId, name: row.app.name },
      roleCount, userCount,
      roles: row.roles.map((rp) => ({ publicId: rp.role.publicId, name: rp.role.name, appName: rp.role.app.name })),
      users: row.users.map((up) => ({
        publicId: up.user.publicId,
        email: up.user.betterAuthUser.email,
        firstName: up.user.firstName,
        lastName: up.user.lastName,
      })),
    };
  }

  async createPermission(callerBaId: string, dto: CreatePermissionDto) {
    await checkPermission(callerBaId, 'platform.permissions.manage');
    const app = await prisma.saApp.findUnique({ where: { publicId: dto.appId } });
    if (!app) throw new NotFoundException('App not found');
    try {
      type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
      const created = await prisma.$transaction(async (tx: Tx) => {
        const draft = await tx.saPermission.create({
          data: { publicId: 'placeholder', name: dto.name, appId: app.id },
        });
        return tx.saPermission.update({
          where: { id: draft.id },
          data: { publicId: this.sqids.encode(draft.id) },
          include: PERMISSION_INCLUDE,
        });
      });
      this.logger.getWinstonLogger().info('Permission created', { context: 'PermissionsService', permissionId: created.publicId });
      const row = created as unknown as { publicId: string; name: string; isSystem?: boolean; app: { publicId: string; name: string } };
      return {
        publicId: row.publicId, name: row.name, isSystem: row.isSystem ?? false,
        app: { publicId: row.app.publicId, name: row.app.name },
        roleCount: 0, userCount: 0,
      };
    } catch (e: unknown) {
      if (isPrismaCode(e, 'P2002')) throw new ConflictException('Permission with this name already exists');
      throw e;
    }
  }

  async updatePermission(callerBaId: string, publicId: string, dto: UpdatePermissionDto) {
    await checkPermission(callerBaId, 'platform.permissions.manage');
    if (dto.name === undefined) {
      throw new BadRequestException('At least one of name must be provided');
    }
    const existing = await prisma.saPermission.findUnique({ where: { publicId } });
    if (!existing) throw new NotFoundException();
    if (isPlatform(existing.name) || existing.isSystem) {
      throw new ForbiddenException('Platform-system permissions cannot be modified');
    }
    try {
      const updated = await prisma.saPermission.update({
        where: { publicId }, data: { name: dto.name }, include: PERMISSION_INCLUDE,
      });
      this.logger.getWinstonLogger().info('Permission updated', { context: 'PermissionsService', permissionId: publicId });
      const row = updated as unknown as { id: number; publicId: string; name: string; isSystem: boolean; app: { publicId: string; name: string } };
      const [roleCount, userCount] = await Promise.all([
        prisma.saRolePermission.count({ where: { permissionId: row.id } }),
        prisma.saUserPermission.count({ where: { permissionId: row.id } }),
      ]);
      return {
        publicId: row.publicId, name: row.name, isSystem: row.isSystem,
        app: { publicId: row.app.publicId, name: row.app.name },
        roleCount, userCount,
      };
    } catch (e: unknown) {
      if (isPrismaCode(e, 'P2002')) throw new ConflictException('Permission with this name already exists');
      throw e;
    }
  }

  async deletePermission(callerBaId: string, publicId: string): Promise<void> {
    await checkPermission(callerBaId, 'platform.permissions.manage');
    const existing = await prisma.saPermission.findUnique({ where: { publicId } });
    if (!existing) throw new NotFoundException();
    if (isPlatform(existing.name) || existing.isSystem) {
      throw new ForbiddenException('Platform-system permissions cannot be modified');
    }
    try {
      await prisma.saPermission.delete({ where: { publicId } });
      this.logger.getWinstonLogger().info('Permission deleted', { context: 'PermissionsService', permissionId: publicId });
    } catch (e: unknown) {
      if (isPrismaCode(e, 'P2003')) {
        const [roleCount, userCount] = await Promise.all([
          prisma.saRolePermission.count({ where: { permissionId: existing.id } }),
          prisma.saUserPermission.count({ where: { permissionId: existing.id } }),
        ]);
        throw new ConflictException(`Permission is in use by ${roleCount} roles and ${userCount} users`);
      }
      throw e;
    }
  }
}
