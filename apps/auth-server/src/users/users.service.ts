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
import { auth } from '../auth/auth.config';
import { runWithResetUrlCapture } from '../auth/reset-url-context';
import { EmailService } from '../email/email.service';
import { invitationEmail } from '../email/templates/invitation.template';

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
  createdAt: Date;
  lastLoginAt: Date | null;
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
    // bug-0186: serialize as ISO strings so the JSON payload is
    // stable across environments (Date instances would be converted
    // via toJSON anyway, but being explicit avoids client-side
    // dependence on that implicit behavior).
    createdAt: u.createdAt.toISOString(),
    lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
  };
}

@Injectable()
export class UsersService {
  constructor(
    private readonly sqids: SqidService,
    private readonly logger: LoggerService,
    private readonly email: EmailService,
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

    // bug-0140: hard cap the response so a single request can't return
    // an arbitrarily large payload. Full paginated response with
    // {items, total, page, pageSize} is a follow-up — a breaking
    // change on the admin API contract; this cap is the immediate
    // DoS mitigation. 500 is comfortably above any real org's active
    // user list and well below the point where the JSON payload
    // starts to matter for memory / latency.
    const users = await prisma.saUser.findMany({
      where,
      include: USER_INCLUDE,
      take: 500,
      orderBy: { id: 'desc' },
    });
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

    return user.roles.map((ur) => ({
      publicId: ur.role.publicId,
      name: ur.role.name,
      appId: ur.role.app.publicId,
      permissions: ur.role.permissions.map((rp) => ({
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
    user.roles.forEach((ur) => ur.role.permissions.forEach((rp) => names.add(rp.permission.name)));
    user.directPermissions.forEach((up) => names.add(up.permission.name));

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
      .filter((p) => p.isSystem)
      .map((p) => p.name);

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
      initialRoles.flatMap((r) =>
        r.permissions.filter((rp) => rp.permission.isSystem).map((rp) => rp.permission.name),
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
      ({ saUser, invitation } = await prisma.$transaction(async (tx) => {
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
    const inviteUrl = `${baseUrl}/accept-invite?token=${invitation.token}`;
    await this.email.send({
      to: dto.email,
      ...invitationEmail({ firstName: dto.firstName, inviteUrl }),
    });
    return { user: formatUser(saUser), inviteUrl };
  }
  async updateUser(callerBaId: string, publicId: string, dto: UpdateUserDto) {
    const existing = await prisma.saUser.findUnique({ where: { publicId } });
    if (!existing) throw new NotFoundException();
    await checkPermission(
      callerBaId,
      ['platform.users.manage', 'org.users.manage'],
      { targetOrgId: existing.orgId },
    );

    // bug-0152: a `pending` user only becomes `active` by accepting
    // their invitation (which also sets their password). Allowing the
    // admin PATCH to flip the status directly bypasses that gate and
    // produces an "active" user with no credential — they can never
    // log in, but they show up as active in every count. The correct
    // way to promote a pending user is `resendInvitation` + accept.
    if (dto.status === 'active' && existing.status === 'pending') {
      throw new BadRequestException(
        'A pending user becomes active only by accepting their invitation. Use /resend-invitation instead.',
      );
    }

    // Deactivation is a kill-switch and must not be self-inflicted.
    if (dto.status === 'inactive' && existing.betterAuthUserId === callerBaId) {
      throw new ForbiddenException('You cannot deactivate your own account');
    }

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

    // On deactivation, revoke every active session so the user is logged out
    // everywhere at once (blocking new logins/tokens is enforced elsewhere).
    if (dto.status === 'inactive') {
      await prisma.session.deleteMany({ where: { userId: existing.betterAuthUserId } });
    }

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
      .filter((rp) => rp.permission.isSystem)
      .map((rp) => rp.permission.name);
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

    // bug-0097: mirror the escalation guard from assignRole /
    // setUserRoles. Otherwise a caller who can revoke roles could
    // strip an admin of a system perm they themselves are not
    // authorized to grant — practically the same escalation surface
    // in reverse, since revoking then re-granting a role can leave
    // the caller with more effective privilege than they had before.
    // Fetching the role with its permissions is cheap and matches the
    // shape of assignRole above.
    const role = await prisma.saRole.findUnique({
      where: { publicId: rolePublicId },
      include: {
        permissions: { include: { permission: { select: { name: true, isSystem: true } } } },
      },
    });
    if (!role) throw new NotFoundException('Role not found');

    const systemPermNames = role.permissions
      .filter((rp) => rp.permission.isSystem)
      .map((rp) => rp.permission.name);
    await assertCallerCanGrantSystemPerms(callerBaId, systemPermNames);

    // bug-0138: catch Prisma P2025 ("record not found") so a caller
    // who tries to remove a role that isn't currently assigned gets
    // a 200 (idempotent) rather than a 500 with a raw Prisma stack.
    // Symmetric with assignRole's P2002 idempotency swallow above.
    try {
      await prisma.saUserRole.delete({ where: { userId_roleId: { userId: user.id, roleId: role.id } } });
    } catch (e: unknown) {
      if (
        typeof e === 'object' &&
        e !== null &&
        'code' in e &&
        (e as { code?: string }).code === 'P2025'
      ) {
        return;
      }
      throw e;
    }
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
      rolesWithPerms.flatMap((r) =>
        r.permissions.filter((rp) => rp.permission.isSystem).map((rp) => rp.permission.name),
      ),
    ));
    await assertCallerCanGrantSystemPerms(callerBaId, systemPermNames);

    const numericIds = await resolveRoleIdsForApp(org.appId, roleIds);

    await prisma.$transaction(async (tx) => {
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
    }).directPermissions.map((up) => ({
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
      .filter((p) => p.isSystem)
      .map((p) => p.name);
    await assertCallerCanGrantSystemPerms(callerBaId, systemPermNames);

    const numericIds = await resolvePermissionIdsForApp(org.appId, permissionIds);

    await prisma.$transaction(async (tx) => {
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
    const user = await prisma.saUser.findUnique({
      where: { publicId: userPublicId },
      include: { betterAuthUser: { select: { email: true } } },
    });
    if (!user) throw new NotFoundException('User not found');
    if (!user.betterAuthUser) throw new NotFoundException('User account not found');
    await checkPermission(
      callerBaId,
      ['platform.users.manage', 'org.users.manage'],
      { targetOrgId: user.orgId },
    );
    if (user.status !== 'pending') throw new BadRequestException('User is not pending — invitation cannot be resent');

    const token = crypto.randomBytes(32).toString('hex');
    const publicId = crypto.randomUUID().slice(0, 12);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    // bug-0139: expire-then-create must be transactional. Previously
    // the two writes were separate — a crash / connection drop
    // between them left the user with ZERO valid invitation tokens
    // AND ALL prior tokens force-expired. They'd need admin
    // intervention to recover. Wrapping in $transaction gives us
    // all-or-nothing semantics.
    const invitation = await prisma.$transaction(async (tx) => {
      await tx.saInvitation.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { expiresAt: new Date(0) },
      });
      return tx.saInvitation.create({
        data: { publicId, token, userId: user.id, expiresAt },
      });
    });

    this.logger.getWinstonLogger().info('Invitation resent', {
      context: 'UsersService',
      userId: userPublicId,
    });

    const baseUrl = process.env.ADMIN_URL ?? 'http://localhost:3001';
    const inviteUrl = `${baseUrl}/accept-invite?token=${invitation.token}`;
    await this.email.send({
      to: user.betterAuthUser.email,
      ...invitationEmail({ firstName: user.firstName, inviteUrl }),
    });
    return { inviteUrl };
  }

  async reset2fa(callerBaId: string, userPublicId: string): Promise<void> {
    const user = await prisma.saUser.findUnique({ where: { publicId: userPublicId } });
    if (!user) throw new NotFoundException('User not found');

    await checkPermission(
      callerBaId,
      ['platform.users.manage', 'org.users.manage'],
      { targetOrgId: user.orgId },
    );

    // Delete the TwoFactor row (one-to-one; deleteMany so a missing row is a
    // no-op rather than a throw — idempotent).
    await prisma.twoFactor.deleteMany({ where: { userId: user.betterAuthUserId } });

    // Clear the flag on the BetterAuth User row so the plugin treats them as
    // not enrolled.
    await prisma.user.update({
      where: { id: user.betterAuthUserId },
      data: { twoFactorEnabled: false },
    });

    // Audit log — NEVER include secret or backupCodes.
    this.logger.getWinstonLogger().warn('2FA reset by admin', {
      context: 'UsersService',
      actorId: callerBaId,
      targetUserId: userPublicId,
      action: '2fa_reset',
    });
  }

  async resetPassword(callerBaId: string, userPublicId: string): Promise<{ resetUrl: string | null }> {
    const user = await prisma.saUser.findUnique({
      where: { publicId: userPublicId },
      include: { betterAuthUser: { select: { email: true } } },
    });
    if (!user) throw new NotFoundException('User not found');
    if (!user.betterAuthUser) throw new NotFoundException('User account not found');

    await checkPermission(
      callerBaId,
      ['platform.users.manage', 'org.users.manage'],
      { targetOrgId: user.orgId },
    );

    // Only users with an email/password (credential) account can reset a password.
    // Pending users (not yet accepted) and social-only users have none.
    const credential = await prisma.account.findFirst({
      where: { userId: user.betterAuthUserId, providerId: 'credential' },
      select: { id: true },
    });
    if (!credential) {
      throw new BadRequestException('User has no password to reset');
    }

    const email = user.betterAuthUser.email;
    const adminUrl = process.env.ADMIN_URL ?? 'http://localhost:3001';
    const { resetUrl } = await runWithResetUrlCapture(async () => {
      await auth.api.requestPasswordReset({
        body: { email, redirectTo: `${adminUrl}/reset-password` },
      });
    });

    this.logger.getWinstonLogger().info('Admin triggered password reset', {
      context: 'UsersService',
      userId: userPublicId,
      linkSurfaced: resetUrl !== null,
    });

    return { resetUrl };
  }
}
