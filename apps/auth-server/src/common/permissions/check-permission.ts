import { ForbiddenException } from '@nestjs/common';
import { prisma } from '@sassy-auth/db';

/**
 * Verifies that the caller holds one of the given permissions. If
 * `targetOrgId` is supplied AND the caller does not hold a
 * `platform.*` permission, the caller's org must equal the target org.
 *
 * This is the load-bearing check for tenant isolation: an org admin
 * with `org.users.manage` in org A must not be able to act on rows
 * scoped to org B. Pass `targetOrgId` whenever the operation reads or
 * writes an org-scoped resource.
 *
 * `required` accepts a single permission or an ordered list. The first
 * permission the caller holds wins. If any element starts with
 * `platform.`, holding it bypasses the org-scope check.
 */
export async function checkPermission(
  betterAuthUserId: string,
  required: string | string[],
  options: { targetOrgId?: number } = {},
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

  // First try: any `platform.*` permission grants cross-org access.
  for (const r of requiredList) {
    if (r.startsWith('platform.') && perms.has(r)) return;
  }

  // Second try: any non-platform permission grants access, but only if
  // the caller's org matches the target org (when one was supplied).
  for (const r of requiredList) {
    if (r.startsWith('platform.')) continue;
    if (!perms.has(r)) continue;
    if (options.targetOrgId === undefined) return;
    if (saUser.orgId === options.targetOrgId) return;
  }

  throw new ForbiddenException();
}
