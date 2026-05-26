import { ForbiddenException } from '@nestjs/common';
import { prisma } from '@sassy-auth/db';

export async function checkPermission(
  betterAuthUserId: string,
  required: string,
): Promise<void> {
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

  const perms = new Set<string>();
  saUser.roles.forEach((ur) =>
    ur.role.permissions.forEach((rp) => perms.add(rp.permission.name)),
  );
  saUser.directPermissions.forEach((up) => perms.add(up.permission.name));

  if (!perms.has(required)) throw new ForbiddenException();
}
