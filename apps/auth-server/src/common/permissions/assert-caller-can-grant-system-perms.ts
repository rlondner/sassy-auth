import { ForbiddenException } from '@nestjs/common';
import { prisma } from '@sassy-auth/db';

/**
 * The platform-tier trust signal for user-assignment surfaces. A caller
 * holding this perm is trusted to grant any system perm; the escalation
 * guard below short-circuits on it.
 */
const PLATFORM_USERS_MANAGE = 'platform.users.manage';

/**
 * Closes horizontal escalation within the org.* tier. A non-platform
 * caller can only grant a system perm `X` to another user if they hold
 * `X` themselves. Holders of `platform.users.manage` bypass — that
 * permission is the platform-tier trust signal for user-assignment
 * surfaces.
 *
 * `systemPermNames` should already be filtered to perms whose
 * `isSystem === true`. The service layer is responsible for
 * extracting that list from the role/direct-perm assignment about
 * to be made.
 */
export async function assertCallerCanGrantSystemPerms(
  betterAuthUserId: string,
  systemPermNames: readonly string[],
): Promise<void> {
  if (systemPermNames.length === 0) return;

  const saUser = await prisma.saUser.findUnique({
    where: { betterAuthUserId },
    include: {
      roles: {
        include: {
          role: { include: { permissions: { include: { permission: true } } } },
        },
      },
      directPermissions: { include: { permission: true } },
    },
  });
  if (!saUser) throw new ForbiddenException();

  const callerPerms = new Set<string>();
  saUser.roles.forEach((ur) =>
    ur.role.permissions.forEach((rp) => callerPerms.add(rp.permission.name)),
  );
  saUser.directPermissions.forEach((up) => callerPerms.add(up.permission.name));

  // Platform-tier bypass.
  if (callerPerms.has(PLATFORM_USERS_MANAGE)) return;

  const missing = systemPermNames.filter((n) => !callerPerms.has(n));
  if (missing.length > 0) {
    throw new ForbiddenException(
      `Cannot grant system permission(s) you do not hold: ${missing.join(', ')}`,
    );
  }
}
