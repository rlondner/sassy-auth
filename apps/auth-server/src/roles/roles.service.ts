import { Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '@sassy-auth/db';
import { checkPermission } from '../common/permissions/check-permission';

const ROLE_INCLUDE = {
  app: { select: { publicId: true } },
  permissions: { include: { permission: { include: { app: { select: { publicId: true } } } } } },
} as const;

function formatRole(r: {
  publicId: string; name: string; app: { publicId: string };
  permissions: { permission: { publicId: string; name: string; app: { publicId: string } } }[];
}) {
  return {
    id: r.publicId,
    name: r.name,
    appId: r.app.publicId,
    permissions: r.permissions.map((rp) => ({
      id: rp.permission.publicId,
      name: rp.permission.name,
      appId: rp.permission.app.publicId,
    })),
  };
}

@Injectable()
export class RolesService {
  async listRoles(callerBaId: string, appPublicId?: string) {
    await checkPermission(callerBaId, 'platform.permissions.manage').catch(async () => {
      await checkPermission(callerBaId, 'org.permissions.manage');
    });
    const where = appPublicId ? { app: { publicId: appPublicId } } : {};
    const roles = await prisma.saRole.findMany({ where, include: ROLE_INCLUDE });
    return roles.map(formatRole);
  }

  async getRole(callerBaId: string, publicId: string) {
    await checkPermission(callerBaId, 'platform.permissions.manage').catch(async () => {
      await checkPermission(callerBaId, 'org.permissions.manage');
    });
    const role = await prisma.saRole.findUnique({ where: { publicId }, include: ROLE_INCLUDE });
    if (!role) throw new NotFoundException();
    return formatRole(role);
  }
}
