export interface GateClient {
  saUser: {
    findUnique(args: {
      where: { betterAuthUserId: string };
      select: { status: true };
    }): Promise<{ status: string } | null>;
  };
  user: {
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
  const saUser = await db.saUser.findUnique({
    where: { betterAuthUserId: userId },
    select: { status: true },
  });
  if (!saUser) {
    // If no saUser exists yet, allow session creation only if the BetterAuth user
    // was created within the last 30 seconds (likely registering or seeding).
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { createdAt: true },
    });
    if (user && Date.now() - user.createdAt.getTime() < 30 * 1000) {
      return { allowed: true, status: null };
    }
    return { allowed: false, status: null };
  }
  return { allowed: saUser.status === 'active', status: saUser.status };
}
