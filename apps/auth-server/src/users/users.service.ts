import * as crypto from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { prisma, Prisma } from '@sassy-auth/db';
import { SqidService } from '../common/sqid/sqid.service';
import { checkPermission } from '../common/permissions/check-permission';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { AssignRoleDto } from './dto/assign-role.dto';
import { resolveRoleIdsForApp, resolvePermissionIdsForApp } from '../common/permissions/resolve-app-scoped-ids';
import { assertCallerCanGrantSystemPerms } from '../common/permissions/assert-caller-can-grant-system-perms';
import { LoggerService } from '../common/logger/logger.service';

const USER_INCLUDE = {
  betterAuthUser: { select: { email: true } },
  org: { select: { publicId: true } },
} as const;

function formatUser(u: {
  publicId: string;
  firstName: string;
  lastName: string;
  phoneNumber: string | null;
  username: string | null;
  status: string;
  org: { publicId: string };
  betterAuthUser: { email: string };
}) {
  return {
    id: u.publicId,
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.betterAuthUser.email,
    phoneNumber: u.phoneNumber,
    username: u.username,
    orgId: u.org.publicId,
    status: u.status,
  };
}

@Injectable()
export class UsersService {
  constructor(
    private readonly sqids: SqidService,
    private readonly logger: LoggerService,
  ) {}

  async listUsers(
    callerBaId: string,
    filters: { orgPublicId?: string; appPublicId?: string },
  ) {
    // If a specific org is requested, scope the auth check to that org.
    // If no org is requested, only `platform.users.manage` can list
    // cross-tenant — pass an explicit `targetOrgId: -1` sentinel so the
    // helper rejects holders of `org.users.manage`.
    let targetOrgId: number | undefined;
    if (filters.orgPublicId) {
      const org = await prisma.saOrg.findUnique({ where: { publicId: filters.orgPublicId } });
      if (!org) throw new NotFoundException('Org not found');
      targetOrgId = org.id;
    } else {
      // Force cross-tenant case to require platform.users.manage
      targetOrgId = -1;
    }
    await checkPermission(
      callerBaId,
      ['platform.users.manage', 'org.users.manage'],
      { targetOrgId },
    );

    const where: Record<string, unknown> = {};
    if (filters.orgPublicId) where['org'] = { publicId: filters.orgPublicId };

    const users = await prisma.saUser.findMany({ where, include: USER_INCLUDE });
    return users.map(formatUser);
  }

  async getUser(callerBaId: string, publicId: string) {
    const user = await prisma.saUser.findUnique({
      where: { publicId },
      include: USER_INCLUDE,
    });
    if (!user) throw new NotFoundException();
    await checkPermission(
      callerBaId,
      ['platform.users.manage', 'org.users.manage'],
      { targetOrgId: (user as unknown as { orgId: number }).orgId },
    );
    return formatUser(user);
  }

  async getUserRoles(callerBaId: string, publicId: string) {
    const user = await prisma.saUser.findUnique({
      where: { publicId },
      include: {
        roles: {
          include: {
            role: { include: { app: { select: { publicId: true } }, permissions: { include: { permission: true } } } },
          },
        },
      },
    });
    if (!user) throw new NotFoundException();
    await checkPermission(
      callerBaId,
      ['platform.users.manage', 'org.users.manage'],
      { targetOrgId: user.orgId },
    );

    return user.roles.map((ur: any) => ({
      publicId: ur.role.publicId,
      name: ur.role.name,
      appId: ur.role.app.publicId,
      permissions: ur.role.permissions.map((rp: any) => ({
        publicId: rp.permission.publicId,
        name: rp.permission.name,
        appId: ur.role.app.publicId,
      })),
    }));
  }

  async getEffectivePermissions(callerBaId: string, publicId: string) {
    const user = await prisma.saUser.findUnique({
      where: { publicId },
      include: {
        roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
        directPermissions: { include: { permission: true } },
      },
    });
    if (!user) throw new NotFoundException();
    await checkPermission(
      callerBaId,
      ['platform.users.manage', 'org.users.manage'],
      { targetOrgId: user.orgId },
    );

    const names = new Set<string>();
    user.roles.forEach((ur: any) => ur.role.permissions.forEach((rp: any) => names.add(rp.permission.name)));
    user.directPermissions.forEach((up: any) => names.add(up.permission.name));

    return { userId: publicId, permissions: Array.from(names).sort() };
  }
  async createUser(callerBaId: string, dto: CreateUserDto) {
    const org = await prisma.saOrg.findUnique({ where: { publicId: dto.orgId } });
    if (!org) throw new NotFoundException('Org not found');

    await checkPermission(
      callerBaId,
      ['platform.users.manage', 'org.users.manage'],
      { targetOrgId: org.id },
    );

    // Escalation guard for initial direct perms.
    const initialPerms = (dto.directPermissionIds ?? []).length === 0
      ? []
      : await prisma.saPermission.findMany({
          where: { publicId: { in: dto.directPermissionIds ?? [] } },
          select: { name: true, isSystem: true },
        });
    const directSystemPermNames = initialPerms
      .filter((p: any) => p.isSystem)
      .map((p: any) => p.name);

    // Escalation guard for initial roles.
    const initialRoles = (dto.roleIds ?? []).length === 0
      ? []
      : await prisma.saRole.findMany({
          where: { publicId: { in: dto.roleIds ?? [] } },
          select: {
            permissions: {
              select: { permission: { select: { name: true, isSystem: true } } },
            },
          },
        });
    const roleSystemPermNames = Array.from(new Set(
      initialRoles.flatMap((r: any) =>
        r.permissions.filter((rp: any) => rp.permission.isSystem).map((rp: any) => rp.permission.name),
      ),
    ));

    await assertCallerCanGrantSystemPerms(
      callerBaId,
      Array.from(new Set([...directSystemPermNames, ...roleSystemPermNames])),
    );

    // Resolve + app-scope-validate role/permission ids BEFORE entering the
    // create transaction so a bad publicId throws cleanly without leaving
    // an orphan user behind.
    const numericRoleIds = await resolveRoleIdsForApp(org.appId, dto.roleIds ?? []);
    const numericPermIds = await resolvePermissionIdsForApp(org.appId, dto.directPermissionIds ?? []);

    const baUserId = crypto.randomUUID();
    const now = new Date();
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    let saUser: Prisma.SaUserGetPayload<{ include: typeof USER_INCLUDE }>;
    let invitation: Awaited<ReturnType<typeof prisma.saInvitation.create>>;
    try {
      ({ saUser, invitation } = await prisma.$transaction(async (tx: any) => {
        await tx.user.create({
          data: {
            id: baUserId,
            name: `${dto.firstName} ${dto.lastName}`,
            email: dto.email,
            emailVerified: false,
            createdAt: now,
            updatedAt: now,
          },
        });

        const createdSaUser = await tx.saUser.create({
          data: {
            publicId: baUserId.slice(0, 12),
            betterAuthUserId: baUserId,
            orgId: org.id,
            firstName: dto.firstName,
            lastName: dto.lastName,
            phoneNumber: dto.phoneNumber ?? null,
            username: dto.username ?? null,
            status: 'pending',
          },
          include: USER_INCLUDE,
        });

        if (numericRoleIds.length > 0) {
          await tx.saUserRole.createMany({
            data: numericRoleIds.map((roleId) => ({ userId: createdSaUser.id, roleId })),
          });
        }
        if (numericPermIds.length > 0) {
          await tx.saUserPermission.createMany({
            data: numericPermIds.map((permissionId) => ({ userId: createdSaUser.id, permissionId })),
          });
        }

        const createdInvitation = await tx.saInvitation.create({
          data: {
            publicId: baUserId.slice(12, 24),
            token,
            userId: createdSaUser.id,
            expiresAt,
          },
        });

        return { saUser: createdSaUser, invitation: createdInvitation };
      }));
    } catch (e: unknown) {
      if (
        typeof e === 'object' &&
        e !== null &&
        'code' in e &&
        (e as { code?: string }).code === 'P2002'
      ) {
        throw new ConflictException('A user with that email or username already exists.');
      }
      throw e;
    }

    const baseUrl = process.env.ADMIN_URL ?? 'http://localhost:3001';
    this.logger.getWinstonLogger().info('User created', {
      context: 'UsersService',
      userId: saUser.publicId,
      orgId: dto.orgId,
      roleCount: numericRoleIds.length,
      directPermissionCount: numericPermIds.length,
    });
    return {
      user: formatUser(saUser),
      inviteUrl: `${baseUrl}/accept-invite?token=${invitation.token}`,
    };
  }
  async updateUser(callerBaId: string, publicId: string, dto: UpdateUserDto) {
    const existing = await prisma.saUser.findUnique({ where: { publicId } });
    if (!existing) throw new NotFoundException();
    await checkPermission(
      callerBaId,
      ['platform.users.manage', 'org.users.manage'],
      { targetOrgId: existing.orgId },
    );

    const updated = await prisma.saUser.update({
      where: { publicId },
      data: {
        ...(dto.firstName !== undefined && { firstName: dto.firstName }),
        ...(dto.lastName !== undefined && { lastName: dto.lastName }),
        ...(dto.phoneNumber !== undefined && { phoneNumber: dto.phoneNumber }),
        ...(dto.username !== undefined && { username: dto.username }),
        ...(dto.status !== undefined && { status: dto.status }),
      },
      include: USER_INCLUDE,
    });
    const changedFields = Object.keys(dto).filter((k) => dto[k as keyof typeof dto] !== undefined);
    this.logger.getWinstonLogger().info('User updated', {
      context: 'UsersService',
      userId: publicId,
      changedFields,
    });
    return formatUser(updated);
  }

  async deleteUser(callerBaId: string, publicId: string): Promise<void> {
    const existing = await prisma.saUser.findUnique({ where: { publicId } });
    if (!existing) throw new NotFoundException();
    if (existing.betterAuthUserId === callerBaId) {
      throw new ForbiddenException('You cannot delete your own account');
    }
    // delete is a destructive action — keep the strictest gate
    // (platform-wide only) but pass the targetOrgId for audit symmetry.
    await checkPermission(callerBaId, ['platform.users.manage'], {
      targetOrgId: existing.orgId,
    });

    await prisma.saUser.delete({ where: { publicId } });
    this.logger.getWinstonLogger().info('User deleted', {
      context: 'UsersService',
      userId: publicId,
    });
  }
  async assignRole(callerBaId: string, userPublicId: string, dto: AssignRoleDto): Promise<void> {
    const user = await prisma.saUser.findUnique({ where: { publicId: userPublicId } });
    if (!user) throw new NotFoundException('User not found');
    await checkPermission(
      callerBaId,
      ['platform.users.manage', 'org.users.manage'],
      { targetOrgId: user.orgId },
    );

    const role = await prisma.saRole.findUnique({
      where: { publicId: dto.roleId },
      include: {
        permissions: { include: { permission: { select: { name: true, isSystem: true } } } },
      },
    });
    if (!role) throw new NotFoundException('Role not found');

    const systemPermNames = role.permissions
      .filter((rp: any) => rp.permission.isSystem)
      .map((rp: any) => rp.permission.name);
    await assertCallerCanGrantSystemPerms(callerBaId, systemPermNames);

    try {
      await prisma.saUserRole.create({ data: { userId: user.id, roleId: role.id } });
    } catch (e: unknown) {
      // P2002 = unique-constraint violation: the role is already assigned.
      // Role assignment is idempotent — swallow and treat as success.
      if (
        typeof e === 'object' &&
        e !== null &&
        'code' in e &&
        (e as { code?: string }).code === 'P2002'
      ) {
        return;
      }
      throw e;
    }
    this.logger.getWinstonLogger().info('Role assigned to user', {
      context: 'UsersService',
      userId: userPublicId,
      roleId: dto.roleId,
    });
  }

  async removeRole(callerBaId: string, userPublicId: string, rolePublicId: string): Promise<void> {
    const user = await prisma.saUser.findUnique({ where: { publicId: userPublicId } });
    if (!user) throw new NotFoundException('User not found');
    await checkPermission(
      callerBaId,
      ['platform.users.manage', 'org.users.manage'],
      { targetOrgId: user.orgId },
    );

    const role = await prisma.saRole.findUnique({ where: { publicId: rolePublicId } });
    if (!role) throw new NotFoundException('Role not found');

    await prisma.saUserRole.delete({ where: { userId_roleId: { userId: user.id, roleId: role.id } } });
    this.logger.getWinstonLogger().info('Role removed from user', {
      context: 'UsersService',
      userId: userPublicId,
      roleId: rolePublicId,
    });
  }

  async setUserRoles(
    callerBaId: string,
    userPublicId: string,
    roleIds: string[],
  ): Promise<void> {
    const user = await prisma.saUser.findUnique({ where: { publicId: userPublicId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.betterAuthUserId === callerBaId) {
      throw new ForbiddenException('You cannot edit your own access');
    }
    await checkPermission(
      callerBaId,
      ['platform.users.manage', 'org.users.manage'],
      { targetOrgId: user.orgId },
    );

    const org = await prisma.saOrg.findUnique({ where: { id: user.orgId } });
    if (!org) throw new NotFoundException('User org not found');

    // Apply escalation guard: collect every isSystem perm in every role
    // about to be assigned, then assert the caller can grant them.
    const rolesWithPerms = roleIds.length === 0
      ? []
      : await prisma.saRole.findMany({
          where: { publicId: { in: roleIds } },
          select: {
            permissions: {
              select: { permission: { select: { name: true, isSystem: true } } },
            },
          },
        });
    const systemPermNames = Array.from(new Set(
      rolesWithPerms.flatMap((r: any) =>
        r.permissions.filter((rp: any) => rp.permission.isSystem).map((rp: any) => rp.permission.name),
      ),
    ));
    await assertCallerCanGrantSystemPerms(callerBaId, systemPermNames);

    const numericIds = await resolveRoleIdsForApp(org.appId, roleIds);

    await prisma.$transaction(async (tx: any) => {
      await tx.saUserRole.deleteMany({ where: { userId: user.id } });
      if (numericIds.length > 0) {
        await tx.saUserRole.createMany({
          data: numericIds.map((roleId) => ({ userId: user.id, roleId })),
        });
      }
    });

    this.logger.getWinstonLogger().info('User roles set', {
      context: 'UsersService',
      userId: userPublicId,
      roleCount: numericIds.length,
    });
  }

  async getUserDirectPermissions(
    callerBaId: string,
    userPublicId: string,
  ): Promise<Array<{ id: string; name: string; appId: string }>> {
    const user = await prisma.saUser.findUnique({
      where: { publicId: userPublicId },
      include: {
        directPermissions: { include: { permission: { select: { publicId: true, name: true, appId: true } } } },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    await checkPermission(
      callerBaId,
      ['platform.users.manage', 'org.users.manage'],
      { targetOrgId: user.orgId },
    );

    // The admin Permission shape uses appId as a publicId string; the
    // /api/users/:id/effective-permissions endpoint already publishes
    // appId: '' for the same reason — direct-permission rows don't carry
    // the app publicId via this query path. Match that convention.
    return (user as unknown as {
      directPermissions: Array<{ permission: { publicId: string; name: string; appId: number } }>;
    }).directPermissions.map((up: any) => ({
      id: up.permission.publicId,
      name: up.permission.name,
      appId: '',
    }));
  }

  async setUserDirectPermissions(
    callerBaId: string,
    userPublicId: string,
    permissionIds: string[],
  ): Promise<void> {
    const user = await prisma.saUser.findUnique({ where: { publicId: userPublicId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.betterAuthUserId === callerBaId) {
      throw new ForbiddenException('You cannot edit your own access');
    }
    await checkPermission(
      callerBaId,
      ['platform.users.manage', 'org.users.manage'],
      { targetOrgId: user.orgId },
    );

    const org = await prisma.saOrg.findUnique({ where: { id: user.orgId } });
    if (!org) throw new NotFoundException('User org not found');

    // Load the permissions about to be granted so we can filter the
    // system ones and apply the escalation guard before resolution.
    const requestedPerms = permissionIds.length === 0
      ? []
      : await prisma.saPermission.findMany({
          where: { publicId: { in: permissionIds } },
          select: { name: true, isSystem: true },
        });
    const systemPermNames = requestedPerms
      .filter((p: any) => p.isSystem)
      .map((p: any) => p.name);
    await assertCallerCanGrantSystemPerms(callerBaId, systemPermNames);

    const numericIds = await resolvePermissionIdsForApp(org.appId, permissionIds);

    await prisma.$transaction(async (tx: any) => {
      await tx.saUserPermission.deleteMany({ where: { userId: user.id } });
      if (numericIds.length > 0) {
        await tx.saUserPermission.createMany({
          data: numericIds.map((permissionId) => ({ userId: user.id, permissionId })),
        });
      }
    });

    this.logger.getWinstonLogger().info('User direct permissions set', {
      context: 'UsersService',
      userId: userPublicId,
      permissionCount: numericIds.length,
    });
  }

  async resendInvitation(callerBaId: string, userPublicId: string) {
    const user = await prisma.saUser.findUnique({ where: { publicId: userPublicId } });
    if (!user) throw new NotFoundException('User not found');
    await checkPermission(
      callerBaId,
      ['platform.users.manage', 'org.users.manage'],
      { targetOrgId: user.orgId },
    );
    if (user.status !== 'pending') throw new BadRequestException('User is not pending — invitation cannot be resent');

    // Expire all existing unused tokens for this user
    await prisma.saInvitation.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { expiresAt: new Date(0) },
    });

    const token = crypto.randomBytes(32).toString('hex');
    const publicId = crypto.randomUUID().slice(0, 12);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const invitation = await prisma.saInvitation.create({
      data: { publicId, token, userId: user.id, expiresAt },
    });

    this.logger.getWinstonLogger().info('Invitation resent', {
      context: 'UsersService',
      userId: userPublicId,
    });

    const baseUrl = process.env.ADMIN_URL ?? 'http://localhost:3001';
    return { inviteUrl: `${baseUrl}/accept-invite?token=${invitation.token}` };
  }
}
