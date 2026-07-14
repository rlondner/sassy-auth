import { hashPassword } from 'better-auth/crypto';
import * as crypto from 'crypto';

export async function createBetterAuthUser(tx: any, data: {
  email: string;
  name: string;
  password?: string;
  emailVerified?: boolean;
}) {
  const baUserId = crypto.randomUUID();
  const now = new Date();

  await tx.user.create({
    data: {
      id: baUserId,
      name: data.name,
      email: data.email,
      emailVerified: data.emailVerified ?? true,
      createdAt: now,
      updatedAt: now,
    },
  });

  if (data.password) {
    const hashedPassword = await hashPassword(data.password);
    await tx.account.create({
      data: {
        id: crypto.randomUUID(),
        accountId: baUserId,
        providerId: 'credential',
        userId: baUserId,
        password: hashedPassword,
        createdAt: now,
        updatedAt: now,
      },
    });
  }

  return baUserId;
}
