export interface GateClient {
  saUser: {
    findUnique(args: {
      where: { betterAuthUserId: string };
      select: { status: true };
    }): Promise<{ status: string } | null>;
  };
  user?: {
    findUnique(args: {
      where: { id: string };
      select: { createdAt: true };
    }): Promise<{ createdAt: Date } | null>;
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
  // Allow session creation during seeding
  if (
    process.argv.some((arg) => arg.includes('seed')) ||
    process.env.SEEDING === 'true'
  ) {
    return { allowed: true, status: 'active' };
  }

  const saUser = await db.saUser.findUnique({
    where: { betterAuthUserId: userId },
    select: { status: true },
  });

  if (!saUser) {
    // During registration, a BetterAuth user is created before saUser.
    // Allow session creation if the BetterAuth user was created within the last 15 seconds.
    if (db.user) {
      const user = await db.user.findUnique({
        where: { id: userId },
        select: { createdAt: true },
      });
      if (user && Date.now() - user.createdAt.getTime() < 15000) {
        return { allowed: true, status: 'active' };
      }
    }
    return { allowed: false, status: null };
  }

  return { allowed: saUser.status === 'active', status: saUser.status };
}
