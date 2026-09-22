import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '@sassy-auth/db';
import type { ConsentDocumentType } from '@sassy-auth/types';
import { resolveOutstandingConsent } from '../consent/resolve-outstanding-consent';
import { recordConsent } from '../consent/record-consent';
import { resolveCountryFromIp } from '../common/geoip/geoip.service';

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

  async getTwoFactorStatus(baId: string): Promise<{ twoFactorPromptedAt: Date | null }> {
    const user = await prisma.saUser.findUnique({
      where: { betterAuthUserId: baId },
      select: { twoFactorPromptedAt: true },
    });
    if (!user) throw new ForbiddenException();
    return { twoFactorPromptedAt: user.twoFactorPromptedAt };
  }

  async recordTwoFactorPrompted(baId: string): Promise<void> {
    await prisma.saUser.updateMany({
      where: { betterAuthUserId: baId },
      data: { twoFactorPromptedAt: new Date() },
    });
    // updateMany is used (not update) because we key by betterAuthUserId,
    // which is unique but not the Prisma model primary key. Idempotent.
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

  async getOutstandingConsent(
    baId: string,
    appPublicId: string,
    ip: string,
  ): Promise<{ outstanding: Array<{ documentType: ConsentDocumentType; url: string }> }> {
    const user = await prisma.saUser.findUnique({ where: { betterAuthUserId: baId }, select: { id: true } });
    if (!user) throw new ForbiddenException();
    const app = await prisma.saApp.findUnique({
      where: { publicId: appPublicId },
      select: { id: true, privacyPolicyUrl: true, termsUrl: true, gdprUrl: true },
    });
    if (!app) throw new NotFoundException('App not found');
    const country = resolveCountryFromIp(ip);
    const outstanding = await resolveOutstandingConsent(prisma, user.id, app.id, app, country);
    return { outstanding };
  }

  async recordMyConsent(
    baId: string,
    appPublicId: string,
    ip: string,
    accepted: ConsentDocumentType[],
  ): Promise<void> {
    const user = await prisma.saUser.findUnique({ where: { betterAuthUserId: baId }, select: { id: true } });
    if (!user) throw new ForbiddenException();
    const app = await prisma.saApp.findUnique({
      where: { publicId: appPublicId },
      select: { id: true, privacyPolicyUrl: true, termsUrl: true, gdprUrl: true },
    });
    if (!app) throw new NotFoundException('App not found');
    const country = resolveCountryFromIp(ip);
    const outstanding = await resolveOutstandingConsent(prisma, user.id, app.id, app, country);
    const acceptedSet = new Set(accepted);
    const missing = outstanding.filter((doc) => !acceptedSet.has(doc.documentType));
    if (missing.length > 0) {
      throw new BadRequestException(`Missing acceptance for: ${missing.map((d) => d.documentType).join(', ')}`);
    }
    // Only ever record documents that are genuinely outstanding — an
    // `accepted` entry naming a document the app doesn't require (or that
    // was already accepted) is silently ignored rather than written, so a
    // stale/forged request body can't create a phantom consent row.
    const toRecord = outstanding.filter((doc) => acceptedSet.has(doc.documentType));
    await recordConsent(prisma, user.id, app.id, toRecord);
  }
}
