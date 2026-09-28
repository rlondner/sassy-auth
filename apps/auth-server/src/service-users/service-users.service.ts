import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '@sassy-auth/db';

/**
 * Role assign/remove for a calling app's own users, authenticated by a
 * service token (ServiceTokenGuard already proved *which app* is calling —
 * this is where the app-boundary property that actually matters is
 * enforced). Deliberately does not use checkPermission: that resolves
 * permissions for a human identity, and a service token has none. See
 * design spec §5.
 */
@Injectable()
export class ServiceUsersService {
  async assignRole(callingAppId: number, userPublicId: string, rolePublicId: string): Promise<void> {
    const { user, role } = await this.resolveAndAuthorize(callingAppId, userPublicId, rolePublicId);

    try {
      await prisma.saUserRole.create({ data: { userId: user.id, roleId: role.id } });
    } catch (e: unknown) {
      // P2002 = unique-constraint violation: the role is already assigned.
      // Assignment is idempotent — swallow and treat as success, matching
      // UsersService.assignRole.
      if (typeof e === 'object' && e !== null && 'code' in e && (e as { code?: string }).code === 'P2002') {
        return;
      }
      throw e;
    }
  }

  async removeRole(callingAppId: number, userPublicId: string, rolePublicId: string): Promise<void> {
    const { user, role } = await this.resolveAndAuthorize(callingAppId, userPublicId, rolePublicId);

    try {
      await prisma.saUserRole.delete({ where: { userId_roleId: { userId: user.id, roleId: role.id } } });
    } catch (e: unknown) {
      // P2025 = record not found: the role wasn't assigned. Idempotent —
      // matches UsersService.removeRole.
      if (typeof e === 'object' && e !== null && 'code' in e && (e as { code?: string }).code === 'P2025') {
        return;
      }
      throw e;
    }
  }

  /**
   * Both checks are required and independent: without them a service token
   * could assign a role belonging to some *other* app to the calling app's
   * user, or assign the calling app's own role to some *other* app's user.
   * 404 (not 403) on either mismatch matches the existing "don't confirm
   * existence you're not authorized to know about" posture for cross-org
   * access elsewhere in this codebase.
   */
  private async resolveAndAuthorize(callingAppId: number, userPublicId: string, rolePublicId: string) {
    const user = await prisma.saUser.findUnique({
      where: { publicId: userPublicId },
      include: { org: true },
    });
    if (!user || user.org.appId !== callingAppId) {
      throw new NotFoundException();
    }

    const role = await prisma.saRole.findUnique({
      where: { publicId: rolePublicId },
      include: { permissions: { include: { permission: { select: { isSystem: true } } } } },
    });
    if (!role || role.appId !== callingAppId) {
      throw new NotFoundException();
    }

    // A role carrying a system permission must only ever be grantable
    // through the human-admin path (assertCallerCanGrantSystemPerms in
    // UsersService) — the app-boundary check above does not substitute for
    // that guard, so it's re-asserted here independent of callingAppId.
    if (role.permissions.some((rp) => rp.permission.isSystem)) {
      throw new ForbiddenException('Cannot assign a role carrying a system permission via a service token');
    }

    return { user, role };
  }
}
