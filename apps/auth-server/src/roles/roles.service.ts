import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import { prisma } from '@sassy-auth/db';
import { SqidService } from '../common/sqid/sqid.service';
import { LoggerService } from '../common/logger/logger.service';
import { checkPermission } from '../common/permissions/check-permission';
import { checkPermissionForApp } from '../common/permissions/check-permission-for-app';
import { resolvePermissionIdsForApp } from '../common/permissions/resolve-app-scoped-ids';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { ListRolesQueryDto } from './dto/list-roles-query.dto';

const ROLE_INCLUDE = {
  app: { select: { publicId: true, name: true } },
} as const;

const ROLE_DETAIL_INCLUDE = {
  app: { select: { publicId: true, name: true } },
  permissions: {
    include: { permission: { select: { publicId: true, name: true } } },
    orderBy: { permission: { name: 'asc' } },
  },
} as const;

function isPrismaCode(e: unknown, code: string): boolean {
  return typeof e === 'object' && e !== null && 'code' in e && (e as { code?: string }).code === code;
}

@Injectable()
export class RolesService {
  constructor(
    private readonly sqids: SqidService,
    private readonly logger: LoggerService,
  ) {}

  async listRoles(callerBaId: string, q: ListRolesQueryDto = {}) {
    const caller = await prisma.saUser.findUnique({
      where: { betterAuthUserId: callerBaId },
      select: { org: { select: { appId: true } } },
    });
    if (!caller) throw new ForbiddenException();

    let targetAppId: number;
    if (q.appId) {
      const app = await prisma.saApp.findUnique({ where: { publicId: q.appId } });
      if (!app) throw new NotFoundException('App not found');
      targetAppId = app.id;
    } else {
      targetAppId = -1; // force cross-app to require platform.roles.manage
    }

    await checkPermissionForApp(
      callerBaId,
      ['platform.roles.manage', 'org.roles.manage'],
      { targetAppId, callerAppId: caller.org.appId },
    );

    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 25;

    const where: { appId?: number; name?: { contains: string; mode: 'insensitive' } } = {};
    if (q.appId) {
      // q.appId was already validated above; reuse targetAppId to avoid a second lookup.
      where.appId = targetAppId;
    }
    if (q.q) {
      const escaped = q.q.replace(/%/g, '\\%').replace(/_/g, '\\_');
      where.name = { contains: escaped, mode: 'insensitive' };
    }

    const [rows, total] = (await Promise.all([
      prisma.saRole.findMany({
        where, skip: (page - 1) * pageSize, take: pageSize,
        orderBy: { id: 'desc' }, include: ROLE_INCLUDE,
      }),
      prisma.saRole.count({ where }),
    ])) as [Array<{ id: number; publicId: string; name: string; app: { publicId: string; name: string } }>, number];

    const ids = rows.map((r) => r.id);
    const [permGroups, userGroups] = ids.length === 0
      ? [[], []] as [Array<{ roleId: number; _count: { _all: number } }>, Array<{ roleId: number; _count: { _all: number } }>]
      : (await Promise.all([
          prisma.saRolePermission.groupBy({ by: ['roleId'], where: { roleId: { in: ids } }, _count: { _all: true } }),
          prisma.saUserRole.groupBy({ by: ['roleId'], where: { roleId: { in: ids } }, _count: { _all: true } }),
        ])) as [Array<{ roleId: number; _count: { _all: number } }>, Array<{ roleId: number; _count: { _all: number } }>];
    const permMap = new Map(permGroups.map((g) => [g.roleId, g._count._all]));
    const userMap = new Map(userGroups.map((g) => [g.roleId, g._count._all]));

    return {
      items: rows.map((row) => ({
        publicId: row.publicId, name: row.name,
        app: { publicId: row.app.publicId, name: row.app.name },
        permissionCount: permMap.get(row.id) ?? 0,
        userCount: userMap.get(row.id) ?? 0,
      })),
      total, page, pageSize,
    };
  }

  async getRole(callerBaId: string, publicId: string) {
    const r = await prisma.saRole.findUnique({ where: { publicId }, include: ROLE_DETAIL_INCLUDE });
    if (!r) throw new NotFoundException();
    const row = r as unknown as {
      id: number; appId: number; publicId: string; name: string;
      app: { publicId: string; name: string };
      permissions: Array<{ permission: { publicId: string; name: string } }>;
    };

    const caller = await prisma.saUser.findUnique({
      where: { betterAuthUserId: callerBaId },
      select: { org: { select: { appId: true } } },
    });
    if (!caller) throw new ForbiddenException();

    await checkPermissionForApp(
      callerBaId,
      ['platform.roles.manage', 'org.roles.manage'],
      { targetAppId: row.appId, callerAppId: caller.org.appId },
    );

    const userCount = await prisma.saUserRole.count({ where: { roleId: row.id } });
    return {
      publicId: row.publicId, name: row.name,
      app: { publicId: row.app.publicId, name: row.app.name },
      permissionCount: row.permissions.length, userCount,
      permissions: row.permissions.map((rp) => ({ publicId: rp.permission.publicId, name: rp.permission.name })),
    };
  }

  async createRole(callerBaId: string, dto: CreateRoleDto) {
    await checkPermission(callerBaId, 'platform.roles.manage');
    const app = await prisma.saApp.findUnique({ where: { publicId: dto.appId } });
    if (!app) throw new NotFoundException('App not found');

    const permissionIds = await resolvePermissionIdsForApp(app.id, dto.permissionIds ?? []);

    try {
      type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
      const created = await prisma.$transaction(async (tx: Tx) => {
        const draft = await tx.saRole.create({
          data: { publicId: 'placeholder', name: dto.name, appId: app.id },
        });
        if (permissionIds.length > 0) {
          await tx.saRolePermission.createMany({
            data: permissionIds.map((pid) => ({ roleId: draft.id, permissionId: pid })),
          });
        }
        return tx.saRole.update({
          where: { id: draft.id },
          data: { publicId: this.sqids.encode(draft.id) },
          include: ROLE_DETAIL_INCLUDE,
        });
      });
      this.logger.getWinstonLogger().info('Role created', { context: 'RolesService', roleId: created.publicId });
      const row = created as unknown as {
        id: number; publicId: string; name: string;
        app: { publicId: string; name: string };
        permissions: Array<{ permission: { publicId: string; name: string } }>;
      };
      return {
        publicId: row.publicId, name: row.name,
        app: { publicId: row.app.publicId, name: row.app.name },
        permissionCount: row.permissions.length, userCount: 0,
        permissions: row.permissions.map((rp) => ({ publicId: rp.permission.publicId, name: rp.permission.name })),
      };
    } catch (e: unknown) {
      if (isPrismaCode(e, 'P2002')) throw new ConflictException('Role with this name already exists in this app');
      throw e;
    }
  }

  async updateRole(callerBaId: string, publicId: string, dto: UpdateRoleDto) {
    await checkPermission(callerBaId, 'platform.roles.manage');
    if (dto.name === undefined && dto.permissionIds === undefined) {
      throw new BadRequestException('At least one of name or permissionIds must be provided');
    }
    const existing = await prisma.saRole.findUnique({ where: { publicId } });
    if (!existing) throw new NotFoundException();

    const permissionIds = dto.permissionIds === undefined
      ? undefined
      : await resolvePermissionIdsForApp(existing.appId, dto.permissionIds);

    try {
      type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
      const updated = await prisma.$transaction(async (tx: Tx) => {
        if (dto.name !== undefined) {
          await tx.saRole.update({ where: { publicId }, data: { name: dto.name } });
        }
        if (permissionIds !== undefined) {
          await tx.saRolePermission.deleteMany({ where: { roleId: existing.id } });
          if (permissionIds.length > 0) {
            await tx.saRolePermission.createMany({
              data: permissionIds.map((pid) => ({ roleId: existing.id, permissionId: pid })),
            });
          }
        }
        return tx.saRole.findUnique({ where: { publicId }, include: ROLE_DETAIL_INCLUDE });
      });
      this.logger.getWinstonLogger().info('Role updated', { context: 'RolesService', roleId: publicId });
      const row = updated as unknown as {
        id: number; publicId: string; name: string;
        app: { publicId: string; name: string };
        permissions: Array<{ permission: { publicId: string; name: string } }>;
      };
      const userCount = await prisma.saUserRole.count({ where: { roleId: row.id } });
      return {
        publicId: row.publicId, name: row.name,
        app: { publicId: row.app.publicId, name: row.app.name },
        permissionCount: row.permissions.length, userCount,
        permissions: row.permissions.map((rp) => ({ publicId: rp.permission.publicId, name: rp.permission.name })),
      };
    } catch (e: unknown) {
      if (isPrismaCode(e, 'P2002')) throw new ConflictException('Role with this name already exists in this app');
      throw e;
    }
  }

  async deleteRole(callerBaId: string, publicId: string): Promise<void> {
    await checkPermission(callerBaId, 'platform.roles.manage');
    const existing = await prisma.saRole.findUnique({ where: { publicId } });
    if (!existing) throw new NotFoundException();
    try {
      type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
      await prisma.$transaction(async (tx: Tx) => {
        await tx.saRolePermission.deleteMany({ where: { roleId: existing.id } });
        await tx.saRole.delete({ where: { publicId } });
      });
      this.logger.getWinstonLogger().info('Role deleted', { context: 'RolesService', roleId: publicId });
    } catch (e: unknown) {
      if (isPrismaCode(e, 'P2003')) {
        const userCount = await prisma.saUserRole.count({ where: { roleId: existing.id } });
        throw new ConflictException(`Role is assigned to ${userCount} users`);
      }
      throw e;
    }
  }
}
