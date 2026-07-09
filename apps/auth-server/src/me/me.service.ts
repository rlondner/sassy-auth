import { ForbiddenException, Injectable } from '@nestjs/common';
import { prisma } from '@sassy-auth/db';

type RolePermRel = { permission: { name: string } };
type RoleRel = { role: { permissions: RolePermRel[] } };
type DirectPermRel = { permission: { name: string } };

@Injectable()
export class MeService {
  async getMyPermissions(callerBaId: string): Promise<{ permissions: string[] }> {
    const user = await prisma.saUser.findUnique({
      where: { betterAuthUserId: callerBaId },
      include: {
        roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
        directPermissions: { include: { permission: true } },
      },
    });
    if (!user) throw new ForbiddenException();
    const names = new Set<string>();
    user.roles.forEach((ur: RoleRel) =>
      ur.role.permissions.forEach((rp: RolePermRel) => names.add(rp.permission.name)),
    );
    user.directPermissions.forEach((up: DirectPermRel) => names.add(up.permission.name));
    return { permissions: Array.from(names).sort() };
  }

  async getMyProfile(callerBaId: string): Promise<{
    userId: string;
    org: { id: string; name: string; isPlatform: boolean };
    app: { id: string; name: string; isPlatform: boolean };
  }> {
    const user = await prisma.saUser.findUnique({
      where: { betterAuthUserId: callerBaId },
      include: { org: { include: { app: true } } },
    });
    if (!user) throw new ForbiddenException();
    return {
      userId: user.publicId,
      org: {
        id: user.org.publicId,
        name: user.org.name,
        isPlatform: user.org.isPlatform,
      },
      app: {
        id: user.org.app.publicId,
        name: user.org.app.name,
        isPlatform: user.org.app.isPlatform,
      },
    };
  }
}
