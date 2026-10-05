/* eslint-disable @typescript-eslint/no-explicit-any */
import { resolveAppForResetToken } from './resolve-app-for-reset-token';

describe('resolveAppForResetToken', () => {
  function mockPrisma(overrides: Partial<{
    verification: { value: string } | null;
    user: { id: number; org: { appId: number } } | null;
    app: { id: number; passwordPolicyOverride: unknown } | null;
  }>) {
    return {
      verification: { findFirst: jest.fn().mockResolvedValue(overrides.verification ?? null) },
      saUser: { findFirst: jest.fn().mockResolvedValue(overrides.user ?? null) },
      saApp: { findUnique: jest.fn().mockResolvedValue(overrides.app ?? null) },
    };
  }

  it('returns null when the verification token does not exist', async () => {
    const prisma = mockPrisma({ verification: null });
    expect(await resolveAppForResetToken(prisma as any, 'bad-token')).toBeNull();
  });

  it('returns null when the verification value has no matching SaUser', async () => {
    const prisma = mockPrisma({ verification: { value: 'ba-1' }, user: null });
    expect(await resolveAppForResetToken(prisma as any, 'tok')).toBeNull();
  });

  it('queries Verification by the reset-password: identifier prefix', async () => {
    const prisma = mockPrisma({ verification: { value: 'ba-1' }, user: { id: 1, org: { appId: 7 } }, app: { id: 7, passwordPolicyOverride: null } });
    await resolveAppForResetToken(prisma as any, 'tok-abc');
    expect(prisma.verification.findFirst).toHaveBeenCalledWith({ where: { identifier: 'reset-password:tok-abc' } });
  });

  it('resolves the app via SaUser.org.appId when the chain is intact', async () => {
    const prisma = mockPrisma({ verification: { value: 'ba-1' }, user: { id: 1, org: { appId: 7 } }, app: { id: 7, passwordPolicyOverride: null } });
    const app = await resolveAppForResetToken(prisma as any, 'tok');
    expect(app).toEqual({ id: 7, passwordPolicyOverride: null });
  });

  it('includes the 4 background color overrides', async () => {
    const prisma = {
      verification: { findFirst: jest.fn().mockResolvedValue({ value: 'ba-user-1' }) },
      saUser: { findFirst: jest.fn().mockResolvedValue({ org: { appId: 1 } }) },
      saApp: {
        findUnique: jest.fn().mockResolvedValue({
          id: 1, passwordPolicyOverride: null,
          pageLightBackgroundColor: '#111111', pageDarkBackgroundColor: '#222222',
          cardLightBackgroundColor: '#333333', cardDarkBackgroundColor: '#444444',
        }),
      },
    };

    const result = await resolveAppForResetToken(prisma as never, 'token-1');

    expect(result?.pageLightBackgroundColor).toBe('#111111');
    expect(result?.cardDarkBackgroundColor).toBe('#444444');
  });
});
