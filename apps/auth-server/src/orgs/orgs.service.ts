import { Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '@sassy-auth/db';
import { checkPermission } from '../common/permissions/check-permission';

const ORG_INCLUDE = { app: { select: { publicId: true } } } as const;

function formatOrg(o: { publicId: string; name: string; isPlatform: boolean; app: { publicId: string } }) {
  return { id: o.publicId, name: o.name, appId: o.app.publicId, isPlatform: o.isPlatform };
}

@Injectable()
export class OrgsService {
  async listOrgs(callerBaId: string) {
    await checkPermission(callerBaId, 'platform.orgs.manage').catch(async () => {
      await checkPermission(callerBaId, 'org.users.manage');
    });
    const orgs = await prisma.saOrg.findMany({ include: ORG_INCLUDE });
    return orgs.map(formatOrg);
  }

  async getOrg(callerBaId: string, publicId: string) {
    await checkPermission(callerBaId, 'platform.orgs.manage').catch(async () => {
      await checkPermission(callerBaId, 'org.users.manage');
    });
    const org = await prisma.saOrg.findUnique({ where: { publicId }, include: ORG_INCLUDE });
    if (!org) throw new NotFoundException();
    return formatOrg(org);
  }
}
