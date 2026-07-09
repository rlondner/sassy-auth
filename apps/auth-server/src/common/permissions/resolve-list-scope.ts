import { ForbiddenException } from '@nestjs/common';
import { prisma } from '@sassy-auth/db';

export type ListScope = { scope: 'platform' } | { scope: 'org'; orgId: number };

/**
 * bug-0001 — companion to `checkPermission` for LIST endpoints that
 * admit both platform-wide and org-scoped callers.
 *
 * `checkPermission` answers a yes/no question about a *specific* target
 * (get / update / delete of a single row). It cannot help a list
 * endpoint decide whether to return every row or only the caller's own
 * org's rows.
 *
 * `resolveListScope` answers "what scope may this caller list at?":
 *   • `{ scope: 'platform' }`  — any of the caller's `platform.*` perms
 *                                 in `requiredPerms` is present. The
 *                                 endpoint may return every row.
 *   • `{ scope: 'org', orgId }` — the caller holds only a non-platform
 *                                 perm in `requiredPerms`. The endpoint
 *                                 MUST add `{ orgId }` to its where
 *                                 clause and return only that org's
 *                                 rows.
 *   • throws ForbiddenException — the caller holds none of the
 *                                 required perms.
 *
 * Platform wins ties: if the caller holds both a platform and a
 * non-platform perm in the list, we return `platform` scope (widest
 * access), matching `checkPermission`'s first-loop bypass semantics.
 *
 * By design, this helper is org-specific — it does not model app
 * scope, resource type, or any other dimension. If a future list
 * endpoint needs a different scope axis, add a sibling helper rather
 * than generalizing this one; the read-only contract makes it easy to
 * audit.
 */
export async function resolveListScope(
  betterAuthUserId: string,
  requiredPerms: string[],
): Promise<ListScope> {
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

  // Platform.* — widest scope wins.
  for (const r of requiredPerms) {
    if (r.startsWith('platform.') && perms.has(r)) {
      return { scope: 'platform' };
    }
  }

  // Non-platform — org-scoped access to caller's own org only.
  for (const r of requiredPerms) {
    if (r.startsWith('platform.')) continue;
    if (perms.has(r)) {
      return { scope: 'org', orgId: saUser.orgId };
    }
  }

  throw new ForbiddenException();
}
