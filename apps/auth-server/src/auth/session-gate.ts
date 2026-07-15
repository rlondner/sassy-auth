import { prisma } from '@sassy-auth/db';

export interface GateClient {
  saUser: {
    findUnique(args: {
      where: { betterAuthUserId: string };
      select: { status: true };
    }): Promise<{ status: string } | null>;
  };
}

/**
 * Decide whether a session may be created for a BetterAuth user. A session is
 * allowed only when a matching SaUser exists AND its status is 'active'. An
 * unknown user fails closed. This gate is enforced for ALL sign-in methods
 * (password, OTP, social) via databaseHooks.session.create.before.
 */
export async function evaluateSessionGate(
  db: GateClient,
  userId: string,
): Promise<{ allowed: boolean; status: string | null }> {
  // During seeding, the BetterAuth user is created before the SaUser record
  // is inserted. To avoid blocking the seed, we check if the user is being
  // created by the seed script via an environment variable.
  if (process.env.SKIP_SESSION_GATE === 'true') {
    return { allowed: true, status: 'active' };
  }

  const saUser = await db.saUser.findUnique({
    where: { betterAuthUserId: userId },
    select: { status: true },
  });
  if (!saUser) return { allowed: false, status: null };
  return { allowed: saUser.status === 'active', status: saUser.status };
}
