import { Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '@sassy-auth/db';
import { SqidService } from '../common/sqid/sqid.service';
import { checkPermission } from '../common/permissions/check-permission';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { AssignRoleDto } from './dto/assign-role.dto';

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
  constructor(private readonly sqids: SqidService) {}

  async listUsers(
    callerBaId: string,
    filters: { orgPublicId?: string; appPublicId?: string },
  ) {
    await checkPermission(callerBaId, 'platform.users.manage').catch(async () => {
      await checkPermission(callerBaId, 'org.users.manage');
    });

    const where: Record<string, unknown> = {};
    if (filters.orgPublicId) where['org'] = { publicId: filters.orgPublicId };

    const users = await prisma.saUser.findMany({ where, include: USER_INCLUDE });
    return users.map(formatUser);
  }

  async getUser(callerBaId: string, publicId: string) {
    await checkPermission(callerBaId, 'platform.users.manage').catch(async () => {
      await checkPermission(callerBaId, 'org.users.manage');
    });

    const user = await prisma.saUser.findUnique({
      where: { publicId },
      include: USER_INCLUDE,
    });
    if (!user) throw new NotFoundException();
    return formatUser(user);
  }

  async getUserRoles(callerBaId: string, publicId: string) {
    await checkPermission(callerBaId, 'platform.users.manage').catch(async () => {
      await checkPermission(callerBaId, 'org.users.manage');
    });

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

    return user.roles.map((ur) => ({
      id: ur.role.publicId,
      name: ur.role.name,
      appId: ur.role.app.publicId,
      permissions: ur.role.permissions.map((rp) => ({
        id: rp.permission.publicId,
        name: rp.permission.name,
        appId: ur.role.app.publicId,
      })),
    }));
  }

  async getEffectivePermissions(callerBaId: string, publicId: string) {
    await checkPermission(callerBaId, 'platform.users.manage').catch(async () => {
      await checkPermission(callerBaId, 'org.users.manage');
    });

    const user = await prisma.saUser.findUnique({
      where: { publicId },
      include: {
        roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
        directPermissions: { include: { permission: true } },
      },
    });
    if (!user) throw new NotFoundException();

    const names = new Set<string>();
    user.roles.forEach((ur) => ur.role.permissions.forEach((rp) => names.add(rp.permission.name)));
    user.directPermissions.forEach((up) => names.add(up.permission.name));

    return { userId: publicId, permissions: Array.from(names).sort() };
  }
  async createUser(_callerBaId: string, _dto: CreateUserDto): Promise<never> { throw new Error('not implemented'); }
  async updateUser(_callerBaId: string, _publicId: string, _dto: UpdateUserDto): Promise<never> { throw new Error('not implemented'); }
  async deleteUser(_callerBaId: string, _publicId: string): Promise<void> { throw new Error('not implemented'); }
  async assignRole(_callerBaId: string, _publicId: string, _dto: AssignRoleDto): Promise<void> { throw new Error('not implemented'); }
  async removeRole(_callerBaId: string, _publicId: string, _rolePublicId: string): Promise<void> { throw new Error('not implemented'); }
  async resendInvitation(_callerBaId: string, _userPublicId: string): Promise<never> { throw new Error('not implemented'); }
}
