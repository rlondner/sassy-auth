// Smoke test: verify the Prisma client exposes the new 2FA fields
// at the TypeScript level. This does NOT require a live database.
import { Prisma } from './generated/prisma/client';

describe('2FA schema additions', () => {
  it('User model has twoFactorEnabled field', () => {
    // TypeScript assertion: if the field is missing the type would not compile.
    const _field: Prisma.UserUpdateInput['twoFactorEnabled'] = true;
    expect(typeof _field).toBe('boolean');
  });

  it('TwoFactor model type exists', () => {
    // Prisma.TwoFactorCreateInput must exist after migration + generate.
    type _T = Prisma.TwoFactorCreateInput;
    const input: _T = {
      id: 'test-id',
      secret: 'secret',
      backupCodes: '[]',
      user: { connect: { id: 'uid' } },
    };
    expect(input.id).toBe('test-id');
  });

  it('SaApp model has twoFactorTrustDays field', () => {
    const _field: Prisma.SaAppUpdateInput['twoFactorTrustDays'] = 14;
    expect(typeof _field).toBe('number');
  });

  it('SaUser model has twoFactorPromptedAt field', () => {
    const _field: Prisma.SaUserUpdateInput['twoFactorPromptedAt'] = new Date();
    expect(_field instanceof Date).toBe(true);
  });
});
