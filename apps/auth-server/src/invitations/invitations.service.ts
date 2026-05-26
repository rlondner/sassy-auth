import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { prisma } from '@sassy-auth/db';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

const INVITATION_INCLUDE = {
  user: {
    include: { betterAuthUser: { select: { id: true, email: true } } },
  },
} as const;

@Injectable()
export class InvitationsService {
  async validateToken(token: string) {
    const inv = await prisma.saInvitation.findUnique({
      where: { token },
      include: INVITATION_INCLUDE,
    });
    if (!inv) throw new NotFoundException('Invitation not found');

    const expired = inv.expiresAt < new Date();
    return {
      firstName: inv.user.firstName,
      email: inv.user.betterAuthUser.email,
      expired,
    };
  }

  async acceptInvitation(token: string, password: string): Promise<void> {
    const inv = await prisma.saInvitation.findUnique({
      where: { token },
      include: INVITATION_INCLUDE,
    });
    if (!inv) throw new NotFoundException('Invitation not found');
    if (inv.usedAt) throw new BadRequestException('Invitation already used');
    if (inv.expiresAt < new Date()) throw new BadRequestException('Invitation expired');

    const hashed = await bcrypt.hash(password, 10);
    const now = new Date();
    const baUserId = inv.user.betterAuthUser.id;

    await prisma.$transaction(async (tx) => {
      await tx.account.create({
        data: {
          id: crypto.randomUUID(),
          accountId: baUserId,
          providerId: 'credential',
          userId: baUserId,
          password: hashed,
          createdAt: now,
          updatedAt: now,
        },
      });

      await tx.saUser.update({
        where: { id: inv.user.id },
        data: { status: 'active' },
      });

      await tx.user.update({
        where: { id: baUserId },
        data: { emailVerified: true, updatedAt: now },
      });

      await tx.saInvitation.update({
        where: { id: inv.id },
        data: { usedAt: now },
      });
    });
  }
}
