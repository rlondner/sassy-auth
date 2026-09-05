import type { PrismaClient } from '@sassy-auth/db';

/**
 * BetterAuth's /reset-password flow stores the token as a Verification row
 * with identifier `reset-password:<token>` and `value` = the BetterAuth
 * user id (confirmed against the installed better-auth@1.6.11's
 * dist/api/routes/password.mjs). Resolves through SaUser.org.appId to find
 * which app's password policy governs this reset. Returns null for any
 * broken link in the chain (unknown/expired token, orphaned SaUser) —
 * callers treat null as "defer to BetterAuth's own token-validity error,
 * don't invent a different one here."
 */
export async function resolveAppForResetToken(
  prisma: Pick<PrismaClient, 'verification' | 'saUser' | 'saApp'>,
  token: string,
): Promise<{ id: number; passwordPolicyOverride: unknown } | null> {
  const verification = await prisma.verification.findFirst({
    where: { identifier: `reset-password:${token}` },
  });
  if (!verification) return null;

  const user = await prisma.saUser.findFirst({
    where: { betterAuthUserId: verification.value },
    select: { org: { select: { appId: true } } },
  });
  if (!user) return null;

  return prisma.saApp.findUnique({
    where: { id: user.org.appId },
    select: { id: true, passwordPolicyOverride: true },
  });
}
