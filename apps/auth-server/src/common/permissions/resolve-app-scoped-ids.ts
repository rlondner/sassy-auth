import { BadRequestException, NotFoundException } from '@nestjs/common';
import { prisma } from '@sassy-auth/db';

export async function resolvePermissionIdsForApp(
  appId: number,
  permissionPublicIds: string[],
): Promise<number[]> {
  if (permissionPublicIds.length === 0) return [];
  const perms = (await prisma.saPermission.findMany({
    where: { publicId: { in: permissionPublicIds } },
    select: { id: true, publicId: true, appId: true, isSystem: true },
  })) as Array<{ id: number; publicId: string; appId: number; isSystem: boolean }>;
  if (perms.length !== permissionPublicIds.length) {
    const found = new Set(perms.map((p) => p.publicId));
    const missing = permissionPublicIds.filter((id) => !found.has(id));
    throw new NotFoundException(`Permission(s) not found: ${missing.join(', ')}`);
  }
  // System perms (org.*) bypass the app-scope check; everything else
  // must match the target app exactly.
  const wrongApp = perms.filter((p) => !p.isSystem && p.appId !== appId);
  if (wrongApp.length > 0) {
    throw new BadRequestException(
      `Permission(s) belong to a different app: ${wrongApp.map((p) => p.publicId).join(', ')}`,
    );
  }
  return perms.map((p) => p.id);
}

export async function resolveRoleIdsForApp(
  appId: number,
  rolePublicIds: string[],
): Promise<number[]> {
  if (rolePublicIds.length === 0) return [];
  const roles = (await prisma.saRole.findMany({
    where: { publicId: { in: rolePublicIds } },
    select: { id: true, publicId: true, appId: true },
  })) as Array<{ id: number; publicId: string; appId: number }>;
  if (roles.length !== rolePublicIds.length) {
    const found = new Set(roles.map((r) => r.publicId));
    const missing = rolePublicIds.filter((id) => !found.has(id));
    throw new NotFoundException(`Role(s) not found: ${missing.join(', ')}`);
  }
  const wrongApp = roles.filter((r) => r.appId !== appId);
  if (wrongApp.length > 0) {
    throw new BadRequestException(
      `Role(s) belong to a different app: ${wrongApp.map((r) => r.publicId).join(', ')}`,
    );
  }
  return roles.map((r) => r.id);
}
