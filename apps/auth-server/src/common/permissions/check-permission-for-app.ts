import { ForbiddenException } from '@nestjs/common';
import { prisma } from '@sassy-auth/db';

/**
 * Sibling of `checkPermission` for routes whose target resource is
 * app-scoped (roles) rather than org-scoped (users). Pass
 * `callerAppId` so the helper can compare it against `targetAppId`.
 *
 * Behavior mirrors `checkPermission`: any `platform.*` permission the
 * caller holds bypasses the app-scope check; non-platform permissions
 * are allowed only when `callerAppId === targetAppId`. Pass
 * `targetAppId: -1` to force cross-app callers to require a `platform.*`
 * permission.
 */
export async function checkPermissionForApp(
  betterAuthUserId: string,
  required: string | string[],
  options: { targetAppId?: number; callerAppId?: number } = {},
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

  const requiredList = Array.isArray(required) ? required : [required];

  // platform.* bypasses the app-scope check.
  for (const r of requiredList) {
    if (r.startsWith('platform.') && perms.has(r)) return;
  }

  // org.* allowed only when the caller's app matches the target app.
  for (const r of requiredList) {
    if (r.startsWith('platform.')) continue;
    if (!perms.has(r)) continue;
    if (options.targetAppId === undefined) return;
    if (options.callerAppId === options.targetAppId) return;
  }

  throw new ForbiddenException();
}
