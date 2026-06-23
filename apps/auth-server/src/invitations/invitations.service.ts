import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { prisma } from '@sassy-auth/db';
// BetterAuth verifies credential-provider passwords with scrypt
// (format `<saltHex>:<hashHex>`), so the account row written here MUST be
// produced by BetterAuth's own hasher — bcrypt hashes can't be decoded by
// verifyPassword and surface as 500s on /api/auth/sign-in/email.
import { hashPassword } from 'better-auth/crypto';
import * as crypto from 'crypto';
import { LoggerService } from '../common/logger/logger.service';

const INVITATION_INCLUDE = {
  user: {
    include: { betterAuthUser: { select: { id: true, email: true } } },
  },
} as const;

@Injectable()
export class InvitationsService {
  constructor(private readonly logger: LoggerService) {}

  async validateToken(token: string) {
    const inv = await prisma.saInvitation.findUnique({
      where: { token },
      include: INVITATION_INCLUDE,
    });
    if (!inv) throw new NotFoundException('Invitation not found');

    // A consumed invitation is no longer usable, so report it as expired —
    // acceptInvitation() already rejects this case, and the admin
    // accept-invite page collapses both into the same i18n string ("expired
    // or invalid"). Without this, revisiting a used link still renders the
    // password form and the user only learns it's stale after submitting.
    const expired = inv.usedAt !== null || inv.expiresAt < new Date();
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

    const hashed = await hashPassword(password);
    const now = new Date();
    const baUserId = inv.user.betterAuthUser.id;

    await prisma.$transaction(async (tx: any) => {
      // Atomically claim the invitation: only updates rows where
      // usedAt IS NULL and the token has not expired. count === 1 means
      // we won the race; count === 0 means another concurrent acceptance
      // claimed it first.
      const claimed = await tx.saInvitation.updateMany({
        where: {
          id: inv.id,
          usedAt: null,
          expiresAt: { gt: now },
        },
        data: { usedAt: now },
      });
      if (claimed.count !== 1) {
        throw new BadRequestException('Invitation already used or expired');
      }

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
    });

    this.logger.getWinstonLogger().info('Invitation accepted', {
      context: 'InvitationsService',
      userId: inv.user.publicId ?? String(inv.user.id),
    });
  }
}
