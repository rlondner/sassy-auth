jest.mock('./resolve-app-for-reset-token', () => ({
  resolveAppForResetToken: jest.fn(),
}));

import { PasswordPolicyController } from './password-policy.controller';

describe('PasswordPolicyController', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the global policy when resetToken is omitted', async () => {
    const controller = new PasswordPolicyController();
    const result = await controller.get(undefined);
    expect(result.passwordPolicy.minLength).toBe(12);
  });

  it('returns the app-resolved policy for a valid resetToken', async () => {
    const { resolveAppForResetToken } = require('./resolve-app-for-reset-token');
    resolveAppForResetToken.mockResolvedValue({
      id: 1,
      passwordPolicyOverride: { minLength: 20, requireUppercase: false, requireLowercase: false, requireNumber: false, requireSpecial: false, minNumbers: 0, minSpecial: 0 },
    });
    const controller = new PasswordPolicyController();
    const result = await controller.get('tok');
    expect(result.passwordPolicy.minLength).toBe(20);
  });

  it('falls back to the global policy for an unresolvable resetToken', async () => {
    const { resolveAppForResetToken } = require('./resolve-app-for-reset-token');
    resolveAppForResetToken.mockResolvedValue(null);
    const controller = new PasswordPolicyController();
    const result = await controller.get('bad-tok');
    expect(result.passwordPolicy.minLength).toBe(12);
  });
});
