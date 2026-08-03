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
 *
 * Note: To allow new sign-ups/registrations and platform admin seeding to succeed
 * (where the BetterAuth user is created before the corresponding SaUser is initialized),
 * we bypass the fail-closed behavior if the BetterAuth user was created recently
 * (e.g. within the last 30 seconds).
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
    if (db.user) {
      const u = await db.user.findUnique({
        where: { id: userId },
        select: { createdAt: true },
      });
      if (u) {
        const ageInMs = Date.now() - u.createdAt.getTime();
        if (ageInMs < 30000) {
          return { allowed: true, status: null };
        }
      }
    }
    return { allowed: false, status: null };
  }
  return { allowed: saUser.status === 'active', status: saUser.status };
}
